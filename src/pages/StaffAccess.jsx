import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { getAppRoles, hasAnyRole, roleLabels, ROLE_LABELS, APP_ROLES } from "@/lib/roles";
import { getImpersonation } from "@/lib/impersonation";
import { UserCog, Loader2, UserPlus, Lock } from "lucide-react";

// The roles this admin may create come from the server (manageStaff list returns
// `creatable_roles`, derived from PROVISIONING_HIERARCHY). This page used to hold
// its own copy of that map, which had drifted: it omitted exam_coordinator from
// every parent's list and offered exam_coordinator only the family roles. The
// policy now has exactly one definition, on the server.
//
// A member's HELD roles are merged into the options when they are not already
// offerable, so a role this admin may not newly grant — but which the account
// already carries — still reads as real instead of rendering an empty control.
// Precedence-sorted, so a held role appears ahead of the offerable ones rather
// than in arbitrary set order.
//
// The argument is `assignable_roles`, not `creatable_roles`: this edits an
// account that already exists, which is a different policy question from the
// create form above. For most rows the two agree; they differ on school_admin,
// where a school_admin may add it here but the create form never offers it.
const withCurrentRoles = (allowed, current) => {
  const held = getAppRoles({ app_roles: current });
  const missing = held.filter((r) => !allowed.includes(r));
  return missing.length ? [...missing, ...allowed] : allowed;
};

// A role cannot be removed if it is not there to begin with, and the server
// refuses an empty set, so the LAST held role is locked rather than letting the
// admin uncheck the only role and bounce off a 400.
const lastHeldRole = (held) => held.length === 1;

