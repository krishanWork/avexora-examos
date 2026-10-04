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
import { useToast } from "@/components/ui/use-toast";
import { appClient } from "@/api/appClient";
import { Building2, Loader2, KeyRound, Copy, Check, IndianRupee } from "lucide-react";

const BOARD_TYPES = ["CBSE", "ICSE", "State Board", "IB", "Cambridge (IGCSE)", "Other"];

// Same slug rule as TenantFormDialog. The SERVER normalizes authoritatively via
// normalizeSubdomain/assertSubdomainUsable; this is only so the operator sees
// roughly what will be created before submitting. A client value the server
// rejects (too long, a reserved word) is answered with a real error, which is
// better than silently rewriting what they typed.
const slugify = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// Same rounding as server/affiliate-commission.js. See the note in Affiliates.jsx
// about why this is duplicated rather than fetched.
const previewCommission = (amount, rate) => {
  const value = Number(amount);
  const percent = Number(rate);
  if (!Number.isFinite(value) || value < 0) return 0;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return 0;
  return Math.round(value * percent) / 100;
};

// Sell a subscription to a school.
//
// The form creates THREE things the school needs to start: the institution, its
// first administrator login, and the record of what was paid. The school's
// administrator password is generated server-side and shown once here, because the
// affiliate has to hand it over and the app has no way to email it.
export default function SellSubscriptionDialog({ open, onOpenChange, plans, rate, onSold }) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    school_name: "",
    tenant_subdomain: "",
    board_type: "CBSE",
    address: "",
    school_contact_name: "",
    school_contact_email: "",
    school_contact_phone: "",
    plan_id: "",
  });

  const selectedPlan = plans?.find((p) => p.id === form.plan_id);
  const price = Number(selectedPlan?.price) || 0;
  const commission = previewCommission(price, rate);

  const reset = () => {
    setForm({
      school_name: "",
      tenant_subdomain: "",
      board_type: "CBSE",
      address: "",
      school_contact_name: "",
      school_contact_email: "",
      school_contact_phone: "",
      plan_id: "",
    });
    setCredentials(null);
    setCopied(false);
  };

  const handleClose = () => {
    if (submitting) return;
    // The school's admin password exists nowhere but this panel and the affiliate's
    // memory, so leaving accidentally would strand the school with no way in.
    if (credentials) {
      const confirmed = window.confirm(
        "Close without saving the school's login? That password cannot be shown again."
      );
      if (!confirmed) return;
    }
    reset();
    onOpenChange(false);
  };

  const handleCopyCredentials = async () => {
    if (!credentials) return;
    const text = [
      "ExamOS School Administrator Credentials",
      `Institution: ${credentials.tenant_name}`,
      `Portal: ${window.location.origin}/login?school=${credentials.tenant_subdomain}`,
      `Email: ${credentials.school_contact_email}`,
      `Password: ${credentials.school_admin_password}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied — send this to the school" });
    } catch {
      toast({ title: "Could not copy", description: "Select the password and copy it manually.", variant: "destructive" });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await appClient.affiliate.sell({
        school_name: form.school_name.trim(),
        tenant_subdomain: form.tenant_subdomain.trim(),
        board_type: form.board_type,
        address: form.address.trim(),
        plan_id: form.plan_id,
        school_contact_name: form.school_contact_name.trim(),
        school_contact_email: form.school_contact_email.trim(),
        school_contact_phone: form.school_contact_phone.trim(),
      });
      setCredentials({
        tenant_name: res.tenant?.name || form.school_name.trim(),
        tenant_subdomain: res.tenant?.subdomain || form.tenant_subdomain.trim(),
        school_contact_email: form.school_contact_email.trim(),
        school_admin_password: res.school_admin_password,
        commission_amount: res.sale?.commission_amount,
      });
      toast({
        title: "Sale recorded",
        description: `Commission of ₹${res.sale?.commission_amount} added to your balance.`,
      });
      if (onSold) onSold(res.sale);
    } catch (err) {
      toast({ title: "Could not complete the sale", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {credentials ? "Send these to the school" : "Sell a Subscription"}
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500 mt-0.5">
                {credentials
                  ? "The school administrator password is shown once and cannot be retrieved later."
                  : "Creates the institution, its administrator login, and your commission."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {credentials ? (
          <div className="space-y-4 py-2">
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-800 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-stone-500" /> School Administrator Password
                </span>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={handleCopyCredentials}>
                  {copied ? <Check className="w-3 h-3 mr-1 text-emerald-600" /> : <Copy className="w-3 h-3 mr-1" />}
                  {copied ? "Copied" : "Copy all"}
                </Button>
              </div>
              <code className="block select-all font-mono text-sm bg-white border border-stone-200 rounded-lg px-3 py-2 text-stone-900 break-all">
                {credentials.school_admin_password}
              </code>
              <div className="text-xs text-stone-600 space-y-0.5">
                <p>
                  <span className="text-stone-400">Institution:</span> {credentials.tenant_name}
                </p>
                <p>
                  <span className="text-stone-400">Portal:</span>{" "}
                  <span className="font-mono text-indigo-600">{credentials.tenant_subdomain}.avexora.in</span>
                </p>
                <p>
                  <span className="text-stone-400">Login:</span> {credentials.school_contact_email}
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-900">Commission credited</p>
                <p className="text-[11px] text-emerald-700">Payable once the platform approves it.</p>
              </div>
              <p className="text-xl font-bold text-emerald-700">₹{credentials.commission_amount}</p>
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
              <Label htmlFor="sell-school" className="text-xs font-semibold text-stone-700">
                Institution Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="sell-school"
                required
                value={form.school_name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    school_name: name,
                    // Suggest a subdomain until one is typed by hand, matching the
                    // behaviour of the institutions form.
                    tenant_subdomain:
                      !prev.tenant_subdomain || prev.tenant_subdomain === slugify(prev.school_name)
                        ? slugify(name)
                        : prev.tenant_subdomain,
                  }));
                }}
                placeholder="e.g. St. Xavier's International School"
                className="h-10"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sell-subdomain" className="text-xs font-semibold text-stone-700">
                  Portal Subdomain <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="sell-subdomain"
                    required
                    value={form.tenant_subdomain}
                    onChange={(e) => setForm({ ...form, tenant_subdomain: slugify(e.target.value) })}
                    placeholder="school-name"
                    className="h-10 font-mono text-xs pr-24"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 font-mono pointer-events-none">
                    .avexora.in
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sell-board" className="text-xs font-semibold text-stone-700">
                  Curriculum
                </Label>
                <select
                  id="sell-board"
                  value={form.board_type}
                  onChange={(e) => setForm({ ...form, board_type: e.target.value })}
                  className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"
                >
                  {BOARD_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-stone-100 pt-3 space-y-3">
              <p className="text-xs font-semibold text-stone-600">School Administrator</p>
              <div className="space-y-1.5">
                <Label htmlFor="sell-contact-name" className="text-xs font-semibold text-stone-700">
                  Contact Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="sell-contact-name"
                  required
                  value={form.school_contact_name}
                  onChange={(e) => setForm({ ...form, school_contact_name: e.target.value })}
                  placeholder="e.g. Dr. Rajesh Sharma"
                  className="h-10"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sell-contact-email" className="text-xs font-semibold text-stone-700">
                    Login Email <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="sell-contact-email"
                    type="email"
                    required
                    value={form.school_contact_email}
                    onChange={(e) => setForm({ ...form, school_contact_email: e.target.value })}
                    placeholder="principal@school.edu"
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sell-contact-phone" className="text-xs font-semibold text-stone-700">
                    Phone
                  </Label>
                  <Input
                    id="sell-contact-phone"
                    value={form.school_contact_phone}
                    onChange={(e) => setForm({ ...form, school_contact_phone: e.target.value })}
                    placeholder="+91 9876543210"
                    className="h-10"
                  />
                </div>
              </div>
              <p className="text-[11px] text-stone-500">
                This creates a login for the school. They must change the password on first sign-in.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sell-plan" className="text-xs font-semibold text-stone-700">
                Subscription Plan <span className="text-red-500">*</span>
              </Label>
              <select
                id="sell-plan"
                required
                value={form.plan_id}
                onChange={(e) => setForm({ ...form, plan_id: e.target.value })}
                className="h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm"
              >
                <option value="">Select a plan...</option>
                {(plans || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ₹{p.price}/{p.billing_cycle || "mo"}
                  </option>
                ))}
              </select>
            </div>

            {selectedPlan && (
              <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-600">Subscription value</span>
                  <span className="font-semibold text-stone-900">₹{price.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-600">Your commission ({rate}%)</span>
                  <span className="font-bold text-emerald-700 flex items-center gap-1">
                    <IndianRupee className="w-3.5 h-3.5" />
                    {commission.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-[11px] text-stone-500 pt-1">
                  Collect the subscription amount from the school (UPI or bank transfer) before submitting.
                  This app records the sale; it does not charge anyone.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0 pt-1">
              <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !form.plan_id || !form.school_name} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Building2 className="w-4 h-4 mr-2" />}
                {submitting ? "Creating..." : `Create & Earn ₹${commission.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}