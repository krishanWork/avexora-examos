import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import TeacherFormDialog from "@/components/teachers/TeacherFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Users, Plus, Pencil, Layers, Trash2, Search } from "lucide-react";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

export default function Teachers() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const isManageAllowed = can(user, "manage_teachers");

  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedTeacherForAssign, setSelectedTeacherForAssign] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const requestDelete = ({ title, description, confirmLabel, action }) => {
    setDeleteConfirm({
      title,
      description,
      confirmLabel,
      onConfirm: async () => {
        try {
          await action();
        } catch (err) {
          toast({ title: "Operation failed", description: err.message, variant: "destructive" });
        } finally {
          setDeleteConfirm(null);
        }
      },
    });
  };

  // New assignment form
  const [assignForm, setAssignForm] = useState({
    academic_year_id: "",
    school_class_id: "",
    section_id: "",
    subject_id: "",
    role: "subject_teacher",
    status: "active",
  });

  const load = async () => {
    if (!user?.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      const [tList, aList, yList, cList, secList, sList] = await Promise.all([
        appClient.entities.Teacher.filter({ tenant_id: user.tenant_id }, "-created_date").catch(() => []),
        appClient.entities.TeacherAssignment.filter({ tenant_id: user.tenant_id }).catch(() => []),
        appClient.entities.AcademicYear.filter({ tenant_id: user.tenant_id }, "-name").catch(() => []),
        appClient.entities.SchoolClass.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Section.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Subject.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
      ]);
      setTeachers(tList);
      setAssignments(aList);
      setAcademicYears(yList);
      setClasses(cList);
      setSections(secList);
      setSubjects(sList);
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load teachers", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.tenant_id]);

  const yearMap = Object.fromEntries(academicYears.map((y) => [y.id, y]));
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c]));
  const sectionMap = Object.fromEntries(sections.map((sec) => [sec.id, sec]));
  const subjectMap = Object.fromEntries(subjects.map((s) => [s.id, s]));

  const handleSaveTeacher = async (data) => {
    try {
      if (editing) {
        await appClient.entities.Teacher.update(editing.id, data);
        await logAudit({ user, action: "update", entity_type: "Teacher", entity_id: editing.id, details: data.full_name });
      } else {
        const { password, ...teacherData } = data;
        if (password && data.email) {
          await appClient.users.provisionUser({
            full_name: data.full_name,
            email: data.email,
            password,
            phone: data.phone,
            role: "teacher",
          });
        } else {
          const created = await appClient.entities.Teacher.create({ ...teacherData, tenant_id: user.tenant_id });
          await logAudit({ user, action: "create", entity_type: "Teacher", entity_id: created.id, details: data.full_name });
        }
      }
      toast({ title: editing ? "Teacher updated" : "Teacher added" });
      setDialogOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      toast({ title: "Failed to save teacher", description: err.message, variant: "destructive" });
    }
  };

  // Open TeacherAssignment Dialog
  const handleOpenAssignDialog = (teacher) => {
    setSelectedTeacherForAssign(teacher);
    const currYear = academicYears.find((y) => y.is_current) || academicYears[0];
    setAssignForm({
      academic_year_id: currYear?.id || "",
      school_class_id: "",
      section_id: "",
      subject_id: "",
      role: "subject_teacher",
      status: "active",
    });
    setAssignDialogOpen(true);
  };

  const handleCreateAssignment = async (e) => {
    e.preventDefault();
    if (!assignForm.academic_year_id || !assignForm.school_class_id || !assignForm.subject_id) {
      toast({ title: "Academic Year, Class, and Subject are required", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        tenant_id: user.tenant_id,
        teacher_id: selectedTeacherForAssign.id,
        academic_year_id: assignForm.academic_year_id,
        school_class_id: assignForm.school_class_id,
        section_id: assignForm.section_id || null,
        subject_id: assignForm.subject_id,
        role: assignForm.role,
        status: assignForm.status || "active",
      };
      const created = await appClient.entities.TeacherAssignment.create(payload);
      await logAudit({
        user,
        action: "create",
        entity_type: "TeacherAssignment",
        entity_id: created.id,
        details: `Assigned ${selectedTeacherForAssign.full_name} -> ${classMap[assignForm.school_class_id]?.name || "Class"} ${subjectMap[assignForm.subject_id]?.name || "Subject"}`,
      });
      toast({ title: "Assignment created successfully" });
      setAssignForm({
        ...assignForm,
        school_class_id: "",
        section_id: "",
        subject_id: "",
      });
      load();
    } catch (err) {
      toast({ title: "Failed to create assignment", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteAssignment = (assignId) => {
    requestDelete({
      title: "Remove assignment?",
      description: "This teacher assignment will be removed. This cannot be undone.",
      confirmLabel: "Remove Assignment",
      action: async () => {
        await appClient.entities.TeacherAssignment.delete(assignId);
        await logAudit({
          user,
          action: "delete",
          entity_type: "TeacherAssignment",
          entity_id: assignId,
          details: `Removed assignment ${assignId}`,
        });
        toast({ title: "Assignment removed" });
        load();
      },
    });
  };

  const filteredTeachers = teachers.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (t.full_name || "").toLowerCase().includes(q) ||
      (t.email || "").toLowerCase().includes(q) ||
      (t.employee_id || "").toLowerCase().includes(q)
    );
  });

  const columns = [
    {
      key: "full_name",
      header: "Teacher Name",
      cell: (row) => (
        <div>
          <span className="font-medium text-stone-900">{row.full_name}</span>
          <p className="text-xs text-stone-500">{row.email || "-"}</p>
        </div>
      ),
    },
    { key: "employee_id", header: "Employee ID", cell: (row) => row.employee_id || "-" },
    {
      key: "assignments_count",
      header: "Assignments",
      cell: (row) => {
        const count = assignments.filter((a) => a.teacher_id === row.id).length;
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => handleOpenAssignDialog(row)}
          >
            <Layers className="w-3.5 h-3.5 mr-1 text-indigo-600" />
            {count} Assignment{count !== 1 ? "s" : ""}
          </Button>
        );
      },
    },
    {
      key: "subjects",
      header: "Subjects",
      cell: (row) => (row.subjects || []).join(", ") || "-",
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge className={row.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-500"}>
          {row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Teachers & Faculty"
        description="Manage teaching staff profiles, canonical class-subject assignments, and workload."
        actions={
          isManageAllowed ? (
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Add Teacher
            </Button>
          ) : (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Principal Oversight (View-Only)
            </Badge>
          )
        }
      />

      <div className="flex items-center gap-4 bg-white p-4 rounded-md border border-stone-200 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <Input
            placeholder="Search teachers by name, email, or employee ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="text-sm text-stone-500">
          Showing {filteredTeachers.length} teacher{filteredTeachers.length !== 1 ? "s" : ""}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredTeachers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No teachers registered yet"
        emptyIcon={Users}
        pagination={{ page, totalItems: filteredTeachers.length, pageSize: PAGE_SIZE, onPageChange: setPage }}
        actions={
          isManageAllowed
            ? (row) => (
                <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setDialogOpen(true); }}>
                  <Pencil className="w-4 h-4" />
                </Button>
              )
            : undefined
        }
      />

      {/* Add / Edit Teacher Dialog */}
      <TeacherFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        teacher={editing}
        onSave={handleSaveTeacher}
        tenantId={user?.tenant_id}
      />

      {/* TeacherAssignment Management Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assignments for {selectedTeacherForAssign?.full_name}</DialogTitle>
          </DialogHeader>

          {/* Current Assignments List */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-stone-500 tracking-wider">Active Assignments</h4>
            <div className="space-y-2">
              {assignments
                .filter((a) => a.teacher_id === selectedTeacherForAssign?.id)
                .map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-stone-50 border border-stone-200 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-stone-900">
                        {classMap[a.school_class_id]?.name || "Class"} {sectionMap[a.section_id]?.name ? `- Section ${sectionMap[a.section_id]?.name}` : ""}
                        {" · "}
                        <span className="text-indigo-600">{subjectMap[a.subject_id]?.name || "Subject"}</span>
                      </p>
                      <p className="text-stone-500 mt-0.5">
                        Year: {yearMap[a.academic_year_id]?.name || "N/A"} · Role: <span className="capitalize">{a.role?.replace("_", " ")}</span>
                      </p>
                    </div>
                    {isManageAllowed && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-stone-400 hover:text-red-600"
                        onClick={() => handleDeleteAssignment(a.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              {assignments.filter((a) => a.teacher_id === selectedTeacherForAssign?.id).length === 0 && (
                <p className="text-xs text-stone-400 italic py-2">No active assignments for this teacher.</p>
              )}
            </div>

            {/* Add New Assignment Form */}
            {isManageAllowed && (
              <form onSubmit={handleCreateAssignment} className="pt-4 border-t border-stone-200 space-y-3">
                <h4 className="text-xs font-semibold uppercase text-stone-700 tracking-wider">Add New Assignment</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="as-year">Academic Year *</Label>
                    <Select
                      value={assignForm.academic_year_id}
                      onValueChange={(val) => setAssignForm({ ...assignForm, academic_year_id: val })}
                    >
                      <SelectTrigger id="as-year"><SelectValue placeholder="Year" /></SelectTrigger>
                      <SelectContent>
                        {academicYears.map((y) => (
                          <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="as-role">Assignment Role</Label>
                    <Select
                      value={assignForm.role}
                      onValueChange={(val) => setAssignForm({ ...assignForm, role: val })}
                    >
                      <SelectTrigger id="as-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="subject_teacher">Subject Teacher</SelectItem>
                        <SelectItem value="class_teacher">Class Teacher</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="as-class">Class *</Label>
                    <Select
                      value={assignForm.school_class_id}
                      onValueChange={(val) => setAssignForm({ ...assignForm, school_class_id: val, section_id: "" })}
                    >
                      <SelectTrigger id="as-class"><SelectValue placeholder="Class" /></SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="as-section">Section</Label>
                    <Select
                      value={assignForm.section_id}
                      onValueChange={(val) => setAssignForm({ ...assignForm, section_id: val })}
                      disabled={!assignForm.school_class_id}
                    >
                      <SelectTrigger id="as-section"><SelectValue placeholder="Section" /></SelectTrigger>
                      <SelectContent>
                        {sections
                          .filter((sec) => sec.school_class_id === assignForm.school_class_id)
                          .map((sec) => (
                            <SelectItem key={sec.id} value={sec.id}>{sec.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="as-sub">Subject *</Label>
                    <Select
                      value={assignForm.subject_id}
                      onValueChange={(val) => setAssignForm({ ...assignForm, subject_id: val })}
                    >
                      <SelectTrigger id="as-sub"><SelectValue placeholder="Subject" /></SelectTrigger>
                      <SelectContent>
                        {subjects.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button type="submit" size="sm" className="w-full">
                  <Plus className="w-4 h-4 mr-1" /> Add Assignment
                </Button>
              </form>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
        title={deleteConfirm?.title}
        description={deleteConfirm?.description}
        confirmLabel={deleteConfirm?.confirmLabel}
        onConfirm={deleteConfirm?.onConfirm}
      />
    </div>
  );
}
