import React from "react";

const SECTIONS = [
  ["1. Information We Collect", "We collect information you provide directly: institutional details, administrator and staff accounts, student records (names, roll numbers, class details, parent contact information), examination data and scanned OMR sheets. We also collect standard usage data such as log information and device details."],
  ["2. How We Use Information", "We use collected information solely to operate the Service: managing examinations, processing OMR sheets, computing and publishing results, sending notifications you enable, and improving platform reliability. We do not sell personal data."],
  ["3. AI Processing", "Scanned OMR sheets are processed by AI models to extract marked answers. This processing is automated, tenant-isolated, and results are subject to human review workflows within your institution."],
  ["4. Data Sharing", "Data is never shared across tenants. We share data only with service providers necessary to operate the platform (e.g., cloud hosting, payment processing), under strict confidentiality, or when required by law."],
  ["5. Data Security", "We employ encryption in transit and at rest, role-based access control, tenant isolation and audit logging. Access to production data is restricted to authorized personnel."],
  ["6. Children's Data", "Student data is provided and controlled by the institution, which acts as data controller. We process student data only on the institution's instructions and never use it for advertising."],
  ["7. Data Retention", "We retain data for the duration of your subscription. After termination, data is available for export for 30 days and then scheduled for deletion."],
  ["8. Your Rights", "Institutions may access, correct, export or delete their data at any time. Individuals may contact their institution or us directly to exercise rights available under applicable law."],
  ["9. Changes to This Policy", "We may update this policy from time to time. Material changes will be notified via the platform or email before taking effect."],
  ["10. Contact", "For privacy questions or requests, contact us via the Contact Us page."],
];

export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-4xl md:text-5xl font-bold mb-3">Privacy <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Policy</span></h1>
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