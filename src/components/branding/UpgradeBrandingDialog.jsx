import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export default function UpgradeBrandingDialog({ open, onOpenChange }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    appClient.entities.SubscriptionPlan.filter({ is_active: true }).then((list) => {
      setPlans(list.filter((p) => p.hide_powered_by_enabled || p.white_label_enabled));
      setLoading(false);
    });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" /> Upgrade to hide branding
          </DialogTitle>
          <DialogDescription>
            Hiding the "Powered by Avexora ExamOS" credit is available on the plans below. Subscribe to unlock it.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-stone-400 py-6 text-center">Loading plans...</p>
        ) : plans.length === 0 ? (
          <p className="text-sm text-stone-400 py-6 text-center">No plans currently offer this option. Please contact support.</p>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-semibold text-stone-900">{p.name}</p>
                  <p className="text-xs text-stone-500">₹{p.price?.toLocaleString("en-IN")} / {p.billing_cycle}</p>
                </div>
                <Button size="sm" asChild>
                  <Link to={`/checkout?plan_id=${p.id}`}>Subscribe</Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}