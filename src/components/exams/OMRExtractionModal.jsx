import React, { useState, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2,
  X,
  UserCheck,
  AlertTriangle,
  FileText,
  ExternalLink,
  Check,
  Filter,
} from "lucide-react";

const BLANK_VALUE = "__blank__";

const IDENTITY_BADGE = {
  matched: "bg-emerald-100 text-emerald-700 border-emerald-200",
  needs_review: "bg-amber-100 text-amber-700 border-amber-200",
  unmatched: "bg-stone-100 text-stone-600 border-stone-200",
};

// Normalized 4-state classification from the CV engine (additive `state` field).
const STATE_BADGE = {
  confident: "bg-emerald-100 text-emerald-700 border-emerald-200",
  blank: "bg-stone-100 text-stone-500 border-stone-200",
  multiple: "bg-rose-100 text-rose-700 border-rose-200",
  needs_review: "bg-amber-100 text-amber-700 border-amber-200",
};
const STATE_LABEL = {
  confident: "Confident",
  blank: "Blank",
  multiple: "Multiple",
  needs_review: "Needs Review",
};

export default function OMRExtractionModal({ sheet, exam, students, onClose, onFinalized }) {
  const matched = sheet.identity_status === "matched";
  const [overrideStudentId, setOverrideStudentId] = useState(sheet.student_id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all"); // "all" | "flagged" | "answered" | "blank"
  const [answerKey, setAnswerKey] = useState({});

  // Question counts & options
  const totalQuestions = Number(exam?.num_questions || exam?.number_of_questions) || sheet.total_questions || 50;
  const optionLabels = ["A", "B", "C", "D", "E"].slice(0, exam?.options_per_question || 4);
  const confidenceScores = sheet.confidence_scores || {};
  const questionResults = sheet.question_results || {};
  const detected = sheet.admission_number_detection || null;
  const flaggedQuestionsSet = useMemo(() => new Set(sheet.flagged_questions || []), [sheet.flagged_questions]);

  // Initial answers state covering all questions
  // Guard: only confident detections prefill an option. Blank / needs_review /
  // multiple rows start empty so the reviewer never sees a silently-picked answer;
  // legacy results without a `state` field still fall back to candidate/answer.
  const [answers, setAnswers] = useState(() => {
    const initial = { ...(sheet.extracted_answers || sheet.answers || {}) };
    for (let q = 1; q <= totalQuestions; q++) {
      const key = String(q);
      const qr = questionResults[key];
      if (qr?.state && qr.state !== "confident") continue;
      if (initial[key] == null || initial[key] === "") {
        const candidate = qr?.candidate_answer || qr?.answer;
        if (candidate) initial[key] = candidate;
      }
    }
    return initial;
  });

  // Load Answer Key for live comparison
  useEffect(() => {
    const loadKey = async () => {
      try {
        const keys = await appClient.entities.AnswerKey.filter({
          examination_id: exam.id,
          paper_set: sheet.paper_set || "A",
        });
        if (keys?.[0]?.answers) {
          setAnswerKey(keys[0].answers);
        } else {
          const anyKeys = await appClient.entities.AnswerKey.filter({ examination_id: exam.id });
          if (anyKeys?.[0]?.answers) setAnswerKey(anyKeys[0].answers);
        }
      } catch (err) {
        console.warn("Could not load answer key:", err);
      }
    };
    loadKey();
  }, [exam.id, sheet.paper_set]);

  const overrideNeeded = !matched || (overrideStudentId && overrideStudentId !== sheet.student_id);
  const selectedStudent = students.find((s) => s.id === overrideStudentId);

  // Compute question list based on active filter
  const allQuestionNumbers = useMemo(() => {
    const list = [];
    for (let i = 1; i <= totalQuestions; i++) list.push(i);
    return list;
  }, [totalQuestions]);

  const filteredQuestions = useMemo(() => {
    return allQuestionNumbers.filter((q) => {
      const ans = answers[String(q)];
      const isFlagged = flaggedQuestionsSet.has(q);
      if (activeFilter === "flagged") return isFlagged;
      if (activeFilter === "answered") return ans && ans !== BLANK_VALUE;
      if (activeFilter === "blank") return !ans || ans === BLANK_VALUE;
      return true;
    });
  }, [allQuestionNumbers, answers, flaggedQuestionsSet, activeFilter]);

  // Answer counts
  const answeredCount = Object.values(answers).filter((v) => v && v !== BLANK_VALUE).length;
  const blankCount = totalQuestions - answeredCount;

  // Best display image URL (prefer rendered PNG over raw PDF)
  const displayImageUrl = sheet.annotated_image_url || sheet.file_url || sheet.image_url;
  const isPdf = displayImageUrl?.toLowerCase().includes(".pdf");

  const handleFinalize = async () => {
    setSaving(true);
    setError(null);
    try {
      if (overrideNeeded && overrideStudentId) {
        await appClient.functions.invoke("processOMRSheet", {
          omr_sheet_id: sheet.id,
          override_student_id: overrideStudentId,
        });
      }

      const cleaned = {};
      for (const [q, v] of Object.entries(answers)) {
        if (v && v !== BLANK_VALUE) cleaned[String(q)] = v;
      }

      const updated = await appClient.entities.OMRSheet.update(sheet.id, {
        extracted_answers: cleaned,
        answers: cleaned,
        status: "completed",
        processing_status: "completed",
        identity_status: "matched",
        flagged_questions: [],
        flagged_count: 0,
        reviewed_at: new Date().toISOString(),
      });

      // Recalculate examination results
      try {
        await appClient.functions.invoke("evaluateExamination", { examination_id: exam.id });
      } catch (evalErr) {
        console.warn("Result evaluation trigger notice:", evalErr);
      }

      onFinalized(updated);
    } catch (e) {
      setError(e?.message || e?.error || "Failed to finalize the sheet");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-6xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-stone-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 bg-stone-50/50">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-heading font-semibold text-lg text-stone-900">OMR Answers & Identity Review</h3>
              <Badge variant="outline" className="text-xs font-normal">
                Set {sheet.paper_set || "A"} · {totalQuestions} Questions
              </Badge>
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Review answers extracted by the CV pipeline, inspect bubble confidence, and confirm student identity.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="w-5 h-5 text-stone-400 hover:text-stone-700" />
          </Button>
        </div>

        {/* Content Body */}
        <div className="grid md:grid-cols-12 gap-0 flex-1 overflow-hidden">
          {/* Left Column: Visual Scanned Sheet (5 cols) */}
          <div className="md:col-span-5 p-5 border-r border-stone-100 bg-stone-50/30 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                Scanned Sheet Overlay
              </span>
              {displayImageUrl && (
                <a
                  href={displayImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  Full resolution <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div className="relative flex-1 min-h-[340px] max-h-[580px] bg-stone-100 rounded-xl border border-stone-200 overflow-hidden flex items-center justify-center p-1">
              {sheet.annotated_image_url ? (
                <img
                  src={sheet.annotated_image_url}
                  alt="OMR annotated scan"
                  className="w-full h-full object-contain rounded-lg"
                />
              ) : isPdf ? (
                <div className="text-center p-6 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-stone-800">Scanned PDF Document</p>
                    <p className="text-xs text-stone-500 mt-1">PDF file was processed by the OpenCV engine.</p>
                  </div>
                  <a
                    href={sheet.image_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-stone-200 text-xs font-medium text-stone-700 rounded-lg shadow-sm hover:bg-stone-50"
                  >
                    Open Original PDF <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : (
                <img
                  src={sheet.image_url}
                  alt="OMR raw scan"
                  className="w-full h-full object-contain rounded-lg"
                />
              )}
            </div>

            {/* Quick stats below image */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="bg-white p-2.5 rounded-lg border border-stone-200 text-center">
                <span className="text-[11px] text-stone-400 uppercase font-medium">Answered</span>
                <p className="text-base font-semibold text-stone-800 mt-0.5">{answeredCount}</p>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-stone-200 text-center">
                <span className="text-[11px] text-stone-400 uppercase font-medium">Blank</span>
                <p className="text-base font-semibold text-stone-800 mt-0.5">{blankCount}</p>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-stone-200 text-center">
                <span className="text-[11px] text-stone-400 uppercase font-medium">Flagged</span>
                <p className={`text-base font-semibold mt-0.5 ${sheet.flagged_count > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                  {sheet.flagged_count || 0}
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Identity & Question Breakdown (7 cols) */}
          <div className="md:col-span-7 p-6 flex flex-col overflow-y-auto space-y-5">
            {/* Identity & Student Assignment Box */}
            <div className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-stone-500" /> Student Identity
                </span>
                <Badge className={IDENTITY_BADGE[sheet.identity_status] || IDENTITY_BADGE.unmatched}>
                  {(sheet.identity_status || "unmatched").replace("_", " ")}
                </Badge>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs bg-stone-50 p-3 rounded-lg border border-stone-100">
                <div>
                  <span className="text-stone-400 font-medium">Detected Admission No:</span>
                  <p className="font-mono font-bold text-stone-800 mt-0.5">
                    {detected?.canonical || "Not Detected"}
                  </p>
                </div>
                <div>
                  <span className="text-stone-400 font-medium">Assigned Student:</span>
                  <p className="font-medium text-stone-800 mt-0.5 truncate">
                    {selectedStudent ? `${selectedStudent.full_name} (${selectedStudent.roll_number || "—"})` : "Unassigned"}
                  </p>
                </div>
              </div>

              {!matched && sheet.match_error && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Review required: </span>
                    <span>
                      {sheet.match_error === "UNREADABLE_ADMISSION_BUBBLES"
                        ? "Admission number bubbles were blank or faint. Please assign the student manually."
                        : sheet.match_error === "NOT_ENROLLED_IN_EXAMINATION"
                        ? "The detected admission number does not match any student enrolled in this exam."
                        : sheet.match_error}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">
                  Assign Student (from exam roster):
                </label>
                <Select value={overrideStudentId} onValueChange={setOverrideStudentId}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select candidate..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {students.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.full_name} — Roll: {s.roll_number || "—"} {s.admission_number ? `· Adm: ${s.admission_number}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Questions Filter & Toolbar */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-stone-400" />
                  <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">
                    Evaluated Answers ({filteredQuestions.length})
                  </span>
                </div>
                <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-lg text-xs">
                  <button
                    onClick={() => setActiveFilter("all")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all ${activeFilter === "all" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    All ({totalQuestions})
                  </button>
                  <button
                    onClick={() => setActiveFilter("flagged")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all ${activeFilter === "flagged" ? "bg-white text-amber-700 shadow-sm font-semibold" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    Flagged ({sheet.flagged_count || 0})
                  </button>
                  <button
                    onClick={() => setActiveFilter("answered")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all ${activeFilter === "answered" ? "bg-white text-emerald-700 shadow-sm font-semibold" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    Answered ({answeredCount})
                  </button>
                  <button
                    onClick={() => setActiveFilter("blank")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all ${activeFilter === "blank" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
                  >
                    Blank ({blankCount})
                  </button>
                </div>
              </div>

              {/* Question Interactive Grid / List */}
              <div className="max-h-72 overflow-y-auto border border-stone-200 rounded-xl divide-y divide-stone-100 bg-white shadow-inner">
                {filteredQuestions.length === 0 ? (
                  <div className="py-8 text-center text-xs text-stone-400">
                    No questions match the "{activeFilter}" filter.
                  </div>
                ) : (
                  filteredQuestions.map((q) => {
                    const key = String(q);
                    const currentVal = answers[key] || "";
                    const selectValue = currentVal || BLANK_VALUE;
                    const conf = confidenceScores[key];
                    const qRes = questionResults[key];
                    const isFlagged = flaggedQuestionsSet.has(q);
                    const correctKey = answerKey[key];
                    const isMatch = correctKey && currentVal && currentVal === correctKey;
                    const isWrong = correctKey && currentVal && currentVal !== correctKey && currentVal !== BLANK_VALUE;

                    return (
                      <div
                        key={q}
                        className={`flex items-center justify-between px-3.5 py-2.5 hover:bg-stone-50/80 transition-colors ${isFlagged ? "bg-amber-50/50" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-xs text-stone-700 w-8">
                            Q{q}
                          </span>

                          {/* Candidate Bubble / Status */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-stone-500 font-medium">Selected:</span>
                            <Select
                              value={selectValue}
                              onValueChange={(v) =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [key]: v === BLANK_VALUE ? "" : v,
                                }))
                              }
                            >
                              <SelectTrigger className="h-7 w-20 text-xs font-semibold">
                                <SelectValue placeholder="-" />
                              </SelectTrigger>
                              <SelectContent>
                                {optionLabels.map((o) => (
                                  <SelectItem key={o} value={o} className="text-xs font-semibold">
                                    {o}
                                  </SelectItem>
                                ))}
                                <SelectItem value={BLANK_VALUE} className="text-xs text-stone-400">
                                  Blank
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Confidence & Fill */}
                          {conf != null && (
                            <span
                              className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${conf >= 0.85 ? "text-emerald-700 bg-emerald-50" : conf >= 0.65 ? "text-stone-600 bg-stone-100" : "text-amber-700 bg-amber-100 font-bold"}`}
                              title={`Confidence: ${(conf * 100).toFixed(1)}%`}
                            >
                              {(conf * 100).toFixed(0)}%
                            </span>
                          )}

                          {isFlagged && (
                            <Badge className="bg-amber-100 text-amber-700 text-[11px] px-1.5 py-0">
                              Flagged
                            </Badge>
                          )}

                          {qRes?.state && qRes.state !== "confident" && (
                            <Badge variant="outline" className={`${STATE_BADGE[qRes.state] || STATE_BADGE.needs_review} text-[11px] px-1.5 py-0`}>
                              {STATE_LABEL[qRes.state] || qRes.state.replace("_", " ")}
                            </Badge>
                          )}
                        </div>

                        {/* Answer Key Comparison (Right side) */}
                        <div className="flex items-center gap-2">
                          {correctKey ? (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-stone-400 text-[11px]">Key: <strong className="text-stone-700">{correctKey}</strong></span>
                              {isMatch && (
                                <Badge className="bg-emerald-100 text-emerald-700 text-[11px] px-1.5 py-0 flex items-center gap-0.5">
                                  <Check className="w-3 h-3" /> Correct
                                </Badge>
                              )}
                              {isWrong && (
                                <Badge className="bg-rose-100 text-rose-700 text-[11px] px-1.5 py-0">
                                  Wrong
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-stone-300">No Key</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {error && <p className="text-xs font-medium text-red-600">{error}</p>}

            {/* Footer Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                className="flex-1"
                onClick={handleFinalize}
                disabled={saving || !overrideStudentId}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {saving
                  ? "Saving & Finalizing..."
                  : matched
                  ? "Confirm & Finalize Answers"
                  : "Assign Student & Finalize"}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}