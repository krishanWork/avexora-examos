import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSubdomain,
  assertSubdomainUsable,
  isReservedSubdomain,
} from "../lib/domainGuard.js";
import {
  APP_ROLES,
  VALID_APP_ROLES,
  PLATFORM_ROLES,
  EXAM_WORKFLOW_ROLES,
  EXAM_MATERIAL_ROLES,
  ENTITY_WRITE_ROLES,
  canWriteEntity,
  canReadAuditLog,
  canProvisionStudentLogins,
  PROVISION_STUDENT_LOGIN_ROLES,
  canProvisionRole,
  staffCreatableRoles,
  resolveStaffTenant,
  canUploadPurpose,
  canExtractRoster,
  canStartTrial,
  canRequestPlanChange,
  canApprovePlanChanges,
  PLAN_CHANGE_APPROVE_ROLES,
  TENANT_BILLING_FIELDS,
  canDeleteOwnAccount,
  resolveReadableTenantId,
  redactTenant,
  redactTenantBranding,
  TENANT_BRANDING_FIELDS,
  TENANT_PUBLIC_FIELDS,
  redactSecrets,
  SECRET_ENTITY_FIELDS,
  isSafeQueryValue,
  isExamWorkflow,
  isPlatform,
  isSuperAdmin,
  isEmailVerified,
  VERIFICATION_ALLOWED_PATHS,
  EMAIL_UNVERIFIED_RESPONSE,
  APP_ROLE_PRECEDENCE,
  ROLE_GROUPS,
  FAMILY_ROLES,
  STAFF_ROLES,
  AFFILIATE_ROLES,
  canSellAsAffiliate,
  canManageAffiliates,
  roleGroupOf,
  normalizeAppRoles,
  appRolesOf,
  primaryAppRole,
  validateAppRoleSet,
  rolesOf,
  roleOf,
  hasRole,
  hasAnyRole,
  canAnyProvisionRole,
  PROVISIONING_HIERARCHY,
  canAssignRoleSet,
  canProvisionRoleSet,
  canManageStaff,
  ROLE_ASSIGNMENT_HIERARCHY,
  staffAssignableRolesFor,
  staffCreatableRolesFor,
} from "../rbac.js";

// Every authorization decision in the app routes through server/rbac.js, so this
// suite is the regression net for the whole role model. It needs no database and
// no running server, which is the point: before this, there were zero
// authorization tests in `npm test` (server/test/ was 11 custom-domain files),
// so a role check could be removed and nothing would fail.

const asUser = (app_role, extra = {}) => ({ user: { app_role, _id: "u1", ...extra } });
// A multi-role actor, shaped the way the server reads one: `user` plus the
// canonical array, because every helper in rbac.js is called with a request.
const asRoles = (...app_roles) => ({ user: { app_roles, app_role: primaryAppRole({ app_roles }), _id: "u1" } });
const ALL_ROLES = [...VALID_APP_ROLES];

// --- Role vocabulary ----------------------------------------------------------

test("VALID_APP_ROLES is exactly the nine supported roles", () => {
  assert.equal(VALID_APP_ROLES.size, 9);
  for (const role of ALL_ROLES) assert.equal(typeof role, "string");
});

test("role sets partition sensibly and do not overlap unexpectedly", () => {
  assert.ok(PLATFORM_ROLES.has(APP_ROLES.SUPER_ADMIN));
  assert.ok(PLATFORM_ROLES.has(APP_ROLES.EMPLOYEE));
  // A family role must never be a platform or exam-workflow role, or a student
  // would inherit staff authorization the moment a set was edited.
  for (const family of ["student", "parent"]) {
    assert.ok(!PLATFORM_ROLES.has(family), `${family} must not be a platform role`);
    assert.ok(!EXAM_WORKFLOW_ROLES.has(family), `${family} must not drive the exam workflow`);
    assert.ok(!EXAM_MATERIAL_ROLES.has(family), `${family} must not see exam material`);
  }
  // An affiliate is a reseller, and the one thing it must never become is a
  // platform role. `platform()` short-circuits readScope() to the caller's
  // criteria untouched, so membership here is an unscoped read of every school on
  // the platform: every Student, Result, Attendance row and User document,
  // password hashes included. A reseller mints institutions and earns commission;
  // it needs no read access to anything.
  for (const affiliate of AFFILIATE_ROLES) {
    assert.ok(!PLATFORM_ROLES.has(affiliate), `${affiliate} must not be a platform role`);
    assert.ok(!EXAM_WORKFLOW_ROLES.has(affiliate), `${affiliate} must not drive the exam workflow`);
    assert.ok(!EXAM_MATERIAL_ROLES.has(affiliate), `${affiliate} must not see exam material`);
    assert.ok(!FAMILY_ROLES.has(affiliate), `${affiliate} must not be a family role`);
  }
  assert.ok(AFFILIATE_ROLES.has(APP_ROLES.AFFILIATE));
  // Every exam-workflow role is a platform-or-staff role that also sees material.
  for (const role of EXAM_WORKFLOW_ROLES) {
    assert.ok(EXAM_MATERIAL_ROLES.has(role), `${role} drives exams and must see material`);
  }
  // Teachers see exam material (they run exams) but do not drive the workflow.
  assert.ok(EXAM_MATERIAL_ROLES.has(APP_ROLES.TEACHER));
  assert.ok(!EXAM_WORKFLOW_ROLES.has(APP_ROLES.TEACHER));
});

test("actor predicates", () => {
  assert.equal(isSuperAdmin(asUser("super_admin")), true);
  assert.equal(isSuperAdmin(asUser("employee")), false);
  assert.equal(isPlatform(asUser("employee")), true);
  assert.equal(isPlatform(asUser("super_admin")), true);
  assert.equal(isPlatform(asUser("school_admin")), false);
  assert.equal(isExamWorkflow(asUser("super_admin")), true);
  assert.equal(isExamWorkflow(asUser("exam_coordinator")), true);
  assert.equal(isExamWorkflow(asUser("teacher")), false);
  assert.equal(isExamWorkflow(asUser("student")), false);
});

test("an unauthenticated or role-less actor satisfies nothing", () => {
  const anonymous = {};
  const roleless = { user: { _id: "u1" } };
  for (const req of [anonymous, roleless]) {
    assert.equal(isSuperAdmin(req), false);
    assert.equal(isPlatform(req), false);
    assert.equal(isExamWorkflow(req), false);
    assert.equal(canReadAuditLog(req), false);
    assert.equal(canDeleteOwnAccount(req), true, "non-platform is allowed; the route is auth-gated");
    assert.equal(canStartTrial(req), false);
    assert.equal(canUploadPurpose(req, "logo"), false);
    assert.equal(canExtractRoster(req), false);
    assert.equal(resolveReadableTenantId(req, "tenant-x"), null);
  }
});

// --- Entity write matrix ------------------------------------------------------

test("canWriteEntity fails closed for an unknown entity or verb", () => {
  for (const role of ALL_ROLES) {
    if (role === "super_admin") continue;
    assert.equal(canWriteEntity(asUser(role), "NoSuchEntity", "create"), false);
    assert.equal(canWriteEntity(asUser(role), "NoSuchEntity", "update"), false);
  }
  // An empty allowlist means super_admin only.
  for (const role of ALL_ROLES) {
    const expected = role === "super_admin";
    assert.equal(canWriteEntity(asUser(role), "Payment", "create"), expected, `Payment.create for ${role}`);
    assert.equal(canWriteEntity(asUser(role), "Lead", "delete"), expected, `Lead.delete for ${role}`);
  }
});

test("AuditLog is never writable through generic CRUD, not even by super_admin", () => {
  for (const role of ALL_ROLES) {
    for (const verb of ["create", "update", "delete"]) {
      assert.equal(canWriteEntity(asUser(role), "AuditLog", verb), false, `${role} ${verb}`);
    }
  }
});

test("User is never writable through generic CRUD by a non-super_admin", () => {
  for (const role of ALL_ROLES.filter((r) => r !== "super_admin")) {
    for (const verb of ["create", "update", "delete"]) {
      assert.equal(canWriteEntity(asUser(role), "User", verb), false, `${role} ${verb}`);
    }
  }
  // And the matrix itself records that User has no verb granted to anyone: role
  // changes go through assignUserRole, account creation through provisionUser.
  assert.deepEqual(ENTITY_WRITE_ROLES.User, { create: [], update: [], delete: [] });
});

test("students and parents can write nothing but their own assignment work", () => {
  // AssignmentSubmission is the one deliberate exception: a student must be able
  // to hand in their own work. A parent gets no write verb at all.
  for (const role of ["student", "parent"]) {
    for (const [entity, verbs] of Object.entries(ENTITY_WRITE_ROLES)) {
      for (const verb of Object.keys(verbs)) {
        if (entity === "AssignmentSubmission" && verb !== "delete" && role === "student") continue;
        assert.equal(canWriteEntity(asUser(role), entity, verb), false, `${role} must not ${verb} ${entity}`);
      }
    }
  }
  assert.equal(canWriteEntity(asUser("student"), "AssignmentSubmission", "delete"), false,
    "a student submits, but a staff member removes the record");
  assert.equal(canWriteEntity(asUser("parent"), "AssignmentSubmission", "create"), false);
});

test("teachers cannot create the academic records reserved for administrators", () => {
  const teacher = asUser("teacher");
  assert.equal(canWriteEntity(teacher, "Student", "create"), false);
  assert.equal(canWriteEntity(teacher, "Teacher", "create"), false);
  assert.equal(canWriteEntity(teacher, "SchoolClass", "create"), false);
  assert.equal(canWriteEntity(teacher, "Result", "create"), false);
  // A teacher does legitimately create exams, subjects and their own attendance.
  assert.equal(canWriteEntity(teacher, "Examination", "create"), true);
  assert.equal(canWriteEntity(teacher, "Subject", "create"), true);
  assert.equal(canWriteEntity(teacher, "Attendance", "create"), true);
});

