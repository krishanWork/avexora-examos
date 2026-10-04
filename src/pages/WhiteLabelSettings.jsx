import React, { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import PageHeader from "@/components/shared/PageHeader";
import { DetailSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { UploadCloud, Save, Lock } from "lucide-react";
import UpgradeBrandingDialog from "@/components/branding/UpgradeBrandingDialog";
import CustomDomainSetup from "@/components/branding/CustomDomainSetup";

export default function WhiteLabelSettings() {
  const { user, tenant } = useOutletContext() || {};
  const { toast } = useToast();
  const [plan, setPlan] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (tenant?.subscription_plan_id) {
        setPlan(await appClient.entities.SubscriptionPlan.get(tenant.subscription_plan_id));
      }
      setForm(tenant || {});
    };
    load();
  }, [tenant]);

  const eligible = plan?.white_label_enabled;
  // White-label plans inherently include hiding the Avexora credit
  const canHidePoweredBy = !!(plan?.hide_powered_by_enabled || plan?.white_label_enabled);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const { file_url } = await appClient.integrations.Core.UploadFile({ file, purpose: "logo" });
      setForm((f) => ({ ...f, logo_url: file_url }));
    } finally {
      setUploadingLogo(false);
    }
  };

  const reloadTenant = async () => {
    const tid = tenant?.id || user?.tenant_id;
    if (tid) {
      try {
        const res = await appClient.functions.invoke("getMyTenant", { tenant_id: tid });
        if (res.data?.tenant) {
          setForm((f) => ({ ...f, ...res.data.tenant }));
        }
      } catch (err) {
        console.error("Failed to reload tenant:", err);
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await appClient.entities.Tenant.update(tenant.id, {
        logo_url: form.logo_url,
        address: form.address,
        favicon_url: form.favicon_url,
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
        accent_color: form.accent_color,
        sidebar_use_secondary_color: !!form.sidebar_use_secondary_color,
        login_message: form.login_message,
        custom_domain: form.custom_domain || "",
        powered_by_avexora: form.powered_by_avexora,
        white_label_enabled: form.white_label_enabled,
      });
      if (updated) {
        setForm((f) => ({ ...f, ...updated }));
      }
      await logAudit({ user, tenant_id: tenant.id, action: "update_white_label", entity_type: "Tenant", entity_id: tenant.id });
      toast({ title: "Branding updated" });
    } finally {
      setSaving(false);
    }
  };

  if (!tenant) {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
        <DetailSkeleton />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Branding" description="Customize the platform to match your institution's identity. Your logo, address and colors appear on OMR sheets and on the student & parent portals." />

      <div className="bg-white rounded-md border border-stone-200 p-5 space-y-4">
        <div>
          <Label>Logo</Label>
          <div className="flex items-center gap-3 mt-1">
            {form.logo_url && <img src={form.logo_url} alt="Logo" className="w-10 h-10 rounded object-cover border" />}
            <label className="inline-flex items-center gap-2 text-sm border border-stone-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-stone-50">
              <UploadCloud className="w-4 h-4" /> {uploadingLogo ? "Uploading..." : "Upload Logo"}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploadingLogo} />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Primary Color</Label>
            <Input type="color" className="h-10" value={form.primary_color || "#4F46E5"} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
          </div>
          <div>
            <Label>Secondary Color</Label>
            <Input type="color" className="h-10" value={form.secondary_color || "#0F172A"} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} />
          </div>
          <div>
            <Label>Accent Color</Label>
            <Input type="color" className="h-10" value={form.accent_color || "#10B981"} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center justify-between border rounded-lg p-3">
          <div>
            <p className="text-sm font-medium">Use Secondary Color for the Sidebar</p>
            <p className="text-xs text-stone-500 mt-0.5">
              Makes the whole sidebar background use your secondary color.
              <span className="inline-flex items-center gap-1.5 ml-2">
                <span className="inline-block w-3 h-3 rounded-full border border-stone-300" style={{ backgroundColor: form.secondary_color || "#0F172A" }} />
                <span className="text-stone-500">{form.secondary_color || "#0F172A"}</span>
              </span>
            </p>
          </div>
          <Switch checked={!!form.sidebar_use_secondary_color} onCheckedChange={(v) => setForm({ ...form, sidebar_use_secondary_color: v })} />
        </div>

        <div>
          <Label>Institution Address</Label>
          <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, City, State, PIN" />
          <p className="text-xs text-stone-400 mt-1">Printed on OMR sheets and report cards, and shown on portals.</p>
        </div>

        <div>
          <Label>Login Page Message</Label>
          <Input value={form.login_message || ""} onChange={(e) => setForm({ ...form, login_message: e.target.value })} placeholder="Welcome to..." />
        </div>

        {/* White-label features — gated by subscription plan */}
        <div className="border rounded-lg p-4 space-y-4 bg-stone-50/60">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-stone-400" />
            <p className="text-sm font-semibold text-stone-700">White Label {!eligible && <span className="font-normal text-stone-400">— requires plan upgrade</span>}</p>
          </div>

          <div className="flex items-center justify-between border rounded-lg p-3 bg-white">
            <div>
              <p className="text-sm font-medium">Enable White Label</p>
              <p className="text-xs text-stone-500">Show only your branding — hide Avexora's identity across the app.</p>
            </div>
            <Switch checked={!!form.white_label_enabled} disabled={!eligible} onCheckedChange={(v) => setForm({ ...form, white_label_enabled: v })} />
          </div>

          <div>
            <CustomDomainSetup
              tenant={tenant}
              disabled={!eligible || !plan?.custom_domain_enabled}
              value={form.custom_domain || ""}
              onChange={(v) => setForm({ ...form, custom_domain: v })}
              onUpdated={reloadTenant}
            />
            {!plan?.custom_domain_enabled && <p className="text-xs text-stone-400 mt-1">Custom domains require a plan with custom domain support.</p>}
          </div>

          <div className="flex items-center justify-between border rounded-lg p-3 bg-white">
            <div>
              <p className="text-sm font-medium">"Powered by Avexora ExamOS"</p>
              <p className="text-xs text-stone-500">
                Show a small Avexora credit on PDFs and portals.
                {!canHidePoweredBy && <span className="text-amber-600"> Hiding it requires a plan upgrade.</span>}
              </p>
            </div>
            <Switch
              checked={form.powered_by_avexora !== false}
              onCheckedChange={(v) => {
                if (!v && !canHidePoweredBy) {
                  setUpgradeOpen(true);
                  return;
                }
                setForm({ ...form, powered_by_avexora: v });
              }}
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> Save Branding
        </Button>
      </div>

      <UpgradeBrandingDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
}