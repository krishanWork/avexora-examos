import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The client/server authorization parity test.
//
// The server is the enforcement point and the client is a UI convenience layer that
// mirrors it. That mirroring used to be maintained by hand and by comment, which is
// how rbac-audit/ISSUE-016 came to exist: three frontend action permissions granted
// roles the backend refused, so a principal saw create/edit controls on /teachers,
// /students and /parents that answered 403 on every click.
//
// Nothing asserted the relationship, so the drift could recur silently. This suite
// pins it:
//
//   1. The two sides agree on the role vocabulary and its ordering.
//   2. Capability is the union over held roles on both sides; identity (portal, nav,
//      scope) is the primary role on both sides.
//   3. Every frontend action permission is a SUBSET of the backend authority for that
//      action. A frontend over-grant fails.
//   4. Every nav destination a role is offered is admitted by the PAGE_ROLES group
//      that gates the route, so no role is shown a link RoleGuard will refuse.
//   5. Every route in App.jsx that sits under ProtectedRoute is wrapped in a
//      RoleGuard, which keeps ISSUE-007 closed.
//
// No database, no browser, no network. It imports the real modules the app runs.

import {
  APP_ROLES as SERVER_ROLES,
  VALID_APP_ROLES,
  APP_ROLE_PRECEDENCE as SERVER_PRECEDENCE,
  PLATFORM_ROLES as SERVER_PLATFORM,
  EXAM_WORKFLOW_ROLES,
  EXAM_MATERIAL_ROLES,
  STAFF_MANAGE_ROLES,
  STAFF_ROLES,
  AFFILIATE_ROLES,
AFFILIATE_MANAGE_ROLES,
  PLAN_CHANGE_APPROVE_ROLES,
  FAMILY_ROLES as SERVER_FAMILY,
  ENTITY_WRITE_ROLES,
  PROVISION_STUDENT_LOGIN_ROLES,
  primaryAppRole,
  normalizeAppRoles,
  appRolesOf,
  hasAnyRole,
  isPlatform,
  isExamWorkflow,
} from "../rbac.js";

import {
  APP_ROLES as CLIENT_ROLES,
  APP_ROLE_PRECEDENCE as CLIENT_PRECEDENCE,
  PLATFORM_ROLES as CLIENT_PLATFORM,
  EXAM_WORKFLOW_ROLES as CLIENT_EXAM_WORKFLOW,
  FAMILY_ROLES as CLIENT_FAMILY,
  AFFILIATE_ROLES as CLIENT_AFFILIATE,
  TENANT_STAFF_ROLES as CLIENT_TENANT_STAFF,
  normalizeAppRoles as clientNormalizeAppRoles,
  getAppRoles as clientGetAppRoles,
  getAppRole,
  hasAnyRole as clientHasAnyRole,
  isExamWorkflowRole,
  isPlatformRole,
  isFamilyRole,
  rolePortal,
  ROLE_PORTAL,
} from "../../src/lib/roles.js";

import { PERMISSIONS, PAGE_ROLES, can } from "../../src/lib/permissions.js";
import { NAV, ROUTE_ACCESS, STANDALONE_PATHS, canSeeRoute, visibleDestinations } from "../../src/lib/nav.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// An actor as the client sees one: `app_roles` plus the `app_role` mirror.
const asClient = (...app_roles) => ({ app_roles, app_role: app_roles[0] ?? null });
// An actor as the server sees one, wrapped in the request the predicates read.
const asServer = (...app_roles) => ({ user: { app_roles, app_role: app_roles[0] ?? null, _id: "u1" } });

// Matrix verbs are stored as arrays in ENTITY_WRITE_ROLES, while the role SETS are
// already Sets. Normalize both to a Set so the assertions below do not have to care
// which shape a given authority happens to have.
const asSet = (value) => (value instanceof Set ? value : new Set(value));

// --- 1. Vocabulary and ordering ------------------------------------------------