test("a student may submit work but not grade it", () => {
  const student = asUser("student");
  assert.equal(canWriteEntity(student, "AssignmentSubmission", "create"), true);
  assert.equal(canWriteEntity(student, "Result", "create"), false);
  assert.equal(canWriteEntity(student, "AnswerKey", "create"), false);
  assert.equal(canWriteEntity(student, "Attendance", "create"), false);
});

test("exam_coordinator may run exams but not manage institution structure", () => {
  const coord = asUser("exam_coordinator");
  assert.equal(canWriteEntity(coord, "Examination", "create"), true);
  assert.equal(canWriteEntity(coord, "OMRSheet", "create"), true);
  assert.equal(canWriteEntity(coord, "Result", "create"), true);
  assert.equal(canWriteEntity(coord, "SchoolClass", "create"), false);
  assert.equal(canWriteEntity(coord, "Teacher", "create"), false);
});

test("a school administrator may edit the institution but may not write platform data", () => {
  const admin = asUser("school_admin");
  assert.equal(canWriteEntity(admin, "Tenant", "update"), true);
  assert.equal(canWriteEntity(admin, "Tenant", "create"), false);
  assert.equal(canWriteEntity(admin, "PlatformBranding", "create"), false);
  assert.equal(canWriteEntity(admin, "SubscriptionPlan", "create"), false);
});

// --- Audit log reads ----------------------------------------------------------

test("audit log reads: platform + school_admin only", () => {
  assert.equal(canReadAuditLog(asUser("super_admin")), true);
  assert.equal(canReadAuditLog(asUser("employee")), true);
  assert.equal(canReadAuditLog(asUser("school_admin")), true);
  for (const role of ["principal", "exam_coordinator", "teacher", "student", "parent"]) {
    assert.equal(canReadAuditLog(asUser(role)), false, `${role} must not read the audit log`);
  }
});

// --- Delegation hierarchy -----------------------------------------------------

test("role delegation follows the hierarchy and nobody delegates upward", () => {
  assert.equal(canProvisionRole("super_admin", "school_admin"), true);
  assert.equal(canProvisionRole("school_admin", "teacher"), true);
  assert.equal(canProvisionRole("school_admin", "principal"), true);
  assert.equal(canProvisionRole("principal", "student"), true);
  assert.equal(canProvisionRole("exam_coordinator", "parent"), true);

  // A principal cannot mint a peer principal or escalate to admin.
  assert.equal(canProvisionRole("principal", "principal"), false);
  assert.equal(canProvisionRole("principal", "school_admin"), false);
  // Nobody below the top can mint a platform role, not even super_admin.
  for (const role of ["school_admin", "principal", "exam_coordinator", "teacher", "student", "parent", "employee"]) {
    assert.equal(canProvisionRole(role, "super_admin"), false, `${role} must not create super_admin`);
    assert.equal(canProvisionRole(role, "employee"), false, `${role} must not create employee`);
  }
  // Leaf roles provision nothing at all.
  for (const role of ["teacher", "student", "parent", "employee"]) {
    for (const target of ALL_ROLES) {
      assert.equal(canProvisionRole(role, target), false, `${role} must not create ${target}`);
    }
  }
});

test("canProvisionRole rejects missing roles instead of defaulting", () => {
  assert.equal(canProvisionRole(null, "teacher"), false);
  assert.equal(canProvisionRole("school_admin", null), false);
  assert.equal(canProvisionRole(undefined, undefined), false);
  assert.equal(canProvisionRole("school_admin", "not_a_role"), false);
});

test("school_admin and principal can appoint an exam_coordinator", () => {
  // The /staff screen offers exam_coordinator to both. The server has to agree:
  // the page used to carry its own copy of this map which omitted the role
  // entirely, so the UI and PROVISIONING_HIERARCHY disagreed about who a tenant
  // could staff. One of the two is the authority, and it is the server.
  assert.equal(canProvisionRole("school_admin", "exam_coordinator"), true);
  assert.equal(canProvisionRole("principal", "exam_coordinator"), true);
  // Still not upward: a coordinator cannot mint a peer, and a teacher nothing at all.
  assert.equal(canProvisionRole("exam_coordinator", "exam_coordinator"), false);
  assert.equal(canProvisionRole("exam_coordinator", "principal"), false);
  assert.equal(canProvisionRole("teacher", "exam_coordinator"), false);
});

test("super_admin holds the full tenant-staff reach, matching its assignUserRole bypass", () => {
  // assignUserRole() exempted super_admin outright while provisionUser() and both
  // invite paths called canProvisionRole() unconditionally. That disagreement is
  // why the /staff screen offered super_admin a single option — "School
  // Administrator" — and failed on submit besides. The matrix now states it once.
  for (const role of ["school_admin", "principal", "exam_coordinator", "teacher"]) {
    assert.equal(canProvisionRole("super_admin", role), true, `super_admin must be able to appoint a ${role}`);
  }
  // Still no family accounts, which keep arriving via provisionAutoLogins.
  assert.equal(canProvisionRole("super_admin", "student"), false);
  assert.equal(canProvisionRole("super_admin", "parent"), false);
  // And the matrix is now the only place that says so: a role every other caller
  // treats as platform-only must not be reachable here either.
  for (const role of ["employee"]) {
    assert.equal(canProvisionRole("super_admin", role), false, `super_admin must not create ${role} through the hierarchy`);
  }
});

test("the staff screen offers principal, exam_coordinator and teacher — nothing else", () => {
  // super_admin and school_admin staff the same three; a principal staffs the two
  // beneath it. This is the exact dropdown a user sees.
  assert.deepEqual(staffCreatableRoles("super_admin"), ["principal", "exam_coordinator", "teacher"]);
  assert.deepEqual(staffCreatableRoles("school_admin"), ["principal", "exam_coordinator", "teacher"]);
  assert.deepEqual(staffCreatableRoles("principal"), ["exam_coordinator", "teacher"]);
  // A coordinator staffs nobody, which is what hides the create form for them.
  assert.deepEqual(staffCreatableRoles("exam_coordinator"), []);
  for (const role of ["teacher", "student", "parent", "employee"]) {
    assert.deepEqual(staffCreatableRoles(role), [], `${role} must be offered no roles`);
  }
  assert.deepEqual(staffCreatableRoles(null), []);
  assert.deepEqual(staffCreatableRoles("not_a_role"), []);
  // Structural guarantee, so a future hierarchy edit cannot leak a family role or
  // the institution's administrator back onto the screen without failing here.
  for (const role of ALL_ROLES) {
    for (const target of staffCreatableRoles(role)) {
      assert.notEqual(target, "student", `${role} must not be offered the student role`);
      assert.notEqual(target, "parent", `${role} must not be offered the parent role`);
      assert.notEqual(target, "school_admin", `${role} must not be offered the administrator role`);
    }
  }
});

test("a role ARRAY resolves to the same roles a user document does", () => {
  // rolesOf(req) returns an array, and every provisionAutoLogins() call site passes
  // exactly that. appRolesOf() used to read only `app_roles`/`app_role`, so an array
  // normalized to [] — which made provisionAutoLogins() fail its delegation check on
  // every create and every update and silently stop minting portal logins. The
  // Student record was still written, so the only symptom was a family that had been
  // admitted and could not sign in.
  assert.deepEqual(appRolesOf(["school_admin"]), ["school_admin"]);
  assert.deepEqual(appRolesOf(["teacher", "exam_coordinator"]), ["exam_coordinator", "teacher"]);
  assert.deepEqual(appRolesOf([]), []);

  // The gate provisionAutoLogins() actually runs, on the shape its callers pass.
  assert.equal(canAnyProvisionRole(appRolesOf(["school_admin"]), "student"), true);
  assert.equal(canAnyProvisionRole(appRolesOf(["principal"]), "parent"), true);
  // A role-less actor still fails closed rather than being read as an empty grant.
  assert.equal(canAnyProvisionRole(appRolesOf([]), "student"), false);
  assert.equal(canAnyProvisionRole(appRolesOf(["teacher"]), "student"), false);

  // And the array and document forms agree for the same account.
  for (const role of [...VALID_APP_ROLES]) {
    assert.deepEqual(
      appRolesOf([role]),
      appRolesOf({ app_role: role }),
      `array and document forms disagreed for ${role}`
    );
  }
});

test("backfilling student portal logins is held to the student write matrix", () => {
  // A Student row and a portal login are separate documents: the login is minted
  // as a side effect of admitting a student, so a roster written by any other
  // path can leave a family that cannot sign in. The backfill both rewrites the
  // roster row (it generates a missing address) and mints a User, so it is
  // measured against the same set as a student edit — derived, never restated.
  assert.deepEqual(
    [...PROVISION_STUDENT_LOGIN_ROLES].sort(),
    [...ENTITY_WRITE_ROLES.Student.update].sort(),
    "the gate must follow the student write matrix"
  );

  for (const role of ["super_admin", "school_admin", "exam_coordinator"]) {
    assert.equal(canProvisionStudentLogins({ user: { app_role: role } }), true, `${role} must be able to backfill logins`);
  }
  // The principal is the case this exists to settle: the minting hierarchy
  // authorizes it, but ENTITY_WRITE_ROLES.Student does not, so the button was
  // rendering for a role the server refuses on every click.
  for (const role of ["principal", "teacher", "student", "parent", "employee"]) {
    assert.equal(canProvisionStudentLogins({ user: { app_role: role } }), false, `${role} must not backfill logins`);
  }
  // Union over held roles, like every other capability check.
  assert.equal(
    canProvisionStudentLogins({ user: { app_role: "teacher", app_roles: ["teacher", "exam_coordinator"] } }),
    true,
    "a teacher who also coordinates examinations keeps the coordinator's reach"
  );
  // A principal who also coordinates examinations is admitted, because the
  // coordinator role is genuinely theirs — not because principal was widened.
  assert.equal(
    canProvisionStudentLogins({ user: { app_role: "principal", app_roles: ["principal", "exam_coordinator"] } }),
    true
  );
  assert.equal(canProvisionStudentLogins({ user: {} }), false, "an unauthenticated actor is refused");
});

