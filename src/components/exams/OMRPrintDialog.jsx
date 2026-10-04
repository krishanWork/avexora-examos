import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { generateBulkOMRSheetsPDF } from "@/lib/generateOMRSheetPDF";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { studentMatchesClasses } from "@/lib/classMatch";
import { Loader2, Printer } from "lucide-react";

export default function OMRPrintDialog({ open, onOpenChange, examination, tenant }) {
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [paperSet, setPaperSet] = useState("A");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [rosterError, setRosterError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPaperSet(examination.paper_sets?.[0] || "A");
    setLoading(true);
    setRosterError("");
    const load = async () => {
      const isScoped = (examination.school_class_ids || []).length > 0;
      if (isScoped) {
        // Authoritative, exam-scoped roster — same source as upload/identity/results.
        // A failure here (403/404/network) must be reported as such; swallowing it
        // made a permission error look like an empty roster.
        const [rosterOutcome, classDocs, sectionDocs] = await Promise.all([
          appClient.functions
            .invoke("getExamRoster", { examination_id: examination.id })
            .then((res) => ({ res }))
            .catch((err) => ({ err })),
          appClient.entities.SchoolClass.filter({ tenant_id: examination.tenant_id }, "name").catch(() => []),
          appClient.entities.Section.filter({ tenant_id: examination.tenant_id }).catch(() => []),
        ]);
        if (rosterOutcome.err) {
          setRosterError(rosterOutcome.err?.message || "Could not load the exam roster.");
          setStudents([]);
          setSelected(new Set());
          setLoading(false);
          return;
        }
        const classNameById = new Map(classDocs.map((c) => [String(c.id), c.name]));
        const sectionNameById = new Map(sectionDocs.map((s) => [String(s.id), s.name]));
        const list = (rosterOutcome.res.data?.students || []).map((s) => ({
          ...s,
          id: s.student_id,
          class_name: classNameById.get(String(s.school_class_id || "")) || "",
          section: sectionNameById.get(String(s.section_id || "")) || "",
        }));
        list.sort((a, b) => String(a.roll_number || "").localeCompare(String(b.roll_number || ""), undefined, { numeric: true }));
        setStudents(list);
        setSelected(new Set(list.map((s) => s.id)));
        setLoading(false);
        return;
      }
      // Legacy exams with no class/section ids: fall back to name-based filtering.
      const all = await appClient.entities.Student.filter({ tenant_id: examination.tenant_id, status: "active" });
      const classes = examination.class_names?.length ? examination.class_names : (examination.class_name ? [examination.class_name] : []);
      let list = all.filter((s) => studentMatchesClasses(s, classes));
      if (examination.batch) list = list.filter((s) => !s.batch || s.batch === examination.batch);
      if (examination.subjects?.length) {
        list = list.filter((s) => !s.subjects?.length || s.subjects.some((sub) => examination.subjects.includes(sub)));
      }
      list.sort((a, b) => String(a.roll_number || "").localeCompare(String(b.roll_number || ""), undefined, { numeric: true }));
      setStudents(list);
      setSelected(new Set(list.map((s) => s.id)));
      setLoading(false);
    };
    load();
  }, [open, examination.id]);

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const allSelected = students.length > 0 && selected.size === students.length;

  const handleGenerate = async () => {
    setGenerating(true);
    const chosen = students.filter((s) => selected.has(s.id));
    const url = await generateBulkOMRSheetsPDF({ examination, tenant, paperSet, students: chosen });
    setGenerating(false);
    window.open(url, "_blank");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Print OMR Sheets</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-stone-500">Each student gets their own sheet with name and roll number pre-printed. Untick students who are absent or on leave.</p>

        {examination.paper_sets?.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-stone-600">Paper Set:</span>
            <Select value={paperSet} onValueChange={setPaperSet}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {examination.paper_sets.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-stone-400 py-6 text-center">Loading students...</p>
        ) : rosterError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <p className="font-medium">Could not load the exam roster</p>
            <p className="text-rose-700 mt-0.5">{rosterError}</p>
          </div>
        ) : students.length === 0 ? (
          <p className="text-sm text-stone-400 py-6 text-center">No students on the exam roster for its class/section selection.</p>
        ) : (
          <>
            <label className="flex items-center gap-2 border-b border-stone-100 pb-2 text-sm font-medium text-stone-700 cursor-pointer">
              <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(students.map((s) => s.id)) : new Set())} />
              Select all ({selected.size}/{students.length})
            </label>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {students.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-stone-50 cursor-pointer">
                  <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                  <span className="font-medium text-stone-800">{s.full_name}</span>
                  <span className="text-xs text-stone-400 ml-auto">Roll {s.roll_number || "-"} · {s.class_name} {s.section}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={selected.size === 0 || generating}>
            {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
            Generate {selected.size} Sheet{selected.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}