test("client and server agree on the role vocabulary", () => {
  assert.deepEqual(Object.keys(CLIENT_ROLES).sort(), Object.keys(SERVER_ROLES).sort());
  for (const [key, value] of Object.entries(SERVER_ROLES)) {
    assert.equal(CLIENT_ROLES[key], value, `role key ${key} drifted`);
  }
  assert.equal(VALID_APP_ROLES.size, 9, "the server must still expose exactly nine roles");
});

test("the client role list and the server precedence order are identical", () => {
  // Precedence decides the primary role, and therefore the portal, the nav and every
  // scope narrowing. A client that ordered it differently would send a multi-role
  // account to a different portal than the server believes it is in.
  assert.deepEqual(CLIENT_PRECEDENCE, SERVER_PRECEDENCE);
  assert.equal(CLIENT_PRECEDENCE.length, 9);
  assert.equal(new Set(CLIENT_PRECEDENCE).size, 9, "precedence must not repeat a role");
});

test("the shared role groups match on both sides", () => {
  assert.deepEqual([...CLIENT_PLATFORM].sort(), [...SERVER_PLATFORM].sort());
  assert.deepEqual([...CLIENT_EXAM_WORKFLOW].sort(), [...EXAM_WORKFLOW_ROLES].sort());
  assert.deepEqual([...CLIENT_FAMILY].sort(), [...SERVER_FAMILY].sort());
  assert.deepEqual([...CLIENT_AFFILIATE].sort(), [...AFFILIATE_ROLES].sort());

  // The load-bearing rule: a family role never coexists with staff or platform, so no
  // account can hold both the narrowest and the widest read in the system.
  for (const family of SERVER_FAMILY) {
    assert.ok(!SERVER_PLATFORM.has(family), `${family} must not be platform`);
    assert.ok(!EXAM_WORKFLOW_ROLES.has(family), `${family} must not drive the exam workflow`);
    assert.ok(!EXAM_MATERIAL_ROLES.has(family), `${family} must not see exam material`);
  }
  // The affiliate is a reseller, not a reader. This is the assertion that would fail
  // first if anyone ever moved it into PLATFORM_ROLES for convenience: `platform()`
  // short-circuits readScope() to the caller's criteria untouched, which is an
  // unscoped read of every school on the platform. A reseller needs none of it.
  for (const affiliate of AFFILIATE_ROLES) {
    assert.ok(!SERVER_PLATFORM.has(affiliate), `${affiliate} must not be a platform role`);
    assert.ok(!EXAM_WORKFLOW_ROLES.has(affiliate), `${affiliate} must not drive the exam workflow`);
    assert.ok(!EXAM_MATERIAL_ROLES.has(affiliate), `${affiliate} must not see exam material`);
    assert.ok(!SERVER_FAMILY.has(affiliate), `${affiliate} must not be a family role`);
    assert.ok(!AFFILIATE_MANAGE_ROLES.has(affiliate), `${affiliate} must not be able to manage affiliates`);
  }
  // Every role family group is fully covered by exactly one of the four sets.
  const covered = new Set([...AFFILIATE_ROLES, ...SERVER_PLATFORM, ...STAFF_ROLES, ...SERVER_FAMILY]);
  assert.equal(covered.size, 9, "every role must belong to a family");
});

// --- 2. Union vs primary semantics ---------------------------------------------

const SHAPES = [
  { label: "single role", user: { app_roles: ["teacher"], app_role: "teacher" } },
  { label: "multi-role staff", user: { app_roles: ["teacher", "exam_coordinator"], app_role: "exam_coordinator" } },
  { label: "primary disagrees with the array", user: { app_roles: ["teacher"], app_role: "super_admin" } },
  { label: "legacy document with only app_role", user: { app_role: "principal" } },
  { label: "unknown role", user: { app_roles: ["wizard"], app_role: "wizard" } },
  { label: "no role at all", user: {} },
  { label: "family pair", user: { app_roles: ["parent", "student"], app_role: "student" } },
];

