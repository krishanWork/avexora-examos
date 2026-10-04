import { getMergedIntegrationConfig } from "./integrationSettingsService.js";

// Avexwa (avexwa.com) WhatsApp API integration via the Node global fetch.
// Provider identity is a workspace-scoped API key coming from the merged
// integration config (encrypted DB override -> env WHATSAPP_TOKEN).
//
// Message types and their window rules (per Avexwa docs):
//   - free-form (text / media / interactive buttons-list-cta): only inside the
//     24h customer-service window
//   - templates (/messages/template): outside the window too
//
// Every send records the REAL provider outcome — this module never claims a
// success it did not receive. WhatsApp requires a message id in the response;
// a 2xx without one is treated as a failure and logged.
//
// WHATSAPP_API_BASE_URL overrides the endpoint (defaults to avexwa.com) so
// staging accounts and hermetic test suites can point the integration at a
// local mock without touching the network.

const API_BASE = (process.env.WHATSAPP_API_BASE_URL || "https://avexwa.com/api/v1").replace(/\/+$/, "");

// Display-name suffix appended to every lead contact saved in Avexwa, e.g.
// "Rohan Kumar (exam_os)". Configurable via WHATSAPP_CONTACT_NAME_SUFFIX.
const CONTACT_SUFFIX = String(process.env.WHATSAPP_CONTACT_NAME_SUFFIX || "exam_os").trim() || "exam_os";

export const buildContactName = (name) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  return `${trimmed} (${CONTACT_SUFFIX})`;
};

// Upsert (create-or-update) the recipient as a named contact inside Avexwa so
// the user is visible in Avexwa conversations. CONTRACT ASSUMPTION:
//   POST {API_BASE}/contacts  { phone, name }  ->  { success: true, data }
// following the same envelope as every other Avexwa endpoint. Swap the path /
// fields here if the provider docs define something different.
//
// Best-effort BY DESIGN: a contact failure must never block or fail the message
// send, so failures are logged and normalised to { ok: false }.
const upsertAvexwaContact = async ({ to, name }) => {
  const ph = resolvePhone(to);
  if (!ph.ok || !String(name || "").trim()) return { ok: true, skipped: true };
  const t = await resolveToken();
  if (!t.ok) return { ok: true, skipped: true };
  let res;
  try {
    res = await fetch(`${API_BASE}/contacts`, {
      method: "POST",
      headers: { "X-API-Key": t.token, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: ph.phone, name: String(name).trim() }),
    });
  } catch {
    console.warn(`[whatsapp] contact upsert unreachable (${API_BASE}/contacts)`);
    return { ok: false };
  }
  if (!res.ok) {
    console.warn(`[whatsapp] contact upsert failed (${API_BASE}/contacts):`, res.status);
    return { ok: false };
  }
  return { ok: true };
};

// Await the contact save (non-fatal) right before the provider message post.
const saveContact = async (ph, name) => {
  try {
    await upsertAvexwaContact({ to: ph.phone, name });
  } catch {
    // Contact naming is best-effort; never fail the send because of it.
  }
};

export const isWhatsAppConfigured = (config) => {
  const c = config || { whatsapp: { token: "" } };
  return Boolean(String(c.whatsapp.token || "").trim());
};

export const getEffectiveWhatsAppConfig = async () => getMergedIntegrationConfig();

const resolveToken = async () => {
  let config;
  try {
    config = await getEffectiveWhatsAppConfig();
  } catch {
    return { ok: false, error: "WhatsApp service is not available" };
  }
  if (!isWhatsAppConfigured(config)) {
    return { ok: false, error: "WhatsApp is not configured" };
  }
  return { ok: true, token: String(config.whatsapp.token || "").trim() };
};

const resolvePhone = (to) => {
  const phone = String(to || "").replace(/^\+/, "").trim();
  if (!phone) return { ok: false, error: "Phone number is required" };
  return { ok: true, phone };
};

