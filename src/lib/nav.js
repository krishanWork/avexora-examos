// Navigation and route-access data, kept as pure data with no React or icon imports
// so it can be imported by `node --test` as well as by the app.
//
// Two tables live here, and they answer different questions:
//
//   NAV           which destinations each ROLE is offered, in the sidebar, the
//                 mobile tab bar and the command palette.
//   ROUTE_ACCESS  which PAGE_ROLES group gates each ROUTE.
//
// The second table exists because the two used to be implicit and disagree.
// App.jsx wraps each route in <RoleGuard roles={PAGE_ROLES.x}/>, AppLayout listed a
// nav entry per role, and CommandPalette listed a third, unfiltered set — so a role
// could be shown a destination that RoleGuard would refuse, and clicking it bounced
// to /home. That is not an exposure (the server still enforces the action) but it is
// a broken control the user is invited to press.
//
// ROUTE_ACCESS is now the single place a destination is mapped to its gate, so the
// sidebar, the palette and the route tree cannot drift apart. A regression test
// (server/test/frontend-rbac-parity.test.mjs) asserts every NAV entry is admitted by
// the group ROUTE_ACCESS names for it, and that every entry here corresponds to a real
// route in App.jsx.
//
// `icon` is a string key rather than a component so this file stays importable from
// Node; AppLayout maps the keys to lucide components.

// Extensions are explicit so this file is importable from plain Node as well as Vite:
// the parity test (server/test/frontend-rbac-parity.test.mjs) imports it under
// `node --test`, which resolves no bundler alias.
import { APP_ROLES, getAppRoles } from "./roles.js";
import { PAGE_ROLES } from "./permissions.js";

