import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import DataTable from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Building2, CalendarClock, Loader2, RefreshCw, Send, History } from "lucide-react";
import moment from "moment";
import ReminderHistoryDialog from "./ReminderHistoryDialog";

const rupees = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value) || 0);

const day = (iso) => (iso ? moment(iso).format("DD MMM YYYY") : "—");

// The renewal countdown, as one badge.
//
// The colour is the only thing on this screen that changes over time without anybody
// touching anything, so it is derived on every render from the server's own
// `days_until_due` rather than recomputed here — the browser's clock is not the clock
// the scheduler runs on, and a badge that disagrees with the cron is worse than none.
export function DueBadge({ subscription }) {
  const remaining = subscription?.days_until_due;
  if (!subscription?.next_due_at) return <span className="text-stone-400">—</span>;
  if (remaining === null || remaining === undefined) return <Badge variant="outline">—</Badge>;
  if (remaining < 0) {
    return <Badge className="bg-rose-100 text-rose-700">{Math.abs(remaining)}d overdue</Badge>;
  }
  if (remaining === 0) {
    return <Badge className="bg-amber-100 text-amber-700">Due today</Badge>;
  }
  if (remaining <= 7) {
    return <Badge className="bg-amber-100 text-amber-700">{remaining}d left</Badge>;
  }
  return <Badge variant="outline" className="text-stone-600">{remaining}d left</Badge>;
}

