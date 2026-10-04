import React from "react";
import { Badge } from "@/components/ui/badge";

/**
 * Warm Friendly Unified Status Tokens
 * Authoritative color, label, and dot indicator mappings for all surfaces.
 */

export const EXAM_STATUS_CONFIG = {
  draft: {
    label: "Draft",
    cls: "bg-stone-100 text-stone-700 border border-stone-200",
    dot: "bg-stone-400",
  },
  scheduled: {
    label: "Scheduled",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  omr_in_progress: {
    label: "OMR In Progress",
    cls: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
  },
  evaluated: {
    label: "Evaluated",
    cls: "bg-purple-50 text-purple-700 border border-purple-200",
    dot: "bg-purple-500",
  },
  reviewed: {
    label: "Reviewed",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  published: {
    label: "Published",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-500",
  },
};

export const SHEET_STATUS_CONFIG = {
  uploaded: {
    label: "Uploaded",
    cls: "bg-stone-100 text-stone-700 border border-stone-200",
    dot: "bg-stone-400",
  },
  processing: {
    label: "Processing",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  extracted: {
    label: "Extracted",
    cls: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
  },
  evaluated: {
    label: "Evaluated",
    cls: "bg-purple-50 text-purple-700 border border-purple-200",
    dot: "bg-purple-500",
  },
  reviewed: {
    label: "Reviewed",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  processed: {
    label: "Processed",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  needs_review: {
    label: "Needs Review",
    cls: "bg-amber-50 text-amber-800 border border-amber-300 font-semibold",
    dot: "bg-amber-600",
  },
  failed: {
    label: "Failed",
    cls: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-500",
  },
};

export const LEAD_STATUS_CONFIG = {
  new: {
    label: "New",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  contacted: {
    label: "Contacted",
    cls: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
  },
  demo_scheduled: {
    label: "Demo Scheduled",
    cls: "bg-purple-50 text-purple-700 border border-purple-200",
    dot: "bg-purple-500",
  },
  closed: {
    label: "Closed",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  lost: {
    label: "Lost",
    cls: "bg-stone-100 text-stone-600 border border-stone-200",
    dot: "bg-stone-400",
  },
};

export const ATTENDANCE_STATUS_CONFIG = {
  present: {
    label: "Present",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  late: {
    label: "Late",
    cls: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
  },
  absent: {
    label: "Absent",
    cls: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-500",
  },
  excused: {
    label: "Excused",
    cls: "bg-stone-100 text-stone-600 border border-stone-200",
    dot: "bg-stone-400",
  },
};

export const TENANT_STATUS_CONFIG = {
  active: {
    label: "Active",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  suspended: {
    label: "Suspended",
    cls: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-500",
  },
  trial: {
    label: "Trial",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  pending: {
    label: "Pending",
    cls: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
  },
};

// The commission lifecycle, mirroring SALE_STATUSES / SALE_TRANSITIONS in
// server/affiliate-commission.js. pending -> approved -> paid is the only path; the
// server owns the transition table, and this only renders where a document is in
// the lifecycle. A `void` token is deliberately absent — see the note in that
// module on why a sale is immutable rather than cancellable by status.
export const AFFILIATE_SALE_STATUS_CONFIG = {
  pending: {
    label: "Awaiting Approval",
    cls: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
  },
  approved: {
    label: "Approved — Payable",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  paid: {
    label: "Paid",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
};

// Whether the affiliate account itself is active. Separate from the sale lifecycle
// on purpose: suspending a reseller stops FUTURE sales and is a different decision
// from settling the ones they already made.
export const AFFILIATE_STATUS_CONFIG = {
  active: {
    label: "Active",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  suspended: {
    label: "Suspended",
    cls: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-500",
  },
};

export const STUDENT_STATUS_CONFIG = {
  active: {
    label: "Active",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  archived: {
    label: "Archived",
    cls: "bg-stone-100 text-stone-600 border border-stone-200",
    dot: "bg-stone-400",
  },
  inactive: {
    label: "Inactive",
    cls: "bg-stone-100 text-stone-600 border border-stone-200",
    dot: "bg-stone-400",
  },
  graduated: {
    label: "Graduated",
    cls: "bg-purple-50 text-purple-700 border border-purple-200",
    dot: "bg-purple-500",
  },
};

export const ENROLLMENT_STATUS_CONFIG = {
  enrolled: {
    label: "Enrolled",
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-500",
  },
  promoted: {
    label: "Promoted",
    cls: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    dot: "bg-indigo-500",
  },
  graduated: {
    label: "Graduated",
    cls: "bg-purple-50 text-purple-700 border border-purple-200",
    dot: "bg-purple-500",
  },
  transferred: {
    label: "Transferred",
    cls: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-500",
  },
  dropped: {
    label: "Dropped",
    cls: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-500",
  },
};

const UNIVERSAL_LOOKUP = {
  ...EXAM_STATUS_CONFIG,
  ...SHEET_STATUS_CONFIG,
  ...LEAD_STATUS_CONFIG,
  ...ATTENDANCE_STATUS_CONFIG,
  ...TENANT_STATUS_CONFIG,
  ...AFFILIATE_SALE_STATUS_CONFIG,
  ...AFFILIATE_STATUS_CONFIG,
  ...STUDENT_STATUS_CONFIG,
  ...ENROLLMENT_STATUS_CONFIG,
};

/**
 * Universal Status Badge component
 */
export function StatusBadge({ status, type = "auto", showDot = true, className = "" }) {
  let configMap = null;
  if (type === "exam") configMap = EXAM_STATUS_CONFIG;
  else if (type === "sheet") configMap = SHEET_STATUS_CONFIG;
  else if (type === "lead") configMap = LEAD_STATUS_CONFIG;
  else if (type === "attendance") configMap = ATTENDANCE_STATUS_CONFIG;
  else if (type === "tenant") configMap = TENANT_STATUS_CONFIG;
  else if (type === "student") configMap = STUDENT_STATUS_CONFIG;
  else if (type === "enrollment") configMap = ENROLLMENT_STATUS_CONFIG;
  else if (type === "affiliateSale") configMap = AFFILIATE_SALE_STATUS_CONFIG;
  else if (type === "affiliate") configMap = AFFILIATE_STATUS_CONFIG;

  const item = (configMap && configMap[status]) || UNIVERSAL_LOOKUP[status] || {
    label: status ? String(status).replace(/_/g, " ") : "Unknown",
    cls: "bg-stone-100 text-stone-600 border border-stone-200",
    dot: "bg-stone-400",
  };

  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-sm ${item.cls} ${className}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dot}`} />}
      <span className="capitalize">{item.label}</span>
    </Badge>
  );
}
