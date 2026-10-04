import React from "react";
import { Sparkles, Building2, GraduationCap, Scan, Phone, Mail } from "lucide-react";

export default function AuthShowcase({ brand, platform }) {
  const brandColor = brand?.primary_color || "#4f46e5";
  const isInstitution = Boolean(brand?.name);

  return (
    <div className="relative w-full h-full flex flex-col justify-between p-10 lg:p-14 overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Background Ambient Glows */}
      <div
        className="absolute -top-32 -right-32 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none transition-all duration-700"
        style={{ backgroundColor: brandColor }}
      />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full blur-3xl opacity-15 pointer-events-none bg-sky-500" />
      
      {/* Subtle Dot Grid Pattern */}
      <div 
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
          backgroundSize: "24px 24px"
        }}
      />

      {/* Top Bar: Brand Pill & Live Status */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur-md border border-white/15 flex items-center justify-center p-1.5 shadow-inner">
            {brand?.logo_url ? (
              <img src={brand.logo_url} alt={brand.name} className="w-full h-full object-contain" />
            ) : platform?.login_logo_url ? (
              <img src={platform.login_logo_url} alt={platform.brand_name || "ExamOS"} className="w-full h-full object-contain" />
            ) : (
              <GraduationCap className="w-full h-full text-indigo-400" />
            )}
          </div>
          <div>
            <span className="text-sm font-semibold tracking-tight text-white">
              {brand?.name || platform?.brand_name || "Avexora ExamOS"}
            </span>
            <span className="text-[11px] text-slate-400 block -mt-0.5 font-mono">
              {isInstitution ? "Institution Portal" : "Evaluation Infrastructure"}
            </span>
          </div>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-emerald-400 shadow-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Systems Active</span>
        </div>
      </div>

      {/* Central Visual Component */}
      <div className="relative z-10 my-auto py-10 max-w-lg">
        {isInstitution ? (
          /* Institutional Custom Branding Showcase */
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs font-medium text-indigo-300">
              <Building2 className="w-3.5 h-3.5" />
              <span>Official Academic Gateway</span>
            </div>

            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight">
              {brand?.login_message || `Welcome to ${brand.name}`}
            </h2>

            <p className="text-sm lg:text-base text-slate-300 leading-relaxed">
              Unified examination workflows, instant OMR scorecards, and continuous academic performance tracking for students, educators, and administrators.
            </p>

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 mb-2">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-semibold text-white">Student & Parent Portal</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">Instant marks, answer sheet copies & term rank tracking.</p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 mb-2">
                  <Scan className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-semibold text-white">Computer Vision OMR</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">High-speed bubble sheet verification & error audits.</p>
              </div>
            </div>

            {/* Campus Contact & Helpline */}
            {(brand?.contact_phone || brand?.contact_email || brand?.address) && (
              <div className="space-y-1.5 border-t border-white/10 pt-4 text-xs text-slate-300">
                {brand.address && (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{brand.address}</span>
                  </div>
                )}
                {(brand.contact_phone || brand.contact_email) && (
                  <div className="flex items-center gap-3 text-slate-300 font-mono text-[11px] pt-1">
                    {brand.contact_phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-indigo-400" />
                        {brand.contact_phone}
                      </span>
                    )}
                    {brand.contact_email && (
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <Mail className="w-3 h-3 text-indigo-400" />
                        {brand.contact_email}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Platform Showcase (ExamOS Core Engine) */
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs font-medium text-sky-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Next-Gen Examination Operating System</span>
            </div>

            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight">
              Evaluation at the speed of thought.
            </h2>

            <p className="text-sm lg:text-base text-slate-300 leading-relaxed">
              Transform campus exams with AI-assisted OMR processing, multi-tenant academic governance, and sub-second evaluation pipelines.
            </p>

            {/* Interactive OMR Sheet Preview Card */}
            <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md shadow-2xl space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-mono font-medium text-slate-200">OMR Engine: Physics Midterm 2026</span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
                  99.8% Precision
                </span>
              </div>

              {/* Simulated OMR Rows */}
              <div className="space-y-2 py-1 font-mono text-xs">
                <div className="flex items-center justify-between text-slate-300 bg-white/[0.02] px-3 py-1.5 rounded-lg">
                  <span className="text-slate-400">Q.24</span>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center text-[10px] text-slate-500">A</span>
                    <span className="w-5 h-5 rounded-full bg-indigo-500 border border-indigo-400 text-white flex items-center justify-center text-[10px] font-bold shadow-xs">B</span>
                    <span className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center text-[10px] text-slate-500">C</span>
                    <span className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center text-[10px] text-slate-500">D</span>
                  </div>
                  <span className="text-emerald-400 text-[11px] font-semibold">Correct (+4)</span>
                </div>

                <div className="flex items-center justify-between text-slate-300 bg-white/[0.02] px-3 py-1.5 rounded-lg">
                  <span className="text-slate-400">Q.25</span>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center text-[10px] text-slate-500">A</span>
                    <span className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center text-[10px] text-slate-500">B</span>
                    <span className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center text-[10px] text-slate-500">C</span>
                    <span className="w-5 h-5 rounded-full bg-indigo-500 border border-indigo-400 text-white flex items-center justify-center text-[10px] font-bold shadow-xs">D</span>
                  </div>
                  <span className="text-emerald-400 text-[11px] font-semibold">Correct (+4)</span>
                </div>
              </div>

              {/* Extraction Stats */}
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/10 text-center font-mono">
                <div className="p-1.5 rounded bg-white/[0.03]">
                  <p className="text-[10px] text-slate-400">Scan Latency</p>
                  <p className="text-xs font-bold text-slate-200">0.38s / sheet</p>
                </div>
                <div className="p-1.5 rounded bg-white/[0.03]">
                  <p className="text-[10px] text-slate-400">Skew Angle</p>
                  <p className="text-xs font-bold text-slate-200">0.04° auto-rect</p>
                </div>
                <div className="p-1.5 rounded bg-white/[0.03]">
                  <p className="text-[10px] text-slate-400">Audit Status</p>
                  <p className="text-xs font-bold text-emerald-400">Verified</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom KPI Bar & Trust Footnote */}
      <div className="relative z-10 pt-6 border-t border-white/10">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xl lg:text-2xl font-bold font-mono text-white">500K+</p>
            <p className="text-xs text-slate-400 mt-0.5">Sheets Evaluated</p>
          </div>
          <div>
            <p className="text-xl lg:text-2xl font-bold font-mono text-white">99.8%</p>
            <p className="text-xs text-slate-400 mt-0.5">Detection Accuracy</p>
          </div>
          <div>
            <p className="text-xl lg:text-2xl font-bold font-mono text-white">&lt;48 hrs</p>
            <p className="text-xs text-slate-400 mt-0.5">Term Turnaround</p>
          </div>
        </div>
      </div>
    </div>
  );
}