export default function StaffAccess() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const [staff, setStaff] = useState([]);
  // Starts true because a school_admin and an impersonated session both load
  // immediately. A platform owner who has not chosen an institution never loads at
  // all, and the effect below clears this rather than leaving a permanent spinner.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Direct Account Creation Form State
  // Server-authoritative. Empty until manageStaff list resolves, and never
  // defaulted: the previous hardcoded map keyed off `user?.app_role ||
  // "school_admin"`, which handed a school_admin's role options to an account
  // that had no role at all.
  const [allowedRoles, setAllowedRoles] = useState([]);

  // The roles this admin may PUT ON AN EXISTING ACCOUNT — deliberately a
  // different list from `allowedRoles` above. The server derives the two from
  // different delegation matrices:
  //
  //   creatable_roles   minting a new account. principal, exam_coordinator,
  //                    teacher. Never school_admin, for anyone.
  //   assignable_roles  re-labelling an account that already exists. The same
  //                    three, PLUS school_admin for a school_admin.
  //
  // One list for both would force a choice between letting a school appoint its
  // own co-administrator (which needs assignable_roles) and letting that same
  // administrator mint a brand-new admin login (which must stay a platform
  // action). The create dropdown and the table's checkbox row are authorized
  // independently, and neither keeps its own copy of the map here.
  const [assignableRoles, setAssignableRoles] = useState([]);

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formConfirmPassword, setFormConfirmPassword] = useState("");
  const [formRoles, setFormRoles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // Keep the selection inside what the server says this admin may create. The
  // intersection is what survives a reload under a different account or after a
  // hierarchy change; anything no longer offerable is dropped rather than left in
  // a state the server would reject.
  useEffect(() => {
    setFormRoles((prev) => {
      const next = prev.filter((r) => allowedRoles.includes(r));
      return next.length ? next : (allowedRoles.slice(0, 1));
    });
  }, [allowedRoles]);

  const toggleFormRole = (role) =>
    setFormRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  const load = async (tenantIdArg) => {
    setLoading(true);
    setError(null);
    try {
      const tenantId = tenantIdArg !== undefined ? tenantIdArg : selectedTenantId;
      const { data } = await appClient.functions.invoke("manageStaff", {
        action: "list",
        ...(tenantId ? { tenant_id: tenantId } : {}),
      });
      if (data?.error) throw new Error(data.error);
      setStaff(data.staff || []);
      setAllowedRoles(Array.isArray(data.creatable_roles) ? data.creatable_roles : []);
      setAssignableRoles(Array.isArray(data.assignable_roles) ? data.assignable_roles : []);
    } catch (e) {
      setError(e);
      toast({ title: "Could not load staff", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Reload whatever view is currently on screen. Every refresh goes through here
  // rather than calling load() directly, because a bare load() with no argument
  // falls back to selectedTenantId — which is empty for a platform owner who has
  // not chosen a school, and would fire exactly the unscoped request this page
  // must not send. The one caller that did this is changeRoles: change a role,
  // reload, and the table silently became every school's staff.
  const reload = () => {
    if (needsInstitution) {
      setStaff([]);
      setAllowedRoles([]);
      setAssignableRoles([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (isPlatformOwner) load(showAllInstitutions ? "" : selectedTenantId);
    else load();
  };

  // super_admin has no institution of its own, so it picks one to staff into.
  // A school_admin is already bound to its own tenant and gets no picker — the
  // server pins it there and would refuse anything else with 404.
  // Union: the platform owner is whoever HOLDS super_admin, not whoever has it as
  // their only role. A super_admin who is also a school_admin still has no
  // institution of its own to fall back on, so the picker and its scoping apply.
  const isPlatformOwner = hasAnyRole(user, [APP_ROLES.SUPER_ADMIN]);
  const [institutions, setInstitutions] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");

  // The cross-institution staff list is real and the platform owner is entitled to
  // it, but it is NOT the default: it is every school's staff on a screen about
  // staffing one school, which is exactly the confusion this page was fixed for.
  // So it is a deliberate, labelled choice that resets the instant a school is
  // picked, rather than the state the screen falls into.
  const [showAllInstitutions, setShowAllInstitutions] = useState(false);

  // "View as a school" is NOT this screen's picker. The overlay replaces the
  // session's roles, so `isPlatformOwner` is false while impersonating and there is
  // no picker to render — the server scope (X-View-As-Tenant) answers the list
  // instead. Reading the record here is what lets the page say WHICH school the
  // table below belongs to, which it otherwise could not: the response is scoped
  // but the reader has no other way to know the scope was applied.
  const viewingAs = getImpersonation();
  const [scopedTenantName, setScopedTenantName] = useState(null);
  useEffect(() => {
    if (!viewingAs?.tenant_id) {
      setScopedTenantName(null);
      return;
    }
    let cancelled = false;
    appClient.entities.Tenant
      .get(viewingAs.tenant_id)
      .then((t) => {
        if (!cancelled) setScopedTenantName(t?.name || null);
      })
      .catch(() => {
        if (!cancelled) setScopedTenantName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewingAs?.tenant_id]);

  // A platform owner with no institution chosen has nothing to list, and the
  // unscoped list is every school's staff — so NO request is sent and the table
  // shows its empty state. This also fixes a trap: `loading` starts true and was
  // only ever cleared inside load(), so a platform owner who had not yet picked a
  // institution spun forever and never saw the empty message that was already
  // written for exactly this case.
  const needsInstitution = isPlatformOwner && !selectedTenantId && !showAllInstitutions;

  useEffect(() => {
    if (!isPlatformOwner) return;
    let cancelled = false;
    appClient.entities.Tenant
      .list("name")
      .then((list) => {
        if (cancelled) return;
        // Only active institutions: provisionUser already refuses an inactive one
        // (400), so offering them would just produce an error the admin has to read.
        const active = (Array.isArray(list) ? list : []).filter((t) => !t.status || t.status === "active");
        setInstitutions(active);
        if (active.length === 1) setSelectedTenantId(active[0].id);
      })
      .catch(() => {
        if (!cancelled) setInstitutions([]);
      });
    return () => { cancelled = true; };
  }, [isPlatformOwner]);

  useEffect(() => {
    if (!isPlatformOwner) {
      load();
      return;
    }
    // No institution named and no deliberate request for the platform-wide list:
    // send nothing. The alternative is the original defect — an unscoped call
    // answers with the staff of EVERY school on a screen whose own empty message
    // says to pick one.
    if (selectedTenantId) load(selectedTenantId);
    else if (showAllInstitutions) load("");
    else {
      setStaff([]);
      setAllowedRoles([]);
      setAssignableRoles([]);
      setError(null);
      setLoading(false);
    }
  }, [isPlatformOwner, selectedTenantId, showAllInstitutions]);

  // The whole SET is sent, and through the `setRoles` action rather than
  // `setRole`. Both actions reach the same server-side assignUserRoles(), which is
  // the single place the delegation matrix, the role-family rule, the tenant
  // boundary and the audit trail are enforced; `setRoles` is the one that carries
  // a set.
  const changeRoles = async (member, roles) => {
    if (roles.length === 0) {
      toast({
        title: "Keep at least one role",
        description: "An account must hold at least one role.",
        variant: "destructive",
      });
      return;
    }
    const { data } = await appClient.functions.invoke("manageStaff", {
      action: "setRoles",
      user_id: member.id,
      app_roles: roles,
    });
    if (data?.error) {
      toast({ title: "Role change failed", description: data.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Roles updated",
      description: `${member.full_name || member.email} is now ${roleLabels({ app_roles: roles }).join(", ")}.`,
    });
    reload();
  };

  // Mirrors toggleFormRole, but relative to what the member already holds rather
  // than to a form selection. The options include roles this admin cannot newly
  // grant, so a toggle that would ADD one of those is sent anyway and refused by
  // the server with the real policy message — the checkbox stays put, and the
  // admin sees why.
  const toggleMemberRole = (member, role) => {
    const held = getAppRoles(member);
    const next = held.includes(role) ? held.filter((r) => r !== role) : [...held, role];
    return changeRoles(member, next);
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!formEmail.trim() || !formName.trim() || !formPassword) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    if (formRoles.length === 0) {
      toast({ title: "Please choose at least one role", variant: "destructive" });
      return;
    }
    if (isPlatformOwner && !selectedTenantId) {
      toast({ title: "Please choose an institution", description: "A super admin provisions staff into a named institution.", variant: "destructive" });
      return;
    }
    if (formPassword !== formConfirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (formPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      await appClient.users.provisionUser({
        full_name: formName.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim() || undefined,
        password: formPassword,
        // The SET, not one role. provisionUser normalizes `app_roles` and `role`
        // through the same validator, so this is the same policy under one name.
        app_roles: formRoles,
        // Only meaningful for a super admin, who has no institution of its own.
        // provisionUser rejects a cross-tenant value for a school_admin, and a
        // school_admin is bound to its own tenant regardless of what is sent.
        ...(isPlatformOwner ? { tenant_id: selectedTenantId } : {}),
      });

      toast({
        title: "Account Created Successfully",
        description: `${roleLabels({ app_roles: formRoles }).join(", ")} account for ${formEmail} is now active.`,
      });

      setFormName("");
      setFormEmail("");
      setFormPhone("");
      setFormPassword("");
      setFormConfirmPassword("");
      setFormRoles(allowedRoles.slice(0, 1));
      reload();
    } catch (err) {
      toast({ title: "Account creation failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // An account with no recognized role is locked out by the login gate, so the
  // server keeps it in this response rather than filtering it away — this table is
  // the only place an administrator can give it a role. Rendering it inline among
  // the staff would make the list lie about who works here, so it gets its own
  // group below instead.
  //
  // The test is the normalized role set, not the `app_role` mirror: the mirror is
  // rebuilt server-side from the canonical array, so an empty set here means "no
  // valid role" regardless of which field carried it. Students and parents never
  // appear at all — the server excludes family accounts from this response, since
  // they are managed on the Students and Parents pages.
  const assignedStaff = staff.filter((row) => getAppRoles(row).length > 0);
  const unassignedStaff = staff.filter((row) => getAppRoles(row).length === 0);

  const columns = [
    {
      key: "full_name",
      header: "Name",
      cell: (row) => (
        <>
          {row.full_name || "-"} {row.id === user?.id && <Badge variant="outline" className="ml-1 text-stone-400">You</Badge>}
        </>
      ),
    },
    { key: "email", header: "Email", className: "text-stone-500" },
    {
      key: "app_roles",
      header: "Roles",
      // A checkbox group rather than a select, because the cell now edits a SET.
      // A dropdown cannot represent "principal and exam coordinator" as a value
      // the user is choosing, only as the one they are replacing.
      cell: (row) => {
        const held = getAppRoles(row);
        const labels = roleLabels(row);
        // Your own row is a badge, not controls. The server already refuses a
        // self-demotion that would strand the account, and an editable control
        // here would only offer the admin a change that cannot be made.
        if (row.id === user?.id) {
          return (
            <div className="flex flex-wrap gap-1">
              {held.map((r) => (
                <Badge key={r} className="bg-indigo-100 text-indigo-700">
                  {ROLE_LABELS[r] || r}
                </Badge>
              ))}
              {held.length === 0 && <Badge variant="secondary">Unassigned</Badge>}
            </div>
          );
        }
        const options = withCurrentRoles(assignableRoles, held);
        // Precedence-sorted, so element 0 of any resulting set IS the primary role.
        // Computed per toggle rather than read off the current state, because the
        // question the tooltip answers is "what happens if I click this", not
        // "what is true now".
        const sorted = getAppRoles({ app_roles: options });
        const primaryNow = held[0];
        return (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {sorted.map((r) => {
                const on = held.includes(r);
                const locked = on && lastHeldRole(held);
                // The set as it would be after this toggle. Removing drops r,
                // adding keeps r, and either way the first element is the primary.
                const after = sorted.filter((x) => (on ? held.includes(x) : held.includes(x) || x === r));
                const movesPrimary = !locked && after[0] !== primaryNow;
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    title={
                      locked
                        ? "An account must keep at least one role"
                        : `${on ? "Remove" : "Add"} ${ROLE_LABELS[r] || r}` +
                          (movesPrimary
                            ? " — this becomes their primary role, which decides their portal and how far they can read"
                            : primaryNow === r
                              ? " — their primary role, which decides their portal and how far they can read"
                              : "")
                    }
                    onClick={() => toggleMemberRole(row, r)}
                    className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                        : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                    } ${locked ? "cursor-not-allowed opacity-70" : ""}`}
                  >
                    {ROLE_LABELS[r] || r}
                  </button>
                );
              })}
            </div>
            {held.length > 1 && (
              <span className="text-[11px] text-stone-500">
                Primary: {labels[0]} — decides their portal and how far they can read
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Staff & User Provisioning"
        description="Hierarchical account creation. Direct credentials provisioning with strict server-side authorization."
      />

      {isPlatformOwner && (
        <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
          <Label htmlFor="staff-institution">Institution *</Label>
          <Select
            value={selectedTenantId}
            // Picking a school always wins over the cross-institution view: the two
            // are alternatives, and leaving the "all" flag set would make the table
            // disagree with the picker the moment either changed.
            onValueChange={(v) => {
              setSelectedTenantId(v);
              setShowAllInstitutions(false);
            }}
            disabled={institutions.length === 0}
          >
            <SelectTrigger id="staff-institution" className="mt-2 max-w-md">
              <SelectValue
                placeholder={
                  institutions.length === 0
                    ? "No active institutions available"
                    : "Select an institution to staff"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {institutions.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-stone-500 mt-2">
            A super admin belongs to no institution, so it names the one it is staffing. Every account created
            here and every role changed below is scoped to this selection.
          </p>
          {/* Deliberate, not a default. The platform-wide list is entitled but
              misleading here, so it is one labelled click away and off again the
              moment a school is named. */}
          <button
            type="button"
            onClick={() => {
              setShowAllInstitutions((prev) => !prev);
              setSelectedTenantId("");
            }}
            className="mt-3 text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
          >
            {showAllInstitutions
              ? "Back to picking one institution"
              : `Show staff across all ${institutions.length} institutions instead`}
          </button>
        </div>
      )}

      {/* A scoped session has no picker — the overlay makes this viewer a
          school_admin — so without this the table below would be correctly scoped
          and completely unexplained. */}
      {!isPlatformOwner && viewingAs?.tenant_id && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-900">
          Viewing staff of{" "}
          <span className="font-semibold">{scopedTenantName || "the selected institution"}</span>. The
          list below is limited to this institution by the server.
        </div>
      )}

      {allowedRoles.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5 text-indigo-600" />
            <h3 className="font-heading font-semibold text-stone-900 text-lg">Create New Account</h3>
          </div>
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="staff-full-name">Full Name *</Label>
                <Input
                  id="staff-full-name"
                  placeholder="e.g. John Doe"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="staff-email">Login Email *</Label>
                <Input
                  id="staff-email"
                  type="email"
                  placeholder="user@school.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="staff-role">Role(s) *</Label>
                <div id="staff-role" className="flex flex-wrap gap-1.5">
                  {allowedRoles.map((r) => {
                    const on = formRoles.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleFormRole(r)}
                        className={`rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
                          on
                            ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                            : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                        }`}
                      >
                        {ROLE_LABELS[r] || r}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-stone-500 mt-1.5">
                  Hold more than one to combine duties. The widest role decides where the account
                  lands and what it can reach.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="staff-phone">Phone Number (Optional)</Label>
                <Input
                  id="staff-phone"
                  placeholder="+91 9876543210"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="staff-password">Password *</Label>
                <Input
                  id="staff-password"
                  type="password"
                  placeholder="Minimum 6 characters"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <Label htmlFor="staff-confirm-password">Confirm Password *</Label>
                <Input
                  id="staff-confirm-password"
                  type="password"
                  placeholder="Confirm password"
                  value={formConfirmPassword}
                  onChange={(e) => setFormConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                Create Account
              </Button>
            </div>
          </form>
        </div>
      )}

      <DataTable
        columns={columns}
        data={assignedStaff}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          needsInstitution
            ? "Choose an institution above to see and manage its staff."
            : unassignedStaff.length
              ? "No one holds a staff role yet. The accounts below need a role before they can sign in."
              : "No staff members yet. Create your first account above."
        }
        emptyIcon={UserCog}
      />

      {/* Only rendered when it would actually rescue someone. An institution with
          no role-less accounts has nothing to fix here, and an always-present
          "Unassigned" heading on a healthy school reads as an outstanding problem. */}
      {unassignedStaff.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-heading font-semibold text-stone-900 text-lg">Unassigned accounts</h3>
            <p className="text-sm text-stone-500 mt-1">
              These accounts belong to this institution but hold no role, so they are refused at the
              login gate. Give one a role above to let them sign in.
            </p>
          </div>
          <DataTable
            columns={columns}
            data={unassignedStaff}
            loading={loading}
            error={error}
            onRetry={reload}
            emptyMessage="No accounts are waiting for a role."
            emptyIcon={UserCog}
          />
        </div>
      )}
    </div>
  );
}
