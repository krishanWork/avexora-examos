import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Ban, Loader2 } from "lucide-react";

export default function ConfirmStatusDialog({
  open,
  onOpenChange,
  tenant,
  onConfirm,
  submitting = false,
}) {
  if (!tenant) return null;

  const isCurrentActive = tenant.status === "active";
  const targetAction = isCurrentActive ? "suspend" : "activate";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                isCurrentActive
                  ? "bg-red-50 text-red-600 border border-red-200"
                  : "bg-emerald-50 text-emerald-600 border border-emerald-200"
              }`}
            >
              {isCurrentActive ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div>
              <DialogTitle className="text-lg">
                {isCurrentActive ? "Suspend Institution" : "Reactivate Institution"}
              </DialogTitle>
              <p className="text-xs text-stone-500 font-mono mt-0.5">
                {tenant.name}
              </p>
            </div>
          </div>
          <DialogDescription className="text-stone-600 text-sm leading-relaxed pt-1">
            {isCurrentActive ? (
              <>
                Suspending{" "}
                <span className="font-semibold text-stone-900">
                  {tenant.name}
                </span>{" "}
                will immediately revoke access for all associated administrators,
                teachers, students, and parents. Active examinations and portal
                sessions will be halted until reactivated.
              </>
            ) : (
              <>
                Reactivating{" "}
                <span className="font-semibold text-stone-900">
                  {tenant.name}
                </span>{" "}
                will immediately restore full platform access, portal logins, and
                service operations for all authorized users.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/80 text-xs text-stone-600 space-y-1">
          <div className="flex justify-between">
            <span className="text-stone-400">Subdomain:</span>
            <span className="font-mono font-medium text-stone-800">
              {tenant.subdomain || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">Current Status:</span>
            <span
              className={`font-semibold capitalize ${
                isCurrentActive ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              {tenant.status || "active"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">Target State:</span>
            <span
              className={`font-bold capitalize ${
                isCurrentActive ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {targetAction}ed
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={isCurrentActive ? "destructive" : "default"}
            className={
              !isCurrentActive
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : ""
            }
            onClick={() => onConfirm(tenant)}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : isCurrentActive ? (
              <Ban className="w-4 h-4 mr-2" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-2" />
            )}
            {isCurrentActive ? "Confirm Suspension" : "Activate Institution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
