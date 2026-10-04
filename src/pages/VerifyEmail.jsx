import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Loader2, MailCheck, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

/**
 * Landing page for the emailed verification link.
 *
 * The token is spent automatically on mount rather than behind a button. The
 * user clicked a link in a mail client; a second click to "confirm" is a chance
 * to get it wrong, and the request is idempotent-safe, so doing it immediately
 * is both simpler and more likely to succeed. The request is guarded so a
 * re-render, a React strict-mode double-invoke or a back/forward navigation
 * cannot spend the token twice — a replay is rejected by the server, which would
 * otherwise show a spurious "invalid link" after a successful verification.
 */
export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const [state, setState] = useState(token ? "working" : "error");
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("This link is missing its verification token. Request a new one from the sign-in page.");
      return;
    }
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await appClient.auth.verifyEmail(token);
        setState("success");
        setMessage(res?.email ? `${res.email} is verified.` : "Your email address is verified.");
        // Clear the token from the address bar so a later copy/paste or a shared
        // history entry cannot replay a spent credential.
        window.history.replaceState({}, "", "/verify-email");
        setTimeout(() => navigate("/login", { replace: true }), 2500);
      } catch (err) {
        setState("error");
        setMessage(
          err.message ||
            "This verification link is invalid or has expired. Request a new one from the sign-in page."
        );
      }
    })();
  }, [token, navigate]);

  const body = (() => {
    if (state === "working") {
      return (
        <>
          <Loader2 className="w-10 h-10 mx-auto text-stone-400 animate-spin" />
          <p className="mt-4 text-stone-600">Verifying your email address…</p>
        </>
      );
    }
    if (state === "success") {
      return (
        <>
          <MailCheck className="w-10 h-10 mx-auto text-green-600" />
          <p className="mt-4 text-stone-600">{message}</p>
          <p className="mt-2 text-sm text-stone-500">Taking you to the sign-in page…</p>
        </>
      );
    }
    return (
      <>
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
        <p className="mt-4 text-stone-600">{message}</p>
      </>
    );
  })();

  return (
    <AuthLayout
      icon={state === "success" ? MailCheck : AlertTriangle}
      title={state === "success" ? "Email verified" : "Verification failed"}
      subtitle="Account activation"
    >
      <div className="text-center">{body}</div>
      <div className="mt-6 flex justify-center">
        <a href="/login" className="text-sm font-medium text-stone-900 underline">
          Go to sign in
        </a>
      </div>
    </AuthLayout>
  );
}
