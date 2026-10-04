import React, { useMemo, useState } from "react";
import { Plus, Megaphone, Radio, PauseCircle, Search } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AnnouncementFormDialog from "@/components/announcements/AnnouncementFormDialog";
import AnnouncementManageRow from "@/components/announcements/AnnouncementManageRow";

export default function PlatformAnnouncementsLayout({ announcements, loading, saving, onSave, onToggle, onDelete }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return announcements;
    return announcements.filter(
      (a) =>
        (a.title || "").toLowerCase().includes(q) || (a.message || "").toLowerCase().includes(q)
    );
  }, [announcements, search]);

  const live = announcements.filter((a) => a.is_active !== false).length;

  const handleSave = async (data, editing) => {
    await onSave(data, editing);
    setDialogOpen(false);
    setEditing(null);
  };

  return (
    <>
      <PageHeader
        title="System Announcements"
        description="Platform-wide notices shown to every institution on ExamOS. Institute-level notices are managed by each school administrator."
        action={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} disabled={loading}>
            <Plus className="w-4 h-4" /> New Announcement
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total notices" value={announcements.length} icon={Megaphone} accent="text-indigo-600" />
        <StatCard label="Live now" value={live} icon={Radio} accent="text-emerald-600" />
        <StatCard label="Paused" value={announcements.length - live} icon={PauseCircle} accent="text-stone-600" />
      </div>

      <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h3 className="font-heading font-semibold text-stone-900 text-sm">Published notices</h3>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notices"
              className="pl-9"
              aria-label="Search system announcements"
            />
          </div>
        </div>

        {!loading && visible.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={search ? "No notices match your search" : "No system announcements yet"}
            description={
              search
                ? "Try a different keyword."
                : "Publish a notice to reach every institution on the platform."
            }
          />
        ) : (
          <div>
            {visible.map((a) => (
              <AnnouncementManageRow
                key={a.id}
                announcement={a}
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
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="Delete announcement?"
        description={pendingDelete ? `"${pendingDelete.title}" will be permanently removed for every institution. This cannot be undone.` : ""}
        confirmLabel="Delete Announcement"
        loading={saving}
        onConfirm={() => onDelete(pendingDelete)}
      />
    </>
  );
}
