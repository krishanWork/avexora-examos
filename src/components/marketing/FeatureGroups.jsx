import React from "react";
import { CalendarClock, ScanLine, PenTool, Users, Zap, BarChart3, HeartHandshake, Palette, Check } from "lucide-react";

const GROUPS = [
  { icon: CalendarClock, title: "Examination Management", desc: "Plan, schedule, and manage examinations with complete control.", items: ["Exam scheduling", "Multiple exam types", "Academic calendar integration", "Paper set management", "Subject management"] },
  { icon: ScanLine, title: "AI-Powered OMR Evaluation", desc: "Evaluate thousands of answer sheets in minutes.", items: ["Automatic bubble detection", "Mobile camera scanning", "Scanner support", "AI confidence scoring", "Manual verification workflow", "High-accuracy recognition"] },
  { icon: PenTool, title: "Smart OMR Sheet Designer", desc: "Design professional OMR sheets without technical expertise.", items: ["Drag-and-drop designer", "Institution branding", "QR codes", "Barcodes", "Custom layouts", "Security markers"] },
  { icon: Users, title: "Student & Academic Management", desc: "Manage academic information from a centralized dashboard.", items: ["Student profiles", "Teacher management", "Classes & sections", "Academic years", "Subjects", "Bulk imports"] },
  { icon: Zap, title: "Instant Result Processing", desc: "Publish results within minutes.", items: ["Automatic evaluation", "Negative marking", "Custom grading", "Rank generation", "Percentile calculation", "Merit lists"] },
  { icon: BarChart3, title: "Powerful Reports & Analytics", desc: "Turn examination data into actionable insights.", items: ["Student performance", "Class comparison", "Subject analysis", "Question difficulty analysis", "Institution dashboards", "Downloadable reports"] },
  { icon: HeartHandshake, title: "Parent & Student Portal", desc: "Keep everyone informed. Students and parents can securely access:", items: ["Results", "Report cards", "Performance history", "Academic progress", "Notifications"] },
  { icon: Palette, title: "White-Label Ready", desc: "Launch under your own brand — perfect for educational groups, ERP providers, and EdTech companies.", items: ["Logo & colors", "Custom domain", "Login page", "Reports & certificates", "Email templates", "Notifications"] },
];

export default function FeatureGroups() {
  return (
    <section id="features" className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Everything You Need to Run Modern Examinations</h2>
      <p className="text-stone-400 text-center mb-14">Eight complete modules — one intelligent platform.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {GROUPS.map((g) => (
          <div key={g.title} className="p-7 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors">
            <div className="w-11 h-11 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center mb-5">
              <g.icon className="w-5 h-5 text-violet-300" />
            </div>
            <h3 className="font-semibold text-white text-lg mb-2">{g.title}</h3>
            <p className="text-sm text-stone-400 mb-4">{g.desc}</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {g.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-stone-300">
                  <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}