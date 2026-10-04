// Relative with an explicit extension, not "@/lib/roles". This module is imported
// directly by the parity test (server/test/frontend-rbac-parity.test.mjs) under
// `node --test`, which resolves no bundler alias and requires a full specifier;
// Vite resolves "./roles.js" identically.
import { getAppRoles } from "./roles.js";

// Action-level permissions: which app roles may perform each sensitive action
//
// INVARIANT: every list below is a SUBSET of what the server allows. The
// authoritative grant for each action is the backend authority named in
// FRONTEND_ACTION_AUTHORITY in server/test/frontend-rbac-parity.test.mjs, which
// derives from ENTITY_WRITE_ROLES, STAFF_MANAGE_ROLES and EXAM_WORKFLOW_ROLES in
// server/rbac.js. Where the two disagree the FRONTEND is wrong: widen the backend
// deliberately and document it, or the test fails. Never widen this file to match a
// page that wants a control.
//
// `super_admin` is listed explicitly even though the server bypasses every check for
// it, so the client renders the control for the platform owner rather than hiding it.
export const PERMISSIONS = {
  publish_results: ["super_admin", "school_admin", "principal"],
  review_results: ["super_admin", "school_admin", "principal", "exam_coordinator"],
  // Mirrors EXAM_WORKFLOW_ROLES / examWorkflow() in server/index.js.
  evaluate_exam: ["super_admin", "school_admin", "principal", "exam_coordinator"],
  delete_students: ["super_admin", "school_admin"],
  edit_answer_key: ["super_admin", "school_admin", "exam_coordinator", "teacher"],
  // Staff management. Mirrors STAFF_MANAGE_ROLES / canManageStaff() in
  // server/rbac.js. A principal is admitted because their delegation hierarchy
  // already authorized appointing an exam coordinator or a teacher — this gives
  // them a screen for it. It does NOT let them appoint a principal or a school
  // administrator: that limit lives in the hierarchy, not here.
  manage_staff: ["super_admin", "school_admin", "principal"],
  // The affiliate programme: appoint resellers, set their commission rate,
  // approve a commission and mark it paid. Mirrors AFFILIATE_MANAGE_ROLES /
  // canManageAffiliates() in server/rbac.js. Money-moving surface, so super_admin
  // only — `employee` is a platform role but not the owner, and `canManageAffiliates`
  // deliberately does not include it.
  manage_affiliates: ["super_admin"],
  // Billing is money and branding is the school's public face, so both stay
  // school-admin. Split out from manage_staff rather than left implied, because
  // widening manage_staff for principals would otherwise hand them both.
  manage_billing: ["super_admin", "school_admin"],
  // Raising a plan-change request from the institution's own /billing page.
  // Mirrors canRequestPlanChange in server/rbac.js, which derives from
  // ENTITY_WRITE_ROLES.Tenant.update — so this is the same school_admin set
  // manage_billing uses. Kept as its own key because the two are separate
  // capabilities: one asks, the other grants.
  submit_plan_change: ["super_admin", "school_admin"],
  // Adjudicating a plan-change request: approving it (which writes the Payment and
  // applies the new quotas) or rejecting it. Mirrors canApprovePlanChanges.
  //
  // Deliberately NOT manage_billing, which is the institution's own billing page:
  // widening that to admit `employee` would have handed the support console a
  // school billing page it should never read. This is the platform half, and
  // `employee` belongs here because it already assigns plans by hand through the
  // institutions console and can now also adjudicate the requests schools raise.
  approve_plan_changes: ["super_admin", "employee"],
  manage_academics: ["super_admin", "school_admin"],
  // Student and Enrollment writes are school_admin + exam_coordinator only, so a
  // principal reads /students and /enrollments without management affordances.
  manage_students: ["super_admin", "school_admin", "exam_coordinator"],
  // Minting a student or parent portal login for a roster row that has none.
  // Measured against PROVISION_STUDENT_LOGIN_ROLES in server/rbac.js, which is
  // derived from ENTITY_WRITE_ROLES.Student.update: the operation rewrites
  // roster rows (it backfills a missing address) and mints User documents, so it
  // is held to the same set as a student edit. Deliberately narrower than that
  // set — an exam coordinator may add a student and have their logins created as
  // a side effect, but the backfill button is the administrator's.
  // super_admin is listed because the server bypasses every check for it, so the
  // control must render for the platform owner rather than be hidden.
  provision_student_logins: ["super_admin", "school_admin"],
  // Teacher records are school-admin-only, so a principal reads /teachers read-only.
  manage_teachers: ["super_admin", "school_admin"],
  // Parent and ParentStudent writes are school-admin-only, which leaves a principal
  // and an exam coordinator read-only on /parents.
  manage_crm: ["super_admin", "school_admin"],
  mark_attendance: ["super_admin", "school_admin", "principal", "exam_coordinator", "teacher"],
  manage_timetable: ["super_admin", "school_admin"],
  manage_assignments: ["super_admin", "school_admin", "principal", "exam_coordinator", "teacher"],
  submit_assignments: ["super_admin", "student"],
  view_academic_dashboards: ["super_admin", "school_admin", "principal", "teacher"],
};

