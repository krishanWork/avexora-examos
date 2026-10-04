// Centralized RBAC policy — the single source of truth for role authorization.
//
// Authorization order (server is the enforcement boundary):
//   authentication -> tenant boundary -> role authorization -> resource scope.
// super_admin is the implicit, unrestricted platform owner for every check below.
//
// This module is deliberately pure: it takes a user object and returns a
// decision, and never touches the database, the request, or the response. That
// is what makes the whole policy testable under `node --test` with no live
// MongoDB, and it is why the role definitions live here rather than inline in
// server/index.js — the previous arrangement had eight independent copies
// (index.js, provisioning.js, crm-authorization.js, examTimetableService.js,
// and four under src/) that had already drifted apart.

// --- Role vocabulary ----------------------------------------------------------

export const APP_ROLES = {
  SUPER_ADMIN: "super_admin",
  EMPLOYEE: "employee",
  // A reseller. Mints institutions for schools on behalf of the platform and earns
  // a commission on each. Deliberately NOT a platform role and NOT a tenant role —
  // see AFFILIATE_ROLES below for why that distinction is load-bearing.
  AFFILIATE: "affiliate",
  SCHOOL_ADMIN: "school_admin",
  PRINCIPAL: "principal",
  EXAM_COORDINATOR: "exam_coordinator",
  TEACHER: "teacher",
  STUDENT: "student",
  PARENT: "parent",
};

export const VALID_APP_ROLES = new Set(Object.values(APP_ROLES));

export const PLATFORM_ROLES = new Set([APP_ROLES.SUPER_ADMIN, APP_ROLES.EMPLOYEE]);
export const EXAM_WORKFLOW_ROLES = new Set([
  APP_ROLES.SCHOOL_ADMIN,
  APP_ROLES.PRINCIPAL,
  APP_ROLES.EXAM_COORDINATOR,
]);
export const STAFF_ROLES = new Set([...EXAM_WORKFLOW_ROLES, APP_ROLES.TEACHER]);
export const FAMILY_ROLES = new Set([APP_ROLES.STUDENT, APP_ROLES.PARENT]);

// The reseller family, held alone.
//
// An affiliate is NOT in PLATFORM_ROLES, and that is the single most important
// thing about this role. `platform()` short-circuits readScope() (server/index.js)
// to return the caller's criteria untouched, which is how super_admin and
// employee read every institution on the platform. Admitting affiliate there
// would hand every reseller unscoped reads of every Student, Result, Attendance
// record and User document in the database — including bcrypt password hashes and
// the shared portal default password. The platform family is a read-everything
// grant; a reseller needs none of it.
//
// It is NOT in STAFF_ROLES either: an affiliate has no tenant, and the staff
// family exists to scope a tenant's own records. So it is its own family, which
// also makes ROLE_GROUPS exclusivity do the work that a predicate would
// otherwise have to: `affiliate + school_admin` is refused by
// validateAppRoleSet, so a reseller can never hold an institution's data.
export const AFFILIATE_ROLES = new Set([APP_ROLES.AFFILIATE]);

// --- Multi-role model ----------------------------------------------------------
//
// An account may hold SEVERAL roles at once — the common case is a teacher who
// also runs the examination workflow, which is one person doing two jobs in one
// school and not two accounts. Two rules govern what a set of roles means, and
// keeping them separate is what stops the feature from becoming a privilege
// escalation:
//
//   CAPABILITY is the UNION.  "May this actor do X" is answered by any held
//   role that authorizes X. A teacher who is also an exam coordinator really is
//   allowed to manage attendance AND review results, so a check must not silently
//   drop one of the two roles and 403 a legitimate action.
//
//   SCOPE is the PRIMARY role.  A role that narrows an actor to its own
//   resources — a teacher to their assigned classes, a student to their own
//   record — applies only to an account whose PRIMARY role is that role. Someone
//   who is primarily an exam coordinator is not held to the class-assignment
//   ceiling of the teaching job they also do, which is exactly the intent: the
//   wider role governs how far they reach.
//
// The primary role is the most privileged held role, per APP_ROLE_PRECEDENCE
// below, so "widest role" and "primary role" are the same answer for the tenant
// staff group. Precedence is also what decides which portal a multi-role account
// lands on: teacher + exam_coordinator resolves to exam_coordinator, hence the
// exam console, not the teacher portal.
//
// `app_roles` is the canonical field. `app_role` is retained as a mirror of the
// primary role, not as an independent input, and is what a document predating
// this feature is read from — see appRolesOf() for why that fallback matters.

// Privilege order, most privileged first. This one list decides the primary
// role, and therefore the portal, the nav, and every scope narrowing.
//
// `affiliate` sits FIRST, above super_admin, which looks wrong and is not. The
// family rule makes affiliate an exclusive family: validateAppRoleSet refuses
// `affiliate` alongside anything else, so in practice only a single-role
// affiliate account exists and its position cannot change its primary role. It
// is placed first so that IF that invariant is ever relaxed, the account still
// resolves to the affiliate portal and the affiliate route gates rather than
// falling through to a platform or school surface. Precedence fails safe.
export const APP_ROLE_PRECEDENCE = [
  APP_ROLES.AFFILIATE,
  APP_ROLES.SUPER_ADMIN,
  APP_ROLES.SCHOOL_ADMIN,
  APP_ROLES.PRINCIPAL,
  APP_ROLES.EXAM_COORDINATOR,
  APP_ROLES.TEACHER,
  APP_ROLES.EMPLOYEE,
  APP_ROLES.STUDENT,
  APP_ROLES.PARENT,
];

