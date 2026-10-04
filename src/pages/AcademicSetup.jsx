import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import {
  Layers, BookOpen, Plus, Pencil, Trash2, Search,
  BookCheck, Calendar, Building, Wand2, Users,
  Sparkles
} from "lucide-react";
import AcademicWizardModal from "@/components/academic/AcademicWizardModal";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

export default function AcademicSetup() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const isManageAllowed = can(user, "manage_academics");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState("");

  const [academicYears, setAcademicYears] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);

  // Forms and dialogs
  const [yearDialogOpen, setYearDialogOpen] = useState(false);
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);

  const [editingYear, setEditingYear] = useState(null);
  const [editingClass, setEditingClass] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [selectedClassForSection, setSelectedClassForSection] = useState(null);
  const [editingSubject, setEditingSubject] = useState(null);

  // Branded delete confirmation
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

  // Academic Year Form State
  const [yearForm, setYearForm] = useState({
    name: "",
    start_date: "",
    end_date: "",
    status: "active",
    is_current: false,
  });

  // Class Form State
  const [className, setClassName] = useState("");
  const [classGradeLevel, setClassGradeLevel] = useState("");

  // Section Form State
  const [sectionForm, setSectionForm] = useState({
    name: "",
    room_number: "",
    capacity: 40,
    status: "active",
  });

  // Subject Form State
  const [subjectForm, setSubjectForm] = useState({
    name: "",
    code: "",
    department: "",
    category: "Core",
    credits: 1,
    status: "active",
  });

  // Search & Filter
  const [yearSearch, setYearSearch] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");

  const load = async () => {
    if (!user?.tenant_id) return;
    try {
      const [y, c, sec, s, st] = await Promise.all([
        appClient.entities.AcademicYear.filter({ tenant_id: user.tenant_id }, "-name").catch(() => []),
        appClient.entities.SchoolClass.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Section.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Subject.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Student.filter({ tenant_id: user.tenant_id, status: "active" }).catch(() => []),
      ]);
      setAcademicYears(y);
      setClasses(c);
      setSections(sec);
      setSubjects(s);
      setStudents(st);
    } catch (err) {
      console.error("Failed to load academic data:", err);
    }
  };

  useEffect(() => { load(); }, [user?.tenant_id]);

  // =========================================================================
  // ACADEMIC YEAR HANDLERS
  // =========================================================================
  const handleOpenYearDialog = (yr = null) => {
    if (yr) {
      setEditingYear(yr);
      setYearForm({
        name: yr.name || "",
        start_date: yr.start_date || "",
        end_date: yr.end_date || "",
        status: yr.status || "active",
        is_current: Boolean(yr.is_current),
      });
    } else {
      setEditingYear(null);
      setYearForm({
        name: "",
        start_date: "",
        end_date: "",
        status: "active",
        is_current: academicYears.length === 0,
      });
    }
    setYearDialogOpen(true);
  };

  const handleSaveYear = async (e) => {
    e.preventDefault();
    if (!yearForm.name.trim()) {
      toast({ title: "Academic year name is required", variant: "destructive" });
      return;
    }
    try {
      if (yearForm.is_current) {
        // Unset any previous current year
        for (const other of academicYears) {
          if (other.is_current && (!editingYear || other.id !== editingYear.id)) {
            await appClient.entities.AcademicYear.update(other.id, { is_current: false });
          }
        }
      }
      const payload = {
        tenant_id: user.tenant_id,
        name: yearForm.name.trim(),
        start_date: yearForm.start_date || undefined,
        end_date: yearForm.end_date || undefined,
        status: yearForm.status || "active",
        is_current: Boolean(yearForm.is_current),
      };

      if (editingYear) {
        await appClient.entities.AcademicYear.update(editingYear.id, payload);
        await logAudit({ user, action: "update", entity_type: "AcademicYear", entity_id: editingYear.id, details: payload.name });
        toast({ title: "Academic year updated" });
      } else {
        const created = await appClient.entities.AcademicYear.create(payload);
        await logAudit({ user, action: "create", entity_type: "AcademicYear", entity_id: created.id, details: payload.name });
        toast({ title: "Academic year created" });
      }
      setYearDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleCurrentYear = async (yr) => {
    try {
      for (const other of academicYears) {
        if (other.id !== yr.id && other.is_current) {
          await appClient.entities.AcademicYear.update(other.id, { is_current: false });
        }
      }
      await appClient.entities.AcademicYear.update(yr.id, { is_current: !yr.is_current });
      await logAudit({ user, action: "update", entity_type: "AcademicYear", entity_id: yr.id, details: `Set current=${!yr.is_current}` });
      toast({ title: yr.is_current ? "Year marked as non-current" : `${yr.name} set as current academic year` });
      load();
    } catch (err) {
      toast({ title: "Failed to update current year", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteYear = (yr) => {
    requestDelete({
      title: "Delete academic year?",
      description: `Are you sure you want to delete ${yr.name}? This cannot be undone.`,
      confirmLabel: "Delete Year",
      action: async () => {
        await appClient.entities.AcademicYear.delete(yr.id);
        await logAudit({ user, action: "delete", entity_type: "AcademicYear", entity_id: yr.id, details: yr.name });
        toast({ title: "Academic year removed" });
        load();
      },
    });
  };

  // =========================================================================
  // CLASS HANDLERS
  // =========================================================================
  const handleOpenClassDialog = (cls = null) => {
    if (cls) {
      setEditingClass(cls);
      setClassName(cls.name || "");
      setClassGradeLevel(cls.grade_level || "");
    } else {
      setEditingClass(null);
      setClassName("");
      setClassGradeLevel("");
    }
    setClassDialogOpen(true);
  };

  const handleSaveClass = async (e) => {
    e.preventDefault();
    if (!className.trim()) {
      toast({ title: "Class name is required", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        tenant_id: user.tenant_id,
        name: className.trim(),
        grade_level: classGradeLevel.trim() || undefined,
      };
      if (editingClass) {
        await appClient.entities.SchoolClass.update(editingClass.id, payload);
        await logAudit({ user, action: "update", entity_type: "SchoolClass", entity_id: editingClass.id, details: payload.name });
        toast({ title: "Class updated successfully" });
      } else {
        const created = await appClient.entities.SchoolClass.create(payload);
        // Automatically create default Section A
        await appClient.entities.Section.create({
          tenant_id: user.tenant_id,
          school_class_id: created.id,
          name: "A",
          room_number: "101",
          capacity: 40,
          status: "active",
        });
        await logAudit({ user, action: "create", entity_type: "SchoolClass", entity_id: created.id, details: payload.name });
        toast({ title: "Class created with default Section A" });
      }
      setClassDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteClass = (cls) => {
    requestDelete({
      title: "Delete class?",
      description: `Are you sure you want to delete ${cls.name}? Its sections will also be removed. This cannot be undone.`,
      confirmLabel: "Delete Class",
      action: async () => {
        const childSections = sections.filter((s) => s.school_class_id === cls.id);
        for (const s of childSections) {
          await appClient.entities.Section.delete(s.id);
        }
        await appClient.entities.SchoolClass.delete(cls.id);
        await logAudit({ user, action: "delete", entity_type: "SchoolClass", entity_id: cls.id, details: cls.name });
        toast({ title: "Class and its sections removed" });
        load();
      },
    });
  };

  // =========================================================================
  // SECTION HANDLERS
  // =========================================================================
  const handleOpenSectionDialog = (cls, sec = null) => {
    setSelectedClassForSection(cls);
    if (sec) {
      setEditingSection(sec);
      setSectionForm({
        name: sec.name || "",
        room_number: sec.room_number || "",
        capacity: sec.capacity || 40,
        status: sec.status || "active",
      });
    } else {
      setEditingSection(null);
      setSectionForm({
        name: "",
        room_number: "",
        capacity: 40,
        status: "active",
      });
    }
    setSectionDialogOpen(true);
  };

  const handleSaveSection = async (e) => {
    e.preventDefault();
    if (!sectionForm.name.trim()) {
      toast({ title: "Section name is required", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        tenant_id: user.tenant_id,
        school_class_id: selectedClassForSection.id,
        name: sectionForm.name.trim(),
        room_number: sectionForm.room_number.trim() || undefined,
        capacity: Number(sectionForm.capacity) || 40,
        status: sectionForm.status || "active",
      };
      if (editingSection) {
        await appClient.entities.Section.update(editingSection.id, payload);
        await logAudit({ user, action: "update", entity_type: "Section", entity_id: editingSection.id, details: `${selectedClassForSection.name} - ${payload.name}` });
        toast({ title: "Section updated" });
      } else {
        const created = await appClient.entities.Section.create(payload);
        await logAudit({ user, action: "create", entity_type: "Section", entity_id: created.id, details: `${selectedClassForSection.name} - ${payload.name}` });
        toast({ title: "Section created" });
      }
      setSectionDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteSection = (sec) => {
    requestDelete({
      title: "Delete section?",
      description: `Are you sure you want to delete section ${sec.name}? This cannot be undone.`,
      confirmLabel: "Delete Section",
      action: async () => {
        await appClient.entities.Section.delete(sec.id);
        await logAudit({ user, action: "delete", entity_type: "Section", entity_id: sec.id, details: sec.name });
        toast({ title: "Section removed" });
        load();
      },
    });
  };

  // =========================================================================
  // SUBJECT HANDLERS
  // =========================================================================
  const handleOpenSubjectDialog = (sub = null) => {
    if (sub) {
      setEditingSubject(sub);
      setSubjectForm({
        name: sub.name || "",
        code: sub.code || "",
        department: sub.department || "",
        category: sub.category || "Core",
        credits: sub.credits || 1,
        status: sub.status || "active",
      });
    } else {
      setEditingSubject(null);
      setSubjectForm({
        name: "",
        code: "",
        department: "",
        category: "Core",
        credits: 1,
        status: "active",
      });
    }
    setSubjectDialogOpen(true);
  };

  const handleSaveSubject = async (e) => {
    e.preventDefault();
    if (!subjectForm.name.trim()) {
      toast({ title: "Subject name is required", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        tenant_id: user.tenant_id,
        name: subjectForm.name.trim(),
        code: subjectForm.code.trim() || undefined,
        department: subjectForm.department.trim() || undefined,
        category: subjectForm.category,
        credits: Number(subjectForm.credits) || 1,
        status: subjectForm.status || "active",
      };
      if (editingSubject) {
        await appClient.entities.Subject.update(editingSubject.id, payload);
        await logAudit({ user, action: "update", entity_type: "Subject", entity_id: editingSubject.id, details: payload.name });
        toast({ title: "Subject updated successfully" });
      } else {
        const created = await appClient.entities.Subject.create(payload);
        await logAudit({ user, action: "create", entity_type: "Subject", entity_id: created.id, details: payload.name });
        toast({ title: "Subject created successfully" });
      }
      setSubjectDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteSubject = (sub) => {
    requestDelete({
      title: "Delete subject?",
      description: `Are you sure you want to delete ${sub.name}? This cannot be undone.`,
      confirmLabel: "Delete Subject",
      action: async () => {
        await appClient.entities.Subject.delete(sub.id);
        await logAudit({ user, action: "delete", entity_type: "Subject", entity_id: sub.id, details: sub.name });
        toast({ title: "Subject deleted" });
        load();
      },
    });
  };

  const filteredYears = academicYears.filter((y) =>
    (y.name || "").toLowerCase().includes(yearSearch.toLowerCase())
  );
  const filteredClasses = classes.filter((c) =>
    (c.name || "").toLowerCase().includes(classSearch.toLowerCase())
  );
  const filteredSubjects = subjects.filter((s) =>
    (s.name || "").toLowerCase().includes(subjectSearch.toLowerCase()) ||
    (s.code || "").toLowerCase().includes(subjectSearch.toLowerCase()) ||
    (s.department || "").toLowerCase().includes(subjectSearch.toLowerCase())
  );

  // Server-Derived Campus Infrastructure Totals
  const totalCapacity = sections.reduce((sum, s) => sum + (Number(s.capacity) || 40), 0);
  const activeYear = academicYears.find((y) => y.is_current) || academicYears[0];
  const capacityPct = totalCapacity > 0 ? Math.min(100, Math.round((students.length / totalCapacity) * 100)) : 0;

  // Group classes by educational stage
  const stageGroups = React.useMemo(() => {
    const groups = [
      { id: "pre_primary", title: "Pre-Primary", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", classes: [] },
      { id: "primary", title: "Primary School (Classes 1–5)", badge: "bg-indigo-50 text-indigo-700 border-indigo-200", classes: [] },
      { id: "middle", title: "Middle School (Classes 6–8)", badge: "bg-amber-50 text-amber-700 border-amber-200", classes: [] },
      { id: "secondary", title: "Secondary School (Classes 9–10)", badge: "bg-indigo-50 text-indigo-700 border-indigo-200", classes: [] },
      { id: "senior_secondary", title: "Senior Secondary (Classes 11–12)", badge: "bg-purple-50 text-purple-700 border-purple-200", classes: [] },
      { id: "other", title: "Additional Classes", badge: "bg-stone-50 text-stone-700 border-stone-200", classes: [] },
    ];

    const sortedClasses = [...classes].sort((a, b) => {
      const ordA = typeof a.order === "number" ? a.order : 99;
      const ordB = typeof b.order === "number" ? b.order : 99;
      return ordA - ordB;
    });

    for (const c of sortedClasses) {
      if (overviewSearch && !c.name.toLowerCase().includes(overviewSearch.toLowerCase())) {
        continue;
      }
      const n = (c.name || "").toLowerCase();
      const st = c.stage || c.grade_level || "";
      if (n.includes("nursery") || n.includes("lkg") || n.includes("ukg") || st === "pre_primary") {
        groups[0].classes.push(c);
      } else if (/\b(class\s*[1-5]|grade\s*[1-5])\b/i.test(n) || st === "primary") {
        groups[1].classes.push(c);
      } else if (/\b(class\s*[6-8]|grade\s*[6-8])\b/i.test(n) || st === "middle") {
        groups[2].classes.push(c);
      } else if (/\b(class\s*(9|10)|grade\s*(9|10))\b/i.test(n) || st === "secondary") {
        groups[3].classes.push(c);
      } else if (/\b(class\s*(11|12)|grade\s*(11|12))\b/i.test(n) || st === "senior_secondary") {
        groups[4].classes.push(c);
      } else {
        groups[5].classes.push(c);
      }
    }
    return groups.filter((g) => g.classes.length > 0);
  }, [classes, overviewSearch]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Academic Hierarchy & Structure"
        description="Configure academic years, classes, canonical sections, and subject courses."
        actions={
          isManageAllowed ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => setWizardOpen(true)}
                className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 hover:from-indigo-700 hover:to-purple-800 text-white text-xs font-semibold shadow-sm shadow-indigo-100"
              >
                <Wand2 className="w-4 h-4 mr-1.5 text-indigo-200" /> Setup Wizard (1000+ Students)
              </Button>
              <Button onClick={() => handleOpenYearDialog()} variant="outline" className="text-xs">
                <Calendar className="w-4 h-4 mr-1.5 text-indigo-600" /> Add Year
              </Button>
              <Button onClick={() => handleOpenClassDialog()} variant="outline" className="text-xs">
                <Plus className="w-4 h-4 mr-1.5 text-indigo-600" /> Add Class
              </Button>
              <Button onClick={() => handleOpenSubjectDialog()} variant="outline" className="text-xs">
                <BookCheck className="w-4 h-4 mr-1.5 text-emerald-600" /> Add Subject
              </Button>
            </div>
          ) : (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Principal Oversight (View-Only)
            </Badge>
          )
        }
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Campus Seat Capacity Card */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500">Campus Capacity</span>
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold text-stone-900">
              {totalCapacity.toLocaleString()} <span className="text-xs font-normal text-stone-500">seats</span>
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5">
              {students.length} active students ({capacityPct}% filled)
            </div>
            <div className="w-full bg-stone-100 rounded-full h-1.5 mt-2 overflow-hidden">
              <div
                className="bg-indigo-600 h-1.5 rounded-full transition-all"
                style={{ width: `${capacityPct}%` }}
              />
            </div>
          </div>
        </div>

        <StatCard
          label="Active Session"
          value={activeYear?.name || "None set"}
          icon={Calendar}
          accent="text-indigo-600"
        />
        <StatCard label="Total Classes" value={classes.length} icon={Layers} accent="text-indigo-600" />
        <StatCard label="Active Sections" value={sections.length} icon={Building} accent="text-emerald-600" />
        <StatCard label="Configured Subjects" value={subjects.length} icon={BookOpen} accent="text-amber-600" />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-stone-100 p-1 rounded-xl">
          <TabsTrigger value="overview" className="rounded-lg text-xs font-semibold px-4 py-2">
            Campus Structure ({classes.length})
          </TabsTrigger>
          <TabsTrigger value="years" className="rounded-lg text-xs font-semibold px-4 py-2">
            Academic Years ({academicYears.length})
          </TabsTrigger>
          <TabsTrigger value="classes" className="rounded-lg text-xs font-semibold px-4 py-2">
            Classes Table ({classes.length})
          </TabsTrigger>
          <TabsTrigger value="subjects" className="rounded-lg text-xs font-semibold px-4 py-2">
            Subjects & Courses ({subjects.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 0: CAMPUS STRUCTURE OVERVIEW */}
        <TabsContent value="overview" className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <Input
                placeholder="Filter grades or streams..."
                value={overviewSearch}
                onChange={(e) => setOverviewSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-white"
              />
            </div>
            {isManageAllowed && (
              <Button
                size="sm"
                onClick={() => setWizardOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
              >
                <Wand2 className="w-3.5 h-3.5 mr-1" /> Re-run Setup Wizard
              </Button>
            )}
          </div>

          {classes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-stone-300 p-12 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-semibold text-stone-900">No Academic Structure Initialized</h3>
                <p className="text-xs text-stone-500">
                  Quickly provision all grades, sections, Senior Secondary streams, and standard subjects using our guided wizard.
                </p>
              </div>
              {isManageAllowed && (
                <Button
                  onClick={() => setWizardOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                >
                  <Wand2 className="w-4 h-4 mr-1.5" /> Launch School Setup Wizard
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {stageGroups.map((stage) => (
                <div key={stage.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-stone-900">{stage.title}</h3>
                    <Badge variant="outline" className={`text-[11px] ${stage.badge}`}>
                      {stage.classes.length} Grades
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {stage.classes.map((cls) => {
                      const classSecs = sections.filter(
                        (s) => String(s.school_class_id) === String(cls.id || cls._id)
                      );
                      const classStudents = students.filter(
                        (st) => String(st.school_class_id) === String(cls.id || cls._id)
                      );
                      const classCap = classSecs.reduce((sum, s) => sum + (Number(s.capacity) || 40), 0);

                      return (
                        <div
                          key={cls.id || cls._id}
                          className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 hover:border-stone-300 transition-all flex flex-col justify-between"
                        >
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <h4 className="text-base font-bold text-stone-900">{cls.name}</h4>
                                <div className="text-[11px] text-stone-400 mt-0.5">
                                  {classStudents.length} enrolled · {classCap} seats total
                                </div>
                              </div>
                              <Badge variant="secondary" className="text-[11px] bg-stone-100 text-stone-600">
                                {classSecs.length} {classSecs.length === 1 ? "Section" : "Sections"}
                              </Badge>
                            </div>

                            {/* Section Pills */}
                            <div className="space-y-1.5">
                              <span className="text-[11px] uppercase font-bold tracking-wider text-stone-400 block">
                                Sections & Streams
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {classSecs.length === 0 ? (
                                  <span className="text-[11px] text-stone-400 italic">No sections created yet</span>
                                ) : (
                                  classSecs.map((sec) => (
                                    <Badge
                                      key={sec.id || sec._id || sec.name}
                                      variant="outline"
                                      className={`text-[11px] py-0.5 px-2 ${
                                        sec.stream
                                          ? "bg-purple-50/70 border-purple-200 text-purple-800"
                                          : "bg-stone-50 border-stone-200 text-stone-700"
                                      }`}
                                    >
                                      {sec.name}
                                      <span className="text-[9px] text-stone-400 ml-1">
                                        ({sec.capacity || 40})
                                      </span>
                                    </Badge>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>

                          {isManageAllowed && (
                            <div className="pt-3 mt-3 border-t border-stone-100 flex items-center justify-between">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenSectionDialog(cls, null)}
                                className="text-[11px] h-7 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2"
                              >
                                <Plus className="w-3 h-3 mr-1" /> Add Section
                              </Button>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleOpenClassDialog(cls)}
                                  className="h-7 w-7 text-stone-400 hover:text-stone-700"
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleDeleteClass(cls)}
                                  className="h-7 w-7 text-stone-400 hover:text-red-600"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 1: ACADEMIC YEARS */}
        <TabsContent value="years" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <Input
                placeholder="Search academic years..."
                value={yearSearch}
                onChange={(e) => setYearSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-white"
              />
            </div>
            {isManageAllowed && (
              <Button size="sm" onClick={() => handleOpenYearDialog()} className="bg-indigo-600 text-white text-xs">
                <Plus className="w-4 h-4 mr-1" /> New Academic Year
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredYears.map((yr) => (
              <div
                key={yr.id}
                className={`bg-white border rounded-2xl p-5 shadow-sm transition ${
                  yr.is_current ? "border-indigo-400 ring-1 ring-indigo-200" : "border-stone-200"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-heading font-bold text-stone-900 text-base">{yr.name}</h4>
                    <p className="text-xs text-stone-500 mt-0.5">
                      {yr.start_date || "N/A"} → {yr.end_date || "N/A"}
                    </p>
                  </div>
                  {yr.is_current ? (
                    <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">Current Year</Badge>
                  ) : (
                    <Badge variant="outline" className="text-stone-500">Historical / Future</Badge>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-stone-100 mt-3">
                  <Badge className={yr.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-600"}>
                    {yr.status || "active"}
                  </Badge>
                  {isManageAllowed && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={yr.is_current ? "outline" : "ghost"}
                        className="text-xs h-7 px-2"
                        onClick={() => handleToggleCurrentYear(yr)}
                      >
                        {yr.is_current ? "Unmark Current" : "Set as Current"}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-stone-500" onClick={() => handleOpenYearDialog(yr)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-stone-400 hover:text-red-600" onClick={() => handleDeleteYear(yr)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* TAB 2: CLASSES & SECTIONS */}
        <TabsContent value="classes" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <Input
                placeholder="Search classes..."
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-white"
              />
            </div>
            {isManageAllowed && (
              <Button size="sm" onClick={() => handleOpenClassDialog()} className="bg-indigo-600 text-white text-xs">
                <Plus className="w-4 h-4 mr-1" /> New Class
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClasses.map((c) => {
              const classSections = sections.filter((s) => s.school_class_id === c.id);
              const enrolledCount = students.filter((s) => s.school_class_id === c.id || s.class_name === c.name).length;
              return (
                <div key={c.id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-heading font-bold text-stone-900 text-base">{c.name}</h4>
                      <p className="text-xs text-stone-400">
                        {classSections.length} Section{classSections.length !== 1 ? "s" : ""} · {enrolledCount} Enrolled
                      </p>
                    </div>
                    {isManageAllowed && (
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-stone-500" onClick={() => handleOpenClassDialog(c)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-stone-400 hover:text-red-600" onClick={() => handleDeleteClass(c)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-stone-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Canonical Sections</span>
                      {isManageAllowed && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px] text-indigo-600 hover:bg-indigo-50 px-2"
                          onClick={() => handleOpenSectionDialog(c, null)}
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add Section
                        </Button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {classSections.map((sec) => (
                        <div
                          key={sec.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-stone-50 border border-stone-100 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-stone-800">Section {sec.name}</span>
                            <span className="text-stone-400 ml-2">
                              Room: {sec.room_number || "N/A"} · Cap: {sec.capacity || 40}
                            </span>
                          </div>
                          {isManageAllowed && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-stone-400 hover:text-indigo-600"
                                onClick={() => handleOpenSectionDialog(c, sec)}
                              >
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-stone-400 hover:text-red-600"
                                onClick={() => handleDeleteSection(sec)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                      {classSections.length === 0 && (
                        <p className="text-xs text-stone-400 italic py-1">No sections created yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* TAB 3: SUBJECTS */}
        <TabsContent value="subjects" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <Input
                placeholder="Search subjects by name, code, dept..."
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-white"
              />
            </div>
            {isManageAllowed && (
              <Button size="sm" onClick={() => handleOpenSubjectDialog()} className="bg-emerald-600 text-white text-xs">
                <Plus className="w-4 h-4 mr-1" /> New Subject
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSubjects.map((sub) => (
              <div key={sub.id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-heading font-bold text-stone-900 text-base">{sub.name}</h4>
                    <p className="text-xs text-stone-400">Code: {sub.code || "N/A"}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{sub.category || "Core"}</Badge>
                </div>

                <div className="flex items-center justify-between text-xs text-stone-600 pt-2 border-t border-stone-100">
                  <span>Dept: {sub.department || "Academic"}</span>
                  <span>Credits: {sub.credits || 1}</span>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Badge className={sub.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-600"}>
                    {sub.status || "active"}
                  </Badge>
                  {isManageAllowed && (
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-stone-500" onClick={() => handleOpenSubjectDialog(sub)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-stone-400 hover:text-red-600" onClick={() => handleDeleteSubject(sub)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Academic Year Dialog */}
      <Dialog open={yearDialogOpen} onOpenChange={setYearDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingYear ? "Edit Academic Year" : "Create Academic Year"}</DialogTitle>
          </DialogHeader>
          <form id="year-form" onSubmit={handleSaveYear} className="space-y-4">
            <div>
              <Label htmlFor="yr-name">Year Name * (e.g. 2025-2026)</Label>
              <Input
                id="yr-name"
                value={yearForm.name}
                onChange={(e) => setYearForm({ ...yearForm, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="yr-start">Start Date</Label>
                <Input
                  id="yr-start"
                  type="date"
                  value={yearForm.start_date}
                  onChange={(e) => setYearForm({ ...yearForm, start_date: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="yr-end">End Date</Label>
                <Input
                  id="yr-end"
                  type="date"
                  value={yearForm.end_date}
                  onChange={(e) => setYearForm({ ...yearForm, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="yr-current"
                checked={yearForm.is_current}
                onCheckedChange={(c) => setYearForm({ ...yearForm, is_current: Boolean(c) })}
              />
              <Label htmlFor="yr-current" className="text-sm font-medium">Mark as Current Academic Year</Label>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYearDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="year-form">Save Academic Year</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Class Dialog */}
      <Dialog open={classDialogOpen} onOpenChange={setClassDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingClass ? "Edit Class" : "Create Class"}</DialogTitle>
          </DialogHeader>
          <form id="class-form" onSubmit={handleSaveClass} className="space-y-4">
            <div>
              <Label htmlFor="cls-name">Class Name * (e.g. Class 10)</Label>
              <Input
                id="cls-name"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="cls-grade">Grade Level (optional)</Label>
              <Input
                id="cls-grade"
                placeholder="e.g. 10"
                value={classGradeLevel}
                onChange={(e) => setClassGradeLevel(e.target.value)}
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClassDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="class-form">Save Class</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Section Dialog */}
      <Dialog open={sectionDialogOpen} onOpenChange={setSectionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSection ? `Edit Section (${selectedClassForSection?.name})` : `Add Section to ${selectedClassForSection?.name}`}
            </DialogTitle>
          </DialogHeader>
          <form id="section-form" onSubmit={handleSaveSection} className="space-y-4">
            <div>
              <Label htmlFor="sec-name">Section Name * (e.g. A, B, Science)</Label>
              <Input
                id="sec-name"
                value={sectionForm.name}
                onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sec-room">Room Number</Label>
                <Input
                  id="sec-room"
                  placeholder="e.g. 204"
                  value={sectionForm.room_number}
                  onChange={(e) => setSectionForm({ ...sectionForm, room_number: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="sec-cap">Capacity</Label>
                <Input
                  id="sec-cap"
                  type="number"
                  min="1"
                  value={sectionForm.capacity}
                  onChange={(e) => setSectionForm({ ...sectionForm, capacity: Number(e.target.value) })}
                />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="section-form">Save Section</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subject Dialog */}
      <Dialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSubject ? "Edit Subject" : "Add Subject"}</DialogTitle>
          </DialogHeader>
          <form id="subject-form" onSubmit={handleSaveSubject} className="space-y-4">
            <div>
              <Label htmlFor="sub-name">Subject Name *</Label>
              <Input
                id="sub-name"
                value={subjectForm.name}
                onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sub-code">Subject Code</Label>
                <Input
                  id="sub-code"
                  placeholder="e.g. MATH-10"
                  value={subjectForm.code}
                  onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="sub-dept">Department</Label>
                <Input
                  id="sub-dept"
                  placeholder="e.g. Sciences"
                  value={subjectForm.department}
                  onChange={(e) => setSubjectForm({ ...subjectForm, department: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sub-cat">Category</Label>
                <Select
                  value={subjectForm.category}
                  onValueChange={(val) => setSubjectForm({ ...subjectForm, category: val })}
                >
                  <SelectTrigger id="sub-cat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Core">Core</SelectItem>
                    <SelectItem value="Elective">Elective</SelectItem>
                    <SelectItem value="Language">Language</SelectItem>
                    <SelectItem value="Vocational">Vocational</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sub-credits">Credits</Label>
                <Input
                  id="sub-credits"
                  type="number"
                  min="0"
                  value={subjectForm.credits}
                  onChange={(e) => setSubjectForm({ ...subjectForm, credits: Number(e.target.value) })}
                />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubjectDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="subject-form">Save Subject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Academic Setup Wizard (1000+ Students) */}
      <AcademicWizardModal
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => load()}
        user={user}
      />

      {/* Branded delete confirmation */}
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