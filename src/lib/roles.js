export const APP_ROLES = {
  SUPER_ADMIN: "super_admin",
  EMPLOYEE: "employee",
  // A reseller. Mirrors server/rbac.js — see the note on AFFILIATE_ROLES there
  // for why this role is emphatically NOT a platform role.
  AFFILIATE: "affiliate",
  SCHOOL_ADMIN: "school_admin",
  PRINCIPAL: "principal",
  EXAM_COORDINATOR: "exam_coordinator",
  TEACHER: "teacher",
  STUDENT: "student",
  PARENT: "parent",
};

export const PLATFORM_ROLES = [APP_ROLES.SUPER_ADMIN, APP_ROLES.EMPLOYEE];
export const TENANT_STAFF_ROLES = [
  APP_ROLES.SCHOOL_ADMIN,
  APP_ROLES.PRINCIPAL,
  APP_ROLES.EXAM_COORDINATOR,
  APP_ROLES.TEACHER,
];
export const FAMILY_ROLES = [APP_ROLES.STUDENT, APP_ROLES.PARENT];

// The reseller family, held alone. Deliberately absent from PLATFORM_ROLES: on the
// server `platform()` short-circuits readScope to the caller's criteria untouched,
// so membership there is an unscoped read of every school on the platform. Adding a
// reseller to this list to make it "just another platform role" is how that leak
// would be introduced, so the reason is repeated here where the temptation lives.
export const AFFILIATE_ROLES = [APP_ROLES.AFFILIATE];

// Roles that drive the examination/OMR/evaluation workflow. Mirrors
// EXAM_WORKFLOW_ROLES and examWorkflow() in server/index.js — that server check
// is the enforcement point; this is the UI gate that keeps a control from being
// rendered for a role that would only 403 on click.
export const EXAM_WORKFLOW_ROLES = [
  APP_ROLES.SCHOOL_ADMIN,
  APP_ROLES.PRINCIPAL,
  APP_ROLES.EXAM_COORDINATOR,
];

// --- Multi-role model ---------------------------------------------------------
//
// Mirrors server/rbac.js. An account may hold several roles at once — the
// common case is a teacher who also runs the examination workflow, which is one
// person doing two jobs rather than two accounts.
//
//   CAPABILITY is the UNION: `can()` and RoleGuard answer "may this actor reach
//   this at all" with ANY held role that admits it.
//
//   IDENTITY is the PRIMARY role: getAppRole() returns the most privileged role
//   held, and that single answer drives the portal, the nav and the data-scope
//   decisions. Precedence puts exam_coordinator above teacher, so a teacher who
//   coordinates exams lands in the exam console rather than the teacher portal.
//
// This file is a UI convenience layer. The server is the enforcement point, and
// it answers from its own copy of the same rules — a client that disagrees only
// renders a control that 403s on click, it never grants access.

