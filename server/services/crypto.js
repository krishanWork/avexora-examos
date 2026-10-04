import crypto from "node:crypto";

// AES-256-GCM encryption for provider credentials stored in Mongo (SMTP password,
// WhatsApp access token). The key is derived from SETTINGS_ENC_KEY so operators
// can supply a passphrase of any length. When the key is absent, encryption is
// unavailable and the Connection Settings panel refuses to store secrets rather
// than persisting them in plaintext.
const ENC_PREFIX = "v1";
const ALGO = "aes-256-gcm";

const rawKey = () => (process.env.SETTINGS_ENC_KEY || "").trim();

export const encryptionAvailable = () => rawKey().length > 0;

const deriveKey = () => crypto.createHash("sha256").update(rawKey()).digest();

export const encryptSecret = (plaintext) => {
  if (plaintext === undefined || plaintext === null || plaintext === "") return null;
  if (!encryptionAvailable()) {
    throw Object.assign(new Error("SETTINGS_ENC_KEY is not configured; cannot store secrets"), { statusCode: 503 });
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_PREFIX, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
};

export const decryptSecret = (payload) => {
  if (!payload || typeof payload !== "string") return null;
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== ENC_PREFIX) return null;
  if (!encryptionAvailable()) return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv(ALGO, deriveKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};
