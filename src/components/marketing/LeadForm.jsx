import React, { useState } from "react";
import { appClient } from "@/api/appClient";
import { CheckCircle2 } from "lucide-react";

const inputCls = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-white placeholder:text-stone-500 text-sm focus:outline-none focus:border-violet-400/60 focus:bg-white/[0.08] transition-colors";

export default function LeadForm({ type, submitLabel, showDate = false }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", organization: "", message: "", preferred_date: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await appClient.functions.invoke("publicSite", { action: "lead", type, ...form });
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSending(false);
  };

  if (sent) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white">Thank you!</h3>
        <p className="text-sm text-stone-400">We've received your request and will get back to you shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="p6-lead-name" className="sr-only">Full name</label>
          <input id="p6-lead-name" required placeholder="Full name *" value={form.name} onChange={set("name")} className={inputCls} />
        </div>
        <div>
          <label htmlFor="p6-lead-email" className="sr-only">Email address</label>
          <input id="p6-lead-email" required type="email" placeholder="Email address *" value={form.email} onChange={set("email")} className={inputCls} />
        </div>
        <div>
          <label htmlFor="p6-lead-phone" className="sr-only">Phone number</label>
          <input id="p6-lead-phone" placeholder="Phone number" value={form.phone} onChange={set("phone")} className={inputCls} />
        </div>
        <div>
          <label htmlFor="p6-lead-org" className="sr-only">Institution / Organization</label>
          <input id="p6-lead-org" placeholder="Institution / Organization" value={form.organization} onChange={set("organization")} className={inputCls} />
        </div>
      </div>
      {showDate && (
        <div>
          <label htmlFor="p6-lead-date" className="sr-only">Preferred date</label>
          <input id="p6-lead-date" type="datetime-local" value={form.preferred_date} onChange={set("preferred_date")} className={`${inputCls} [color-scheme:dark]`} />
        </div>
      )}
      <div>
        <label htmlFor="p6-lead-message" className="sr-only">Message</label>
        <textarea id="p6-lead-message" rows={4} placeholder={type === "demo" ? "Tell us about your institution and needs..." : "Your message..."}
          value={form.message} onChange={set("message")}
          className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-white placeholder:text-stone-500 text-sm focus:outline-none focus:border-violet-400/60 focus:bg-white/[0.08] transition-colors resize-none" />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={sending}
        className="w-full md:w-auto px-7 py-3 rounded-2xl font-semibold text-sm bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 hover:opacity-90 transition-opacity disabled:opacity-50">
        {sending ? "Sending..." : submitLabel}
      </button>
    </form>
  );
}