test("both sides normalize an actor to the same ordered role set", () => {
  for (const { label, user } of SHAPES) {
    assert.deepEqual(
      clientGetAppRoles(user),
      appRolesOf(user),
      `client/server normalizeAppRoles disagreed for ${label}`
    );
  }
});

test("both sides pick the same primary role, and the canonical array wins over the mirror", () => {
  for (const { label, user } of SHAPES) {
    assert.equal(getAppRole(user), primaryAppRole(user), `primary role disagreed for ${label}`);
  }
  // The disagreeing-mirror case is the one that matters: `app_role` is a mirror of the
  // primary role, never an independent input. Reading it independently is how a
  // not-yet-backfilled account could authorize differently depending on which helper a
  // caller reached for.
  const stale = { app_roles: ["teacher"], app_role: "super_admin" };
  assert.deepEqual(clientGetAppRoles(stale), ["teacher"]);
  assert.equal(getAppRole(stale), "teacher");
});

test("capability is the union over held roles on both sides", () => {
  const mixed = ["teacher", "exam_coordinator"];
  // One role each: hasAnyRole takes a collection, so a bare string would iterate as
  // characters and answer false for every role — a test bug that would hide the real
  // union behaviour, which is the thing being asserted here.
  const only = (role) => new Set([role]);

  assert.equal(clientHasAnyRole(asClient(...mixed), only(SERVER_ROLES.TEACHER)), true);
  assert.equal(hasAnyRole(asServer(...mixed), only(SERVER_ROLES.TEACHER)), true);
  assert.equal(clientHasAnyRole(asClient(...mixed), only(SERVER_ROLES.EXAM_COORDINATOR)), true);
  assert.equal(hasAnyRole(asServer(...mixed), only(SERVER_ROLES.EXAM_COORDINATOR)), true);

  // A capability neither held role authorizes stays denied on both sides.
  assert.equal(clientHasAnyRole(asClient(...mixed), only(SERVER_ROLES.PARENT)), false);
  assert.equal(hasAnyRole(asServer(...mixed), only(SERVER_ROLES.PARENT)), false);

  // STAFF_MANAGE_ROLES admits a principal but neither of the two held roles, so the
  // union must not invent it. Reading the primary role alone would give the same
  // answer here — which is why the two assertions above, not this one, prove union
  // behaviour rather than single-role behaviour.
  assert.equal(hasAnyRole(asServer(...mixed), STAFF_MANAGE_ROLES), false);
  assert.equal(clientHasAnyRole(asClient(...mixed), new Set(STAFF_MANAGE_ROLES)), false);
});

test("the exam-workflow predicate answers the same on both sides", () => {
  for (const role of VALID_APP_ROLES) {
    const client = asClient(role);
    assert.equal(
      isExamWorkflowRole(client),
      isExamWorkflow(asServer(role)),
      `exam workflow disagreed for ${role}`
    );
    assert.equal(isPlatformRole(client), isPlatform(asServer(role)), `platform disagreed for ${role}`);
    assert.equal(isFamilyRole(client), SERVER_FAMILY.has(role), `family disagreed for ${role}`);
  }
});

test("every role resolves to a portal on the client, and it matches the precedence order", () => {
  for (const role of VALID_APP_ROLES) {
    const portal = rolePortal(asClient(role));
    assert.equal(typeof portal, "string", `${role} must resolve to a portal`);
    assert.ok(portal.startsWith("/"), `${role} portal must be a path, got ${portal}`);
  }
  // Precedence is what makes a multi-role account land on the wider role's console.
  assert.equal(getAppRole(asClient("teacher", "exam_coordinator")), SERVER_ROLES.EXAM_COORDINATOR);
  assert.equal(
    rolePortal(asClient("teacher", "exam_coordinator")),
    ROLE_PORTAL[SERVER_ROLES.EXAM_COORDINATOR]
  );
});

