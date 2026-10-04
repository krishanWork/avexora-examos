import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import TrustedStrip from "@/components/marketing/TrustedStrip";
import WhyExamOS from "@/components/marketing/WhyExamOS";
import FeatureGroups from "@/components/marketing/FeatureGroups";
import AudienceSection from "@/components/marketing/AudienceSection";
import WhyChooseUs from "@/components/marketing/WhyChooseUs";
import PlatformHighlights from "@/components/marketing/PlatformHighlights";
import HowItWorks from "@/components/marketing/HowItWorks";
import DeploymentOptions from "@/components/marketing/DeploymentOptions";
import FaqSection from "@/components/marketing/FaqSection";

const STATS = [
  ["99.2%", "OMR accuracy"],
  ["<60s", "Sheet to result"],
  ["100%", "Tenant isolation"],
  ["24/7", "Portal access"],
];

export default function Landing() {
  return (
    <div className="max-w-6xl mx-auto px-4">
      {/* Hero */}
      <section className="text-center pt-16 pb-24">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.06] backdrop-blur-xl border border-white/10 text-sm text-stone-300 mb-8">
          <Sparkles className="w-4 h-4 text-violet-400" /> AI-powered examination management
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
          Run every exam on
          <br />
          <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">one intelligent OS</span>
        </h1>
        <p className="text-lg text-stone-400 max-w-2xl mx-auto mb-10">
          From exam creation and OMR scanning to instant evaluation, ranked results and branded report cards — the complete examination lifecycle for schools, coaching institutes and universities.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/book-demo" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-xl shadow-violet-500/30 hover:opacity-90 transition-opacity">
            Book a Live Demo <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/pricing" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-semibold bg-white/[0.06] backdrop-blur-xl border border-white/10 text-white hover:bg-white/10 transition-colors">
            View Plans
          </Link>
        </div>
      </section>

      {/* Stats strip */}
      <section className="mb-24">
        <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 grid grid-cols-2 md:grid-cols-4 divide-x divide-white/5">
          {STATS.map(([value, label]) => (
            <div key={label} className="p-8 text-center">
              <div className="text-3xl font-bold bg-gradient-to-r from-white to-stone-400 bg-clip-text text-transparent mb-1">{value}</div>
              <div className="text-sm text-stone-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <TrustedStrip />

      <WhyExamOS />

      <FeatureGroups />

      <AudienceSection />

      <WhyChooseUs />

      <PlatformHighlights />

      <HowItWorks />

      <DeploymentOptions />

      <FaqSection />

      {/* CTA */}
      <section className="pb-8">
        <div className="relative rounded-3xl overflow-hidden bg-white/[0.04] backdrop-blur-xl border border-white/10 p-12 md:p-16 text-center">
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-violet-600/30 blur-[100px]" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Modernize Your Examination Process?</h2>
            <p className="text-stone-400 max-w-2xl mx-auto mb-8">
              Join forward-thinking educational institutions that are replacing manual examination workflows with intelligent automation. Experience faster evaluations, better academic insights, and a seamless examination lifecycle — all from one platform.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/book-demo" className="px-7 py-3.5 rounded-2xl font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-xl shadow-violet-500/30 hover:opacity-90 transition-opacity">
                Book a Live Demo
              </Link>
              <Link to="/pricing" className="px-7 py-3.5 rounded-2xl font-semibold bg-white/[0.06] border border-white/10 text-white hover:bg-white/10 transition-colors">
                Start Your Free Trial
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}