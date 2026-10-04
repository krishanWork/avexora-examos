import React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { announcementType, isTargeted, orderedTargetRoles } from "@/components/announcements/announcementMeta";
import { ROLE_LABELS } from "@/lib/roles";
import moment from "moment";

const TargetChips = ({ announcement, className = "" }) => {
  if (!isTargeted(announcement)) {
    return (
      <Badge variant="outline" className={`text-stone-400 border-stone-200 ${className}`}>
        Everyone
      </Badge>
    );
  }
  return (
    <>
      {orderedTargetRoles(announcement).map((role) => (
        <Badge key={role} variant="outline" className={`text-stone-500 border-stone-200 capitalize ${className}`}>
          {ROLE_LABELS[role] || role}
        </Badge>
      ))}
    </>
  );
};

export default function AnnouncementCard({
  announcement,
  variant = "card",
  showTargets = false,
  onDismiss,
  dismissed = false,
}) {
  if (!announcement) return null;

  const type = announcementType(announcement.type);
  const Icon = type.icon;
  const title = announcement.title || "Untitled announcement";
  const posted = announcement.created_date ? moment(announcement.created_date).fromNow() : null;

  if (variant === "banner") {
    return (
      <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${type.wrap}`}>
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${type.iconColor}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm opacity-90 whitespace-pre-line">{announcement.message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(announcement.id)}
            className="shrink-0 p-1 rounded hover:bg-black/5"
            aria-label="Dismiss announcement"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <article
      className={`relative bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden transition-opacity ${
        dismissed ? "opacity-60" : ""
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${type.stripe}`} aria-hidden="true" />
      <div className="pl-5 pr-4 py-4">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 shrink-0 ${type.iconColor}`}>
            <Icon className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-heading font-semibold text-stone-900 text-sm leading-snug">{title}</h3>
              {onDismiss && (
                <button
                  type="button"
                  onClick={() => onDismiss(announcement.id)}
                  className="shrink-0 p-1 -mt-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                  aria-label={`Dismiss ${title}`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <Badge className={`${type.badge} border-transparent`}>{type.label}</Badge>
              {posted && <span className="text-[11px] text-stone-400">{posted}</span>}
              {announcement.is_active === false && (
                <Badge variant="outline" className="text-stone-400 border-stone-200">
                  Inactive
                </Badge>
              )}
              {showTargets && <TargetChips announcement={announcement} />}
            </div>
            <p className="text-sm text-stone-600 mt-2.5 leading-relaxed whitespace-pre-line">{announcement.message}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