test("hierarchy keeps the family roles that portal login provisioning depends on", () => {
  // provisionAutoLogins() gates creating a student/parent portal login on
  // canProvisionRole(creatorRole, "student"/"parent") and runs on every Student
  // creation. Trimming those two out of the hierarchy to tidy the staff screen
  // would silently break student and parent portal onboarding for every role
  // above them — which is why the staff surface is derived by subtraction
  // (staffCreatableRoles) instead of by deleting entries here.
  for (const role of ["school_admin", "principal", "exam_coordinator"]) {
    assert.equal(canProvisionRole(role, "student"), true, `${role} must be able to provision a student login`);
    assert.equal(canProvisionRole(role, "parent"), true, `${role} must be able to provision a parent login`);
  }
});

// --- Staff tenant resolution -----------------------------------------------------

test("resolveStaffTenant pins a school_admin to its own institution", () => {
  const admin = asUser("school_admin", { tenant_id: "tenantA" });
  // No tenant_id supplied: its own, always.
  assert.deepEqual(resolveStaffTenant(admin, undefined), { tenantId: "tenantA", error: null });
  assert.deepEqual(resolveStaffTenant(admin, null), { tenantId: "tenantA", error: null });
  assert.deepEqual(resolveStaffTenant(admin, ""), { tenantId: "tenantA", error: null });
  assert.deepEqual(resolveStaffTenant(admin, "  "), { tenantId: "tenantA", error: null });
  // Its own id restated is fine.
  assert.deepEqual(resolveStaffTenant(admin, "tenantA"), { tenantId: "tenantA", error: null });
});

test("resolveStaffTenant refuses a cross-tenant attempt with 404", () => {
  // 404, not 403: the answer must not confirm that the other institution exists.
  // Same code assignUserRole uses for a cross-tenant target.
  const admin = asUser("school_admin", { tenant_id: "tenantA" });
  const refused = resolveStaffTenant(admin, "tenantB");
  assert.equal(refused.tenantId, null);
  assert.deepEqual(refused.error, { status: 404, error: "Institution not found" });
});

test("resolveStaffTenant refuses a tenant role holder that has no institution", () => {
  // "No tenant" is not on its own authorization: a tenant-less account is one that
  // can authenticate but reach no school's data.
  const orphan = asUser("school_admin", { tenant_id: null });
  const refused = resolveStaffTenant(orphan, undefined);
  assert.equal(refused.tenantId, null);
  assert.deepEqual(refused.error, { status: 403, error: "No tenant associated" });
  // Naming an institution does not rescue it — the pin is the account's own.
  const stillRefused = resolveStaffTenant(orphan, "tenantA");
  assert.deepEqual(stillRefused.error, { status: 403, error: "No tenant associated" });
});

test("resolveStaffTenant lets super_admin act in any institution", () => {
  // super_admin belongs to no institution, which is why /staff gives it a picker.
  const owner = asUser("super_admin", { tenant_id: null });
  assert.deepEqual(resolveStaffTenant(owner, "tenantB"), { tenantId: "tenantB", error: null });
  // Nothing selected: null means "no scoping", the platform-wide read the
  // institutions console already depends on.
  assert.deepEqual(resolveStaffTenant(owner, undefined), { tenantId: null, error: null });
  // If it does hold a tenant, that is the fallback.
  const ownerWithTenant = asUser("super_admin", { tenant_id: "tenantA" });
  assert.deepEqual(resolveStaffTenant(ownerWithTenant, undefined), { tenantId: "tenantA", error: null });
  assert.deepEqual(resolveStaffTenant(ownerWithTenant, "tenantB"), { tenantId: "tenantB", error: null });
});

// --- The "view as" scope ------------------------------------------------------
//
// A platform owner who is "viewing" a school is still a super_admin, so every
// unguarded answer above would be the platform-wide one. The scope is what makes
// the banner on screen true.

test("a view-as scope resolves to the named institution when nothing is requested", () => {
  const scoped = { ...asUser("super_admin", { tenant_id: null }), viewAs: { tenant_id: "tenantA" } };
  // The empty request is the actual bug: the client overlay hides super_admin from
  // the platform-owner check on /staff, so no tenant_id is sent, and the unscoped
  // path answered with every school's staff.
  assert.deepEqual(resolveStaffTenant(scoped, undefined), { tenantId: "tenantA", error: null });
  assert.deepEqual(resolveStaffTenant(scoped, null), { tenantId: "tenantA", error: null });
  assert.deepEqual(resolveStaffTenant(scoped, ""), { tenantId: "tenantA", error: null });
  // The same id restated is not a conflict.
  assert.deepEqual(resolveStaffTenant(scoped, "tenantA"), { tenantId: "tenantA", error: null });
});

test("a view-as scope refuses to be widened to another institution", () => {
  const scoped = { ...asUser("super_admin", { tenant_id: null }), viewAs: { tenant_id: "tenantA" } };
  // 404 for the same reason as any cross-tenant refusal: the reply must not
  // confirm that tenantB exists.
  const refused = resolveStaffTenant(scoped, "tenantB");
  assert.equal(refused.tenantId, null);
  assert.deepEqual(refused.error, { status: 404, error: "Institution not found" });
});

test("a view-as scope binds a school_admin to the school it is viewing, not its own", () => {
  // Unreachable through the middleware, which only attaches a scope for a
  // super_admin — and that is the point of asserting it here. If the gate is ever
  // loosened, this documents what the scope would then mean, and the middleware
  // test in the live suite is what would catch it.
  const scoped = { ...asUser("school_admin", { tenant_id: "tenantA" }), viewAs: { tenant_id: "tenantB" } };
  assert.deepEqual(resolveStaffTenant(scoped, undefined), { tenantId: "tenantB", error: null });
  assert.deepEqual(resolveStaffTenant(scoped, "tenantA").error, { status: 404, error: "Institution not found" });
});

// --- Upload authorization -----------------------------------------------------

test("family roles and the platform employee cannot upload anything", () => {
  // The logo is served from a public route and rendered on the login page, the
  // marketing navbar/footer and all three portals: an ungated upload let a
  // student deface the public site. `employee` is a platform operator, not
  // institution staff, so it owns no upload either.
  for (const role of ["student", "parent", "employee"]) {
    for (const purpose of ["logo", "import", "omr"]) {
      assert.equal(canUploadPurpose(asUser(role), purpose), false, `${role} must not upload ${purpose}`);
    }
  }
});

test("a teacher uploads nothing", () => {
  // A teacher can create exams and mark work, but none of the three upload
  // buckets is theirs: branding, roster import and OMR are all administrative.
  for (const purpose of ["logo", "import", "omr"]) {
    assert.equal(canUploadPurpose(asUser("teacher"), purpose), false, purpose);
  }
});

test("upload purposes match the write permission each one feeds", () => {
  const admin = asUser("school_admin");
  assert.equal(canUploadPurpose(admin, "logo"), true, "white-label branding");
  assert.equal(canUploadPurpose(admin, "import"), true, "roster import -> Student.create");
  assert.equal(canUploadPurpose(admin, "omr"), true, "OMR sheet -> OMRSheet.create");

  // exam_coordinator may import students and upload OMR sheets, but does not
  // own the institution's branding.
  const coord = asUser("exam_coordinator");
  assert.equal(canUploadPurpose(coord, "import"), true);
  assert.equal(canUploadPurpose(coord, "omr"), true);
  assert.equal(canUploadPurpose(coord, "logo"), false);

  // A principal runs OMR but cannot import a roster.
  const principal = asUser("principal");
  assert.equal(canUploadPurpose(principal, "omr"), true);
  assert.equal(canUploadPurpose(principal, "import"), false);

  // super_admin is the implicit owner of every purpose.
  for (const purpose of ["logo", "import", "omr"]) {
    assert.equal(canUploadPurpose(asUser("super_admin"), purpose), true);
  }
});

test("an unknown upload purpose is denied", () => {
  for (const role of ALL_ROLES) {
    assert.equal(canUploadPurpose(asUser(role), "something_new"), false, `${role}`);
  }
});

// --- Roster extraction --------------------------------------------------------

test("only roles that may create Students may run the extraction integration", () => {
  for (const role of ["super_admin", "school_admin", "exam_coordinator"]) {
    assert.equal(canExtractRoster(asUser(role)), true, role);
  }
  // principal and teacher can view students but not create them, so they cannot
  // drive the parser that previews a student import.
  for (const role of ["principal", "teacher", "student", "parent", "employee"]) {
    assert.equal(canExtractRoster(asUser(role)), false, role);
  }
});

// --- Trial start --------------------------------------------------------------

test("starting a trial is restricted to platform roles without a tenant", () => {
  // The trial self-promotes the caller to school_admin of a brand-new tenant, so
  // "has no tenant yet" alone is not an authorization check: a tenant-less
  // invited account of any role could otherwise claim an institution.
  for (const role of ["super_admin", "employee"]) {
    assert.equal(canStartTrial(asUser(role)), true, role);
  }
  for (const role of ["school_admin", "principal", "exam_coordinator", "teacher", "student", "parent"]) {
    assert.equal(canStartTrial(asUser(role)), false, role);
  }
});

// --- Self-deletion ------------------------------------------------------------

