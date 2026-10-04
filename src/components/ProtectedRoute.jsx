import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import NoAssignedRoleError from '@/components/NoAssignedRoleError';
import EmailUnverifiedError from '@/components/EmailUnverifiedError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const { isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth, user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) {
    return fallback;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    if (authError.type === 'no_assigned_role') {
      return <NoAssignedRoleError message={authError.message} />;
    }
    if (authError.type === 'email_unverified') {
      return <EmailUnverifiedError message={authError.message} email={authError.email} />;
    }
    return unauthenticatedElement;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  // /api/auth/me is on the server's verification allowlist, so it answers 200 for
  // an unverified account — the auth check above therefore succeeds and
  // authError stays null. Without this branch the app shell would render and
  // every subsequent request would fail with a bare EMAIL_UNVERIFIED 403, which
  // is exactly the confusing state this is meant to prevent. Checking the flag
  // on the user we already have is also cheaper than a second round trip.
  if (user?.email_verified === false) {
    return <EmailUnverifiedError email={user?.email || null} />;
  }

  if (user?.must_change_password === true && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
