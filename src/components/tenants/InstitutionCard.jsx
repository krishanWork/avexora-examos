import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/lib/statusTokens";
import CustomDomainStatus from "@/components/branding/CustomDomainStatus";
import { portalUrl } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
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
  Sparkles,
  Users,
  GraduationCap,
  MoreVertical,
  ChevronRight,
  Eye,
} from "lucide-react";

export default function InstitutionCard({
  tenant,
  plan,
  isPlatformOwner,
  onViewDetails,
  onEdit,
  onToggleStatus,
  onCreateAdmin,
  onActivateDomain,
  activatingId,
  onImpersonate,
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const isActive = tenant.status === "active";
  const brandColor = tenant.primary_color || "#4F46E5";
  const schoolLoginUrl = `/s/${tenant.subdomain || ""}`;

  const handleCopySubdomain = (e) => {
    e.stopPropagation();
    const url = portalUrl(tenant.subdomain);
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Portal URL copied to clipboard!" });
  };

  const monogram = (tenant.name || "School")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      onClick={() => onViewDetails(tenant)}
      className="group relative bg-white rounded-2xl border border-stone-200/90 shadow-sm hover:shadow-md hover:border-stone-300 transition-all duration-200 cursor-pointer overflow-hidden flex flex-col justify-between"
    >
      {/* Top Accent Strip */}
      <div
        className="h-1.5 w-full transition-opacity group-hover:opacity-100 opacity-80"
        style={{
          background: `linear-gradient(90deg, ${brandColor}, ${brandColor}88)`,
        }}
      />

      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
        {/* Header: Monogram/Logo + Name + Status + More Menu */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold font-heading text-base shrink-0 shadow-sm overflow-hidden"
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
                  monogram
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-heading font-bold text-stone-900 group-hover:text-indigo-600 transition-colors text-base truncate leading-snug">
                    {tenant.name}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 mt-1 text-xs text-stone-500">
                  <button
                    type="button"
                    onClick={handleCopySubdomain}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-stone-600 bg-stone-100 hover:bg-stone-200 px-1.5 py-0.5 rounded transition-colors"
                    title="Click to copy portal link"
                  >
                    <span>{tenant.subdomain || "no-slug"}</span>
                    {copied ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3 text-stone-400" />
                    )}
                  </button>
                  {tenant.board_type && (
                    <span className="text-[11px] font-medium text-stone-500 bg-stone-50 border border-stone-200/80 px-1.5 py-0.5 rounded">
                      {tenant.board_type}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Status & Overflow Actions */}
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <StatusBadge status={tenant.status} type="tenant" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-stone-400 hover:text-stone-700"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 text-xs">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => onViewDetails(tenant)}>
                    <Eye className="w-3.5 h-3.5 mr-2 text-stone-500" /> View Details
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onImpersonate(tenant, "school_admin")}>
                    <LogIn className="w-3.5 h-3.5 mr-2 text-indigo-600" /> Impersonate Admin
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onImpersonate(tenant, "teacher")}>
                    <Users className="w-3.5 h-3.5 mr-2 text-violet-600" /> Impersonate Teacher
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onImpersonate(tenant, "student")}>
                    <GraduationCap className="w-3.5 h-3.5 mr-2 text-emerald-600" /> Impersonate Student
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      window.location.href = schoolLoginUrl;
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-2 text-stone-500" /> Open School Login
                  </DropdownMenuItem>
                  {isPlatformOwner && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onCreateAdmin(tenant)}>
                        <UserPlus className="w-3.5 h-3.5 mr-2 text-emerald-600" /> Create Admin
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(tenant)}>
                        <Pencil className="w-3.5 h-3.5 mr-2 text-stone-600" /> Edit Institution
                      </DropdownMenuItem>
                      {tenant.custom_domain &&
                        tenant.custom_domain_status === "verified" && (
                          <DropdownMenuItem onClick={() => onActivateDomain(tenant)}>
                            <Globe className="w-3.5 h-3.5 mr-2 text-emerald-600" /> Activate Domain
                          </DropdownMenuItem>
                        )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onToggleStatus(tenant)}
                        className={isActive ? "text-red-600" : "text-emerald-600"}
                      >
                        {isActive ? (
                          <>
                            <Ban className="w-3.5 h-3.5 mr-2" /> Suspend Institution
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Reactivate Institution
                          </>
                        )}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Plan & White Label Row */}
          <div className="flex items-center justify-between gap-2 mt-3 text-xs">
            <span className="font-medium text-stone-700 bg-stone-100/80 px-2 py-0.5 rounded-md truncate">
              {plan?.name || tenant.plan_name || "Standard Plan"}
            </span>

            {tenant.white_label_enabled ? (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium shrink-0">
                <Sparkles className="w-2.5 h-2.5 mr-1 text-emerald-600" /> White Label
              </Badge>
            ) : (
              <span className="text-[11px] text-stone-400">Standard Brand</span>
            )}
          </div>

          {/* Custom Domain (If active) */}
          {tenant.custom_domain && (
            <div className="mt-2.5 p-2 bg-stone-50 rounded-xl border border-stone-200/70 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <Globe className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                <span className="font-mono text-[11px] text-stone-700 truncate">
                  {tenant.custom_domain}
                </span>
              </div>
              <CustomDomainStatus
                status={tenant.custom_domain_status}
                verified={tenant.custom_domain_verified}
              />
            </div>
          )}

          {/* Contact Details */}
          {(tenant.contact_email || tenant.contact_phone) && (
            <div className="mt-3 pt-3 border-t border-stone-100 space-y-1 text-xs text-stone-500">
              {tenant.contact_email && (
                <div className="flex items-center gap-2 truncate">
                  <Mail className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  <span className="truncate">{tenant.contact_email}</span>
                </div>
              )}
              {tenant.contact_phone && (
                <div className="flex items-center gap-2 truncate">
                  <Phone className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  <span>{tenant.contact_phone}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs font-semibold hover:border-indigo-300 hover:text-indigo-600"
              onClick={() => onImpersonate(tenant, "school_admin")}
              title="Launch School Admin Dashboard"
            >
              <LogIn className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
              Portal
            </Button>

            {isPlatformOwner && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium hover:border-emerald-300 hover:text-emerald-700"
                onClick={() => onCreateAdmin(tenant)}
                title="Provision school administrator login"
              >
                <UserPlus className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Admin
              </Button>
            )}
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs font-medium text-stone-500 hover:text-stone-900 group-hover:translate-x-0.5 transition-transform"
            onClick={() => onViewDetails(tenant)}
          >
            Details <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