test("platform accounts cannot delete themselves through the self-service endpoint", () => {
  assert.equal(canDeleteOwnAccount(asUser("super_admin")), false);
  assert.equal(canDeleteOwnAccount(asUser("employee")), false);
  for (const role of ["school_admin", "principal", "exam_coordinator", "teacher", "student", "parent"]) {
    assert.equal(canDeleteOwnAccount(asUser(role)), true, role);
  }
});

// --- Tenant resolution --------------------------------------------------------

test("a tenant is readable only by its own members; super_admin may target any", () => {
  const own = { tenant_id: "tenant-a" };
  const other = { tenant_id: "tenant-b" };

  // A school administrator asking for another institution still gets their own.
  assert.equal(resolveReadableTenantId(asUser("school_admin", own), "tenant-b"), "tenant-a");
  // Even a student cannot select a different tenant.
  assert.equal(resolveReadableTenantId(asUser("student", own), "tenant-b"), "tenant-a");
  // An employee with no institution has no tenant to read.
  assert.equal(resolveReadableTenantId(asUser("employee"), "tenant-b"), null);
  // super_admin keeps the cross-tenant read the institutions console needs, and
  // falls back to its own tenant when none is specified.
  assert.equal(resolveReadableTenantId(asUser("super_admin"), "tenant-b"), "tenant-b");
  assert.equal(resolveReadableTenantId(asUser("super_admin", own), undefined), "tenant-a");
});

// --- Response redaction --------------------------------------------------------

const TENANT_DOC = {
  _id: "t1",
  name: "Oakridge Global Academy",
  subdomain: "oakridge",
  status: "active",
  primary_color: "#7C3AED",
  logo_url: "https://cdn.example/logo.png",
  student_limit: 500,
  student_default_password: "Welcome@123",
  // A field that was never allowlisted must not become readable by default.
  some_future_integration_secret: "hunter2",
};

// --- Public branding (unauthenticated) ----------------------------------------

// The unauthenticated publicSite/branding branch. It used to answer with
// `out(tenant)`, a raw spread, before the auth middleware — so an anonymous
// caller who guessed a school name received the whole Tenant document including
// student_default_password. These tests pin the fixed behaviour.
test("public branding never exposes the portal default password or a secret", () => {
  const pub = redactTenantBranding(TENANT_DOC);
  assert.equal(pub.name, "Oakridge Global Academy");
  assert.equal(pub.subdomain, "oakridge");
  assert.equal(pub.primary_color, "#7C3AED");
  // The credential and the non-allowlisted field are both gone.
  assert.equal(pub.student_default_password, undefined);
  assert.equal(pub.some_future_integration_secret, undefined);
  // Identity is required: Login.jsx scopes the form to brand.id.
  assert.equal(pub._id, "t1");
  assert.equal(redactTenantBranding(null), null);
});

test("TENANT_BRANDING_FIELDS is a strict subset of TENANT_PUBLIC_FIELDS and secret-free", () => {
  // The anonymous payload must never be able to widen. Because it is declared as
  // a subset, a field added to the public list later cannot become public by
  // omission here, and nothing secret can enter it.
  for (const field of TENANT_BRANDING_FIELDS) {
    assert.ok(TENANT_PUBLIC_FIELDS.includes(field), `${field} must be a public tenant field`);
    assert.ok(!SECRET_ENTITY_FIELDS.includes(field), `${field} must not be a secret field`);
  }
  assert.ok(!TENANT_BRANDING_FIELDS.includes("student_default_password"));
  // Plan/entitlement and DNS-verification metadata are for authenticated tenant
  // members, not anonymous visitors.
  for (const field of ["plan_name", "subscription_plan_id", "student_limit", "hosting_verification", "status"]) {
    assert.ok(!TENANT_BRANDING_FIELDS.includes(field), `${field} must stay off the public payload`);
  }
  // Identity is added separately by redactTenantBranding, not via the field list.
  assert.ok(!TENANT_BRANDING_FIELDS.includes("_id") && !TENANT_BRANDING_FIELDS.includes("id"));
});

test("public branding cannot be widened by a role", () => {
  // redactTenantBranding takes no request and consults no role, so no caller —
  // not even super_admin — gets the credential through the public endpoint. The
  // administrative read remains the only path, via redactTenant.
  assert.equal(redactTenantBranding(TENANT_DOC).student_default_password, undefined);
  assert.equal(redactTenant(TENANT_DOC, asUser("super_admin")).student_default_password, "Welcome@123");
});

// --- Portal subdomain identity -------------------------------------------------

test("normalizeSubdomain produces a valid DNS label or null", () => {
  assert.equal(normalizeSubdomain("Oakridge Global Academy"), "oakridge-global-academy");
  assert.equal(normalizeSubdomain("  St Xavier's  "), "st-xavier-s");
  assert.equal(normalizeSubdomain("a--b"), "a-b");
  assert.equal(normalizeSubdomain("--lead--"), "lead");
  // The previous inline slug produced "" for these, and an empty subdomain
  // matches the branding lookup's `^$` regex.
  assert.equal(normalizeSubdomain("!!!"), null);
  assert.equal(normalizeSubdomain("   "), null);
  assert.equal(normalizeSubdomain(""), null);
  assert.equal(normalizeSubdomain(null), null);
  assert.equal(normalizeSubdomain(undefined), null);
  // Truncates to the DNS label limit rather than being refused, and the result
  // never ends on a hyphen. (The register path then persists the truncated slug;
  // overlong *input* is only refused when supplied as an explicit subdomain.)
  const long = normalizeSubdomain("x".repeat(80));
  assert.equal(long.length, 63);
  assert.equal(long.endsWith("-"), false);
  // Truncation may land on a hyphen, which is then stripped — so the result is
  // always a valid label, possibly one character shorter than the limit.
  const cut = normalizeSubdomain(`${"a".repeat(62)}-tail`);
  assert.equal(cut, "a".repeat(62));
  assert.equal(cut.length, 62);
  assert.equal(cut.endsWith("-"), false);
});

test("assertSubdomainUsable rejects unusable, overlong and reserved subdomains", () => {
  assert.equal(assertSubdomainUsable("oakridge"), "oakridge");
  // 63 is the DNS label limit and must be accepted; only 64 is refused.
  assert.equal(assertSubdomainUsable("x".repeat(63)), "x".repeat(63));
  const cases = [
    [null, 400],
    ["", 400],
    ["x".repeat(64), 400],
    ["-lead", 400],
    ["lead-", 400],
    ["Lead", 400],
    ["www", 409],
    ["api", 409],
    ["admin", 409],
    ["login", 409],
  ];
  for (const [value, status] of cases) {
    assert.throws(
      () => assertSubdomainUsable(value),
      (err) => err.statusCode === status,
      `expected ${JSON.stringify(value)} to fail with ${status}`
    );
  }
  assert.equal(isReservedSubdomain("WWW"), true, "reserved check is case-insensitive");
  assert.equal(isReservedSubdomain("oakridge"), false);
});

test("the shared portal default password is visible only to the roles that can write it", () => {
  // ENTITY_WRITE_ROLES.Tenant.update is school_admin; read access must not
  // exceed write access on a credential.
  assert.equal(ENTITY_WRITE_ROLES.Tenant.update.includes(APP_ROLES.SCHOOL_ADMIN), true);
  assert.equal(canWriteEntity(asUser("school_admin"), "Tenant", "update"), true);

  for (const role of ["super_admin", "school_admin"]) {
    assert.equal(redactTenant(TENANT_DOC, asUser(role)).student_default_password, "Welcome@123", role);
  }
  for (const role of ["employee", "principal", "exam_coordinator", "teacher", "student", "parent"]) {
    assert.equal(redactTenant(TENANT_DOC, asUser(role)).student_default_password, undefined, role);
  }
});

test("Tenant redaction is an allowlist, so unknown fields never leak", () => {
  const forStudent = redactTenant(TENANT_DOC, asUser("student"));
  assert.equal(forStudent.name, "Oakridge Global Academy");
  assert.equal(forStudent.primary_color, "#7C3AED");
  assert.equal(forStudent.some_future_integration_secret, undefined);
  // Identity is re-attached by the serializer and must survive the allowlist, or
  // the client has no id to address the Tenant by.
  assert.equal(forStudent._id, "t1");
  // A raw document carries only _id; `id` is added by out() before redaction and
  // is preserved when present.
  assert.equal(forStudent.id, undefined);
  assert.equal(redactTenant({ ...TENANT_DOC, id: "t1" }, asUser("student")).id, "t1");

  assert.equal(redactTenant(TENANT_DOC, asUser("employee")).student_default_password, undefined);
  assert.equal(redactTenant(TENANT_DOC, { user: {} }).student_limit, 500);
  assert.equal(redactTenant(null, asUser("school_admin")), null);
});

// --- Client compatibility -----------------------------------------------------

test("public branding still serves every field the login and marketing pages read", () => {
  // The branding endpoint is consumed by useTenantDomain (MarketingLayout, Login)
  // and AuthLayout. If a field is dropped here the institution-branded login page
  // silently falls back to platform branding, so the contract is pinned rather
  // than left to the allowlist's current contents.
  const pub = redactTenantBranding(TENANT_DOC);
  // Login.jsx: brand.id / brand._id scopes the form to an institution.
  assert.ok(pub.id !== undefined || pub._id !== undefined, "identity is required");
  // Login.jsx: domainBrand.subdomain, domainBrand.custom_domain.
  assert.equal(pub.subdomain, "oakridge");
  // AuthLayout.jsx: brand.logo_url, brand.name, brand.primary_color.
  assert.equal(pub.logo_url, "https://cdn.example/logo.png");
  assert.equal(pub.name, "Oakridge Global Academy");
  assert.equal(pub.primary_color, "#7C3AED");
});

