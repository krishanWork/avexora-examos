import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, KeyRound } from "lucide-react";

// A whole-institution backfill can legitimately produce hundreds of rows, and
// every one of them shares the same default password shown above — so the tail
// of the list carries no information the first rows do not. Rendering all of it
// buys nothing and costs a very long dialog.
const MAX_VISIBLE_ROWS = 200;

/**
 * Summarizes newly provisioned portal logins under the shared-default-password
 * model. No per-user plaintext passwords exist, so nothing is copied or
 * downloaded; the institution default password is shown once for the admin.
 * Rows are { type, name, email, reused } and are cleared on close.
 */
export default function CredentialRevealModal({ open, onOpenChange, rows = [], defaultPassword = "" }) {
  const visibleRows = rows.filter((r) => r?.email);
  const shownRows = visibleRows.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = visibleRows.length - shownRows.length;

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            Portal Logins Created
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              All new portal logins use the institution default password shown below. Each user must
              change it the first time they sign in. Accounts that already existed were reused and
              keep their own passwords.
            </p>
          </div>

          {defaultPassword && (
            <div className="flex items-center gap-2.5 bg-stone-50 border border-stone-200 rounded-lg p-3">
              <KeyRound className="w-4 h-4 text-stone-500 shrink-0" />
              <div className="text-xs">
                <p className="text-stone-400 font-medium uppercase tracking-wide">Institution default password</p>
                <p className="font-mono text-base text-stone-800">{defaultPassword}</p>
              </div>
            </div>
          )}

          {visibleRows.length === 0 ? (
            <p className="text-sm text-stone-500">
              No new logins were created (accounts already existed and were reused).
            </p>
          ) : (
            <div className="overflow-x-auto border border-stone-200 rounded-lg max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-stone-50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-stone-600">Account</th>
                    <th className="px-3 py-2 font-semibold text-stone-600">Email</th>
                    <th className="px-3 py-2 font-semibold text-stone-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {shownRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-stone-800">
                        {r.name || (r.type === "parent" ? "Parent" : "Student")}
                      </td>
                      <td className="px-3 py-2 font-mono text-stone-600">{r.email}</td>
                      <td className="px-3 py-2">
                        {r.reused ? (
                          <span className="text-stone-400">reused</span>
                        ) : (
                          <span className="text-emerald-600 font-medium">new</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hiddenCount > 0 && (
                <p className="border-t border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
                  +{hiddenCount} more account{hiddenCount === 1 ? "" : "s"} created with the same default password
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" onClick={handleClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}