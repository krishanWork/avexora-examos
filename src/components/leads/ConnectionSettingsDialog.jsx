import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Lock, ShieldCheck } from "lucide-react";

const MASK = "••••••••";

const SecretNote = ({ hasValue, label }) =>
  !hasValue ? null : (
    <p className="text-xs text-stone-400 mt-1">Leave blank to keep the current {label}.</p>
  );

export default function ConnectionSettingsDialog({ open, onClose }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    smtp: { host: "", port: 587, secure: false, from: "", user: "", pass: "" },
    whatsapp: { token: "" },
  });
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await appClient.lead.getIntegrationSettings();
      const s = res.settings || {};
      setForm({
        smtp: {
          host: s.smtp?.host || "",
          port: s.smtp?.port || 587,
          secure: Boolean(s.smtp?.secure),
          from: s.smtp?.from || "",
          user: s.smtp?.user || "",
          pass: s.smtp?.pass_set ? MASK : "",
        },
        whatsapp: {
          token: s.whatsapp?.token_set ? MASK : "",
        },
      });
      setEncryptionAvailable(res.encryption_available !== false);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load connection settings");
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  const setSMTP = (k, v) => setForm({ ...form, smtp: { ...form.smtp, [k]: v } });
  const setWA = (k, v) => setForm({ ...form, whatsapp: { ...form.whatsapp, [k]: v } });

  const secretsTyped =
    (form.smtp.pass !== "" && form.smtp.pass !== MASK) ||
    (form.whatsapp.token !== "" && form.whatsapp.token !== MASK);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await appClient.lead.saveIntegrationSettings({
        smtp: {
          host: form.smtp.host,
          port: form.smtp.port,
          secure: form.smtp.secure,
          from: form.smtp.from,
          user: form.smtp.user,
          // Sending the MASK is treated as "keep existing secret" server-side.
          pass: form.smtp.pass,
        },
        whatsapp: {
          token: form.whatsapp.token,
        },
      });
      toast({ title: "Connection settings saved" });
      load();
    } catch (err) {
      setError(err.message || "Failed to save connection settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connection Settings</DialogTitle>
          <DialogDescription>
            Email (SMTP) and WhatsApp (Avexwa) provider configuration. Secrets are encrypted at rest and never shown again after saving.
          </DialogDescription>
        </DialogHeader>

        {!encryptionAvailable && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            SETTINGS_ENC_KEY is not set in the server environment, so provider passwords/tokens cannot be stored here yet. Non-secret settings (host, port, username, etc.) can still be saved. Ask your hosting admin to set SETTINGS_ENC_KEY to enable saving passwords/tokens, or use the SMTP_*/WHATSAPP_TOKEN environment variables instead.
          </p>
        )}

        <div className="space-y-6">
          <div className="border border-stone-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-800">Email — SMTP</p>
              {form.smtp.host && <Badge variant="secondary">stored in database</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="smtp-host">Host</Label>
                <Input id="smtp-host" className="mt-1" placeholder="smtp.example.com" value={form.smtp.host} onChange={(e) => setSMTP("host", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="smtp-port">Port</Label>
                <Input id="smtp-port" className="mt-1" type="number" value={form.smtp.port} onChange={(e) => setSMTP("port", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="smtp-from">From</Label>
                <Input id="smtp-from" className="mt-1" placeholder="ExamOS <noreply@domain.com>" value={form.smtp.from} onChange={(e) => setSMTP("from", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="smtp-user">Username</Label>
                <Input id="smtp-user" className="mt-1" placeholder="SMTP username" value={form.smtp.user} onChange={(e) => setSMTP("user", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="smtp-pass">Password</Label>
                <Input id="smtp-pass" className="mt-1" type="password" disabled={!encryptionAvailable} placeholder={form.smtp.pass ? MASK : "SMTP password"} value={form.smtp.pass} onChange={(e) => setSMTP("pass", e.target.value)} />
                <SecretNote hasValue={Boolean(form.smtp.pass && form.smtp.pass !== MASK)} label="password" />
                {!encryptionAvailable && <p className="text-xs text-amber-600 mt-1">Requires SETTINGS_ENC_KEY to store.</p>}
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <Switch checked={form.smtp.secure} onCheckedChange={(v) => setSMTP("secure", v)} />
                <span className="text-sm text-stone-600">Use secure connection (SSL/TLS, port 465)</span>
              </div>
            </div>
          </div>

          <div className="border border-stone-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-800">WhatsApp — Avexwa</p>
              {form.whatsapp.token === MASK && <Badge variant="secondary">stored in database</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="wa-token">API Key</Label>
                <Input id="wa-token" className="mt-1" type="password" disabled={!encryptionAvailable} placeholder={form.whatsapp.token ? MASK : "Avexwa X-API-Key"} value={form.whatsapp.token} onChange={(e) => setWA("token", e.target.value)} />
                <SecretNote hasValue={Boolean(form.whatsapp.token && form.whatsapp.token !== MASK)} label="API key" />
                {!encryptionAvailable && <p className="text-xs text-amber-600 mt-1">Requires SETTINGS_ENC_KEY to store.</p>}
              </div>
              <div className="col-span-2 flex items-start gap-2 text-xs text-stone-400 rounded-lg bg-stone-50 border border-stone-200 p-2">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                Manual messages only reach a lead within 24h of the lead's last inbound message. Register the webhook as https://your-host/api/webhooks/whatsapp?secret=&lt;WHATSAPP_WEBHOOK_SECRET&gt; in Avexwa for inbound messages; the secret is a server environment variable.
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || (!encryptionAvailable && secretsTyped)}>
            {saving ? "Saving..." : "Save Connection Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}