test("redactSecrets must not run before redactTenant on a Tenant", () => {
  // This is an ordering hazard, so it is pinned by a test rather than a comment:
  // student_default_password is listed in SECRET_ENTITY_FIELDS, so present() that
  // did redactSecrets(out(doc)) first would strip the field before redactTenant
  // could re-allow it, and the school_admin who set it could never read it back.
  const admin = asUser("school_admin");
  assert.equal(redactSecrets(TENANT_DOC).student_default_password, undefined);
  assert.equal(redactTenant(TENANT_DOC, admin).student_default_password, "Welcome@123");
});

test("redactSecrets strips every credential field", () => {
  // Built from the list rather than hand-listed, so a secret added to
  // SECRET_ENTITY_FIELDS is covered here automatically. The previous version
  // enumerated five fields inline and passed unchanged after
  // email_verification_token was added — a test that cannot fail when the thing
  // it guards grows.
  const user = {
    _id: "u1",
    email: "a@b.com",
    must_change_password: true,
    email_verified: false,
  };
  for (const field of SECRET_ENTITY_FIELDS) user[field] = `secret-${field}`;

  const clean = redactSecrets(user);
  for (const field of SECRET_ENTITY_FIELDS) {
    assert.equal(clean[field], undefined, `${field} must be stripped`);
  }
  // The email-verification pair specifically: a holder of this token can flip an
  // account out of the unverified state, so it must never be readable back.
  assert.equal(clean.email_verification_token, undefined);
  assert.equal(clean.email_verification_expires_at, undefined);
  // Non-secret fields survive: this is a redaction, not a replacement. The
  // verification *state* is deliberately readable — the client needs it to render
  // the right screen.
  assert.equal(clean.email, "a@b.com");
  assert.equal(clean.must_change_password, true);
  assert.equal(clean.email_verified, false);
  // The input is not mutated.
  assert.equal(user.password_hash, "secret-password_hash");
  assert.equal(redactSecrets(null), null);
});

test("SECRET_ENTITY_FIELDS is the closed set the User write guard refuses", () => {
  // The generic User PATCH guard rejects a body containing any of these, so the
  // list is a security boundary, not just a serializer concern: every credential
  // field must be in it or it becomes writable through the entity API.
  for (const field of [
    "password_hash",
    "reset_password_token",
    "reset_password_expires_at",
    "invite_token",
    "invite_expires_at",
    "student_default_password",
  ]) {
    assert.ok(SECRET_ENTITY_FIELDS.includes(field), `${field} must be guarded`);
  }
  // It must not drift into ordinary profile data, or editing a name would 403.
  for (const field of ["email", "full_name", "phone", "app_role", "tenant_id"]) {
    assert.ok(!SECRET_ENTITY_FIELDS.includes(field), `${field} is not a credential field`);
  }
});

// --- Query safety --------------------------------------------------------------

test("client filters may use equality but never Mongo operators", () => {
  // Allowed: the shapes the filter API legitimately needs.
  assert.equal(isSafeQueryValue("published"), true);
  assert.equal(isSafeQueryValue(42), true);
  assert.equal(isSafeQueryValue(true), true);
  assert.equal(isSafeQueryValue(null), true);
  assert.equal(isSafeQueryValue({ $in: ["a", "b"] }), true);
  assert.equal(isSafeQueryValue({ $ne: "x" }), true);
  assert.equal(isSafeQueryValue({ $eq: "x" }), true);

  // Rejected: anything that could widen a predicate readScope already scoped.
  assert.equal(isSafeQueryValue({ $or: [{ tenant_id: "other" }] }), false);
  assert.equal(isSafeQueryValue({ $where: "this.password_hash" }), false);
  assert.equal(isSafeQueryValue({ $regex: ".*" }), false);
  assert.equal(isSafeQueryValue({ $ne: "a", $gt: "b" }), false);
  assert.equal(isSafeQueryValue({ $expr: { $gt: ["$a", "$b"] } }), false);
  assert.equal(isSafeQueryValue([1, 2]), true, "an array is a literal, not an operator");
});

// --- Email verification ----------------------------------------------------------

test("only an explicit email_verified:false blocks; absence means verified", () => {
  // This default is the difference between a safe rollout and a total lockout.
  // Every account that predates the feature has no email_verified field, so
  // treating absence as unverified would lock out every existing user on the
  // deploy that introduces this check.
  assert.equal(isEmailVerified({ email_verified: true }), true);
  assert.equal(isEmailVerified({ email_verified: false }), false);
  assert.equal(isEmailVerified({}), true, "no field at all must count as verified");
  assert.equal(isEmailVerified({ app_role: "school_admin" }), true, "legacy document shape");
  assert.equal(isEmailVerified({ email_verified: null }), true, "null is not an explicit false");
  assert.equal(isEmailVerified({ email_verified: 0 }), true, "0 !== false under ===");
  assert.equal(isEmailVerified(null), true, "no session is not a blocked session");
  assert.equal(isEmailVerified(undefined), true);
});

test("verification is orthogonal to role: it withholds access, it never grants it", () => {
  // A verified super_admin is still governed by the matrix, and an unverified
  // school_admin does not become more capable.
  const unverifiedAdmin = { email_verified: false, app_role: "school_admin", tenant_id: "t1" };
  assert.equal(isEmailVerified(unverifiedAdmin), false);
  assert.equal(canWriteEntity(asUser("school_admin"), "Tenant", "update"), true);
  assert.equal(isEmailVerified({ email_verified: true, app_role: "student" }), true);
  assert.equal(canWriteEntity(asUser("student"), "Student", "update"), false);
  // Verification is not a role and must not be settable through the role path.
  // VALID_APP_ROLES is the Set that gates every role write (index.js:879, 3580,
  // 4635) and what /auth/me trusts, so a verification state reaching it would
  // be treated as a role.
  assert.equal(VALID_APP_ROLES.has("email_verified"), false);
  assert.equal(VALID_APP_ROLES.has("verified"), false);
  assert.equal(
    Object.values(APP_ROLES).includes("email_verified"),
    false,
    "verification state is not one of the role constants"
  );
  assert.equal(VALID_APP_ROLES.size, 9, "still exactly the nine roles");
});

test("the verification exemption list is explicit, minimal and closed", () => {
  // Everything an unverified session needs in order to BECOME verified...
  for (const path of [
    "/api/auth/me",
    "/api/auth/verify-email",
    "/api/auth/resend-verification",
    "/api/auth/reset-password-request",
    "/api/auth/reset-password",
  ]) {
    assert.ok(VERIFICATION_ALLOWED_PATHS.has(path), `${path} must be reachable while unverified`);
  }
  // ...and nothing that would hand an unverified account product access.
  // Each of these is a real route that would otherwise be a way around the gate.
  for (const path of [
    "/api/entities/Student",
    "/api/entities/User/filter",
    "/api/upload",
    "/api/files/anything.pdf",
    "/api/users/invite",
    "/api/users/provision",
    "/api/functions/manageStaff",
    "/api/functions/startFreeTrial",
    "/api/functions/logAudit",
    "/api/functions/publicSite",
    "/api/leads",
  ]) {
    assert.equal(VERIFICATION_ALLOWED_PATHS.has(path), false, `${path} must NOT be exempt`);
  }
  // Deliberate omission, asserted so a future "just add it" change is visible.
  assert.equal(
    VERIFICATION_ALLOWED_PATHS.has("/api/auth/change-password"),
    false,
    "self-registration chose its own password; every other creation path is verified by construction"
  );
  // The list is an allowlist, so an unknown path is covered by default.
  assert.equal(VERIFICATION_ALLOWED_PATHS.has("/api/some-future-route"), false);
});

test("the blocked response carries a code the client can switch on", () => {
  // Matches the NO_ASSIGNED_ROLE / MUST_CHANGE_PASSWORD convention: the frontend
  // branches on `code`, never on the human-readable message.
  assert.equal(EMAIL_UNVERIFIED_RESPONSE.status, 403);
  assert.equal(EMAIL_UNVERIFIED_RESPONSE.code, "EMAIL_UNVERIFIED");
  assert.ok(EMAIL_UNVERIFIED_RESPONSE.error);
  assert.equal(/EMAIL_UNVERIFIED/.test(JSON.stringify(EMAIL_UNVERIFIED_RESPONSE)), true);
});

test("the verification token pair is secret, the verification state is not", () => {
  assert.ok(SECRET_ENTITY_FIELDS.includes("email_verification_token"));
  assert.ok(SECRET_ENTITY_FIELDS.includes("email_verification_expires_at"));
  assert.equal(
    SECRET_ENTITY_FIELDS.includes("email_verified"),
    false,
    "the client must be able to read the state to render the verify screen"
  );
});


// --- Multi-role model ----------------------------------------------------------
//
// These cover the two rules the whole feature rests on: CAPABILITY is the union,
// SCOPE is the primary role. If either silently regressed, a teacher/exam
// coordinator pair would either lose one of its jobs or gain the other's reach.

test("app_roles is canonical and app_role is only a fallback for pre-migration documents", () => {
  const canonical = { app_roles: ["teacher", "exam_coordinator"], app_role: "student" };
  // The array wins outright: the mirror is not a second opinion.
  assert.deepEqual(normalizeAppRoles(canonical), ["exam_coordinator", "teacher"]);
  assert.equal(primaryAppRole(canonical), "exam_coordinator");

  // A document predating the field authorizes exactly as it did before, which is
  // what makes the deploy order safe.
  assert.deepEqual(normalizeAppRoles({ app_role: "teacher" }), ["teacher"]);
  // An empty array is treated as absent rather than as "no roles".
  assert.deepEqual(normalizeAppRoles({ app_roles: [], app_role: "teacher" }), ["teacher"]);
  assert.deepEqual(normalizeAppRoles({}), []);
  assert.deepEqual(normalizeAppRoles(null), []);
});

