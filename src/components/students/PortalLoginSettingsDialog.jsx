import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, Info } from "lucide-react";
import { appClient } from "@/api/appClient";
import { useToast } from "@/components/ui/use-toast";

/**
 * School-wide portal login settings: the default password applied to every
 * brand-new student/parent portal account. Only affects NEW accounts; each
 * user is forced to change it on first login.
 */
export default function PortalLoginSettingsDialog({ open, onOpenChange, tenant, onSaved }) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showExisting, setShowExisting] = useState(false);

  const currentValue = tenant?.student_default_password || "";

  const handleOpenChange = (next) => {
    if (!next) {
      setValue("");
      setError("");
    }
    onOpenChange(next);
  };

  const handleSave = async () => {
    setError("");
    if (!value || value.length < 8) {
      setError("The default password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await appClient.entities.Tenant.update(tenant.id, { student_default_password: value });
      toast({ title: "Default password updated", description: "Applies to new student/parent logins only." });
      if (onSaved) onSaved({ student_default_password: value });
      handleOpenChange(false);
    } catch (err) {
      setError(err.message || "Failed to update the default password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-stone-500" />
            Portal Login Settings
          </DialogTitle>
          <DialogDescription>
            The default password given to every new student and parent portal account in this
            institution. Each account must change it on the first sign-in, and existing accounts
            are never affected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 bg-stone-50 border border-stone-200 rounded-lg p-3">
            <Info className="w-4 h-4 text-stone-500 mt-0.5 shrink-0" />
            <p className="text-xs text-stone-600">
              Share this password with students/parents along with their login email. A plaintext
              value is required here because it is a known shared default that you distribute; it
              is only ever stored server-side and is never emailed or logged.
            </p>
          </div>

          {currentValue && (
            <div className="text-sm">
              <p className="text-xs text-stone-400 mb-1">Current default</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base text-stone-800">
                  {showExisting ? currentValue : "••••••••"}
                </span>
                <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setShowExisting((v) => !v)}>
                  {showExisting ? "Hide" : "Reveal"}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="default-password">Set default password</Label>
            <Input
              id="default-password"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="New default password (min 8 characters)"
              minLength={8}
              autoComplete="off"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save default
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}