// The mutually exclusive role families. An account's roles must all sit inside
// one group.
//
// The load-bearing rule is that a FAMILY role never coexists with a staff or
// platform role. A student who is also a school administrator is not a student
// with extra powers, it is an administrator browsing a portal, and every
// student-scoped check (own record only, own submissions only) is written on the
// assumption that the actor is nobody else. Mixing would let one account hold
// the narrowest and widest read in the system at once, and there is no screen
// that legitimately needs it — a parent who is also a student stays inside
// FAMILY, a teacher who coordinates exams stays inside the staff group.
export const ROLE_GROUPS = [
  AFFILIATE_ROLES,
  PLATFORM_ROLES,
  STAFF_ROLES,
  FAMILY_ROLES,
];

// The group a role belongs to, or null for an unrecognized one.
export const roleGroupOf = (role) =>
  ROLE_GROUPS.find((group) => group.has(role)) || null;

// Coerce anything role-shaped into a clean, ordered, de-duplicated array of
// valid roles. Accepts an array, a single role string, or a user/document and
// reads the right field. Unknown roles are DROPPED rather than passed through:
// a stale or hand-edited value must not become an entitlement, and the count of
// surviving roles is what the group check below validates.
//
// When handed a document it applies the same canonical-else-legacy rule as
// appRolesOf(), rather than preferring an empty `app_roles` over a populated
// `app_role`. Divergence between the two would mean a not-yet-backfilled
// account authorizes differently depending on which helper a caller reached for,
// which is precisely the class of bug that made the role matrices drift before
// rbac.js existed.
export const normalizeAppRoles = (source) => {
  const raw = Array.isArray(source) ? source
    : typeof source === "string" ? [source]
      : source && typeof source === "object"
        ? (Array.isArray(source.app_roles) && source.app_roles.length
          ? source.app_roles
          : source.app_role !== undefined ? [source.app_role] : [])
        : [];
  if (!Array.isArray(raw)) return [];
  const valid = new Set(raw.filter((role) => VALID_APP_ROLES.has(role)));
  return APP_ROLE_PRECEDENCE.filter((role) => valid.has(role));
};

// The account's roles, tolerating a document that has not been migrated yet.
//
// `app_roles` wins when it is a non-empty array; otherwise the single `app_role`
// is used. That fallback is what makes the deploy order safe: this feature can
// ship before the backfill has run, and a not-yet-backfilled account still
// authorizes exactly as it did the day before rather than losing every role.
// A genuinely role-less account has neither field and normalizes to [], which
// the authorization layer fails closed on.
export const appRolesOf = (user) => {
  if (!user) return [];
  // An already-normalized role ARRAY is accepted here, because `rolesOf(req)` returns
  // one and every provisionAutoLogins() call site passes exactly that. Without this
  // branch an array has neither `app_roles` nor `app_role`, so it normalizes to [],
  // the delegation check inside provisionAutoLogins() fails, and portal logins stop
  // being created on every path — silently, because the Student record itself is
  // still written. The symptom is a family that was admitted and cannot sign in.
  if (Array.isArray(user)) return normalizeAppRoles(user);
  const canonical = Array.isArray(user.app_roles) ? user.app_roles : null;
  return normalizeAppRoles(canonical?.length ? canonical : user.app_role);
};

// The most privileged role held, or null. This is the single-role identity the
// portals, nav and scope narrowings read.
export const primaryAppRole = (user) => appRolesOf(user)[0] ?? null;

// The role set an account may hold, or the reason it may not. Group mixing is
// refused rather than silently narrowed, so a bad role set is visible at the
// point it is written instead of quietly becoming a lesser account.
export const validateAppRoleSet = (source) => {
  const roles = normalizeAppRoles(source);
  if (!roles.length) return { roles: [], error: "At least one valid role is required" };
  if (roles.length > 1) {
    const groups = new Set(roles.map(roleGroupOf));
    if (groups.size > 1) {
      return {
        roles: [],
        error: `Roles ${roles.join(", ")} span more than one role family; a family account cannot also be staff or platform`,
      };
    }
  }
  return { roles, error: null };
};


// Roles that may see exam material (the question paper itself, paper sets, marks
// structure) as opposed to schedule data. A date sheet is a schedule; the paper
// is content, and only staff roles get content.
export const EXAM_MATERIAL_ROLES = new Set([...PLATFORM_ROLES, ...EXAM_WORKFLOW_ROLES, APP_ROLES.TEACHER]);

// --- Actor predicates ---------------------------------------------------------

// Every role the actor holds. This is what capability checks read.
export const rolesOf = (req) => appRolesOf(req?.user);

// The actor's PRIMARY role. This is what scope narrowing reads: the checks that
// confine a role to its own resources (a teacher to assigned classes, a student
// to their own record) test this, so a teacher who is primarily an exam
// coordinator is governed by the coordinator's reach rather than the teaching
// job's ceiling. Using the primary role rather than "has teacher" is deliberate —
// see the multi-role note above the precedence list.
export const roleOf = (req) => primaryAppRole(req?.user);

// Does the actor hold this role at all? For capability checks, where holding any
// one role that authorizes the action is enough.
export const hasRole = (req, role) => Boolean(role) && appRolesOf(req?.user).includes(role);

// `roles` may be an array or any Set — the role constants in this module are
// Sets while the write matrix and upload-purpose table are arrays, and callers
// pass whichever they have to hand.
const toArray = (roles) => (Array.isArray(roles) ? roles : roles ? [...roles] : []);

export const hasAnyRole = (req, roles) => {
  const held = appRolesOf(req?.user);
  return toArray(roles).some((role) => held.includes(role));
};

// Does the actor hold every one of these roles? The one check that must NOT be
// a union — it answers "is this exactly the account I think it is".
export const hasAllRoles = (req, roles) => {
  const held = appRolesOf(req?.user);
  return toArray(roles).every((role) => held.includes(role));
};

// super_admin is the platform owner. Kept to the literal role rather than a
// platform test: an `employee` is a platform role but is not the owner, and the
// bypass below is unbounded.
export const isSuperAdmin = (req) => hasRole(req, APP_ROLES.SUPER_ADMIN);
export const isPlatform = (req) => hasAnyRole(req, PLATFORM_ROLES);
export const isExamWorkflow = (req) => isSuperAdmin(req) || hasAnyRole(req, EXAM_WORKFLOW_ROLES);