// Destinations each role is offered. The union across every held role is what the
// sidebar renders, de-duplicated by route and ordered by role precedence.
export const NAV = {
  [APP_ROLES.SUPER_ADMIN]: [
    { to: "/super-admin", label: "Overview", icon: "LayoutDashboard" },
    { to: "/announcements", label: "Announcements", icon: "Megaphone" },
    { to: "/insights", label: "Insights & Growth", icon: "TrendingUp" },
    { to: "/institutions", label: "Institutions", icon: "Building2" },
    { to: "/plans", label: "Subscription Plans", icon: "CreditCard" },
    { to: "/plan-requests", label: "Plan Requests", icon: "ArrowRightLeft" },
    { to: "/platform-branding", label: "Platform Branding", icon: "Palette" },
    { to: "/employees", label: "Employees", icon: "UserCog" },
    { to: "/leads", label: "Lead Management", icon: "Inbox" },
    { to: "/affiliates", label: "Affiliates", icon: "Handshake" },
    { to: "/audit-logs", label: "System Audit Logs", icon: "ShieldCheck" },
  ],
  // Employee is support staff, not a platform operator: the server scopes every
  // read it performs to the institutions assigned to the account, so the
  // institutions list IS its dashboard. There is no platform overview, because
  // there is no platform-wide view to have: /super-admin renders every tenant and
  // the account may only see its assignments.
  [APP_ROLES.EMPLOYEE]: [
    { to: "/institutions", label: "Institutions", icon: "Building2" },
    // The queue of institutions asking to change plan. Admitted to employee because
    // approving one is a support action — the server applies the plan and records the
    // payment — and because employee already assigns plans by hand in /institutions.
    { to: "/plan-requests", label: "Plan Requests", icon: "ArrowRightLeft" },
    // Scoped server-side to the assigned institutions, same as every other read.
    { to: "/audit-logs", label: "System Audit Logs", icon: "ShieldCheck" },
  ],
  // A reseller's entire navigation. It has no tenant, so every school surface
  // would be empty for it and every platform surface is closed server-side; the
  // earnings console is the one destination it owns.
  [APP_ROLES.AFFILIATE]: [
    { to: "/affiliate-portal", label: "My Earnings", icon: "Wallet" },
  ],
  [APP_ROLES.SCHOOL_ADMIN]: [
    { to: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/announcements", label: "Announcements", icon: "Megaphone" },
    { to: "/attendance", label: "Attendance", icon: "CalendarCheck" },
    { to: "/timetable", label: "Exam Schedule", icon: "Clock" },
    { to: "/assignments", label: "Assignments", icon: "FileText" },
    { to: "/examinations", label: "Examinations & OMR", icon: "BookOpenCheck" },
    { to: "/students", label: "Students", icon: "GraduationCap" },
    { to: "/parents", label: "Parents", icon: "Users" },
    { to: "/enrollments", label: "Enrollments", icon: "BookOpen" },
    { to: "/teachers", label: "Teachers", icon: "Users" },
    { to: "/academic-setup", label: "Academic Setup", icon: "Layers" },
    { to: "/performance", label: "Performance", icon: "TrendingUp" },
    { to: "/analytics", label: "Analytics & Trends", icon: "BarChart3" },
    { to: "/staff", label: "Staff Access", icon: "UserCog" },
    { to: "/billing", label: "Billing & Usage", icon: "Wallet" },
    { to: "/white-label", label: "White Label Branding", icon: "Palette" },
    { to: "/audit-logs", label: "Audit Logs", icon: "ShieldCheck" },
  ],
  [APP_ROLES.PRINCIPAL]: [
    { to: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/announcements", label: "Announcements", icon: "Megaphone" },
    { to: "/attendance", label: "Attendance", icon: "CalendarCheck" },
    { to: "/timetable", label: "Exam Schedule", icon: "Clock" },
    { to: "/assignments", label: "Assignments", icon: "FileText" },
    { to: "/students", label: "Students", icon: "GraduationCap" },
    { to: "/teachers", label: "Teachers", icon: "Users" },
    { to: "/academic-setup", label: "Classes & Structure", icon: "Layers" },
    { to: "/examinations", label: "Examinations", icon: "BookOpenCheck" },
    { to: "/performance", label: "Performance", icon: "TrendingUp" },
    { to: "/analytics", label: "Analytics", icon: "BarChart3" },
    // Staffing is the principal's remit, so /staff is theirs too. Billing and
    // branding deliberately are not — see PAGE_ROLES.staffManagement.
    { to: "/staff", label: "Staff Access", icon: "UserCog" },
  ],
  // No /academic-setup: the coordinator cannot write SchoolClass, Section or
  // AcademicYear (ENTITY_WRITE_ROLES, school_admin only) and authorizeAcademicSetup
  // admits only school_admin and super_admin. The entry used to be here and led to a
  // route RoleGuard refuses — see ROUTE_ACCESS below.
  [APP_ROLES.EXAM_COORDINATOR]: [
    { to: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/announcements", label: "Announcements", icon: "Megaphone" },
    { to: "/examinations", label: "Examinations", icon: "BookOpenCheck" },
    { to: "/students", label: "Students", icon: "GraduationCap" },
  ],
  [APP_ROLES.TEACHER]: [
    { to: "/teacher-portal", label: "My Portal", icon: "LayoutDashboard" },
    { to: "/announcements", label: "Announcements", icon: "Megaphone" },
    { to: "/attendance", label: "Attendance", icon: "CalendarCheck" },
    { to: "/timetable", label: "Exam Schedule", icon: "Clock" },
    { to: "/assignments", label: "Assignments", icon: "FileText" },
    { to: "/examinations", label: "Examinations", icon: "BookOpenCheck" },
  ],
  [APP_ROLES.STUDENT]: [
    { to: "/student-portal", label: "My Portal", icon: "Home" },
    { to: "/announcements", label: "Announcements", icon: "Megaphone" },
  ],
  [APP_ROLES.PARENT]: [
    { to: "/parent-portal", label: "My Portal", icon: "Home" },
    { to: "/announcements", label: "Announcements", icon: "Megaphone" },
  ],
};

// Which PAGE_ROLES group gates each route, or null for a route every authenticated
// account may reach. The values are PAGE_ROLES keys, so a renamed group fails the
// parity test rather than silently ungating a page.
export const ROUTE_ACCESS = {
  "/super-admin": "platform",
  "/institutions": "institutions",
  "/tenants": "institutions",
  "/insights": "superAdminOnly",
  "/leads": "superAdminOnly",
  "/leads-management": "superAdminOnly",
  "/affiliates": "affiliateManagement",
  "/affiliate-portal": "affiliatePortal",
  "/plans": "superAdminOnly",
  "/plan-requests": "planRequests",
  "/subscription-plans": "superAdminOnly",
  "/platform-branding": "superAdminOnly",
  "/employees": "superAdminOnly",
  "/dashboard": "staff",
  "/teacher-portal": "staff",
  "/examinations": "staff",
  "/students": "studentAdmin",
  // The read-only student record a teacher is entitled to, as distinct from the
  // roster admin page above.
  "/students/:id": "studentDetail",
  "/parents": "crmAdmin",
  "/enrollments": "crmAdmin",
  "/teachers": "schoolStructure",
  "/academic-setup": "schoolStructure",
  "/analytics": "schoolStructure",
  "/staff": "staffManagement",
  "/billing": "schoolAdmin",
  "/white-label": "schoolAdmin",
  "/audit-logs": "auditLogs",
  "/performance": "performance",
  "/attendance": "attendance",
  "/timetable": "timetable",
  "/assignments": "assignments",
  "/announcements": "announcements",
  "/checkout": "checkout",
  "/student-portal": "studentPortal",
  "/parent-portal": "parentPortal",
  // Reachable by any authenticated account: no RoleGuard wraps them in App.jsx.
  "/home": null,
  "/change-password": null,
};

// Routes under the admin shell that students and parents are still allowed to
// render, so AppLayout's per-role redirect does not bounce them to their portal.
export const STANDALONE_PATHS = ["/change-password", "/announcements"];

// May this account be routed to this path?
//
// A union over held roles, exactly like RoleGuard and `can()`, so a teacher who is
// also an exam coordinator is admitted by either role's group. A path with no entry,
// or one mapped to null, is reachable by any authenticated account.
//
// This is the shared answer to "is this role allowed on this page", which is what
// the command palette used to get wrong: it listed every destination for every
// account, so a teacher was offered Billing, White Label and CRM Leads, each of
// which RoleGuard then refused.
export const canSeeRoute = (user, path) => {
  const group = ROUTE_ACCESS[path];
  if (group === undefined || group === null) return true;
  const allowed = PAGE_ROLES[group];
  // An unmapped group is a typo, and failing open here would re-open exactly the
  // hole this function exists to close. Fail closed.
  if (!allowed) return false;
  return getAppRoles(user).some((role) => allowed.includes(role));
};

// Filter a list of `{ to, ... }` destinations down to the ones this account may
// reach. Used by the command palette so it offers the same set as the sidebar.
export const visibleDestinations = (user, destinations) =>
  destinations.filter((item) => canSeeRoute(user, item.to));