import React, { useMemo, useState } from "react";
import { Megaphone, Sparkles, RotateCcw } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import AnnouncementCard from "@/components/announcements/AnnouncementCard";
import { ANNOUNCEMENT_TYPES } from "@/components/announcements/announcementMeta";

export default function StaffAnnouncementsLayout({ announcements, loading, showTargets = false, dismissed, onDismiss, onRestore }) {
  const [typeFilter, setTypeFilter] = useState("all");

  const visible = useMemo(() => {
    if (typeFilter === "all") return announcements;
    return announcements.filter((a) => (a.type || "info") === typeFilter);
  }, [announcements, typeFilter]);

  const latest = visible[0] || null;
  const rest = visible.slice(1);

  const filters = [
    { value: "all", label: "All" },
    ...Object.values(ANNOUNCEMENT_TYPES)
      .filter((t) => announcements.some((a) => (a.type || "info") === t.value))
      .map((t) => ({ value: t.value, label: t.label })),
  ];

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Notices published for this institution. Only active notices addressed to you appear here."
        action={
          dismissed.length > 0 && (
            <Button variant="outline" size="sm" onClick={onRestore}>
              <RotateCcw className="w-4 h-4" /> Show dismissed ({dismissed.length})
            </Button>
          )
        }
      />

      {filters.length > 2 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-5">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                typeFilter === f.value ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {!loading && visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm">
          <EmptyState
            icon={Megaphone}
            title={typeFilter === "all" ? "No announcements right now" : "No notices of this type"}
            description={
              typeFilter === "all"
                ? "When your school administrator publishes a notice it will show up here."
                : "Try a different category."
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          {latest && (
            <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Latest notice</span>
              </div>
              <AnnouncementCard
                announcement={latest}
                showTargets={showTargets}
                dismissed={dismissed.includes(latest.id)}
                onDismiss={onDismiss}
              />
            </div>
          )}
          {rest.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              showTargets={showTargets}
              dismissed={dismissed.includes(a.id)}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
    </>
  );
}