// POST to the provider and translate the result into the standard result
// shape used by every sender below.
const post = async (token, path, body) => {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "X-API-Key": token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Message could not be sent. Please try again." };
  }

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const id = data?.data?.wa_message_id || data?.data?.message_id || "";
    if (id) return { ok: true, messageId: id };
    console.warn(`[whatsapp] send matched ${path} but returned no message id (${API_BASE}${path})`);
    return { ok: false, error: "Message could not be sent. Please try again." };
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "WhatsApp API key is invalid or rejected", httpStatus: res.status };
  }
  console.warn(`[whatsapp] send failed (${API_BASE}${path}):`, res.status, data?.message || "");
  return { ok: false, error: "Message could not be sent. Please try again.", httpStatus: res.status };
};

// Text message (24h window). Kept as the primary entry point; the notification
// service and the manual send route rely on { ok, messageId, error }.
export const sendWhatsAppMessage = async ({ to, text, contactName }) => {
  const ph = resolvePhone(to);
  if (!ph.ok) return ph;
  if (!String(text || "").trim()) return { ok: false, error: "Message is required" };
  const t = await resolveToken();
  if (!t.ok) return t;
  if (contactName) await saveContact(ph, contactName);
  return post(t.token, "/messages/send", { phone: ph.phone, message: String(text) });
};

// Approved template message (works outside the 24h window).
// variables = body {{1}}, {{2}} placeholder values, in order. Placeholders are
// intentionally skipped by the UI for now; templates without placeholders send
// with an empty array, templates with placeholders fail at the provider and the
// failure is recorded honestly.
export const sendWhatsAppTemplate = async ({ to, templateName, variables, contactName }) => {
  const ph = resolvePhone(to);
  if (!ph.ok) return ph;
  if (!String(templateName || "").trim()) return { ok: false, error: "Template name is required" };
  const t = await resolveToken();
  if (!t.ok) return t;
  if (contactName) await saveContact(ph, contactName);
  return post(t.token, "/messages/template", {
    phone: ph.phone,
    template_name: String(templateName).trim(),
    language: "en_US",
    variables: Array.isArray(variables) ? variables : [],
  });
};

// Media (image | video | document | audio) from a public URL (24h window).
export const sendWhatsAppMedia = async ({ to, mediaType, url, caption, contactName }) => {
  const ph = resolvePhone(to);
  if (!ph.ok) return ph;
  const type = String(mediaType || "").trim().toLowerCase();
  if (!["image", "video", "document", "audio"].includes(type)) {
    return { ok: false, error: "Media type must be image, video, document or audio" };
  }
  const link = String(url || "").trim();
  if (!link) return { ok: false, error: "Media URL is required" };
  const t = await resolveToken();
  if (!t.ok) return t;
  if (contactName) await saveContact(ph, contactName);
  const body = { phone: ph.phone, media_type: type, url: link };
  const cap = String(caption || "").trim();
  if (cap) body.caption = cap;
  return post(t.token, "/messages/media", body);
};

// Interactive reply buttons — max 3 (24h window).
export const sendInteractiveButtons = async ({ to, body, buttons, header, footer, contactName }) => {
  const ph = resolvePhone(to);
  if (!ph.ok) return ph;
  const text = String(body || "").trim();
  if (!text) return { ok: false, error: "Message body is required" };
  const list = Array.isArray(buttons) ? buttons.filter((b) => String(b || "").trim()) : [];
  if (list.length === 0) return { ok: false, error: "At least one button is required" };
  if (list.length > 3) return { ok: false, error: "Maximum 3 buttons" };
  const t = await resolveToken();
  if (!t.ok) return t;
  if (contactName) await saveContact(ph, contactName);
  const payload = { phone: ph.phone, body: text, buttons: list.map((b) => String(b).trim()) };
  if (String(header || "").trim()) payload.header = String(header).trim();
  if (String(footer || "").trim()) payload.footer = String(footer).trim();
  return post(t.token, "/messages/interactive/buttons", payload);
};

