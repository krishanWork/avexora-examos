import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { generateExamReportPDF } from "@/lib/generateExamReportPDF";
import { CheckCircle2, XCircle, MinusCircle, AlertTriangle, TrendingUp, TrendingDown, FileDown } from "lucide-react";

const Stat = ({ label, value, className }) => (
  <div className={`rounded-lg p-3 text-center ${className}`}>
    <p className="text-xl font-bold">{value}</p>
    <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
  </div>
);

export default function ExamDetailedReport({ open, onOpenChange, result, exam, previousResult, tenant }) {
  const [answerKey, setAnswerKey] = useState(null);
  const [omr, setOmr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadDetails = async () => {
    if (!result) return;
    setLoading(true);
    setError(null);
    try {
      const [keys, sheets] = await Promise.all([
        appClient.entities.AnswerKey.filter({ examination_id: result.examination_id }),
        appClient.entities.OMRSheet.filter({ examination_id: result.examination_id, student_id: result.student_id }),
      ]);
      const sheet = sheets[0] || null;
      const key = keys.find((k) => k.paper_set === (sheet?.paper_set || "A")) || keys[0] || null;
      setAnswerKey(key);
      setOmr(sheet);
    } catch (err) {
      console.error("Failed to load question details:", err);
      setError("Failed to load question breakdown. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !result) return;
    loadDetails();
  }, [open, result?.id]);

  if (!result || !exam) return null;

  const numQ = exam.num_questions || 0;
  const marksPerQ = numQ ? exam.max_marks / numQ : 0;
  const negative = exam.negative_marking ? exam.negative_mark_value || 0 : 0;
  const flagged = omr?.flagged_questions || [];
  const delta = previousResult?.percentage != null && result.percentage != null
    ? +(result.percentage - previousResult.percentage).toFixed(1)
    : null;

  const rows = [];
  for (let q = 1; q <= numQ; q++) {
    const correct = answerKey?.answers?.[String(q)] ?? answerKey?.answers?.[q];
    const given = omr?.extracted_answers?.[String(q)] ?? omr?.extracted_answers?.[q];
    const isFlagged = flagged.includes(q);
    let status, marks;
    if (!given) { status = "skipped"; marks = 0; }
    else if (correct && given === correct) { status = "correct"; marks = marksPerQ; }
    else { status = "wrong"; marks = -negative; }
    rows.push({ q, correct, given, status, marks, isFlagged });
  }

  const statusUI = {
    correct: { icon: CheckCircle2, cls: "text-emerald-600", label: "Correct" },
    wrong: { icon: XCircle, cls: "text-red-500", label: "Wrong" },
    skipped: { icon: MinusCircle, cls: "text-stone-400", label: "Not Answered" },
  };

  const calculatedCorrect = rows.filter((r) => r.status === "correct").length;
  const calculatedWrong = rows.filter((r) => r.status === "wrong").length;
  const calculatedSkipped = rows.filter((r) => r.status === "skipped").length;
  const correctCount = result.correct_count ?? result.correct_answers ?? (rows.length ? calculatedCorrect : "-");
  const wrongCount = result.wrong_count ?? result.incorrect_answers ?? (rows.length ? calculatedWrong : "-");
  const skippedCount = result.skipped_count ?? result.unattempted ?? (rows.length ? calculatedSkipped : "-");

  const calculatedTotal = rows.reduce((sum, r) => sum + r.marks, 0);
  const totalMarks = (result.total_marks != null && marksPerQ > 1 && result.total_marks === correctCount && calculatedTotal > result.total_marks)
    ? Math.max(0, +calculatedTotal.toFixed(2))
    : (result.total_marks ?? (rows.length ? Math.max(0, +calculatedTotal.toFixed(2)) : 0));
  const percentage = exam.max_marks ? +((totalMarks / exam.max_marks) * 100).toFixed(1) : (result.percentage ?? 0);
  const gradeDisplay = (result.grade && result.grade !== "F") || percentage < 33
    ? (result.grade || "F")
    : (percentage >= 90 ? "A+" : percentage >= 80 ? "A" : percentage >= 70 ? "B+" : percentage >= 60 ? "B" : percentage >= 50 ? "C" : percentage >= 33 ? "D" : "F");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-6">
            <span>{exam.name} — Detailed Report</span>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || (!omr && !answerKey)}
              onClick={() => window.open(generateExamReportPDF({ tenant, exam, result: { ...result, total_marks: totalMarks, percentage, correct_count: correctCount, wrong_count: wrongCount, skipped_count: skippedCount }, rows, previousResult }), "_blank")}
            >
              <FileDown className="w-4 h-4 mr-2" /> Download
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Analytics summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Correct" value={correctCount} className="bg-emerald-50 text-emerald-700" />
          <Stat label="Wrong" value={wrongCount} className="bg-red-50 text-red-600" />
          <Stat label="Not Answered" value={skippedCount} className="bg-stone-100 text-stone-600" />
          <Stat label="Marking Issues" value={flagged.length} className="bg-amber-50 text-amber-700" />
        </div>

        {/* Improvement vs last exam */}
        {delta != null && (
          <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
            {delta >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span className="font-semibold">{delta >= 0 ? "+" : ""}{delta}%</span>
            <span>vs last exam ({previousResult.examName || "previous"}: {previousResult.percentage?.toFixed(1)}%)</span>
          </div>
        )}

        {flagged.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 text-amber-700 p-3 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Questions {flagged.join(", ")} had unclear markings on the OMR sheet (double marks or light shading). Darken circles fully next time.</span>
          </div>
        )}

        {/* Question-level breakdown alongside the scanned OMR sheet */}
        {loading ? (
          <p className="text-sm text-stone-400 py-6 text-center">Loading question details...</p>
        ) : error ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm text-red-600">{error}</p>
            <Button size="sm" variant="outline" onClick={loadDetails}>Retry</Button>
          </div>
        ) : !omr && !answerKey ? (
          <p className="text-sm text-stone-400 py-6 text-center">Question-level details are not available for this exam.</p>
        ) : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {omr?.image_url && (
            <div className="lg:sticky lg:top-0 border border-stone-200 rounded-lg overflow-hidden bg-stone-50">
              <div className="flex items-center justify-between px-3 py-2 border-b border-stone-200 bg-white">
                <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Scanned OMR Sheet</p>
                <a href={omr.image_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">Open full size</a>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <img src={omr.image_url} alt="Scanned OMR sheet" className="w-full" />
              </div>
            </div>
          )}
          <div className={omr?.image_url ? "" : "lg:col-span-2"}>
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-[11px] uppercase">
              <tr>
                <th className="text-left px-3 py-2">Q</th>
                <th className="text-left px-3 py-2">Your Answer</th>
                <th className="text-left px-3 py-2">Correct Answer</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Marks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const S = statusUI[r.status];
                return (
                  <tr key={r.q} className="border-t border-stone-100">
                    <td className="px-3 py-1.5 font-medium">{r.q}</td>
                    <td className="px-3 py-1.5">{r.given || "—"}{r.isFlagged && <AlertTriangle className="w-3 h-3 text-amber-500 inline ml-1" />}</td>
                    <td className="px-3 py-1.5 font-medium text-stone-700">{r.correct || "—"}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1 text-xs ${S.cls}`}>
                        <S.icon className="w-3.5 h-3.5" /> {S.label}
                      </span>
                    </td>
                    <td className={`px-3 py-1.5 text-right font-medium ${r.marks > 0 ? "text-emerald-600" : r.marks < 0 ? "text-red-500" : "text-stone-400"}`}>
                      {r.marks > 0 ? "+" : ""}{+r.marks.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        )}

        <div className="flex items-center justify-between border-t border-stone-100 pt-3 text-sm">
          <span className="text-stone-500">Total: <b className="text-stone-900">{totalMarks} / {exam.max_marks}</b> ({percentage.toFixed(1)}%)</span>
          <Badge className="bg-indigo-100 text-indigo-700">Grade {gradeDisplay}{result.rank != null ? ` · Rank #${result.rank}` : ""}</Badge>
        </div>
      </DialogContent>
    </Dialog>
  );
}