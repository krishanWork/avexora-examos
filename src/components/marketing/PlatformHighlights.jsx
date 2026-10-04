import React from "react";
import { Sparkles } from "lucide-react";

const HIGHLIGHTS = [
  "Multi-Tenant SaaS Architecture",
  "White-Label Platform",
  "AI-Powered OMR Recognition",
  "Mobile Camera Scanning",
  "Drag-and-Drop OMR Designer",
  "Automatic Evaluation Engine",
  "Advanced Analytics Dashboard",
  "Parent & Student Portals",
  "Multi-Campus Support",
  "Role-Based Access Control",
  "API Integration Ready",
  "Cloud & On-Premise Deployment Options",
];

export default function PlatformHighlights() {
  return (
    <section className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Platform Highlights</h2>
      <p className="text-stone-400 text-center mb-14">Everything under the hood, at a glance.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {HIGHLIGHTS.map((h) => (
          <div key={h} className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors">
            <Sparkles className="w-4 h-4 text-fuchsia-300 shrink-0" />
            <span className="text-sm text-stone-200">{h}</span>
          </div>
        ))}
      </div>
    </section>
  );
}