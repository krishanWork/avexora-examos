import { Info, CheckCircle2, AlertTriangle, Sparkles, Wrench } from "lucide-react";

export const ANNOUNCEMENT_TYPES = {
  info: {
    value: "info",
    label: "Info",
    icon: Info,
    badge: "bg-indigo-100 text-indigo-700",
    wrap: "bg-indigo-50 border-indigo-200 text-indigo-800",
    iconColor: "text-indigo-500",
    accent: "text-indigo-600",
    stripe: "bg-indigo-500",
  },
  success: {
    value: "success",
    label: "Success",
    icon: CheckCircle2,
    badge: "bg-emerald-100 text-emerald-700",
    wrap: "bg-emerald-50 border-emerald-200 text-emerald-800",
    iconColor: "text-emerald-500",
    accent: "text-emerald-600",
    stripe: "bg-emerald-500",
  },
  warning: {
    value: "warning",
    label: "Warning",
    icon: AlertTriangle,
    badge: "bg-amber-100 text-amber-700",
    wrap: "bg-amber-50 border-amber-200 text-amber-800",
    iconColor: "text-amber-500",
    accent: "text-amber-600",
    stripe: "bg-amber-500",
  },
  update: {
    value: "update",
    label: "Product Update",
    icon: Sparkles,
    badge: "bg-sky-100 text-sky-700",
    wrap: "bg-sky-50 border-sky-200 text-sky-800",
    iconColor: "text-sky-500",
    accent: "text-sky-600",
    stripe: "bg-sky-500",
  },
  maintenance: {
    value: "maintenance",
    label: "Maintenance",
    icon: Wrench,
    badge: "bg-stone-200 text-stone-700",
    wrap: "bg-stone-100 border-stone-300 text-stone-800",
    iconColor: "text-stone-500",
    accent: "text-stone-600",
    stripe: "bg-stone-500",
  },
};

export const ANNOUNCEMENT_TYPE_OPTIONS = Object.values(ANNOUNCEMENT_TYPES).map((t) => ({
  value: t.value,
  label: t.label,
}));

const FALLBACK = ANNOUNCEMENT_TYPES.info;

export const announcementType = (name) => ANNOUNCEMENT_TYPES[name] || FALLBACK;

// Order used to sort target-role chips so seniority reads top-down.
export const TARGET_ROLE_ORDER = ["principal", "exam_coordinator", "teacher", "student", "parent"];

export const isTargeted = (announcement) =>
  Array.isArray(announcement?.target_roles) && announcement.target_roles.length > 0;

export const orderedTargetRoles = (announcement) =>
  (announcement?.target_roles || [])
    .filter((r) => TARGET_ROLE_ORDER.includes(r))
    .sort((a, b) => TARGET_ROLE_ORDER.indexOf(a) - TARGET_ROLE_ORDER.indexOf(b));
