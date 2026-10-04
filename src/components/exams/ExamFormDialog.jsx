import React, { useState, useEffect, useCallback } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import MultiSelectChips from "@/components/shared/MultiSelectChips";
import { X, Users, Loader2, Check, ChevronLeft, ChevronRight, CalendarDays, ListChecks, FileText, Rocket } from "lucide-react";

const EXAM_TYPES = ["weekly_test", "monthly_test", "unit_test", "mid_term", "half_yearly", "annual", "entrance", "mock_test"];

const STEPS = [
  { id: "basic", label: "Basic Details", icon: FileText },
  { id: "who", label: "Who Takes It", icon: Users },
  { id: "setup", label: "Exam Setup", icon: ListChecks },
  { id: "review", label: "Review & Create", icon: Rocket },
];

function ChipGroup({ options = [], values = [], onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() =>
              onChange(active ? values.filter((v) => v !== o.value) : [...values, o.value])
            }
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-stone-600 border-stone-200 hover:border-indigo-400"}`}
          >
            {o.label}
            {active && <X className="w-3 h-3 inline ml-1" />}
          </button>
        );
      })}
      {options.length === 0 && <span className="text-xs text-stone-400 text-left">None available for the selected year / classes.</span>}
    </div>
  );
}

function StepIndicator({ step, isEdit }) {
  return (
    <ol className="flex items-center gap-1 sm:gap-2 my-1">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < step;
        const active = i === step;
        return (
          <li key={s.id} className="flex items-center gap-1 sm:gap-2 flex-1 last:flex-initial">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  done ? "bg-emerald-500 text-white" : active ? "bg-indigo-600 text-white shadow-sm" : "bg-stone-100 text-stone-400"
                }`}
              >
                {done ? <Check className="w-4 h-4" /> : active ? <Icon className="w-3.5 h-3.5" /> : <span className="text-xs font-semibold">{i + 1}</span>}
              </span>
              <span className={`hidden sm:block text-xs font-medium truncate ${active ? "text-stone-900" : done ? "text-emerald-600" : "text-stone-400"}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px min-w-4 ${done ? "bg-emerald-300" : "bg-stone-200"}`} />
            )}
          </li>
        );
      })}
      {isEdit && <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 shrink-0">Editing</span>}
    </ol>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-stone-100 last:border-0">
      <span className="text-xs text-stone-500 shrink-0">{label}</span>
      <span className="text-xs font-medium text-stone-900 text-right">{value || "—"}</span>
    </div>
  );
}

export default function ExamFormDialog({ open, onOpenChange, onSave, exam, tenantId }) {
  const [form, setForm] = useState({});
  const [step, setStep] = useState(0);
  const [academicYears, setAcademicYears] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [preview, setPreview] = useState({ count: null, stats: null, loading: false });

  useEffect(() => {
    setStep(0);
    if (exam) {
      setForm({
        ...exam,
        subjects: exam.subjects?.length ? exam.subjects : (exam.subject ? exam.subject.split(",").map((s) => s.trim()).filter(Boolean) : []),
        class_names: exam.class_names?.length ? exam.class_names : (exam.class_name ? exam.class_name.split(",").map((s) => s.trim()).filter(Boolean) : []),
        academic_year_id: exam.academic_year_id ? String(exam.academic_year_id) : "",
        school_class_ids: Array.isArray(exam.school_class_ids) ? exam.school_class_ids.flat(Infinity).map(String).filter(Boolean) : [],
        section_ids: Array.isArray(exam.section_ids) ? exam.section_ids.flat(Infinity).map(String).filter(Boolean) : [],
        paper_sets: (exam.paper_sets || ["A"]).join(", "),
      });
    } else {
      setForm({
        name: "", exam_type: "unit_test", subjects: [], academic_year_id: "",
        school_class_ids: [], section_ids: [], batch: "", exam_date: "",
        duration_minutes: 60, max_marks: 100, passing_marks: 35, num_questions: 50,
        options_per_question: 4, negative_marking: false, negative_mark_value: 0, paper_sets: "A",
      });
    }
    setPreview({ count: null, stats: null, loading: false });
  }, [exam, open]);

  useEffect(() => {
    if (!open || !tenantId) return;
    const loadOptions = async () => {
      const [years, classDocs, sectionDocs, subjects] = await Promise.all([
        appClient.entities.AcademicYear.filter({ tenant_id: tenantId }, "-name").catch(() => []),
        appClient.entities.SchoolClass.filter({ tenant_id: tenantId }, "name").catch(() => []),
        appClient.entities.Section.filter({ tenant_id: tenantId }).catch(() => []),
        appClient.entities.Subject.filter({ tenant_id: tenantId }).catch(() => []),
      ]);
      setAcademicYears(years);
      setClasses(classDocs);
      setSections(sectionDocs);
      setSubjectOptions(subjects.map((s) => s.name));

      setForm((prev) => {
        const currentYear = years.find((y) => y.is_current) || years[0];
        const yearId = prev.academic_year_id || (currentYear ? String(currentYear.id) : "");
        let classIds = prev.school_class_ids || [];
        let sectionIds = prev.section_ids || [];

        // Legacy exams stored only class_names/section names: match them to ids once.
        if ((!classIds.length || !sectionIds.length) && (prev.class_names?.length || prev.class_names)) {
          const legacyClasses = prev.class_names || (exam?.class_name ? exam.class_name.split(",").map((s) => s.trim()).filter(Boolean) : []);
          if (legacyClasses.length && !classIds.length) {
            classIds = classDocs.filter((c) => legacyClasses.includes(c.name)).map((c) => String(c.id));
          }
          if (!sectionIds.length && classIds.length) {
            sectionIds = sectionDocs
              .filter((sec) => classIds.includes(String(sec.school_class_id)))
              .map((sec) => String(sec.id));
          }
        }
        const classNames = classIds.length
          ? classDocs.filter((c) => classIds.includes(String(c.id))).map((c) => c.name)
          : (prev.class_names || []).length
            ? prev.class_names
            : prev.class_name
              ? prev.class_name.split(",").map((s) => s.trim()).filter(Boolean)
              : [];
        return { ...prev, academic_year_id: yearId, school_class_ids: classIds, section_ids: sectionIds, class_names: classNames };
      });
    };
    loadOptions();
  }, [open, tenantId]);

  const groupedSections = classes
    .filter((c) => (form.school_class_ids || []).includes(String(c.id)))
    .map((c) => ({
      cls: c,
      options: sections
        .filter((s) => String(s.school_class_id) === String(c.id))
        .map((s) => ({ value: String(s.id), label: s.name })),
    }));
  const classOptions = classes.map((c) => ({ value: String(c.id), label: c.name }));

  const toggleClass = (nextIds) => {
    const next = nextIds.map(String);
    const allowed = sections.filter((s) => next.includes(String(s.school_class_id))).map((s) => String(s.id));
    const sectionIds = (form.section_ids || []).filter((sid) => allowed.includes(String(sid)));
    const classNames = classes.filter((c) => next.includes(String(c.id))).map((c) => c.name);
    setForm({ ...form, school_class_ids: next, section_ids: sectionIds, class_names: classNames });
  };

  const toggleSection = (nextIds) => {
    const next = nextIds.map(String);
    setForm({ ...form, section_ids: next });
  };

  const fetchPreview = useCallback(async (scope) => {
    if (!scope.academic_year_id || !scope.school_class_ids?.length) {
      setPreview({ count: null, stats: null, loading: false });
      return;
    }
    setPreview({ count: null, stats: null, loading: true });
    try {
      const { data } = await appClient.functions.invoke("previewExamRoster", scope).catch(() => ({ data: {} }));
      setPreview({ count: data?.count ?? null, stats: data?.stats ?? null, loading: false });
    } catch {
      setPreview({ count: null, stats: null, loading: false });
    }
  }, []);

  useEffect(() => {
    if (!open || !tenantId) return;
    const scope = {
      academic_year_id: form.academic_year_id || undefined,
      school_class_ids: form.school_class_ids || [],
      section_ids: form.section_ids || [],
    };
    const t = setTimeout(() => fetchPreview(scope), 250);
    return () => clearTimeout(t);
  }, [open, tenantId, form.academic_year_id, form.school_class_ids, form.section_ids, fetchPreview]);

  const canNextStep = () => {
    if (step === 0) return Boolean(form.name);
    if (step === 1) return Boolean(form.academic_year_id && (form.school_class_ids || []).length);
    if (step === 2) return Boolean((form.subjects || []).length) && (!(form.passing_marks > 0) || form.passing_marks <= form.max_marks);
    return true;
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (!canNextStep()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleBack = (e) => {
    e.preventDefault();
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const newSubjects = (form.subjects || []).filter((s) => !subjectOptions.includes(s));
    if (newSubjects.length && tenantId) {
      await appClient.entities.Subject.bulkCreate(newSubjects.map((name) => ({ tenant_id: tenantId, name })));
    }
    const { id: _id, created_date: _cd, updated_date: _ud, created_by_id: _cb, ...rest } = form;
    const numQ = Number(form.num_questions) || 50;
    const maxM = Number(form.max_marks) || 100;
    const mpq = +(maxM / numQ).toFixed(4);
    onSave({
      ...rest,
      num_questions: numQ,
      max_marks: maxM,
      marks_per_question: mpq,
      subject: (form.subjects || []).join(", "),
      class_name: classes.filter((c) => (form.school_class_ids || []).includes(String(c.id))).map((c) => c.name).join(", ") || (form.class_names || []).join(", "),
      academic_year_id: form.academic_year_id || undefined,
      school_class_ids: (form.school_class_ids || []).flat(Infinity).map(String).filter(Boolean),
      section_ids: (form.section_ids || []).flat(Infinity).map(String).filter(Boolean),
      paper_sets: String(form.paper_sets || "A").split(",").map((p) => p.trim()).filter(Boolean),
    });
  };

  const yearLabel = academicYears.find((y) => String(y.id) === form.academic_year_id)?.name || "—";
  const classLabel = classes.filter((c) => (form.school_class_ids || []).includes(String(c.id))).map((c) => c.name).join(", ") || "—";
  const sectionLabel = groupedSections
    .map(({ cls, options }) => {
      const sel = options.filter((o) => (form.section_ids || []).includes(o.value)).map((o) => o.label);
      return sel.length ? `${cls.name}: ${sel.join(", ")}` : `${cls.name}: All sections`;
    })
    .join("; ") || "All sections";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{exam ? "Edit Examination" : "Create Examination"}</DialogTitle>
          <StepIndicator step={step} isEdit={Boolean(exam)} />
        </DialogHeader>
        <form id="p6-exam-form" onSubmit={handleSubmit} className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">

          {step === 0 && (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
                <CalendarDays className="w-4 h-4" /> Basic Details
              </div>
              <div>
                <Label htmlFor="p6-exam-name">Exam Name</Label>
                <Input id="p6-exam-name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mid-Term Mathematics 2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="p6-exam-type">Type</Label>
                  <Select value={form.exam_type || "unit_test"} onValueChange={(v) => setForm({ ...form, exam_type: v })}>
                    <SelectTrigger id="p6-exam-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXAM_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="p6-exam-date">Exam Date</Label>
                  <Input id="p6-exam-date" type="date" value={form.exam_date || ""} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="p6-exam-batch">Batch (optional)</Label>
                <Input id="p6-exam-batch" value={form.batch || ""} onChange={(e) => setForm({ ...form, batch: e.target.value })} placeholder="e.g. Morning, 2026-A" />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
                <Users className="w-4 h-4" /> Who Takes the Exam
              </div>
              <div>
                <Label htmlFor="p6-exam-year">Academic Year</Label>
                <Select value={form.academic_year_id || ""} onValueChange={(v) => setForm({ ...form, academic_year_id: v })}>
                  <SelectTrigger id="p6-exam-year"><SelectValue placeholder="Select academic year" /></SelectTrigger>
                  <SelectContent>
                    {academicYears.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.name}{y.is_current ? " (current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Classes (select one or more)</Label>
                <ChipGroup options={classOptions} values={form.school_class_ids || []} onChange={toggleClass} />
              </div>
              <div className="space-y-3">
                <Label>Sections (select for each class)</Label>
                {groupedSections.length === 0 ? (
                  <p className="text-xs text-stone-400 text-left">Select at least one class to see its sections.</p>
                ) : (
                  groupedSections.map(({ cls, options }) => (
                    <div key={cls.id} className="rounded-lg border border-stone-200 p-3">
                      <p className="text-xs font-semibold text-stone-700 mb-1.5">{cls.name}</p>
                      <ChipGroup options={options} values={form.section_ids || []} onChange={toggleSection} />
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-600">
                <Users className="w-4 h-4 text-indigo-500" />
                {preview.loading ? (
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Counting students…</span>
                ) : preview.count === null ? (
                  <span>Select an academic year and at least one class to preview the roster.</span>
                ) : preview.count === 0 ? (
                  <span className="text-amber-700">
                    No students on the exam roster for this selection.
                    {(preview.stats?.unlinked || 0) > 0 ? (
                      <> {preview.stats.unlinked} student{preview.stats.unlinked === 1 ? "" : "s"} in these classes have no class linked — re-save them in Students or run the backfill script.</>
                    ) : (
                      <> No active students or enrollments are rostered for this class/section in the selected academic year.</>
                    )}
                  </span>
                ) : (
                  <span>
                    <b className="text-stone-900">{preview.count}</b> student{preview.count === 1 ? "" : "s"} on the exam roster
                    {(form.section_ids || []).length ? ` across ${form.section_ids.length} section${form.section_ids.length === 1 ? "" : "s"}` : ""}
                  </span>
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
                <ListChecks className="w-4 h-4" /> Exam Setup
              </div>
              <div>
                <Label>Subjects (select one or more)</Label>
                <MultiSelectChips options={subjectOptions} values={form.subjects || []} onChange={(v) => setForm({ ...form, subjects: v })} placeholder="Add a subject..." />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="p6-exam-duration">Duration (min)</Label>
                  <Input id="p6-exam-duration" type="number" min="1" value={form.duration_minutes ?? 60} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="p6-exam-max-marks">Max Marks</Label>
                  <Input id="p6-exam-max-marks" type="number" min="1" value={form.max_marks ?? 100} onChange={(e) => setForm({ ...form, max_marks: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="p6-exam-passing-marks">Passing Marks</Label>
                  <Input id="p6-exam-passing-marks" type="number" min="0" value={form.passing_marks ?? 35} onChange={(e) => setForm({ ...form, passing_marks: Number(e.target.value) })} />
                  {form.passing_marks > 0 && form.passing_marks > form.max_marks && (
                    <p className="text-xs text-destructive mt-1">Cannot exceed max marks</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="p6-exam-num-questions">Number of Questions</Label>
                  <Input id="p6-exam-num-questions" type="number" min="1" value={form.num_questions ?? 50} onChange={(e) => setForm({ ...form, num_questions: Number(e.target.value) })} />
                  <p className="text-xs text-muted-foreground mt-1">
                    Mark per question: {form.max_marks && form.num_questions ? +(Number(form.max_marks) / Number(form.num_questions)).toFixed(2) : 2} marks
                  </p>
                </div>
                <div>
                  <Label htmlFor="p6-exam-options">Options per Question</Label>
                  <Input id="p6-exam-options" type="number" min="2" value={form.options_per_question ?? 4} onChange={(e) => setForm({ ...form, options_per_question: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label htmlFor="p6-exam-paper-sets">Paper Sets (comma separated)</Label>
                <Input id="p6-exam-paper-sets" value={form.paper_sets || "A"} onChange={(e) => setForm({ ...form, paper_sets: e.target.value })} />
              </div>
              <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Negative Marking</p>
                  <p className="text-xs text-stone-400">Deduct marks for incorrect answers</p>
                </div>
                <Switch checked={!!form.negative_marking} onCheckedChange={(v) => setForm({ ...form, negative_marking: v })} />
              </div>
              {form.negative_marking ? (
                <div>
                  <Label htmlFor="p6-exam-negative-value">Negative Mark per Wrong Answer</Label>
                  <Input id="p6-exam-negative-value" type="number" step="0.25" min="0" value={form.negative_mark_value ?? 0} onChange={(e) => setForm({ ...form, negative_mark_value: Number(e.target.value) })} />
                </div>
              ) : null}
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
                <Rocket className="w-4 h-4" /> Review
              </div>
              <div className="rounded-xl border border-stone-200 divide-y divide-stone-100 px-4 py-2 bg-white">
                <SummaryRow label="Exam Name" value={form.name} />
                <SummaryRow label="Type" value={form.exam_type?.replace(/_/g, " ")} />
                <SummaryRow label="Date" value={form.exam_date ? String(form.exam_date) : "Not set"} />
                <SummaryRow label="Batch" value={form.batch} />
                <SummaryRow label="Academic Year" value={yearLabel} />
                <SummaryRow label="Classes" value={classLabel} />
                <SummaryRow label="Sections" value={sectionLabel} />
                <SummaryRow label="Roster" value={preview.count === null ? "—" : preview.count === 0 ? (preview.stats?.unlinked > 0 ? `0 students — ${preview.stats.unlinked} unlinked` : "0 students — no match") : `${preview.count} student${preview.count === 1 ? "" : "s"}`} />
                <SummaryRow label="Subjects" value={(form.subjects || []).join(", ")} />
                <SummaryRow label="Duration" value={form.duration_minutes ? `${form.duration_minutes} min` : "—"} />
                <SummaryRow label="Max / Passing Marks" value={`${form.max_marks} / ${form.passing_marks}`} />
                <SummaryRow label="Questions × Options" value={`${form.num_questions} Q × ${form.options_per_question} options`} />
                <SummaryRow label="Mark per Question" value={form.max_marks && form.num_questions ? `+${+(Number(form.max_marks) / Number(form.num_questions)).toFixed(2)}` : "—"} />
                <SummaryRow label="Paper Sets" value={form.paper_sets} />
                <SummaryRow label="Negative Marking" value={form.negative_marking ? `-${form.negative_mark_value ?? 0} per wrong answer` : "Disabled"} />
              </div>
            </>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {step > 0 && (
            <Button variant="ghost" onClick={handleBack}>
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={!canNextStep()}>
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button type="submit" form="p6-exam-form">{exam ? "Save Changes" : "Create Exam"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}