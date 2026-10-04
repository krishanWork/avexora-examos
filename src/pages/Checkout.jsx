import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { CheckCircle2, ShieldCheck, ArrowLeft, Sparkles } from "lucide-react";

export default function Checkout() {
  const urlParams = new URLSearchParams(window.location.search);
  const planId = urlParams.get("plan_id");
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [trial, setTrial] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    appClient.functions.invoke("publicSite", { action: "plans" }).then((res) => {
      setPlan(res.data.plans.find((p) => p.id === planId) || null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [planId]);

  const handleStartTrial = async () => {
    setStarting(true);
    setError("");
    try {
      const res = await appClient.functions.invoke("startFreeTrial", { plan_id: plan.id });
      setTrial(res.data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not start your trial. Please try again.");
    }
    setStarting(false);
  };

  return (
    <div className="min-h-screen bg-[#0A0A14] text-white flex items-center justify-center px-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-violet-600/25 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-fuchsia-600/15 blur-[140px]" />

      <div className="relative w-full max-w-md">
        <Link to="/pricing" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-white mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to pricing
        </Link>
        <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-8">
          {loading ? (
            <p className="text-center text-stone-400 py-10">Loading...</p>
          ) : trial ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">Free Trial Activated!</h2>
              <p className="text-sm text-stone-400 mb-6">
                Your {trial.plan_name} trial is active until <span className="text-white font-medium">{trial.trial_ends}</span>. No payment required.
              </p>
              <Link to="/home" className="inline-block px-6 py-3 rounded-2xl font-semibold text-sm bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white">
                Go to Dashboard
              </Link>
            </div>
          ) : !plan ? (
            <p className="text-center text-stone-400 py-10">Plan not found. <Link to="/pricing" className="text-violet-400">Choose a plan</Link></p>
          ) : (
            <>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-semibold mb-4">
                <Sparkles className="w-3.5 h-3.5" /> 30-Day Free Trial
              </div>
              <h1 className="text-2xl font-bold mb-1">Start your free trial</h1>
              <p className="text-sm text-stone-400 mb-6">Try the <span className="text-white font-medium">{plan.name}</span> plan free for 30 days — no payment needed.</p>
              <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-5 mb-6">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-stone-400">Plan</span>
                  <span className="font-medium">{plan.name}</span>
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-stone-400">Plan price after trial</span>
                  <span className="font-medium">₹{plan.price?.toLocaleString("en-IN")} / {plan.billing_cycle}</span>
                </div>
                <div className="border-t border-white/10 mt-3 pt-3 flex items-center justify-between">
                  <span className="text-stone-400 text-sm">Due today</span>
                  <span className="text-2xl font-bold text-emerald-400">₹0</span>
                </div>
              </div>
              {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
              <button onClick={handleStartTrial} disabled={starting}
                className="w-full px-6 py-3.5 rounded-2xl font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 hover:opacity-90 transition-opacity disabled:opacity-50">
                {starting ? "Activating..." : "Start 30-Day Free Trial"}
              </button>
              <p className="flex items-center justify-center gap-1.5 text-xs text-stone-500 mt-4">
                <ShieldCheck className="w-3.5 h-3.5" /> No payment required during the trial
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}