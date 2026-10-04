import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Building2,
  Palette,
  CreditCard,
  Mail,
  Sparkles,
  Check,
} from "lucide-react";

const BOARD_TYPES = ["CBSE", "ICSE", "State Board", "IB", "Cambridge (IGCSE)", "Other"];

const COLOR_PRESETS = [
  { name: "Indigo", hex: "#4F46E5" },
  { name: "Emerald", hex: "#047857" },
  { name: "Violet", hex: "#7C3AED" },
  { name: "Blue", hex: "#1E40AF" },
  { name: "Rose", hex: "#E11D48" },
  { name: "Amber", hex: "#D97706" },
  { name: "Slate", hex: "#334155" },
];

const EMAIL_RE = /\S+@\S+\.\S+/;
const slugify = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export default function TenantFormDialog({ open, onOpenChange, tenant, plans, onSave }) {
  const [form, setForm] = useState({});
  const [emailError, setEmailError] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  useEffect(() => {
    setForm(
      tenant || {
        name: "",
        subdomain: "",
        contact_email: "",
        contact_phone: "",
        address: "",
        board_type: "CBSE",
        subscription_plan_id: plans?.[0]?.id || "",
        white_label_enabled: false,
        primary_color: "#4F46E5",
        logo_url: "",
        status: "active",
      }
    );
    setEmailError(false);
    setActiveTab("general");
  }, [tenant, open, plans]);

  const selectedPlan = plans?.find((p) => p.id === form.subscription_plan_id);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (form.contact_email && !EMAIL_RE.test(form.contact_email)) {
      setEmailError(true);
      setActiveTab("general");
      return;
    }
    setEmailError(false);
    const plan = plans?.find((p) => p.id === form.subscription_plan_id);
    const { _id: _oid, id: _uid, ...formData } = form;
    const name = String(formData.name || "").trim();
    const subdomain = slugify(formData.subdomain || "") || slugify(name);

    onSave({
      ...formData,
      name,
      subdomain,
      plan_name: plan?.name || "",
      white_label_enabled: plan?.white_label_enabled ? Boolean(form.white_label_enabled) : false,
      primary_color: form.primary_color || "#4F46E5",
      logo_url: form.logo_url || "",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-stone-200 bg-stone-50/50 space-y-0 text-left">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold font-heading text-stone-900">
                {tenant ? "Edit Institution Profile" : "Onboard New Institution"}
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500 mt-0.5">
                {tenant
                  ? `Update configuration, branding, and access for ${tenant.name}.`
                  : "Provision a new tenant school with custom branding, subdomain, and plan."}
              </DialogDescription>
            </div>
          </div>

          {/* Section Navigation Tabs */}
          <div className="flex items-center gap-1.5 mt-4 pt-2 border-t border-stone-200/70">
            <button
              type="button"
              onClick={() => setActiveTab("general")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                activeTab === "general"
                  ? "bg-white text-indigo-700 shadow-sm border border-stone-200"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <Building2 className="w-3.5 h-3.5" /> General & Affiliation
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("branding")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                activeTab === "branding"
                  ? "bg-white text-indigo-700 shadow-sm border border-stone-200"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <Palette className="w-3.5 h-3.5" /> Branding & Logo
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("subscription")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                activeTab === "subscription"
                  ? "bg-white text-indigo-700 shadow-sm border border-stone-200"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" /> Plan & Status
            </button>
          </div>
        </DialogHeader>

        {/* Form Body */}
        <form
          id="p6-tenant-form"
          onSubmit={handleSubmit}
          className="p-6 space-y-4 max-h-[60vh] overflow-y-auto"
        >
          {activeTab === "general" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="p6-tenant-name" className="text-xs font-semibold text-stone-700">
                  Institution Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="p6-tenant-name"
                  placeholder="e.g. St. Xavier's International School"
                  required
                  value={form.name || ""}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      name,
                      // Auto-suggest subdomain if not manually modified
                      subdomain: !prev.subdomain || prev.subdomain === slugify(prev.name)
                        ? slugify(name)
                        : prev.subdomain,
                    }));
                  }}
                  className="h-10 text-sm font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="p6-tenant-subdomain" className="text-xs font-semibold text-stone-700">
                    Subdomain Slug <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="p6-tenant-subdomain"
                      placeholder="school-name"
                      required
                      value={form.subdomain || ""}
                      onChange={(e) =>
                        setForm({ ...form, subdomain: slugify(e.target.value) })
                      }
                      className="h-10 font-mono text-xs pr-20"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 select-none font-mono pointer-events-none">
                      .avexora.in
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500">
                    Portal link: <span className="font-mono text-indigo-600">https://{form.subdomain || "slug"}.avexora.in</span>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="p6-tenant-board" className="text-xs font-semibold text-stone-700">
                    Curriculum / Board
                  </Label>
                  <Select
                    value={form.board_type || "CBSE"}
                    onValueChange={(v) => setForm({ ...form, board_type: v })}
                  >
                    <SelectTrigger id="p6-tenant-board" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BOARD_TYPES.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t border-stone-100 pt-3 space-y-3">
                <p className="text-xs font-semibold text-stone-600 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-stone-400" /> Administrative Contact
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="p6-tenant-email" className="text-xs text-stone-600">
                      Primary Contact Email
                    </Label>
                    <Input
                      id="p6-tenant-email"
                      type="email"
                      placeholder="principal@institution.edu"
                      value={form.contact_email || ""}
                      onChange={(e) => {
                        setForm({ ...form, contact_email: e.target.value });
                        if (emailError) setEmailError(false);
                      }}
                      className="h-10 text-xs"
                    />
                    {emailError && (
                      <p className="text-xs text-destructive">Enter a valid email address</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p6-tenant-phone" className="text-xs text-stone-600">
                      Phone Number
                    </Label>
                    <Input
                      id="p6-tenant-phone"
                      placeholder="+91 9876543210"
                      value={form.contact_phone || ""}
                      onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                      className="h-10 text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="p6-tenant-address" className="text-xs text-stone-600">
                    Physical Campus Address
                  </Label>
                  <Input
                    id="p6-tenant-address"
                    placeholder="e.g. Sector 14, Institutional Area, New Delhi"
                    value={form.address || ""}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="h-10 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "branding" && (
            <div className="space-y-5">
              {/* Brand Color */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-stone-700 flex items-center justify-between">
                  <span>Brand Accent Color</span>
                  <span className="font-mono text-xs text-stone-500 font-normal">
                    {form.primary_color || "#4F46E5"}
                  </span>
                </Label>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setForm({ ...form, primary_color: c.hex })}
                      className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform hover:scale-105 relative border border-black/10 shadow-sm"
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    >
                      {form.primary_color?.toLowerCase() === c.hex.toLowerCase() && (
                        <Check className="w-4 h-4 text-white stroke-[3]" />
                      )}
                    </button>
                  ))}
                  <div className="flex items-center gap-2 ml-2">
                    <input
                      type="color"
                      value={form.primary_color || "#4F46E5"}
                      onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                      className="w-9 h-9 rounded-xl border border-stone-200 cursor-pointer p-0.5"
                    />
                    <Input
                      value={form.primary_color || ""}
                      onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                      placeholder="#4F46E5"
                      className="w-24 h-9 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Logo URL */}
              <div className="space-y-2">
                <Label htmlFor="p6-tenant-logo" className="text-xs font-semibold text-stone-700">
                  School Crest / Logo URL
                </Label>
                <div className="flex items-center gap-3">
                  <div
                    className="w-14 h-14 rounded-2xl border-2 border-dashed border-stone-200 flex items-center justify-center overflow-hidden shrink-0 bg-stone-50 shadow-inner"
                    style={{
                      borderColor: form.primary_color ? `${form.primary_color}40` : undefined,
                    }}
                  >
                    {form.logo_url ? (
                      <img
                        src={form.logo_url}
                        alt="Logo Preview"
                        className="w-full h-full object-contain p-1"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <Building2 className="w-6 h-6 text-stone-300" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <Input
                      id="p6-tenant-logo"
                      placeholder="https://example.com/logo.png"
                      value={form.logo_url || ""}
                      onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                      className="h-10 text-xs font-mono"
                    />
                    <p className="text-[11px] text-stone-400">
                      PNG or SVG with transparent background recommended.
                    </p>
                  </div>
                </div>
              </div>

              {/* Live Preview Card */}
              <div className="p-4 rounded-xl border border-stone-200 bg-stone-50/70 space-y-2">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                  School Header Preview
                </p>
                <div className="p-3 bg-white rounded-lg border border-stone-200/80 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold font-heading text-sm shadow-sm"
                      style={{ backgroundColor: form.primary_color || "#4F46E5" }}
                    >
                      {form.logo_url ? (
                        <img
                          src={form.logo_url}
                          alt="Logo"
                          className="w-full h-full object-contain p-1"
                        />
                      ) : (
                        (form.name || "School")
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-stone-900 leading-none">
                        {form.name || "Institution Name"}
                      </p>
                      <p className="text-xs text-stone-400 font-mono mt-1">
                        {form.subdomain || "subdomain"}.avexora.in
                      </p>
                    </div>
                  </div>
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${form.primary_color || "#4F46E5"}15`,
                      color: form.primary_color || "#4F46E5",
                    }}
                  >
                    {form.board_type || "CBSE"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "subscription" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="p6-tenant-plan" className="text-xs font-semibold text-stone-700">
                  Subscription Tier <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={form.subscription_plan_id || ""}
                  onValueChange={(v) => {
                    const chosen = plans?.find((p) => p.id === v);
                    setForm({
                      ...form,
                      subscription_plan_id: v,
                      white_label_enabled: chosen?.white_label_enabled
                        ? form.white_label_enabled
                        : false,
                    });
                  }}
                >
                  <SelectTrigger id="p6-tenant-plan" className="h-11">
                    <SelectValue placeholder="Select an enterprise plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {(plans || []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <div className="flex items-center justify-between gap-4 w-full">
                          <span className="font-semibold text-stone-900">{p.name}</span>
                          <span className="text-xs text-stone-500 font-mono">
                            ₹{p.price}/{p.billing_cycle || "mo"} · {p.student_limit} students
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPlan && (
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-600 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Student Quota:</span>
                    <span className="font-semibold text-stone-900">
                      {selectedPlan.student_limit?.toLocaleString()} students
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>OMR Sheets Quota:</span>
                    <span className="font-semibold text-stone-900">
                      {selectedPlan.omr_sheet_limit?.toLocaleString()} sheets / mo
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Custom Domain Supported:</span>
                    <span
                      className={`font-semibold ${
                        selectedPlan.custom_domain_enabled
                          ? "text-emerald-600"
                          : "text-stone-400"
                      }`}
                    >
                      {selectedPlan.custom_domain_enabled ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              )}

              {selectedPlan?.white_label_enabled ? (
                <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50/40 rounded-xl p-3.5">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> White-Label Branding
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      Enables custom school logo, distinct theme colors, and branded login.
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(form.white_label_enabled)}
                    onCheckedChange={(v) => setForm({ ...form, white_label_enabled: v })}
                  />
                </div>
              ) : null}

              {tenant ? (
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="p6-tenant-status" className="text-xs font-semibold text-stone-700">
                    Account Status
                  </Label>
                  <Select
                    value={form.status || "active"}
                    onValueChange={(v) => setForm({ ...form, status: v })}
                  >
                    <SelectTrigger id="p6-tenant-status" className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" /> Active
                        </span>
                      </SelectItem>
                      <SelectItem value="suspended">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-500" /> Suspended
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          )}
        </form>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-stone-200 bg-stone-50/50 flex items-center justify-between">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="p6-tenant-form"
            disabled={!form.name || !form.subscription_plan_id}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5"
          >
            {tenant ? "Save Changes" : "Complete Onboarding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