// True when the actor is held to a role's resource scoping. A teacher who also
// holds an exam-workflow role is not: the wider role governs. Named for the
// narrowing checks that ask "is this actor just a teacher/student?" — the ones
// that must not fire for a multi-role account whose primary role is broader.
export const isScopedToRole = (req, role, supersedingRoles) =>
  hasRole(req, role) && !hasAnyRole(req, supersedingRoles);


// --- Delegation hierarchies ---------------------------------------------------

// TWO matrices, because "may this actor create a new identity" and "may this
// actor re-label an existing one" are different questions.
//
// MINTING (PROVISIONING_HIERARCHY, below) creates an account: it mints a
// credential, and the person behind it is a stranger the school has chosen to
// onboard.
//
// ASSIGNMENT (ROLE_ASSIGNMENT_HIERARCHY) only re-labels a login that already
// exists, belonging to someone already inside the school.
//
// The one place they differ is `school_admin -> school_admin`. A school_admin may
// hand a colleague the administrator role — that colleague is already vetted and
// already has a login, so this is the school's own staffing decision. They may NOT
// mint a fresh administrator, because that is what a compromised school_admin
// account would use to plant a backdoor that survives the real admin's removal.
//
// The consequence is a deliberate two-step: the platform creates the login, then
// any school_admin promotes it. It is stated in the refusal message rather than
// left to be discovered.
//
// `principal` gets no own-level row in the assignment matrix, so a principal can
// never promote a peer to principal or school_admin. `super_admin` is exempt from
// the check entirely by its callers (and is spelled out here anyway, so this
// matrix matches what the code actually does).
//
// super_admin's row is the platform owner's full tenant-staff reach. It is
// spelled out rather than left to a bypass in each caller because the creation
// paths disagree: assignUserRole() exempts super_admin outright, while
// provisionUser(), /users/invite and manageStaff invite all call
// canProvisionRole() unconditionally. That left the /staff screen offering
// super_admin a single option — "School Administrator" — and, because the screen
// posts no tenant_id, failing on every submit as well. One matrix, no bypasses.
//
// This is the MINTING matrix. It must keep STUDENT and PARENT: creating a
// Student record auto-provisions a portal login via provisionAutoLogins().
export const PROVISIONING_HIERARCHY = {
  [APP_ROLES.SUPER_ADMIN]: [APP_ROLES.AFFILIATE, APP_ROLES.SCHOOL_ADMIN, APP_ROLES.PRINCIPAL, APP_ROLES.EXAM_COORDINATOR, APP_ROLES.TEACHER],
  [APP_ROLES.SCHOOL_ADMIN]: [APP_ROLES.PRINCIPAL, APP_ROLES.EXAM_COORDINATOR, APP_ROLES.TEACHER, APP_ROLES.STUDENT, APP_ROLES.PARENT],
  [APP_ROLES.PRINCIPAL]: [APP_ROLES.EXAM_COORDINATOR, APP_ROLES.TEACHER, APP_ROLES.STUDENT, APP_ROLES.PARENT],
  [APP_ROLES.EXAM_COORDINATOR]: [APP_ROLES.STUDENT, APP_ROLES.PARENT],
  [APP_ROLES.TEACHER]: [],
  [APP_ROLES.STUDENT]: [],
  [APP_ROLES.PARENT]: [],
  [APP_ROLES.EMPLOYEE]: [],
  // Only the platform owner may appoint a reseller, and a reseller may appoint
  // nobody. The row must EXIST even though it is empty: canDelegateIn() treats a
  // missing key as "not authorized", so omitting it would silently strip
  // super_admin's own ability to create an affiliate account.
  [APP_ROLES.AFFILIATE]: [],
};

export const canProvisionRole = (creatorRole, targetRole) => {
  if (!creatorRole || !targetRole) return false;
  const allowed = PROVISIONING_HIERARCHY[creatorRole];
  return Boolean(allowed && allowed.includes(targetRole));
};

// The RE-LABEL matrix: the minting matrix, plus a role's own level for the two
// roles that may hand their own level to a colleague.
//
// Derived rather than hand-written so the two can never drift: if a role is
// added to the minting matrix it is inherited here automatically, and the only
// intentional difference is the self-level addition below.
const SELF_ASSIGNABLE = new Set([APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN]);

export const ROLE_ASSIGNMENT_HIERARCHY = Object.fromEntries(
  Object.entries(PROVISIONING_HIERARCHY).map(([role, allowed]) => [
    role,
    SELF_ASSIGNABLE.has(role) ? [...allowed, role] : allowed,
  ])
);

const canDelegateIn = (matrix, creatorRole, targetRole) => {
  if (!creatorRole || !targetRole) return false;
  const allowed = matrix[creatorRole];
  return Boolean(allowed && allowed.includes(targetRole));
};

// The same question for a multi-role creator. A principal who is also a teacher
// can still appoint a teacher, so the answer is the union of their rows: holding
// any role that authorizes the target is enough, exactly like every other
// capability check.
export const canAnyProvisionRole = (creatorRoles, targetRole) =>
  normalizeAppRoles(creatorRoles).some((role) => canDelegateIn(PROVISIONING_HIERARCHY, role, targetRole));

export const canAnyAssignRole = (creatorRoles, targetRole) =>
  normalizeAppRoles(creatorRoles).some((role) => canDelegateIn(ROLE_ASSIGNMENT_HIERARCHY, role, targetRole));