test("roles are ordered by precedence, so the primary role is the widest one held", () => {
  assert.deepEqual(normalizeAppRoles({ app_roles: ["teacher", "exam_coordinator"] }), [
    APP_ROLES.EXAM_COORDINATOR,
    APP_ROLES.TEACHER,
  ]);
  assert.deepEqual(normalizeAppRoles({ app_roles: ["parent", "student"] }), [
    APP_ROLES.STUDENT,
    APP_ROLES.PARENT,
  ]);
  // The list is a strict total order over the eight roles, with no duplicates.
  assert.equal(new Set(APP_ROLE_PRECEDENCE).size, 9);
  assert.deepEqual([...APP_ROLE_PRECEDENCE].sort(), ALL_ROLES.map(String).sort());
  // Unknown values are dropped rather than becoming a role nobody defined.
  assert.deepEqual(normalizeAppRoles({ app_roles: ["teacher", "wizard", "exam_coordinator"] }), [
    APP_ROLES.EXAM_COORDINATOR,
    APP_ROLES.TEACHER,
  ]);
});

test("a role family may mix within itself but never across groups", () => {
  // Staff roles combine freely: this is the teacher who also runs the exams.
  const staff = validateAppRoleSet(["teacher", "exam_coordinator", "principal"]);
  assert.equal(staff.error, null);
  assert.deepEqual(staff.roles, [APP_ROLES.PRINCIPAL, APP_ROLES.EXAM_COORDINATOR, APP_ROLES.TEACHER]);

  // Family roles combine too, and stay in the family group.
  const family = validateAppRoleSet(["student", "parent"]);
  assert.equal(family.error, null);
  assert.equal(roleGroupOf(family.roles[0]), FAMILY_ROLES);
  assert.equal(roleGroupOf(APP_ROLES.TEACHER), STAFF_ROLES);
  assert.equal(roleGroupOf(APP_ROLES.SUPER_ADMIN), PLATFORM_ROLES);
  assert.equal(roleGroupOf(APP_ROLES.AFFILIATE), AFFILIATE_ROLES);

  // The load-bearing refusals. A student who is also a school administrator is an
  // administrator browsing a portal, and every own-record-only check assumes the
  // actor is nobody else.
  assert.ok(validateAppRoleSet(["teacher", "student"]).error);
  assert.ok(validateAppRoleSet(["parent", "school_admin"]).error);
  assert.ok(validateAppRoleSet(["employee", "teacher"]).error);
  assert.ok(validateAppRoleSet(["super_admin", "parent"]).error);
  assert.ok(validateAppRoleSet(["super_admin", "employee"]).error === null);

  // The affiliate family is exclusive for the reason its own set is: a reseller who
  // also held school_admin could read the students of every school they ever sold,
  // which is exactly the read the role is built to withhold. Its own family in
  // ROLE_GROUPS is what makes this refusal structural rather than incidental.
  assert.equal(validateAppRoleSet(["affiliate"]).error, null);
  assert.ok(validateAppRoleSet(["affiliate", "school_admin"]).error, "a reseller must not also administer a school");
  assert.ok(validateAppRoleSet(["affiliate", "employee"]).error, "a reseller must not also be support staff");
  assert.ok(validateAppRoleSet(["affiliate", "teacher"]).error);
  assert.ok(validateAppRoleSet(["affiliate", "super_admin"]).error);

  // Empty and wholly unrecognized requests are refused rather than accepted as a
  // role-less account.
  assert.ok(validateAppRoleSet([]).error);
  assert.ok(validateAppRoleSet(["wizard"]).error);
  assert.equal(roleGroupOf("wizard"), null);
  assert.equal(ROLE_GROUPS.length, 4);
});

test("only the platform owner may appoint a reseller, and a reseller may appoint nobody", () => {
  // The hierarchy row must EXIST even though it is empty: canDelegateIn() treats a
  // missing key as "not authorized", so omitting PROVISIONING_HIERARCHY.affiliate
  // would silently strip super_admin's ability to create an affiliate at all.
  assert.ok(Array.isArray(PROVISIONING_HIERARCHY[APP_ROLES.AFFILIATE]), "the affiliate row must exist");
  assert.deepEqual(PROVISIONING_HIERARCHY[APP_ROLES.AFFILIATE], []);

  assert.equal(canProvisionRoleSet(["super_admin"], ["affiliate"]).error, null);
  // Minting is a platform act. Not because a reseller cannot be given the role by
  // hand, but because a reseller who could appoint peers could build a competing
  // downline inside your own platform.
  for (const creator of ["employee", "school_admin", "principal", "exam_coordinator", "teacher", "affiliate"]) {
    assert.ok(canProvisionRoleSet([creator], ["affiliate"]).error, `${creator} must not be able to appoint a reseller`);
  }
  // Re-labelling is no more open. ROLE_ASSIGNMENT_HIERARCHY is DERIVED from the
  // minting table plus SELF_ASSIGNABLE, so this needs no second assertion on the
  // derived table — an empty affiliate row there too.
  assert.ok(canAssignRoleSet(["affiliate"], ["affiliate"]).error);
});

test("selling is a capability of the affiliate role alone, and it is not a platform grant", () => {
  assert.equal(canSellAsAffiliate(asUser(APP_ROLES.AFFILIATE)), true);
  assert.equal(canSellAsAffiliate(asUser(APP_ROLES.SUPER_ADMIN)), false,
    "the platform owner creating a sale would credit commission on their own decision");
  assert.equal(canSellAsAffiliate(asUser(APP_ROLES.EMPLOYEE)), false);
  for (const role of ALL_ROLES) {
    if (role === APP_ROLES.AFFILIATE) continue;
    assert.equal(canSellAsAffiliate(asUser(role)), false, `${role} must not be able to sell`);
  }

  // Managing the programme is a separate capability, not a widening of selling.
  assert.equal(canManageAffiliates(asUser(APP_ROLES.SUPER_ADMIN)), true);
  for (const role of ALL_ROLES) {
    if (role === APP_ROLES.SUPER_ADMIN) continue;
    assert.equal(canManageAffiliates(asUser(role)), false, `${role} must not be able to manage affiliates`);
  }
  // ...and the reseller surface stays out of tenant staff management, whose whole
  // purpose is staffing one institution.
  assert.equal(canManageStaff(asUser(APP_ROLES.AFFILIATE)), false);
});

test("the affiliate profile and commission ledger are super-admin-only through generic CRUD", () => {
  // Both are money records with computed fields. The bespoke /api/affiliates routes
  // are the only writers; an empty matrix row means the generic entity endpoint
  // refuses every role but the platform owner, whose bypass is deliberate and
  // audited.
  for (const entity of ["Affiliate", "AffiliateSale"]) {
    for (const verb of ["create", "update", "delete"]) {
      assert.equal(canWriteEntity(asUser(APP_ROLES.AFFILIATE), entity, verb), false,
        `an affiliate must not ${verb} an ${entity} through generic CRUD`);
      assert.equal(canWriteEntity(asUser(APP_ROLES.SUPER_ADMIN), entity, verb), true,
        `the platform owner may ${verb} an ${entity}`);
    }
  }
});

test("an affiliate reads no tenant data, so the ledger routes must carry their own scope", () => {
  // readScope() answers `{ _id: null }` for an affiliate because it is in no
  // platform, staff or family branch — that is asserted structurally above and by
  // the absence from PLATFORM_ROLES. What this pins is the capability that
  // replaces it: canSellAsAffiliate is the ONLY thing that opens anything for this
  // role, and it is a single predicate with no tenant argument at all. There is no
  // code path where an affiliate scopes a read by tenant, because the role has no
  // tenant and never receives one — the sale route mints a Tenant and never writes
  // tenant_id onto the caller.
  assert.equal(canSellAsAffiliate(asUser(APP_ROLES.AFFILIATE, { tenant_id: null })), true);
  // And a hypothetical affiliate that somehow carried a tenant_id still gets no
  // generic read, because readScope keys off the ROLE, not off tenant membership.
  assert.equal(canWriteEntity(asUser(APP_ROLES.AFFILIATE, { tenant_id: "t1" }), "Student", "update"), false);
});

test("the renewal ledger and reminder log are not writable through generic CRUD", () => {
  // Subscription and AffiliateReminderDelivery are written only by the bespoke
  // /api/affiliates/:id/... routes, which resolve the acting affiliate from the session
  // and advance a money record in a defined order. A generic field-map write cannot
  // express any of that, so both carry an empty matrix row and fail closed.
  //
  // They are additionally absent from the generic entity `allowed` set in
  // server/index.js, so col() throws 404 for them and the generic endpoints never reach
  // a document at all. That allowlist is the stronger of the two guards; this matrix row
  // is defence in depth, so that adding either name to `allowed` later does not
  // silently also hand out write access.
  for (const entity of ["Subscription", "AffiliateReminderDelivery"]) {
    for (const verb of ["create", "update", "delete"]) {
      assert.equal(canWriteEntity(asUser(APP_ROLES.AFFILIATE), entity, verb), false,
        `an affiliate must not ${verb} an ${entity} through generic CRUD`);
      assert.equal(canWriteEntity(asUser(APP_ROLES.SCHOOL_ADMIN), entity, verb), false,
        `a school admin must not ${verb} an ${entity} through generic CRUD`);
      assert.equal(canWriteEntity(asUser(APP_ROLES.STUDENT), entity, verb), false,
        `a student must not ${verb} an ${entity} through generic CRUD`);
      assert.equal(canWriteEntity(asUser(APP_ROLES.EMPLOYEE), entity, verb), false,
        `an employee must not ${verb} an ${entity} through generic CRUD`);
    }
  }
  // super_admin bypassing the write matrix is universal and deliberate, so it is not
  // evidence about these two collections either way — the `allowed` set is. What the
  // reseller must not be able to do is mint or advance a subscription document
  // themselves: that is the sale transaction's job, on the server.
  assert.equal(canWriteEntity(asUser(APP_ROLES.AFFILIATE), "Subscription", "update"), false);
  assert.equal(canWriteEntity(asUser(APP_ROLES.AFFILIATE), "Subscription", "create"), false);
});

