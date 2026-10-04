import React from "react";
import { Check } from "lucide-react";

const STEPS = ["Setup & Answer Key", "Print OMR Sheets", "Scan & Upload", "Evaluate", "Review", "Publish Results"];
const STATUS_STEP = { draft: 0, scheduled: 1, omr_in_progress: 2, evaluated: 3, reviewed: 4, published: 5 };

export default function ExamWorkflowSteps({ status }) {
  const current = STATUS_STEP[status] ?? 0;
  return (
    <div className="flex items-center gap-1 overflow-x-auto mb-6 bg-white border border-stone-200 rounded-xl px-4 py-3">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i < current ? "bg-emerald-500 text-white" : i === current ? "bg-indigo-600 text-white" : "bg-stone-100 text-stone-400"}`}>
              {i < current ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </span>
            <span className={`text-xs font-medium ${i === current ? "text-indigo-700" : i < current ? "text-stone-700" : "text-stone-400"}`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`h-px flex-1 min-w-4 ${i < current ? "bg-emerald-300" : "bg-stone-200"}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}