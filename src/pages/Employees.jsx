import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { getAppRoles, hasAnyRole, roleLabels, ROLE_LABELS, APP_ROLES } from "@/lib/roles";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserCog, UserPlus, Building2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

export default function Employees() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Institution assignment. This list is the employee's entire tenant boundary,
  // so it is fetched per account through the dedicated audited endpoint rather
  // than read off the User list — the server strips it from that projection.
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignments, setAssignments] = useState({});
  const [selected, setSelected] = useState([]);
  const [allTenants, setAllTenants] = useState([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);

  // The platform family is exactly these two roles, so a checkbox pair expresses
  // every legal set: super_admin, employee, or both. A single-select dropdown
  // could not offer the combination the server permits and that matters most --
  // an operator who is both the platform owner and a support reader, who needs
  // the owner's powers AND the institution scoping a support account is given.
  const PLATFORM_SET_ROLES = [APP_ROLES.SUPER_ADMIN, APP_ROLES.EMPLOYEE];

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await appClient.entities.User.list("-created_date");
      // Union, not "is the primary role". A platform account whose primary is
      // super_admin but who also holds employee still belongs on this page and
      // still has an institution boundary to assign. The empty-set arm keeps
      // never-provisioned accounts visible, so they can be given a role here
      // instead of being invisible and unfixable.
      const employees = all.filter(
        (u) => hasAnyRole(u, PLATFORM_SET_ROLES) || getAppRoles(u).length === 0
      );
      setUsers(employees);

      const employeeIds = employees.filter((u) => hasAnyRole(u, [APP_ROLES.EMPLOYEE])).map((u) => u.id);
      const found = await Promise.all(
        employeeIds.map(async (id) => {
          try {
            const r = await appClient.users.getAssignedTenants(id);
            return [id, r?.assigned_tenant_ids || []];
          } catch {
            // A single failed lookup must not blank the table for the rest.
            return [id, []];
          }
        })
      );
      setAssignments(Object.fromEntries(found));

      const tenants = await appClient.entities.Tenant.list("name");
      setAllTenants(Array.isArray(tenants) ? tenants.filter((t) => !t.status || t.status === "active") : []);
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load employees", description: "Please try again.", variant: "destructive" });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    await appClient.users.inviteUser(inviteEmail, "employee");
    await logAudit({ user, action: "invite", entity_type: "User", details: inviteEmail });
    toast({ title: "Invitation sent", description: `${inviteEmail} has been invited. Assign their role once they join.` });
    setInviteEmail("");
  };

  // The whole SET is submitted, not the one role that was toggled. The server
  // writes `app_roles` canonically and mirrors the primary into `app_role` in the
  // same update, and it owns `tenant_id` for a platform account (null), so the
  // client no longer sends a tenant field it used to blank by hand.
  const saveRoles = async (u, roles) => {
    // An account with no role at all cannot be produced by an edit: that is the
    // "Unassigned" state the table renders, and it is reached by removing the last
    // role, not by submitting a blank set.
    if (roles.length === 0) {
      toast({
        title: "Keep at least one role",
        description: `${u.email || "This account"} must hold at least one platform role.`,
        variant: "destructive",
      });
      return;
    }
    // Read BEFORE the reload, since `u` is the pre-update row.
    const hadEmployee = getAppRoles(u).includes(APP_ROLES.EMPLOYEE);
    await appClient.entities.User.update(u.id, { app_roles: roles });
    await logAudit({
      user,
      action: "assign_role",
      entity_type: "User",
      entity_id: u.id,
      details: roles.join(", "),
    });
    const keepsEmployee = roles.includes(APP_ROLES.EMPLOYEE);

    // Promoting someone to employee grants no institution access by itself -- the
    // assignment list is empty, and empty means the account can read nothing.
    // Opening the dialog here is the difference between an operator who believes
    // they just onboarded a support account and one who silently created a
    // locked-out login.
    if (keepsEmployee && !hadEmployee) {
      toast({
        title: "Employee role set",
        description: "Now choose the institutions they can access. Until you do, they can read nothing.",
      });
      setAssignTarget({ ...u, app_roles: roles, app_role: roles[0] });
      setSelected(assignments[u.id] || []);
      setAssignOpen(true);
    } else if (!keepsEmployee && hadEmployee) {
      // The assignment list is deliberately left in place rather than destroyed:
      // re-adding employee restores the previous boundary instead of silently
      // reducing the account to reading nothing.
      toast({
        title: "Employee role removed",
        description: "Their institution assignments are kept, but grant nothing until the employee role is restored.",
      });
    } else {
      toast({
        title: "Roles updated",
        description: `${u.full_name || u.email} is now ${roleLabels({ app_roles: roles }).join(", ")}.`,
      });
    }
    load();
  };

  const togglePlatformRole = (u, role) => {
    const held = getAppRoles(u);
    const next = held.includes(role) ? held.filter((r) => r !== role) : [...held, role];
    return saveRoles(u, next);
  };

  const openAssignments = (u) => {
    setAssignTarget(u);
    setSelected(assignments[u.id] || []);
    setAssignOpen(true);
  };

  const toggleAssignment = (tenantId) =>
    setSelected((prev) => (prev.includes(tenantId) ? prev.filter((t) => t !== tenantId) : [...prev, tenantId]));

  const saveAssignments = async () => {
    if (!assignTarget) return;
    setAssignSaving(true);
    try {
      await appClient.users.setAssignedTenants(assignTarget.id, selected);
      // The server audits this change itself; the client log is only for the
      // surrounding UI affordance, so it must not claim to be the record.
      toast({
        title: "Institutions assigned",
        description: selected.length
          ? `${assignTarget.email} can now read ${selected.length} institution${selected.length === 1 ? "" : "s"}.`
          : `${assignTarget.email} now has no institutions and can read no tenant data.`,
      });
      setAssignOpen(false);
      load();
    } catch (err) {
      toast({ title: "Failed to save assignments", description: err.message, variant: "destructive" });
    } finally {
      setAssignSaving(false);
    }
  };

  const tenantName = (id) => allTenants.find((t) => t.id === id)?.name || id;

  const columns = [
    { key: "full_name", header: "Name", cell: (row) => row.full_name || "-" },
    { key: "email", header: "Email" },
    {
      key: "app_roles",
      header: "Roles",
      // Every held role, not just the primary: the whole point of an account
      // holding two is that both are visible here. Each badge carries the
      // canonical name as its title, so a role added later reads correctly
      // without this cell being edited.
      cell: (row) => {
        const held = getAppRoles(row);
        if (held.length === 0) return <Badge variant="secondary" className="text-xs">Unassigned</Badge>;
        return (
          <div className="flex flex-wrap gap-1">
            {held.map((r) => (
              <Badge
                key={r}
                variant="outline"
                title={r}
                className="bg-stone-50 text-stone-700 border-stone-200 font-mono text-xs uppercase"
              >
                {ROLE_LABELS[r] || r}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: "assignments",
      header: "Institutions",
      // Meaningful whenever the account HOLDS employee, including one that also
      // holds super_admin: the employee role is what the boundary belongs to.
      cell: (row) => {
        if (!hasAnyRole(row, [APP_ROLES.EMPLOYEE])) return <span className="text-xs text-stone-400">n/a</span>;
        const ids = assignments[row.id] || [];
        if (ids.length === 0) {
          return (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 text-xs">
              None — can read no tenant data
            </Badge>
          );
        }
        return (
          <span className="text-xs text-stone-600">
            {ids.length === 1 ? tenantName(ids[0]) : `${ids.length} assigned`}
          </span>
        );
      },
    },
    {
      key: "assign",
      header: "Assign",
      cell: (row) => {
        const held = getAppRoles(row);
        return (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {PLATFORM_SET_ROLES.map((r) => {
                const on = held.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePlatformRole(row, r)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
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
            {held.includes(APP_ROLES.EMPLOYEE) && (
              <Button size="sm" variant="outline" className="h-9 px-3 self-start" onClick={() => openAssignments(row)}>
                <Building2 className="w-3.5 h-3.5 mr-1.5" /> Institutions
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Platform Employees"
        description="Invite and manage Avexora staff. An employee's assigned institutions are the full extent of what they can read."
      />

      <div className="bg-white rounded-xl border border-stone-200 p-5 mb-6 flex items-end gap-3">
        <div className="flex-1">
          <label className="text-sm font-medium text-stone-600">Invite by Email</label>
          <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="employee@avexora.ai" />
        </div>
        <Button onClick={handleInvite} disabled={!inviteEmail}>
          <UserPlus className="w-4 h-4 mr-2" /> Send Invite
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No platform staff yet"
        emptyIcon={UserCog}
        pagination={{ page, totalItems: users.length, pageSize: PAGE_SIZE, onPageChange: setPage }}
      />

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Institutions for {assignTarget?.email}</DialogTitle>
            <DialogDescription>
              This list is the employee's entire tenant boundary. They can read these institutions and
              nothing else, and removing one takes effect on their next request. With none selected they
              can read no tenant data at all.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 overflow-y-auto space-y-1 py-2">
            {allTenants.length === 0 && (
              <p className="text-sm text-stone-500 py-4 text-center">No active institutions available.</p>
            )}
            {allTenants.map((t) => {
              const on = selected.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleAssignment(t.id)}
                  aria-pressed={on}
                  className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    on
                      ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                      : "border-stone-200 bg-white hover:bg-stone-50"
                  }`}
                >
                  <span className="font-medium truncate">{t.name}</span>
                  <span className="text-xs text-stone-500 font-mono shrink-0">{t.subdomain || t.id}</span>
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignSaving}>
              Cancel
            </Button>
            <Button onClick={saveAssignments} disabled={assignSaving}>
              {assignSaving ? "Saving…" : `Save ${selected.length ? `${selected.length} institution${selected.length === 1 ? "" : "s"}` : "empty list"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
