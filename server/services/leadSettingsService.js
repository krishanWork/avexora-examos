import { db } from "../db.js";

// Global Lead Management notification settings. A lightweight persistence layer
// over a singleton document so Super Admin preferences survive restarts. Holds
// ONLY non-secret preferences (flags + recipient addresses/numbers); provider
// credentials live in env or the encrypted IntegrationSettings collection.

const SETTINGS_KEY = "global";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

export const isValidEmail = (email) => typeof email === "string" && EMAIL_RE.test(email.trim());

// Returns the canonical E.164 digit form (leading "+" normalised away) or null.
// Strips whitespace, dashes, dots, parentheses and a single leading "+", so a
// stored "+919999999999" and a webhook sender "919999999999" compare equal.
export const normalizePhone = (phone) => {
  if (typeof phone !== "string") return null;
  const cleaned = phone.replace(/[\s()\-.]/g, "").replace(/^\+/, "");
  if (cleaned.includes("+")) return null;
  return PHONE_RE.test(cleaned) ? cleaned : null;
};

export const isValidPhone = (phone) => PHONE_RE.test(String(phone || "").trim());

const DEFAULTS = () => ({
  email_notifications: { enabled: false, recipients: [] },
  whatsapp_notifications: { enabled: false, numbers: [] },
});

const normalizeList = (list, validator, max = 5) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value || !validator(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
};

export const parseLeadSettingsBody = (body = {}) => {
  const emailNotif = body.email_notifications || {};
  const whatsappNotif = body.whatsapp_notifications || {};
  return {
    email_notifications: {
      enabled: emailNotif.enabled === true,
      recipients: normalizeList(emailNotif.recipients, isValidEmail),
    },
    whatsapp_notifications: {
      enabled: whatsappNotif.enabled === true,
      numbers: normalizeList(whatsappNotif.numbers, isValidPhone),
    },
  };
};

export const getLeadSettings = async () => {
  const database = await db();
  const coll = database.collection("LeadSettings");
  const existing = await coll.findOne({ key: SETTINGS_KEY });
  if (existing) {
    return {
      ...DEFAULTS(),
      ...existing,
    } ;
  }
  const defaults = { key: SETTINGS_KEY, ...DEFAULTS(), created_date: new Date().toISOString(), updated_date: new Date().toISOString() };
  await coll.updateOne({ key: SETTINGS_KEY }, { $setOnInsert: defaults }, { upsert: true });
  return defaults;
};

export const saveLeadSettings = async ({ email_notifications, whatsapp_notifications, updated_by }) => {
  const normalized = {
    email_notifications: {
      enabled: email_notifications?.enabled === true,
      recipients: normalizeList(email_notifications?.recipients, isValidEmail),
    },
    whatsapp_notifications: {
      enabled: whatsapp_notifications?.enabled === true,
      numbers: normalizeList(whatsapp_notifications?.numbers, isValidPhone),
    },
  };
  if (normalized.email_notifications.enabled && normalized.email_notifications.recipients.length === 0) {
    throw Object.assign(new Error("At least one email recipient is required when notifications are enabled"), { statusCode: 400 });
  }
  if (normalized.whatsapp_notifications.enabled && normalized.whatsapp_notifications.numbers.length === 0) {
    throw Object.assign(new Error("At least one WhatsApp number is required when notifications are enabled"), { statusCode: 400 });
  }
  const database = await db();
  await database.collection("LeadSettings").updateOne(
    { key: SETTINGS_KEY },
    {
      $set: { ...normalized, updated_by: updated_by || "", updated_date: new Date().toISOString() },
      $setOnInsert: { key: SETTINGS_KEY, created_date: new Date().toISOString() },
    },
    { upsert: true }
  );
  return getLeadSettings();
};