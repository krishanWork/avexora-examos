import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { appClient } from "@/api/appClient";
import EmptyState from "@/components/shared/EmptyState";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";

// Same label rule the server uses (normalizeInterval in
// server/affiliate-subscription.js): the plan's billing_cycle is free text and is
// not self-consistent — the seeds write "month" while the plan editor defaults to
// "monthly" — so it is normalized rather than trusted, and anything unrecognised
// reads as one month.
export const cycleLabel = (billingCycle) => {
  const label = String(billingCycle || "").trim().toLowerCase();
  if (!label) return "month";
  if (/(year|annual)/.test(label)) return "year";
  if (/quarter/.test(label)) return "quarter";
  return "month";
};

// Ask an administrator to move this institution to a different plan.
//
// This does not change anything on submission. There is no payment gateway in the
// application, so the request is queued for a platform operator who collects the
// amount offline and approves it; only then does the new plan, its quotas and a
// Payment row appear. The copy says so plainly, because a school admin who clicks
// "Change plan" and sees no change has been told one thing and delivered another.
export default function PlanChangeRequestDialog({ open, onOpenChange, plans, currentPlanId, onRequested }) {
  const { toast } = useToast();
  const [toPlanId, setToPlanId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const currentPlan = useMemo(
    () => (plans || []).find((p) => p.id === currentPlanId) || null,
    [plans, currentPlanId]
  );
  const selectedPlan = useMemo(
    () => (plans || []).find((p) => p.id === toPlanId) || null,
    [plans, toPlanId]
  );

  // The current plan is listed but not selectable: submitting it is refused
  // server-side, so offering it as a choice would only produce an error.
  const options = useMemo(
    () => (plans || []).filter((p) => p.id !== currentPlanId),
    [plans, currentPlanId]
  );

  const reset = () => {
    setToPlanId("");
    setReason("");
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPlan) return;
    setSubmitting(true);
    try {
      const res = await appClient.functions.invoke("planUpgrade", {
        action: "submit",
        to_plan_id: selectedPlan.id,
        reason: reason.trim(),
      });
      if (res?.error) throw new Error(res.error);
      toast({
        title: "Plan change requested",
        description: `${selectedPlan.name} has been sent for approval. Your current plan stays active until it is approved.`,
      });
      if (onRequested) onRequested(res.request);
      handleClose();
    } catch (err) {
      toast({
        title: "Could not request the plan change",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">Change plan</DialogTitle>
              <DialogDescription className="text-xs text-stone-500 mt-0.5">
                {currentPlan
                  ? `Currently on ${currentPlan.name}. A new plan takes effect once an administrator approves it and records your payment.`
                  : "Your institution has no plan assigned. Request one below and an administrator will set it up."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {options.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No other plans available"
            description="There is only one plan in the catalogue, or your institution is already on the only plan available to it."
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-stone-700 mb-1">Choose a plan</legend>
              {options.map((plan) => {
                const active = plan.id === toPlanId;
                const price = Number(plan.price) || 0;
                const delta = currentPlan ? price - (Number(currentPlan.price) || 0) : price;
                return (
                  <label
                    key={plan.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      active
                        ? "border-indigo-300 bg-indigo-50/50"
                        : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="to_plan_id"
                      value={plan.id}
                      checked={active}
                      onChange={() => setToPlanId(plan.id)}
                      className="mt-1 accent-indigo-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-stone-900 text-sm">{plan.name}</span>
                        <span className="text-sm font-semibold text-stone-900 whitespace-nowrap">
                          ₹{price.toLocaleString()}
                          <span className="text-xs font-normal text-stone-500">
                            /{cycleLabel(plan.billing_cycle)}
                          </span>
                        </span>
                      </div>
                      <div className="text-xs text-stone-500 mt-1 space-y-0.5">
                        <p>
                          {plan.student_limit?.toLocaleString()} students ·{" "}
                          {plan.omr_sheet_limit?.toLocaleString()} OMR sheets/month ·{" "}
                          {plan.exam_limit?.toLocaleString()} exams
                        </p>
                        {currentPlan && (
                          <p className={delta > 0 ? "text-stone-500" : "text-emerald-600"}>
                            {delta === 0
                              ? "Same price as your current plan"
                              : `${delta > 0 ? "+" : "−"}₹${Math.abs(delta).toLocaleString()} per ${cycleLabel(plan.billing_cycle)} vs your current plan`}
                          </p>
                        )}
                      </div>
                    </div>
                    {active && <Check className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />}
                  </label>
                );
              })}
            </fieldset>

            <div>
              <Label htmlFor="p6-plan-change-reason" className="text-xs font-semibold text-stone-700">
                Reason (optional)
              </Label>
              <Textarea
                id="p6-plan-change-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="e.g. Admissions have grown past our student limit"
                className="mt-1 text-sm"
              />
              <p className="text-xs text-stone-500 mt-1">
                Helps the administrator prioritise your request.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !selectedPlan}>
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {selectedPlan ? (
                  <>
                    Request {selectedPlan.name}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                ) : (
                  "Select a plan"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
