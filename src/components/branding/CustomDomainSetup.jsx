import React, { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Globe, CheckCircle2, RefreshCw } from "lucide-react";
import DnsRecordsGuide from "@/components/branding/DnsRecordsGuide";
import CustomDomainStatus from "@/components/branding/CustomDomainStatus";

export default function CustomDomainSetup({ tenant, disabled, onUpdated, value, onChange }) {
  const { toast } = useToast();
  const internal = useState(tenant?.custom_domain || "");
  const isControlled = value !== undefined;
  const domain = isControlled ? value : internal[0];
  const setDomain = (next) => {
    if (!isControlled) internal[1](next);
    onChange?.(next);
  };
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState(tenant?.custom_domain_status);

  useEffect(() => {
    setStatus(tenant?.custom_domain_status);
  }, [tenant?.custom_domain_status]);

  const handleVerify = async () => {
    if (!domain.trim()) return;
    setVerifying(true);
    setResult(null);
    try {
      const res = await appClient.functions.invoke("verifyCustomDomain", {
        tenant_id: tenant?.id || tenant?._id,
        custom_domain: domain.trim(),
        domain: domain.trim(),
      });
      const { live, verified, found_record, message } = res.data || {};
      setStatus(live ? "live" : verified ? "verified" : "pending");
      setResult({ live: !!live, verified: !!verified, found_record, message });
      toast({ title: live ? "Domain is live!" : verified ? "Domain verified!" : "Not verified", description: message });
      onUpdated?.();
    } catch (err) {
      toast({ title: "Could not verify domain", description: err?.message, variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Custom Domain</Label>
        {status && status !== "none" && domain?.trim() && (
          <CustomDomainStatus status={status} verified={tenant?.custom_domain_verified} degraded={tenant?.domain_degraded} />
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="exam.yourschool.edu"
          disabled={disabled}
        />
        <Button onClick={handleVerify} disabled={disabled || verifying || !domain.trim()} variant="outline" className="shrink-0">
          {verifying ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
          {status === "verified" || status === "live" ? "Re-verify" : "Verify DNS"}
        </Button>
      </div>
      {!disabled && (
        <p className="text-xs text-stone-500">
          Save Branding persists the domain as <span className="font-medium">Pending</span>. Click Verify DNS to check propagation — a failed check still saves the domain as Pending, so admins never lose track of it.
        </p>
      )}

      {!disabled && domain.trim() && status !== "live" && (
        <DnsRecordsGuide domain={domain} />
      )}

      {result && result.message && (
        <p className={`text-xs ${result.live ? "text-emerald-600" : result.verified ? "text-indigo-600" : "text-amber-600"}`}>
          {result.message}
        </p>
      )}
      {result && !result.verified && result.found_record && (
        <p className="text-xs text-stone-500">Found: <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">{result.found_record}</code> — not the expected target.</p>
      )}
      {status === "verified" && tenant?.hosting_status === "configuring" && Array.isArray(tenant?.hosting_verification) && tenant.hosting_verification.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 space-y-1">
          <p className="text-[11px] font-semibold text-amber-800">Hosting ownership records — add these at your DNS provider</p>
          {tenant.hosting_verification.map((r, i) => (
            <p key={i} className="text-[11px] font-mono text-amber-700">
              {r.type} {r.name ? `for ${r.name}` : ""} = &quot;{r.required}&quot;
            </p>
          ))}
        </div>
      )}
      {status === "verified" && (
        <p className="text-xs text-indigo-600">DNS verified ✓ — our team will activate your domain on the hosting shortly. You'll then be able to access the platform at your own address.</p>
      )}
      {status === "live" && (
        <p className="text-xs text-emerald-600">Domain is live — visitors reach your branded portal at this address.</p>
      )}
    </div>
  );
}