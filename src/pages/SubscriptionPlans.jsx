import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { ErrorCard } from "@/components/shared/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import PlanFormDialog from "@/components/plans/PlanFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Plus, Pencil } from "lucide-react";

export default function SubscriptionPlans() {
  const { user } = useOutletContext() || {};
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlans(await appClient.entities.SubscriptionPlan.list("-created_date"));
    } catch (err) {
      console.error("Failed to load subscription plans:", err);
      setError("Failed to load subscription plans. Please check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data) => {
    if (editing) {
      await appClient.entities.SubscriptionPlan.update(editing.id, data);
      await logAudit({ user, action: "update", entity_type: "SubscriptionPlan", entity_id: editing.id, details: data.name });
    } else {
      const created = await appClient.entities.SubscriptionPlan.create(data);
      await logAudit({ user, action: "create", entity_type: "SubscriptionPlan", entity_id: created.id, details: data.name });
    }
    setDialogOpen(false);
    setEditing(null);
    load();
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Subscription Plans"
        description="Define pricing tiers and feature access for institutions, including white-label eligibility."
        actions={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> New Plan
          </Button>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
              <div className="flex justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-7 w-20" />
                </div>
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
              <Skeleton className="h-4 w-44" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorCard message={error} onRetry={load} />
      ) : plans.length === 0 ? (
        <EmptyState icon={CreditCard} title="No plans yet" description="Create your first subscription plan." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-heading font-bold text-stone-900">{p.name}</h3>
                  <p className="text-2xl font-heading font-bold mt-1">₹{p.price}<span className="text-sm font-normal text-stone-400">/{p.billing_cycle}</span></p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                  <Pencil className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-stone-500 mb-3">
                {p.student_limit} students · {p.omr_sheet_limit} OMR sheets/mo
              </p>
              <div className="flex flex-wrap gap-1.5">
                {p.white_label_enabled && <Badge className="bg-amber-100 text-amber-700">White Label</Badge>}
                {p.hide_powered_by_enabled && <Badge className="bg-purple-100 text-purple-700">No Avexora Branding</Badge>}
                {p.ai_enabled && <Badge variant="secondary">AI</Badge>}
                {p.parent_portal_enabled && <Badge variant="secondary">Parent Portal</Badge>}
                {p.whatsapp_enabled && <Badge variant="secondary">WhatsApp</Badge>}
                {p.custom_domain_enabled && <Badge variant="secondary">Custom Domain</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}

      <PlanFormDialog open={dialogOpen} onOpenChange={setDialogOpen} plan={editing} onSave={handleSave} />
    </div>
  );
}