import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Lock, Loader2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import { rolePortal } from "@/lib/roles";
import { useAuth } from "@/lib/AuthContext";

export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, checkUserAuth } = useAuth();

  const forced = user?.must_change_password === true;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await appClient.auth.changePassword({ currentPassword, newPassword });
      await checkUserAuth();
      navigate(rolePortal(user) || "/home", { replace: true });
    } catch (err) {
      setError(err.message || "Unable to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-lg mx-auto space-y-6">
      <PageHeader
        title={forced ? "Set a new password" : "Change password"}
        description={forced ? "For your security, you must set a new password before continuing." : "Update the password for your account"}
        actions={
          !forced && (
            <Button asChild size="sm" variant="ghost">
              <Link to={rolePortal(user) || "/home"}>
                <ChevronLeft className="w-4 h-4 mr-1.5" /> Back to Dashboard
              </Link>
            </Button>
          )
        }
      />
      <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 shadow-sm space-y-5">
        {forced && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-600">
            This is your first login with a temporary password. Choose a new,
            unique password to continue.
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 text-rose-600 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="pl-10 h-11"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pl-10 h-11"
              minLength={8}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-11"
              minLength={8}
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-11 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Set new password"
          )}
        </Button>
      </form>
      </div>
    </div>
  );
}