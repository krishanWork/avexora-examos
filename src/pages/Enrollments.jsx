import React, { useEffect, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  GraduationCap, Plus, ArrowRightLeft, Search, Trash2, CheckSquare, Square
} from "lucide-react";
import { StatusBadge } from "@/lib/statusTokens";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

export default function Enrollments() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const isManageAllowed = can(user, "manage_students");

  const [enrollments, setEnrollments] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Filters
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modals
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [selectedEnrollmentForPromote, setSelectedEnrollmentForPromote] = useState(null);

  // Bulk cohort promotion state
  const [bulkPromoteOpen, setBulkPromoteOpen] = useState(false);
  const [bulkSourceYear, setBulkSourceYear] = useState("");
  const [bulkSourceClass, setBulkSourceClass] = useState("");
  const [bulkSourceSection, setBulkSourceSection] = useState("all");
  const [bulkTargetYear, setBulkTargetYear] = useState("");
  const [bulkTargetClass, setBulkTargetClass] = useState("");
  const [bulkTargetSection, setBulkTargetSection] = useState("");
  const [bulkSelectedIds, setBulkSelectedIds] = useState([]);
  const [bulkPromoting, setBulkPromoting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

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

  // Enroll Form
  const [enrollForm, setEnrollForm] = useState({
    student_id: "",
    academic_year_id: "",
    school_class_id: "",
    section_id: "",
    roll_number: "",
    status: "enrolled",
    enrollment_date: new Date().toISOString().split("T")[0],
  });

  // Promote Form
  const [promoteForm, setPromoteForm] = useState({
    academic_year_id: "",
    school_class_id: "",
    section_id: "",
    roll_number: "",
    status: "promoted",
    enrollment_date: new Date().toISOString().split("T")[0],
  });

  const load = async () => {
    if (!user?.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      const [eList, yList, cList, secList, sList] = await Promise.all([
        appClient.entities.Enrollment.filter({ tenant_id: user.tenant_id }, "-created_date").catch(() => []),
        appClient.entities.AcademicYear.filter({ tenant_id: user.tenant_id }, "-name").catch(() => []),
        appClient.entities.SchoolClass.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Section.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Student.filter({ tenant_id: user.tenant_id }, "full_name").catch(() => []),
      ]);
      setEnrollments(eList);
      setAcademicYears(yList);
      setClasses(cList);
      setSections(secList);
      setStudents(sList);

      // Default year to current year if available
      const currYear = yList.find((y) => y.is_current);
      if (currYear && !enrollForm.academic_year_id) {
        setEnrollForm((prev) => ({ ...prev, academic_year_id: currYear.id }));
      }
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load enrollments", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.tenant_id]);

  const studentMap = Object.fromEntries(students.map((s) => [s.id, s]));
  const yearMap = Object.fromEntries(academicYears.map((y) => [y.id, y]));
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c]));
  const sectionMap = Object.fromEntries(sections.map((sec) => [sec.id, sec]));

  // Open Enroll Dialog
  const handleOpenEnrollDialog = () => {
    const currentYear = academicYears.find((y) => y.is_current) || academicYears[0];
    setEnrollForm({
      student_id: "",
      academic_year_id: currentYear?.id || "",
      school_class_id: "",
      section_id: "",
      roll_number: "",
      status: "enrolled",
      enrollment_date: new Date().toISOString().split("T")[0],
    });
    setEnrollDialogOpen(true);
  };

  const handleSaveEnrollment = async (e) => {
    e.preventDefault();
    if (!enrollForm.student_id || !enrollForm.academic_year_id || !enrollForm.school_class_id) {
      toast({ title: "Student, Academic Year, and Class are required", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        tenant_id: user.tenant_id,
        student_id: enrollForm.student_id,
        academic_year_id: enrollForm.academic_year_id,
        school_class_id: enrollForm.school_class_id,
        section_id: enrollForm.section_id || null,
        roll_number: enrollForm.roll_number.trim() || null,
        status: enrollForm.status || "enrolled",
        enrollment_date: enrollForm.enrollment_date || new Date().toISOString().split("T")[0],
      };
      const created = await appClient.entities.Enrollment.create(payload);
      const studentObj = studentMap[enrollForm.student_id];
      const classObj = classMap[enrollForm.school_class_id];
      await logAudit({
        user,
        action: "create",
        entity_type: "Enrollment",
        entity_id: created.id,
        details: `Enrolled ${studentObj?.full_name || enrollForm.student_id} into ${classObj?.name || "Class"}`,
      });
      toast({ title: "Student enrolled successfully" });
      setEnrollDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Enrollment failed", description: err.message, variant: "destructive" });
    }
  };

  // Open Promote / Transfer Dialog
  const handleOpenPromoteDialog = (enrollment) => {
    setSelectedEnrollmentForPromote(enrollment);
    // Suggest next academic year if available
    const nextYear = academicYears.find((y) => y.id !== enrollment.academic_year_id);
    setPromoteForm({
      academic_year_id: nextYear?.id || "",
      school_class_id: "",
      section_id: "",
      roll_number: enrollment.roll_number || "",
      status: "promoted",
      enrollment_date: new Date().toISOString().split("T")[0],
    });
    setPromoteDialogOpen(true);
  };

  const handleSavePromotion = async (e) => {
    e.preventDefault();
    if (!promoteForm.academic_year_id || !promoteForm.school_class_id) {
      toast({ title: "Target Academic Year and Class are required", variant: "destructive" });
      return;
    }
    try {
      // 1. Mark previous enrollment as promoted if appropriate
      if (selectedEnrollmentForPromote && selectedEnrollmentForPromote.status === "enrolled") {
        await appClient.entities.Enrollment.update(selectedEnrollmentForPromote.id, {
          status: "promoted",
        });
      }

      // 2. CREATE NEW ENROLLMENT RECORD (crucial requirement: preserve historical records)
      const payload = {
        tenant_id: user.tenant_id,
        student_id: selectedEnrollmentForPromote.student_id,
        academic_year_id: promoteForm.academic_year_id,
        school_class_id: promoteForm.school_class_id,
        section_id: promoteForm.section_id || null,
        roll_number: promoteForm.roll_number.trim() || null,
        status: "enrolled",
        enrollment_date: promoteForm.enrollment_date || new Date().toISOString().split("T")[0],
      };
      const created = await appClient.entities.Enrollment.create(payload);

      // 3. Update Student active placement
      const targetClass = classMap[promoteForm.school_class_id];
      const targetSection = sections.find((s) => s.id === promoteForm.section_id);
      if (targetClass) {
        await appClient.entities.Student.update(selectedEnrollmentForPromote.student_id, {
          class_name: targetClass.name,
          section: targetSection?.name || "",
          ...(promoteForm.roll_number?.trim() ? { roll_number: promoteForm.roll_number.trim() } : {}),
        });
      }

      const studentObj = studentMap[selectedEnrollmentForPromote.student_id];
      await logAudit({
        user,
        action: "create",
        entity_type: "Enrollment",
        entity_id: created.id,
        details: `Promoted ${studentObj?.full_name || "Student"} to ${targetClass?.name || "Next Class"}`,
      });

      toast({ title: "Student successfully promoted to new academic year" });
      setPromoteDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Promotion failed", description: err.message, variant: "destructive" });
    }
  };

  // Bulk cohort promotion handler
  const handleOpenBulkPromote = () => {
    const currentYear = academicYears.find((y) => y.is_current) || academicYears[0];
    const nextYear = academicYears.find((y) => y.id !== currentYear?.id) || currentYear;
    setBulkSourceYear(currentYear?.id || "");
    setBulkSourceClass(classes[0]?.id || "");
    setBulkSourceSection("all");
    setBulkTargetYear(nextYear?.id || "");
    setBulkTargetClass(classes[1]?.id || classes[0]?.id || "");
    setBulkTargetSection("preserve");
    setBulkProgress(0);
    setBulkPromoteOpen(true);
  };

  const cohortCandidates = enrollments.filter((e) => {
    if (!bulkSourceYear || !bulkSourceClass) return false;
    if (e.academic_year_id !== bulkSourceYear) return false;
    if (e.school_class_id !== bulkSourceClass) return false;
    if (bulkSourceSection !== "all" && e.section_id !== bulkSourceSection) return false;
    return e.status === "enrolled";
  });

  // Keep selected IDs in sync when candidates change
  useEffect(() => {
    if (bulkPromoteOpen) {
      setBulkSelectedIds(cohortCandidates.map((e) => e.id));
    }
  }, [bulkSourceYear, bulkSourceClass, bulkSourceSection, bulkPromoteOpen]);

  const handleExecuteBulkPromotion = async () => {
    if (!bulkTargetYear || !bulkTargetClass) {
      toast({ title: "Please select target academic year and class", variant: "destructive" });
      return;
    }
    if (bulkSelectedIds.length === 0) {
      toast({ title: "No students selected for promotion", variant: "destructive" });
      return;
    }

    setBulkPromoting(true);
    setBulkProgress(0);
    const targetClassObj = classMap[bulkTargetClass];
    const targetSectionObj = bulkTargetSection !== "preserve" ? sections.find((s) => s.id === bulkTargetSection) : null;
    const selectedEnrollments = cohortCandidates.filter((e) => bulkSelectedIds.includes(e.id));
    let successCount = 0;

    try {
      for (let i = 0; i < selectedEnrollments.length; i++) {
        const en = selectedEnrollments[i];
        // 1. Mark existing enrollment as promoted
        await appClient.entities.Enrollment.update(en.id, { status: "promoted" });

        // 2. Create new enrollment in target year/class
        await appClient.entities.Enrollment.create({
          tenant_id: user.tenant_id,
          student_id: en.student_id,
          academic_year_id: bulkTargetYear,
          school_class_id: bulkTargetClass,
          section_id: (bulkTargetSection && bulkTargetSection !== "preserve") ? bulkTargetSection : en.section_id || null,
          roll_number: en.roll_number || null,
          status: "enrolled",
          enrollment_date: new Date().toISOString().split("T")[0],
        });

        // 3. Update Student current class placement
        if (targetClassObj) {
          await appClient.entities.Student.update(en.student_id, {
            class_name: targetClassObj.name,
            section: targetSectionObj?.name || sectionMap[en.section_id]?.name || "",
          });
        }

        successCount++;
        setBulkProgress(Math.round(((i + 1) / selectedEnrollments.length) * 100));
      }

      await logAudit({
        user,
        action: "bulk_promotion",
        entity_type: "Enrollment",
        details: `Bulk promoted ${successCount} students from ${classMap[bulkSourceClass]?.name} to ${targetClassObj?.name}`,
      });

      toast({
        title: "Cohort Promotion Completed",
        description: `Successfully promoted ${successCount} students to ${targetClassObj?.name}.`,
      });
      setBulkPromoteOpen(false);
      load();
    } catch (err) {
      toast({ title: "Bulk promotion interrupted", description: err.message, variant: "destructive" });
    } finally {
      setBulkPromoting(false);
    }
  };

  const handleDeleteEnrollment = (enrollment) => {
    requestDelete({
      title: "Remove enrollment?",
      description: "Are you sure you want to remove this enrollment record? This cannot be undone.",
      confirmLabel: "Remove Enrollment",
      action: async () => {
        await appClient.entities.Enrollment.delete(enrollment.id);
        await logAudit({
          user,
          action: "delete",
          entity_type: "Enrollment",
          entity_id: enrollment.id,
          details: `Deleted enrollment ${enrollment.id}`,
        });
        toast({ title: "Enrollment record removed" });
        load();
      },
    });
  };

  // Filtered dataset
  const filteredEnrollments = enrollments.filter((e) => {
    if (yearFilter !== "all" && e.academic_year_id !== yearFilter) return false;
    if (classFilter !== "all" && e.school_class_id !== classFilter) return false;
    if (sectionFilter !== "all" && e.section_id !== sectionFilter) return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const sName = (studentMap[e.student_id]?.full_name || "").toLowerCase();
      const rNum = (e.roll_number || "").toLowerCase();
      const admNum = (studentMap[e.student_id]?.admission_number || "").toLowerCase();
      if (!sName.includes(q) && !rNum.includes(q) && !admNum.includes(q)) return false;
    }
    return true;
  });

  const columns = [
    {
      key: "student",
      header: "Student",
      cell: (row) => {
        const student = studentMap[row.student_id];
        return (
          <div>
            <Link
              to={`/students/${row.student_id}`}
              className="font-medium text-indigo-600 hover:underline"
            >
              {student?.full_name || "Unknown Student"}
            </Link>
            <p className="text-xs text-stone-500">Adm: {student?.admission_number || "-"}</p>
          </div>
        );
      },
    },
    {
      key: "academic_year",
      header: "Academic Year",
      cell: (row) => {
        const year = yearMap[row.academic_year_id];
        return (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-stone-800">{year?.name || "-"}</span>
            {year?.is_current && (
              <Badge variant="outline" className="text-[11px] bg-emerald-50 text-emerald-700 border-emerald-200">
                Current
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "class_section",
      header: "Class & Section",
      cell: (row) => {
        const cls = classMap[row.school_class_id];
        const sec = sectionMap[row.section_id];
        return (
          <span className="font-medium text-stone-900">
            {cls?.name || "Class"} {sec?.name ? `- ${sec.name}` : ""}
          </span>
        );
      },
    },
    {
      key: "roll_number",
      header: "Roll No.",
      cell: (row) => row.roll_number || "-",
    },
    {
      key: "enrollment_date",
      header: "Enrolled Date",
      cell: (row) => row.enrollment_date || "-",
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status || "enrolled"} type="enrollment" />,
    },
    ...(isManageAllowed
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (row) => (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  onClick={() => handleOpenPromoteDialog(row)}
                  title="Promote or Transfer Student"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1 text-indigo-600" /> Promote
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                  onClick={() => handleDeleteEnrollment(row)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Student Enrollments & Progression"
        description="Track academic year enrollments, section assignments, and multi-year grade progression."
        actions={
          isManageAllowed ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleOpenBulkPromote} className="gap-1.5 shadow-sm">
                <ArrowRightLeft className="w-4 h-4 text-indigo-600" /> Bulk Promote Cohort
              </Button>
              <Button onClick={handleOpenEnrollDialog} className="gap-1.5 shadow-sm">
                <Plus className="w-4 h-4" /> Enroll Student
              </Button>
            </div>
          ) : (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Principal Oversight (View-Only)
            </Badge>
          )
        }
      />

      {/* Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <Input
            placeholder="Search student or roll..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger><SelectValue placeholder="Academic Year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Academic Years</SelectItem>
              {academicYears.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name} {y.is_current ? "(Current)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sections</SelectItem>
              {sections.map((sec) => (
                <SelectItem key={sec.id} value={sec.id}>
                  {classMap[sec.school_class_id]?.name || ""} - {sec.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="enrolled">Enrolled</SelectItem>
              <SelectItem value="promoted">Promoted</SelectItem>
              <SelectItem value="transferred">Transferred</SelectItem>
              <SelectItem value="graduated">Graduated</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredEnrollments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No enrollment records match filters."
        emptyIcon={GraduationCap}
        pagination={{
          page,
          totalItems: filteredEnrollments.length,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
        }}
      />

      {/* Enroll Student Dialog */}
      <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enroll Student</DialogTitle>
          </DialogHeader>
          <form id="enroll-form" onSubmit={handleSaveEnrollment} className="space-y-4">
            <div>
              <Label htmlFor="en-student">Student *</Label>
              <Select
                value={enrollForm.student_id}
                onValueChange={(val) => setEnrollForm({ ...enrollForm, student_id: val })}
              >
                <SelectTrigger id="en-student"><SelectValue placeholder="Select student..." /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name} ({s.admission_number || "No Adm No"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="en-year">Academic Year *</Label>
              <Select
                value={enrollForm.academic_year_id}
                onValueChange={(val) => setEnrollForm({ ...enrollForm, academic_year_id: val })}
              >
                <SelectTrigger id="en-year"><SelectValue placeholder="Select year..." /></SelectTrigger>
                <SelectContent>
                  {academicYears.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name} {y.is_current ? "(Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="en-class">Class *</Label>
                <Select
                  value={enrollForm.school_class_id}
                  onValueChange={(val) => setEnrollForm({ ...enrollForm, school_class_id: val, section_id: "" })}
                >
                  <SelectTrigger id="en-class"><SelectValue placeholder="Select class..." /></SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="en-section">Section</Label>
                <Select
                  value={enrollForm.section_id}
                  onValueChange={(val) => setEnrollForm({ ...enrollForm, section_id: val })}
                  disabled={!enrollForm.school_class_id}
                >
                  <SelectTrigger id="en-section"><SelectValue placeholder="Select section..." /></SelectTrigger>
                  <SelectContent>
                    {sections
                      .filter((sec) => sec.school_class_id === enrollForm.school_class_id)
                      .map((sec) => (
                        <SelectItem key={sec.id} value={sec.id}>{sec.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="en-roll">Roll Number</Label>
                <Input
                  id="en-roll"
                  placeholder="e.g. 10-A-01"
                  value={enrollForm.roll_number}
                  onChange={(e) => setEnrollForm({ ...enrollForm, roll_number: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="en-date">Enrollment Date</Label>
                <Input
                  id="en-date"
                  type="date"
                  value={enrollForm.enrollment_date}
                  onChange={(e) => setEnrollForm({ ...enrollForm, enrollment_date: e.target.value })}
                />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="enroll-form" disabled={!enrollForm.student_id || !enrollForm.school_class_id}>
              Save Enrollment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promote / Progression Dialog */}
      <Dialog open={promoteDialogOpen} onOpenChange={setPromoteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Promote / Transfer Student</DialogTitle>
          </DialogHeader>
          <div className="bg-stone-50 p-3 rounded-lg text-xs space-y-1 mb-2 border border-stone-200">
            <p className="font-semibold text-stone-800">
              {studentMap[selectedEnrollmentForPromote?.student_id]?.full_name}
            </p>
            <p className="text-stone-600">
              Current: {yearMap[selectedEnrollmentForPromote?.academic_year_id]?.name} — {classMap[selectedEnrollmentForPromote?.school_class_id]?.name} {sectionMap[selectedEnrollmentForPromote?.section_id]?.name ? `(${sectionMap[selectedEnrollmentForPromote?.section_id]?.name})` : ""}
            </p>
            <p className="text-indigo-600 font-medium pt-1">
              ✓ Historical enrollment record will be preserved.
            </p>
          </div>

          <form id="promote-form" onSubmit={handleSavePromotion} className="space-y-4">
            <div>
              <Label htmlFor="pr-year">Target Academic Year *</Label>
              <Select
                value={promoteForm.academic_year_id}
                onValueChange={(val) => setPromoteForm({ ...promoteForm, academic_year_id: val })}
              >
                <SelectTrigger id="pr-year"><SelectValue placeholder="Select target year..." /></SelectTrigger>
                <SelectContent>
                  {academicYears.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name} {y.is_current ? "(Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pr-class">Target Class *</Label>
                <Select
                  value={promoteForm.school_class_id}
                  onValueChange={(val) => setPromoteForm({ ...promoteForm, school_class_id: val, section_id: "" })}
                >
                  <SelectTrigger id="pr-class"><SelectValue placeholder="Select class..." /></SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="pr-section">Target Section</Label>
                <Select
                  value={promoteForm.section_id}
                  onValueChange={(val) => setPromoteForm({ ...promoteForm, section_id: val })}
                  disabled={!promoteForm.school_class_id}
                >
                  <SelectTrigger id="pr-section"><SelectValue placeholder="Select section..." /></SelectTrigger>
                  <SelectContent>
                    {sections
                      .filter((sec) => sec.school_class_id === promoteForm.school_class_id)
                      .map((sec) => (
                        <SelectItem key={sec.id} value={sec.id}>{sec.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pr-roll">New Roll Number</Label>
                <Input
                  id="pr-roll"
                  placeholder="e.g. 11-A-01"
                  value={promoteForm.roll_number}
                  onChange={(e) => setPromoteForm({ ...promoteForm, roll_number: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pr-date">Promotion Date</Label>
                <Input
                  id="pr-date"
                  type="date"
                  value={promoteForm.enrollment_date}
                  onChange={(e) => setPromoteForm({ ...promoteForm, enrollment_date: e.target.value })}
                />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="promote-form" disabled={!promoteForm.academic_year_id || !promoteForm.school_class_id}>
              Confirm Promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Cohort Promotion Wizard Modal */}
      <Dialog open={bulkPromoteOpen} onOpenChange={(openState) => !bulkPromoting && setBulkPromoteOpen(openState)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-stone-900">
              <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
              Bulk Cohort Academic Promotion Wizard
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Step 1: Source Cohort */}
            <div className="bg-stone-50 p-3.5 rounded-md border border-stone-200 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-stone-700">1. Source Cohort</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Academic Year *</Label>
                  <Select value={bulkSourceYear} onValueChange={setBulkSourceYear} disabled={bulkPromoting}>
                    <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Source Year" /></SelectTrigger>
                    <SelectContent>
                      {academicYears.map((y) => (
                        <SelectItem key={y.id} value={y.id} className="text-xs">{y.name} {y.is_current ? "(Current)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Current Class *</Label>
                  <Select value={bulkSourceClass} onValueChange={setBulkSourceClass} disabled={bulkPromoting}>
                    <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Source Class" /></SelectTrigger>
                    <SelectContent>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Section</Label>
                  <Select value={bulkSourceSection} onValueChange={setBulkSourceSection} disabled={bulkPromoting}>
                    <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="All Sections" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All Sections</SelectItem>
                      {sections.filter((s) => s.school_class_id === bulkSourceClass).map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">Section {s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Step 2: Destination Placement */}
            <div className="bg-indigo-50/50 p-3.5 rounded-md border border-indigo-100 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-900">2. Destination Placement</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Target Academic Year *</Label>
                  <Select value={bulkTargetYear} onValueChange={setBulkTargetYear} disabled={bulkPromoting}>
                    <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Target Year" /></SelectTrigger>
                    <SelectContent>
                      {academicYears.map((y) => (
                        <SelectItem key={y.id} value={y.id} className="text-xs">{y.name} {y.is_current ? "(Current)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Promote to Class *</Label>
                  <Select value={bulkTargetClass} onValueChange={setBulkTargetClass} disabled={bulkPromoting}>
                    <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Target Class" /></SelectTrigger>
                    <SelectContent>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Target Section</Label>
                  <Select value={bulkTargetSection} onValueChange={setBulkTargetSection} disabled={bulkPromoting}>
                    <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Preserve Section" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preserve" className="text-xs">Same as current / Unassigned</SelectItem>
                      {sections.filter((s) => s.school_class_id === bulkTargetClass).map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">Section {s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Step 3: Student Selection Roster */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-700">
                  3. Select Students to Advance ({bulkSelectedIds.length} of {cohortCandidates.length})
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-indigo-600 hover:underline"
                    onClick={() => setBulkSelectedIds(cohortCandidates.map((e) => e.id))}
                    disabled={bulkPromoting}
                  >
                    Select All
                  </button>
                  <span className="text-stone-300">·</span>
                  <button
                    type="button"
                    className="text-xs text-stone-500 hover:underline"
                    onClick={() => setBulkSelectedIds([])}
                    disabled={bulkPromoting}
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="border border-stone-200 rounded-md max-h-56 overflow-y-auto divide-y divide-stone-100 bg-white">
                {cohortCandidates.length === 0 ? (
                  <div className="p-6 text-center text-xs text-stone-400">
                    No active enrolled students found in selected source cohort.
                  </div>
                ) : (
                  cohortCandidates.map((e) => {
                    const st = studentMap[e.student_id];
                    const isChecked = bulkSelectedIds.includes(e.id);
                    return (
                      <div
                        key={e.id}
                        className={`flex items-center justify-between p-2.5 hover:bg-stone-50 cursor-pointer ${
                          isChecked ? "bg-indigo-50/20" : ""
                        }`}
                        onClick={() => {
                          if (bulkPromoting) return;
                          setBulkSelectedIds((prev) =>
                            isChecked ? prev.filter((id) => id !== e.id) : [...prev, e.id]
                          );
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-stone-300 shrink-0" />
                          )}
                          <div>
                            <p className="text-xs font-medium text-stone-900">{st?.full_name || "Student"}</p>
                            <p className="text-[11px] text-stone-400">
                              Adm: {st?.admission_number || "—"} · Roll: {e.roll_number || st?.roll_number || "—"}
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] text-stone-500 font-mono">
                          {sectionMap[e.section_id]?.name ? `Sec ${sectionMap[e.section_id].name}` : "—"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Progress Bar during execution */}
            {bulkPromoting && (
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-xs text-stone-600 font-medium">
                  <span>Advancing cohort to new academic year...</span>
                  <span className="font-mono">{bulkProgress}%</span>
                </div>
                <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-full transition-all duration-200" style={{ width: `${bulkProgress}%` }} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-stone-100">
            <Button variant="outline" onClick={() => setBulkPromoteOpen(false)} disabled={bulkPromoting}>
              Cancel
            </Button>
            <Button
              onClick={handleExecuteBulkPromotion}
              disabled={bulkPromoting || bulkSelectedIds.length === 0 || !bulkTargetYear || !bulkTargetClass}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-sm"
            >
              <ArrowRightLeft className="w-4 h-4" />
              {bulkPromoting
                ? `Promoting ${bulkProgress}%...`
                : `Promote ${bulkSelectedIds.length} Student${bulkSelectedIds.length !== 1 ? "s" : ""}`}
            </Button>
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
