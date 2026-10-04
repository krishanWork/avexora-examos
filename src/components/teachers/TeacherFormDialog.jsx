import React, { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const EMAIL_RE = /\S+@\S+\.\S+/;

export default function TeacherFormDialog({ open, onOpenChange, teacher, onSave, tenantId }) {
  const [form, setForm] = useState({});
  const [classList, setClassList] = useState([]);
  const [subjectList, setSubjectList] = useState([]);
  const [selectedClassIds, setSelectedClassIds] = useState([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([]);
  const [emailError, setEmailError] = useState(false);

  useEffect(() => {
    if (tenantId) {
      Promise.all([
        appClient.entities.SchoolClass.filter({ tenant_id: tenantId }, "name").catch(() => []),
        appClient.entities.Subject.filter({ tenant_id: tenantId }, "name").catch(() => []),
      ]).then(([cList, sList]) => {
        setClassList(cList);
        setSubjectList(sList);
      });
    }
  }, [tenantId, open]);

  useEffect(() => {
    if (teacher) {
      setForm(teacher);
      setSelectedClassIds(Array.isArray(teacher.assigned_class_ids) ? teacher.assigned_class_ids : []);
      setSelectedSubjectIds(Array.isArray(teacher.assigned_subject_ids) ? teacher.assigned_subject_ids : []);
    } else {
      setForm({
        full_name: "",
        employee_id: "",
        email: "",
        phone: "",
        qualification: "",
        experience_years: 0,
        status: "active",
      });
      setSelectedClassIds([]);
      setSelectedSubjectIds([]);
    }
    setEmailError(false);
  }, [teacher, open]);

  const handleToggleClass = (id) => {
    setSelectedClassIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleToggleSubject = (id) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (form.email && !EMAIL_RE.test(form.email)) {
      setEmailError(true);
      return;
    }
    setEmailError(false);

    // Map selected IDs to display names for backward compatibility
    const classNames = selectedClassIds
      .map((id) => classList.find((c) => c.id === id)?.name)
      .filter(Boolean);
    const subjectNames = selectedSubjectIds
      .map((id) => subjectList.find((s) => s.id === id)?.name)
      .filter(Boolean);

    onSave({
      ...form,
      assigned_class_ids: selectedClassIds,
      assigned_subject_ids: selectedSubjectIds,
      assigned_classes: classNames,
      subjects: subjectNames,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{teacher ? "Edit Teacher" : "Add Teacher"}</DialogTitle>
        </DialogHeader>
        <form id="p6-teacher-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="p6-teacher-full-name">Full Name *</Label>
            <Input
              id="p6-teacher-full-name"
              value={form.full_name || ""}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-teacher-employee-id">Employee ID</Label>
              <Input
                id="p6-teacher-employee-id"
                value={form.employee_id || ""}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="p6-teacher-experience">Experience (years)</Label>
              <Input
                id="p6-teacher-experience"
                type="number"
                min="0"
                value={form.experience_years ?? 0}
                onChange={(e) => setForm({ ...form, experience_years: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-teacher-email">Email</Label>
              <Input
                id="p6-teacher-email"
                type="email"
                value={form.email || ""}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  if (emailError) setEmailError(false);
                }}
              />
              {emailError && <p className="text-xs text-destructive mt-1">Enter a valid email address</p>}
            </div>
            <div>
              <Label htmlFor="p6-teacher-phone">Phone</Label>
              <Input
                id="p6-teacher-phone"
                value={form.phone || ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="p6-teacher-qualification">Qualification</Label>
            <Input
              id="p6-teacher-qualification"
              value={form.qualification || ""}
              onChange={(e) => setForm({ ...form, qualification: e.target.value })}
            />
          </div>

          {!teacher && (
            <div>
              <Label htmlFor="p6-teacher-password">Account Password</Label>
              <Input
                id="p6-teacher-password"
                type="password"
                placeholder="Direct login password (min 6 chars)"
                value={form.password || ""}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <p className="text-xs text-stone-400 mt-1">If provided, an active teacher login account is created immediately with this password.</p>
            </div>
          )}

          {/* Canonical Assigned Classes */}
          <div className="space-y-2 pt-1 border-t border-stone-100">
            <Label className="text-xs font-semibold uppercase text-stone-500">
              Canonical Assigned Classes ({selectedClassIds.length} selected)
            </Label>
            <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-stone-50 rounded-lg border border-stone-200">
              {classList.map((cls) => (
                <div key={cls.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`cls-${cls.id}`}
                    checked={selectedClassIds.includes(cls.id)}
                    onCheckedChange={() => handleToggleClass(cls.id)}
                  />
                  <Label htmlFor={`cls-${cls.id}`} className="text-xs cursor-pointer font-medium text-stone-800 truncate">
                    {cls.name}
                  </Label>
                </div>
              ))}
              {classList.length === 0 && <p className="text-xs text-stone-400">No classes configured</p>}
            </div>
          </div>

          {/* Canonical Assigned Subjects */}
          <div className="space-y-2 pt-1 border-t border-stone-100">
            <Label className="text-xs font-semibold uppercase text-stone-500">
              Canonical Assigned Subjects ({selectedSubjectIds.length} selected)
            </Label>
            <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-stone-50 rounded-lg border border-stone-200">
              {subjectList.map((sub) => (
                <div key={sub.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`sub-${sub.id}`}
                    checked={selectedSubjectIds.includes(sub.id)}
                    onCheckedChange={() => handleToggleSubject(sub.id)}
                  />
                  <Label htmlFor={`sub-${sub.id}`} className="text-xs cursor-pointer font-medium text-stone-800 truncate">
                    {sub.name} {sub.code ? `(${sub.code})` : ""}
                  </Label>
                </div>
              ))}
              {subjectList.length === 0 && <p className="text-xs text-stone-400">No subjects configured</p>}
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="p6-teacher-form" disabled={!form.full_name}>Save Teacher</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
