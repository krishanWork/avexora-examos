const KEY = "avexora_view_as";

export const getImpersonation = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
};

export const startImpersonation = (data) => {
  sessionStorage.setItem(KEY, JSON.stringify(data));
};

export const stopImpersonation = () => {
  sessionStorage.removeItem(KEY);
};

// Overlay the impersonated role/tenant/student on top of the real user.
//
// Gated on app_role, not the legacy `role` field. `role === "admin"` is only set
// on the env-bootstrapped admin account; every other super_admin created through
// staff provisioning has role "user", so checking `role` silently disabled
// impersonation for them — while `role` is itself untrusted input that the
// unaudited User PATCH path could set on any account.
//
// This overlay itself is still a RENDER concern: it decides what the React tree
// draws, nothing more. The SCOPE is carried separately, as an `X-View-As-Tenant`
// header that appClient attaches to every request (see viewAsHeaders() there), and
// the server narrows to it — which is what makes this banner honest. Before that
// header existed, the real super_admin JWT went out with the overlay applied, the
// server's readScope() short-circuited on platform(), and every page showed every
// institution while this banner named one. On /staff it was worst: the overlay
// hides super_admin from the platform-owner check, so no tenant was sent at all and
// the list came back unscoped.
//
// The server NARROWS on that header and never widens — a caller who omits it keeps
// the platform authority it already has. So this is still not a security boundary,
// and the token behind it is still a super_admin's.
export const applyImpersonation = (user) => {
  // Held as an EXACT role, not a union and not the primary role. Every other check
  // in the app answers "does the user hold a role that permits X", but this one
  // asks "is this the platform owner" — impersonation is a platform-owner power,
  // and an account that merely also holds super_admin alongside something else
  // should not silently gain the ability to view as any tenant. The session's
  // own role is read from the array first, falling back to the mirror so a
  // not-yet-backfilled account still works.
  const isPlatformOwner =
    (Array.isArray(user?.app_roles) && user.app_roles.length
      ? user.app_roles
      : [user?.app_role]
    ).includes("super_admin");
  if (!user || !isPlatformOwner) return user;
  const imp = getImpersonation();
  if (!imp) return user;
  // The impersonated view is always a single role: "view this school as its
  // exam coordinator" is one perspective at a time. Both fields are written so
  // getAppRole() and getAppRoles() agree with each other in the overlay.
  const impersonatedRoles = Array.isArray(imp.app_roles) && imp.app_roles.length
    ? imp.app_roles
    : [imp.app_role].filter(Boolean);
  return {
    ...user,
    app_role: impersonatedRoles[0] || null,
    app_roles: impersonatedRoles,
    tenant_id: imp.tenant_id,
    linked_student_id: imp.linked_student_id || null,
    ...(imp.email && { email: imp.email }),
    ...(imp.full_name && { full_name: imp.full_name }),
    _impersonation: imp,
  };
};