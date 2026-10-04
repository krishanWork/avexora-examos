import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { normalizePhone } from "./leadSettingsService.js";

// Communication history for leads. Outbound/inbound email and WhatsApp are
// recorded here as one logical stream per lead, kept separate from the core
// Lead document so conversation history can grow without bloating the lead.
//
// Inbound WhatsApp is written here from the webhook. Duplicate webhook
// deliveries are rejected by a unique partial index on external_message_id
// (wamid) rather than by "did I already see this body" in-memory checks.

const LEAD_COMM = "LeadCommunication";
const DUPLICATE_CODE = 11000;

export const recordMessage = async ({ lead_id, channel, direction, subject, message, status, external_message_id, provider_message_id, error, msg_type, template_name, media_url, caption, html_content, attachments }) => {
  const database = await db();
  const leadId = lead_id instanceof ObjectId ? lead_id : new ObjectId(String(lead_id));
  const now = new Date().toISOString();
  const doc = {
    lead_id: leadId,
    channel: channel === "whatsapp" ? "whatsapp" : "email",
    direction: direction === "inbound" ? "inbound" : "outbound",
    status: String(status || "sent"),
  };
  if (subject) doc.subject = String(subject).slice(0, 500);
  if (message) doc.message = String(message);
  if (html_content) doc.html_content = String(html_content).slice(0, 300000);
  if (attachments) {
    const meta = Array.isArray(attachments) ? attachments.slice(0, 10) : [];
    if (meta.length > 0) doc.attachments = meta.map((a) => ({
      filename: String(a?.filename || "").slice(0, 200),
      size: Number(a?.size) || 0,
      contentType: String(a?.contentType || "application/octet-stream").slice(0, 120),
    }));
  }
  if (external_message_id) doc.external_message_id = String(external_message_id);
  if (provider_message_id) doc.provider_message_id = String(provider_message_id);
  if (error) doc.error = String(error).slice(0, 300);
  if (msg_type) doc.msg_type = String(msg_type).slice(0, 20);
  if (template_name) doc.template_name = String(template_name).slice(0, 120);
  if (media_url) doc.media_url = String(media_url).slice(0, 1000);
  if (caption) doc.caption = String(caption).slice(0, 500);
  doc.created_date = now;
  doc.updated_date = now;
  try {
    const result = await database.collection(LEAD_COMM).insertOne(doc);
    return { inserted: true, doc: { ...doc, _id: result.insertedId } };
  } catch (err) {
    if (err?.code === DUPLICATE_CODE) return { inserted: false, duplicate: true };
    throw err;
  }
};

export const listMessages = async ({ lead_id, channel }) => {
  const database = await db();
  const query = {
    lead_id: lead_id instanceof ObjectId ? lead_id : new ObjectId(String(lead_id)),
    ...(channel ? { channel } : {}),
  };
  const docs = await database.collection(LEAD_COMM).find(query).sort({ created_date: 1 }).toArray();
  return docs.map((d) => ({ ...d, _id: d._id.toString(), lead_id: d.lead_id.toString() }));
};

// Fully normalized phone string or null.
const canonical = (phone) => normalizePhone(phone);

export const findLeadByPhone = async (phone) => {
  const target = canonical(phone);
  if (!target) return null;
  const database = await db();
  const candidates = await database
    .collection("Lead")
    .find({ phone: { $type: "string", $nin: ["", null] } })
    .project({ _id: 1, phone: 1, name: 1, email: 1 })
    .toArray();
  return candidates.find((lead) => canonical(lead.phone) === target);
};

// Tolerant parser for Avexwa webhook events (message.received / message.status).
// The provider event contract is thin, so the parser walks the JSON looking for
// nodes that carry phone/from (inbound text), wa_message_id/message_id (identity,
// also used by status callbacks) and an optional status. Real payloads are
// captured at go-live; this covers both flat and {event,data} shapes.
const extractAvexwaEvents = (payload) => {
  const messages = [];
  const updates = [];
  const hasEventFields = (o) =>
    typeof o.phone === "string" ||
    typeof o.from === "string" ||
    (typeof o.wa_message_id === "string" && typeof o.status === "string") ||
    typeof o.message_id === "string";
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      if (hasEventFields(v)) {
        const event = String(v.event || "").toLowerCase();
        const phone = typeof v.phone === "string" ? v.phone : typeof v.from === "string" ? v.from : "";
        const wamid = String(v.wa_message_id || v.message_id || v.id || "");
        const text = typeof v.text === "string" ? v.text : typeof v.message === "string" ? v.message : typeof v.body === "string" ? v.body : "";
        const type = String(v.type || v.message_type || "");
        const status = String(v.status || "").trim();
        const isStatus = event.includes("status") || (Boolean(status) && Boolean(wamid) && !phone);
        if (isStatus && wamid && status) {
          updates.push({ wamid, status });
        } else if (phone && (text || type || wamid)) {
          messages.push({ from: phone, wamid, ts: "", body: text || (type ? `[${type} message]` : "[received message]") });
        }
        return;
      }
      for (const k of Object.values(v)) walk(k);
    }
  };
  walk(payload);
  return { messages, updates };
};

// Handles one webhook POST body. Returns counts for observability. Always
// resolves (never throws) so the webhook responds 200 quickly and the provider
// stops retrying, even for unknown senders that don't map to a lead.
export const ingestInboundWhatsApp = async (payload) => {
  const { messages, updates } = extractAvexwaEvents(payload);
  let inbound = 0;
  let updated = 0;
  for (const update of updates) {
    const database = await db();
    const res = await database
      .collection(LEAD_COMM)
      .updateMany({ external_message_id: update.wamid }, { $set: { status: update.status, updated_date: new Date().toISOString() } });
    updated += res.modifiedCount;
  }
  for (const msg of messages) {
    const lead = await findLeadByPhone(msg.from);
    if (!lead) continue;
    const result = await recordMessage({
      lead_id: lead._id,
      channel: "whatsapp",
      direction: "inbound",
      message: msg.body,
      status: "received",
      external_message_id: msg.wamid,
      provider_message_id: msg.wamid,
    });
    if (result.inserted) inbound++;
  }
  return { inbound, updated };
};