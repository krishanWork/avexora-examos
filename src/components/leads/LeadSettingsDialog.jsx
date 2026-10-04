import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Settings2 } from "lucide-react";
import ConnectionSettingsDialog from "@/components/leads/ConnectionSettingsDialog";

const toCsv = (list) => (Array.isArray(list) ? list.join(", ") : "");
const toList = (csv) => csv.split(",").map((s) => s.trim()).filter(Boolean);

export default function LeadSettingsDialog({ open, onClose }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    email_enabled: false,
    email_recipients: "",
    whatsapp_enabled: false,
    whatsapp_numbers: "",
  });
  const [capabilities, setCapabilities] = useState({ email_configured: false, whatsapp_configured: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);

  const load = async () => {
    try {
      const res = await appClient.lead.getSettings();
      const s = res.settings || {};
      setForm({
        email_enabled: Boolean(s.email_notifications?.enabled),
        email_recipients: toCsv(s.email_notifications?.recipients),
        whatsapp_enabled: Boolean(s.whatsapp_notifications?.enabled),
        whatsapp_numbers: toCsv(s.whatsapp_notifications?.numbers),
      });
      setCapabilities(res.capabilities || { email_configured: false, whatsapp_configured: false });
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load settings");
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await appClient.lead.saveSettings({
        email_notifications: { enabled: form.email_enabled, recipients: toList(form.email_recipients) },
        whatsapp_notifications: { enabled: form.whatsapp_enabled, numbers: toList(form.whatsapp_numbers) },
      });
      toast({ title: "Settings saved" });
      load();
    } catch (err) {
      setError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Notification Settings</DialogTitle>
          <DialogDescription>
            Automatic alerts sent to the Super Admin when a new lead arrives. These never email or message the lead themselves.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!capabilities.email_configured && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Email provider not configured yet — email notifications will be skipped until Connection Settings are filled in.
            </p>
          )}
          <div className="border border-stone-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-stone-800">Email Notifications</p>
                <p className="text-xs text-stone-500">Notify when a new lead arrives</p>
              </div>
              <Switch checked={form.email_enabled} onCheckedChange={(v) => setForm({ ...form, email_enabled: v })} />
            </div>
            <div>
              <Label htmlFor="email-recipients">Notification recipient(s)</Label>
              <Input
                id="email-recipients"
                className="mt-1"
                placeholder="admin@example.com"
                value={form.email_recipients}
                disabled={!form.email_enabled}
                onChange={(e) => setForm({ ...form, email_recipients: e.target.value })}
              />
              <p className="text-xs text-stone-400 mt-1">Comma-separated list, up to 5 addresses.</p>
            </div>
          </div>

          {!capabilities.whatsapp_configured && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              WhatsApp not configured yet — WhatsApp notifications will be skipped until Connection Settings are filled in.
            </p>
          )}
          <div className="border border-stone-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-stone-800">WhatsApp Notifications</p>
                <p className="text-xs text-stone-500">Notify when a new lead arrives</p>
              </div>
              <Switch checked={form.whatsapp_enabled} onCheckedChange={(v) => setForm({ ...form, whatsapp_enabled: v })} />
            </div>
            <div>
              <Label htmlFor="whatsapp-numbers">Notification number(s)</Label>
              <Input
                id="whatsapp-numbers"
                className="mt-1"
                placeholder="+91XXXXXXXXXX"
                value={form.whatsapp_numbers}
                disabled={!form.whatsapp_enabled}
                onChange={(e) => setForm({ ...form, whatsapp_numbers: e.target.value })}
              />
              <p className="text-xs text-stone-400 mt-1">Comma-separated list, up to 5 numbers. Include country code.</p>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button variant="outline" className="w-full" onClick={() => setConnectionOpen(true)}>
            <Settings2 className="w-4 h-4 mr-2" /> Connection Settings (Email & WhatsApp providers)
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
        </DialogFooter>

        <ConnectionSettingsDialog open={connectionOpen} onClose={() => setConnectionOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}