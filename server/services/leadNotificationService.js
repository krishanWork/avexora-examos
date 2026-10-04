import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { getLeadSettings } from "./leadSettingsService.js";
import { sendEmail, isEmailConfigured, getEffectiveEmailConfig } from "./emailService.js";
import { sendWhatsAppMessage, isWhatsAppConfigured, getEffectiveWhatsAppConfig } from "./whatsappService.js";

// Automatic new-lead notifications to the Super Admin / designated recipients.
//
// Fired from the public lead-intake handler AFTER the lead is persisted. It is
// deliberately non-throwing: a provider outage can never fail a public inquiry.
// Idempotency: the notification is claimed atomically on the Lead document via
// updateOne({_id, flag:{$exists:false}}), so a retried request can never produce
// a duplicate notification even when two server instances race.
//
// These notifications go to the ADMIN/CONFIGURED RECIPIENTS ONLY — the lead
// itself is never emailed/WhatsApped here. Manual lead outreach is a separate,
// explicit Super Admin action.

const LEAD_COLL = "Lead";
const ADMIN_URL = "/leads-management";

export const LEAD_URL_BASE = () => process.env.LEAD_MANAGEMENT_URL || "";

const formatWhen = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
};

const buildSummary = (lead) => {
  const optional = (label, value) => (value ? `${label}: ${value}\n` : "");
  return [
    "A new inquiry has arrived on the ExamOS website.",
    "",
    `Name: ${lead.name || "—"}`,
    `Email: ${lead.email || "—"}`,
    optional("Phone", lead.phone),
    optional("Organization", lead.organization),
    `Type: ${lead.type === "demo" ? "Demo Request" : "Contact"}`,
    optional("Preferred Date", lead.preferred_date ? formatWhen(lead.preferred_date) : null),
    optional("Message", lead.message),
    "",
    `Created: ${formatWhen(lead.created_date)}`,
    "",
    `Open Lead: ${LEAD_URL_BASE()}${ADMIN_URL}`,
  ].join("\n");
};

const buildEmailHtml = (lead) => {
  const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const row = (label, value) => (value ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${label}</td><td>${esc(value)}</td></tr>` : "");
  return `<!doctype html>
<html><body bgcolor="#f8fafc" style="margin:0;padding:24px">
  <table role="presentation" width="100%">
    <tr><td bgcolor="#ffffff" style="border:1px solid #e2e8f0;border-radius:12px;padding:24px;font-family:Arial,sans-serif">
      <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a">🔔 New Lead Received</h2>
      <table role="presentation" cellpadding="0" cellspacing="0">
        ${row("Name", lead.name)}
        ${row("Email", lead.email)}
        ${row("Phone", lead.phone)}
        ${row("Organization", lead.organization)}
        ${row("Type", lead.type === "demo" ? "Demo Request" : "Contact")}
        ${row("Preferred Date", lead.preferred_date)}
        ${row("Message", lead.message)}
        ${row("Created", lead.created_date ? formatWhen(lead.created_date) : "")}
      </table>
      <p style="margin:20px 0 0"><a href="${esc(LEAD_URL_BASE() + ADMIN_URL)}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Lead Management</a></p>
    </td></tr>
  </table>
</body></html>`;
};

// Claims the notification flag on the lead atomically; returns true if THIS
// call owns the delivery (the only one that may send).
const claimNotification = async (leadId, channel) => {
  const database = await db();
  const field = `auto_notified.${channel}`;
  const res = await database
    .collection(LEAD_COLL)
    .updateOne({ _id: new ObjectId(String(leadId)), [field]: { $exists: false } }, { $set: { [field]: new Date().toISOString(), updated_date: new Date().toISOString() } });
  return res.modifiedCount === 1;
};

const systemAudit = async ({ lead_id, channel, detail }) => {
  try {
    const database = await db();
    await database.collection("AuditLog").insertOne({
      tenant_id: "",
      actor_name: "System (Lead Intake)",
      actor_role: "system",
      action: `notification:${channel}`,
      entity_type: "Lead",
      entity_id: String(lead_id),
      details: detail || "",
      created_date: new Date().toISOString(),
    });
  } catch {
    // Audit is best-effort; it must never break the notification path.
  }
};

export const notifyLeadCreated = async (lead) => {
  const outcomes = { email: { attempted: false, delivered: false }, whatsapp: { attempted: false, delivered: false } };
  try {
    const settings = await getLeadSettings();

    // --- Email notifications -------------------------------------------------
    if (settings.email_notifications?.enabled && settings.email_notifications.recipients?.length) {
      if (await claimNotification(lead._id, "email")) {
        outcomes.email.attempted = true;
        const subject = `New Lead: ${lead.name || lead.email || "Inquiry"} (${lead.type === "demo" ? "Demo" : "Contact"})`;
        const text = buildSummary(lead);
        for (const recipient of settings.email_notifications.recipients) {
          const result = await sendEmail({ to: recipient, subject, text, html: buildEmailHtml(lead) });
          if (result.ok) outcomes.email.delivered = true;
        }
        await systemAudit({
          lead_id: lead._id,
          channel: "email",
          detail: `Auto-notification to ${settings.email_notifications.recipients.join(", ")}`,
        });
      }
    }

    // --- WhatsApp notifications ----------------------------------------------
    if (settings.whatsapp_notifications?.enabled && settings.whatsapp_notifications.numbers?.length) {
      if (await claimNotification(lead._id, "whatsapp")) {
        outcomes.whatsapp.attempted = true;
        const text = `🔔 New Lead Received\n\n${buildSummary(lead)}`;
        for (const number of settings.whatsapp_notifications.numbers) {
          const result = await sendWhatsAppMessage({ to: number, text });
          if (result.ok) outcomes.whatsapp.delivered = true;
        }
        await systemAudit({
          lead_id: lead._id,
          channel: "whatsapp",
          detail: `Auto-notification to ${settings.whatsapp_notifications.numbers.join(", ")}`,
        });
      }
    }
  } catch (err) {
    console.warn("Lead notification error (non-fatal):", err?.message || err);
  }
  return outcomes;
};

// Exposed for the settings page "test" affordance and for honest status banners.
export const getNotificationCapabilities = async () => {
  const [emailConfig, waConfig] = await Promise.all([getEffectiveEmailConfig(), getEffectiveWhatsAppConfig()]);
  return {
    email_configured: isEmailConfigured(emailConfig),
    whatsapp_configured: isWhatsAppConfigured(waConfig),
  };
};