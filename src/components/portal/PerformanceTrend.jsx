import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// data: [{ name, percentage }] in chronological order
export default function PerformanceTrend({ data }) {
  if (!data || data.length < 2) return null;
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const delta = +(latest.percentage - prev.percentage).toFixed(1);
  const up = delta > 0;
  const flat = delta === 0;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-heading font-semibold text-stone-900 text-sm">Performance Trend</h3>
          <p className="text-xs text-stone-500">Last exam vs this exam</p>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${flat ? "bg-stone-100 text-stone-600" : up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
          {flat ? <Minus className="w-4 h-4" /> : up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          {up ? "+" : ""}{delta}% {flat ? "no change" : up ? "improvement" : "decline"}
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => [`${v}%`, "Score"]} />
            <Line type="monotone" dataKey="percentage" stroke="#4F46E5" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}