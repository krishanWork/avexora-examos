import React, { useCallback, useEffect, useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatCard from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Inbox, Search, Settings, User, Users, Calendar } from "lucide-react";
import moment from "moment";
import LeadDetailsDialog from "@/components/leads/LeadDetailsDialog";
import LeadSettingsDialog from "@/components/leads/LeadSettingsDialog";
import { StatusBadge } from "@/lib/statusTokens";

const PAGE_SIZE = 20;

export default function LeadManagement() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({ total: 0, new: 0, demo: 0, contact: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await appClient.lead.list({ search: debouncedSearch, type, status, page, pageSize: PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      setData(res.data || []);
      setTotal(res.total || 0);
      setStats(res.stats || { total: 0, new: 0, demo: 0, contact: 0 });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err);
      toast({ title: "Failed to load leads", description: "Please try again.", variant: "destructive" });
      console.error(err);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [debouncedSearch, type, status, page, toast]);

  useEffect(() => { load(); }, [load]);

  const setLeadStatus = async (lead, value) => {
    try {
      await appClient.entities.Lead.update(lead.id, { status: value });
      setData((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: value } : l)));
      setStats((s) => ({ ...s, new: Math.max(0, s.new + (value === "new" ? 1 : lead.status === "new" ? -1 : 0)) }));
      load();
    } catch (err) {
      toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
    }
  };

  const columns = [
    {
      key: "created_date",
      header: "Received",
      className: "whitespace-nowrap text-stone-500",
      cell: (row) => moment(row.created_date).format("DD MMM, HH:mm"),
    },
    {
      key: "type",
      header: "Type",
      cell: (row) => <Badge variant="secondary">{row.type === "demo" ? "Demo" : "Contact"}</Badge>,
    },
    {
      key: "name",
      header: "Name",
      className: "font-medium text-stone-900",
      cell: (row) => (
        <button type="button" onClick={() => setSelected(row)} className="text-left hover:text-indigo-600 hover:underline">
          {row.name}
        </button>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      className: "text-stone-600",
      cell: (row) => (
        <>
          {row.email}
          {row.phone ? <div className="text-xs text-stone-400">{row.phone}</div> : null}
        </>
      ),
    },
    { key: "organization", header: "Organization", cell: (row) => row.organization || "—" },
    {
      key: "message",
      header: "Message",
      className: "max-w-xs",
      cell: (row) => <span className="text-stone-600 line-clamp-2">{row.message || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Select value={row.status} onValueChange={(v) => setLeadStatus(row, v)}>
          <SelectTrigger className="w-32"><StatusBadge status={row.status} type="lead" showDot={false} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Lead Management"
        description="Contact messages and demo requests from the public website."
        action={
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings className="w-4 h-4 mr-2" /> Settings
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Leads" value={stats.total} icon={Users} accent="text-stone-600" />
        <StatCard label="New Leads" value={stats.new} icon={Inbox} accent="text-indigo-600" />
        <StatCard label="Demo Requests" value={stats.demo} icon={Calendar} accent="text-violet-600" />
        <StatCard label="Contact Inquiries" value={stats.contact} icon={User} accent="text-emerald-600" />
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="relative flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            className="pl-9"
            placeholder="Search by name, email or organization..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Select value={type || "all"} onValueChange={(v) => { setType(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-40"><span>{type === "" ? "All Types" : type === "demo" ? "Demo" : "Contact"}</span></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="demo">Demo</SelectItem>
              <SelectItem value="contact">Contact</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-40"><span>{status === "" ? "All Statuses" : status}</span></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No leads received yet."
        emptyIcon={Inbox}
        pagination={{ page, totalItems: total, pageSize: PAGE_SIZE, onPageChange: setPage }}
      />

      {selected && (
        <LeadDetailsDialog
          lead={selected}
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
          onChanged={() => load()}
        />
      )}
      <LeadSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}