// Record a renewal: confirm the institution paid, then advance the period.
//
// The `paid_through` this sends is the period the dialog was opened against, so a
// second window left open on the same row cannot book a second renewal — the server
// refuses it as a conflict rather than quietly pushing the due date out twice.
function RenewDialog({ open, onOpenChange, subscription, affiliateId, onRenewed }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [method, setMethod] = useState("Offline (UPI/Bank)");

  useEffect(() => {
    if (open) setMethod("Offline (UPI/Bank)");
  }, [open]);

  const handleRenew = async () => {
    if (!subscription) return;
    setSaving(true);
    try {
      const result = await appClient.affiliate.renew(affiliateId, subscription.id, subscription.paid_through, method);
      toast({
        title: "Renewal recorded",
        description: `${subscription.tenant_name} is now paid through ${day(result.subscription?.next_due_at)}.`,
      });
      onOpenChange(false);
      onRenewed?.();
    } catch (err) {
      toast({
        title: "Could not record the renewal",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a renewal</DialogTitle>
          <DialogDescription>
            Confirm that {subscription?.tenant_name} has paid for the next period. This advances the due date by
            one cycle and writes a payment record.
          </DialogDescription>
        </DialogHeader>

        {subscription && (
          <div className="text-sm bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-stone-500">Plan</span>
              <span className="font-medium">{subscription.plan_name || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500">Paid through</span>
              <span className="font-medium">{day(subscription.paid_through)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500">New due date</span>
              <span className="font-medium text-indigo-700">{day(subscription.next_due_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500">Amount</span>
              <span className="font-mono">₹{rupees(subscription.plan_price)}</span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="renewal-method">Payment method</Label>
          <Input
            id="renewal-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Offline (UPI/Bank)"
            maxLength={60}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange} disabled={saving}>Cancel</Button>
          <Button onClick={handleRenew} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Record renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One institution's renewal reminder, sent by hand.
//
// The draft starts as the affiliate's saved draft already rendered for THIS
// subscription, because the whole point of the preview is that nobody has to guess
// what {{due_date}} will turn into. Editing it here overrides the saved draft for this
// one message only.
function SendReminderDialog({ open, onOpenChange, subscription, affiliateId, settings, onSent }) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [channel, setChannel] = useState("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState(null);

  const channels = settings?.reminder_channels?.length ? settings.reminder_channels : ["email"];

  useEffect(() => {
    if (!open || !subscription) return;
    setChannel(channels[0] === "whatsapp" ? "email" : channels[0]);
    setSubject("");
    setBody("");
    setRecipient(null);
    appClient.affiliate
      .reminderPreview(affiliateId, subscription.id)
      .then((res) => {
        setSubject(res?.preview?.email_subject || "");
        setBody(res?.preview?.email_body || "");
        setRecipient(res?.recipient || null);
      })
      .catch(() => {
        // A failed preview is not a reason to block the send: the server renders the
        // saved draft itself, so an empty box here still sends the right thing.
        setRecipient(null);
      });
    // channels is derived from settings on every render, so it is intentionally not a
    // dependency; re-opening the dialog is what re-reads the configured channels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscription?.id, affiliateId]);

  const handleSend = async () => {
    if (!subscription) return;
    setSending(true);
    try {
      const payload = { channel };
      // Only the email channel carries free text. WhatsApp is template-only, so
      // sending these fields on that channel would be a no-op at best.
      if (channel === "email") {
        payload.subject = subject;
        payload.body = body;
      }
      const result = await appClient.affiliate.sendReminder(affiliateId, subscription.id, payload);
      toast({
        title: result.skipped ? "Already sent" : "Reminder sent",
        description: result.message,
        variant: result.skipped ? "default" : undefined,
      });
      onOpenChange(false);
      onSent?.();
    } catch (err) {
      toast({
        title: "Could not send the reminder",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={sending ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a renewal reminder</DialogTitle>
          <DialogDescription>
            {subscription?.tenant_name} is due {day(subscription.next_due_at)}.
            {recipient?.email ? ` Reminders go to ${recipient.email}.` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Channel</Label>
          <div className="flex gap-2">
            {["email", "whatsapp"].map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={channel === option ? "default" : "outline"}
                onClick={() => setChannel(option)}
              >
                {option === "email" ? "Email" : "WhatsApp"}
              </Button>
            ))}
          </div>
          {channel === "whatsapp" && (
            <p className="text-[11px] text-stone-500">
              WhatsApp uses the approved template{" "}
              <span className="font-mono">{settings?.reminder_whatsapp_template_name || "(none selected)"}</span>.
              Free text is not sent on WhatsApp — a message outside the 24-hour window is rejected by the provider.
            </p>
          )}
        </div>

        {channel === "email" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reminder-subject">Subject</Label>
              <Input id="reminder-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reminder-body">Message</Label>
              <Textarea
                id="reminder-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-stone-500">
                This overrides the saved draft for this one message. The saved draft is unchanged.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One affiliate's subscriptions: what was paid for, when it renews, and the two actions
// that change it.
//
// Shared by the reseller portal and the super admin's drawer so both surfaces cannot
// disagree about a due date — the figure and the buttons come from one table.
export default function SubscriptionsPanel({ affiliateId, subscriptions, loading, onRefresh, settings, emptyMessage }) {
  const [renewTarget, setRenewTarget] = useState(null);
  const [remindTarget, setRemindTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);

  const columns = [
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
      cell: (row) => (
        <div>
          <div>{row.plan_name || "—"}</div>
          <div className="text-xs font-normal text-stone-400 font-mono">₹{rupees(row.plan_price)}</div>
        </div>
      ),
    },
    {
      key: "subscription_started_at",
      header: "Started",
      className: "whitespace-nowrap text-stone-600",
      cell: (row) => day(row.subscription_started_at),
    },
    {
      key: "paid_through",
      header: "Paid Through",
      className: "whitespace-nowrap text-stone-600",
      cell: (row) => day(row.paid_through),
    },
    {
      key: "next_due_at",
      header: "Next Due",
      className: "whitespace-nowrap",
      cell: (row) => (
        <div>
          <div className="text-stone-900">{day(row.next_due_at)}</div>
          <div className="mt-1"><DueBadge subscription={row} /></div>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={subscriptions || []}
        loading={loading}
        error={null}
        onRetry={onRefresh}
        getRowId={(row) => row.id}
        emptyMessage={emptyMessage || "No subscriptions yet."}
        emptyIcon={Building2}
        actions={(row) => (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" title="Reminder history" onClick={() => setHistoryTarget(row)}>
              <History className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRemindTarget(row)}>
              <Send className="w-3.5 h-3.5 mr-1.5" /> Remind
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRenewTarget(row)}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Renew
            </Button>
          </div>
        )}
      />

      <RenewDialog
        open={Boolean(renewTarget)}
        onOpenChange={(open) => !open && setRenewTarget(null)}
        subscription={renewTarget}
        affiliateId={affiliateId}
        onRenewed={onRefresh}
      />
      <SendReminderDialog
        open={Boolean(remindTarget)}
        onOpenChange={(open) => !open && setRemindTarget(null)}
        subscription={remindTarget}
        affiliateId={affiliateId}
        settings={settings}
        onSent={onRefresh}
      />
      <ReminderHistoryDialog
        open={Boolean(historyTarget)}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        subscription={historyTarget}
        affiliateId={affiliateId}
      />
    </>
  );
}

// The countdown summary above the table: how many institutions are overdue, due this
// week, or fine. Counts come from the server's own derivation of each row.
export function RenewalSummary({ subscriptions }) {
  const rows = subscriptions || [];
  const overdue = rows.filter((r) => typeof r.days_until_due === "number" && r.days_until_due < 0).length;
  const dueSoon = rows.filter((r) => typeof r.days_until_due === "number" && r.days_until_due >= 0 && r.days_until_due <= 7).length;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
      <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
        <Building2 className="w-3.5 h-3.5 text-stone-400" /> {rows.length} active
      </Badge>
      {dueSoon > 0 && (
        <Badge className="bg-amber-100 text-amber-700 gap-1.5 px-2.5 py-1">
          <CalendarClock className="w-3.5 h-3.5" /> {dueSoon} due within 7 days
        </Badge>
      )}
      {overdue > 0 && (
        <Badge className="bg-rose-100 text-rose-700 gap-1.5 px-2.5 py-1">
          <CalendarClock className="w-3.5 h-3.5" /> {overdue} overdue
        </Badge>
      )}
    </div>
  );
}