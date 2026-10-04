import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatCard from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Handshake, Plus, Search, Users, UserCheck, TrendingUp, Wallet, Loader2, CalendarClock } from "lucide-react";
import { StatusBadge } from "@/lib/statusTokens";
import AddAffiliateDialog from "@/components/affiliates/AddAffiliateDialog";
import AffiliateDetailDrawer from "@/components/affiliates/AffiliateDetailDrawer";

const PAGE_SIZE = 20;
const rupees = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value) || 0);

// Commission arithmetic, mirroring server/affiliate-commission.js.
//
// Duplicated rather than imported because the server module is not reachable from
// the browser bundle, and the alternative — an endpoint that rounds a preview — is
// worse: the figure the affiliate sees before committing to a sale would come from
// a different function than the one that writes the sale, and they would drift.
// Both are covered by server/test/affiliate-commission.test.mjs.
const previewCommission = (amount, rate) => {
  const value = Number(amount);
  const percent = Number(rate);
  if (!Number.isFinite(value) || value < 0) return 0;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return 0;
  return Math.round(value * percent) / 100;
};

export default function Affiliates() {
  const { toast } = useToast();
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({
    total: 0, active: 0, sales_this_month: 0, payable: 0, subscriptions: 0, overdue: 0, due_this_week: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  // The rate editor commits on blur/Enter rather than on every keystroke: each save
  // is an audited, money-affecting write, and firing one per character would post
  // "20" then "2" then "25" and briefly set a live reseller's rate to 2%.
  const [rateDraft, setRateDraft] = useState({});
  const [savingRateId, setSavingRateId] = useState(null);
  const [rateConfirm, setRateConfirm] = useState(null);

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
      const res = await appClient.affiliate.list({ search: debouncedSearch, status, page, pageSize: PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      setData(res.data || []);
      setTotal(res.total || 0);
      setStats(res.stats || { total: 0, active: 0, sales_this_month: 0, payable: 0 });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err);
      toast({ title: "Failed to load affiliates", description: "Please try again.", variant: "destructive" });
      console.error(err);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [debouncedSearch, status, page, toast]);

  useEffect(() => { load(); }, [load]);

  const refreshRow = (id, patch) => setData((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const saveRate = async (affiliate, rate) => {
    setSavingRateId(affiliate.id);
    try {
      const res = await appClient.affiliate.update(affiliate.id, { commission_rate: rate });
      const updated = res.affiliate || {};
      refreshRow(affiliate.id, { commission_rate: updated.commission_rate ?? rate });
      toast({
        title: "Commission rate updated",
        description: `${affiliate.email} now earns ${rate}% on future sales. Sales already made keep the rate they were sold at.`,
      });
      setRateDraft((d) => { const next = { ...d }; delete next[affiliate.id]; return next; });
    } catch (err) {
      toast({ title: "Failed to update rate", description: err.message, variant: "destructive" });
      // Reset the draft so the field does not keep displaying a value the server
      // rejected — a stale rate on screen is worse than an obvious empty field.
      setRateDraft((d) => { const next = { ...d }; delete next[affiliate.id]; return next; });
    } finally {
      setSavingRateId(null);
    }
  };

  const commitRate = (affiliate, raw) => {
    const rate = Number(raw);
    if (!String(raw).trim() || !Number.isInteger(rate) || rate < 0 || rate > 100) {
      toast({ title: "Invalid rate", description: "Enter a whole number between 0 and 100.", variant: "destructive" });
      setRateDraft((d) => { const next = { ...d }; delete next[affiliate.id]; return next; });
      return;
    }
    if (rate === affiliate.commission_rate) {
      setRateDraft((d) => { const next = { ...d }; delete next[affiliate.id]; return next; });
      return;
    }
    // Confirm a change that moves money. Sales already made are unaffected, so this
    // is about the reseller agreeing to a different ongoing deal — worth a deliberate
    // step rather than a stray blur.
    if (affiliate.sales_count > 0) {
      setRateConfirm({ affiliate, rate });
      return;
    }
    saveRate(affiliate, rate);
  };

  const setAffiliateStatus = async (affiliate, value) => {
    try {
      await appClient.affiliate.update(affiliate.id, { status: value });
      refreshRow(affiliate.id, { status: value });
      toast({
        title: value === "active" ? "Affiliate reactivated" : "Affiliate suspended",
        description:
          value === "active"
            ? `${affiliate.email} can sell again.`
            : `${affiliate.email} can no longer create institutions. Their existing sales are untouched.`,
      });
    } catch (err) {
      toast({ title: "Failed to change status", description: err.message, variant: "destructive" });
    }
  };

  const columns = useMemo(
    () => [
      {
        key: "full_name",
        header: "Affiliate",
        className: "font-medium text-stone-900",
        cell: (row) => (
          <button type="button" onClick={() => setSelected(row)} className="text-left hover:text-indigo-600 hover:underline">
            <div>{row.full_name || "—"}</div>
            <div className="text-xs font-normal text-stone-500">{row.email}</div>
          </button>
        ),
      },
      {
        key: "code",
        header: "Code",
        cell: (row) =>
          row.code ? (
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {row.code}
            </Badge>
          ) : (
            <span className="text-xs text-stone-400">—</span>
          ),
      },
      {
        key: "commission_rate",
        header: "Rate",
        cell: (row) => {
          const draft = rateDraft[row.id];
          return (
            <div className="flex items-center gap-1.5">
              <div className="relative w-20">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  className="h-8 pr-7 text-xs"
                  value={draft !== undefined ? draft : row.commission_rate ?? 0}
                  disabled={savingRateId === row.id}
                  onChange={(e) => setRateDraft({ ...rateDraft, [row.id]: e.target.value })}
                  onBlur={(e) => commitRate(row, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRateDraft((d) => { const next = { ...d }; delete next[row.id]; return next; });
                  }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-stone-400">%</span>
              </div>
              {savingRateId === row.id && <Loader2 className="w-3.5 h-3.5 text-stone-400 animate-spin" />}
            </div>
          );
        },
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => (
          <Select value={row.status || "active"} onValueChange={(v) => setAffiliateStatus(row, v)}>
            <SelectTrigger className="w-36 h-8">
              <StatusBadge status={row.status || "active"} type="affiliate" showDot={false} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        key: "sales_count",
        header: "Sales",
        className: "text-stone-600",
        cell: (row) => <span className="font-mono text-xs">{row.sales_count ?? 0}</span>,
      },
      {
        key: "earned",
        header: "Earned",
        className: "text-stone-600",
        cell: (row) => <span className="font-mono text-xs">₹{rupees(row.earned)}</span>,
      },
      {
        key: "approved",
        header: "Payable",
        className: "text-amber-700",
        cell: (row) => <span className="font-mono text-xs font-medium">₹{rupees(row.approved)}</span>,
      },
      {
        key: "commission_mode",
        header: "On Renewal",
        cell: (row) =>
          row.commission_mode === "recurring" ? (
            <Badge className="bg-indigo-100 text-indigo-700" title="A new commission is booked every time this affiliate's institution renews">
              Recurring
            </Badge>
          ) : (
            <Badge variant="outline" className="text-stone-500" title="Paid once, on the subscription they originally sold">
              One time
            </Badge>
          ),
      },
      {
        key: "paid",
        header: "Paid",
        className: "text-emerald-700",
        cell: (row) => <span className="font-mono text-xs">₹{rupees(row.paid)}</span>,
      },
    ],
    [rateDraft, savingRateId]
  );

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Affiliates"
        description="Resellers who introduce institutions to the platform and earn a commission on each subscription they sell."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Affiliate
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Affiliates" value={stats.total} icon={Users} accent="text-stone-600" />
        <StatCard label="Active" value={stats.active} icon={UserCheck} accent="text-emerald-600" />
        <StatCard label="Sales This Month" value={stats.sales_this_month} icon={TrendingUp} accent="text-indigo-600" />
        <StatCard label="Commission Payable" value={`₹${rupees(stats.payable)}`} icon={Wallet} accent="text-amber-600" />
      </div>

      {/* Renewal health across every affiliate's institutions. Counts come from the
          server's own derivation of each subscription's next_due_at, so these agree
          with the per-affiliate lists behind the drawer. */}
      <div className="flex flex-wrap items-center gap-2 mb-5 text-xs">
        <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
          <CalendarClock className="w-3.5 h-3.5 text-stone-400" /> {stats.subscriptions ?? 0} active subscriptions
        </Badge>
        {(stats.due_this_week ?? 0) > 0 && (
          <Badge className="bg-amber-100 text-amber-700 gap-1.5 px-2.5 py-1">
            <CalendarClock className="w-3.5 h-3.5" /> {stats.due_this_week} due within 7 days
          </Badge>
        )}
        {(stats.overdue ?? 0) > 0 && (
          <Badge className="bg-rose-100 text-rose-700 gap-1.5 px-2.5 py-1">
            <CalendarClock className="w-3.5 h-3.5" /> {stats.overdue} overdue
          </Badge>
        )}
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="relative flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            className="pl-9"
            placeholder="Search by name, email or code..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-40"><span>{status === "" ? "All Statuses" : status === "active" ? "Active" : "Suspended"}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        error={error}
        onRetry={load}
        emptyMessage="No affiliates yet."
        emptyIcon={Handshake}
        pagination={{ page, totalItems: total, pageSize: PAGE_SIZE, onPageChange: setPage }}
      />

      <p className="mt-4 text-[11px] text-stone-400 leading-relaxed">
        Money is collected offline by the affiliate. When they sell, commission is credited to their balance
        immediately but stays payable only once you approve it; marking it paid records the transfer.
        Changing a rate affects future sales only — each sale keeps the rate it was sold at.
      </p>

      <AddAffiliateDialog open={addOpen} onOpenChange={setAddOpen} onCreated={load} />
      {selected && (
        <AffiliateDetailDrawer
          affiliate={selected}
          open={Boolean(selected)}
          onOpenChange={(next) => !next && setSelected(null)}
          onChanged={load}
        />
      )}

      <Dialog open={Boolean(rateConfirm)} onOpenChange={(next) => !next && setRateConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change commission rate?</DialogTitle>
            <DialogDescription>
              {rateConfirm?.affiliate?.email} will earn {rateConfirm?.rate}% instead of{" "}
              {rateConfirm?.affiliate?.commission_rate}% on future sales. Their{" "}
              {rateConfirm?.affiliate?.sales_count} existing{" "}
              {rateConfirm?.affiliate?.sales_count === 1 ? "sale keeps" : "sales keep"} the rate they were sold at.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const { affiliate, rate } = rateConfirm;
                setRateConfirm(null);
                saveRate(affiliate, rate);
              }}
            >
              Update Rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}