test("asking for a plan change is a school capability; granting one is a platform one", () => {
  // The two halves are deliberately separate predicates, because either alone would be
  // wrong in one direction: deriving approval from the requester would let a school
  // approve itself, and deriving the request from the approver would let support open
  // requests on an institution's behalf with nobody at the institution asking.

  assert.equal(canRequestPlanChange(asUser(APP_ROLES.SCHOOL_ADMIN)), true,
    "a school admin raises the request");
  // Derived from ENTITY_WRITE_ROLES.Tenant.update, so a future edit to that row moves
  // this gate with it. Asserted rather than restated so the derivation is visible.
  assert.deepEqual(
    [APP_ROLES.SCHOOL_ADMIN],
    ENTITY_WRITE_ROLES.Tenant.update.filter((role) => canRequestPlanChange(asUser(role))),
    "the request capability must track the Tenant.update write it is derived from"
  );
  for (const role of ["principal", "exam_coordinator", "teacher", "student", "parent", "affiliate"]) {
    assert.equal(canRequestPlanChange(asUser(role)), false,
      `${role} must not raise a plan change for an institution`);
  }
  // employee is a platform role, so it passes the isSuperAdmin-free union on the
  // approver side only. It must not be able to raise a request as an institution.
  assert.equal(canRequestPlanChange(asUser(APP_ROLES.EMPLOYEE)), false,
    "employee approves plan changes, it does not raise them");

  assert.equal(canApprovePlanChanges(asUser(APP_ROLES.EMPLOYEE)), true,
    "the support console already assigns plans by hand, so it may also adjudicate them");
  assert.equal(canApprovePlanChanges(asUser(APP_ROLES.SCHOOL_ADMIN)), false,
    "a school must never approve its own paid entitlement");
  assert.deepEqual(
    [...PLAN_CHANGE_APPROVE_ROLES].sort(),
    [APP_ROLES.SUPER_ADMIN, APP_ROLES.EMPLOYEE].sort(),
    "the approval capability is exactly the platform family"
  );
  for (const role of ["principal", "exam_coordinator", "teacher", "student", "parent", "affiliate"]) {
    assert.equal(canApprovePlanChanges(asUser(role)), false, `${role} must not approve a plan change`);
  }
  // The platform owner passes both, by bypass rather than membership, and a test that
  // relied on membership would break the day the bypass is refactored.
  assert.equal(canRequestPlanChange(asUser(APP_ROLES.SUPER_ADMIN)), true);
  assert.equal(canApprovePlanChanges(asUser(APP_ROLES.SUPER_ADMIN)), true);

  // A union, not a primary-role read: a multi-role account that holds school_admin is
  // entitled to request even while its primary role is something else.
  const both = { user: { app_role: APP_ROLES.TEACHER, app_roles: [APP_ROLES.TEACHER, APP_ROLES.SCHOOL_ADMIN] } };
  assert.equal(canRequestPlanChange(both), true);
});

test("the billing-field guard covers every field that decides what an institution pays for", () => {
  // These six are what tenantBillingWriteRefused (server/index.js) refuses for any
  // non-platform role. The list is asserted here because it is the whole of the
  // self-upgrade fix: a field that decides entitlement but is absent from it is a
  // field a school can still set on itself.
  assert.deepEqual(TENANT_BILLING_FIELDS, [
    "subscription_plan_id",
    "plan_name",
    "subscription_period_start",
    "subscription_period_end",
    "student_limit",
    "omr_sheet_limit_per_month",
  ]);

  // Branding flags are deliberately NOT money fields: they are gated in the white-label
  // surface, and listing them here would have made a branding edit look like a
  // privilege change to the entity guard.
  assert.ok(!TENANT_BILLING_FIELDS.includes("white_label_enabled"));
  assert.ok(!TENANT_BILLING_FIELDS.includes("powered_by_avexora"));
  assert.ok(!TENANT_BILLING_FIELDS.includes("status"),
    "suspension is a platform console action, not a money field");

  // Every guarded field must also be readable by the institution's own members, or the
  // billing page could never show the plan or the period it is being denied.
  for (const field of TENANT_BILLING_FIELDS) {
    assert.ok(TENANT_PUBLIC_FIELDS.includes(field), `${field} is guarded on write but missing from TENANT_PUBLIC_FIELDS`);
  }
});

test("a plan change request is not writable through generic CRUD", () => {
  // The lifecycle runs entirely through the planUpgrade function, which checks
  // canRequestPlanChange / canApprovePlanChanges and writes an audit event. An empty
  // matrix row keeps generic CRUD out of it — defence in depth, because the row is
  // what stops a future edit from making a request a back door around approval.
  for (const verb of ["create", "update", "delete"]) {
    for (const role of [APP_ROLES.SCHOOL_ADMIN, APP_ROLES.EMPLOYEE, APP_ROLES.PRINCIPAL, APP_ROLES.AFFILIATE, APP_ROLES.STUDENT]) {
      assert.equal(canWriteEntity(asUser(role), "PlanChangeRequest", verb), false,
        `${role} must not ${verb} a PlanChangeRequest through generic CRUD`);
    }
  }
});

test("reminder configuration is an affiliate capability, but commission mode is not", () => {
  // canSellAsAffiliate is what opens the reseller's own surface, including the reminder
  // routes. It carries no tenant argument, so it cannot be used to reach another
  // reseller's profile — the route resolves the caller's own Affiliate document and
  // compares the id in the path against it.
  assert.equal(canSellAsAffiliate(asUser(APP_ROLES.AFFILIATE)), true);
  assert.equal(canSellAsAffiliate(asUser(APP_ROLES.SUPER_ADMIN)), false,
    "the platform owner must not be able to mint a sale and credit themselves commission");
  for (const role of ["school_admin", "principal", "teacher", "exam_coordinator", "employee", "student", "parent"]) {
    assert.equal(canSellAsAffiliate(asUser(role)), false, `${role} must not reach the affiliate surface`);
  }
  // Managing the programme — which is where commission_mode and the rate live — stays
  // with the platform owner alone. These are the same two predicates the reminder
  // routes are gated by, pinned so the split cannot quietly invert.
  assert.equal(canManageAffiliates(asUser(APP_ROLES.SUPER_ADMIN)), true);
  assert.equal(canManageAffiliates(asUser(APP_ROLES.AFFILIATE)), false);
  assert.equal(canManageAffiliates(asUser(APP_ROLES.EMPLOYEE)), false);
});

test("capability is the union: holding any authorizing role is enough", () => {
  // The teacher half still authorizes what a teacher may do...
  assert.ok(canWriteEntity(asRoles(APP_ROLES.TEACHER, APP_ROLES.EXAM_COORDINATOR), "Attendance", "create"));
  assert.ok(canWriteEntity(asRoles(APP_ROLES.TEACHER), "Attendance", "create"));
  // ...and the exam half authorizes what an exam coordinator adds on top. Reading
  // OMRSheet is exam-only, so this pair can do what the teacher alone cannot --
  // that is the feature, and it is also the escalation risk if the union were
  // replaced by the primary role.
  assert.ok(!canWriteEntity(asRoles(APP_ROLES.TEACHER), "OMRSheet", "create"));
  assert.ok(canWriteEntity(asRoles(APP_ROLES.TEACHER, APP_ROLES.EXAM_COORDINATOR), "OMRSheet", "create"));
  assert.ok(isExamWorkflow(asRoles(APP_ROLES.TEACHER, APP_ROLES.EXAM_COORDINATOR)));
  assert.ok(isExamWorkflow(asRoles(APP_ROLES.EXAM_COORDINATOR)));
  assert.ok(!isExamWorkflow(asRoles(APP_ROLES.TEACHER)));

  // The union is a SUPERSET of each role's own reach, for every entity/verb pair
  // the matrix authorizes: holding a second role must never take a capability away
  // from a role the account still holds. It is deliberately not an equality --
  // pairing is supposed to ADD the second role's capabilities (the OMRSheet case
  // above), so a set holding teacher must grant more than teacher alone.
  for (const role of ALL_ROLES) {
    const partner = role === APP_ROLES.TEACHER ? APP_ROLES.EXAM_COORDINATOR : APP_ROLES.TEACHER;
    for (const [entity, verbs] of Object.entries(ENTITY_WRITE_ROLES)) {
      for (const verb of Object.keys(verbs)) {
        assert.ok(
          canWriteEntity(asRoles(role, partner), entity, verb) || !canWriteEntity(asUser(role), entity, verb),
          `${role} lost ${entity}.${verb} when paired with ${partner}`
        );
      }
    }
  }

  assert.ok(hasAnyRole(asRoles(APP_ROLES.TEACHER, APP_ROLES.EXAM_COORDINATOR), [APP_ROLES.TEACHER]));
  assert.ok(!hasAnyRole(asRoles(APP_ROLES.TEACHER), [APP_ROLES.SCHOOL_ADMIN]));
  // A Set is accepted as well as an array, because readScope builds one.
  assert.ok(hasAnyRole(asRoles(APP_ROLES.TEACHER), new Set([APP_ROLES.TEACHER])));
  assert.ok(hasRole(asRoles(APP_ROLES.TEACHER, APP_ROLES.EXAM_COORDINATOR), APP_ROLES.TEACHER));
});

