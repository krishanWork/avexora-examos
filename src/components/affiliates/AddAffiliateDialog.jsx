import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { appClient } from "@/api/appClient";
import { UserPlus, Loader2, KeyRound, Copy, Check, AlertTriangle } from "lucide-react";

// Appoint a reseller.
//
// The generated password is shown ONCE, in a panel that replaces the form after a
// successful submit. The server returns it in the create response and never stores
// it in plaintext, so it cannot be read back off the profile — which is why this
// screen has to make the operator capture it rather than offering a "regenerate and
// email" convenience that would require storing or mailing the secret.
export default function AddAffiliateDialog({ open, onOpenChange, onCreated }) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    commission_rate: "20",
    code: "",
    status: "active",
  });

  const reset = () => {
    setForm({ full_name: "", email: "", phone: "", commission_rate: "20", code: "", status: "active" });
    setCredentials(null);
    setCopied(false);
  };

  const handleClose = () => {
    if (submitting) return;
    // Closing discards the one-time password permanently. Confirm rather than
    // silently losing it, because the operator may not have copied it yet and the
    // only remedy afterwards is a password reset.
    if (credentials) {
      const confirmed = window.confirm(
        "Close without saving these credentials? The generated password cannot be shown again."
      );
      if (!confirmed) return;
    }
    reset();
    onOpenChange(false);
  };

  const handleCopyCredentials = async () => {
    if (!credentials) return;
    const text = [
      "Avexora Affiliate Credentials",
      `Name: ${credentials.full_name}`,
      `Email: ${credentials.email}`,
      `Portal: ${window.location.origin}/login`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Credentials copied — the password is not shown again" });
    } catch {
      toast({ title: "Could not copy", description: "Select the password and copy it manually.", variant: "destructive" });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Validate the rate here rather than relying on the server's 400, so the
    // operator gets an inline message next to the field instead of a toast about
    // something they are still looking at. The server validates independently —
    // this is convenience, never the enforcement point.
    const rate = Number(form.commission_rate);
    if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
      toast({ title: "Invalid commission rate", description: "Enter a whole number between 0 and 100.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await appClient.affiliate.create({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        commission_rate: rate,
        code: form.code.trim(),
        status: form.status,
      });
      setCredentials({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        generated_password: res.generated_password,
      });
      toast({ title: "Affiliate created", description: `${form.email.trim()} can now sign in.` });
      if (onCreated) onCreated(res.affiliate);
    } catch (err) {
      toast({ title: "Failed to create affiliate", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {credentials ? "Save these credentials" : "Add Affiliate"}
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500 mt-0.5">
                {credentials
                  ? "This password is shown once and cannot be retrieved later."
                  : "Create a reseller login and set the commission they earn on each institution they sell."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {credentials ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900">
                Copy this password now. It is stored only as a bcrypt hash, so nobody — including you —
                can read it back. If it is lost, the affiliate must use password reset.
              </p>
            </div>

            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-800 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-stone-500" /> Login Password
                </span>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={handleCopyCredentials}>
                  {copied ? <Check className="w-3 h-3 mr-1 text-emerald-600" /> : <Copy className="w-3 h-3 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <code className="block select-all font-mono text-sm bg-white border border-stone-200 rounded-lg px-3 py-2 text-stone-900 break-all">
                {credentials.generated_password}
              </code>
              <p className="text-xs text-stone-500">
                <span className="font-medium text-stone-700">{credentials.email}</span> ·{" "}
                <a href="/affiliate-portal" className="text-indigo-600 hover:underline">
                  /login
                </a>{" "}
                then lands on the affiliate portal.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="aff-full-name" className="text-xs font-semibold text-stone-700">
                Full Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="aff-full-name"
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="e.g. Rahul Verma"
                className="h-10"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="aff-email" className="text-xs font-semibold text-stone-700">
                  Login Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="aff-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="affiliate@partner.com"
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aff-phone" className="text-xs font-semibold text-stone-700">
                  Phone
                </Label>
                <Input
                  id="aff-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 9876543210"
                  className="h-10"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="aff-rate" className="text-xs font-semibold text-stone-700">
                  Commission Rate <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="aff-rate"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    required
                    value={form.commission_rate}
                    onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                    className="h-10 pr-9"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">%</span>
                </div>
                <p className="text-[11px] text-stone-500">Applied to each future sale they make.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aff-code" className="text-xs font-semibold text-stone-700">
                  Referral Code
                </Label>
                <Input
                  id="aff-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="Optional"
                  className="h-10 font-mono text-xs"
                />
                <p className="text-[11px] text-stone-500">3–24 characters. Letters, numbers, dash, underscore.</p>
              </div>
            </div>

            <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-1.5">
              <p className="text-xs font-semibold text-stone-600">What this account can do</p>
              <ul className="text-[11px] text-stone-500 space-y-0.5 list-disc pl-4">
                <li>Sign in and see its own commission balance and sales history</li>
                <li>Create an institution and its school administrator login, and earn commission on the plan</li>
                <li className="text-stone-400">
                  Read nothing else — no students, no school data, no other affiliate&rsquo;s ledger
                </li>
              </ul>
              <Badge variant="outline" className="text-[10px] font-mono uppercase bg-white">
                app_roles: ["affiliate"]
              </Badge>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Create Affiliate
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}