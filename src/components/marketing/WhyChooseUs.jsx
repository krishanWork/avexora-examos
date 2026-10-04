import React from "react";
import { Clock, Target, TrendingUp, Lightbulb, Lock } from "lucide-react";

const REASONS = [
  { icon: Clock, title: "Save Time", desc: "Reduce manual evaluation and administrative work through intelligent automation." },
  { icon: Target, title: "Improve Accuracy", desc: "Minimize human error with AI-assisted OMR recognition and configurable verification workflows." },
  { icon: TrendingUp, title: "Scale with Confidence", desc: "Process thousands of answer sheets while maintaining consistent performance." },
  { icon: Lightbulb, title: "Make Better Decisions", desc: "Use advanced analytics to identify learning gaps, measure outcomes, and improve academic performance." },
  { icon: Lock, title: "Secure by Design", desc: "Protect institutional data with role-based access control, encryption, audit logs, and secure cloud infrastructure." },
];

export default function WhyChooseUs() {
  return (
    <section className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Why Institutions Choose Avexora ExamOS</h2>
      <p className="text-stone-400 text-center mb-14">Built by exam people, for exam people.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {REASONS.map((r) => (
          <div key={r.title} className="p-7 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors">
            <div className="w-11 h-11 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center mb-5">
              <r.icon className="w-5 h-5 text-cyan-300" />
            </div>
            <h3 className="font-semibold text-white mb-2">{r.title}</h3>
            <p className="text-sm text-stone-400 leading-relaxed">{r.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}