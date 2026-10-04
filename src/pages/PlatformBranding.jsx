import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Save } from "lucide-react";
import LogoUploadField from "@/components/branding/LogoUploadField";

export default function PlatformBranding() {
  const { toast } = useToast();
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    appClient.entities.PlatformBranding.list("-updated_date", 1)
      .then((rows) => {
        setRecord(rows[0] || null);
        setForm(rows[0] || {});
      })
      .catch((err) => {
        console.error("Failed to load branding:", err);
        toast({ title: "Failed to load branding", description: "Your saved branding could not be loaded. Please retry.", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, []);

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        brand_name: form.brand_name || "Avexora ExamOS",
        header_logo_url: form.header_logo_url || null,
        footer_logo_url: form.footer_logo_url || null,
        login_logo_url: form.login_logo_url || null,
        favicon_url: form.favicon_url || null,
        sidebar_color: form.sidebar_color || "#0F172A",
        sidebar_use_color: !!form.sidebar_use_color,
      };
      if (record) {
        await appClient.entities.PlatformBranding.update(record.id, data);
      } else {
        const created = await appClient.entities.PlatformBranding.create(data);
        setRecord(created);
      }
      toast({ title: "Platform branding updated", description: "Logos will appear across the website, login screens and app." });
    } catch (err) {
      console.error("Failed to update branding:", err);
      toast({ title: "Failed to update branding", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
        <PageHeader
          title="Platform Branding"
          description="Upload the Avexora logos shown on the website header, footer, login screens and browser tab (favicon)."
        />
        <div className="bg-white rounded-xl border border-stone-200 p-6 space-y-5 animate-pulse">
          <div className="h-10 bg-stone-100 rounded-lg w-3/4" />
          <div className="h-24 bg-stone-100 rounded-lg" />
          <div className="h-24 bg-stone-100 rounded-lg" />
          <div className="h-24 bg-stone-100 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Platform Branding"
        description="Upload the Avexora logos shown on the website header, footer, login screens and browser tab (favicon)."
      />

      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-5">
        <div>
          <Label>Brand Name</Label>
          <Input value={form.brand_name || ""} onChange={(e) => set("brand_name")(e.target.value)} placeholder="Avexora ExamOS" />
        </div>

        <LogoUploadField label="Header Logo" hint="Shown in the website navigation bar and app sidebar." value={form.header_logo_url} onChange={set("header_logo_url")} />
        <LogoUploadField label="Footer Logo" hint="Shown in the website footer." value={form.footer_logo_url} onChange={set("footer_logo_url")} />
        <LogoUploadField label="Login Screen Logo" hint="Shown on login, register and password screens." value={form.login_logo_url} onChange={set("login_logo_url")} />
        <LogoUploadField label="Favicon" hint="The small icon shown in the browser tab. Use a square image." value={form.favicon_url} onChange={set("favicon_url")} />

        <div className="flex items-center justify-between border rounded-lg p-3">
          <div>
            <Label>Sidebar Color</Label>
            <p className="text-xs text-stone-500 mt-0.5">Colors the whole sidebar background for super admin and employee accounts.</p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="color"
              className="w-12 h-9"
              value={form.sidebar_color || "#0F172A"}
              onChange={(e) => set("sidebar_color")(e.target.value)}
            />
            <Switch checked={!!form.sidebar_use_color} onCheckedChange={set("sidebar_use_color")} />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Branding"}
        </Button>
      </div>
    </div>
  );
}