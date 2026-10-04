import React from 'react';
import { appClient } from '@/api/appClient';

/**
 * Shown when the session is valid but the account carries no app_role. The
 * server fails closed here rather than defaulting the account to a privileged
 * role, so this is a provisioning gap the institution admin has to fix — not an
 * authentication failure. The token is intentionally kept so the user can
 * retry after the role is assigned.
 */
const NoAssignedRoleError = ({ message = null }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-white to-stone-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-lg border border-stone-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-stone-100">
            <svg className="w-8 h-8 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-4">No Role Assigned</h1>
          <p className="text-stone-600 mb-8">
            {message || 'Your account is active but has no role assigned, so it has no access to any part of the application.'}
          </p>
          <div className="p-4 bg-stone-50 rounded-md text-sm text-stone-600 text-left">
            <p>To get access:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Ask your institution administrator to assign you a role</li>
              <li>Or ask a super administrator to check the account was provisioned</li>
              <li>Then try again — no need to sign out</li>
            </ul>
          </div>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium text-white bg-stone-900 rounded-md hover:bg-stone-700"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => appClient.auth.logout('/login')}
              className="px-4 py-2 text-sm font-medium text-stone-700 border border-stone-300 rounded-md hover:bg-stone-50"
            >
              Sign in as someone else
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoAssignedRoleError;
