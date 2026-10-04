import React from "react";

const SECTIONS = [
  ["1. Acceptance of Terms", "By accessing or using Avexora ExamOS (\"the Service\"), you agree to be bound by these Terms & Conditions. If you are entering into these terms on behalf of an institution, you represent that you have authority to bind that institution."],
  ["2. The Service", "Avexora ExamOS is a cloud-based examination management platform providing exam creation, OMR scanning and evaluation, result publication, analytics and related services on a subscription basis."],
  ["3. Accounts & Responsibilities", "You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must provide accurate institutional information and ensure your users comply with these terms."],
  ["4. Subscriptions & Payment", "Access to the Service requires an active subscription plan. Fees are billed in advance per the selected billing cycle and are non-refundable except as required by law. We may revise pricing with 30 days' notice before your next billing cycle."],
  ["5. Data Ownership", "Your institution retains full ownership of all data uploaded to the platform, including student records, examination data and results. We process this data solely to provide the Service."],
  ["6. Acceptable Use", "You may not misuse the Service, attempt to access other tenants' data, reverse engineer the platform, or use it for any unlawful purpose. We may suspend accounts that violate these terms."],
  ["7. Availability & Support", "We strive for high availability but do not guarantee uninterrupted service. Scheduled maintenance will be communicated in advance where practical."],
  ["8. Limitation of Liability", "To the maximum extent permitted by law, Avexora AI shall not be liable for indirect, incidental or consequential damages. Our total liability is limited to the fees paid in the twelve months preceding the claim."],
  ["9. Termination", "Either party may terminate with notice at the end of the current billing cycle. Upon termination, you may export your data for 30 days, after which it may be deleted."],
  ["10. Governing Law", "These terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the courts of India."],
];

export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-4xl md:text-5xl font-bold mb-3">Terms &amp; <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Conditions</span></h1>
      <p className="text-sm text-stone-500 mb-10">Last updated: July 2026</p>
      <div className="rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-8 md:p-10 space-y-8">
        {SECTIONS.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
            <p className="text-sm text-stone-400 leading-relaxed">{body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}