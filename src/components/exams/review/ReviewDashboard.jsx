import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import SheetReviewer from "@/components/exams/review/SheetReviewer";
import { Loader2 } from "lucide-react";

import { StatusBadge } from "@/lib/statusTokens";

export default function ReviewDashboard({ examination, user, onExamUpdated }) {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [results, setResults] = useState([]);
  const [answerKeys, setAnswerKeys] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const load = async () => {
    const [st, sh, re, ak] = await Promise.all([
      appClient.entities.Student.filter({ tenant_id: examination.tenant_id }),
      appClient.entities.OMRSheet.filter({ examination_id: examination.id }, "-created_date"),
      appClient.entities.Result.filter({ examination_id: examination.id }),
      appClient.entities.AnswerKey.filter({ examination_id: examination.id }),
    ]);
    setStudents(st);
    setSheets(sh);
    setResults(re);
    setAnswerKeys(ak);
    setLoading(false);
  };

  useEffect(() => { load(); }, [examination.id]);

  if (loading) {
    return <div className="flex items-center gap-2 text-stone-400 text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading review queue...</div>;
  }

  // One entry per student that has a result
  const queue = results
    .map((r) => {
      const student = students.find((s) => s.id === r.student_id);
      const sheet = sheets.find((sh) => sh.student_id === r.student_id);
      return { result: r, student, sheet };
    })
    .sort((a, b) => (a.result.rank || 999) - (b.result.rank || 999));

  if (queue.length === 0) {
    return (
      <div className="text-sm text-stone-400 py-10 text-center border border-dashed border-stone-200 rounded-xl">
        No results to review yet. Upload OMR sheets and run evaluation first.
      </div>
    );
  }

  const selected = queue.find((q) => q.result.student_id === selectedId) || queue[0];
  const answerKey = answerKeys.find((k) => k.paper_set === (selected.sheet?.paper_set || "A")) || answerKeys[0];
  const pending = queue.filter((q) => q.result.status === "draft").length;
  const published = queue.filter((q) => q.result.status === "published").length;

  const refresh = () => {
    load();
    onExamUpdated();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-stone-50 border border-stone-200 text-stone-600 text-sm px-4 py-3">
        <b>{pending}</b> awaiting review · <b>{queue.length - pending - published}</b> reviewed · <b>{published}</b> published. Verify each student's extracted answers against their scanned sheet, correct any mismatches, then publish.
      </div>
      <div className="grid md:grid-cols-[240px_1fr] gap-4 items-start">
        {/* Student queue */}
        <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
          <div className="px-3 py-2 border-b border-stone-200 text-xs font-semibold text-stone-600 uppercase tracking-wide">Students ({queue.length})</div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-stone-100">
            {queue.map(({ result, student }) => {
              const active = result.student_id === selected.result.student_id;
              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => setSelectedId(result.student_id)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-stone-50 transition-colors ${active ? "bg-indigo-50 border-l-2 border-indigo-600" : ""}`}
                >
                  <p className="text-sm font-medium text-stone-800 truncate">{student?.full_name || "Unknown"}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-stone-400">{result.rank != null ? `#${result.rank} · ` : ""}{result.total_marks} marks</span>
                    <StatusBadge status={result.status} type="exam" className="text-[11px] px-1.5 py-0" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Reviewer */}
        <SheetReviewer
          examination={examination}
          user={user}
          student={selected.student}
          sheet={selected.sheet}
          result={selected.result}
          answerKey={answerKey}
          onSaved={refresh}
        />
      </div>
    </div>
  );
}