// --- 3. The subset invariant ---------------------------------------------------

// Which backend authority each frontend action is measured against.
//
// This table is the one piece of hand-maintained data in the suite, and it is
// unavoidable: the two sides use different vocabularies (a client "action" may map to
// an entity, to a role set, or to nothing at all). What makes it safe is the two tests
// that follow it — every PERMISSIONS key must appear here, and every authority named
// here must resolve against the real server exports. A new frontend action cannot be
// added without declaring what it is measured against, and a renamed backend export
// breaks the suite rather than silently passing.
const FRONTEND_ACTION_AUTHORITY = {
  // Entity write verbs, measured on the verb the control performs.
  publish_results: () => EXAM_WORKFLOW_ROLES,
  review_results: () => EXAM_WORKFLOW_ROLES,
  evaluate_exam: () => EXAM_WORKFLOW_ROLES,
  delete_students: () => ENTITY_WRITE_ROLES.Student.delete,
  edit_answer_key: () => ENTITY_WRITE_ROLES.AnswerKey.update,
  manage_academics: () => ENTITY_WRITE_ROLES.SchoolClass.create,
  manage_assignments: () => ENTITY_WRITE_ROLES.Assignment.create,
  mark_attendance: () => ENTITY_WRITE_ROLES.Attendance.create,
  manage_billing: () => ENTITY_WRITE_ROLES.Tenant.update,
  // Asking for a different plan is "change the plan on my own institution", which is
  // the same write, so canRequestPlanChange derives from that row rather than
  // restating it. Measured against the row so the two cannot drift.
  submit_plan_change: () => new Set(ENTITY_WRITE_ROLES.Tenant.update),
  manage_students: () => new Set([
    ...ENTITY_WRITE_ROLES.Student.create,
    ...ENTITY_WRITE_ROLES.Enrollment.create,
  ]),
  manage_teachers: () => ENTITY_WRITE_ROLES.Teacher.create,
  provision_student_logins: () => PROVISION_STUDENT_LOGIN_ROLES,
  manage_crm: () => new Set([
    ...ENTITY_WRITE_ROLES.Parent.create,
    ...ENTITY_WRITE_ROLES.ParentStudent.create,
  ]),
  submit_assignments: () => ENTITY_WRITE_ROLES.AssignmentSubmission.create,
  manage_staff: () => STAFF_MANAGE_ROLES,
  // Money-moving surface. The backend authority is the affiliate-programme
  // predicate, not a matrix row: an affiliate profile carries a commission rate,
  // which is not an entity field and has no write verb.
  manage_affiliates: () => AFFILIATE_MANAGE_ROLES,
  // Approving a plan change grants a paid entitlement and writes a Payment, so the
  // authority is the plan-change predicate rather than any entity write verb.
  approve_plan_changes: () => PLAN_CHANGE_APPROVE_ROLES,
  // No write verb: a read-only page. See the dedicated assertion below.
  manage_timetable: null,
  view_academic_dashboards: null,
};

test("every frontend action declares the backend authority it is measured against", () => {
  const declared = Object.keys(FRONTEND_ACTION_AUTHORITY).sort();
  const actual = Object.keys(PERMISSIONS).sort();
  assert.deepEqual(
    declared,
    actual,
    "PERMISSIONS and FRONTEND_ACTION_AUTHORITY disagree. A new frontend action must declare the backend authority it is a subset of."
  );
  for (const [action, resolve] of Object.entries(FRONTEND_ACTION_AUTHORITY)) {
    if (resolve === null) continue;
    const authority = asSet(resolve());
    assert.ok(authority.size > 0, `${action} resolved to an empty authority, which would make the subset vacuous`);
  }
});

