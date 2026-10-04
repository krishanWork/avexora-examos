// Affiliate subscription renewal reminders: rendering, delivery and the send log.
//
// The delivery log is not a convenience — it is the mechanism that makes a reminder
// impossible to send twice. The scheduler is a cron job that can be retried, can overlap
// with a manual "Send now", and can run twice in the same day after a deploy; a
// user-facing "your subscription is due" message that arrives three times is worse than
// one that never arrives. So every send RESERVES its slot with an insert into
// AffiliateReminderDelivery first, against a unique index on
// (subscription_id, period_key, lead_days, channel). A duplicate insert loses the race
// and never sends. This is the same shape as claimNotification() in
// leadNotificationService.js, but the claim is a durable row rather than a flag on a
// record, because a reminder's delivery history is something the affiliate and the
// super admin both need to be able to read back.
//
// DEPLOYMENT PREREQUISITE: that unique index (`ux_reminder_once_per_period` in
// server/ensure-indexes.js) must exist in the database. Until `node server/ensure-indexes.js`
// has been run against a given environment, the reservation below still writes a log
// row, but nothing rejects the duplicate — so a retried cron in that window could mail
// the same customer twice. The insert is the enforcement point, not application logic.
//
// Nothing here reports a success it did not receive. sendEmail() returns an outcome
// rather than throwing, and sendWhatsAppTemplate() requires a provider message id, so
// both are branched on and the REAL result is written to the log row.

import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { sendEmail } from "./emailService.js";
import { sendWhatsAppTemplate } from "./whatsappService.js";
import { periodKeyFor, renderTemplate, templateVariables } from "../affiliate-subscription.js";

export const DELIVERY_COLLECTION = "AffiliateReminderDelivery";
export const SUBSCRIPTION_COLLECTION = "Subscription";

const duplicateKey = (err) => err?.code === 11000 || err?.code === 11001;

// Escape for the HTML part of an email. The reminder body is authored by an affiliate
// and the values substituted into it are institution names typed by a human, so both are
// untrusted text going into a document that a mail client will render.
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The subject line and the body are authored separately, because "Your {{plan_name}}
// subscription renews on {{due_date}}" is a useful subject and a useless body.
const buildEmail = ({ subject, body, vars }) => {
  const renderedSubject = renderTemplate(subject, vars).trim();
  const renderedBody = renderTemplate(body, vars).trim();
  // Plain text and HTML are kept identical in content: the HTML part only adds the
  // paragraph/line-break structure, so what a recipient reads in a text-only client is
  // the same message and not a degraded second version.
  const html = renderedBody
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return {
    subject: renderedSubject || "Subscription renewal reminder",
    text: renderedBody,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px"><div style="font-size:14px;color:#0f172a">${html}</div></div></body></html>`,
  };
};

// The order here IS the provider template's placeholder order ({{1}}, {{2}}, ...), so
// it is fixed and documented rather than derived from an object: an object would make
// the mapping depend on key order, and a change to this file's property names would
// silently rewrite what a customer is told.
export const whatsappTemplateVariables = (vars) => [
  vars.school_name,
  vars.plan_name,
  vars.due_date,
  vars.amount,
  vars.days_until_due,
];

// Resolve who the reminder goes to.
//
// The sale SNAPSHOT on the subscription is preferred over the live Tenant because it is
// the address the institution gave when they bought, and a renewal reminder sent to a
// different person than the one who paid is a message the wrong person reads. The live
// Tenant is the fallback for the case where the snapshot was never captured.
export const resolveRecipient = async (subscription) => {
  const snapshot = subscription?.contact || {};
  let email = String(snapshot.email || "").trim();
  let phone = String(snapshot.phone || "").trim();
  let name = String(snapshot.name || "").trim();

  if ((!email || !phone) && subscription?.tenant_id && ObjectId.isValid(String(subscription.tenant_id))) {
    try {
      const tenant = await (await db()).collection("Tenant").findOne({
        _id: new ObjectId(String(subscription.tenant_id)),
      });
      if (tenant) {
        if (!email) email = String(tenant.contact_email || "").trim();
        if (!phone) phone = String(tenant.contact_phone || "").trim();
        if (!name) name = String(tenant.name || "").trim();
      }
    } catch {
      // A missing tenant must not stop a reminder from going to the address we already
      // have; the snapshot is the primary source precisely so this lookup is optional.
    }
  }

  return { email, phone, name };
};

// Reserve the delivery slot. Returns the reserved document, or null when this exact
// reminder has already been claimed.
const reserveDelivery = async ({ subscription, channel, leadDays, trigger, actor }) => {
  const periodKey = periodKeyFor(subscription.next_due_at);
  if (!periodKey) {
    return { error: "This subscription has no due date, so a reminder cannot be scheduled for it" };
  }
  const database = await db();
  const now = new Date().toISOString();
  const doc = {
    subscription_id: String(subscription._id),
    affiliate_id: String(subscription.affiliate_id || ""),
    tenant_id: String(subscription.tenant_id || ""),
    tenant_name: String(subscription.tenant_name || ""),
    period_key: periodKey,
    lead_days: Number(leadDays) || 0,
    channel,
    status: "pending",
    trigger: trigger === "manual" ? "manual" : "auto",
    sent_by: actor ? String(actor) : null,
    created_date: now,
    sent_at: null,
    provider_message_id: null,
    error: null,
  };
  try {
    const result = await database.collection(DELIVERY_COLLECTION).insertOne(doc);
    return { doc: { ...doc, _id: result.insertedId } };
  } catch (err) {
    if (duplicateKey(err)) return { doc: null };
    throw err;
  }
};

