import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { hasAnyRole, PLATFORM_ROLES } from "@/lib/roles";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import { ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import moment from "moment";

export default function AuditLogs() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Platform roles list the trail and let the server bound it: super_admin
      // unrestricted, employee to the institutions assigned to the account.
      // Tenant roles carry an institution of their own, so they scope the request.
      // Union, and deliberately over the FULL set rather than the primary role:
      // which query to run is a data-scope decision, and a platform reader's
      // assigned-tenant boundary is what bounds the unscoped read. This mirrors
      // canReadAuditLog() on the server, which admits either platform role.
      const isPlatformReader = hasAnyRole(user, PLATFORM_ROLES);
      const all = isPlatformReader
        ? await appClient.entities.AuditLog.list("-created_date", 200)
        : await appClient.entities.AuditLog.filter({ tenant_id: user?.tenant_id }, "-created_date", 200);
      setLogs(all);
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load audit logs", description: "Please try again.", variant: "destructive" });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const columns = [
    {
      key: "created_date",
      header: "When",
      className: "whitespace-nowrap",
      cell: (row) => moment(row.created_date).format("MMM D, YYYY h:mm A"),
    },
    {
      key: "actor",
      header: "Actor",
      cell: (row) => (
        <>
          {row.actor_name || row.user_email || "Unknown"}
          {row.actor_role ? <span className="text-xs text-stone-400"> ({row.actor_role})</span> : null}
        </>
      ),
    },
    {
      key: "action",
      header: "Action",
      className: "capitalize",
      cell: (row) => row.action?.replace(/_/g, " "),
    },
    { key: "entity_type", header: "Entity", className: "text-stone-500" },
    { key: "details", header: "Details", className: "text-stone-400" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader title="Audit Logs" description="Immutable record of privileged actions across the platform." />

      <DataTable
        columns={columns}
        data={logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No activity yet"
        emptyIcon={ShieldCheck}
        pagination={{ page, totalItems: logs.length, pageSize: PAGE_SIZE, onPageChange: setPage }}
      />
    </div>
  );
}