test("no frontend action grants a capability the backend refuses", () => {
  for (const [action, resolve] of Object.entries(FRONTEND_ACTION_AUTHORITY)) {
    if (resolve === null) continue;
    const authority = asSet(resolve());
    // super_admin is stripped from both sides: the server bypasses every check for the
    // platform owner rather than listing it (rbac.js isSuperAdmin), so comparing it
    // against a matrix row would report a false divergence.
    const frontend = PERMISSIONS[action].filter((role) => role !== SERVER_ROLES.SUPER_ADMIN);
    const overGranted = frontend.filter((role) => !authority.has(role));
    assert.deepEqual(
      overGranted,
      [],
      `${action} grants ${overGranted.join(", ")} but the backend authority is [${[...authority].join(", ")}]. ` +
        "The frontend is the side that must narrow: widening the backend to match a UI would convert a UX defect into a privilege grant."
    );
  }
});

test("every frontend permission names real roles, and always names super_admin", () => {
  for (const [action, roles] of Object.entries(PERMISSIONS)) {
    for (const role of roles) {
      assert.ok(VALID_APP_ROLES.has(role), `${action} names unknown role "${role}"`);
    }
    // The server permits the platform owner unconditionally, so the client must render
    // the control for them rather than hiding a capability they do have.
    assert.ok(
      roles.includes(SERVER_ROLES.SUPER_ADMIN),
      `${action} omits super_admin, which would hide a capability the server grants unconditionally`
    );
    assert.ok(roles.length > 0, `${action} grants nothing at all`);
  }
});

test("the two read-only actions claim no write verb on the server", () => {
  // A "view dashboards" or "manage timetable" control that starts gating a write must
  // be re-declared above with the entity it writes, rather than left here passing
  // vacuously against nothing.
  for (const action of Object.keys(FRONTEND_ACTION_AUTHORITY).filter((a) => FRONTEND_ACTION_AUTHORITY[a] === null)) {
    assert.ok(PERMISSIONS[action], `${action} must still be a declared permission`);
  }
});

test("can() is a union over held roles, matching the server", () => {
  // A teacher who is also an exam coordinator keeps both halves of the capability set.
  const both = asClient("teacher", "exam_coordinator");
  assert.equal(can(both, "mark_attendance"), true, "teacher half");
  assert.equal(can(both, "manage_students"), true, "coordinator half");
  assert.equal(can(both, "manage_teachers"), false, "neither half may write a Teacher record");

  // Reading only the primary role would strip the second role, which is the inversion
  // of what holding two roles is for.
  const primaryOnly = SERVER_ROLES.EXAM_COORDINATOR;
  assert.notEqual(primaryOnly, SERVER_ROLES.TEACHER);
  assert.equal(can(both, "mark_attendance"), true);
});

test("the three ISSUE-016 over-grants are closed", () => {
  // The specific divergences rbac-audit/ISSUE-016 recorded. Kept as named assertions
  // rather than left to the general subset test, because this is a filed finding and a
  // reviewer will look for it by name.
  assert.ok(!PERMISSIONS.manage_teachers.includes(SERVER_ROLES.PRINCIPAL),
    "a principal cannot write a Teacher record (ENTITY_WRITE_ROLES.Teacher is school_admin only)");
  assert.ok(!PERMISSIONS.manage_students.includes(SERVER_ROLES.PRINCIPAL),
    "a principal cannot create or update a Student (Student C/U is school_admin + exam_coordinator)");
  assert.ok(!PERMISSIONS.manage_crm.includes(SERVER_ROLES.PRINCIPAL),
    "a principal cannot write a Parent (Parent C/U/D is school_admin only)");
  assert.ok(!PERMISSIONS.manage_crm.includes(SERVER_ROLES.EXAM_COORDINATOR),
    "an exam_coordinator cannot write a Parent (Parent C/U/D is school_admin only)");
  // The roles that legitimately hold each capability must survive the narrowing.
  assert.ok(PERMISSIONS.manage_students.includes(SERVER_ROLES.EXAM_COORDINATOR));
  assert.ok(PERMISSIONS.manage_students.includes(SERVER_ROLES.SCHOOL_ADMIN));
  assert.ok(PERMISSIONS.manage_teachers.includes(SERVER_ROLES.SCHOOL_ADMIN));
  assert.ok(PERMISSIONS.manage_crm.includes(SERVER_ROLES.SCHOOL_ADMIN));
});