test("scope and routing follow the PRIMARY role, not the widest one held", () => {
  // roleOf() is the scope identity, so a primarily-exam coordinator is NOT held to
  // the teacher read boundary.
  const examFirst = asRoles(APP_ROLES.TEACHER, APP_ROLES.EXAM_COORDINATOR);
  assert.equal(roleOf(examFirst), APP_ROLES.EXAM_COORDINATOR);
  assert.equal(rolesOf(examFirst).length, 2);

  const teacherFirst = asRoles(APP_ROLES.TEACHER);
  assert.equal(roleOf(teacherFirst), APP_ROLES.TEACHER);
});

test("delegation is decided over EVERY requested role, not just the primary", () => {
  // A principal may mint the staff roles strictly below it.
  const asPrincipal = [APP_ROLES.PRINCIPAL];
  const below = canAssignRoleSet(asPrincipal, ["teacher", "exam_coordinator"]);
  assert.equal(below.error, null);
  assert.deepEqual(below.roles, [APP_ROLES.EXAM_COORDINATOR, APP_ROLES.TEACHER]);
  // ...but not another principal, which is its own level rather than one beneath
  // it. Every role in the set is checked, so the refusal cannot be sidestepped by
  // ordering a permitted role first.
  assert.ok(canAssignRoleSet(asPrincipal, ["teacher", "principal"]).error);
  assert.match(canAssignRoleSet(asPrincipal, ["teacher", "principal"]).error, /principal/);
  // A school_admin is above a principal and may mint one.
  assert.equal(canAssignRoleSet([APP_ROLES.SCHOOL_ADMIN], ["principal", "teacher"]).error, null);

  // The creator's own roles are the union, so a principal who is also a teacher can
  // still appoint a teacher.
  assert.equal(canAnyProvisionRole([APP_ROLES.PRINCIPAL, APP_ROLES.TEACHER], APP_ROLES.TEACHER), true);
  // ...and an exam coordinator on its own cannot appoint a principal.
  assert.equal(canAnyProvisionRole([APP_ROLES.EXAM_COORDINATOR], APP_ROLES.PRINCIPAL), false);

  // A creator may not assign a role above itself, nor across families, and the
  // refusal names the offending role.
  const refused = canAssignRoleSet([APP_ROLES.EXAM_COORDINATOR], ["teacher", "principal"]);
  assert.ok(refused.error);
  assert.match(refused.error, /principal/);
  assert.ok(canAssignRoleSet([APP_ROLES.TEACHER], ["teacher"]).error);
  assert.ok(canAssignRoleSet([APP_ROLES.TEACHER], ["exam_coordinator"]).error);
  assert.equal(canAssignRoleSet([APP_ROLES.PRINCIPAL], ["student", "parent"]).error, null);
  // An empty request is a bad request, not a silent no-op.
  assert.ok(canAssignRoleSet([APP_ROLES.PRINCIPAL], []).error);
});

test("creatable roles are the union of what the creator's roles authorize", () => {
  const principal = staffCreatableRolesFor([APP_ROLES.PRINCIPAL]);
  const exam = staffCreatableRolesFor([APP_ROLES.EXAM_COORDINATOR]);
  // A principal who is also an exam coordinator can create what either authorizes.
  const both = staffCreatableRolesFor([APP_ROLES.PRINCIPAL, APP_ROLES.EXAM_COORDINATOR]);
  for (const role of principal) assert.ok(both.includes(role));
  for (const role of exam) assert.ok(both.includes(role));
  // Never a second school admin, whoever is asking.
  assert.ok(!staffCreatableRolesFor(ALL_ROLES).includes(APP_ROLES.SCHOOL_ADMIN));
});

// --- Staff management surface --------------------------------------------------
//
// Two matrices with exactly one intended difference, and this suite exists to keep
// it that way: MINTING a new identity and RE-LABELING an existing one are different
// capabilities, and the one role they disagree about is school_admin.

test("canManageStaff admits the platform owner, a school admin and a principal", () => {
  for (const role of [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN, APP_ROLES.PRINCIPAL]) {
    assert.equal(canManageStaff(asUser(role)), true, `${role} must manage staff`);
  }
  // exam_coordinator and below are managed BY this surface. Admitting any of them
  // would let a lesser role appoint their peers.
  for (const role of [APP_ROLES.EXAM_COORDINATOR, APP_ROLES.TEACHER, APP_ROLES.EMPLOYEE, APP_ROLES.STUDENT, APP_ROLES.PARENT]) {
    assert.equal(canManageStaff(asUser(role)), false, `${role} must not manage staff`);
  }
  // Union: holding principal alongside another role still qualifies.
  assert.equal(canManageStaff(asRoles(APP_ROLES.PRINCIPAL, APP_ROLES.TEACHER)), true);
  assert.equal(canManageStaff(asUser(null)), false);
});

test("promoting an existing account and minting a new one are different capabilities", () => {
  // THE invariant. A school_admin may hand a colleague the administrator role --
  // that colleague is already vetted and already has a login.
  assert.equal(canAssignRoleSet([APP_ROLES.SCHOOL_ADMIN], ["school_admin"]).error, null);
  // ...but may NOT create a new administrator login. That is the capability a
  // compromised school_admin account would use to plant a backdoor which survives
  // the real administrator's removal.
  const minting = canProvisionRoleSet([APP_ROLES.SCHOOL_ADMIN], ["school_admin"]);
  assert.ok(minting.error, "minting a school_admin must be refused");
  // The message has to explain itself: "not authorized" alone reads as a missing
  // feature rather than a decision, and the remedy (promote, or ask the platform)
  // is the whole point of the split.
  assert.match(minting.error, /promote/i);
  assert.match(minting.error, /platform/i);

  // Everything BELOW the administrator level is unchanged in both directions, which
  // is why the split could not be replaced by simply widening the minting matrix.
  for (const target of [APP_ROLES.PRINCIPAL, APP_ROLES.EXAM_COORDINATOR, APP_ROLES.TEACHER]) {
    assert.equal(canAssignRoleSet([APP_ROLES.SCHOOL_ADMIN], [target]).error, null);
    assert.equal(canProvisionRoleSet([APP_ROLES.SCHOOL_ADMIN], [target]).error, null);
  }
  // The family roles stay mintable from a school_admin (provisionAutoLogins needs it)
  // and the refusal text must not be bolted onto those.
  assert.equal(canProvisionRoleSet([APP_ROLES.SCHOOL_ADMIN], ["student", "parent"]).error, null);
  assert.doesNotMatch(canProvisionRoleSet([APP_ROLES.SCHOOL_ADMIN], ["principal"]).error ?? "", /platform/i);
});

test("the assignment matrix adds a self-level for school_admin and super_admin only", () => {
  // A principal gets NO own level, which is what stops a principal promoting a peer
  // to principal or administrator. Their row is byte-identical to the minting one.
  assert.deepEqual(ROLE_ASSIGNMENT_HIERARCHY[APP_ROLES.PRINCIPAL], PROVISIONING_HIERARCHY[APP_ROLES.PRINCIPAL]);
  assert.ok(canAssignRoleSet([APP_ROLES.PRINCIPAL], ["school_admin"]).error);
  assert.ok(canAssignRoleSet([APP_ROLES.PRINCIPAL], ["principal"]).error);

  // Every other row is inherited verbatim from the minting matrix. If this fails,
  // someone widened one matrix and forgot the other.
  for (const role of ALL_ROLES) {
    const expected = [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN].includes(role)
      ? [...PROVISIONING_HIERARCHY[role], role]
      : PROVISIONING_HIERARCHY[role];
    assert.deepEqual(ROLE_ASSIGNMENT_HIERARCHY[role], expected, `${role} row drifted from the minting matrix`);
  }
  // A self-level must not smuggle a cross-family set past the group check.
  assert.ok(canAssignRoleSet([APP_ROLES.SCHOOL_ADMIN], ["school_admin", "student"]).error);
});

test("assignable roles are the assignment matrix's staff roles, and never include the minting-only ones", () => {
  // A school_admin can promote to school_admin, so it appears here...
  assert.deepEqual(staffAssignableRolesFor([APP_ROLES.SCHOOL_ADMIN]), [
    APP_ROLES.SCHOOL_ADMIN,
    APP_ROLES.PRINCIPAL,
    APP_ROLES.EXAM_COORDINATOR,
    APP_ROLES.TEACHER,
  ]);
  // ...while a principal, whose row has no own level, never sees it.
  assert.deepEqual(staffAssignableRolesFor([APP_ROLES.PRINCIPAL]), [
    APP_ROLES.EXAM_COORDINATOR,
    APP_ROLES.TEACHER,
  ]);
  // Nobody may assign a family or platform role from the staff screen, whatever
  // they hold.
  for (const creator of ALL_ROLES) {
    for (const target of staffAssignableRolesFor(creator)) {
      assert.ok(STAFF_ROLES.has(target), `${creator} must not be able to assign ${target}`);
    }
  }
  // The two lists are genuinely different lists, which is the point of sending both.
  // If this ever becomes one, the create form has started offering school_admin.
  assert.ok(!staffCreatableRolesFor([APP_ROLES.SCHOOL_ADMIN]).includes(APP_ROLES.SCHOOL_ADMIN));
  assert.ok(staffAssignableRolesFor([APP_ROLES.SCHOOL_ADMIN]).includes(APP_ROLES.SCHOOL_ADMIN));
  // A union creator gets the union of both, as everywhere else.
  const both = staffAssignableRolesFor([APP_ROLES.PRINCIPAL, APP_ROLES.SCHOOL_ADMIN]);
  for (const role of staffAssignableRolesFor([APP_ROLES.PRINCIPAL])) assert.ok(both.includes(role));
  assert.ok(both.includes(APP_ROLES.SCHOOL_ADMIN));
  assert.deepEqual(staffAssignableRolesFor(ALL_ROLES), [
    APP_ROLES.SCHOOL_ADMIN,
    APP_ROLES.PRINCIPAL,
    APP_ROLES.EXAM_COORDINATOR,
    APP_ROLES.TEACHER,
  ]);
});
