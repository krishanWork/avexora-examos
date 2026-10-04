import React from "react";
import LeadForm from "@/components/marketing/LeadForm";
import { Mail, Phone, MapPin } from "lucide-react";

const INFO = [
  [Mail, "hello@avexora.ai"],
  [Phone, "+91 90000 00000"],
  [MapPin, "India"],
];

export default function Contact() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <h1 className="text-4xl md:text-5xl font-bold mb-4">
        Contact <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Us</span>
      </h1>
      <p className="text-stone-400 mb-12">Questions about plans, onboarding or partnerships? We'd love to hear from you.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-4">
          {INFO.map(([Icon, text]) => (
            <div key={text} className="flex items-center gap-3 p-4 rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 text-sm text-stone-300">
              <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-violet-300" />
              </div>
              {text}
            </div>
          ))}
        </div>
        <div className="md:col-span-2 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-6 md:p-8">
          <LeadForm type="contact" submitLabel="Send Message" />
        </div>
      </div>
    </div>
  );
}