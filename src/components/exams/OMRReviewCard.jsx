import React, { useState } from "react";
import { appClient } from "@/api/appClient";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, FileText, Eye, AlertTriangle } from "lucide-react";

const BLANK_VALUE = "__blank__";

export default function OMRReviewCard({ sheet, examination, studentName, onReviewed, onInspect }) {
  const [answers, setAnswers] = useState(() => {
    const initial = { ...(sheet.extracted_answers || sheet.answers || {}) };
    for (const q of sheet.flagged_questions || []) {
      const key = String(q);
      if (initial[key] == null || initial[key] === "") {
        initial[key] = sheet.question_results?.[key]?.candidate_answer || "";
      }
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const optionLabels = ["A", "B", "C", "D", "E"].slice(0, examination.options_per_question || 4);
  const confidenceScores = sheet.confidence_scores || {};
  const isIdentityReview = sheet.identity_status === "needs_review";
  const displayImage = sheet.annotated_image_url || sheet.image_url;
  const isRawPdf = !sheet.annotated_image_url && sheet.image_url?.toLowerCase().includes(".pdf");

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const cleaned = {};
      for (const [q, v] of Object.entries(answers)) {
        if (v && v !== BLANK_VALUE) cleaned[String(q)] = v;
      }
      const updated = await appClient.entities.OMRSheet.update(sheet.id, {
        extracted_answers: cleaned,
        answers: cleaned,
        status: "completed",
        processing_status: "completed",
        flagged_questions: [],
        flagged_count: 0,
        reviewed_at: new Date().toISOString(),
      });
      try {
        await appClient.functions.invoke("evaluateExamination", { examination_id: examination.id });
      } catch {}
      onReviewed(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-stone-900">{studentName || "Unassigned Candidate"}</p>
            {isIdentityReview && (
              <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[11px] px-1.5 py-0">
                Identity Review
              </Badge>
            )}
          </div>
          {isIdentityReview ? (
            <p className="text-xs text-amber-800 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              Admission number unreadable or unconfirmed. Click "Inspect All Answers" to verify.
            </p>
          ) : (
            <p className="text-xs text-amber-700 mt-0.5">
              {sheet.flagged_questions?.length || 0} low-confidence answers to review
            </p>
          )}
        </div>

        {/* Thumbnail: use rendered PNG if available, or clean PDF badge */}
        <div className="shrink-0">
          {!isRawPdf && displayImage ? (
            <img
              src={displayImage}
              alt="OMR sheet"
              className="w-16 h-16 object-cover rounded-lg border border-amber-200 bg-white shadow-xs"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <a
              href={sheet.image_url}
              target="_blank"
              rel="noreferrer"
              className="w-16 h-16 flex flex-col items-center justify-center rounded-lg border border-amber-200 bg-white hover:bg-amber-100/50 transition-colors text-center p-1"
            >
              <FileText className="w-6 h-6 text-red-500 mb-0.5" />
              <span className="text-[11px] font-bold text-stone-600 uppercase">PDF</span>
            </a>
          )}
        </div>
      </div>

      {/* Flagged questions list (if any) */}
      {(sheet.flagged_questions || []).length > 0 && (
        <div className="flex flex-wrap gap-2.5 mb-3.5">
          {(sheet.flagged_questions || []).map((q) => {
            const conf = confidenceScores[String(q)];
            const current = answers[String(q)] || "";
            const selectValue = current ? current : BLANK_VALUE;
            return (
              <div key={q} className="flex items-center gap-2 bg-white rounded-lg border border-amber-200 px-2.5 py-1.5 shadow-2xs">
                <span className="text-xs font-semibold text-stone-700">Q{q}</span>
                <Select
                  value={selectValue}
                  onValueChange={(v) => setAnswers((prev) => ({ ...prev, [String(q)]: v === BLANK_VALUE ? "" : v }))}
                >
                  <SelectTrigger className="h-7 w-16 text-xs font-medium"><SelectValue placeholder="-" /></SelectTrigger>
                  <SelectContent>
                    {optionLabels.map((o) => <SelectItem key={o} value={o} className="text-xs font-semibold">{o}</SelectItem>)}
                    <SelectItem value={BLANK_VALUE} className="text-xs text-stone-400">Blank</SelectItem>
                  </SelectContent>
                </Select>
                {conf != null && (
                  <Badge className={`text-[11px] px-1 py-0 ${conf >= 0.65 ? "bg-stone-100 text-stone-600" : "bg-amber-100 text-amber-800 font-bold"}`}>
                    {(conf * 100).toFixed(0)}%
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleConfirm} disabled={saving} className="h-8 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Confirm Corrections
        </Button>
        {onInspect && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onInspect(sheet)}
            className="h-8 text-xs bg-white hover:bg-stone-50 border-amber-300 text-stone-800"
          >
            <Eye className="w-3.5 h-3.5 mr-1.5 text-indigo-600" /> Inspect & Review All Answers
          </Button>
        )}
      </div>
    </div>
  );
}