import React, { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import MultiSelectChips from "@/components/shared/MultiSelectChips";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { STREAM_DEFINITIONS } from "@/data/curriculumPresets";

const EMAIL_RE = /\S+@\S+\.\S+/;

const STAGE_LABELS = {
  pre_primary: "Pre-Primary",
  primary: "Primary",
  middle: "Middle",
  secondary: "Secondary",
  senior_secondary: "Senior Secondary",
};

const STAGE_BADGES = {
  pre_primary: "bg-emerald-50 text-emerald-700 border-emerald-200",
  primary: "bg-emerald-50 text-emerald-700 border-emerald-200",
  middle: "bg-amber-50 text-amber-700 border-amber-200",
  secondary: "bg-indigo-50 text-indigo-700 border-indigo-200",
  senior_secondary: "bg-purple-50 text-purple-700 border-purple-200",
};

const streamBadgeClass = (stream) => {
  const def = STREAM_DEFINITIONS.find((d) => d.id === stream);
  return def?.badge || "bg-stone-100 text-stone-600 border-stone-200";
};

const EMPTY_FORM = {
  full_name: "", admission_number: "", roll_number: "", class_name: "", section: "",
  batch: "", subjects: [],
  gender: "male", dob: "", student_email: "", student_phone: "",
  parent_name: "", parent_email: "", parent_phone: "",
  blood_group: "", category: "", status: "active",
  emergency_contact: "", address: "",
  school_class_id: "", section_id: "",
};

export default function StudentFormDialog({ open, onOpenChange, student, onSave, tenantId }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [currentYear, setCurrentYear] = useState(null);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    const base = student
      ? { ...EMPTY_FORM, ...student, school_class_id: student.school_class_id || "", section_id: student.section_id || "" }
      : { ...EMPTY_FORM };
    setForm(base);
    setEmailError("");
  }, [student, open]);

  useEffect(() => {
    if (!open || !tenantId) return;
    let cancelled = false;
    Promise.all([
      appClient.entities.SchoolClass.filter({ tenant_id: tenantId }, "order").catch(() => []),
      appClient.entities.Section.filter({ tenant_id: tenantId }).catch(() => []),
      appClient.entities.Subject.filter({ tenant_id: tenantId }).catch(() => []),
      appClient.entities.AcademicYear.filter({ tenant_id: tenantId, is_current: true }).catch(() => []),
    ]).then(([cls, sec, subs, years]) => {
      if (cancelled) return;
      setClasses(cls);
      setSections(sec);
      setSubjects(subs);
      setCurrentYear(years[0] || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, tenantId]);

  // Backfill school_class_id/section_id for records created before the
  // canonical-id fields existed, so edits still resolve cleanly.
  useEffect(() => {
    if (!form.class_name || form.school_class_id) return;
    const cls = classes.find((c) => c.name === form.class_name);
    if (cls) setForm((f) => ({ ...f, school_class_id: cls.id }));
  }, [form.class_name, form.school_class_id, classes]);

  useEffect(() => {
    if (!form.class_name || !form.section) return;
    if (form.section_id) return;
    const cls = classes.find((c) => c.name === form.class_name);
    if (!cls) return;
    const sec = sections.find((s) => s.school_class_id === cls.id && s.name === form.section);
    if (sec) setForm((f) => ({ ...f, section_id: sec.id }));
  }, [form.class_name, form.section, form.section_id, classes, sections]);

  // Create-mode: pre-fill the next admission number (tenant-wide, non-mutating).
  useEffect(() => {
    if (!open || student || !tenantId) return;
    let cancelled = false;
    appClient.functions.invoke("getNextStudentNumbers", {})
      .then((res) => {
        if (cancelled || !res?.data?.admission_number) return;
        setForm((f) => (f.admission_number ? f : { ...f, admission_number: res.data.admission_number }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, student, tenantId]);

  // Create-mode: pre-fill the next roll number for the chosen class+section scope.
  useEffect(() => {
    if (!open || student || !tenantId || !form.class_name) return;
    let cancelled = false;
    const payload = {
      class_name: form.class_name,
      section: form.section || "",
      ...(form.school_class_id ? { school_class_id: form.school_class_id } : {}),
      ...(form.section_id ? { section_id: form.section_id } : {}),
      ...(currentYear?.id ? { academic_year_id: currentYear.id } : {}),
    };
    appClient.functions.invoke("getNextStudentNumbers", payload)
      .then((res) => {
        if (cancelled || !res?.data) return;
        const nextRoll = res.data.roll_number;
        setForm((f) => ({ ...f, roll_number: nextRoll == null ? "" : String(nextRoll) }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, student, tenantId, form.class_name, form.section, form.school_class_id, form.section_id, currentYear]);

  const classOptions = useMemo(() => {
    const known = classes.map((c) => ({ name: c.name, stage: c.stage || "general", synthetic: false }));
    if (form.class_name && !known.some((c) => c.name === form.class_name)) {
      known.push({ name: form.class_name, stage: "general", synthetic: true });
    }
    return known;
  }, [classes, form.class_name]);

  const canonicalSections = useMemo(() => {
    const cls = classes.find((c) => c.name === form.class_name);
    if (!cls) return [];
    return sections.filter((s) => s.school_class_id === cls.id).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [sections, classes, form.class_name]);

  const sectionOptions = useMemo(() => {
    const known = canonicalSections.map((s) => ({
      id: s.id,
      name: s.name,
      stream: s.stream || null,
      synthetic: false,
    }));
    if (form.section && !known.some((s) => s.name === form.section)) {
      known.push({ id: form.section_id || "", name: form.section, stream: null, synthetic: true });
    }
    return known;
  }, [canonicalSections, form.section, form.section_id]);

  const selectedStage = useMemo(() => {
    const cls = classes.find((c) => c.name === form.class_name);
    return cls?.stage || "general";
  }, [classes, form.class_name]);

  const selectedStream = useMemo(() => {
    const sec = sectionOptions.find((s) => s.name === form.section);
    return sec?.stream || null;
  }, [sectionOptions, form.section]);

  const subjectOptions = useMemo(() => {
    return subjects
      .filter((sub) => {
        const stages = Array.isArray(sub.applicable_stages) && sub.applicable_stages.length
          ? sub.applicable_stages
          : Array.isArray(sub.stages) && sub.stages.length
            ? sub.stages
            : sub.stage
              ? [sub.stage]
              : null;
        if (stages && selectedStage !== "general" && !stages.includes(selectedStage)) {
          return false;
        }
        if (selectedStream) {
          const streams = Array.isArray(sub.streams) && sub.streams.length ? sub.streams : sub.stream ? [sub.stream] : [];
          if (streams.length && !streams.includes(selectedStream)) return false;
          if (!streams.length) return false;
        }
        return true;
      })
      .map((s) => s.name);
  }, [subjects, selectedStage, selectedStream]);

  // Create-mode: auto-select the subjects that apply to class stage + section stream.
  useEffect(() => {
    if (student || !form.class_name) return;
    if (!subjectOptions.length) return;
    setForm((f) => ({ ...f, subjects: subjectOptions }));
  }, [subjectOptions]);

  const handleSelectClass = (name) => {
    const cls = classes.find((c) => c.name === name);
    setForm((f) => ({
      ...f,
      class_name: name,
      school_class_id: cls ? cls.id : "",
      section: "",
      section_id: null,
    }));
  };

  const handleSelectSection = (name) => {
    if (name === "__unassigned") {
      setForm((f) => ({ ...f, section: "", section_id: null }));
      return;
    }
    const sec = sectionOptions.find((s) => s.name === name);
    setForm((f) => ({
      ...f,
      section: name,
      section_id: sec && !sec.synthetic ? sec.id : f.section_id,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.student_email && !EMAIL_RE.test(form.student_email)) {
      setEmailError("student_email");
      return;
    }
    if (form.parent_email && !EMAIL_RE.test(form.parent_email)) {
      setEmailError("parent_email");
      return;
    }
    setEmailError("");

    const knownSubjectNames = subjects.map((s) => s.name);
    const newSubjects = (form.subjects || []).filter((s) => !knownSubjectNames.includes(s));
    if (newSubjects.length && tenantId) {
      await appClient.entities.Subject.bulkCreate(newSubjects.map((name) => ({ tenant_id: tenantId, name })));
    }

    const payload = {
      ...form,
      ...(currentYear && currentYear.id ? { academic_year_id: currentYear.id } : {}),
    };
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{student ? "Edit Student" : "Add Student"}</DialogTitle>
        </DialogHeader>
        <form id="p6-student-form" onSubmit={handleSubmit} className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <Label htmlFor="p6-full-name">Full Name</Label>
            <Input id="p6-full-name" value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-admission-number">Admission Number</Label>
              <Input id="p6-admission-number" value={form.admission_number || ""} onChange={(e) => setForm({ ...form, admission_number: e.target.value })} />
              {!student && <p className="text-xs text-stone-400 mt-0.5">Auto-generated — edit only to override.</p>}
            </div>
            <div>
              <Label htmlFor="p6-roll-number">Roll Number</Label>
              <Input id="p6-roll-number" value={form.roll_number || ""} onChange={(e) => setForm({ ...form, roll_number: e.target.value })} />
              {!student && <p className="text-xs text-stone-400 mt-0.5">Next in section — edit only to override.</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-class-name">Class</Label>
              <Select value={form.class_name || ""} onValueChange={handleSelectClass}>
                <SelectTrigger id="p6-class-name"><SelectValue placeholder="Select class..." /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {classOptions.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      <span className="flex items-center gap-2">
                        <span>{c.name}</span>
                        {c.stage !== "general" && (
                          <Badge variant="outline" className={`text-[9px] capitalize ${STAGE_BADGES[c.stage] || ""}`}>
                            {STAGE_LABELS[c.stage] || c.stage}
                          </Badge>
                        )}
                        {c.synthetic && <Badge variant="outline" className="text-[9px] text-amber-700 bg-amber-50 border-amber-200">Not in structure</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!student && classes.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No classes configured yet. Set up academic structure first.</p>
              )}
            </div>
            <div>
              <Label htmlFor="p6-section">Section</Label>
              <Select value={form.section || ""} onValueChange={handleSelectSection} disabled={!form.class_name}>
                <SelectTrigger id="p6-section"><SelectValue placeholder={form.class_name ? "Select section..." : "Choose class first"} /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="__unassigned">No section</SelectItem>
                  {sectionOptions.map((s) => (
                    <SelectItem key={`${s.name}-${s.id || "x"}`} value={s.name}>
                      <span className="flex items-center gap-2">
                        <span>{s.name}</span>
                        {s.stream && (
                          <Badge variant="outline" className={`text-[9px] ${streamBadgeClass(s.stream)}`}>{s.stream}</Badge>
                        )}
                        {s.synthetic && <Badge variant="outline" className="text-[9px] text-amber-700 bg-amber-50 border-amber-200">Not in structure</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="p6-batch">Batch (optional)</Label>
            <Input id="p6-batch" value={form.batch || ""} onChange={(e) => setForm({ ...form, batch: e.target.value })} placeholder="e.g. Morning, 2026-A" />
          </div>
          <div>
            <Label>Subjects</Label>
            <p className="text-xs text-stone-400 mb-1.5">
              {selectedStream
                ? `Showing ${form.class_name || "this class"} subjects for ${selectedStream} stream.`
                : selectedStage !== "general"
                  ? `Showing ${form.class_name} subjects (${STAGE_LABELS[selectedStage] || selectedStage}).`
                  : "Select a class to filter subjects."}
            </p>
            <MultiSelectChips options={subjectOptions} values={form.subjects || []} onChange={(v) => setForm({ ...form, subjects: v })} placeholder="Add a subject..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-gender">Gender</Label>
              <Select value={form.gender || "male"} onValueChange={(v) => setForm({ ...form, gender: v })}>
                <SelectTrigger id="p6-gender"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p6-dob">Date of Birth</Label>
              <Input id="p6-dob" type="date" value={form.dob || ""} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-student-email">Student Email</Label>
              <Input id="p6-student-email" type="email" value={form.student_email || ""} onChange={(e) => { setForm({ ...form, student_email: e.target.value }); if (emailError === "student_email") setEmailError(""); }} />
              <p className="text-xs text-stone-400 mt-0.5">A portal login is auto-generated for this email.</p>
              {emailError === "student_email" && <p className="text-xs text-destructive mt-1">Enter a valid email address</p>}
            </div>
            <div>
              <Label htmlFor="p6-student-phone">Student Mobile</Label>
              <Input id="p6-student-phone" value={form.student_phone || ""} onChange={(e) => setForm({ ...form, student_phone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-parent-name">Parent Name</Label>
              <Input id="p6-parent-name" value={form.parent_name || ""} onChange={(e) => setForm({ ...form, parent_name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="p6-parent-phone">Parent Phone</Label>
              <Input id="p6-parent-phone" value={form.parent_phone || ""} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="p6-parent-email">Parent Email</Label>
            <Input id="p6-parent-email" type="email" value={form.parent_email || ""} onChange={(e) => { setForm({ ...form, parent_email: e.target.value }); if (emailError === "parent_email") setEmailError(""); }} />
            <p className="text-xs text-stone-400 mt-0.5">A parent portal login is auto-generated for this email.</p>
            {emailError === "parent_email" && <p className="text-xs text-destructive mt-1">Enter a valid email address</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-emergency-contact">Emergency Contact</Label>
              <Input
                id="p6-emergency-contact"
                placeholder="Phone or contact person"
                value={form.emergency_contact || ""}
                onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="p6-address">Address</Label>
              <Input
                id="p6-address"
                placeholder="Residential address"
                value={form.address || ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="p6-student-form" disabled={!form.full_name}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}