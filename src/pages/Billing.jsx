import React, { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { can } from "@/lib/permissions";
import PageHeader from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PlanChangeRequestDialog, { cycleLabel } from "@/components/billing/PlanChangeRequestDialog";
import { AlertTriangle, CalendarClock, Loader2, Sparkles, XCircle } from "lucide-react";

const formatDate = (iso) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

// OMR quota is per calendar month, so the bar compares against this month's sheets
// only. A "monthly limit" measured against all-time usage would show a school as
// permanently over quota after its first busy month.
const monthStart = () => {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
};

export default function Billing() {
  const { user, tenant } = useOutletContext();
  const [plan, setPlan] = useState(null);
  const [plans, setPlans] = useState([]);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [usage, setUsage] = useState({ students: 0, omrSheets: 0, exams: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError(null);
    // A tenant-less caller (a platform account that reached this route) has no
    // institution to bill. Returning here WITHOUT clearing `loading` is what made
    // this page spin forever for them.
    if (!tenant?.id) {
      setLoading(false);
      return;
    }
    try {
      const [planDoc, catalogue, requests] = await Promise.all([
        tenant?.subscription_plan_id
          ? appClient.entities.SubscriptionPlan.get(tenant.subscription_plan_id).catch(() => null)
          : Promise.resolve(null),
        appClient.entities.SubscriptionPlan.list().catch(() => []),
        appClient.entities.PlanChangeRequest.filter({ status: "pending" }).catch(() => []),
      ]);
      setPlan(planDoc);
      setPlans(catalogue);
      setPendingRequest(requests[0] || null);

      const [students, sheets, exams] = await Promise.all([
        appClient.entities.Student.filter({ tenant_id: tenant.id }),
        appClient.entities.OMRSheet.filter({ tenant_id: tenant.id }),
        appClient.entities.Examination.filter({ tenant_id: tenant.id })
      ]);
      setUsage({
        students: students.length,
        omrSheets: sheets.filter((s) => new Date(s.created_date) >= monthStart()).length,
        exams: exams.length,
      });
    } catch (err) {
      console.error("Failed to load billing usage:", err);
      setError("Failed to load billing details. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, tenant?.subscription_plan_id]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const canRequest = can(user, "submit_plan_change");

  const cancelRequest = async () => {
    if (!pendingRequest) return;
    setCancelling(true);
    try {
      const res = await appClient.functions.invoke("planUpgrade", {
        action: "cancel",
        request_id: pendingRequest.id,
      });
      if (res?.error) throw new Error(res.error);
      loadBilling();
    } catch (err) {
      setError(err.message || "Could not withdraw the request.");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-6">
        <PageHeader title="Billing & Subscription" description="Your institution's current plan and usage." />
        <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-6 animate-pulse">
          <div className="flex justify-between items-center">
            <div className="space-y-2">
              <div className="h-4 bg-stone-100 rounded w-24" />
              <div className="h-6 bg-stone-100 rounded w-36" />
            </div>
            <div className="h-6 bg-stone-100 rounded-full w-20" />
          </div>
          <div className="space-y-4">
            <div className="h-6 bg-stone-100 rounded w-full" />
            <div className="h-6 bg-stone-100 rounded w-full" />
            <div className="h-6 bg-stone-100 rounded w-full" />
          </div>
        </div>
      </div>
    );
  }

  // An over-limit bar used to clamp at 100% in the same indigo as a bar at 99%, so
  // the only signal a school had was reading the numbers. Colour plus a label makes
  // it a state rather than a figure to interpret.
  const UsageBar = ({ label, used, limit }) => {
    const over = Boolean(limit) && used > limit;
    const near = Boolean(limit) && !over && used >= limit * 0.8;
    return (
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-stone-600">{label}</span>
          <span className={over ? "text-red-600 font-medium" : "text-stone-500"}>
            {used} / {limit ?? "∞"}
          </span>
        </div>
        <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${over ? "bg-red-500" : near ? "bg-amber-500" : "bg-indigo-500"}`}
            style={{ width: `${Math.min(100, limit ? (used / limit) * 100 : 0)}%` }}
          />
        </div>
        {over && (
          <p className="text-xs text-red-600 mt-1">
            Over your plan's limit. {canRequest && "Request an upgrade to raise it."}
          </p>
        )}
      </div>
    );
  };

  const atLimit =
    plan &&
    [
      [usage.students, plan.student_limit],
      [usage.omrSheets, plan.omr_sheet_limit],
      [usage.exams, plan.exam_limit],
    ].some(([used, limit]) => Boolean(limit) && used > limit);

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <PageHeader title="Billing & Subscription" description="Your institution's current plan and usage." />
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          {error}
        </div>
      )}
      <div className="bg-white border border-stone-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5 gap-4">
          <div>
            <p className="text-sm text-stone-500">Current Plan</p>
            <h2 className="text-xl font-bold text-stone-900">{plan?.name || "No plan assigned"}</h2>
          </div>
          {plan && (
            <Badge className="bg-indigo-100 text-indigo-700">
              ₹{plan.price}/{cycleLabel(plan.billing_cycle)}
            </Badge>
          )}
        </div>

        {tenant?.subscription_period_end && (
          <div className="flex items-center gap-2 text-sm text-stone-600 mb-5 pb-5 border-b border-stone-100">
            <CalendarClock className="w-4 h-4 text-stone-400 shrink-0" />
            <span>
              Current period started {formatDate(tenant.subscription_period_start)} · renews by{" "}
              {formatDate(tenant.subscription_period_end)}
            </span>
          </div>
        )}

        {plan && (
          <>
            <UsageBar label="Students" used={usage.students} limit={plan.student_limit} />
            <UsageBar label="OMR Sheets (this month)" used={usage.omrSheets} limit={plan.omr_sheet_limit} />
            <UsageBar label="Examinations" used={usage.exams} limit={plan.exam_limit} />
          </>
        )}

        {pendingRequest ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-start gap-3">
              <Loader2 className="w-4 h-4 text-amber-600 mt-0.5 shrink-0 animate-spin" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  Upgrade to {pendingRequest.to_plan_name} is awaiting approval
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  Requested {formatDate(pendingRequest.requested_date)}. Your current plan stays
                  active until an administrator approves it and records your payment.
                </p>
              </div>
            </div>
            {canRequest && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={cancelRequest}
                disabled={cancelling}
              >
                {cancelling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                Withdraw request
              </Button>
            )}
          </div>
        ) : canRequest ? (
          <div className="mt-5 pt-5 border-t border-stone-100">
            <p className="text-sm text-stone-500 mb-3">
              {atLimit
                ? "You are over your plan's limit. Request a larger plan and an administrator will set it up."
                : "Need more students, OMR sheets or exam capacity? Request a different plan."}
            </p>
            <Button onClick={() => setRequestOpen(true)}>
              <Sparkles className="w-4 h-4 mr-2" />
              Change plan
            </Button>
          </div>
        ) : (
          <p className="text-sm text-stone-500 mt-4">
            To upgrade your plan or view invoices, contact your Avexora account manager.
          </p>
        )}
      </div>

      {canRequest && (
        <PlanChangeRequestDialog
          open={requestOpen}
          onOpenChange={setRequestOpen}
          plans={plans}
          currentPlanId={tenant?.subscription_plan_id}
          onRequested={loadBilling}
        />
      )}
    </div>
  );
}
