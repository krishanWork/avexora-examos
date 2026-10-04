import React, { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { logAudit } from "@/lib/audit";
import { scoreSheet, rankUpdates } from "@/lib/scoreOMR";
import { Loader2, Save, ClipboardCheck, Send, ExternalLink } from "lucide-react";

const LETTERS = ["A", "B", "C", "D", "E"];

export default function SheetReviewer({ examination, user, student, sheet, result, answerKey, onSaved }) {
  const { toast } = useToast();
  const [answers, setAnswers] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    // Read from extracted_answers first (corrected), fall back to answers
    setAnswers({ ...(sheet?.extracted_answers || sheet?.answers || {}) });
    setDirty(false);
  }, [sheet?.id]);

  const key = answerKey?.answers || {};
  const numQuestions = examination.num_questions || 50;
  const options = LETTERS.slice(0, examination.options_per_question || 4);
  const flagged = new Set(sheet?.flagged_questions || []);
  const confidenceScores = sheet?.confidence_scores || {};

  const setAnswer = (q, val) => {
    setAnswers((prev) => ({ ...prev, [q]: val }));
    setDirty(true);
  };

  const reRankAll = async () => {
    const all = await appClient.entities.Result.filter({ examination_id: examination.id });
    const updates = rankUpdates(all);
    if (updates.length) {
      await appClient.entities.Result.bulkUpdate(updates.map((u) => ({ id: u.id, rank: u.rank, percentile: u.percentile })));
    }
  };

  const handleSave = async () => {
    setBusy("save");
    try {
      // Log every correction so the OMR reader learns from its past mistakes
      const original = sheet.extracted_answers || sheet.answers || {};
      const corrections = [];
      for (let q = 1; q <= numQuestions; q++) {
        const k = String(q);
        const before = original[k] || "";
        const after = answers[k] || "";
        if (before !== after) {
          corrections.push({
            tenant_id: examination.tenant_id,
            examination_id: examination.id,
            omr_sheet_id: sheet.id,
            student_id: student?.id || "",
            question_number: q,
            ai_answer: before,
            corrected_answer: after,
            ai_confidence: confidenceScores[k] ?? 0,
            was_flagged: flagged.has(q),
            corrected_by: user?.full_name || "",
          });
        }
      }
      if (corrections.length > 0) await appClient.entities.OMRCorrection.bulkCreate(corrections);

      // Write to both extracted_answers AND answers for consistency
      await appClient.entities.OMRSheet.update(sheet.id, {
        extracted_answers: answers,
        answers: answers,
        status: "completed",
      });
      const score = scoreSheet(examination, key, answers);
      await appClient.entities.Result.update(result.id, { ...score, status: "draft" });
      await reRankAll();
      await logAudit({ user, tenant_id: examination.tenant_id, action: "correct_omr_sheet", entity_type: "OMRSheet", entity_id: sheet.id, details: `Corrected answers for ${student?.full_name || ""}` });
      toast({ title: "Corrections saved", description: `Result re-scored: ${score.total_marks} marks (${score.grade}).` });
      setDirty(false);
      onSaved();
    } finally {
      setBusy("");
    }
  };

  const handleReview = async () => {
    setBusy("review");
    try {
      await appClient.entities.Result.update(result.id, { status: "reviewed", reviewed_by: user?.full_name || "", reviewed_at: new Date().toISOString() });
      const all = await appClient.entities.Result.filter({ examination_id: examination.id });
      if (all.length > 0 && all.every((r) => r.status !== "draft") && examination.status !== "published") {
        await appClient.entities.Examination.update(examination.id, { status: "reviewed" });
      }
      await logAudit({ user, tenant_id: examination.tenant_id, action: "review_result", entity_type: "Result", entity_id: result.id, details: `Verified result for ${student?.full_name || ""}` });
      toast({ title: "Marked as reviewed", description: `${student?.full_name || "Student"}'s result is verified.` });
      onSaved();
    } finally {
      setBusy("");
    }
  };

  const handlePublish = async () => {
    setBusy("publish");
    try {
      await appClient.entities.Result.update(result.id, { status: "published", published_at: new Date().toISOString() });
      const all = await appClient.entities.Result.filter({ examination_id: examination.id });
      if (all.length > 0 && all.every((r) => r.status === "published")) {
        await appClient.entities.Examination.update(examination.id, { status: "published" });
      }
      await logAudit({ user, tenant_id: examination.tenant_id, action: "publish_result", entity_type: "Result", entity_id: result.id, details: `Published result for ${student?.full_name || ""}` });
      toast({ title: "Result published", description: `${student?.full_name || "Student"}'s result is now visible in the portals.` });
      onSaved();
    } finally {
      setBusy("");
    }
  };

  if (!sheet) {
    return <div className="text-sm text-stone-400 py-10 text-center border border-dashed border-stone-200 rounded-xl">No OMR sheet found for this student.</div>;
  }

  // Calculate summary stats
  let correctCount = 0, wrongCount = 0, skippedCount = 0;
  for (let q = 1; q <= numQuestions; q++) {
    const given = answers[String(q)] || "";
    const correctAns = key[String(q)] || "";
    if (!given) skippedCount++;
    else if (correctAns && given === correctAns) correctCount++;
    else wrongCount++;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-900">{student?.full_name || "Unknown student"}</h3>
          <p className="text-xs text-stone-500">
            {result ? `${result.total_marks} marks · ${result.percentage}% · Grade ${result.grade || "-"}${result.rank != null ? ` · Rank #${result.rank}` : ""}` : "Not evaluated yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleSave} disabled={!dirty || busy !== ""}>
            {busy === "save" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Save & Re-score
          </Button>
          <Button size="sm" variant="outline" onClick={handleReview} disabled={!result || dirty || busy !== "" || result.status !== "draft"}>
            {busy === "review" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-1" />}
            Mark as Reviewed
          </Button>
          <Button size="sm" variant="outline" onClick={handlePublish} disabled={!result || dirty || busy !== "" || result.status !== "reviewed"}>
            {busy === "publish" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
            Publish Result
          </Button>
        </div>
      </div>

      {dirty && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2">
          You have unsaved corrections. Save & Re-score before reviewing or publishing.
        </div>
      )}

      {/* Summary stats bar */}
      <div className="flex gap-4 text-xs bg-stone-50 rounded-lg border border-stone-200 px-4 py-2.5">
        <span className="text-emerald-700 font-semibold">{correctCount} correct</span>
        <span className="text-rose-600 font-semibold">{wrongCount} wrong</span>
        <span className="text-stone-500">{skippedCount} skipped</span>
        {flagged.size > 0 && <span className="text-amber-700 font-semibold">{flagged.size} flagged</span>}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Scanned sheet */}
        <div className="lg:sticky lg:top-4 border border-stone-200 rounded-xl overflow-hidden bg-stone-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-stone-200 bg-white">
            <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Scanned OMR Sheet</p>
            <a href={sheet.image_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">
              Open full size <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <img src={sheet.image_url} alt="Scanned OMR sheet" className="w-full" />
          </div>
        </div>

        {/* Editable extracted answers */}
        <div className="border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-stone-200 bg-white">
            <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Extracted Answers — click to correct</p>
          </div>
          <div className="max-h-[70vh] overflow-auto divide-y divide-stone-100">
            {Array.from({ length: numQuestions }, (_, i) => i + 1).map((q) => {
              const given = answers[String(q)] || "";
              const correctAns = key[String(q)] || "";
              const isCorrect = given && correctAns && given === correctAns;
              const isFlagged = flagged.has(q);
              const conf = confidenceScores[String(q)];
              return (
                <div key={q} className={`flex items-center gap-3 px-3 py-2 ${isFlagged ? "bg-amber-50" : ""}`}>
                  <span className="w-8 text-xs font-semibold text-stone-500">Q{q}</span>
                  <div className="flex gap-1">
                    {options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setAnswer(String(q), given === opt ? "" : opt)}
                        className={`w-7 h-7 rounded-full text-xs font-bold border transition-colors ${
                          given === opt
                            ? isCorrect
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "bg-rose-500 border-rose-500 text-white"
                            : "bg-white border-stone-300 text-stone-500 hover:border-stone-500"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-stone-400">Key: <b className="text-stone-700">{correctAns || "-"}</b></span>
                    {conf != null && (
                      <span className={`text-[11px] font-medium tabular-nums ${conf >= 0.85 ? "text-emerald-600" : conf >= 0.65 ? "text-stone-500" : "text-amber-700"}`}>
                        {(conf * 100).toFixed(0)}%
                      </span>
                    )}
                    {isFlagged && <Badge className="bg-amber-100 text-amber-700">flagged</Badge>}
                    {!given ? (
                      <Badge className="bg-stone-100 text-stone-500">skipped</Badge>
                    ) : isCorrect ? (
                      <Badge className="bg-emerald-100 text-emerald-700">correct</Badge>
                    ) : (
                      <Badge className="bg-rose-100 text-rose-700">wrong</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}