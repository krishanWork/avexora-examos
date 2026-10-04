import React from "react";
import LeadForm from "@/components/marketing/LeadForm";
import { CalendarClock } from "lucide-react";

export default function BookDemo() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 flex items-center justify-center mx-auto mb-5">
          <CalendarClock className="w-6 h-6 text-violet-300" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Book a <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Demo Call</span>
        </h1>
        <p className="text-stone-400">See Avexora ExamOS in action — a 30-minute personalized walkthrough for your institution. Pick a preferred date and time below.</p>
      </div>
      <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-6 md:p-8">
        <LeadForm type="demo" submitLabel="Request Demo" showDate />
      </div>
    </div>
  );
}