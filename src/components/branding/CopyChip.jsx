import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

// Small mono code chip with a copy button next to it.
export default function CopyChip({ value, display }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="inline-flex items-center gap-1.5 max-w-full">
      <code className="bg-stone-100 rounded px-1.5 py-0.5 text-xs font-mono text-stone-700 truncate">{display || value}</code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 border border-stone-200 rounded-md p-1 text-stone-500 hover:text-stone-800 hover:border-stone-300"
        aria-label={`Copy ${value}`}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}