// Whether a creator may put this whole SET of roles on one account.
//
// Two gates, in order. The set must be coherent (validateAppRoleSet), which is
// what stops a teacher being handed the student role in the same breath: both are
// individually delegable from a principal, and only the group check refuses the
// combination. Then every role must be individually delegable under `matrix` —
// never just the primary, because that would make the answer depend on each
// hierarchy row happening to be downward-closed by precedence.
//
// The only difference between the two exported wrappers is the matrix, which is
// the whole point: `canProvisionRoleSet` gates creating an identity,
// `canAssignRoleSet` gates re-labelling one.
const roleSetDelegation = (delegable, creatorRoles, targetRoles, verb) => {
  const requested = Array.isArray(targetRoles) ? targetRoles : [targetRoles];
  if (!requested.length) return { error: "user_id and app_roles required" };
  const { roles, error: shapeError } = validateAppRoleSet(requested);
  if (shapeError) return { error: shapeError, roles: [] };
  const refused = roles.find((role) => !delegable(creatorRoles, role));
  if (refused) {
    const held = normalizeAppRoles(creatorRoles).join(", ") || "none";
    return {
      error: `Forbidden: role '${held}' is not authorized to ${verb} '${refused}'`,
      roles: [],
    };
  }
  return { error: null, roles };
};

// Re-labelling an existing account (manageStaff setRole/setRoles, User PATCH).
export const canAssignRoleSet = (creatorRoles, targetRoles) =>
  roleSetDelegation(canAnyAssignRole, creatorRoles, targetRoles, "assign");

// Minting a new account (provisionUser, /users/invite, manageStaff invite). This
// is why a school_admin can promote a colleague to school_admin but cannot
// invite or provision one — and the message says so, because "not authorized"
// alone would read as a missing feature rather than a decision.
export const canProvisionRoleSet = (creatorRoles, targetRoles) => {
  const result = roleSetDelegation(canAnyProvisionRole, creatorRoles, targetRoles, "create");
  if (result.error && /\bschool_admin\b/.test(result.error)) {
    return {
      ...result,
      error: `${result.error}. A school administrator may promote an existing account from the staff screen, but only the platform can create a new administrator account.`,
    };
  }
  return result;
};


// The roles the staff provisioning surface (the /staff screen) offers to create.
// This is what manageStaff returns as `creatable_roles`; the page renders it
// rather than keeping its own copy.
//
// This is NOT the hierarchy itself, and the difference is load-bearing. The
// hierarchy answers "may this actor mint this account at all", and it must keep
// STUDENT and PARENT in it: creating a Student record auto-provisions a portal
// login via provisionAutoLogins(), which gates on
// canProvisionRole(creatorRole, "student"/"parent"). Removing those two from the
// hierarchy to tidy the staff screen would silently break student and parent
// portal onboarding for every role above them.
//
// The staff screen asks a different question — a human picking an account type
// from a dropdown — and it excludes two things the hierarchy deliberately keeps:
//
//   FAMILY_ROLES     a family portal login is not created there at all. It
//                    arrives as a side effect of admitting a student, and is
//                    managed on the Students and Parents pages.
//   SCHOOL_ADMIN     the institution's administrator is minted by the flow that
//                    creates the institution (registration, or a platform trial),
//                    not off a staff dropdown. A school_admin may PROMOTE an
//                    existing account to school_admin from the staff screen —
//                    that is assignment, not minting, and it is answered by
//                    ROLE_ASSIGNMENT_HIERARCHY below — but creating a brand new
//                    administrator stays a platform action.
//   AFFILIATE_ROLES  a reseller is a platform relationship, not a member of a
//                    school. The /staff screen is tenant-scoped — it resolves its
//                    institution and mints into it — so offering affiliate there
//                    would invite a caller to create a tenant-less platform
//                    account through a surface whose whole purpose is staffing an
//                    institution. Resellers are created on the Affiliates page.
//
// So the screen offers principal, exam_coordinator and teacher, and the
// hierarchy continues to authorize the family and administrator accounts it is
// genuinely responsible for. Deriving this by subtraction keeps the two answers
// from drifting: a role added to the hierarchy appears here automatically, and
// the only way to widen the staff screen is to widen the policy, in one place.
const STAFF_SCREEN_EXCLUDED = new Set([...FAMILY_ROLES, APP_ROLES.SCHOOL_ADMIN, ...AFFILIATE_ROLES]);

export const staffCreatableRoles = (creatorRole) => {
  const allowed = PROVISIONING_HIERARCHY[creatorRole];
  if (!allowed) return [];
  return allowed.filter((role) => !STAFF_SCREEN_EXCLUDED.has(role));
};

// The same list for a multi-role creator, in the screen's own precedence order
// and de-duplicated. A principal who is also an exam coordinator may appoint a
// teacher through the principal row, so the union is offered — the screen shows
// what the server would accept.
export const staffCreatableRolesFor = (creatorRoles) => {
  const merged = new Set();
  for (const role of normalizeAppRoles(creatorRoles)) {
    for (const target of staffCreatableRoles(role)) merged.add(target);
  }
  return APP_ROLE_PRECEDENCE.filter((role) => merged.has(role));
};

// --- Staff management surface --------------------------------------------------

// Who may open /staff and call manageStaff at all. Deliberately its own
// predicate rather than a reuse of canWriteEntity(Teacher, "create"): that write
// matrix says who may create a Teacher RECORD, which is school-admin-only for
// reasons unrelated to staffing. Reusing it would silently re-couple the two, and
// would mean any future edit to Teacher.create silently changes who can manage
// staff.
//
// exam_coordinator and below are excluded: they are managed BY this surface, so
// admitting them would let anyone with a lesser role appoint their peers.
export const STAFF_MANAGE_ROLES = new Set([APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN, APP_ROLES.PRINCIPAL]);
export const canManageStaff = (req) => hasAnyRole(req, STAFF_MANAGE_ROLES);

