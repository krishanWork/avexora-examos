import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Megaphone, Plus } from "lucide-react";
import AnnouncementFormDialog from "@/components/announcements/AnnouncementFormDialog";
import AnnouncementManageRow from "@/components/announcements/AnnouncementManageRow";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import useAnnouncements from "@/components/announcements/useAnnouncements";

export default function AnnouncementsManager({ tenantId }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const { announcements, loading, saving, create, update, setActive, remove } = useAnnouncements({
    scope: tenantId ? "tenant" : "platform",
    tenantId: tenantId || null,
  });

  const handleSave = async (data, current) => {
    if (current?.id) await update(current.id, data);
    else await create(data);
    setDialogOpen(false);
    setEditing(null);
  };

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-heading font-semibold text-stone-900 flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-stone-500" /> {tenantId ? "Institute Announcements" : "System Announcements"}
        </h3>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} disabled={loading}>
          <Plus className="w-4 h-4" /> New Announcement
        </Button>
      </div>

      <div>
        {announcements.map((a) => (
          <AnnouncementManageRow
            key={a.id}
            announcement={a}
            showTargets={Boolean(tenantId)}
            disabled={saving}
            onEdit={(item) => { setEditing(item); setDialogOpen(true); }}
            onToggle={(a) => setActive(a, !a.is_active)}
            onDelete={setPendingDelete}
          />
        ))}
        {announcements.length === 0 && (
          <p className="text-sm text-stone-400 py-2">
            {tenantId
              ? "No announcements yet. Create one to notify your teachers, students and parents."
              : "No announcements yet. Create one to notify all institutions."}
          </p>
        )}
      </div>

      <AnnouncementFormDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}
        announcement={editing}
        showRoles={Boolean(tenantId)}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="Delete announcement?"
        description={pendingDelete ? `"${pendingDelete.title}" will be permanently removed. This cannot be undone.` : ""}
        confirmLabel="Delete Announcement"
        loading={saving}
        onConfirm={() => pendingDelete && remove(pendingDelete.id).then(() => setPendingDelete(null))}
      />
    </div>
  );
}