// Privilege order, most privileged first. Must stay in step with
// APP_ROLE_PRECEDENCE in server/rbac.js: it decides the primary role, and so the
// portal and the nav.
export const APP_ROLE_PRECEDENCE = [
  // affiliate first, matching the server. The family rule makes it an exclusive
  // family, so this cannot change an affiliate's primary role in practice; it is
  // ordered first so that if that ever changed, the account still resolves to the
  // affiliate portal rather than falling through to a platform or school surface.
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

const VALID_ROLES = new Set(APP_ROLE_PRECEDENCE);

// Coerce anything role-shaped into a clean, ordered, de-duplicated array.
// `app_roles` wins when it is a non-empty array, otherwise the single `app_role`
// is used — the same fallback as the server, so an account whose array has not
// been backfilled yet still resolves to the one role it has rather than none.
export const normalizeAppRoles = (source) => {
  const raw = Array.isArray(source) ? source
    : typeof source === "string" ? [source]
      : source && typeof source === "object"
        ? (Array.isArray(source.app_roles) && source.app_roles.length
          ? source.app_roles
          : source.app_role !== undefined ? [source.app_role] : [])
        : [];
  if (!Array.isArray(raw)) return [];
  const valid = new Set(raw.filter((role) => VALID_ROLES.has(role)));
  return APP_ROLE_PRECEDENCE.filter((role) => valid.has(role));
};

// Every role the user holds. Empty array means "no access" — the client must not
// invent a default, and the server fails closed on the same state.
export const getAppRoles = (user) => normalizeAppRoles(user);

// The primary (most privileged) role, or null. This is the single-role identity
// that portals, nav and scope decisions read; the name is kept because it is the
// established accessor at every call site.
export const getAppRole = (user) => normalizeAppRoles(user)[0] ?? null;

// Does the user hold any of these roles? The capability check.
export const hasAnyRole = (user, roles) => {
  const held = normalizeAppRoles(user);
  const wanted = Array.isArray(roles) ? roles : roles ? [...roles] : [];
  return wanted.some((role) => held.includes(role));
};

// True for a role that may operate the exam workflow. super_admin is the
// implicit platform owner and is always allowed. Union over held roles, so a
// teacher who also coordinates exams may operate the workflow.
export const isExamWorkflowRole = (user) =>
  normalizeAppRoles(user).some((role) => role === APP_ROLES.SUPER_ADMIN || EXAM_WORKFLOW_ROLES.includes(role));

export const isPlatformRole = (user) => hasAnyRole(user, PLATFORM_ROLES);

// A reseller. A predicate of its own rather than a PLATFORM_ROLES membership,
// because the answer must stay false for this role on the server too — it is what
// keeps AppLayout treating an affiliate as a non-platform (tenant-branded) user.
export const isAffiliateRole = (user) => hasAnyRole(user, AFFILIATE_ROLES);

export const isFamilyRole = (user) => hasAnyRole(user, FAMILY_ROLES);

export const ROLE_LABELS = {
  super_admin: "Super Admin",
  employee: "Platform Employee",
  affiliate: "Affiliate",
  school_admin: "School Administrator",
  principal: "Principal",
  exam_coordinator: "Examination Coordinator",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

// "Examination Coordinator, Teacher" — for the surfaces that show a person all
// of their roles rather than the one that happens to be primary.
export const roleLabels = (user) => normalizeAppRoles(user).map((role) => ROLE_LABELS[role] || role);

// Role -> portal destination. Single source of truth for post-login routing.
export const ROLE_PORTAL = {
  [APP_ROLES.SUPER_ADMIN]: "/super-admin",
  // Support staff land on the institutions they are assigned to. This is not a
  // redirect to the platform overview because that page has no platform-wide view
  // for this role: the server scopes its reads to the assignment list.
  [APP_ROLES.EMPLOYEE]: "/institutions",
  // A reseller's whole surface is its own earnings: balance, sales history, and the
  // form that mints a new institution. It has no other destination.
  [APP_ROLES.AFFILIATE]: "/affiliate-portal",
  [APP_ROLES.STUDENT]: "/student-portal",
  [APP_ROLES.PARENT]: "/parent-portal",
  [APP_ROLES.TEACHER]: "/teacher-portal",
  [APP_ROLES.SCHOOL_ADMIN]: "/dashboard",
  [APP_ROLES.PRINCIPAL]: "/dashboard",
  [APP_ROLES.EXAM_COORDINATOR]: "/dashboard",
};

// The destination for a user, or null when they have no role at all.
// Resolved from the PRIMARY role, so a teacher who is also an exam coordinator
// is routed to the exam console (the wider job governs) rather than the teacher
// portal. Returns null for an account with no/unknown role: there is no portal
// to send it to, and a fallback destination would be a role-gated route that
// redirects straight back to /home, looping forever.
export const rolePortal = (user) => ROLE_PORTAL[getAppRole(user)] || null;

// Which portal this user's PRIMARY role belongs to, plus whether they also hold
// a role that would take them somewhere else. AppLayout uses this to keep a
// multi-role account from being bounced by another role's redirect.
export const isFamilyPortalUser = (user) => isFamilyRole(user);