// The roles the staff screen offers to PUT ON AN EXISTING ACCOUNT — the
// `assignable_roles` it returns. This is a different question from
// `creatable_roles`, and the two are sent separately for exactly that reason:
//
//   creatable_roles   minting, from PROVISIONING_HIERARCHY. principal,
//                     exam_coordinator, teacher. Never school_admin.
//   assignable_roles  re-labelling, from ROLE_ASSIGNMENT_HIERARCHY. The same
//                     three, PLUS school_admin for a school_admin.
//
// So the create dropdown and the table's checkbox row are authorized by
// different matrices, and neither is a copy kept in the client.
export const staffAssignableRolesFor = (creatorRoles) => {
  const merged = new Set();
  for (const role of normalizeAppRoles(creatorRoles)) {
    for (const target of ROLE_ASSIGNMENT_HIERARCHY[role] || []) {
      if (STAFF_ROLES.has(target)) merged.add(target);
    }
  }
  return APP_ROLE_PRECEDENCE.filter((role) => merged.has(role));
};


// --- Entity write matrix ------------------------------------------------------

// Per-verb write roles per entity. An empty array means only super_admin may
// write. Mirrors the legitimate frontend business flows; all writes additionally
// remain tenant-scoped via writeAllowed().
// User is [] on purpose: accounts are created by provisionUser() and roles are
// changed by assignUserRole(), both of which enforce the delegation matrix and
// write an audit event. Generic entity CRUD is not a path to a privilege change.
export const ENTITY_WRITE_ROLES = {
  AcademicYear: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  Affiliate: { create: [], update: [], delete: [] },
  AffiliateSale: { create: [], update: [], delete: [] },
  Announcement: { create: [], update: [], delete: [] },
  AnswerKey: { create: ["school_admin", "exam_coordinator", "teacher"], update: ["school_admin", "exam_coordinator", "teacher"], delete: ["school_admin", "exam_coordinator"] },
  Assignment: { create: ["school_admin", "principal", "exam_coordinator", "teacher"], update: ["school_admin", "principal", "exam_coordinator", "teacher"], delete: ["school_admin", "teacher"] },
  AssignmentSubmission: { create: ["school_admin", "teacher", "student"], update: ["school_admin", "teacher", "student"], delete: ["school_admin"] },
  Attendance: { create: ["school_admin", "principal", "exam_coordinator", "teacher"], update: ["school_admin", "principal", "exam_coordinator", "teacher"], delete: ["school_admin"] },
  AuditLog: { create: [], update: [], delete: [] },
  Enrollment: { create: ["school_admin", "exam_coordinator"], update: ["school_admin", "exam_coordinator"], delete: ["school_admin"] },
  Examination: { create: ["school_admin", "principal", "exam_coordinator", "teacher"], update: ["school_admin", "principal", "exam_coordinator", "teacher"], delete: ["school_admin"] },
  Lead: { create: [], update: [], delete: [] },
  OMRCorrection: { create: ["school_admin", "principal", "exam_coordinator"], update: [], delete: [] },
  OMRSheet: { create: ["school_admin", "principal", "exam_coordinator"], update: ["school_admin", "principal", "exam_coordinator"], delete: ["school_admin"] },
  Parent: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  ParentStudent: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  Payment: { create: [], update: [], delete: [] },
  // Empty on purpose, for the same reason as Payment: a plan change is a paid
  // entitlement, so its lifecycle runs through the planUpgrade function (which
  // checks canRequestPlanChange / canApprovePlanChanges and writes an audit
  // event). Generic CRUD is not a path to granting one.
  PlanChangeRequest: { create: [], update: [], delete: [] },
  PlatformBranding: { create: [], update: [], delete: [] },
  Result: { create: ["school_admin", "principal", "exam_coordinator"], update: ["school_admin", "principal", "exam_coordinator"], delete: ["school_admin"] },
  SchoolClass: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  Section: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  Student: { create: ["school_admin", "exam_coordinator"], update: ["school_admin", "exam_coordinator"], delete: ["school_admin"] },
  // The renewal ledger and its send log, empty for the same reason as Payment and
  // AffiliateSale: both are written by a bespoke route that validates ownership and
  // advances a money record in a defined order, which a generic field-map write cannot
  // express. Stating the row keeps them fail-closed here as well, so a future addition
  // of either name to the generic entity allowlist does not also hand out write access.
  Subscription: { create: [], update: [], delete: [] },
  AffiliateReminderDelivery: { create: [], update: [], delete: [] },
  Subject: { create: ["school_admin", "principal", "exam_coordinator", "teacher"], update: ["school_admin"], delete: ["school_admin"] },
  SubscriptionPlan: { create: [], update: [], delete: [] },
  Teacher: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  TeacherAssignment: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  Tenant: { create: [], update: ["school_admin"], delete: [] },
  TenantAnnouncement: { create: ["school_admin"], update: ["school_admin"], delete: ["school_admin"] },
  User: { create: [], update: [], delete: [] },
};

// Role-level authorization for a generic entity WRITE verb. Fails closed: an
// entity or verb with no matrix entry is not writable by anyone but super_admin.
// AuditLog is excluded entirely: audit events are created only by the trusted
// server-side logAudit function, never through generic entity CRUD.
export const canWriteEntity = (req, name, action = "update") => {
  if (name === "AuditLog") return false;
  if (isSuperAdmin(req)) return true;
  const allowed = ENTITY_WRITE_ROLES[name]?.[action];
  // Union, not primary role: a teacher who also coordinates examinations may
  // write every verb their teaching role allows AND the ones the coordinator
  // role adds. Reading the primary role here would strip capabilities from the
  // second role, which is the opposite of what holding two roles is for.
  return Boolean(allowed && hasAnyRole(req, allowed));
};

// AuditLog reads are limited to platform roles and the school_admin (tenant staff
// responsible for the audit page). Other roles get no audit read access.
export const canReadAuditLog = (req) => isPlatform(req) || hasRole(req, APP_ROLES.SCHOOL_ADMIN);

