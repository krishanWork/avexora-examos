import React, { useCallback, useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Loader2 } from "lucide-react";
import moment from "moment";

// What was actually sent to one institution, and what the provider said.
//
// This screen exists because the manual send can answer "already sent", and "already
// sent" is only trustworthy if there is somewhere to go and see the row that beat it —
// including the provider's own message id, or the reason it failed. A failed WhatsApp
// template send in particular looks identical to a successful one from the affiliate's
// side unless the error is surfaced here.
export default function ReminderHistoryDialog({ open, onOpenChange, subscription, affiliateId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!subscription?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await appClient.affiliate.deliveries(affiliateId, subscription.id);
      setRows(Array.isArray(result?.data) ? result.data : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [affiliateId, subscription?.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4 text-stone-400" /> Reminder history
          </DialogTitle>
          <DialogDescription>
            Every renewal reminder recorded for {subscription?.tenant_name}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-stone-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between">
            <p>{error.message || "Could not load the reminder history."}</p>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-400">
            No reminders have been sent for this subscription yet.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                  <th className="py-2 pr-3 font-semibold">When</th>
                  <th className="py-2 pr-3 font-semibold">Channel</th>
                  <th className="py-2 pr-3 font-semibold">Trigger</th>
                  <th className="py-2 pr-3 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 last:border-0 align-top">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-stone-600">
                      {row.sent_at || row.created_date ? moment(row.sent_at || row.created_date).format("DD MMM, HH:mm") : "—"}
                      {row.period_key ? (
                        <div className="text-[11px] text-stone-400 font-mono">due {row.period_key}</div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-600 capitalize">
                      {row.channel}
                      {row.lead_days ? (
                        <div className="text-[11px] text-stone-400">{row.lead_days}d before</div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-600 capitalize">{row.trigger}</td>
                    <td className="py-2.5 pr-3">
                      {row.status === "sent" ? (
                        <div>
                          <Badge className="bg-emerald-100 text-emerald-700">Sent</Badge>
                          {row.provider_message_id ? (
                            <div className="text-[11px] text-stone-400 font-mono mt-1 break-all">{row.provider_message_id}</div>
                          ) : null}
                        </div>
                      ) : row.status === "skipped" ? (
                        <Badge variant="outline">Skipped</Badge>
                      ) : (
                        <div>
                          <Badge className="bg-rose-100 text-rose-700">Failed</Badge>
                          {row.error ? (
                            <div className="text-[11px] text-rose-600 mt-1">{row.error}</div>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}