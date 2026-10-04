import React from "react";
import { useOutletContext, Navigate } from "react-router-dom";
import { rolePortal } from "@/lib/roles";
import NoAssignedRoleError from "@/components/NoAssignedRoleError";

export default function Home() {
  const { user } = useOutletContext() || {};
  if (!user) return <div className="p-8 text-stone-400">Loading...</div>;

  // An account with no role has no portal. Rendering a screen here is what
  // breaks the loop: redirecting to a role-gated route bounces back to /home,
  // and /home used to redirect straight back again.
  const portal = rolePortal(user);
  if (!portal) return <NoAssignedRoleError />;

  return <Navigate to={portal} replace />;
}