import React from "react";
import { Outlet, Navigate } from "react-router-dom";
import MarketingNavbar from "@/components/marketing/MarketingNavbar";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import useTenantDomain from "@/hooks/useTenantDomain";

export default function MarketingLayout() {
  const { checking, branding } = useTenantDomain();

  // On a tenant's custom domain, the marketing site is hidden — send visitors to their branded login
  if (checking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin"></div>
      </div>
    );
  }
  if (branding) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A14] text-white relative">
      {/* Ambient gradient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-violet-600/25 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-cyan-500/15 blur-[140px]" />
        <div className="absolute -bottom-40 left-1/3 w-[500px] h-[500px] rounded-full bg-fuchsia-600/15 blur-[140px]" />
      </div>
      <MarketingNavbar />
      <main className="flex-1 relative z-10 pt-24">
        <Outlet />
      </main>
      <MarketingFooter />
    </div>
  );
}