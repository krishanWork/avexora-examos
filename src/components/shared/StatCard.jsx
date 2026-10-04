import React from "react";

const TINTS = {
  "text-indigo-600": "bg-indigo-50",
  "text-indigo-700": "bg-indigo-50",
  "text-emerald-600": "bg-emerald-50",
  "text-emerald-700": "bg-emerald-50",
  "text-amber-600": "bg-amber-50",
  "text-amber-700": "bg-amber-50",
  "text-rose-600": "bg-rose-50",
  "text-rose-700": "bg-rose-50",
  "text-sky-600": "bg-sky-50",
  "text-sky-700": "bg-sky-50",
  "text-teal-600": "bg-teal-50",
  "text-teal-700": "bg-teal-50",
  "text-violet-600": "bg-violet-50",
  "text-violet-700": "bg-violet-50",
  "text-orange-600": "bg-orange-50",
  "text-stone-600": "bg-stone-100",
  "text-stone-700": "bg-stone-100",
};

export default function StatCard({ label, title, value, subtext, icon: Icon, accent = "text-indigo-600" }) {
  const displayLabel = label || title || "—";
  const displayValue = value !== undefined && value !== null && value !== "" ? value : "—";
  const tint = TINTS[accent] || "bg-indigo-50";
  return (
    <div className="bg-white rounded-2xl border border-stone-200/80 p-5 flex items-start gap-4 shadow-sm hover:shadow-md hover:border-stone-300 transition-shadow">
      {Icon ? (
        <div className={`w-11 h-11 rounded-xl ${tint} flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="w-5 h-5" />
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-2xl font-bold tracking-tight text-stone-900 leading-none tabular-nums truncate">{displayValue}</p>
        <p className="text-xs font-semibold text-stone-500 mt-2 truncate">{displayLabel}</p>
        {subtext && <p className="text-xs text-stone-400 mt-0.5 truncate">{subtext}</p>}
      </div>
    </div>
  );
}