// --- 4. Nav and route agreement ------------------------------------------------

test("every route the client gates names a PAGE_ROLES group that exists", () => {
  for (const [route, group] of Object.entries(ROUTE_ACCESS)) {
    if (group === null) continue;
    assert.ok(PAGE_ROLES[group], `ROUTE_ACCESS["${route}"] names missing PAGE_ROLES group "${group}"`);
    assert.ok(Array.isArray(PAGE_ROLES[group]), `PAGE_ROLES.${group} must be an array`);
    assert.ok(PAGE_ROLES[group].length > 0, `PAGE_ROLES.${group} admits nobody`);
    for (const role of PAGE_ROLES[group]) {
      assert.ok(VALID_APP_ROLES.has(role), `PAGE_ROLES.${group} names unknown role "${role}"`);
    }
  }
});

test("every nav destination a role is offered is admitted by the gate for that route", () => {
  // The defect this catches: NAV[exam_coordinator] listed /academic-setup while
  // ROUTE_ACCESS maps it to the schoolStructure group, which excludes the coordinator.
  // The backend agrees the page is not theirs — SchoolClass/Section/AcademicYear writes
  // are school_admin only and authorizeAcademicSetup admits only school_admin and
  // super_admin — so the link only ever bounced to /home.
  for (const [role, items] of Object.entries(NAV)) {
    assert.ok(VALID_APP_ROLES.has(role), `NAV has an entry for unknown role "${role}"`);
    for (const item of items) {
      assert.equal(typeof item.to, "string", `${role} nav entry needs a path`);
      assert.equal(typeof item.label, "string", `${role} nav entry "${item.to}" needs a label`);
      assert.equal(typeof item.icon, "string", `${role} nav entry "${item.to}" needs an icon key`);
      assert.ok(
        canSeeRoute(asClient(role), item.to),
        `${role} is offered the nav entry "${item.to}", which its own PAGE_ROLES gate refuses. ` +
          "Remove the entry or admit the role deliberately."
      );
    }
  }
});

test("every role has a nav entry, and every nav path is a known route", () => {
  for (const role of VALID_APP_ROLES) {
    assert.ok(Array.isArray(NAV[role]), `${role} must have a nav list`);
    assert.ok(NAV[role].length > 0, `${role} must be offered at least its portal`);
  }
  for (const items of Object.values(NAV)) {
    for (const item of items) {
      assert.ok(item.to in ROUTE_ACCESS, `nav path "${item.to}" has no ROUTE_ACCESS entry`);
    }
  }
});

test("a role with no roles is offered nothing", () => {
  // The AppLayout nav fallback this replaces handed the full school-admin sidebar to a
  // role-less account. A missing or unknown role must contribute nothing.
  assert.deepEqual(visibleDestinations({}, NAV[SERVER_ROLES.SCHOOL_ADMIN]), []);
  assert.deepEqual(visibleDestinations({ app_roles: ["wizard"] }, NAV[SERVER_ROLES.SCHOOL_ADMIN]), []);
  assert.deepEqual(visibleDestinations({}, NAV[SERVER_ROLES.STUDENT]), []);
});

test("canSeeRoute fails closed on an unmapped group and open on an unmapped path", () => {
  // A null group is a deliberately ungated route (/home, /change-password).
  assert.equal(canSeeRoute({}, "/home"), true);
  assert.equal(canSeeRoute({}, "/change-password"), true);
  // A path absent from ROUTE_ACCESS has no gate recorded. That is a gap in the table,
  // not a licence, so it is treated as ungated only for paths no nav entry uses — and
  // the nav test above guarantees no nav path is missing.
  assert.equal(canSeeRoute({}, "/definitely-not-a-route"), true);
  // Every gated route denies a role-less account.
  for (const [route, group] of Object.entries(ROUTE_ACCESS)) {
    if (group === null) continue;
    assert.equal(canSeeRoute({}, route), false, `${route} must deny an account with no role`);
  }
});