const settleDelivery = async (deliveryId, { status, messageId, error }) => {
  const database = await db();
  await database.collection(DELIVERY_COLLECTION).updateOne(
    { _id: deliveryId },
    {
      $set: {
        status,
        provider_message_id: messageId || null,
        error: error ? String(error).slice(0, 500) : null,
        sent_at: new Date().toISOString(),
      },
    }
  );
};

// Send one reminder on one channel.
//
// Returns a discriminated result rather than throwing for an ordinary failure: a
// missing address or a provider rejection is a recorded outcome the operator needs to
// see, not an exception that unwinds a whole cron run.
export const sendAffiliateReminder = async ({
  subscription,
  affiliate,
  channel,
  leadDays = 0,
  trigger = "auto",
  actor = null,
  subjectOverride,
  bodyOverride,
  now = new Date().toISOString(),
} = {}) => {
  if (channel !== "email" && channel !== "whatsapp") {
    return { ok: false, skipped: false, error: `Unknown reminder channel '${channel}'` };
  }

  const reserved = await reserveDelivery({ subscription, channel, leadDays, trigger, actor });
  if (reserved.error) return { ok: false, skipped: false, error: reserved.error };
  // Another run already claimed this exact reminder. Nothing is sent, and the caller is
  // told it was skipped rather than failed so the UI does not show a false error.
  if (!reserved.doc) return { ok: true, skipped: true, reason: "already_sent" };
  const delivery = reserved.doc;

  const vars = templateVariables({ subscription, affiliate, now });
  const recipient = await resolveRecipient(subscription);

  try {
    if (channel === "email") {
      if (!recipient.email) {
        await settleDelivery(delivery._id, { status: "failed", error: "No email address on file" });
        return { ok: false, skipped: false, error: "No email address on file" };
      }
      const email = buildEmail({
        subject: subjectOverride ?? affiliate?.reminder_email_subject ?? "",
        body: bodyOverride ?? affiliate?.reminder_email_template ?? "",
        vars,
      });
      const result = await sendEmail({
        to: recipient.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      if (result?.ok) {
        await settleDelivery(delivery._id, { status: "sent", messageId: result.messageId });
        return { ok: true, skipped: false, delivery_id: delivery._id.toString(), message_id: result.messageId };
      }
      const reason = result?.error || "Email could not be sent";
      await settleDelivery(delivery._id, { status: "failed", error: reason });
      return { ok: false, skipped: false, error: reason, delivery_id: delivery._id.toString() };
    }

    // WhatsApp: template-only, always.
    //
    // Free-form WhatsApp is restricted to the 24-hour customer-service window, and a
    // renewal reminder is sent weeks after the institution last wrote to us, so a
    // free-text send would be rejected by the provider almost every time. The
    // configured template is the only message shape that actually delivers here.
    if (!recipient.phone) {
      await settleDelivery(delivery._id, { status: "failed", error: "No phone number on file" });
      return { ok: false, skipped: false, error: "No phone number on file" };
    }
    const templateName = String(affiliate?.reminder_whatsapp_template_name || "").trim();
    if (!templateName) {
      await settleDelivery(delivery._id, {
        status: "failed",
        error: "No approved WhatsApp template is selected for this affiliate",
      });
      return { ok: false, skipped: false, error: "No approved WhatsApp template is selected for this affiliate" };
    }
    const result = await sendWhatsAppTemplate({
      to: recipient.phone,
      templateName,
      variables: whatsappTemplateVariables(vars),
      contactName: recipient.name || undefined,
    });
    if (result?.ok) {
      // whatsappService.post() already guarantees a message id on success and treats a
      // 2xx without one as a failure, so there is nothing else to decide here.
      await settleDelivery(delivery._id, { status: "sent", messageId: result.messageId });
      return { ok: true, skipped: false, delivery_id: delivery._id.toString(), message_id: result.messageId };
    }
    const reason = result?.error || "WhatsApp could not be sent";
    await settleDelivery(delivery._id, { status: "failed", error: reason });
    return { ok: false, skipped: false, error: reason, delivery_id: delivery._id.toString() };
  } catch (err) {
    // An unexpected throw still has to leave the log honest, or the slot stays reserved
    // as "pending" forever and that reminder can never be sent again.
    await settleDelivery(delivery._id, { status: "failed", error: err?.message || "Unexpected reminder failure" }).catch(() => {});
    return { ok: false, skipped: false, error: err?.message || "Unexpected reminder failure" };
  }
};

// The delivery history for one subscription, newest first.
export const listDeliveries = async (subscriptionId, limit = 50) => {
  const database = await db();
  return database
    .collection(DELIVERY_COLLECTION)
    .find({ subscription_id: String(subscriptionId) })
    .sort({ created_date: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
    .toArray();
};