// --- Backfilling student/parent portal logins ---------------------------------
//
// A Student record is not the same thing as a portal login. The login is a User
// document minted as a side effect of admitting a student
// (provisionAutoLogins), so a roster row that was written by any path other
// than create/import can exist with no User behind it — and that family simply
// cannot sign in.
//
// Backfilling those is a distinct capability from editing a student, so it gets
// its own predicate rather than riding on a generic entity write. Two things
// must both hold:
//
//   1. The actor may UPDATE Student records at all. Minting a login is strictly
//      more consequential than editing the row it belongs to, so the set is
//      derived from that matrix rather than restated — a future edit to
//      ENTITY_WRITE_ROLES.Student.update moves this gate with it.
//   2. The actor may mint a student/parent login at all, which
//      provisionAutoLogins itself enforces via canAnyProvisionRole. Checking it
//      here too means a caller can never reach the mint and be refused inside
//      it, half-way through a run.
//
// `principal` is deliberately absent on both counts: the minting hierarchy
// authorizes it, but ENTITY_WRITE_ROLES.Student does not, and this operation
// reads and rewrites roster rows (address backfill), not just User documents.
export const PROVISION_STUDENT_LOGIN_ROLES = [...ENTITY_WRITE_ROLES.Student.update];

export const canProvisionStudentLogins = (req) => {
  if (isSuperAdmin(req)) return true;
  return (
    canWriteEntity(req, "Student", "update") &&
    canAnyProvisionRole(rolesOf(req), "student") &&
    canAnyProvisionRole(rolesOf(req), "parent")
  );
};

// --- Resource-scoped capabilities --------------------------------------------

// Uploading is a privileged action that writes a durable artifact, so it is
// authorized independently of the page the client rendered it from. Without this
// a student or parent could push a `logo`, which is served from a public route
// and rendered on the login page, the marketing navbar/footer and all three
// portals. Each set mirrors the write permission the upload feeds.
export const UPLOAD_PURPOSE_ROLES = {
  logo: [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN],
  import: [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN, APP_ROLES.EXAM_COORDINATOR],
  omr: [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN, APP_ROLES.PRINCIPAL, APP_ROLES.EXAM_COORDINATOR],
};
export const canUploadPurpose = (req, purpose) => {
  // The purpose must be one the policy actually defines, checked before the
  // super_admin bypass: a short-circuit on the actor alone would authorize an
  // unrecognized purpose for the platform owner and hand the caller a purpose
  // this function has no rule for.
  const allowed = UPLOAD_PURPOSE_ROLES[purpose];
  if (!allowed) return false;
  return isSuperAdmin(req) || hasAnyRole(req, allowed);
};

// Parsing a roster file is staff work. Mirrors the permission to create Students
// (ENTITY_WRITE_ROLES.Student.create): the integration only previews what a
// permitted creator could import.
export const EXTRACT_ROLES = [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN, APP_ROLES.EXAM_COORDINATOR];
export const canExtractRoster = (req) =>
  isSuperAdmin(req) || hasAnyRole(req, EXTRACT_ROLES);

// Starting a trial mints a Tenant and self-promotes the caller to its
// school_admin. "Has no tenant yet" is not an authorization check on its own —
// /api/users/invite creates tenant-less accounts — so the role is checked too.
export const TRIAL_ROLES = new Set([APP_ROLES.SUPER_ADMIN, APP_ROLES.EMPLOYEE]);
export const canStartTrial = (req) => hasAnyRole(req, TRIAL_ROLES);

// --- Plan changes -------------------------------------------------------------
//
// A plan is a paid entitlement, so the two halves of changing one are separate
// capabilities and neither implies the other:
//
//   * REQUESTING is the institution asking for a different plan. Derived from
//     ENTITY_WRITE_ROLES.Tenant.update rather than restated, because the request
//     is "change the plan on my own institution", which is exactly that write —
//     and a future edit to that matrix moves this gate with it instead of leaving
//     a second, drifting copy of the answer.
//   * APPROVING is the platform granting a paid entitlement after money has been
//     collected offline. Deliberately NOT manage_billing: that capability also
//     gates the institution's own /billing page, and widening it to admit the
//     support `employee` would have handed that employee a page they should never
//     see. It is PLATFORM_ROLES, so the support console that already assigns
//     plans can also adjudicate the requests schools raise through /billing.

export const canRequestPlanChange = (req) =>
  isSuperAdmin(req) || hasAnyRole(req, ENTITY_WRITE_ROLES.Tenant.update);

export const PLAN_CHANGE_APPROVE_ROLES = new Set([APP_ROLES.SUPER_ADMIN, APP_ROLES.EMPLOYEE]);
export const canApprovePlanChanges = (req) => hasAnyRole(req, PLAN_CHANGE_APPROVE_ROLES);

// The Tenant fields that decide what an institution is entitled to pay for and
// what it is allowed to use. None of them may be written through generic entity
// CRUD by a tenant role: ENTITY_WRITE_ROLES.Tenant.update admits school_admin,
// and an unguarded `subscription_plan_id` there is a self-service upgrade that
// costs the school nothing. The planUpgrade function is the only path that sets
// them, and it does so after an approver has recorded the payment.
//
// `white_label_enabled` and `powered_by_avexora` are deliberately NOT here. They
// are branding, gated separately in the white-label surface, and treating a
// branding flag as a money field would have made a branding edit look like a
// privilege change.
export const TENANT_BILLING_FIELDS = [
  "subscription_plan_id",
  "plan_name",
  "subscription_period_start",
  "subscription_period_end",
  "student_limit",
  "omr_sheet_limit_per_month",
];

// --- Affiliate / commission surface -------------------------------------------
//
// Two capabilities, deliberately not one. An affiliate mints institutions and
// earns commission on them; a super_admin appoints and pays affiliates. Keeping
// them separate is what stops a reseller from appointing a peer reseller, which a
// single combined predicate would have allowed.

// Who may manage the affiliate programme: create resellers, change their
// commission rate, approve a commission and mark it paid. super_admin only.
//
// It is NOT expressed as isSuperAdmin even though the current membership is the
// same: this is a money-moving surface, and naming the capability means the
// question "who may pay a reseller" has one answer in one place rather than a
// scattered set of literal role checks.
export const AFFILIATE_MANAGE_ROLES = new Set([APP_ROLES.SUPER_ADMIN]);
export const canManageAffiliates = (req) => hasAnyRole(req, AFFILIATE_MANAGE_ROLES);

