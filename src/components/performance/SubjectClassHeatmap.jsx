import React from "react";

const cellStyle = (v) => {
  if (v == null) return { className: "bg-stone-50 text-stone-300", label: "–" };
  if (v >= 75) return { className: "bg-emerald-500 text-white", label: `${v}%` };
  if (v >= 60) return { className: "bg-emerald-300 text-emerald-950", label: `${v}%` };
  if (v >= 45) return { className: "bg-amber-300 text-amber-950", label: `${v}%` };
  if (v >= 30) return { className: "bg-orange-400 text-white", label: `${v}%` };
  return { className: "bg-red-500 text-white", label: `${v}%` };
};

export default function SubjectClassHeatmap({ classes, subjects, cells }) {
  if (classes.length === 0 || subjects.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <h3 className="font-heading font-semibold text-stone-900 mb-1">Subject Performance by Class</h3>
      <p className="text-xs text-stone-500 mb-4">
        Average score (%) per subject across each class — red cells indicate subjects that need more focus.
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs border-separate" style={{ borderSpacing: "3px" }}>
          <thead>
            <tr>
              <th className="text-left pr-2 font-medium text-stone-500 sticky left-0 bg-white">Class</th>
              {subjects.map((sub) => (
                <th key={sub} className="px-2 pb-1 font-medium text-stone-500 min-w-[70px] text-center">{sub}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((cls) => (
              <tr key={cls}>
                <td className="pr-2 font-medium text-stone-700 whitespace-nowrap sticky left-0 bg-white">{cls}</td>
                {subjects.map((sub) => {
                  const v = cells[`${cls}__${sub}`];
                  const { className, label } = cellStyle(v);
                  return (
                    <td key={sub} className={`rounded-md text-center font-semibold py-2.5 px-2 min-w-[70px] ${className}`} title={`${cls} · ${sub}: ${v != null ? v + "%" : "No data"}`}>
                      {label}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-4 text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> &lt;30%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400" /> 30–44%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-300" /> 45–59%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-300" /> 60–74%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" /> ≥75%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-stone-50 border border-stone-200" /> No data</span>
      </div>
    </div>
  );
}