import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/lib/statusTokens";
import { appClient } from "@/api/appClient";
import { useToast } from "@/components/ui/use-toast";
import moment from "moment";
import {
  Handshake,
  Loader2,
  CheckCircle2,
  Banknote,
  Building2,
  Mail,
  Phone,
  IndianRupee,
  BellRing,
  CalendarClock,
} from "lucide-react";
import SubscriptionsPanel, { RenewalSummary } from "./SubscriptionsPanel";
import ReminderSettingsDialog from "./ReminderSettingsDialog";

const PAGE_SIZE = 20;

const rupees = (value) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value) || 0);

// One reseller's ledger, with the two money actions.
//
// The Approve and Mark Paid buttons are the super admin's whole reason this drawer
// exists, so they are rendered from the row's own `status` rather than from local
// state: the button a sale offers is the one its server-side status permits, and the
// server refuses anything else regardless. An optimistic flip here would let the UI
// offer "Mark Paid" on a pending sale and 409 on click.
export default function AffiliateDetailDrawer({ affiliate, open, onOpenChange, onChanged }) {
  const { toast } = useToast();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busySaleId, setBusySaleId] = useState(null);
  const [payNote, setPayNote] = useState({});
  const [subscriptions, setSubscriptions] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [reminderSettingsOpen, setReminderSettingsOpen] = useState(false);

  // Subscriptions are loaded separately from the paginated sales ledger: the two lists
  // have different sizes and different pagination, and coupling them would mean the
  // renewal table could never be scrolled independently of the page of sales above it.
  const loadSubscriptions = useCallback(async () => {
    if (!affiliate?.id) return;
    setSubsLoading(true);
    try {
      const res = await appClient.affiliate.subscriptions(affiliate.id, { pageSize: 100 });
      setSubscriptions(res.data || []);
    } catch {
      // The renewal panel renders its own empty state; a failed subscription read must
      // not take the commission ledger — the reason this drawer exists — down with it.
      setSubscriptions([]);
    } finally {
      setSubsLoading(false);
    }
  }, [affiliate?.id]);

  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await appClient.affiliate.sales(affiliate.id, { page, pageSize: PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      setSales(res.data || []);
      setTotal(res.total || 0);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [affiliate?.id, page]);

  useEffect(() => {
    if (open && affiliate?.id) {
      load();
      loadSubscriptions();
    }
  }, [open, affiliate?.id, load, loadSubscriptions]);

  if (!affiliate) return null;

  const transition = async (sale, action) => {
    setBusySaleId(sale.id);
    try {
      if (action === "approve") {
        await appClient.affiliate.approve(affiliate.id, sale.id);
        toast({ title: "Commission approved", description: `₹${rupees(sale.commission_amount)} is now payable.` });
      } else {
        const note = payNote[sale.id]?.trim();
        await appClient.affiliate.markPaid(affiliate.id, sale.id, note);
        toast({ title: "Marked as paid", description: `₹${rupees(sale.commission_amount)} settled with ${affiliate.email}.` });
      }
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setBusySaleId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Handshake className="w-5 h-5 text-emerald-600" />
            {affiliate.full_name || affiliate.email}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <Mail className="w-3 h-3" /> {affiliate.email}
            </span>
            {affiliate.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" /> {affiliate.phone}
              </span>
            )}
            {affiliate.code && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {affiliate.code}
              </Badge>
            )}
            <StatusBadge status={affiliate.status} type="affiliate" />
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <p className="text-[11px] text-stone-500 font-medium">Rate</p>
              <p className="text-lg font-bold text-stone-900">{affiliate.commission_rate ?? 0}%</p>
            </div>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <p className="text-[11px] text-stone-500 font-medium">Sales</p>
              <p className="text-lg font-bold text-stone-900">{affiliate.sales_count ?? 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <p className="text-[11px] text-stone-500 font-medium">Earned</p>
              <p className="text-lg font-bold text-stone-900">₹{rupees(affiliate.earned)}</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-[11px] text-amber-700 font-medium">Payable</p>
              <p className="text-lg font-bold text-amber-900">
                ₹{rupees((affiliate.approved || 0))}
              </p>
            </div>
          </div>

          {affiliate.notes && (
            <p className="text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-lg p-3">
              {affiliate.notes}
            </p>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-stone-400" /> Subscriptions & Renewals
              </h3>
              <Button size="sm" variant="outline" onClick={() => setReminderSettingsOpen(true)}>
                <BellRing className="w-3.5 h-3.5 mr-1.5" /> Reminder Settings
              </Button>
            </div>

            <RenewalSummary subscriptions={subscriptions} />

            <SubscriptionsPanel
              affiliateId={affiliate.id}
              subscriptions={subscriptions}
              loading={subsLoading}
              onRefresh={() => { loadSubscriptions(); onChanged?.(); }}
              settings={affiliate}
              emptyMessage="No subscriptions yet."
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-stone-900 mb-2">Sales History</h3>

            {loading && (
              <div className="flex items-center justify-center py-10 text-stone-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}

            {!loading && error && (
              <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
                Failed to load sales.{" "}
                <button type="button" onClick={load} className="underline font-medium">
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && sales.length === 0 && (
              <div className="py-10 text-center">
                <Building2 className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                <p className="text-sm text-stone-500">No sales yet.</p>
                <p className="text-xs text-stone-400 mt-1">
                  Institutions this affiliate creates will appear here with their commission.
                </p>
              </div>
            )}

            {!loading && !error && sales.length > 0 && (
              <>
                <div className="space-y-2">
                  {sales.map((sale) => (
                    <div key={sale.id} className="p-3.5 rounded-xl border border-stone-200 bg-white space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-stone-900 truncate">{sale.tenant_name}</p>
                          <p className="text-[11px] text-stone-500 font-mono truncate">
                            {sale.tenant_subdomain}.avexora.in
                          </p>
                        </div>
                        <StatusBadge status={sale.status} type="affiliateSale" />
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-stone-400">Plan</p>
                          <p className="text-stone-700 font-medium truncate">{sale.plan_name || "—"}</p>
                        </div>
                        <div>
                          <p className="text-stone-400">Sale</p>
                          <p className="text-stone-700 font-medium">₹{rupees(sale.amount)}</p>
                        </div>
                        <div>
                          <p className="text-stone-400">Commission</p>
                          <p className="text-emerald-700 font-semibold">
                            ₹{rupees(sale.commission_amount)}
                            <span className="text-stone-400 font-normal"> @ {sale.commission_rate}%</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1">
                        <p className="text-[11px] text-stone-400">
                          {moment(sale.created_date).format("DD MMM YYYY, HH:mm")}
                          {sale.paid_date ? ` · paid ${moment(sale.paid_date).format("DD MMM")}` : ""}
                        </p>

                        <div className="flex items-center gap-1.5">
                          {sale.status === "pending" && (
                            <Button
                              size="sm"
                              className="h-8 px-3 text-xs"
                              disabled={busySaleId === sale.id}
                              onClick={() => transition(sale, "approve")}
                            >
                              {busySaleId === sale.id ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                              )}
                              Approve
                            </Button>
                          )}
                          {sale.status === "approved" && (
                            <>
                              <Input
                                value={payNote[sale.id] || ""}
                                onChange={(e) => setPayNote({ ...payNote, [sale.id]: e.target.value })}
                                placeholder="Payment note (optional)"
                                className="h-8 text-xs w-40"
                              />
                              <Button
                                size="sm"
                                className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
                                disabled={busySaleId === sale.id}
                                onClick={() => transition(sale, "pay")}
                              >
                                {busySaleId === sale.id ? (
                                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                ) : (
                                  <Banknote className="w-3.5 h-3.5 mr-1.5" />
                                )}
                                Mark Paid
                              </Button>
                            </>
                          )}
                          {sale.status === "paid" && sale.admin_note && (
                            <p className="text-[11px] text-stone-500 italic truncate max-w-[12rem]">
                              {sale.admin_note}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between mt-3 text-xs text-stone-500">
                    <span>
                      Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={page * PAGE_SIZE >= total}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <p className="text-[11px] text-stone-400 flex items-start gap-1.5 pt-1">
            <IndianRupee className="w-3 h-3 mt-0.5 shrink-0" />
            Money is collected offline. Approving a commission makes it payable; marking it paid records
            that the transfer was made. Both steps are written to the audit log.
          </p>
        </div>

        <ReminderSettingsDialog
          open={reminderSettingsOpen}
          onOpenChange={setReminderSettingsOpen}
          affiliateId={affiliate.id}
          affiliate={affiliate}
          onSaved={() => { loadSubscriptions(); onChanged?.(); }}
        />
      </SheetContent>
    </Sheet>
  );
}