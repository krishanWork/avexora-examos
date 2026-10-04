import React from "react";
import { Link } from "react-router-dom";
import usePlatformBranding from "@/hooks/usePlatformBranding";

export default function MarketingFooter() {
  const branding = usePlatformBranding();
  return (
    <footer className="relative z-10 mt-20">
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-8 md:p-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                {branding?.footer_logo_url ? (
                  <img src={branding.footer_logo_url} alt="Avexora ExamOS" className="h-8 rounded-xl object-contain" />
                ) : (
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center font-bold text-white text-sm">A</div>
                )}
                
              </div>
              <p className="text-sm text-stone-300 font-medium mb-2">The Intelligent Examination Operating System.</p>
              <p className="text-sm text-stone-400 leading-relaxed">AI-powered examination management, OMR evaluation, analytics, and institutional automation for modern education.</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-4">Product</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="/#features" className="text-stone-300 hover:text-white transition-colors">Features</a></li>
                <li><a href="/#solutions" className="text-stone-300 hover:text-white transition-colors">Solutions</a></li>
                <li><Link to="/pricing" className="text-stone-300 hover:text-white transition-colors">Pricing</Link></li>
                <li><Link to="/book-demo" className="text-stone-300 hover:text-white transition-colors">Book a Demo</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-4">Company</h4>
              <ul className="space-y-3 text-sm">
                <li><Link to="/contact" className="text-stone-300 hover:text-white transition-colors">Support</Link></li>
                <li><Link to="/contact" className="text-stone-300 hover:text-white transition-colors">Contact</Link></li>
                <li><Link to="/privacy" className="text-stone-300 hover:text-white transition-colors">Privacy Policy</Link></li>
                <li><Link to="/terms" className="text-stone-300 hover:text-white transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 mt-10 pt-6 text-center text-xs text-stone-500">
            © {new Date().getFullYear()} Avexora AI (OPC) Private Limited. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}