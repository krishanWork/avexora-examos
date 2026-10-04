import React from "react";
import { getImpersonation, stopImpersonation } from "@/lib/impersonation";
import { Eye, X } from "lucide-react";

export default function ImpersonationBanner() {
  const imp = getImpersonation();
  if (!imp) return null;

  const handleExit = () => {
    stopImpersonation();
    window.location.href = "/tenants";
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-amber-500 text-amber-950 text-sm font-medium px-4 py-2.5 rounded-full shadow-lg">
      <Eye className="w-4 h-4 shrink-0" />
      <span className="truncate max-w-[60vw]">
        Viewing {imp.tenant_name} as {imp.portal_label}
        {imp.student_name ? ` (${imp.student_name})` : ""}
        {/* A family portal is built around ONE child, but the server scope is the
            SCHOOL, so the lists it renders are the whole school's. Saying so is the
            difference between a portal that is coarse and one that is lying. */}
        {imp.student_name ? " — lists below cover the whole institution" : ""}
      </span>
      <button onClick={handleExit} className="flex items-center gap-1 bg-amber-950 text-amber-50 px-3 py-1 rounded-full text-xs font-semibold hover:opacity-90">
        <X className="w-3 h-3" /> Exit
      </button>
    </div>
  );
}