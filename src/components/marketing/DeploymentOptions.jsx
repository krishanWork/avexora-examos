import React from "react";
import { Cloud, Server, Palette } from "lucide-react";

const OPTIONS = [
  { icon: Cloud, title: "Cloud SaaS", desc: "Ideal for institutions seeking a fully managed, subscription-based solution with automatic updates." },
  { icon: Server, title: "Enterprise", desc: "Dedicated deployment with custom infrastructure, advanced integrations, and enhanced security controls." },
  { icon: Palette, title: "White-Label", desc: "Offer ExamOS under your own brand with complete customization and independent tenant management." },
];

export default function DeploymentOptions() {
  return (
    <section className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Flexible Deployment Options</h2>
      <p className="text-stone-400 text-center mb-14">Choose the model that fits your organization.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {OPTIONS.map((o) => (
          <div key={o.title} className="p-7 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center mb-5">
              <o.icon className="w-5 h-5 text-violet-300" />
            </div>
            <h3 className="font-semibold text-white text-lg mb-2">{o.title}</h3>
            <p className="text-sm text-stone-400 leading-relaxed">{o.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}