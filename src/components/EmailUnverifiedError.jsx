import React, { useState } from 'react';
import { appClient } from '@/api/appClient';

/**
 * Shown when the session is valid but the address has not been proven. The
 * server withholds all application access behind an allowlist until then, so
 * this is a pending state rather than an authentication failure.
 *
 * The session token is intentionally kept: the resend endpoint is
 * authenticated, so signing out here would remove the user's only way to get
 * another link.
 */
const EmailUnverifiedError = ({ message = null, email = null }) => {
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  const resend = async () => {
    setSending(true);
    setStatus(null);
    try {
      const res = await appClient.auth.resendVerification();
      if (res?.already_verified) {
        setStatus({ tone: 'ok', text: 'This address is already verified. Reloading…' });
        window.location.reload();
        return;
      }
      // `delivered` is reported rather than assumed. Claiming "we emailed you"
      // when SMTP is not configured is how a support ticket becomes "I never got
      // an email" for an account that was never mailed one.
      setStatus(
        res?.delivered
          ? { tone: 'ok', text: `Verification link sent to ${res.email || email || 'your address'}.` }
          : { tone: 'warn', text: 'We could not send an email automatically. Ask your administrator to confirm your address, or try again shortly.' }
      );
    } catch (error) {
      setStatus({ tone: 'warn', text: error.message || 'Could not send another email. Please try again.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-white to-stone-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-lg border border-stone-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-stone-100">
            <svg className="w-8 h-8 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-4">Verify your email</h1>
          <p className="text-stone-600 mb-8">
            {message || 'Confirm your email address to activate your account and continue.'}
          </p>
          {email && <p className="text-sm text-stone-500 mb-6">Pending address: {email}</p>}
          <div className="p-4 bg-stone-50 rounded-md text-sm text-stone-600 text-left">
            <p>To get access:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Open the verification link we emailed you</li>
              <li>If it expired, request a new one below</li>
              <li>Then continue — no need to sign out</li>
            </ul>
          </div>
          {status && (
            <p
              role="status"
              className={`mt-4 text-sm ${
                status.tone === 'ok' ? 'text-green-700' : 'text-amber-700'
              }`}
            >
              {status.text}
            </p>
          )}
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium text-white bg-stone-900 rounded-md hover:bg-stone-700"
            >
              I have verified — continue
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={sending}
              className="px-4 py-2 text-sm font-medium text-stone-700 border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Resend email'}
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

export default EmailUnverifiedError;
