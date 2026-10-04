import React from "react";

const STEPS = [
  "Create your examination and configure subjects, marking schemes, and paper sets.",
  "Generate branded OMR sheets using the built-in visual designer.",
  "Students complete their examinations.",
  "Upload scanned sheets or capture them using a mobile device.",
  "The AI engine automatically recognizes responses and evaluates answer sheets.",
  "Review results, publish report cards, and analyze academic performance.",
];

export default function HowItWorks() {
  return (
    <section className="pb-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-3">How It Works</h2>
      <p className="text-stone-400 text-center mb-14">From exam creation to published results in six simple steps.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {STEPS.map((step, i) => (
          <div key={i} className="p-7 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center font-bold text-white text-sm mb-5">
              {i + 1}
            </div>
            <p className="text-sm text-stone-300 leading-relaxed">{step}</p>
          </div>
        ))}
      </div>
    </section>
  );
}