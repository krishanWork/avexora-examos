import React, { useCallback, useEffect, useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatCard from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/statusTokens";
import { useToast } from "@/components/ui/use-toast";
import { Handshake, Plus, Building2, Percent, Wallet, Banknote, Loader2, Info, BellRing, CalendarClock } from "lucide-react";
import moment from "moment";
import SellSubscriptionDialog from "@/components/affiliates/SellSubscriptionDialog";
import SubscriptionsPanel, { RenewalSummary } from "@/components/affiliates/SubscriptionsPanel";
import ReminderSettingsDialog from "@/components/affiliates/ReminderSettingsDialog";

const rupees = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value) || 0);

// The reseller's own console.
//
// Every figure here comes from the server's summary over the sale ledger — nothing
// is summed in the browser from a partially paginated list, so the balance shown
// cannot disagree with the ledger that produced it. The only local arithmetic is
// the read-only stat row.
export default function AffiliatePortal() {
  const { toast } = useToast();
  const [affiliate, setAffiliate] = useState(null);
  const [summary, setSummary] = useState({ sales_count: 0, earned: 0, approved: 0, paid: 0, payable: 0 });
  const [sales, setSales] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [reminderSettingsOpen, setReminderSettingsOpen] = useState(false);

  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, planRes] = await Promise.all([
        appClient.affiliate.mySummary(),
        appClient.entities.SubscriptionPlan.list("-created_date"),
      ]);
      if (seq !== requestSeq.current) return;
      setAffiliate(summaryRes.affiliate || null);
      setSummary(summaryRes.summary || { sales_count: 0, earned: 0, approved: 0, paid: 0, payable: 0 });
      setSales(summaryRes.sales || []);
      setSubscriptions(summaryRes.subscriptions || []);
      setPlans(Array.isArray(planRes) ? planRes : []);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err);
      toast({
        title: "Failed to load your earnings",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    {
      key: "created_date",
      header: "Date",
      className: "whitespace-nowrap text-stone-500",
      cell: (row) => moment(row.created_date).format("DD MMM, HH:mm"),
    },
    {
      key: "tenant_name",
      header: "Institution",
      className: "font-medium text-stone-900",
      cell: (row) => (
        <div>
          <div>{row.tenant_name}</div>
          <div className="text-xs font-normal text-stone-400 font-mono">{row.tenant_subdomain}.avexora.in</div>
        </div>
      ),
    },
    {
      key: "plan_name",
      header: "Plan",
      className: "text-stone-600",
      cell: (row) => row.plan_name || "—",
    },
    {
      key: "amount",
      header: "Sale",
      className: "text-stone-600",
      cell: (row) => <span className="font-mono text-xs">₹{rupees(row.amount)}</span>,
    },
    {
      key: "commission_rate",
      header: "Rate",
      className: "text-stone-400",
      cell: (row) => <span className="font-mono text-xs">{row.commission_rate}%</span>,
    },
    {
      key: "commission_amount",
      header: "Commission",
      className: "text-emerald-700 font-medium",
      cell: (row) => <span className="font-mono text-xs">₹{rupees(row.commission_amount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} type="affiliateSale" />,
    },
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <PageHeader
        title={affiliate?.full_name ? `Welcome, ${affiliate.full_name.split(" ")[0]}` : "Affiliate Portal"}
        description="Sell ExamOS subscriptions to schools and track your commission."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setReminderSettingsOpen(true)} disabled={loading}>
              <BellRing className="w-4 h-4 mr-2" /> Reminder Settings
            </Button>
            <Button onClick={() => setSellOpen(true)} disabled={loading}>
              <Plus className="w-4 h-4 mr-2" /> Sell a Subscription
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="p-6 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-between">
          <p className="text-sm">{error.message || "Could not load your affiliate account."}</p>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-stone-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {affiliate?.code && (
            <div className="mb-4 flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs uppercase px-2.5 py-1">
                Referral Code: {affiliate.code}
              </Badge>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Your Rate" value={`${affiliate?.commission_rate ?? 0}%`} icon={Percent} accent="text-indigo-600" />
            <StatCard label="Total Earned" value={`₹${rupees(summary.earned)}`} icon={Wallet} accent="text-stone-600" />
            <StatCard label="Payable Now" value={`₹${rupees(summary.payable)}`} icon={Banknote} accent="text-amber-600" />
            <StatCard label="Institutions Sold" value={summary.sales_count} icon={Building2} accent="text-emerald-600" />
          </div>

          <div className="mb-6 p-3.5 bg-stone-50 border border-stone-200 rounded-xl flex items-start gap-2.5 text-xs text-stone-600">
            <Info className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
            <p>
              Commission is credited as soon as a sale is created. <span className="font-medium text-stone-800">Payable Now</span>{" "}
              counts what the platform has approved but not yet paid out — approved sales awaiting transfer.
              Collect the subscription from the school directly; this app records sales and commission, it does
              not charge anyone.
            </p>
          </div>

          <h2 className="text-sm font-semibold text-stone-900 mb-3 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-stone-400" /> Subscriptions & Renewals
          </h2>

          <RenewalSummary subscriptions={subscriptions} />

          <SubscriptionsPanel
            affiliateId={affiliate?.id}
            subscriptions={subscriptions}
            loading={loading}
            onRefresh={load}
            settings={affiliate}
            emptyMessage="No subscriptions yet. Use “Sell a Subscription” to create your first institution."
          />

          <p className="mt-3 mb-8 text-[11px] text-stone-400">
            Each institution renews every month. Record a renewal once the school has paid; reminders are sent on
            the schedule you set in Reminder Settings, or immediately with “Remind”.
          </p>

          <h2 className="text-sm font-semibold text-stone-900 mb-3 flex items-center gap-2">
            <Handshake className="w-4 h-4 text-stone-400" /> Your Sales
          </h2>

          <DataTable
            columns={columns}
            data={sales}
            loading={loading}
            error={null}
            onRetry={load}
            emptyMessage="No sales yet. Use “Sell a Subscription” to create your first institution."
            emptyIcon={Building2}
          />

          {sales.length >= 200 && (
            <p className="mt-3 text-[11px] text-stone-400">
              Showing your 200 most recent sales. Contact the platform for a full statement.
            </p>
          )}
        </>
      )}

      {affiliate && (
        <>
          <SellSubscriptionDialog
            open={sellOpen}
            onOpenChange={setSellOpen}
            plans={plans}
            rate={affiliate.commission_rate}
            onSold={load}
          />
          <ReminderSettingsDialog
            open={reminderSettingsOpen}
            onOpenChange={setReminderSettingsOpen}
            affiliateId={affiliate.id}
            affiliate={affiliate}
            onSaved={load}
          />
        </>
      )}
    </div>
  );
}