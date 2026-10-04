import React from "react";

export default function PageHeader({ title, description, actions, action, children }) {
  const headerActions = actions || action || children;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-4 border-b border-stone-200">
      <div>
        <h1 className="text-2xl sm:text-3xl font-heading font-bold tracking-tight text-stone-900">{title}</h1>
        {description ? <p className="text-sm text-stone-500 mt-1 font-normal max-w-2xl">{description}</p> : null}
      </div>
      {headerActions ? <div className="flex items-center gap-2.5 shrink-0 flex-wrap">{headerActions}</div> : null}
    </div>
  );
}