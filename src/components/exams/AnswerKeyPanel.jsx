import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Lock, Save, AlertTriangle, CheckCircle2, Trash2, Sparkles } from "lucide-react";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

// Must mirror FROZEN_EXAM_STATUSES in server/index.js.
const FROZEN_EXAM_STATUSES = ["evaluated", "reviewed", "published"];

export default function AnswerKeyPanel({ examination, user }) {
  const { toast } = useToast();
  const [paperSet, setPaperSet] = useState(examination.paper_sets?.[0] || "A");
  const [answerKey, setAnswerKey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const totalQuestions = examination.num_questions || 50;
  const optionLabels = ["A", "B", "C", "D", "E"].slice(0, examination.options_per_question || 4);

  const load = async () => {
    const keys = await appClient.entities.AnswerKey.filter({ examination_id: examination.id, paper_set: paperSet });
    const key = keys[0] || null;
    setAnswerKey(key);
    setAnswers(key?.answers || {});
  };

  useEffect(() => { load(); }, [paperSet, examination.id]);

  const setAnswer = (q, val) => setAnswers((prev) => ({ ...prev, [q]: val }));

  const assignedCount = Object.keys(answers).filter((q) => Number(q) <= totalQuestions && answers[q] && answers[q].trim() !== "").length;
  const pct = Math.min(100, Math.round((assignedCount / totalQuestions) * 100));
  const isComplete = assignedCount === totalQuestions;

  const performSave = async () => {
    setSaving(true);
    setConfirmOpen(false);
    try {
      if (answerKey) {
        const updated = await appClient.entities.AnswerKey.update(answerKey.id, { answers });
        setAnswerKey(updated);
      } else {
        const created = await appClient.entities.AnswerKey.create({
          tenant_id: examination.tenant_id,
          examination_id: examination.id,
          paper_set: paperSet,
          answers,
        });
        setAnswerKey(created);
      }
      await logAudit({
        user,
        tenant_id: examination.tenant_id,
        action: "save_answer_key",
        entity_type: "AnswerKey",
        entity_id: examination.id,
        details: `Paper set ${paperSet} (${assignedCount}/${totalQuestions} questions)`,
      });
      toast({
        title: isComplete ? "Answer key saved" : "Answer key saved (partial)",
        description: isComplete
          ? `All ${totalQuestions} questions successfully configured.`
          : `Saved ${assignedCount} of ${totalQuestions} keys. Be sure to fill remaining before evaluation.`,
      });
    } catch (err) {
      toast({ title: "Failed to save answer key", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!isComplete && assignedCount > 0) {
      setConfirmOpen(true);
    } else {
      performSave();
    }
  };

  const handleFillDefault = (opt) => {
    const next = { ...answers };
    for (let q = 1; q <= totalQuestions; q++) {
      if (!next[q]) next[q] = opt;
    }
    setAnswers(next);
    toast({ title: `Unset questions populated with option ${opt}` });
  };

  const handleClearAll = () => {
    setClearConfirmOpen(true);
  };

  const performClearAll = () => {
    setAnswers({});
    setClearConfirmOpen(false);
    toast({ title: "Answer keys cleared" });
  };

  // The stored `locked` flag is legacy and is not written by any code path, so it
  // can never be relied on. The server rejects key writes once the parent exam
  // reaches a frozen status (FROZEN_EXAM_STATUSES in server/index.js); mirror
  // that here so the controls disable before a doomed request is sent.
  const frozenExam = FROZEN_EXAM_STATUSES.includes(examination.status);
  const locked = frozenExam || Boolean(answerKey?.locked);
  const mayEdit = can(user, "edit_answer_key") && !locked;
  const viewOnlyReason = locked
    ? "Locked — this examination has already been evaluated"
    : "View only — your role cannot edit answer keys";

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-stone-700">Paper Set</span>
          <Select value={paperSet} onValueChange={setPaperSet}>
            <SelectTrigger className="w-24 h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(examination.paper_sets || ["A"]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          {locked && (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 gap-1">
              <Lock className="w-3 h-3" /> Locked (evaluated)
            </Badge>
          )}
          {!mayEdit && (
            <span className="text-xs text-stone-400">{viewOnlyReason}</span>
          )}
        </div>

        {/* Action Tools & Save Button */}
        <div className="flex items-center gap-2">
          {mayEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs gap-1.5 text-stone-600 hover:text-stone-900"
                onClick={() => handleFillDefault(optionLabels[0] || "A")}
                title="Fill remaining empty questions with default option"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Fill Empty ({optionLabels[0] || "A"})
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs gap-1 text-stone-500 hover:text-rose-600"
                onClick={handleClearAll}
                disabled={assignedCount === 0}
                title="Clear all configured answer keys"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </Button>
            </>
          )}
          <Button onClick={handleSaveClick} disabled={saving || !mayEdit} className="h-9 gap-1.5 shadow-sm">
            <Save className="w-4 h-4" /> Save Answer Key
          </Button>
        </div>
      </div>

      {/* Completeness Bar & Audit Diagnostics */}
      <div className="bg-stone-50 border border-stone-200/80 rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Key Completeness</span>
            <Badge
              variant="outline"
              className={`text-[11px] font-mono font-medium ${
                isComplete
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : assignedCount > 0
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-stone-100 text-stone-500 border-stone-200"
              }`}
            >
              {isComplete ? (
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Complete</span>
              ) : (
                <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-600" /> Incomplete</span>
              )}
            </Badge>
          </div>
          <p className="text-xs text-stone-500">
            {assignedCount} of {totalQuestions} questions configured ({pct}%)
          </p>
        </div>

        {/* Visual Progress Track */}
        <div className="w-full sm:w-64 space-y-1">
          <div className="w-full bg-stone-200 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isComplete ? "bg-emerald-500" : assignedCount > 0 ? "bg-amber-500" : "bg-stone-300"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-stone-400 font-mono">
            <span>0</span>
            <span>{totalQuestions} questions</span>
          </div>
        </div>
      </div>

      {/* Question Answer Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[420px] overflow-y-auto p-1">
        {Array.from({ length: totalQuestions }, (_, i) => i + 1).map((q) => {
          const val = answers[q] || "";
          const isSet = Boolean(val && val.trim());
          return (
            <div
              key={q}
              className={`flex items-center gap-2 p-1.5 rounded-sm border transition-colors ${
                isSet ? "bg-white border-stone-200" : "bg-amber-50/40 border-dashed border-amber-200"
              }`}
            >
              <span className={`text-xs w-7 font-mono text-right shrink-0 ${isSet ? "text-stone-500" : "text-amber-700 font-semibold"}`}>
                {q}.
              </span>
              <Select value={val} onValueChange={(v) => setAnswer(q, v)} disabled={!mayEdit}>
                <SelectTrigger className={`h-8 text-xs font-mono font-medium ${isSet ? "bg-white" : "bg-white text-stone-400"}`}>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {optionLabels.map((o) => (
                    <SelectItem key={o} value={o} className="font-mono">
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>

      {/* Incomplete Key Confirmation Modal */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Incomplete Answer Key Warning
            </DialogTitle>
            <DialogDescription className="text-sm text-stone-600 space-y-2 pt-2">
              <p>
                Only <strong>{assignedCount}</strong> of <strong>{totalQuestions}</strong> questions have an answer key assigned for Paper Set {paperSet}.
              </p>
              <p className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800">
                ⚠️ Unassigned questions ({totalQuestions - assignedCount}) will be evaluated as <strong>incorrect</strong> for all scanned student OMR sheets unless keys are provided before evaluation.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Back to Editing
            </Button>
            <Button onClick={performSave} className="bg-amber-600 hover:bg-amber-700 text-white">
              Save Incomplete Key Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear all answer keys?"
        description={`All configured answers for Paper Set ${paperSet} will be cleared. You can re-enter them before saving.`}
        confirmLabel="Clear All"
        onConfirm={performClearAll}
      />
    </div>
  );
}