import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ANNOUNCEMENT_TYPE_OPTIONS } from "@/components/announcements/announcementMeta";

const INSTITUTE_TARGET_ROLES = [
  { value: "principal", label: "Principal" },
  { value: "exam_coordinator", label: "Exam Coordinator" },
  { value: "teacher", label: "Teachers" },
  { value: "student", label: "Students" },
  { value: "parent", label: "Parents" },
];

export default function AnnouncementFormDialog({ open, onOpenChange, announcement, onSave, showRoles = false }) {
  const [form, setForm] = useState({ title: "", message: "", type: "info", is_active: true, target_roles: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(announcement
        ? { title: announcement.title || "", message: announcement.message || "", type: announcement.type || "info", is_active: !!announcement.is_active, target_roles: Array.isArray(announcement.target_roles) ? announcement.target_roles : [] }
        : { title: "", message: "", type: "info", is_active: true, target_roles: [] });
    }
  }, [open, announcement]);

  const toggleTargetRole = (value) => {
    const has = form.target_roles.includes(value);
    setForm({
      ...form,
      target_roles: has ? form.target_roles.filter((r) => r !== value) : [...form.target_roles, value],
    });
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.message.trim()) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{announcement ? "Edit Announcement" : "New Announcement"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p6-ann-title">Title</Label>
            <Input id="p6-ann-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Scheduled maintenance" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p6-ann-message">Message</Label>
            <Textarea
              id="p6-ann-message"
              rows={3}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder={
                showRoles
                  ? "Write the announcement shown to staff, students and parents..."
                  : "Write the announcement shown to all institutions..."
              }
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="space-y-1.5 flex-1">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ANNOUNCEMENT_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Active</Label>
              <div className="pt-1">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </div>
            </div>
          </div>
          {showRoles && (
            <div className="space-y-1.5">
              <Label>Send to</Label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
                {INSTITUTE_TARGET_ROLES.map((r) => (
                  <div key={r.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`ann-target-${r.value}`}
                      checked={form.target_roles.includes(r.value)}
                      onCheckedChange={() => toggleTargetRole(r.value)}
                    />
                    <Label htmlFor={`ann-target-${r.value}`} className="text-sm font-medium cursor-pointer">{r.label}</Label>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-stone-400">
                Leave unchecked to send to everyone in this institution.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !form.title.trim() || !form.message.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}