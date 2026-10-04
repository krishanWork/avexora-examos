import React, { useState } from "react";
import { Plus } from "lucide-react";

const FAQS = [
  { q: "Can we use a mobile phone instead of a scanner?", a: "Yes. ExamOS supports mobile camera scanning with automatic image correction and AI-powered recognition." },
  { q: "Can we customize the OMR sheet?", a: "Yes. You can design your own branded OMR sheets using the built-in designer." },
  { q: "Is the platform suitable for multiple campuses?", a: "Yes. ExamOS supports multi-campus and multi-branch institutions from a single platform." },
  { q: "Can we use our own branding?", a: "Absolutely. The platform supports complete white-label customization, including logos, colors, domains, certificates, and reports." },
  { q: "Does the platform support negative marking?", a: "Yes. Multiple evaluation models, including negative marking, custom grading, bonus questions, and grace marks, are supported." },
  { q: "Is our data secure?", a: "Yes. The platform uses modern security practices including encryption, role-based access control, audit logging, and secure cloud infrastructure." },
];

export default function FaqSection() {
  const [open, setOpen] = useState(0);

  return (
    <section className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">Frequently asked questions</h2>
      <p className="text-stone-400 text-center mb-14">Everything you need to know before getting started.</p>
      <div className="max-w-3xl mx-auto space-y-3">
        {FAQS.map((faq, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className={`rounded-2xl bg-white/[0.04] backdrop-blur-xl border transition-colors ${isOpen ? "border-violet-400/30" : "border-white/10 hover:border-white/20"}`}>
              <button onClick={() => setOpen(isOpen ? -1 : i)}
                className="w-full flex items-center justify-between gap-4 p-5 text-left">
                <span className="font-medium text-white">{faq.q}</span>
                <Plus className={`w-5 h-5 shrink-0 text-violet-300 transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`} />
              </button>
              <div className={`grid transition-all duration-300 ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm text-stone-400 leading-relaxed">{faq.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}