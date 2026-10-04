import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Megaphone, RotateCcw, BellRing } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import AnnouncementCard from "@/components/announcements/AnnouncementCard";
import { rolePortal, getAppRole, APP_ROLES } from "@/lib/roles";

const CATEGORY_FILTERS = [
  { value: "all", label: "All" },
  { value: "warning", label: "Important" },
  { value: "info", label: "Info" },
  { value: "success", label: "Good news" },
];

export default function FamilyAnnouncementsLayout({ user, announcements, loading, dismissed, onDismiss, onRestore }) {
  const [category, setCategory] = useState("all");

  const visible = useMemo(() => {
    const live = announcements.filter((a) => !dismissed.includes(a.id));
    if (category === "all") return live;
    if (category === "warning") return live.filter((a) => (a.type || "info") === "warning");
    return live.filter((a) => (a.type || "info") === category);
  }, [announcements, dismissed, category]);

  const hiddenCount = announcements.filter((a) => dismissed.includes(a.id)).length;
  // Primary role, like rolePortal() itself: an account that is primarily a
  // student but also a parent is served the student portal, so the label must
  // agree with the destination or the Back link contradicts itself.
  const isParent = getAppRole(user) === APP_ROLES.PARENT;
  const backTo = rolePortal(user) || "/home";

  return (
    <>
      <PageHeader
        title="Announcements"
        description={`Notices from your school${hiddenCount > 0 ? ` · ${hiddenCount} dismissed` : ""}`}
        action={
          <>
            {hiddenCount > 0 && (
              <Button variant="outline" size="sm" onClick={onRestore}>
                <RotateCcw className="w-4 h-4" /> Show dismissed
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to={backTo}>
                <ArrowLeft className="w-4 h-4" /> Back to {isParent ? "Parent" : "Student"} Portal
              </Link>
            </Button>
          </>
        }
      />

      {announcements.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-5">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setCategory(f.value)}
              className={cn(
                "px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors",
                category === f.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {!loading && visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm">
          <EmptyState
            icon={category === "all" ? BellRing : Megaphone}
            title={
              category === "all"
                ? "No announcements yet"
                : dismissed.length > 0
                  ? "You dismissed these"
                  : "Nothing in this category"
            }
            description={
              category === "all"
                ? `When ${isParent ? "the school" : "your teachers"} post a notice it will appear here.`
                : dismissed.length > 0
                  ? "Use “Show dismissed” to bring them back."
                  : "Try another category."
            }
            action={
              category !== "all" && (
                <Button variant="outline" size="sm" onClick={() => setCategory("all")}>
                  Show all
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              dismissed={dismissed.includes(a.id)}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}

      {dismissed.length > 0 && visible.length > 0 && (
        <p className="text-[11px] text-stone-400 text-center mt-6">
          Dismissed notices stay hidden on this device. Use “Show dismissed” to review them again.
        </p>
      )}
    </>
  );
}