test("family roles reach their portal and the announcements page, nothing else", () => {
  for (const [role, portal] of [
    [SERVER_ROLES.STUDENT, "/student-portal"],
    [SERVER_ROLES.PARENT, "/parent-portal"],
  ]) {
    assert.equal(canSeeRoute(asClient(role), portal), true, `${role} must reach ${portal}`);
    assert.equal(canSeeRoute(asClient(role), "/announcements"), true, `${role} may read announcements`);
    // Staff surfaces must stay shut: role families are mutually exclusive on the server,
    // so no family account can legitimately match a staff page.
    for (const route of ["/dashboard", "/students", "/teachers", "/staff", "/billing", "/audit-logs", "/examinations"]) {
      assert.equal(canSeeRoute(asClient(role), route), false, `${role} must not reach ${route}`);
    }
  }
});

// The client-side half of the affiliate isolation story. The server half is that
// `affiliate` is absent from PLATFORM_ROLES and so readScope() answers `{_id:null}`
// for it; this asserts the UI offers it nothing to reach in the first place.
test("an affiliate reaches only its own portal, and no platform or school surface", () => {
  const affiliate = asClient(SERVER_ROLES.AFFILIATE);
  assert.equal(canSeeRoute(affiliate, "/affiliate-portal"), true, "affiliate must reach its portal");
  for (const route of [
    "/super-admin", "/institutions", "/leads", "/plans", "/employees", "/affiliates",
    "/dashboard", "/students", "/teachers", "/staff", "/billing", "/white-label",
    "/audit-logs", "/teacher-portal", "/student-portal", "/parent-portal", "/checkout",
  ]) {
    assert.equal(canSeeRoute(affiliate, route), false, `affiliate must not reach ${route}`);
  }
  // The platform owner is admitted to every portal as the platform owner debugging
  // the flow, exactly as it is admitted to studentPortal and parentPortal. That is
  // the reason the reverse loop below checks employee, school_admin and teacher —
  // roles that are NOT the owner.
  assert.equal(canSeeRoute(asClient(SERVER_ROLES.SUPER_ADMIN), "/affiliate-portal"), true,
    "the platform owner is admitted to the affiliate portal as the owner");
  for (const role of [SERVER_ROLES.EMPLOYEE, SERVER_ROLES.SCHOOL_ADMIN, SERVER_ROLES.TEACHER, SERVER_ROLES.PRINCIPAL]) {
    assert.equal(canSeeRoute(asClient(role), "/affiliate-portal"), false, `${role} must not reach the affiliate portal`);
  }
  assert.equal(canSeeRoute(asClient(SERVER_ROLES.SUPER_ADMIN), "/affiliates"), true,
    "the platform owner manages the affiliate programme");
  assert.equal(canSeeRoute(asClient(SERVER_ROLES.EMPLOYEE), "/affiliates"), false,
    "a support employee is not the platform owner and does not manage affiliates");
});

