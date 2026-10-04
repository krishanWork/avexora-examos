import React, { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/lib/statusTokens";
import CustomDomainStatus from "@/components/branding/CustomDomainStatus";
import { portalUrl, CNAME_TARGET } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import {
  Building2,
  Globe,
  LogIn,
  UserPlus,
  Pencil,
  Ban,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Sparkles,
  GraduationCap,
  Users,
  CreditCard,
  Loader2,
} from "lucide-react";

export default function InstitutionDetailDrawer({
  tenant,
  plan,
  open,
  onOpenChange,
  isPlatformOwner,
  onEdit,
  onToggleStatus,
  onCreateAdmin,
  onActivateDomain,
  activatingId,
  onImpersonate,
}) {
  const { toast } = useToast();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCname, setCopiedCname] = useState(false);

  if (!tenant) return null;

  const isActive = tenant.status === "active";
  const brandColor = tenant.primary_color || "#4F46E5";
  const publicPortalUrl = portalUrl(tenant.subdomain);
  const schoolLoginUrl = `${window.location.origin}/login?school=${tenant.subdomain || ""}`;

  const handleCopyLink = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === "cname") {
      setCopiedCname(true);
      setTimeout(() => setCopiedCname(false), 2000);
      toast({ title: "CNAME Target copied to clipboard" });
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      toast({ title: "Portal link copied to clipboard" });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 overflow-y-auto flex flex-col bg-stone-50/40"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{tenant.name}</SheetTitle>
          <SheetDescription>Institution details and settings</SheetDescription>
        </SheetHeader>
        {/* Brand Banner */}
        <div
          className="h-28 w-full relative flex items-end px-6 pb-3"
          style={{
            background: `linear-gradient(135deg, ${brandColor}, ${brandColor}dd 60%, #1e1b4b)`,
          }}
        >
          <div className="absolute top-4 right-12 flex items-center gap-2">
            <StatusBadge status={tenant.status} type="tenant" />
          </div>
        </div>

        {/* Institution Identity Card */}
        <div className="px-6 -mt-10 relative">
          <div className="bg-white rounded-2xl p-5 border border-stone-200/90 shadow-sm">
            <div className="flex items-start gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-heading font-bold text-xl shadow-md border-2 border-white shrink-0 overflow-hidden"
                style={{ backgroundColor: brandColor }}
              >
                {tenant.logo_url ? (
                  <img
                    src={tenant.logo_url}
                    alt={tenant.name}
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  (tenant.name || "School")
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold font-heading text-stone-900 tracking-tight leading-tight truncate">
                    {tenant.name}
                  </h2>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs font-mono text-stone-500 bg-stone-100 px-2 py-0.5 rounded-md">
                    {tenant.subdomain || "no-slug"}
                  </span>
                  {tenant.board_type && (
                    <Badge variant="outline" className="text-[11px] font-semibold">
                      {tenant.board_type}
                    </Badge>
                  )}
                  {tenant.white_label_enabled && (
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px]">
                      <Sparkles className="w-3 h-3 mr-1 text-emerald-600" /> White Label
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-4 border-t border-stone-100">
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs font-semibold hover:border-indigo-300 hover:bg-indigo-50/50"
                onClick={() => onImpersonate(tenant, "school_admin")}
                title="Directly open School Admin portal"
              >
                <LogIn className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
                Admin Portal
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs font-semibold hover:border-violet-300 hover:bg-violet-50/50"
                onClick={() => onImpersonate(tenant, "teacher")}
                title="View Teacher portal"
              >
                <Users className="w-3.5 h-3.5 mr-1.5 text-violet-600" />
                Teacher View
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs font-semibold hover:border-emerald-300 hover:bg-emerald-50/50"
                onClick={() => onImpersonate(tenant, "student")}
                title="View Student portal"
              >
                <GraduationCap className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                Student View
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs font-semibold"
                onClick={() => window.open(schoolLoginUrl, "_blank")}
                title="Open institution branded login"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5 text-stone-600" />
                Public Login
              </Button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 flex-1">
          {/* Custom Domain Configuration */}
          <div className="bg-white rounded-2xl p-4 border border-stone-200/90 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5 uppercase tracking-wider">
                <Globe className="w-3.5 h-3.5 text-indigo-600" /> Custom Domain & Host
              </span>
              {tenant.custom_domain && (
                <CustomDomainStatus
                  status={tenant.custom_domain_status}
                  verified={tenant.custom_domain_verified}
                />
              )}
            </div>

            {tenant.custom_domain ? (
              <div className="space-y-2.5">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">Hostname:</span>
                    <span className="font-mono font-semibold text-stone-900">
                      {tenant.custom_domain}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">DNS Target:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-stone-700 bg-white px-1.5 py-0.5 rounded border border-stone-200">
                        CNAME {CNAME_TARGET}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(CNAME_TARGET, "cname")}
                        className="text-stone-400 hover:text-stone-700"
                        title="Copy CNAME"
                      >
                        {copiedCname ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {isPlatformOwner &&
                  tenant.custom_domain_status === "verified" && (
                    <Button
                      size="sm"
                      onClick={() => onActivateDomain(tenant)}
                      disabled={activatingId === tenant.id}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium h-9 text-xs"
                    >
                      {activatingId === tenant.id ? (
                        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                      ) : (
                        <Globe className="w-3.5 h-3.5 mr-2" />
                      )}
                      Activate Custom Domain Live
                    </Button>
                  )}
              </div>
            ) : (
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-500">
                No custom domain configured. The school operates on the primary subdomain{" "}
                <span className="font-mono text-indigo-600 font-medium">
                  {tenant.subdomain}.avexora.in
                </span>
                .
              </div>
            )}
          </div>

          {/* Subscription Tier Details */}
          <div className="bg-white rounded-2xl p-4 border border-stone-200/90 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5 uppercase tracking-wider">
                <CreditCard className="w-3.5 h-3.5 text-indigo-600" /> Subscription Tier
              </span>
              <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold">
                {plan?.name || tenant.plan_name || "Standard Plan"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                <p className="text-stone-400">Monthly Plan Rate</p>
                <p className="font-bold text-stone-900 text-sm mt-0.5">
                  ₹{plan?.price ? plan.price.toLocaleString() : "—"}{" "}
                  <span className="text-xs font-normal text-stone-400">/ mo</span>
                </p>
              </div>
              <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                <p className="text-stone-400">Student Capacity</p>
                <p className="font-bold text-stone-900 text-sm mt-0.5">
                  {plan?.student_limit ? plan.student_limit.toLocaleString() : "1,000"}{" "}
                  <span className="text-xs font-normal text-stone-400">students</span>
                </p>
              </div>
              <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                <p className="text-stone-400">OMR Sheet Quota</p>
                <p className="font-bold text-stone-900 text-sm mt-0.5">
                  {plan?.omr_sheet_limit ? plan.omr_sheet_limit.toLocaleString() : "5,000"}{" "}
                  <span className="text-xs font-normal text-stone-400">sheets/mo</span>
                </p>
              </div>
              <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                <p className="text-stone-400">Exam Quota</p>
                <p className="font-bold text-stone-900 text-sm mt-0.5">
                  {plan?.exam_limit ? plan.exam_limit : "50"}{" "}
                  <span className="text-xs font-normal text-stone-400">exams</span>
                </p>
              </div>
            </div>
          </div>

          {/* Contact & Campus Info */}
          <div className="bg-white rounded-2xl p-4 border border-stone-200/90 shadow-sm space-y-3 text-xs">
            <span className="font-bold text-stone-900 flex items-center gap-1.5 uppercase tracking-wider">
              <Building2 className="w-3.5 h-3.5 text-indigo-600" /> Campus & Contact Details
            </span>

            <div className="space-y-2">
              <div className="flex items-center gap-2.5 text-stone-700">
                <Mail className="w-4 h-4 text-stone-400 shrink-0" />
                <span className="text-stone-500 min-w-16">Email:</span>
                {tenant.contact_email ? (
                  <a
                    href={`mailto:${tenant.contact_email}`}
                    className="font-medium text-indigo-600 hover:underline truncate"
                  >
                    {tenant.contact_email}
                  </a>
                ) : (
                  <span className="text-stone-400">Not provided</span>
                )}
              </div>

              <div className="flex items-center gap-2.5 text-stone-700">
                <Phone className="w-4 h-4 text-stone-400 shrink-0" />
                <span className="text-stone-500 min-w-16">Phone:</span>
                {tenant.contact_phone ? (
                  <a
                    href={`tel:${tenant.contact_phone}`}
                    className="font-medium text-stone-800 hover:underline"
                  >
                    {tenant.contact_phone}
                  </a>
                ) : (
                  <span className="text-stone-400">Not provided</span>
                )}
              </div>

              <div className="flex items-center gap-2.5 text-stone-700">
                <MapPin className="w-4 h-4 text-stone-400 shrink-0" />
                <span className="text-stone-500 min-w-16">Address:</span>
                <span className="font-medium text-stone-800 truncate">
                  {tenant.address || "Not specified"}
                </span>
              </div>

              <div className="flex items-center gap-2.5 text-stone-700">
                <Calendar className="w-4 h-4 text-stone-400 shrink-0" />
                <span className="text-stone-500 min-w-16">Onboarded:</span>
                <span className="text-stone-600 font-mono">
                  {tenant.created_date
                    ? new Date(tenant.created_date).toLocaleDateString("en-IN", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Drawer Bottom Action Bar */}
        {isPlatformOwner && (
          <div className="p-4 border-t border-stone-200 bg-white sticky bottom-0 flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                onCreateAdmin(tenant);
              }}
              className="text-xs font-semibold text-emerald-700 hover:bg-emerald-50 hover:border-emerald-200"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
              Provision Admin
            </Button>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onEdit(tenant);
                }}
                className="text-xs font-medium"
              >
                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                Edit
              </Button>
              <Button
                size="sm"
                variant={isActive ? "outline" : "default"}
                onClick={() => {
                  onOpenChange(false);
                  onToggleStatus(tenant);
                }}
                className={
                  isActive
                    ? "text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-200"
                    : "text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                }
              >
                {isActive ? (
                  <>
                    <Ban className="w-3.5 h-3.5 mr-1.5 text-red-500" /> Suspend
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Activate
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