// Who may sell on the platform: mint an institution and the school's first
// administrator, and see their own commission ledger.
//
// Union over held roles (hasRole, not roleOf) because this is a CAPABILITY, and
// per the two-axis model a capability is answered by any held role that
// authorizes it. Nothing widens it in practice — the affiliate family is
// exclusive — but reading it as a union keeps it correct if that ever changes.
export const canSellAsAffiliate = (req) => hasRole(req, APP_ROLES.AFFILIATE);

// Self-deletion is irreversible and orphans whatever the account owns, so
// platform operators are excluded: they are removed through the admin surface.
export const canDeleteOwnAccount = (req) => !isPlatform(req);

// getMyTenant: a tenant is readable by its own members. super_admin keeps the
// cross-tenant read the institutions console needs; every other role is pinned
// to its own tenant_id, so a client-supplied tenant_id can never select a
// different institution.
export const resolveReadableTenantId = (req, requestedTenantId) =>
  isSuperAdmin(req) ? requestedTenantId || req.user?.tenant_id || null : req.user?.tenant_id || null;

// Which institution a staff-management call (manageStaff list / invite,
// /users/invite) applies to. Returns { tenantId, error }; `error` is
// {status, error} for the caller to surface, or null to proceed. A null tenantId
// for a platform caller means "no scoping" — see below.
//
// This mirrors resolveReadableTenantId's split, but it REFUSES rather than
// silently ignoring a cross-tenant attempt, because these paths write. A
// school_admin passing another institution's id is answered with 404, the same
// code assignUserRole uses for a cross-tenant target, so the caller is not told
// whether that institution exists.
//
// super_admin is the platform owner and may act inside any institution, which is
// why /staff gives it an institution picker rather than a school_admin-only
// screen. With no tenant_id supplied it falls back to its own (normally none),
// and null therefore means "every tenant" — the platform-wide read the
// institutions console already depends on.
//
// A "view as" scope narrows even that. When req.viewAs is set the caller is the
// platform owner looking at one school, and the answer to "every tenant" is the
// bug being fixed: the picker disappears under the client overlay, no tenant_id
// is sent, and the platform-wide read answers anyway. So a scope is an upper
// bound — an absent request resolves to the scope, and a request naming anything
// else is 404 on the same reasoning as the cross-tenant branch below, so the
// reply never confirms that another institution exists.
export const resolveStaffTenant = (req, requestedTenantId) => {
  const requested =
    requestedTenantId === undefined || requestedTenantId === null
      ? null
      : String(requestedTenantId).trim() || null;

  const scope = req.viewAs?.tenant_id ? String(req.viewAs.tenant_id) : null;
  if (scope) {
    if (requested && requested !== scope) {
      return { tenantId: null, error: { status: 404, error: "Institution not found" } };
    }
    return { tenantId: scope, error: null };
  }

  if (isSuperAdmin(req)) {
    return { tenantId: requested || req.user?.tenant_id || null, error: null };
  }

  const own = req.user?.tenant_id ? String(req.user.tenant_id) : null;
  if (!own) {
    return { tenantId: null, error: { status: 403, error: "No tenant associated" } };
  }
  if (requested && requested !== own) {
    return { tenantId: null, error: { status: 404, error: "Institution not found" } };
  }
  return { tenantId: own, error: null };
};

// --- Response redaction --------------------------------------------------------

// Credential material that must never survive serialization. readScope() is a
// READ filter, not a field filter, and it is a no-op for platform roles, so
// without this an `employee` could read every tenant's bcrypt password_hash.
//
// The email-verification token pair belongs here for the same reason as the
// reset pair: it is a bearer credential for flipping an account out of the
// unverified state, so a holder must not be able to read it back from any
// generic User read (which is unauthenticated-write-adjacent and, for platform
// roles, cross-tenant). `email_verified` itself is NOT secret — it is a boolean
// the client needs in order to render the right screen.
export const SECRET_ENTITY_FIELDS = [
  "password_hash",
  "reset_password_token",
  "reset_password_expires_at",
  "invite_token",
  "invite_expires_at",
  "email_verification_token",
  "email_verification_expires_at",
  "student_default_password",
];

// Tenant fields an authenticated member of the institution may read: branding,
// plan/entitlement, contact details and custom-domain lifecycle status. Tenant
// is an allowlist rather than a denylist because it accumulates operational
// fields over time and a new one must not become readable by default.
export const TENANT_PUBLIC_FIELDS = [
  "name", "subdomain", "status", "board_type",
  "contact_email", "contact_phone", "address",
  "plan_name", "subscription_plan_id", "student_limit", "omr_sheet_limit_per_month",
  "subscription_period_start", "subscription_period_end",
  "white_label_enabled", "powered_by_avexora",
  "logo_url", "favicon_url", "primary_color", "secondary_color", "accent_color",
  "sidebar_use_secondary_color", "login_message",
  "custom_domain", "custom_domain_status", "custom_domain_verified", "domain_degraded",
  "hosting_status", "hosting_verification",
  "created_date", "updated_date",
];

// The shared portal default password is readable only by the roles that may
// WRITE it (ENTITY_WRITE_ROLES.Tenant.update is school_admin) — read access
// never exceeds write access on a credential. This keeps the portal login
// settings dialog working for the administrator who configured the value, and
// denies it to `employee`, to tenant roles that cannot change it, and to
// students and parents.
export const TENANT_ADMIN_FIELDS = ["student_default_password"];
// Mirrors the Tenant.update write permission rather than naming a role, so read
// access can never exceed write access on a credential: the multi-role union
// granted the write is what grants the read.
export const canReadTenantAdminFields = (req) =>
  isSuperAdmin(req) || hasAnyRole(req, ENTITY_WRITE_ROLES.Tenant.update);

