import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";

export default function StudentResultsChart({ data }) {
  if (data.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <h3 className="font-heading font-semibold text-stone-900 mb-1">Score Trend</h3>
      <p className="text-xs text-stone-500 mb-4">Percentage scored in each examination, in chronological order.</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `${v}%`} />
            <ReferenceLine y={35} stroke="#EF4444" strokeDasharray="4 4" label={{ value: "Pass", fontSize: 10, fill: "#EF4444" }} />
            <Line type="monotone" dataKey="percentage" stroke="#4F46E5" strokeWidth={2.5} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}