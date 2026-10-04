import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Check } from "lucide-react";

const planFeatures = (p) => [
  `Up to ${p.student_limit?.toLocaleString()} students`,
  `${p.omr_sheet_limit?.toLocaleString()} OMR sheets / month`,
  `${p.exam_limit?.toLocaleString()} examinations`,
  p.analytics_enabled && "Advanced analytics",
  p.parent_portal_enabled && "Parent portal",
  p.whatsapp_enabled && "WhatsApp notifications",
  p.sms_enabled && "SMS notifications",
  p.white_label_enabled && "White-label branding",
  p.custom_domain_enabled && "Custom domain",
].filter(Boolean);

export default function Pricing() {
  const [plans, setPlans] = useState(null);

  useEffect(() => {
    appClient.functions.invoke("publicSite", { action: "plans" })
      .then((res) => setPlans(res.data.plans))
      .catch(() => setPlans([]));
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
        Simple, <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">transparent</span> pricing
      </h1>
      <p className="text-stone-400 text-center mb-14">Pick the plan that fits your institution. Upgrade anytime.</p>
      {!plans ? (
        <div className="text-center py-20 text-stone-500">Loading plans...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
          {plans.map((p, i) => {
            const popular = i === 1;
            return (
              <div key={p.id} className={`relative rounded-3xl p-8 flex flex-col backdrop-blur-xl ${popular
                ? "bg-gradient-to-b from-violet-500/15 to-white/[0.04] border border-violet-400/40 shadow-2xl shadow-violet-500/20"
                : "bg-white/[0.04] border border-white/10"}`}>
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-semibold px-4 py-1 rounded-full shadow-lg shadow-violet-500/30">Most Popular</span>
                )}
                <h3 className="font-semibold text-white text-lg">{p.name}</h3>
                <div className="mt-3 mb-7">
                  <span className="text-4xl font-bold text-white">₹{p.price?.toLocaleString("en-IN")}</span>
                  <span className="text-stone-400 text-sm"> / {p.billing_cycle}</span>
                </div>
                <ul className="space-y-3 flex-1 mb-8">
                  {planFeatures(p).map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-stone-300">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0 mt-px">
                        <Check className="w-3 h-3 text-emerald-400" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to={`/checkout?plan_id=${p.id}`}
                  className={`text-center px-5 py-3 rounded-2xl font-semibold text-sm transition-opacity ${popular
                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 hover:opacity-90"
                    : "bg-white/[0.06] border border-white/10 text-white hover:bg-white/10"}`}>
                  Start 30-Day Free Trial
                </Link>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-center text-sm text-stone-400 mt-12">
        Need a custom plan for a large institution? <Link to="/contact" className="text-violet-400 font-medium hover:text-violet-300">Contact our sales team</Link>
      </p>
    </div>
  );
}