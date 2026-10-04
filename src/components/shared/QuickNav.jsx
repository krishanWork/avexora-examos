import React from "react";
import { Link } from "react-router-dom";

export default function QuickNav({ title, items }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map(({ to, icon: Icon, color, label }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-2.5 p-3 rounded-xl bg-stone-50 hover:bg-indigo-50/70 border border-stone-100 hover:border-indigo-200 transition text-sm font-medium text-stone-700 hover:text-indigo-700"
          >
            <Icon className={`w-4 h-4 ${color}`} /> {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
