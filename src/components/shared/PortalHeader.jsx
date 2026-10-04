import React from "react";
import { LogOut } from "lucide-react";

// Branded header shown on student & parent portals, using the institution's branding.
export default function PortalHeader({ tenant, user, title, subtitle, onLogout }) {
  const primary = tenant?.primary_color || "#4F46E5";

  return (
    <div className="bg-white border-b border-stone-200">
      <div style={{ backgroundColor: primary }} className="h-1.5" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
        {tenant?.logo_url && (
          <img src={tenant.logo_url} alt="logo" className="w-10 h-10 rounded object-contain" />
        )}
        <div className="min-w-0">
          <h2 className="font-heading font-bold text-stone-900 leading-tight truncate" style={{ color: primary }}>
            {title || tenant?.name}
          </h2>
          {tenant?.address && <p className="text-xs text-stone-500 truncate">{tenant.address}</p>}
        </div>
        <div className="ml-auto flex items-center gap-4 shrink-0">
          {subtitle && <p className="hidden sm:block text-xs text-stone-500">{subtitle}</p>}
          {user && (
            <span className="hidden md:inline-flex text-xs font-medium text-stone-600">
              {user.full_name || user.email}
            </span>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          )}
        </div>
        {tenant?.powered_by_avexora !== false && (
          <span className="hidden lg:block text-[11px] text-stone-400 whitespace-nowrap">Powered by Avexora ExamOS</span>
        )}
      </div>
    </div>
  );
}