import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";

// Toggleable chips multi-select with option to add custom values
export default function MultiSelectChips({ options = [], values = [], onChange, placeholder = "Add..." }) {
  const [custom, setCustom] = useState("");
  const toggle = (v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  const addCustom = () => {
    const v = custom.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setCustom("");
  };
  const allOptions = [...new Set([...options, ...values])];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {allOptions.map((o) => {
          const active = values.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-stone-600 border-stone-200 hover:border-indigo-400"}`}
            >
              {o}
              {active && <X className="w-3 h-3 inline ml-1" />}
            </button>
          );
        })}
        {allOptions.length === 0 && <span className="text-xs text-stone-400">No options yet — type below to add.</span>}
      </div>
      <div className="flex gap-2">
        <Input
          className="h-8 text-xs"
          placeholder={placeholder}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
        />
        <button type="button" onClick={addCustom} className="h-8 px-2 rounded-md border border-stone-200 text-stone-500 hover:bg-stone-50">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}