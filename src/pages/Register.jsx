import React, { useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Lock, Building, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { rolePortal } from "@/lib/roles";

export default function Register() {
  const [fullName, setFullName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await appClient.auth.register({
        email,
        password,
        full_name: fullName,
        school_name: schoolName,
      });

      const user = res.user || (await appClient.auth.me().catch(() => null));
      // A fresh self-registration is unverified, so the server will refuse every
      // application route. Sending the user into the app would land them on a
      // generic error page, so go straight to the pending screen the gate
      // renders. The token is deliberately kept in place: resending requires it.
      if (res.verification_required || res.email_verified === false) {
        window.location.href = "/home";
        return;
      }
      window.location.href = rolePortal(user) || "/home";
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    appClient.auth.loginWithProvider("google");
  };

  return (
    <AuthLayout
      icon={UserPlus}
      title="Create your account"
      subtitle="Sign up to start evaluating OMR exams"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <Button
        variant="outline"
        className="w-full h-11 text-sm font-medium mb-6"
        onClick={handleGoogle}
      >
        <GoogleIcon className="w-5 h-5 mr-2" />
        Continue with Google
      </Button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">or</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full Name</Label>
          <Input
            id="fullName"
            type="text"
            placeholder="Dr. Rajesh Sharma"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-11"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="schoolName">Institution / School Name</Label>
          <div className="relative">
            <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="schoolName"
              type="text"
              placeholder="Delhi Public Academy"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="pl-10 h-11"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Work Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="admin@school.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-11"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-11"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-11"
              required
            />
          </div>
          {confirmPassword && password !== confirmPassword && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </div>

        <Button type="submit" className="w-full h-11 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating account & institution...
            </>
          ) : (
            "Create Account"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
