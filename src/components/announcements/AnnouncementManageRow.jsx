import React from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2 } from "lucide-react";
import { announcementType, isTargeted, orderedTargetRoles } from "@/components/announcements/announcementMeta";
import { ROLE_LABELS } from "@/lib/roles";
import moment from "moment";

const TargetChips = ({ announcement }) => {
  if (!isTargeted(announcement)) {
    return (
      <Badge variant="outline" className="text-stone-400 border-stone-200">
        Everyone
      </Badge>
    );
  }
  return (
    <>
      {orderedTargetRoles(announcement).map((role) => (
        <Badge key={role} variant="outline" className="text-stone-500 border-stone-200 capitalize">
          {ROLE_LABELS[role] || role}
        </Badge>
      ))}
    </>
  );
};

export default function AnnouncementManageRow({ announcement, showTargets = false, disabled, onEdit, onToggle, onDelete }) {
  const type = announcementType(announcement.type);

  return (
    <div className="flex items-start justify-between gap-3 py-4 border-b border-stone-100 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-stone-800">{announcement.title || "Untitled announcement"}</span>
          <Badge className={`${type.badge} border-transparent`}>{type.label}</Badge>
          {!announcement.is_active && (
            <Badge variant="outline" className="text-stone-400 border-stone-200">
              Inactive
            </Badge>
          )}
        </div>
        <p className="text-xs text-stone-500 mt-1 line-clamp-2 whitespace-pre-line">{announcement.message}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {announcement.created_date && (
            <span className="text-[11px] text-stone-400">{moment(announcement.created_date).format("ll")}</span>
          )}
          {showTargets && <TargetChips announcement={announcement} />}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={!!announcement.is_active}
          onCheckedChange={() => onToggle?.(announcement)}
          disabled={disabled}
          aria-label={announcement.is_active ? "Deactivate announcement" : "Activate announcement"}
        />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit?.(announcement)} disabled={disabled} aria-label="Edit announcement">
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-500 hover:text-red-600"
          onClick={() => onDelete?.(announcement)}
          disabled={disabled}
          aria-label="Delete announcement"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
