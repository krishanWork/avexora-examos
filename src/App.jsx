import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import ScrollToTop from "./components/ScrollToTop";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import ChangePassword from "./pages/ChangePassword";
import AppLayout from "@/components/layout/AppLayout";
import Home from "./pages/Home";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import PlatformInsights from "./pages/PlatformInsights";
import Tenants from "./pages/Tenants";
import SubscriptionPlans from "./pages/SubscriptionPlans";
import PlanRequests from "./pages/PlanRequests";
import PlatformBranding from "./pages/PlatformBranding";
import Employees from "./pages/Employees";
import SchoolDashboard from "./pages/SchoolDashboard";
import Students from "./pages/Students";
import StudentDetail from "./pages/StudentDetail";
import Teachers from "./pages/Teachers";
import Examinations from "./pages/Examinations";
import PerformanceDashboard from "./pages/PerformanceDashboard";
import ExamDetail from "./pages/ExamDetail";
import StudentPortal from "./pages/StudentPortal";
import TeacherPortal from "./pages/TeacherPortal";
import StaffAccess from "./pages/StaffAccess";
import AcademicSetup from "./pages/AcademicSetup";
import Parents from "./pages/Parents";
import Enrollments from "./pages/Enrollments";
import Analytics from "./pages/Analytics";
import Billing from "./pages/Billing";
import Attendance from "./pages/Attendance";
import Timetable from "./pages/Timetable";
import Assignments from "./pages/Assignments";
import Announcements from "./pages/Announcements";
import RoleGuard from "@/components/RoleGuard";
import { PAGE_ROLES } from "@/lib/permissions";
import ParentPortal from "./pages/ParentPortal";
import WhiteLabelSettings from "./pages/WhiteLabelSettings";
import AuditLogs from "./pages/AuditLogs";
import LeadManagement from "./pages/LeadManagement";
import Affiliates from "./pages/Affiliates";
import AffiliatePortal from "./pages/AffiliatePortal";
import Checkout from "./pages/Checkout";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import Landing from "./pages/marketing/Landing";
import Pricing from "./pages/marketing/Pricing";
import Contact from "./pages/marketing/Contact";
import BookDemo from "./pages/marketing/BookDemo";
import Terms from "./pages/marketing/Terms";
import Privacy from "./pages/marketing/Privacy";

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
        <div className="w-8 h-8 border-4 border-stone-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors that require user registration
  if (authError?.type === "user_not_registered") {
    return <UserNotRegisteredError />;
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/s/:school" element={<Login />} />
      <Route path="/s/:school/login" element={<Login />} />
      <Route path="/portal/:school" element={<Login />} />
      <Route path="/institute/:school" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Unauthenticated on purpose: the recipient is often in a browser that
          never held a session. The token is the credential. */}
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/book-demo" element={<BookDemo />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
      </Route>
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<RoleGuard roles={PAGE_ROLES.checkout} />}>
          <Route path="/checkout" element={<Checkout />} />
        </Route>
        {/* These portals are per-role surfaces, not generic authenticated pages.
            ProtectedRoute only proves a session exists; without a RoleGuard any
            staff account could navigate straight into another role's portal. The
            server scopes the rows regardless, so this is defence in depth at the
            route boundary rather than the enforcement point. */}
        <Route element={<RoleGuard roles={PAGE_ROLES.studentPortal} />}>
          <Route path="/student-portal" element={<StudentPortal />} />
        </Route>
        <Route element={<RoleGuard roles={PAGE_ROLES.parentPortal} />}>
          <Route path="/parent-portal" element={<ParentPortal />} />
        </Route>
        <Route element={<AppLayout />}>
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/home" element={<Home />} />
          <Route element={<RoleGuard roles={PAGE_ROLES.affiliatePortal} />}>
            <Route path="/affiliate-portal" element={<AffiliatePortal />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.platform} />}>
            <Route path="/super-admin" element={<SuperAdminDashboard />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.institutions} />}>
            <Route path="/institutions" element={<Tenants />} />
            <Route path="/tenants" element={<Navigate to="/institutions" replace />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.superAdminOnly} />}>
            <Route path="/insights" element={<PlatformInsights />} />
            <Route path="/leads" element={<LeadManagement />} />
            <Route path="/leads-management" element={<Navigate to="/leads" replace />} />
            <Route path="/plans" element={<SubscriptionPlans />} />
            <Route path="/subscription-plans" element={<Navigate to="/plans" replace />} />
            <Route path="/platform-branding" element={<PlatformBranding />} />
            <Route path="/employees" element={<Employees />} />
          </Route>
          {/* Its own group rather than a member of superAdminOnly: the affiliate
              console is a money surface and will diverge from the platform list —
              an `employee` may legitimately be allowed to SEE affiliates later while
              still being refused every commission and payout action. */}
          <Route element={<RoleGuard roles={PAGE_ROLES.affiliateManagement} />}>
            <Route path="/affiliates" element={<Affiliates />} />
          </Route>
          {/* Also its own group, and also admitted to `employee`: approving a plan
              change grants a paid entitlement and writes a Payment, which is the
              support console's job. It is deliberately not `institutions`, so a future
              widening of the read-only institutions list cannot silently hand this
              route out. */}
          <Route element={<RoleGuard roles={PAGE_ROLES.planRequests} />}>
            <Route path="/plan-requests" element={<PlanRequests />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.staff} />}>
            <Route path="/dashboard" element={<SchoolDashboard />} />
            <Route path="/teacher-portal" element={<TeacherPortal />} />
            <Route path="/examinations" element={<Examinations />} />
            <Route path="/examinations/:id" element={<ExamDetail />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.studentAdmin} />}>
            <Route path="/students" element={<Students />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.studentDetail} />}>
            <Route path="/students/:id" element={<StudentDetail />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.crmAdmin} />}>
            <Route path="/parents" element={<Parents />} />
            <Route path="/enrollments" element={<Enrollments />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.schoolStructure} />}>
            <Route path="/teachers" element={<Teachers />} />
            <Route path="/academic-setup" element={<AcademicSetup />} />
            <Route path="/analytics" element={<Analytics />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.staffManagement} />}>
            <Route path="/staff" element={<StaffAccess />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.schoolAdmin} />}>
            <Route path="/billing" element={<Billing />} />
            <Route path="/white-label" element={<WhiteLabelSettings />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.auditLogs} />}>
            <Route path="/audit-logs" element={<AuditLogs />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.performance} />}>
            <Route path="/performance" element={<PerformanceDashboard />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.attendance} />}>
            <Route path="/attendance" element={<Attendance />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.timetable} />}>
            <Route path="/timetable" element={<Timetable />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.assignments} />}>
            <Route path="/assignments" element={<Assignments />} />
          </Route>
          <Route element={<RoleGuard roles={PAGE_ROLES.announcements} />}>
            <Route path="/announcements" element={<Announcements />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;