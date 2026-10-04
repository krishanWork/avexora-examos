import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { appClient } from "@/api/appClient";
import { cycleLabel } from "@/components/billing/PlanChangeRequestDialog";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";

// The ways an institution's money actually arrives. There is no gateway in this
// application, so the operator is attesting to a collection they made themselves —
// the same honesty as affiliateSell's "recorded as collected rather than claiming a
// gateway confirmed it".
const PAYMENT_METHODS = ["UPI", "Bank transfer", "Cash", "Cheque"];

const money = (value) => `₹${(Number(value) || 0).toLocaleString()}`;

const formatDate = (iso) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

// Approve or reject a school's plan-change request.
//
// Approving is the money-moving half of the upgrade: the server applies the new
// plan, snapshots its quotas onto the institution and writes a Payment row in one
// order with a compensating rollback. The amount defaults to the plan price so the
// common case is one click, but is editable because a negotiated quote is a normal
// part of a sales-assisted sale.
export default function PlanChangeApprovalDialog({ open, onOpenChange, request, onDecided }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!request) return null;

  const suggested = Number(request.to_plan_price) || 0;
  const amountValue = amount === "" ? suggested : Number(amount);
  const amountValid = Number.isFinite(amountValue) && amountValue >= 0;

  const decide = async (action) => {
    setError(null);
    if (action === "approve" && !amountValid) {
      setError("Enter a valid amount collected from the institution.");
      return;
    }
    if (action === "reject" && !note.trim()) {
      setError("A reason is required so the school knows why it was declined.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await appClient.functions.invoke("planUpgrade", {
        action,
        request_id: request.id,
        amount: action === "approve" ? amountValue : undefined,
        payment_method: action === "approve" ? paymentMethod : undefined,
        note: note.trim(),
      });
      if (res?.error) throw new Error(res.error);
      toast({
        title: action === "approve" ? "Plan change approved" : "Plan change rejected",
        description:
          action === "approve"
            ? `${request.tenant_name} is now on ${request.to_plan_name}. Payment recorded.`
            : `${request.tenant_name} has been notified of the decision.`,
      });
      if (onDecided) onDecided({ action, request });
      setAmount("");
      setNote("");
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
              <ArrowRight className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">Review plan change</DialogTitle>
              <DialogDescription className="text-xs text-stone-500 mt-0.5">
                {request.tenant_name} · requested {formatDate(request.requested_date)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-stone-500">Current plan</span>
              <span className="font-medium text-stone-700">{request.from_plan_name || "No plan"}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-stone-500">Requested plan</span>
              <span className="font-semibold text-stone-900">
                {request.to_plan_name} · {money(suggested)}/{cycleLabel(request.to_plan_billing_cycle)}
              </span>
            </div>
            {request.reason && (
              <div className="pt-2 border-t border-stone-200">
                <p className="text-xs font-semibold text-stone-500 mb-1">Their reason</p>
                <p className="text-sm text-stone-700 leading-relaxed">{request.reason}</p>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
            <p>
              Approving takes effect immediately: the institution gets the new plan and its quotas
              (student, OMR and exam limits) right away, and a payment of{" "}
              <strong>{money(amountValue || 0)}</strong> is recorded against it.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-approve-amount" className="text-xs font-semibold text-stone-700">
                Amount collected
              </Label>
              <Input
                id="p6-approve-amount"
                type="number"
                min="0"
                step="1"
                value={amount === "" ? String(suggested) : amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-10 text-sm mt-1"
              />
            </div>
            <div>
              <Label htmlFor="p6-approve-method" className="text-xs font-semibold text-stone-700">
                Payment method
              </Label>
              <select
                id="p6-approve-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="h-10 w-full mt-1 rounded-lg border border-stone-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="p6-approve-note" className="text-xs font-semibold text-stone-700">
              Note
            </Label>
            <Textarea
              id="p6-approve-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Required when rejecting"
              className="mt-1 text-sm"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => decide("reject")}
            disabled={submitting}
            className="text-red-700 hover:text-red-800"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Reject
          </Button>
          <Button type="button" onClick={() => decide("approve")} disabled={submitting}>
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-2" />
            )}
            Approve &amp; record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
