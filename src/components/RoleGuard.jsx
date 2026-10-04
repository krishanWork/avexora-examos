import React from "react";
import { Navigate, Outlet, useOutletContext } from "react-router-dom";
import useCurrentUser from "@/hooks/useCurrentUser";
import { getAppRoles } from "@/lib/roles";

// Blocks direct URL access to pages the user's roles aren't allowed to see.
//
// A union check, like can(): holding ANY role in the group admits the route. A
// teacher who is also an exam coordinator may reach both /teacher-portal and
// /dashboard, and a check on the primary role alone would 403 the second.
export default function RoleGuard({ roles }) {
  const ctx = useOutletContext();
  const { user, loading } = useCurrentUser();

  if (loading) return <div className="p-8 text-stone-400">Loading...</div>;

  if (!getAppRoles(user).some((role) => roles.includes(role))) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet context={ctx} />;
}