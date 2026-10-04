import React, { useState } from "react";
import { appClient } from "@/api/appClient";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, AlertTriangle } from "lucide-react";

export default function DeleteAccountDialog({ open, onOpenChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");

  const handleDelete = async () => {
    if (!password) {
      setError("Enter your current password to confirm.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await appClient.functions.invoke("deleteMyAccount", { password });
      if (data?.error) throw new Error(data.error);
      appClient.auth.logout("/login");
    } catch (e) {
      setError(e.message || "Could not delete your account. Please try again.");
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" /> Delete Account
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete your account and sign you out. You will lose access
            to this app and this action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <label htmlFor="delete-account-password" className="text-sm font-medium text-stone-700">
            Confirm your current password
          </label>
          <Input
            id="delete-account-password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="Your current password"
            className="mt-1"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={handleDelete} disabled={busy || !password}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Permanently Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}