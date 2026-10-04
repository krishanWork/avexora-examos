import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const COLORS = ["#4F46E5", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#14B8A6", "#EC4899", "#84CC16", "#F97316", "#6366F1"];

export default function ClassImprovementChart({ trendData, classNames, improvements }) {
  if (trendData.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <h3 className="font-heading font-semibold text-stone-900 mb-1">Average Class Performance Trend</h3>
      <p className="text-xs text-stone-500 mb-4">Average score (%) per class across examinations, in chronological order.</p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `${v}%`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {classNames.map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {improvements.length > 0 && (
        <div className="mt-4 pt-4 border-t border-stone-100">
          <p className="text-xs font-medium text-stone-500 uppercase mb-2">Improvement Score (first vs latest exam)</p>
          <div className="flex flex-wrap gap-2">
            {improvements.map((imp) => {
              const Icon = imp.improvement > 0 ? TrendingUp : imp.improvement < 0 ? TrendingDown : Minus;
              const color = imp.improvement > 0 ? "bg-emerald-50 text-emerald-700" : imp.improvement < 0 ? "bg-red-50 text-red-600" : "bg-stone-50 text-stone-500";
              return (
                <span key={imp.class_name} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${color}`}>
                  {imp.class_name}
                  <Icon className="w-3.5 h-3.5" />
                  {imp.improvement > 0 ? "+" : ""}{imp.improvement}%
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}