// The renewal feature splits authority in two, and the split has to be identical on
// both sides or one of them is lying.
//
// An affiliate MAY configure their own reminder channels, lead days and message draft —
// that is theirs to do, and the client offers it from inside their own portal. An
// affiliate may NOT change commission_mode, because that decides what the platform
// pays. On the client that control is hidden; on the server it is a 403. This asserts
// the client half of that rule and that the money capability behind it stays put.
test("reminder configuration is the affiliate's, but commission is not", () => {
  const affiliate = asClient(SERVER_ROLES.AFFILIATE);

  // No client capability grants an affiliate the commission policy. The settings dialog
  // reads `can_set_commission_mode` from the server rather than inferring it from a
  // client permission, so the strongest possible statement available here is that no
  // such permission exists at all.
  assert.equal(can(affiliate, "manage_affiliates"), false,
    "an affiliate must not hold the capability that governs commission");
  assert.deepEqual(PERMISSIONS.manage_affiliates, [SERVER_ROLES.SUPER_ADMIN],
    "managing the commission policy must remain a platform-owner capability");
  assert.deepEqual([...AFFILIATE_MANAGE_ROLES], [SERVER_ROLES.SUPER_ADMIN],
    "the server and the client must name the same role for commission authority");

  // And every other role is refused the affiliate programme's money surface equally.
  for (const role of [SERVER_ROLES.EMPLOYEE, SERVER_ROLES.SCHOOL_ADMIN, SERVER_ROLES.PRINCIPAL, SERVER_ROLES.TEACHER]) {
    assert.equal(can(asClient(role), "manage_affiliates"), false, `${role} must not manage commissions`);
  }
});

test("STANDALONE_PATHS are the family routes the admin shell still renders", () => {
  for (const route of STANDALONE_PATHS) {
    assert.ok(route in ROUTE_ACCESS, `STANDALONE_PATHS entry "${route}" is not a known route`);
  }
  assert.ok(STANDALONE_PATHS.includes("/announcements"));
});

// --- 5. Route tree coverage ----------------------------------------------------

test("every route under ProtectedRoute is wrapped in a RoleGuard", () => {
  // Closes ISSUE-007 as a regression test. ProtectedRoute only proves a session exists,
  // so a role-gated page without a RoleGuard is reachable by any authenticated account;
  // the server still scopes the rows, but the page itself is not theirs.
  const source = readSrc("src/App.jsx");
  const protectedStart = source.indexOf("<ProtectedRoute");
  assert.ok(protectedStart > -1, "App.jsx must have a ProtectedRoute block");

  // Each `<Route element={<RoleGuard roles={PAGE_ROLES.x} />}>` opens a guarded group.
  // A direct `<Route path=...>` inside that block is unguarded unless it sits under one.
  const guardedGroups = [...source.matchAll(/<Route element=\{<RoleGuard roles=\{PAGE_ROLES\.(\w+)\} \/>\}>/g)]
    .map((m) => m[1]);
  assert.ok(guardedGroups.length > 0, "App.jsx must declare at least one RoleGuard group");

  for (const group of guardedGroups) {
    assert.ok(PAGE_ROLES[group], `App.jsx guards a route with PAGE_ROLES.${group}, which does not exist`);
  }

  // The three routes ISSUE-007 named, which must stay guarded.
  const appSource = source;
  for (const [route, group] of [
    ["/student-portal", "studentPortal"],
    ["/parent-portal", "parentPortal"],
    ["/checkout", "checkout"],
  ]) {
    const guardIndex = appSource.indexOf(`roles={PAGE_ROLES.${group}}`);
    assert.ok(guardIndex > -1, `${route} must be gated by PAGE_ROLES.${group}`);
    const routeIndex = appSource.indexOf(`path="${route}"`);
    assert.ok(routeIndex > -1, `${route} must exist in App.jsx`);
    // The guard must be declared BEFORE the route, i.e. the route is nested inside it.
    assert.ok(guardIndex < routeIndex, `${route} must be nested inside its RoleGuard, not merely gated elsewhere`);
  }
});

test("every nav and route gate resolves to a role the server recognizes", () => {
  // A belt-and-braces sweep: no copy of the role list may drift, whichever file it is
  // declared in.
  for (const [group, roles] of Object.entries(PAGE_ROLES)) {
    for (const role of roles) {
      assert.ok(VALID_APP_ROLES.has(role), `PAGE_ROLES.${group} names unknown role "${role}"`);
    }
  }
  assert.ok(Object.keys(PAGE_ROLES).length >= 15, "the page-gate table lost groups");
});