export const redactTenant = (doc, req) => {
  if (!doc) return doc;
  const allowed = canReadTenantAdminFields(req)
    ? [...TENANT_PUBLIC_FIELDS, ...TENANT_ADMIN_FIELDS]
    : TENANT_PUBLIC_FIELDS;
  const clean = {};
  // Identity is not tenant data, so the allowlist must not cover it: without
  // _id/id a serialized Tenant has no id and the client cannot address it again.
  for (const field of ["_id", "id"]) {
    if (doc[field] !== undefined) clean[field] = doc[field];
  }
  for (const field of allowed) {
    if (doc[field] !== undefined) clean[field] = doc[field];
  }
  return clean;
};

// The unauthenticated branding payload served by publicSite/branding, which
// brands the login screen and lets the marketing layout detect that a host is a
// tenant domain.
//
// It is deliberately NOT TENANT_PUBLIC_FIELDS. This response reaches anonymous
// callers, and the public list is scoped for *authenticated tenant members* — it
// includes plan/entitlement metadata, subscription ids and the DNS verification
// records the domain pipeline produced (hosting_verification is a list of
// expected TXT values). None of that is secret, but none of it belongs in an
// unauthenticated payload either.
//
// The list is a strict SUBSET of TENANT_PUBLIC_FIELDS, and that relationship is
// asserted by a test: this list can only ever narrow, never widen, so a field
// added to the public list cannot silently become public by omission here. It is
// exactly the set the client reads (Login.jsx, AuthLayout.jsx).
export const TENANT_BRANDING_FIELDS = [
  "name", "subdomain", "custom_domain",
  "logo_url", "primary_color",
  "login_message", "powered_by_avexora",
  "address", "contact_email", "contact_phone",
];

// Shape a Tenant for the public branding endpoint. Identity (_id/id) is included
// because Login.jsx resolves scopedTenantId from brand.id to scope the login form
// to an institution.
export const redactTenantBranding = (doc) => {
  if (!doc) return doc;
  const clean = {};
  for (const field of ["_id", "id"]) {
    if (doc[field] !== undefined) clean[field] = doc[field];
  }
  for (const field of TENANT_BRANDING_FIELDS) {
    if (doc[field] !== undefined) clean[field] = doc[field];
  }
  return clean;
};

// Strip every known secret field from a document about to be serialized.
export const redactSecrets = (doc) => {
  if (!doc) return doc;
  const clean = { ...doc };
  for (const field of SECRET_ENTITY_FIELDS) delete clean[field];
  return clean;
};

// --- Query safety ---------------------------------------------------------------

// Mongo operators are never something a client may choose. The filter endpoint
// only needs equality (plus $in on the normalized id), so anything else is
// dropped rather than passed through to find/updateMany/deleteMany: an
// unfiltered $or/$where alongside a scoped key could otherwise widen a
// predicate that readScope() had already intersected.
export const CLIENT_QUERY_OPERATORS = new Set(["$eq", "$in", "$ne"]);

export const isSafeQueryValue = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return true;
  const keys = Object.keys(value);
  if (keys.length > 0 && keys.every((k) => k.startsWith("$"))) {
    return keys.every((k) => CLIENT_QUERY_OPERATORS.has(k));
  }
  return false;
};

// --- Email verification ----------------------------------------------------------
//
// Verification is an ACCOUNT STATE, not a role. It is deliberately orthogonal to
// the matrix above: a verified account holds exactly the permissions its
// app_role and tenant already grant it, and being unverified removes nothing
// from the role model — it only withholds access until the address is proven.
//
// The one predicate that decides "may this session use the product" lives here,
// and so does the complete list of things an unverified session may still do.
// Both are centralised so the gate cannot drift between routes: a new route is
// covered by default, and an exemption has to be added in one visible place
// rather than sprinkled through handlers.

// Absence means verified. Every account that predates this feature has no
// email_verified field, and a deployment must not lock those users out, so an
// absent field is treated as verified and the backfill makes that explicit.
// Only an explicit `false` blocks. This is the single most important line in
// the feature: getting the default backwards locks out every existing user.
export const isEmailVerified = (user) =>
  !user || user.email_verified !== false;

// The complete set of paths an authenticated-but-unverified session may reach.
// Everything else is refused with EMAIL_UNVERIFIED.
//
// Grouped by why, not alphabetically:
//   - proving/observing the state itself, or the session would be a dead end
//   - completing or recovering authentication, which the unverified user needs
//     in order to become verified at all
//   - endpoints with no session, which the gate no-ops on anyway but are listed
//     so the exemption is auditable rather than implied
//
// Note there is deliberately no /api/auth/change-password here: an account
// created by self-registration chose its own password, and every other creation
// path is verified by construction, so an unverified user has no password
// problem to fix. Adding it would widen the surface for no reachable case.
export const VERIFICATION_ALLOWED_PATHS = new Set([
  // State + session. /api/auth/logout is deliberately absent: no such server
  // route exists (sign-out is client-side only), and allowlisting a path that
  // does not exist is dead configuration that silently rots. A blocked user who
  // wants to sign out clears their token locally, then logs in again through the
  // allowlisted /api/auth/login and resends from there.
  "/api/auth/me",
  // Proving ownership of the address
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  // Recovery: an unverified user must be able to reset the password it chose
  "/api/auth/reset-password-request",
  "/api/auth/reset-password",
  // Sessionless endpoints, listed for auditability
  "/api/health",
  "/api/auth/login",
  "/api/auth/register",
]);

// The single response body for a blocked session. The `code` is what the client
// switches on, matching NO_ASSIGNED_ROLE and MUST_CHANGE_PASSWORD, and `email`
// is included so the verification screen can show which address is pending
// without a second request.
export const EMAIL_UNVERIFIED_RESPONSE = {
  status: 403,
  code: "EMAIL_UNVERIFIED",
  error: "Verify your email address to continue",
};
