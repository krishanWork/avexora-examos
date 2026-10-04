import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

const barColor = (rate) => (rate >= 70 ? "#10B981" : rate >= 40 ? "#F59E0B" : "#EF4444");

export default function QuestionSuccessChart({ data }) {
  if (data.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <h3 className="font-heading font-semibold text-stone-900 mb-1">Question Success Rates</h3>
      <p className="text-xs text-stone-500 mb-4">
        Percentage of students answering each question correctly, aggregated across all evaluated examinations.
        <span className="ml-2 inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> ≥70%</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 40–69%</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> &lt;40%</span>
        </span>
      </p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} />
            <XAxis dataKey="question" tick={{ fontSize: 10 }} interval={data.length > 30 ? 4 : 0} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v, name) => (name === "rate" ? [`${v}%`, "Success rate"] : v)} labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.attempts || 0} attempts`} />
            <Bar dataKey="rate" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.question} fill={barColor(d.rate)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}