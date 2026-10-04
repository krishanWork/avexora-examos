import React, { useMemo, useState } from "react";
import { Plus, Megaphone, Radio, PauseCircle, Users, Search } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import AnnouncementFormDialog from "@/components/announcements/AnnouncementFormDialog";
import AnnouncementManageRow from "@/components/announcements/AnnouncementManageRow";
import { isTargeted } from "@/components/announcements/announcementMeta";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "targeted", label: "Role targeted" },
];

export default function InstituteAnnouncementsLayout({ announcements, loading, saving, onSave, onToggle, onDelete }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const live = announcements.filter((a) => a.is_active !== false).length;
  const targeted = announcements.filter(isTargeted).length;

  const visible = useMemo(() => {
    let rows = announcements;
    if (filter === "live") rows = rows.filter((a) => a.is_active !== false);
    if (filter === "paused") rows = rows.filter((a) => a.is_active === false);
    if (filter === "targeted") rows = rows.filter(isTargeted);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (a) =>
        (a.title || "").toLowerCase().includes(q) || (a.message || "").toLowerCase().includes(q)
    );
  }, [announcements, filter, search]);

  const handleSave = async (data, editing) => {
    await onSave(data, editing);
    setDialogOpen(false);
    setEditing(null);
  };

  return (
    <>
      <PageHeader
        title="Institute Announcements"
        description="Notices for this institution. Target a notice at specific roles or leave it untargeted to reach everyone."
        action={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} disabled={loading}>
            <Plus className="w-4 h-4" /> New Announcement
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total notices" value={announcements.length} icon={Megaphone} accent="text-indigo-600" />
        <StatCard label="Live now" value={live} icon={Radio} accent="text-emerald-600" />
        <StatCard label="Paused" value={announcements.length - live} icon={PauseCircle} accent="text-stone-600" />
        <StatCard label="Role targeted" value={targeted} icon={Users} accent="text-violet-600" />
      </div>

      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  filter === f.value
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notices"
              className="pl-9"
              aria-label="Search institute announcements"
            />
          </div>
        </div>

        {!loading && visible.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={search || filter !== "all" ? "No notices match this view" : "No announcements yet"}
            description={
              search || filter !== "all"
                ? "Adjust the filter or search term."
                : "Create one to notify your teachers, students and parents."
            }
          />
        ) : (
          <div>
            {visible.map((a) => (
              <AnnouncementManageRow
                key={a.id}
                announcement={a}
                showTargets
                disabled={saving}
                onEdit={(item) => { setEditing(item); setDialogOpen(true); }}
                onToggle={onToggle}
                onDelete={setPendingDelete}
              />
            ))}
          </div>
        )}
      </div>

      <AnnouncementFormDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}
        announcement={editing}
        showRoles
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="Delete announcement?"
        description={pendingDelete ? `"${pendingDelete.title}" will be permanently removed for this institution. This cannot be undone.` : ""}
        confirmLabel="Delete Announcement"
        loading={saving}
        onConfirm={() => onDelete(pendingDelete)}
      />
    </>
  );
}
