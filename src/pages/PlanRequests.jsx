import React, { useCallback, useEffect, useRef, useState } from "react";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { ErrorCard } from "@/components/shared/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PlanChangeApprovalDialog from "@/components/billing/PlanChangeApprovalDialog";
import { cycleLabel } from "@/components/billing/PlanChangeRequestDialog";
import { ArrowRight, Inbox } from "lucide-react";

const formatDate = (iso) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-stone-100 text-stone-600",
};

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

// The approver queue for plan-change requests.
//
// Institutions cannot upgrade themselves — there is no payment gateway, and the
// Tenant billing fields are refused for any non-platform role — so every plan change
// lands here for an operator who has collected the amount offline. Approving writes
// a Payment and applies the new quotas server-side; this page only reads the queue
// and hands the decision to the dialog.
export default function PlanRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("pending");
  const [reviewing, setReviewing] = useState(null);
  // Out-of-order guard: a slow first page load must not overwrite the result of a
  // later reload triggered by a decision. Same pattern as AffiliatePortal.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      // PlanChangeRequest is in PLATFORM_COMMERCIAL_RECORDS, so this read stays
      // platform-wide even under a super_admin "view as" scope — the queue is
      // platform business, not one school's.
      const rows = await appClient.entities.PlanChangeRequest.list("-created_date");
      if (seq !== requestSeq.current) return;
      setRequests(rows);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      console.error("Failed to load plan change requests:", err);
      setError("Failed to load plan change requests. Please check your connection and retry.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = requests.filter((r) => r.status === tab);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Plan Change Requests"
        description="Institutions requesting a different subscription plan. Approving applies the new plan and quotas immediately and records the payment."
      />

      <div className="flex gap-1.5 mb-5 border-b border-stone-200">
        {TABS.map(({ key, label }) => {
          const count = requests.filter((r) => r.status === key).length;
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
                active
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300"
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`ml-1.5 text-xs ${active ? "text-indigo-600" : "text-stone-400"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorCard message={error} onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={tab === "pending" ? "No requests waiting" : `No ${tab} requests`}
          description={
            tab === "pending"
              ? "Plan change requests raised by institutions will appear here for approval."
              : "Nothing in this state yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((request) => (
            <div key={request.id} className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  <h3 className="font-heading font-semibold text-stone-900 text-sm truncate">
                    {request.tenant_name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5 text-sm text-stone-600 flex-wrap">
                    <span className="text-stone-500">{request.from_plan_name || "No plan"}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-stone-400" />
                    <span className="font-medium text-stone-900">{request.to_plan_name}</span>
                    <span className="text-xs text-stone-500">
                      ₹{(Number(request.to_plan_price) || 0).toLocaleString()}/
                      {cycleLabel(request.to_plan_billing_cycle)}
                    </span>
                  </div>
                </div>
                <Badge className={STATUS_BADGE[request.status] || STATUS_BADGE.cancelled}>
                  {request.status}
                </Badge>
              </div>

              {request.reason && (
                <p className="text-sm text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 mb-3 leading-relaxed">
                  {request.reason}
                </p>
              )}

              <div className="flex items-center justify-between gap-4 text-xs text-stone-500">
                <span>
                  Requested {formatDate(request.requested_date)} by {request.requested_by_email}
                </span>
                {request.decided_date && (
                  <span>
                    {request.status === "cancelled" ? "Withdrawn" : "Decided"}{" "}
                    {formatDate(request.decided_date)} by {request.decided_by_email}
                  </span>
                )}
              </div>

              {request.decision_note && (
                <p className="text-xs text-stone-600 mt-2">
                  <span className="font-semibold">Note:</span> {request.decision_note}
                </p>
              )}

              {request.status === "pending" && (
                <div className="mt-4 pt-4 border-t border-stone-100">
                  <Button size="sm" onClick={() => setReviewing(request)}>
                    Review &amp; approve
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingCount > 0 && tab !== "pending" && (
        <p className="text-xs text-stone-500 mt-4 text-center">
          {pendingCount} request{pendingCount === 1 ? "" : "s"} awaiting a decision.
        </p>
      )}

      <PlanChangeApprovalDialog
        open={!!reviewing}
        onOpenChange={(next) => !next && setReviewing(null)}
        request={reviewing}
        onDecided={load}
      />
    </div>
  );
}
