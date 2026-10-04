import React from "react";
import { ScanLine, Smartphone, Layers, Palette, Cloud, BarChart3 } from "lucide-react";

const ITEMS = [
  { icon: ScanLine, label: "AI-Powered OMR Evaluation" },
  { icon: Smartphone, label: "Mobile Camera & Scanner Support" },
  { icon: Layers, label: "Multi-Tenant SaaS" },
  { icon: Palette, label: "White-Label Ready" },
  { icon: Cloud, label: "Cloud & Enterprise Deployment" },
  { icon: BarChart3, label: "Advanced Academic Analytics" },
];

export default function TrustedStrip() {
  return (
    <section className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Trusted for Modern Assessments</h2>
      <p className="text-stone-400 text-center max-w-2xl mx-auto mb-10">
        Conduct faster, smarter, and more accurate examinations with a secure, scalable, and fully customizable platform.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {ITEMS.map((item) => (
          <div key={item.label} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 text-sm text-stone-300">
            <item.icon className="w-4 h-4 text-violet-300" /> {item.label}
          </div>
        ))}
      </div>
    </section>
  );
}