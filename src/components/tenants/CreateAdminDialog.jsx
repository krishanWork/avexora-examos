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
import {
  UserPlus,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";

export default function CreateAdminDialog({ open, onOpenChange, tenant, onSuccess }) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });

  const handleGeneratePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
    let pwd = "";
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setForm((prev) => ({ ...prev, password: pwd, confirmPassword: pwd }));
    toast({
      title: "Generated strong password",
      description: "Password filled in both fields. Copy or save it before submitting.",
    });
  };

  const handleCopyCredentials = () => {
    const text = `ExamOS School Admin Credentials\nInstitution: ${tenant?.name || ""}\nEmail: ${form.email}\nPassword: ${form.password}\nLogin URL: ${window.location.origin}/login?school=${tenant?.subdomain || ""}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Credentials copied to clipboard!" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!tenant?.id) return;

    setSubmitting(true);
    try {
      await appClient.users.provisionUser({
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        role: "school_admin",
        tenant_id: tenant.id,
      });

      toast({
        title: "School Admin Created Successfully",
        description: `Account for ${form.email} has been provisioned.`,
      });

      onOpenChange(false);
      setForm({
        full_name: "",
        email: "",
        phone: "",
        password: "",
        confirmPassword: "",
      });
      if (onSuccess) onSuccess();
    } catch (err) {
      toast({
        title: "Failed to create administrator",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">Create School Administrator</DialogTitle>
              <DialogDescription className="text-xs text-stone-500 mt-0.5">
                Directly provision administrative credentials for{" "}
                <span className="font-semibold text-stone-800">{tenant?.name}</span>.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="admin-full-name" className="text-xs font-semibold text-stone-700">
              Full Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="admin-full-name"
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="e.g. Dr. Rajesh Sharma"
              className="h-10"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="admin-email" className="text-xs font-semibold text-stone-700">
                Login Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="admin-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@institution.edu"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-phone" className="text-xs font-semibold text-stone-700">
                Phone Number
              </Label>
              <Input
                id="admin-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 9876543210"
                className="h-10"
              />
            </div>
          </div>

          <div className="p-3.5 bg-stone-50/80 rounded-xl border border-stone-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-800 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-stone-500" /> Security Credentials
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2"
                  onClick={handleGeneratePassword}
                >
                  <Sparkles className="w-3 h-3 mr-1 text-indigo-500" /> Generate Password
                </Button>
                {form.password && form.email && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-stone-600 hover:text-stone-900 px-2"
                    onClick={handleCopyCredentials}
                  >
                    {copied ? (
                      <Check className="w-3 h-3 mr-1 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="admin-password" className="text-xs font-semibold text-stone-700">
                  Password <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Min 6 characters"
                    className="h-10 pr-9 bg-white"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-confirm-password" className="text-xs font-semibold text-stone-700">
                  Confirm Password <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="admin-confirm-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  placeholder="Repeat password"
                  className="h-10 bg-white"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              Provision Administrator
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
