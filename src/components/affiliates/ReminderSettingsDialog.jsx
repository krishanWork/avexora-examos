import React, { useCallback, useEffect, useMemo, useState } from "react";
import { appClient } from "@/api/appClient";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { AlertTriangle, BellRing, Info, Loader2 } from "lucide-react";

// The fallback draft offered the first time an affiliate opens this screen.
//
// It exists because WhatsApp is template-only, and a template renders fixed wording —
// so without a saved email draft the AUTOMATIC reminder would have nothing to send at
// all. It is a starting point, not a decision: everything here is editable and nothing
// is sent until the affiliate saves it.
const STARTER_EMAIL = `Hello {{contact_name}},

Your {{plan_name}} subscription for {{school_name}} is {{days_until_due}} — on {{due_date}}.

To keep your account active, please renew for ₹{{amount}}.
{{pay_link}}

Thank you,
{{affiliate_name}}`;

const STARTER_SUBJECT = "{{school_name}} — subscription renews on {{due_date}}";

const LEAD_DAY_PRESETS = [7, 3, 1, 0];

// How often to remind, and what to say.
//
// Reachable by the reseller as well as the super admin — drafting their own wording and
// choosing their own channels is theirs to do. `commission_mode` is the exception: that
// decides what the platform pays, so the server refuses it from anyone else and this
// screen hides it unless the caller is a super admin.
export default function ReminderSettingsDialog({ open, onOpenChange, affiliateId, affiliate, onSaved }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState(null);
  const [options, setOptions] = useState(null);
  const [canSetCommissionMode, setCanSetCommissionMode] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesError, setTemplatesError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    reminder_channels: ["email"],
    reminder_lead_days: [7, 1, 0],
    reminder_email_subject: "",
    reminder_email_template: "",
    reminder_whatsapp_template_name: "",
    reminder_pay_link: "",
    commission_mode: "one_time",
  });

  const load = useCallback(async () => {
    if (!affiliateId) return;
    setLoading(true);
    try {
      const [settingsRes, templateRes] = await Promise.all([
        appClient.affiliate.subscriptionSettings(affiliateId),
        appClient.affiliate.whatsappTemplates(affiliateId).catch((err) => ({ error: err.message, failed: true })),
      ]);
      const next = settingsRes?.settings || {};
      setSettings(next);
      setOptions(settingsRes?.options || null);
      setCanSetCommissionMode(Boolean(settingsRes?.can_set_commission_mode));
      setForm({
        reminder_channels: next.reminder_channels?.length ? next.reminder_channels : ["email"],
        reminder_lead_days: next.reminder_lead_days?.length ? next.reminder_lead_days : [7, 1, 0],
        reminder_email_subject: next.reminder_email_subject || "",
        reminder_email_template: next.reminder_email_template || "",
        reminder_whatsapp_template_name: next.reminder_whatsapp_template_name || "",
        reminder_pay_link: next.reminder_pay_link || "",
        commission_mode: next.commission_mode || "one_time",
      });
      // A provider that cannot be reached is not a reason to block the rest of the
      // screen: the email half of the configuration is still editable and savable.
      if (templateRes?.failed) setTemplatesError(templateRes.error || "Could not load WhatsApp templates");
      else setTemplates(Array.isArray(templateRes?.templates) ? templateRes.templates : []);
    } catch (err) {
      toast({
        title: "Could not load reminder settings",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [affiliateId, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // The same substitution the server performs, so what is shown here is what the
  // customer receives. It is a PREVIEW against a sample subscription, not a real
  // institution — no institution is named, so nothing here can leak.
  const preview = useMemo(() => {
    const sample = {
      tenant_name: "Greenfield Public School",
      plan_name: "School Pro",
      plan_price: 4999,
      contact: { name: "Asha Rao" },
      paid_through: "2026-02-01",
      next_due_at: "2026-03-01",
    };
    const vars = {
      school_name: sample.tenant_name,
      contact_name: sample.contact.name,
      plan_name: sample.plan_name,
      amount: "4999",
      paid_through: sample.paid_through,
      due_date: sample.next_due_at,
      days_until_due: "due in 7 days",
      affiliate_name: affiliate?.full_name || "",
      pay_link: form.reminder_pay_link || "",
    };
    const fill = (text) =>
      String(text || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) =>
        vars[key] === undefined ? match : String(vars[key])
      );
    return { subject: fill(form.reminder_email_subject), body: fill(form.reminder_email_template) };
  }, [form.reminder_email_subject, form.reminder_email_template, form.reminder_pay_link, affiliate?.full_name]);

  const toggleChannel = (channel, checked) => {
    setForm((prev) => {
      const next = checked ? [...new Set([...prev.reminder_channels, channel])] : prev.reminder_channels.filter((c) => c !== channel);
      return { ...prev, reminder_channels: next };
    });
  };

  const toggleLeadDay = (day, checked) => {
    setForm((prev) => {
      const next = checked ? [...new Set([...prev.reminder_lead_days, day])] : prev.reminder_lead_days.filter((d) => d !== day);
      return { ...prev, reminder_lead_days: [...next].sort((a, b) => b - a) };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        reminder_channels: form.reminder_channels,
        reminder_lead_days: form.reminder_lead_days,
        reminder_email_subject: form.reminder_email_subject,
        reminder_email_template: form.reminder_email_template,
        reminder_whatsapp_template_name: form.reminder_whatsapp_template_name,
        reminder_pay_link: form.reminder_pay_link,
      };
      // Only sent when the caller is allowed to change it, so an affiliate's save can
      // never carry a commission_mode the server would then refuse.
      if (canSetCommissionMode) payload.commission_mode = form.commission_mode;

      const result = await appClient.affiliate.saveSubscriptionSettings(affiliateId, payload);
      setSettings(result?.settings || null);
      toast({ title: "Reminder settings saved" });
      onSaved?.(result?.settings);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not save reminder settings",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const usingStarterDraft = !settings?.reminder_email_template;

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-stone-400" /> Renewal reminders
          </DialogTitle>
          <DialogDescription>
            Choose how and when institutions are reminded that their subscription is due. Automated reminders
            run once a day; a manual “Remind” on any subscription sends immediately.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-stone-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* --- Commission mode (super admin only) ------------------------- */}
            {canSetCommissionMode && (
              <div className="space-y-2">
                <Label>Commission on renewal</Label>
                <Select
                  value={form.commission_mode}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, commission_mode: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One time — paid only on the first subscription</SelectItem>
                    <SelectItem value="recurring">Every renewal — paid again each month</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-stone-500">
                  Applies to subscriptions started from now on. A subscription already sold keeps the mode it was
                  sold on.
                </p>
              </div>
            )}

            {/* --- Channels --------------------------------------------------- */}
            <div className="space-y-2">
              <Label>Send reminders by</Label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.reminder_channels.includes("email")}
                    onCheckedChange={(checked) => toggleChannel("email", checked)}
                  />
                  Email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.reminder_channels.includes("whatsapp")}
                    onCheckedChange={(checked) => toggleChannel("whatsapp", checked)}
                  />
                  WhatsApp
                </label>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-stone-500 mt-1">
                <Info className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                <p>
                  WhatsApp only delivers an approved template. A free-text WhatsApp message is rejected by the
                  provider once the 24-hour reply window has closed, which is almost always the case for a
                  reminder sent weeks later — so WhatsApp uses the template selected below, and your written draft
                  goes out by email.
                </p>
              </div>
            </div>

            {/* --- Lead days --------------------------------------------------- */}
            <div className="space-y-2">
              <Label>Remind me</Label>
              <div className="flex flex-wrap gap-4">
                {LEAD_DAY_PRESETS.map((day) => (
                  <label key={day} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.reminder_lead_days.includes(day)}
                      onCheckedChange={(checked) => toggleLeadDay(day, checked)}
                    />
                    {day === 0 ? "On the due date" : `${day} day${day === 1 ? "" : "s"} before`}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-stone-500">
                Each reminder is sent once per billing period. Choosing nothing turns automated reminders off —
                you can still send one by hand at any time.
              </p>
            </div>

            {/* --- Email draft ------------------------------------------------- */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="reminder-template">Email message</Label>
                {usingStarterDraft && (
                  <Badge variant="outline" className="text-[10px]">Using the starter draft</Badge>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder-subject" className="text-xs text-stone-500">Subject</Label>
                <Input
                  id="reminder-subject"
                  value={form.reminder_email_subject}
                  onChange={(e) => setForm((prev) => ({ ...prev, reminder_email_subject: e.target.value }))}
                  maxLength={200}
                  placeholder={STARTER_SUBJECT}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder-body" className="text-xs text-stone-500">Message</Label>
                <Textarea
                  id="reminder-body"
                  value={form.reminder_email_template}
                  onChange={(e) => setForm((prev) => ({ ...prev, reminder_email_template: e.target.value }))}
                  rows={9}
                  className="font-mono text-xs"
                  placeholder={STARTER_EMAIL}
                />
              </div>
              {options?.placeholders?.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-stone-500">Insert:</span>
                  {options.placeholders.map((token) => (
                    <button
                      key={token}
                      type="button"
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-stone-200 text-stone-600 hover:bg-stone-50"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          reminder_email_template: `${prev.reminder_email_template}{{${token}}}`,
                        }))
                      }
                    >
                      {token}
                    </button>
                  ))}
                </div>
              ) : null}

              {preview.body ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                  <div className="text-[11px] font-semibold text-stone-500 mb-1.5">Preview</div>
                  <div className="text-xs font-medium text-stone-900">{preview.subject}</div>
                  <pre className="mt-2 text-[11px] text-stone-600 whitespace-pre-wrap font-sans leading-relaxed">
                    {preview.body}
                  </pre>
                  <p className="text-[10px] text-stone-400 mt-2">
                    Previewed against a sample institution. Each real reminder substitutes that school’s own
                    details.
                  </p>
                </div>
              ) : null}
            </div>

            {/* --- WhatsApp template ------------------------------------------- */}
            {form.reminder_channels.includes("whatsapp") && (
              <div className="space-y-2">
                <Label htmlFor="wa-template">WhatsApp template</Label>
                {templatesError ? (
                  <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>{templatesError}</p>
                  </div>
                ) : templates.length === 0 ? (
                  <p className="text-[11px] text-stone-500">
                    No approved templates were found on the WhatsApp account. WhatsApp reminders cannot be sent
                    until one is approved and approved templates are loaded.
                  </p>
                ) : (
                  <Select
                    value={form.reminder_whatsapp_template_name || undefined}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, reminder_whatsapp_template_name: value }))}
                  >
                    <SelectTrigger id="wa-template">
                      <SelectValue placeholder="Choose an approved template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((tpl) => (
                        <SelectItem key={tpl.name} value={tpl.name}>{tpl.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-stone-500">
                  The template fills in the institution name, plan, due date, amount and countdown in that order.
                </p>
              </div>
            )}

            {/* --- Payment link ------------------------------------------------ */}
            <div className="space-y-2">
              <Label htmlFor="pay-link">Payment link (optional)</Label>
              <Input
                id="pay-link"
                value={form.reminder_pay_link}
                onChange={(e) => setForm((prev) => ({ ...prev, reminder_pay_link: e.target.value }))}
                placeholder="https://…"
                maxLength={500}
              />
              <p className="text-[11px] text-stone-500">
                Inserted wherever the draft contains <span className="font-mono">pay_link</span>. Leave blank if
                there is no link to share.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}