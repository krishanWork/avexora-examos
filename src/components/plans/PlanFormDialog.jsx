import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const FEATURE_FLAGS = [
  ["omr_enabled", "OMR Processing"],
  ["parent_portal_enabled", "Parent Portal"],
  ["student_portal_enabled", "Student Portal"],
  ["whatsapp_enabled", "WhatsApp"],
  ["sms_enabled", "SMS"],
  ["analytics_enabled", "Analytics"],
  ["ai_enabled", "AI"],
  ["white_label_enabled", "White Label"],
  ["hide_powered_by_enabled", "Hide 'Powered by Avexora'"],
  ["custom_domain_enabled", "Custom Domain"],
];

export default function PlanFormDialog({ open, onOpenChange, plan, onSave }) {
  const [form, setForm] = useState({});

  useEffect(() => {
    setForm(
      plan || {
        name: "",
        price: 0,
        billing_cycle: "monthly",
        student_limit: 500,
        omr_sheet_limit: 1000,
        exam_limit: 50,
        omr_enabled: true,
        parent_portal_enabled: true,
        student_portal_enabled: true,
        whatsapp_enabled: false,
        sms_enabled: false,
        analytics_enabled: true,
        ai_enabled: true,
        white_label_enabled: false,
        hide_powered_by_enabled: false,
        custom_domain_enabled: false,
        is_active: true,
      }
    );
  }, [plan, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? "Edit Plan" : "Create Subscription Plan"}</DialogTitle>
        </DialogHeader>
        <form id="p6-plan-form" onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p6-plan-name">Plan Name</Label>
              <Input id="p6-plan-name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="p6-plan-price">Price (₹)</Label>
              <Input id="p6-plan-price" type="number" min="0" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="p6-plan-billing">Billing Cycle</Label>
              <Select value={form.billing_cycle || "monthly"} onValueChange={(v) => setForm({ ...form, billing_cycle: v })}>
                <SelectTrigger id="p6-plan-billing"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p6-plan-student-limit">Student Limit</Label>
              <Input id="p6-plan-student-limit" type="number" min="0" value={form.student_limit ?? 0} onChange={(e) => setForm({ ...form, student_limit: Number(e.target.value) })} />
            </div>
            <div>
              <Label htmlFor="p6-plan-omr-limit">OMR Sheets/mo</Label>
              <Input id="p6-plan-omr-limit" type="number" min="0" value={form.omr_sheet_limit ?? 0} onChange={(e) => setForm({ ...form, omr_sheet_limit: Number(e.target.value) })} />
            </div>
          </div>
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium mb-1">Feature Toggles</p>
            <div className="grid grid-cols-2 gap-2">
              {FEATURE_FLAGS.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-stone-600">{label}</span>
                  <Switch checked={!!form[key]} onCheckedChange={(v) => setForm({ ...form, [key]: v })} />
                </div>
              ))}
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="p6-plan-form" disabled={!form.name}>Save Plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
