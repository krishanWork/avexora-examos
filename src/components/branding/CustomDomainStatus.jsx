import React from "react";
import { Badge } from "@/components/ui/badge";

export const CUSTOM_DOMAIN_STATUS = {
  pending: { label: "Pending", className: "bg-amber-50 text-amber-700 border-amber-200" },
  verified: { label: "DNS verified", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  live: { label: "Live", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  degraded: { label: "Degraded", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

export default function CustomDomainStatus({ status, verified, degraded, className = "" }) {
  const effective = status || (verified ? "verified" : "pending");
  const badge =
    degraded && effective !== "live"
      ? CUSTOM_DOMAIN_STATUS.degraded
      : CUSTOM_DOMAIN_STATUS[effective] || CUSTOM_DOMAIN_STATUS.pending;
  return (
    <Badge variant="outline" className={`rounded-sm font-medium ${badge.className} ${className}`}>
      {badge.label}
    </Badge>
  );
}