// A CAPABILITY check, and the union of the user's roles answers it: holding any
// one role that lists the action is enough. That is the whole point of a
// multi-role account — a teacher who is also an exam coordinator is entitled to
// everything the teacher role allows AND everything the coordinator role adds,
// and neither half may be silently dropped. Reading only the primary role here
// would strip capabilities from the second role, which is the exact inversion of
// what holding two roles is for.
export const can = (user, action) => {
  const allowed = PERMISSIONS[action] || [];
  return getAppRoles(user).some((role) => allowed.includes(role));
};

// Page-level access groups (used by RoleGuard in App.jsx)
export const PAGE_ROLES = {
  platform: ["super_admin"],
  superAdminOnly: ["super_admin"],
  // The affiliate programme console: creating resellers and paying them.
  // superAdminOnly is the same set today, kept as its own group because these are
  // two surfaces that will diverge — an `employee` may legitimately be allowed to
  // SEE affiliates while still being refused the commission rate and payout
  // actions, and sharing one group makes that widening impossible to express.
  affiliateManagement: ["super_admin"],
  // A reseller's own earnings surface. super_admin is included as the platform
  // owner debugging the flow; no other role is admitted, because `affiliate` is an
  // exclusive role family server-side and this gate is the client half of that.
  affiliatePortal: ["super_admin", "affiliate"],
  // The institutions list doubles as the employee support console. The server
  // scopes it to the account's assigned institutions, so this is the same page
  // for both roles reading genuinely different amounts of it — which is why
  // employee is separated from `platform` here even though both reach the route.
  institutions: ["super_admin", "employee"],
  // The plan-change approval queue. Its own group rather than `institutions`, even
  // though both are platform roles and both are reached by the same people: this
  // route grants paid entitlements and writes Payment rows, so it must not inherit
  // a widening meant for the read-only institutions list.
  planRequests: ["super_admin", "employee"],
  staff: ["super_admin", "school_admin", "principal", "exam_coordinator", "teacher"],
  studentAdmin: ["super_admin", "school_admin", "principal", "exam_coordinator"],
  // Teachers get the read-only student record, not the roster admin page. The
  // server already scopes Student reads to assigned classes; the route gate just
  // stops them reaching /students, which exposes bulk edit, promote and delete.
  studentDetail: ["super_admin", "school_admin", "principal", "exam_coordinator", "teacher"],
  schoolStructure: ["super_admin", "school_admin", "principal"],
  crmAdmin: ["super_admin", "school_admin", "principal", "exam_coordinator"],
  // Billing, branding and account administration. Deliberately NOT widened for
  // principal, even though principal now reaches /staff: staffing a school is the
  // principal's remit, but the school's money and its public face are not. Kept as
  // its own group so widening staff management did not silently widen these.
  schoolAdmin: ["super_admin", "school_admin"],
  // The one page a principal may reach that a school_admin-only route group cannot
  // express. Mirrors PAGE_ROLES.schoolAdmin plus principal, and the server
  // independently refuses manageStaff to everyone outside canManageStaff().
  staffManagement: ["super_admin", "school_admin", "principal"],
  // canReadAuditLog() on the server (platform roles + school_admin) is the
  // enforcement point; the route group mirrors it so a platform employee who is
  // authorized to read audit events can actually reach the page. The employee's
  // read is bounded to its assigned institutions by readScope(), so this gate
  // answers "may this role read audit data at all", not "whose".
  auditLogs: ["super_admin", "employee", "school_admin"],
  // Portal surfaces. Each portal belongs to exactly one family role, so a staff
  // account has no reason to reach one; super_admin is included as the platform
  // owner debugging a tenant. Checkout is the platform owner's own subscription
  // action, so employee is not a customer of it.
  //
  // These are union checks like every other group, which is safe precisely
  // because role families are mutually exclusive on the server: a family role
  // can never coexist with a staff or platform role, so no account can match
  // both a portal group and a staff group at once.
  checkout: ["super_admin"],
  studentPortal: ["super_admin", "student"],
  parentPortal: ["super_admin", "parent"],
  performance: ["super_admin", "school_admin", "principal", "teacher"],
  attendance: ["super_admin", "school_admin", "principal", "teacher"],
  timetable: ["super_admin", "school_admin", "principal", "teacher"],
  assignments: ["super_admin", "school_admin", "principal", "teacher"],
  // Announcements are published per platform or per institution. Employee is a
  // support reader with no institution of its own, so it has no scope that is
  // both its own and admitted by its assignment list; the page is not offered to
  // it rather than offered empty. See src/pages/Announcements.jsx.
  announcements: [
    "super_admin",
    "school_admin",
    "principal",
    "exam_coordinator",
    "teacher",
    "student",
    "parent",
  ],
};
