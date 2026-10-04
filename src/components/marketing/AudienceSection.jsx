import React from "react";
import { School, Library, Landmark, Target, Building } from "lucide-react";

const AUDIENCES = [
  { icon: School, title: "Schools", desc: "Conduct internal assessments efficiently with automated evaluation and performance tracking." },
  { icon: Library, title: "Colleges", desc: "Manage semester examinations, departments, and large student databases with ease." },
  { icon: Landmark, title: "Universities", desc: "Support high-volume assessments with scalable processing and centralized administration." },
  { icon: Target, title: "Coaching Institutes", desc: "Run mock tests, entrance preparation exams, and scholarship assessments with detailed analytics." },
  { icon: Building, title: "Government & Recruitment Bodies", desc: "Conduct secure, standardized examinations with enterprise-grade reliability." },
];

export default function AudienceSection() {
  return (
    <section id="solutions" className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Designed for Every Educational Institution</h2>
      <p className="text-stone-400 text-center mb-14">From a single classroom to statewide examinations.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {AUDIENCES.map((a) => (
          <div key={a.title} className="p-7 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors">
            <div className="w-11 h-11 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center mb-5">
              <a.icon className="w-5 h-5 text-cyan-300" />
            </div>
            <h3 className="font-semibold text-white mb-2">{a.title}</h3>
            <p className="text-sm text-stone-400 leading-relaxed">{a.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}