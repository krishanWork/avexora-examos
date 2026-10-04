import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { getMergedIntegrationConfig } from "./integrationSettingsService.js";
import { isValidEmail } from "./leadSettingsService.js";

// Outbound email wrapper over nodemailer/SMTP. All provider identity/credentials
// come from the merged integration config (encrypted DB overrides -> env) and are
// resolved server-side only. This module never returns credentials and never
// leaks provider error internals; failures surface as a generic message.
//
// sendEmail() is deliberately non-throwing: it always resolves to
// { ok, messageId?, error? } so callers can record the outcome without a
// try/catch, and an unreachable/absent provider can never take the lead intake
// request down.

let transporterCache = null;
let cacheKey = "";

const shortKey = (config) =>
  [config.host, config.port, config.secure, config.user, createHash("sha256").update(config.pass || "").digest("hex").slice(0, 16)].join("|");

const getTransporter = (config) => {
  const key = shortKey(config);
  if (transporterCache && cacheKey === key) return transporterCache;
  transporterCache = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  cacheKey = key;
  return transporterCache;
};

export const isEmailConfigured = (config) => {
  const c = config || { smtp: { host: "", from: "" } };
  return Boolean(c.smtp.host && c.smtp.from);
};

export const getEffectiveEmailConfig = async () => getMergedIntegrationConfig();

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const safeAttachmentName = (name) =>
  String(name || "attachment")
    .replace(/[\/\\]/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 200)
    .trim() || "attachment";

export const sendEmail = async ({ to, subject, text, html, attachments }) => {
  if (!isValidEmail(to)) {
    return { ok: false, error: "Invalid recipient email address" };
  }
  if (!String(subject || "").trim() || !String(text || html || "").trim()) {
    return { ok: false, error: "Subject and message are required" };
  }
  const files = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (files.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Too many attachments (max ${MAX_ATTACHMENTS})` };
  }
  const oversized = files.find((f) => Buffer.byteLength(f.content || "") > MAX_ATTACHMENT_SIZE);
  if (oversized) {
    return { ok: false, error: `Attachment "${safeAttachmentName(oversized.filename)}" exceeds the 10MB limit` };
  }
  let config;
  try {
    config = await getEffectiveEmailConfig();
  } catch (err) {
    return { ok: false, error: "Email service is not available" };
  }
  if (!isEmailConfigured(config)) {
    return { ok: false, error: "Email is not configured" };
  }
  try {
    const transporter = getTransporter(config.smtp);
    const info = await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: String(subject).slice(0, 500),
      text: text ? String(text) : undefined,
      html: html ? String(html) : undefined,
      attachments: files.map((f) => ({
        filename: safeAttachmentName(f.filename),
        content: f.content,
        contentType: f.contentType || undefined,
      })),
    });
    return { ok: true, messageId: info?.messageId || "" };
  } catch (err) {
    console.warn(`[email] send failed (${config.smtp.host || "unknown"}):`, err?.message || err);
    return { ok: false, error: "Email could not be sent. Please try again." };
  }
};