// Interactive list / menu message (24h window). Row title max 24 chars,
// description max 72 chars.
export const sendInteractiveList = async ({ to, body, sections, button, header, footer, contactName }) => {
  const ph = resolvePhone(to);
  if (!ph.ok) return ph;
  const text = String(body || "").trim();
  if (!text) return { ok: false, error: "Message body is required" };
  const secs = Array.isArray(sections)
    ? sections
        .map((s) => ({
          title: String(s?.title || "").trim().slice(0, 24),
          rows: Array.isArray(s?.rows)
            ? s.rows
                .map((r) => ({
                  id: String(r?.id || "").trim().slice(0, 100),
                  title: String(r?.title || "").trim().slice(0, 24),
                  ...(String(r?.description || "").trim() ? { description: String(r.description).trim().slice(0, 72) } : {}),
                }))
                .filter((r) => r.id && r.title)
            : [],
        }))
        .filter((s) => s.rows.length > 0)
    : [];
  if (secs.length === 0) return { ok: false, error: "At least one section with rows is required" };
  const t = await resolveToken();
  if (!t.ok) return t;
  if (contactName) await saveContact(ph, contactName);
  const payload = { phone: ph.phone, body: text, sections: secs };
  if (String(button || "").trim()) payload.button = String(button).trim();
  if (String(header || "").trim()) payload.header = String(header).trim();
  if (String(footer || "").trim()) payload.footer = String(footer).trim();
  return post(t.token, "/messages/interactive/list", payload);
};

// Interactive CTA — single clickable URL button (24h window).
export const sendInteractiveCta = async ({ to, body, url, buttonText, header, footer, contactName }) => {
  const ph = resolvePhone(to);
  if (!ph.ok) return ph;
  const text = String(body || "").trim();
  const link = String(url || "").trim();
  if (!text) return { ok: false, error: "Message body is required" };
  if (!/^https?:\/\//i.test(link)) return { ok: false, error: "A valid http(s) URL is required" };
  const t = await resolveToken();
  if (!t.ok) return t;
  if (contactName) await saveContact(ph, contactName);
  const payload = { phone: ph.phone, body: text, url: link };
  if (String(buttonText || "").trim()) payload.button_text = String(buttonText).trim();
  if (String(header || "").trim()) payload.header = String(header).trim();
  if (String(footer || "").trim()) payload.footer = String(footer).trim();
  return post(t.token, "/messages/interactive/cta", payload);
};

// List approved WhatsApp templates for the picker.
export const listWhatsAppTemplates = async () => {
  const t = await resolveToken();
  if (!t.ok) return t;
  let res;
  try {
    res = await fetch(`${API_BASE}/templates?status=approved`, { headers: { "X-API-Key": t.token } });
  } catch {
    return { ok: false, error: "WhatsApp service is not reachable" };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "WhatsApp API key is invalid or rejected", httpStatus: res.status };
    }
    console.warn(`[whatsapp] list templates failed (${API_BASE}/templates):`, res.status, data?.message || "");
    return { ok: false, error: "Could not load WhatsApp templates", httpStatus: res.status };
  }
  const raw = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.templates)
      ? data.data.templates
      : Array.isArray(data?.data?.items)
        ? data.data.items
        : [];
  const templates = raw
    .map((tpl) => ({
      name: String(tpl?.name || tpl?.template_name || "").trim(),
      status: String(tpl?.status || "").trim(),
    }))
    .filter((tpl) => tpl.name);
  return { ok: true, templates };
};

// GET /me — validates the API key and returns workspace info. Intended for a
// future "test connection" affordance; harmless to keep available.
export const verifyApiKey = async () => {
  const t = await resolveToken();
  if (!t.ok) return t;
  try {
    const res = await fetch(`${API_BASE}/me`, { method: "GET", headers: { "X-API-Key": t.token } });
    if (!res.ok) return { ok: false, error: "WhatsApp API key is invalid or rejected", httpStatus: res.status };
    const data = await res.json().catch(() => ({}));
    return { ok: true, workspace: data?.data || {} };
  } catch {
    return { ok: false, error: "WhatsApp service is not reachable" };
  }
};