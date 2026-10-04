import { db } from "../db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

// Provider connection configuration for email (SMTP) and WhatsApp (Avexwa).
// Credentials submitted through the portal are AES-256-GCM encrypted at
// rest via crypto.js and are NEVER returned in API responses (write-only masked
// semantics). Environment variables act as the baseline; documented values here
// override env so a Super Admin can operate the platform without shell access.
//
// WEBHOOK_SECRET is intentionally environment-only (never stored in Mongo): it
// authorizes inbound WhatsApp webhooks and must not be editable from a portal
// account.

const SETTINGS_KEY = "global";
const MASK = "••••••••";

const envOrDefault = (dbValue, envValue) =>
  typeof dbValue === "string" && dbValue.trim() !== "" ? dbValue : (envValue || "");

export const getIntegrationSettingsDoc = async () => {
  const database = await db();
  const coll = database.collection("IntegrationSettings");
  const existing = await coll.findOne({ key: SETTINGS_KEY });
  if (existing) return existing;
  const defaults = {
    key: SETTINGS_KEY,
    smtp: { host: "", port: 587, secure: false, from: "", user: "", pass_enc: null, pass_set: false },
    whatsapp: {
      token_enc: null,
      token_set: false,
    },
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString(),
  };
  await coll.updateOne({ key: SETTINGS_KEY }, { $setOnInsert: defaults }, { upsert: true });
  return defaults;
};

// Full effective config with REAL credentials — used only by email/whatsapp
// services server-side. Never returned by an HTTP handler.
export const getMergedIntegrationConfig = async () => {
  const doc = await getIntegrationSettingsDoc();
  const merged = {
    smtp: {
      host: envOrDefault(doc.smtp?.host, process.env.SMTP_HOST),
      port: Number(doc.smtp?.port || process.env.SMTP_PORT || 587),
      secure: doc.smtp?.secure === true || String(process.env.SMTP_SECURE).toLowerCase() === "true",
      from: envOrDefault(doc.smtp?.from, process.env.SMTP_FROM),
      user: envOrDefault(doc.smtp?.user, process.env.SMTP_USER),
      pass: decryptSecret(doc.smtp?.pass_enc) || String(process.env.SMTP_PASS || "").trim(),
      source: doc.smtp?.pass_set ? "database" : String(process.env.SMTP_PASS || "").trim() ? "env" : "none",
    },
    whatsapp: {
      token: decryptSecret(doc.whatsapp?.token_enc) || String(process.env.WHATSAPP_TOKEN || "").trim(),
      source: doc.whatsapp?.token_set ? "database" : String(process.env.WHATSAPP_TOKEN || "").trim() ? "env" : "none",
    },
    webhook_secret: (process.env.WHATSAPP_WEBHOOK_SECRET || "").trim(),
  };
  return merged;
};

// Safe view returned to the frontend. Never contains secrets — only masked
// flags plus the non-secret identifiers an operator may inspect/edit.
export const getMaskedIntegrationSettings = async () => {
  const doc = await getIntegrationSettingsDoc();
  return {
    smtp: {
      host: doc.smtp?.host || "",
      port: doc.smtp?.port || 587,
      secure: doc.smtp?.secure === true,
      from: doc.smtp?.from || "",
      user: doc.smtp?.user || "",
      pass_set: Boolean(doc.smtp?.pass_set),
      pass: doc.smtp?.pass_set ? MASK : "",
      env_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM),
    },
    whatsapp: {
      token_set: Boolean(doc.whatsapp?.token_set),
      token: doc.whatsapp?.token_set ? MASK : "",
      env_configured: Boolean(String(process.env.WHATSAPP_TOKEN || "").trim()),
    },
    webhook_secret_env_only: Boolean(process.env.WHATSAPP_WEBHOOK_SECRET),
  };
};

const pickSecret = (incoming, currentEnc, mask) => {
  // Not provided at all -> keep whatever is stored (possibly nothing).
  if (incoming === undefined || incoming === null) return { enc: currentEnc || null, set: Boolean(currentEnc) };
  const value = String(incoming).trim();
  // The masked placeholder is what the frontend resubmits for an unchanged
  // secret; never overwrite a real stored value with the placeholder.
  if (value === mask) return { enc: currentEnc || null, set: Boolean(currentEnc) };
  // Explicit empty string clears the secret (write-only + clearable).
  if (value === "") return { enc: null, set: false };
  const encrypted = encryptSecret(value);
  return encrypted ? { enc: encrypted, set: true } : { enc: null, set: false };
};

export const saveIntegrationSettings = async ({ smtp, whatsapp, updated_by }) => {
  const database = await db();
  const doc = await getIntegrationSettingsDoc();
  const smtpIn = smtp || {};
  const waIn = whatsapp || {};

  const pass = pickSecret(smtpIn.pass, doc.smtp?.pass_enc, MASK);
  const token = pickSecret(waIn.token, doc.whatsapp?.token_enc, MASK);

  const smtpSet = {
    host: String(smtpIn.host || "").trim(),
    port: Number(smtpIn.port) || 587,
    secure: smtpIn.secure === true,
    from: String(smtpIn.from || "").trim(),
    user: String(smtpIn.user || "").trim(),
    pass_enc: pass.enc,
    pass_set: pass.set,
  };
  const waSet = {
    token_enc: token.enc,
    token_set: token.set,
  };

  await database.collection("IntegrationSettings").updateOne(
    { key: SETTINGS_KEY },
    {
      $set: { smtp: smtpSet, whatsapp: waSet, updated_by: updated_by || "", updated_date: new Date().toISOString() },
      $setOnInsert: { key: SETTINGS_KEY, created_date: new Date().toISOString() },
    },
    { upsert: true }
  );
  return getMaskedIntegrationSettings();
};