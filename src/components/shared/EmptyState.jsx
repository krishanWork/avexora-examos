import React from "react";

export default function EmptyState({ icon: Icon, title, description, action, children }) {
  const cta = action || children;
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {Icon ? (
        <div className="w-12 h-12 rounded-xl border border-stone-200 bg-stone-50 flex items-center justify-center text-stone-400 mb-3.5 shadow-sm">
          <Icon className="w-6 h-6" />
        </div>
      ) : null}
      <h3 className="font-heading font-semibold text-stone-900 text-base">{title}</h3>
      {description ? <p className="text-sm text-stone-500 mt-1.5 max-w-md leading-relaxed">{description}</p> : null}
      {cta ? <div className="mt-4">{cta}</div> : null}
    </div>
  );
}