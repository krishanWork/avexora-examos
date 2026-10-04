import "dotenv/config";
import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import multer from "multer";
import { ObjectId } from "mongodb";
import { db } from "./db.js";
import { runOmrInWorker } from "./omr-engine/omr-runner.mjs";
import { PRIVILEGED_TENANT_ROLES, studentIdsForUser, teacherAssignmentIsValid } from "./crm-authorization.js";
import { provisionUser, provisionAutoLogins, safeUser, ensureStudentEmails, generateStudentEmail, generateParentEmail, resolveDefaultStudentPassword } from "./provisioning.js";
import {
  APP_ROLES,
  VALID_APP_ROLES,
  PLATFORM_ROLES,
  EXAM_WORKFLOW_ROLES,
  FAMILY_ROLES,
  STAFF_ROLES,
  AFFILIATE_ROLES,
  PROVISIONING_HIERARCHY,
  APP_ROLE_PRECEDENCE,
  canAssignRoleSet,
  canProvisionRoleSet,
  canManageStaff,
  staffCreatableRolesFor,
  staffAssignableRolesFor,
  rolesOf,
  roleOf,
  hasRole,
  hasAnyRole,
  appRolesOf,
  primaryAppRole,
  validateAppRoleSet,
  canWriteEntity,
  canReadAuditLog,
  canProvisionStudentLogins,
  isExamWorkflow,
  isSuperAdmin,
  isPlatform,
  ENTITY_WRITE_ROLES,
  canUploadPurpose,
  canExtractRoster,
  canStartTrial,
  canRequestPlanChange,
  canApprovePlanChanges,
  TENANT_BILLING_FIELDS,
  canManageAffiliates,
  canSellAsAffiliate,
  canDeleteOwnAccount,
  resolveReadableTenantId,
  redactTenant,
  redactTenantBranding,
  redactSecrets,
  resolveStaffTenant,
  SECRET_ENTITY_FIELDS,
  isSafeQueryValue,
  isEmailVerified,
  VERIFICATION_ALLOWED_PATHS,
  EMAIL_UNVERIFIED_RESPONSE,
} from "./rbac.js";
import { installApiLogging } from "./logger.js";
import { computeCommission, summarizeSales, rollupSummaries, normalizeCommissionRate, isSaleStatus, canTransitionSale } from "./affiliate-commission.js";
import { RATE_LIMITS, getClientIp, getRateStore, runLimit, tooMany } from "./rate-limit.js";
import { setupAcademicStructure } from "./academicSetupService.js";
import { saveBatchAttendance, getAttendanceHistory, recordExamAttendance, getExamAttendance, reconcileExamAbsentees } from "./attendanceService.js";
import { resolveStudentIdentity } from "./identityResolver.js";
import { getExamTimetable } from "./examTimetableService.js";
import { ensureExamRoster, syncEnrollmentRosters, studentInExamRoster, getExamRosterStudentIds, getExamRoster, deriveEnrolledStudents, resolveExamScope } from "./examRosterService.js";
import { previewNextAdmissionNumber, previewNextRollNumber, autoAssignStudentNumbers, resolvePlacementScope } from "./studentNumberService.js";
import * as s3 from "./lib/s3.js";
import { normalizeHost } from "../shared/custom-domain.js";
import { createDomainVerifier, REASONS, humanReason } from "./lib/domainVerifier.js";
import { assertCustomDomainAvailable, normalizeSubdomain, assertSubdomainUsable, assertSubdomainAvailable } from "./lib/domainGuard.js";
import { HOSTING_STATUS, getHostingProvider, registerHostingProvider } from "./lib/hosting.js";
import { createVercelProvider } from "./lib/vercelProvider.js";
import { runCustomDomainActivation, ACTIVATION_STAGE } from "./lib/activationOrchestrator.js";
import { createDomainMonitor, buildDomainAlert, verifyCronToken } from "./lib/domainMonitor.js";
import { getLeadSettings, saveLeadSettings, parseLeadSettingsBody, isValidPhone } from "./services/leadSettingsService.js";
import { getMaskedIntegrationSettings, saveIntegrationSettings } from "./services/integrationSettingsService.js";
import { sendEmail, isEmailConfigured, getEffectiveEmailConfig } from "./services/emailService.js";
import {
  sendWhatsAppMessage,
  isWhatsAppConfigured,
  getEffectiveWhatsAppConfig,
  sendWhatsAppTemplate,
  sendWhatsAppMedia,
  sendInteractiveButtons,
  sendInteractiveList,
  sendInteractiveCta,
  listWhatsAppTemplates,
  buildContactName,
} from "./services/whatsappService.js";
import { recordMessage, listMessages, ingestInboundWhatsApp } from "./services/leadMessageService.js";
import { notifyLeadCreated, getNotificationCapabilities } from "./services/leadNotificationService.js";
import {
  computePeriod,
  periodKeyFor,
  normalizeInterval,
  addMonths,
  normalizeChannels,
  normalizeLeadDays,
  normalizeCommissionMode,
  isCommissionMode,
  matchingLeadDays,
  daysUntilDue,
  shouldCreateCommission,
  renderReminder,
  DEFAULT_LEAD_DAYS,
  REMINDER_CHANNELS,
  COMMISSION_MODES,
  MAX_LEAD_DAY,
  TEMPLATE_PLACEHOLDERS,
} from "./affiliate-subscription.js";
import { sendAffiliateReminder, listDeliveries, resolveRecipient } from "./services/affiliateReminderService.js";
import { encryptionAvailable } from "./services/crypto.js";

const rateStore = getRateStore();

const app = express();
app.disable("x-powered-by");
// No ETags on API responses.
//
// Express otherwise hashes every JSON body and answers a revalidating request with a
// bare 304 and no body. The browser cache normally recombines that into a usable 200,
// but any client that does not — a proxy, or a cache that has already evicted the entry
// — is handed a body-less 304, and src/api/appClient.js treats anything outside 200-299
// as a failure, so the whole page breaks with "Request failed".
//
// Conditional GET buys nothing here: every response is per-user and sent with a bearer
// token, so there is no shared cache to revalidate against, and the request that would
// have saved the body has already paid for a full round trip.
app.disable("etag");
installApiLogging(app);
const allowed = new Set([
  "AcademicYear",
  "Affiliate",
  "AffiliateSale",
  "Announcement",
  "AnswerKey",
  "Assignment",
  "AssignmentSubmission",
  "Attendance",
  "AuditLog",
  "Enrollment",
  "Examination",
  "Lead",
  "OMRCorrection",
  "OMRSheet",
  "Parent",
  "ParentStudent",
  "Payment",
  "PlanChangeRequest",
  "PlatformBranding",
  "Result",
  "SchoolClass",
  "Section",
  "Student",
  "Subject",
  "SubscriptionPlan",
  "Teacher",
  "TeacherAssignment",
  "Tenant",
  "TenantAnnouncement",
  "User",
]);
const publicRead = new Set(["Announcement", "PlatformBranding", "SubscriptionPlan"]);
// globalOnly records are the platform's commercial and identity data, not any
// school's. They are unreadable through generic CRUD by anyone who is not a
// platform role, which is what keeps Lead, Payment, Tenant, User — and now the
// affiliate profile and commission ledger — from leaking across tenants.
const globalOnly = new Set(["Lead", "Payment", "Tenant", "User", "Affiliate", "AffiliateSale"]);

// Platform commercial records: data that belongs to the business rather than to
// any school, so a super_admin "viewing as" one institution must still see all of
// it. Tenant is here because the institutions console is how you LEAVE a scope.
//
// This is deliberately NOT globalOnly. User is in globalOnly and must stay
// NARROWED under a view-as scope, so the two sets cannot be the same one.
const PLATFORM_COMMERCIAL_RECORDS = new Set([
  "Tenant",
  "Lead",
  "Payment",
  "PlanChangeRequest",
  "Affiliate",
  "AffiliateSale",
]);
const JWT_SECRET = (process.env.JWT_SECRET || "").trim();
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Add it to your environment (or .env) and restart. Refusing to start.");
  process.exit(1);
}
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;
// Longer than the reset token on purpose: the address must still be reachable
// when the user gets around to clicking, and a resend is always available.
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

// --- SEC-03: Secure uploads --------------------------------------------------
// Uploads are private-by-default and tenant-scoped. Storage layout:
//   uploadsDir/
//     tmp/                    staging area written by multer, moved after validation
//     public/                 intentionally-public branding logos only
//     private/<tenantId>/     OMR sheets, CSV extracts, exam documents
// URLs are opaque (`/api/files/<uuid>.<ext>`); tenant ownership is derived from
// the authenticated session (req.user.tenant_id), never from client input.
const UPLOAD_DIR_OVERRIDE = process.env.UPLOADS_DIR;
const isVercel = Boolean(process.env.VERCEL);
const uploadsDir = UPLOAD_DIR_OVERRIDE
  ? path.resolve(UPLOAD_DIR_OVERRIDE)
  : isVercel
    ? path.join(os.tmpdir(), "uploads")
    : path.join(process.cwd(), "uploads");
const uploadsTmpDir = path.join(uploadsDir, "tmp");
const publicUploadsDir = path.join(uploadsDir, "public");
const privateUploadsDir = path.join(uploadsDir, "private");

const UPLOAD_SIZE_CAP = {
  omr: 50 * 1024 * 1024,
  import: 25 * 1024 * 1024,
  logo: 5 * 1024 * 1024,
};

// File-type trust: an uploaded file's extension must match one of these
// per-purpose tuples AND its leading bytes must match the same signature.
// `csv` has no reliable signature, so it is validated as safe text instead.
const MAGIC_BYTES = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46, 0x38],
  webp: { riff: [0x52, 0x49, 0x46, 0x46], tag: [0x57, 0x45, 0x42, 0x50] },
  bmp: [0x42, 0x4d],
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  xls: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};
const ALLOWED_UPLOADS = {
  omr: [
    { ext: ".pdf", sig: "pdf" },
    { ext: ".png", sig: "png" },
    { ext: ".jpg", sig: "jpg" },
    { ext: ".jpeg", sig: "jpg" },
  ],
  import: [
    { ext: ".csv", sig: "csv" },
    { ext: ".xlsx", sig: "xlsx" },
    { ext: ".xls", sig: "xls" },
  ],
  logo: [
    { ext: ".png", sig: "png" },
    { ext: ".jpg", sig: "jpg" },
    { ext: ".jpeg", sig: "jpg" },
    { ext: ".gif", sig: "gif" },
    { ext: ".webp", sig: "webp" },
    { ext: ".bmp", sig: "bmp" },
  ],
};

// UPLOAD_PURPOSE_ROLES / canUploadPurpose live in server/rbac.js.

const SERVED_CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};
// Server-generated storage name: a UUID v4 + a single lowercased allowlisted ext.
const STORED_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/;

const hasSignature = (buf, sig) => {
  if (sig === "csv") return true;
  const spec = MAGIC_BYTES[sig];
  if (!spec) return false;
  if (Array.isArray(spec)) return spec.every((b, i) => buf[i] === b);
  return spec.riff.every((b, i) => buf[i] === b) && spec.tag.every((b, i) => buf[8 + i] === b);
};
const looksLikeCsvText = (buf) => {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return false;
  }
  return true;
};
const safeResolveUnder = (rootDir, candidate) => {
  const resolved = path.resolve(rootDir, candidate);
  if (!resolved.startsWith(rootDir + path.sep)) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
  return resolved;
};

for (const dir of [uploadsTmpDir, publicUploadsDir, privateUploadsDir]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn("Could not create uploads directory:", e.message);
  }
}

// Storage backend gate (SEC-03): loads S3 config and fails fast in production.
// See server/lib/s3.js for the exact fail-fast semantics.
try {
  await s3.initStorage();
} catch (err) {
  console.error("FATAL:", err.message);
  process.exit(1);
}

// Short-lived, unforgeable signed capability for browser-rendered private files.
// <img> and <a href target=_blank> cannot send the Authorization header, so the
// download endpoint accepts a signed token in the URL ONLY when no bearer is
// present. With a bearer, the authenticated tenant is authoritative and the
// token is ignored. HMAC key is the server JWT secret (never leaked to clients).
const UPLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const signFileToken = (tenantId, filename, expiresAt = Date.now() + UPLOAD_TOKEN_TTL_MS) => {
  const mac = crypto.createHmac("sha256", JWT_SECRET).update(`${tenantId}:${filename}:${expiresAt}`).digest("base64url");
  return `${expiresAt}.${tenantId}.${mac}`;
};
const verifyFileToken = (filename, tokenStr) => {
  if (typeof tokenStr !== "string") return null;
  const parts = tokenStr.split(".");
  if (parts.length !== 3) return null;
  const [expiresAt, tenantId, mac] = parts;
  if (!/^\d{13,16}$/.test(expiresAt)) return null;
  if (!(/^[0-9a-f]{24}$/.test(tenantId) || tenantId === "platform")) return null;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${tenantId}:${filename}:${expiresAt}`).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expiresAt) < Date.now()) return null;
  return tenantId;
};

// --- OMR Computer Vision Engine Configuration & Helpers ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OMR_TEMPLATES_DIR = path.join(__dirname, "omr-engine", "templates");

const resolveOmrFilePath = (imageUrl, tenantId) => {
  if (!imageUrl || typeof imageUrl !== "string") return null;

  let clean = imageUrl.split("?")[0].trim();
  let filename = path.basename(clean);

  if (STORED_FILE_RE.test(filename)) {
    if (tenantId) {
      const privateCandidate = path.join(privateUploadsDir, tenantId, filename);
      if (fs.existsSync(privateCandidate)) return privateCandidate;
    }
    const platformCandidate = path.join(privateUploadsDir, "platform", filename);
    if (fs.existsSync(platformCandidate)) return platformCandidate;

    const pubCandidate = path.join(publicUploadsDir, filename);
    if (fs.existsSync(pubCandidate)) return pubCandidate;

    const tmpCandidate = path.join(uploadsTmpDir, filename);
    if (fs.existsSync(tmpCandidate)) return tmpCandidate;
  }

  if (path.isAbsolute(clean) && fs.existsSync(clean)) {
    try {
      const projectRoot = path.resolve(__dirname, "..");
      const resolved = path.resolve(clean);
      if (
        resolved.startsWith(projectRoot + path.sep) ||
        resolved.startsWith(path.resolve(uploadsDir) + path.sep) ||
        resolved.startsWith(os.tmpdir() + path.sep)
      ) {
        return resolved;
      }
    } catch {
      // ignore
    }
  }

  return null;
};

// --- S3-aware OMR staging ---------------------------------------------------
// In S3 mode the CV engine still needs a real local file (OpenCV/pdf2image take
// a path), so the tenant's object is staged into an OS-temp scratch directory,
// processed, and the annotated PNG is pushed back to S3 before cleanup.
const OMR_SCRATCH_DIR = path.join(os.tmpdir(), "examos-omr");
const omrScratchIndex = new Map();

const omrScratchPath = (filename) => path.join(OMR_SCRATCH_DIR, filename);

const ensureOmrScratchDir = () => {
  fs.mkdirSync(OMR_SCRATCH_DIR, { recursive: true });
};

const stageOmrFile = async (imageUrl, tenantId) => {
  if (s3.getStorage().mode !== "s3") return resolveOmrFilePath(imageUrl, tenantId);
  if (!imageUrl || typeof imageUrl !== "string") return null;

  const clean = imageUrl.split("?")[0].trim();
  const filename = path.basename(clean);
  if (!STORED_FILE_RE.test(filename)) return null;

  const cached = omrScratchIndex.get(filename);
  if (cached && fs.existsSync(cached)) return cached;

  let key = null;
  if (tenantId) {
    const candidate = s3.privateKey(tenantId, filename);
    if (await s3.objectExists(candidate)) key = candidate;
  }
  if (!key) {
    const platformCandidate = s3.privateKey("platform", filename);
    if (await s3.objectExists(platformCandidate)) key = platformCandidate;
  }
  if (!key) {
    const found = (await s3.listKeys("private/", { limit: 2000 })).find((k) => k.endsWith(`/${filename}`));
    if (found) key = found;
  }
  if (!key) return null;

  ensureOmrScratchDir();
  const dest = omrScratchPath(filename);
  await s3.downloadToFile(key, dest);
  omrScratchIndex.set(filename, dest);
  return dest;
};

const runOmrEvaluator = async ({ imagePath, templateId, numQuestions, numOptions, annotatedPath, numDigits, timeoutMs = 60000 }) => {
  const templatePath = path.join(OMR_TEMPLATES_DIR, `${templateId}.json`);
  if (!fs.existsSync(templatePath)) {
    const err = new Error(`Template not found: ${templateId}`);
    err.code = "INVALID_TEMPLATE";
    throw err;
  }

  const args = {
    imagePath,
    templatePath,
    annotatedOutput: annotatedPath || undefined,
  };
  if (numQuestions) args.numQuestions = numQuestions;
  if (numOptions) args.numOptions = numOptions;
  if (numDigits) args.numDigits = numDigits;

  let parsed = null;
  try {
    const workerResult = await runOmrInWorker(args, { timeoutMs });
    parsed = workerResult && workerResult.result;
  } catch (err) {
    const e = new Error(err.message || "OMR evaluation failed");
    e.code = err.code || "OMR_PROCESSING_FAILED";
    e.payload = err.payload || null;
    throw e;
  }

  if (!parsed || typeof parsed !== "object") {
    const err = new Error("Malformed output from OMR evaluator");
    err.code = "MALFORMED_OUTPUT";
    throw err;
  }

  if (parsed.status === "failed") {
    const err = new Error(parsed.error_message || parsed.error_code || "OMR evaluation failed");
    err.code = parsed.error_code || "OMR_PROCESSING_FAILED";
    err.payload = parsed;
    err.stderr = "";
    throw err;
  }

  return { result: parsed, stderr: "" };
};

// Files are buffered in memory for signature validation, then persisted to the
// active storage backend (S3 in production, local disk in development only).
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// --- SEC-06: CORS allowlist + security headers --------------------------------
// CORS: explicit origin allowlist from CLIENT_ORIGIN (comma-separated), never a
// reflected-origin wildcard. Credentials (cookies) are NOT enabled because auth
// is Bearer-token only (SEC-04). Same-origin browser requests and server-to-server
// clients (no Origin header) are unaffected. When CLIENT_ORIGIN is unset, no
// cross-origin origin is allowed by default — never falls back to allow-all.
const parseOrigins = (raw) =>
  String(raw || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
const allowedOrigins = parseOrigins(process.env.CLIENT_ORIGIN);
const corsOrigin = (origin, callback) => {
  callback(null, Boolean(origin) && allowedOrigins.includes(origin));
};
app.use(cors({ origin: corsOrigin, credentials: false }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Security headers baseline. HSTS is set only when the connection is secure (a
// TLS-terminated edge/proxy) so it is never forced over plain-HTTP local dev.
const SECURITY_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://static.wixstatic.com https://media.appclient.com https://*.wixstatic.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
].join("; ");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", SECURITY_CSP);
  if (req.secure || /^https$/i.test(String(req.headers["x-forwarded-proto"] || ""))) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// SEC-03: only intentionally-public branding logos are served statically. OMR
// sheets, CSV extracts and exam documents are NOT exposed here — they are served
// only by the authenticated /api/files/:filename endpoint (see below).

const col = async (name) => {
  if (!allowed.has(name)) throw Object.assign(new Error("Unknown resource"), { status: 404 });
  return (await db()).collection(name);
};
const out = (doc) => doc && ({ ...doc, _id: doc._id.toString(), id: doc._id.toString() });

// --- Response redaction (SEC-07) ---------------------------------------------
// Every generic entity endpoint serializes documents through `present`, so a
// single missing allowlist leaks credential material to any role that can read
// the collection. readScope() is a READ filter, not a field filter: it never
// removes a field and it is a no-op for platform roles, so `employee` could read
// every tenant's bcrypt password_hash and any role that can read Tenant could
// read the institution's shared portal default password.
//
// The field lists and redactTenant() live in server/rbac.js; this is the one
// place a document becomes an HTTP response. Always route entity responses
// through `present`, never `out`.
const present = (name, doc, req) => {
  if (!doc) return doc;
  // Tenant is redacted from the intact document, not from redactSecrets() output:
  // student_default_password is itself a secret field, so stripping secrets first
  // would delete the one credential the school_admin who set it is entitled to
  // read back in the portal settings dialog. redactTenant() is an allowlist, so
  // it drops every secret on its own; it is safe to run first here.
  if (name === "Tenant") return redactTenant(out(doc), req);
  const shaped = redactSecrets(out(doc));
  if (name === "User") return safeUser(shaped);
  return shaped;
};
const presentAll = (name, rows, req) => (rows || []).map((row) => present(name, row, req));

// A single-record PATCH body is a flat field map: the client sends the fields
// themselves (appClient.update serializes `data` directly), and the route $sets
// the top-level keys.
//
// It must therefore never be a wrapper. The sibling /many route legitimately
// takes {query, update} and unwraps it, and the generic guards are all
// field-name based — so a body of {update: {app_role: "super_admin"}} on this
// route matched no guarded key, passed the guard, and was written as a literal
// `update` subdocument. That is a guard bypass with a one-key change of shape,
// and the only reason it was not found earlier is that the /many route already
// unwrapped its own body. Refused explicitly rather than quietly unwrapped, so
// the two routes cannot drift into disagreeing again.
const assertFlatUpdateBody = (body) => {
  const wrapperKeys = ["update", "$set", "$unset", "$push", "$pull", "$addToSet"];
  const offending = wrapperKeys.find((key) => Object.prototype.hasOwnProperty.call(body || {}, key));
  if (offending) {
    return {
      status: 400,
      error: `Send field names directly as the request body; '${offending}' is not accepted by this route`,
    };
  }
  const operator = Object.keys(body || {}).find((key) => key.startsWith("$"));
  if (operator) return { status: 400, error: `Unknown update operator '${operator}'` };
  return null;
};

// --- User privilege-state guard (SEC: single authority) -------------------------
// Role, legacy role, tenant reassignment and credential material are all
// privilege state, and none of them may be written through generic entity CRUD:
// a role change must go through assignUserRole (hierarchy check + audit), and
// credential material must go through the auth endpoints that re-verify the
// account. This guard is shared by every User write route — the single-record
// PATCH, the bulk PATCH, the /many PATCH and the /many DELETE — so the invariant
// cannot be enforced on one route and forgotten on another, which is exactly how
// DELETE /entities/User/:id came to refuse User while DELETE /entities/User/many
// deleted every account in every tenant, unaudited.
//
// Returns {status, error} for the caller to surface, or null to proceed.
const userPrivilegeWriteRefused = (update, { hasTenantId = false, tenantId = null } = {}) => {
  const credentialWrite = SECRET_ENTITY_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(update, field)
  );
  if (credentialWrite.length) {
    return { status: 403, error: `Cannot write ${credentialWrite.join(", ")} through the entity API` };
  }
  // email_verified is not a secret, so it is not in SECRET_ENTITY_FIELDS, but it
  // is the activation switch the global gate reads on every request. It is
  // written by exactly one place — the token verification endpoint, which
  // resolves a proof of mailbox ownership. Entity CRUD reaching it would let any
  // account with generic User write access mint itself access on a target
  // account, which is privilege escalation wearing a boolean.
  if (Object.prototype.hasOwnProperty.call(update, "email_verified")) {
    return { status: 403, error: "Cannot change email_verified through the entity API" };
  }
  // `app_roles` is the canonical role field and `app_role` its mirror. Both are
  // privilege writes, so both are recognized here — a guard that knew only the
  // old name would let the new one ride the generic $set unexamined, which is
  // exactly the hole the single-role version of this function existed to close.
  const hasRoleField = Object.prototype.hasOwnProperty.call(update, "app_role")
    || Object.prototype.hasOwnProperty.call(update, "app_roles");
  const hasLegacyRole = Object.prototype.hasOwnProperty.call(update, "role");
  const movesTenant = hasTenantId && Boolean(tenantId);
  // A body may carry exactly one privilege field: `app_role`, which the caller
  // routes through assignUserRole. Pairing it with a legacy role or a tenant is
  // refused rather than quietly dropped — a caller that asked to move an account
  // must not receive 200 while its tenant_id never moves. It is also the shape
  // that previously smuggled a forged `role` and a cross-tenant move through the
  // same request, because the delegated role write and the generic $set raced.
  if (hasLegacyRole || movesTenant) {
    return {
      status: 403,
      error: hasRoleField
        ? "Role and institution changes are not combined; change one at a time through the role assignment endpoint"
        : "Role and institution changes go through the role assignment endpoint",
    };
  }
  return null;
};

// Tenant billing fields are the money side of an institution's account, and this
// guard is the second half of closing the self-upgrade hole: `Tenant.update`
// admits `school_admin` for everything else they legitimately edit, so an
// unguarded `subscription_plan_id` there let any school grant itself the top plan
// — and its student and OMR quotas — with one PATCH and no payment.
//
// Platform roles are exempt, and the exemption is the point rather than a leak:
// `super_admin` and `employee` run the institutions console, whose plan selector
// is the deliberate override that support uses for onboarding and corrections.
// Refusing it would have broken TenantFormDialog for the only people authorised
// to use it, and those sales are recorded in Payment by affiliateSell anyway. What
// must never happen is an institution doing this to itself.
//
// The super-admin bypass is applied AFTER the field check, for the same reason
// canUploadPurpose checks a known purpose first: a short-circuit on the actor
// alone would let the platform owner write a field this policy has no rule for.
//
// Returns {status, error} for the caller to surface, or null to proceed. Applied
// on every Tenant write route (single, bulk and /many) — a guard that exists on
// one route and not the others is the failure mode documented above
// userPrivilegeWriteRefused.
const tenantBillingWriteRefused = (req, update) => {
  if (!update || typeof update !== "object") return null;
  if (isPlatform(req)) return null;
  const attempted = TENANT_BILLING_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(update, field)
  );
  if (!attempted.length) return null;
  return {
    status: 403,
    error: `Cannot change ${attempted.join(", ")} directly. Request a plan change and an administrator will approve it`,
  };
};

// Normalize a client filter into a Mongo criteria. Only `id` is coerced to an
// ObjectId; every other value must pass isSafeQueryValue() (server/rbac.js), so
// a client-supplied $or/$where/$regex is dropped instead of reaching
// find/updateMany/deleteMany where it could widen a scoped predicate.
const query = (value = {}) =>
  Object.fromEntries(
    Object.entries(value).flatMap(([key, val]) => {
      if (key === "id") {
        return [
          [
            "_id",
            val?.$in
              ? { $in: val.$in.map((id) => new ObjectId(id)) }
              : new ObjectId(val),
          ],
        ];
      }
      if (!isSafeQueryValue(val)) return [];
      return [[key, val]];
    })
  );
const sort = (value = "-created_date") => ({ [value.replace(/^-/, "")]: value.startsWith("-") ? -1 : 1 });
const route = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "Duplicate record exists", details: error.message });
    }
    console.error("API Route Error:", error);
    res.status(error.statusCode || error.status || 500).json({ error: error.message || "Internal server error" });
  }
};

// Public branding logos (login page, marketing navbar/footer, portals). Served
// from S3 `public/` keys in production and the local public directory in dev.
app.get(
  "/api/public/uploads/:filename",
  route(async (req, res) => {
    const { filename } = req.params;
    if (!STORED_FILE_RE.test(filename)) {
      return res.status(404).json({ error: "Not found" });
    }
    const ext = path.extname(filename).toLowerCase();

    let s3Key = null;
    let filePath = null;
    if (s3.getStorage().mode === "s3") {
      const key = s3.publicKey(filename);
      if (await s3.objectExists(key)) s3Key = key;
    } else {
      try {
        const resolved = safeResolveUnder(publicUploadsDir, filename);
        if (fs.existsSync(resolved)) filePath = resolved;
      } catch {
        /* 404 below */
      }
    }

    if (!s3Key && !filePath) return res.status(404).json({ error: "Not found" });

    res.setHeader("Content-Type", SERVED_CONTENT_TYPES[ext] || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=900");

    if (s3Key) {
      const obj = await s3.getObject(s3Key);
      const body = obj.Body;
      body.on("error", () => {
        if (!res.headersSent) res.status(404).json({ error: "Not found" });
      });
      return body.pipe(res);
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "Not found" });
    });
    stream.pipe(res);
  })
);

const hashPassword = async (value) => bcrypt.hash(value, 10);
const verifyPassword = async (value, hash) => bcrypt.compare(value, hash);
const createToken = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
const getTokenFromHeader = (req) => req.headers.authorization?.replace(/^Bearer /, "");
const getUserFromToken = async (token) => {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return await (await db()).collection("User").findOne({ _id: new ObjectId(payload.userId) });
  } catch {
    return null;
  }
};

app.use(async (req, _res, next) => {
  const token = getTokenFromHeader(req);
  if (token) {
    req.user = await getUserFromToken(token);
  }
  next();
});

// --- The "view as" scope -------------------------------------------------------
//
// A platform owner who picks a school on the Super Admin dashboard or the
// Institutions page is asking a display question: "show me this school". Before
// this, the answer was wrong. The overlay in src/lib/impersonation.js changes
// only the React tree, so the real super_admin token kept going out, readScope()
// short-circuited on platform(), and every screen showed EVERY institution while
// the banner named one. On /staff it was stark: the overlay hides super_admin
// from `isPlatformOwner`, so the picker vanished, no tenant_id was sent, and
// server/index.js:5286 answered with the staff of every school.
//
// So the client now states the scope and the server narrows to it. The important
// property is MONOTONICITY: the header can only ever REMOVE rows a super_admin
// could already read, so it cannot manufacture a privilege escalation. A caller
// that omits it keeps the platform-wide read it has today — which is also why
// this is not a security boundary, only an honest answer to the question asked.
//
// Honoured for super_admin ONLY, mirroring the gate on the client side
// (applyImpersonation refuses to overlay anything but a platform owner). Any
// other caller sending the header has it IGNORED rather than refused: a
// non-platform account is already pinned to its own tenant, and the header must
// never be a way to move it.
//
// Validation is identical to requireLiveTenant() further down — unparseable or
// unknown is 404, disabled is 400 — and it FAILS CLOSED. A scope that silently
// degraded to "no scope" would show more than the operator asked for, which is
// the exact failure this whole change exists to remove.
const VIEW_AS_HEADER = "x-view-as-tenant";

// The one place "does this id name a live institution" is answered. Both the
// view-as scope and staff management must agree exactly, including on the status
// code, because a caller that reads a different answer from each is being told
// two different things about the same id.
//
//   no id            -> ok, no tenant        (nothing was named)
//   unparseable      -> 404                  (a malformed id is a name that
//   unknown          -> 404                   resolves to nothing, never a
//                                              distinct "malformed" answer)
//   disabled         -> 400                  (real, but not available)
const requireLiveTenant = async (tenantId) => {
  if (!tenantId) return { ok: true, tenant: null };
  if (!ObjectId.isValid(String(tenantId))) {
    return { ok: false, status: 404, error: "Institution not found" };
  }
  const tenant = await (await db()).collection("Tenant").findOne({ _id: new ObjectId(String(tenantId)) });
  if (!tenant) return { ok: false, status: 404, error: "Institution not found" };
  if (tenant.status && tenant.status !== "active") {
    return { ok: false, status: 400, error: "Cannot manage staff for an inactive institution" };
  }
  return { ok: true, tenant };
};

app.use(async (req, res, next) => {
  req.viewAs = null;
  const raw = req.headers[VIEW_AS_HEADER];
  if (!raw || !isSuperAdmin(req)) return next();
  const requested = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!requested) return next();
  const live = await requireLiveTenant(requested);
  if (!live.ok) return res.status(live.status).json({ error: live.error });
  req.viewAs = { tenant_id: requested };
  return next();
});

// First-login gate: a student/parent flagged `must_change_password` (a newly
// provisioned account) is blocked from all authenticated API access except the
// two endpoints it needs to complete the mandatory password change and to load
// its own identity. Prevented so a user can never reach the portal (client or
// API) with the shared institution default password still in effect.
const FIRST_LOGIN_ALLOW = new Set(["/api/auth/me", "/api/auth/change-password"]);
app.use((req, res, next) => {
  // Union: any held family role subjects the session to the gate, so a parent
  // who is also a student is not let past it by their second role.
  if (hasAnyRole(req, FAMILY_ROLES)) {
    if (req.user.must_change_password === true && !FIRST_LOGIN_ALLOW.has(req.path)) {
      return res
        .status(403)
        .json({ error: "You must change your password before continuing", code: "MUST_CHANGE_PASSWORD" });
    }
  }
  next();
});

// Email-verification gate. An account with an explicit email_verified:false has
// proven nothing about its address, so it is refused from all authenticated API
// access until it does. This is deliberately global and allowlist-based, for two
// reasons:
//
//   - Coverage. Because it is an allowlist, a route added later is protected by
//     default. A denylist scattered through handlers is the failure mode that let
//     the User /many routes drift apart from the /:id routes.
//   - Ordering. It runs after req.user is hydrated, and req.user is re-read from
//     Mongo on every request (the JWT carries only userId), so the gate reflects
//     the current state the instant it is written — there is no stale-token
//     window to reason about.
//
// It sits after the first-login gate, so an account that is both unverified and
// flagged for a password change is told to verify first; that combination is not
// currently reachable, since every non-self-service creation path is verified by
// construction.
//
// The gate no-ops when there is no session, so anonymous access to genuinely
// public routes (login, registration, health, the public branding lookup) is
// untouched. VERIFICATION_ALLOWED_PATHS additionally lists those paths so the
// exemption set is auditable in one place rather than implied.
app.use((req, res, next) => {
  if (!req.user) return next();
  if (isEmailVerified(req.user)) return next();
  if (VERIFICATION_ALLOWED_PATHS.has(req.path)) return next();
  return res.status(EMAIL_UNVERIFIED_RESPONSE.status).json({
    error: EMAIL_UNVERIFIED_RESPONSE.error,
    code: EMAIL_UNVERIFIED_RESPONSE.code,
    email: req.user.email,
  });
});

const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Authentication required" }));
const superAdmin = (req) => isSuperAdmin(req);
const platform = (req) => isPlatform(req);

// ===== Custom domain verification =====
// Schools point a CNAME at the platform's own host (examos.avexora.in). The
// target is a host owned in the platform's DNS, so it stays valid no matter
// which hosting provider serves the app — only the platform's own DNS ever has
// to change when migrating.
const PLATFORM_CNAME_TARGET = normalizeHost(process.env.PLATFORM_CNAME_TARGET || "examos.avexora.in");

const PLATFORM_DOMAINS = new Set(["avexora.in", "examos.avexora.in", "www.examos.avexora.in", "localhost"]);

// Provider-agnostic verification pipeline. Built with DI defaults wired to real
// DNS + fetch; tests construct their own instance with fakes.
const domainVerifier = createDomainVerifier({
  cnameTarget: PLATFORM_CNAME_TARGET,
  platformDomains: [...PLATFORM_DOMAINS],
  platformDomain: "avexora.in",
});

// --- Domain monitor (Phase 3) ------------------------------------------------
// Detect + record + alert only. Never attaches/detaches hosting or rewrites DNS.
// Built lazily so the first live run happens on the first cron/trigger, not at
// import time.
const adminUrl = () => process.env.APP_BASE_URL || process.env.LEAD_MANAGEMENT_URL || "";

// Absolute base URL for links that must work when clicked from an email client,
// where there is no origin to infer from. APP_BASE_URL wins; otherwise the first
// entry of the CORS allowlist is used, which is correct for the single-origin
// deployments this app runs (and for local dev against the Vite port). Both are
// empty in the current .env, so a verification link would be emitted with a
// relative base — see issueEmailVerification, which refuses to send rather than
// mail a link that cannot work.
const appBaseUrl = () => {
  const explicit = (process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const firstOrigin = parseOrigins(process.env.CLIENT_ORIGIN)[0];
  return (firstOrigin || "").replace(/\/+$/, "");
};

// Issues a fresh verification token for a user and mails the link.
//
// Only the SHA-256 hash is persisted, so a database read cannot be replayed as a
// verification. The plaintext exists solely inside this function, to build the
// link, and is returned to the caller only for the explicit development escape
// hatch described at the bottom.
const issueEmailVerification = async (user) => {
  const database = await db();
  const token = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS).toISOString();

  // $set writes the state as unverified alongside the token so the document is
  // self-consistent: a token existing means "not yet verified".
  await database.collection("User").updateOne(
    { _id: user._id },
    {
      $set: {
        email_verified: false,
        email_verification_token: hashedToken,
        email_verification_expires_at: expiresAt,
        updated_date: new Date().toISOString(),
      },
    }
  );

  const base = appBaseUrl();
  const link = base ? `${base}/verify-email?token=${encodeURIComponent(token)}` : "";

  let emailConfig = null;
  try {
    emailConfig = await getEffectiveEmailConfig();
  } catch {
    emailConfig = null;
  }
  const configured = isEmailConfigured(emailConfig);

  let delivered = false;
  if (configured && link) {
    const result = await sendEmail({
      to: user.email,
      subject: "Verify your email address",
      text: [
        "Welcome to ExamOS.",
        "",
        "Confirm this address to activate your account:",
        link,
        "",
        `The link expires in ${Math.round(VERIFICATION_TOKEN_EXPIRY_MS / (60 * 60 * 1000))} hours.`,
        "If you did not create this account, you can ignore this message.",
      ].join("\n"),
      html: `<p>Welcome to ExamOS.</p><p>Confirm this address to activate your account:</p><p><a href="${link
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;")}">Verify my email</a></p><p>The link expires in ${Math.round(
        VERIFICATION_TOKEN_EXPIRY_MS / (60 * 60 * 1000)
      )} hours. If you did not create this account, you can ignore this message.</p>`,
    });
    delivered = Boolean(result.ok);
  } else if (!link) {
    // Mailing a relative link would produce an email the recipient cannot use.
    // Refusing loudly is better than a silently broken activation path.
    console.warn(
      "[verify-email] APP_BASE_URL and CLIENT_ORIGIN are both unset; no verification link can be built. Set APP_BASE_URL."
    );
  }

  // Development escape hatch: with no SMTP configured there is otherwise no way
  // to complete the flow locally. Gated behind an explicit opt-in that is never
  // set in a real deployment, so a misconfigured production instance cannot leak
  // a working token over HTTP.
  const devToken =
    !configured && process.env.EMAIL_VERIFICATION_DEV_TOKEN === "1" ? { dev_verification_token: token } : {};

  return { delivered, email_configured: configured, ...devToken };
};
let domainMonitorInstance = null;

// Single-flight lease for the domain monitor (Phase 4). Concurrent cron + manual
// runs share it so they can never double-probe or double-alert. Fail safe: an
// update error here propagates up and the monitor aborts before probing anything
// rather than proceeding without coordination. A crashed run leaves the lease
// "running" but it expires naturally (leaseMs) and the next run takes over.
const MONITOR_RUN_ID = "singleton";
const acquireMonitorLease = async ({ now = new Date() } = {}) => {
  const database = await db();
  const leaseMs = Number(process.env.DOMAIN_MONITOR_LEASE_MS) || 15 * 60 * 1000;
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const result = await database.collection("DomainMonitorRun").updateOne(
    {
      _id: MONITOR_RUN_ID,
      $or: [{ state: { $ne: "running" } }, { lease_expires_at: { $lt: now } }],
    },
    { $set: { state: "running", lease_expires_at: leaseExpiresAt.toISOString(), acquired_at: now.toISOString() } },
    { upsert: true }
  );
  if (result.upsertedCount === 1 || result.modifiedCount === 1) return { acquired: true, lease_expires_at: leaseExpiresAt };
  return { acquired: false };
};

// On completion the lease is released and the run summary is persisted as the
// history/audit trail (run history capped at the last 20 runs).
const releaseMonitorLease = async (summary) => {
  const database = await db();
  const finishedAt = new Date().toISOString();
  const lastRun = { ...summary, finished_at: finishedAt };
  const now = new Date().toISOString();
  await database.collection("DomainMonitorRun").updateOne(
    { _id: MONITOR_RUN_ID },
    {
      $set: { state: "idle", lease_expires_at: null, updated_at: now, last_run: lastRun },
      $push: { runs: { $each: [lastRun], $slice: -20 } },
    },
    { upsert: true }
  );
};

const getMonitorRunDoc = async () => {
  const database = await db();
  return database.collection("DomainMonitorRun").findOne({ _id: MONITOR_RUN_ID }).catch(() => null);
};

const listSuperAdminEmails = async () => {
  const database = await db();
  const admins = await database
    .collection("User")
    .find({ $or: [{ app_role: "super_admin" }, { app_roles: "super_admin" }] })
    .toArray()
    .catch(() => []);
  const emails = [...new Set(admins.map((u) => u.email).filter(Boolean))];
  if (!emails.length && process.env.ADMIN_EMAIL) emails.push(process.env.ADMIN_EMAIL);
  return emails;
};

const getDomainMonitor = () => {
  if (domainMonitorInstance) return domainMonitorInstance;
  domainMonitorInstance = createDomainMonitor({
    verifier: domainVerifier,
    acquireLease: acquireMonitorLease,
    releaseLease: releaseMonitorLease,
    listTenants: async ({ sort, limit }) => {
      const database = await db();
      return database
        .collection("Tenant")
        .find({ custom_domain: { $type: "string", $ne: "" }, status: { $ne: "suspended" } })
        .sort(sort || { custom_domain_checked_at: 1 })
        .limit(limit || 80)
        .toArray();
    },
    updateTenant: async (id, $set) => {
      const database = await db();
      await database.collection("Tenant").updateOne({ _id: new ObjectId(String(id)) }, { $set });
    },
    notify: async (tenant, change) => {
      const emails = await listSuperAdminEmails();
      if (!emails.length) return { delivered: 0 };
      const { subject, text, html } = buildDomainAlert({
        change,
        cnameTarget: PLATFORM_CNAME_TARGET,
        baseUrl: adminUrl(),
      });
      let delivered = 0;
      for (const to of emails) {
        try {
          const result = await sendEmail({ to, subject, text, html });
          if (result.ok) delivered += 1;
        } catch {
          /* per-recipient failures are non-fatal */
        }
      }
      if (!delivered) console.warn(`[domain-monitor] alert for ${change.host} could not be emailed`);
      return { delivered };
    },
    audit: async (tenant, change) => {
      const database = await db();
      await database
        .collection("AuditLog")
        .insertOne({
          tenant_id: String(tenant._id || ""),
          actor_name: "System (Domain Monitor)",
          actor_role: "system",
          action: "custom_domain_monitor",
          entity_type: "Tenant",
          entity_id: String(tenant._id || ""),
          details: `${change.host}: ${change.from.status || "—"} → ${change.to.status || "—"} (${(change.problems || [])
            .map((p) => p.human)
            .join(", ") || "no change"})`,
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString(),
        })
        .catch(() => {});
    },
  });
  return domainMonitorInstance;
};
// Lead Management is a Super Admin-only operational surface. employee (platform
// support staff) and every tenant role are explicitly excluded at the server,
// never relying on the client to hide the page.
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!superAdmin(req)) return res.status(403).json({ error: "Forbidden" });
  next();
};
// The affiliate programme has its own gate rather than reusing requireSuperAdmin,
// because the two answer different questions and will not stay in step.
// canSellAsAffiliate admits the reseller; requireSuperAdmin would admit the
// platform owner, who has no business minting a sale and crediting commission on
// it — that is a conflict of interest the role split exists to prevent.
const requireAffiliate = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!canSellAsAffiliate(req)) return res.status(403).json({ error: "Forbidden" });
  next();
};
// --- SEC-01: Centralized RBAC -------------------------------------------------
// The role vocabulary, the entity write matrix and every role predicate now live
// in server/rbac.js. That module is pure (no request, no database), which is what
// lets the whole policy be regression-tested under `node --test` without a live
// MongoDB — the previous inline copies had no test coverage at all, and had
// already drifted into eight separate definitions across the codebase.

// --- SEC-02: Audit event integrity -------------------------------------------
// The client-facing /api/functions/logAudit endpoint only records benign UI
// "echo" events (e.g. "created class"). Everything sensitive — Examination,
// Result, OMRSheet, AnswerKey, Student, Teacher and Tenant mutations, role
// changes and invitations — is written by the server via logServerAudit AFTER
// the underlying mutation succeeds, so no client can manufacture trust.
// Entity:verb pairs a client may record an audit event for, restricted to the
// structural changes an institution administrator performs in the UI. The role
// set for each pair is read from ENTITY_WRITE_ROLES rather than restated here:
// this map used to carry its own copies of the same lists, which is how the two
// drifted and let a client log an event for a write it could not perform.
const CLIENT_AUDIT_EVENTS = new Map(
  Object.entries({
    SchoolClass: ["create", "update", "delete"],
    Subject: ["create", "update", "delete"],
    Teacher: ["create", "update"],
    SubscriptionPlan: ["create", "update"],
  }).flatMap(([name, verbs]) =>
    verbs.map((verb) => [`${verb}:${name}`, new Set(ENTITY_WRITE_ROLES[name][verb])])
  )
);

// Entities whose mutations are audited server-side and never accepted from
// arbitrary client logAudit calls.
const SERVER_AUDIT_ENTITIES = new Set([
  "AcademicYear", "Affiliate", "AffiliateSale", "AnswerKey", "Assignment", "AssignmentSubmission", "Attendance",
  "Enrollment", "Examination", "OMRSheet", "Parent",
  "ParentStudent", "Result", "Section", "Student", "Teacher", "TeacherAssignment", "Tenant",
  // PlanChangeRequest carries no client-writable verb (its ENTITY_WRITE_ROLES row is
  // empty), so CLIENT_AUDIT_EVENTS grants no client audit for it at all. It is listed
  // here because a super_admin still bypasses canWriteEntity, so a direct entity write
  // is possible — and must leave a trail rather than mutate a paid entitlement quietly.
  "PlanChangeRequest",
]);

// Internal audit writer. Actor identity and tenant are ALWAYS derived from the
// verified session (req.user); client-supplied values are never trusted.
// Best-effort by design: failing to record an event must never break the
// business operation it describes. No secrets are ever written.
const logServerAudit = async (req, { action, entity_type, entity_id, details, actor }) => {
  try {
    const database = await db();
    const now = new Date().toISOString();
    // `actor` is an explicit, server-derived override for events on routes that
    // are anonymous by design (registration, token verification). The values come
    // from the database document the request was matched against — never from
    // req.body, which a caller controls and could use to forge who did something.
    // Everything else still falls back to the session.
    const source = actor || req.user || {};
    await database.collection("AuditLog").insertOne({
      tenant_id: source.tenant_id || "",
      actor_name: source.full_name || source.email || "Unknown",
      actor_role: source.app_role || "",
      action: String(action).slice(0, 80),
      entity_type: String(entity_type).slice(0, 80),
      entity_id: entity_id ? String(entity_id).slice(0, 120) : "",
      details: details ? String(details).slice(0, 500) : "",
      created_date: now,
      updated_date: now,
    });
  } catch (err) {
    console.warn("Audit log write failed (non-fatal):", err.message);
  }
};

// Examination / OMR evaluation workflow predicate. isExamWorkflow lives in
// server/rbac.js alongside the rest of the policy; this alias keeps the many
// call sites in this file readable.
const examWorkflow = (req) => isExamWorkflow(req);

// The single authority for changing a User's roles. Both
// `manageStaff {action:"setRoles"}` and the generic `PATCH /api/entities/User/:id`
// route through here, so there is exactly one place where the delegation matrix,
// the role-family rule, tenant boundary and audit trail are enforced for a
// privilege change.
//
// It exists because those two paths used to disagree: setRole enforced the
// hierarchy and wrote an audit event, while the generic PATCH did neither and
// was reachable by super_admin alone (ENTITY_WRITE_ROLES.User.update is []), so
// a role could be minted or self-demoted through a route that contradicted the
// audited one and left no trace.
//
// It assigns a SET. `app_roles` is canonical and `app_role` is written as the
// mirror of the primary role, in the same $set — the two can never disagree,
// which is why there is no separate "sync the mirror" step to forget.
//
// Returns { status, error } on refusal so each caller keeps its own response
// shape, or undefined on success.
const assignUserRoles = async (req, { user_id, app_roles }) => {
  const database = await db();
  if (!user_id) return { status: 400, error: "user_id and app_roles required" };
  if (!ObjectId.isValid(String(user_id))) return { status: 404, error: "User not found" };

  // One role may arrive as a bare string, and the legacy single-role callers send
  // `app_role`. Normalize before validating so a client that has not been updated
  // yet still assigns exactly one role rather than being refused.
  const requested = Array.isArray(app_roles)
    ? app_roles
    : app_roles !== undefined ? [app_roles]
      : req.body?.app_roles ?? (req.body?.app_role !== undefined ? [req.body.app_role] : []);

  // Gate 1, the role-family rule, first: it is a property of the request alone and
  // refuses the genuinely dangerous shape (a family account that is also staff)
  // before any database work.
  const shape = validateAppRoleSet(requested);
  if (shape.error) return { status: 400, error: shape.error };
  const { roles } = shape;

  const creatorRoles = rolesOf(req);

  // Gate 2, the TENANT boundary, before the hierarchy judgement. Order matters
  // here: if the delegation check ran first, the 403-vs-404 difference would tell
  // a caller whether its own authority was insufficient FOR THAT TARGET, which is a
  // free cross-tenant signal. Answering 404 first makes the reply identical
  // whether the account does not exist, belongs to another school, or exists and
  // the caller was simply not allowed.
  const targetUser = await database.collection("User").findOne({ _id: new ObjectId(String(user_id)) });
  if (!targetUser) return { status: 404, error: "User not found" };
  if (!superAdmin(req) && String(targetUser.tenant_id || "") !== String(req.user?.tenant_id || "")) {
    return { status: 404, error: "User not found" };
  }

  // Gate 3, the delegation matrix — ROLE_ASSIGNMENT_HIERARCHY, not the minting
  // one, because this action re-labels an existing account. That is what makes
  // school_admin -> school_admin permitted here while the invite and provision
  // paths still refuse it.
  if (!superAdmin(req)) {
    const refused = canAssignRoleSet(creatorRoles, roles);
    if (refused.error) return { status: 403, error: refused.error };
  }

  // A platform role is institution-independent, a tenant role requires one.
  // Writing either without its counterpart leaves an account that can authenticate
  // but can never reach an institution's data (or, worse, a tenant role attached
  // to a platform-wide account), so the pair is always written together. With a
  // role SET the question is asked of the primary role, which is the one that
  // decides the account's home — and role families are mutually exclusive, so a
  // set can never straddle platform and tenant.
  const primaryRole = roles[0];
  const isPlatformRole = PLATFORM_ROLES.has(primaryRole);
  const nextTenantId = isPlatformRole ? null : targetUser.tenant_id || null;
  if (!isPlatformRole && !nextTenantId) {
    return { status: 400, error: "A tenant role requires the account to belong to an institution" };
  }

  // Gate 4, the last-administrator invariant. Stripping school_admin is permitted
  // — a school may genuinely want to stand a colleague down — and it stays
  // reversible, because a school_admin may promote an existing account back (gate
  // 3). What is NOT reversible from inside the school is ending up with nobody: a
  // school with no administrator cannot manage its own staff, billing or branding,
  // and minting a replacement administrator is a platform action (see
  // canProvisionRoleSet), so the school would have to ask for one.
  //
  // Applied to every caller, super_admin included: they can simply promote someone
  // first, and one uniform rule is easier to reason about than a special case that
  // quietly exempts whichever actor is logged in.
  const wasAdmin = hasRole({ user: targetUser }, APP_ROLES.SCHOOL_ADMIN);
  if (wasAdmin && !roles.includes(APP_ROLES.SCHOOL_ADMIN) && nextTenantId) {
    const otherAdmins = await countTenantAdmins(database, nextTenantId, targetUser._id);
    if (otherAdmins === 0) {
      return {
        status: 400,
        error: `This is the only administrator for this institution. Promote another account to administrator first, or ask the platform to appoint one.`,
      };
    }
  }

  const now = new Date().toISOString();
  await database.collection("User").updateOne(
    { _id: targetUser._id },
    { $set: { app_roles: roles, app_role: primaryRole, tenant_id: nextTenantId, updated_date: now } }
  );
  // Write-then-audit, not audit-then-write: a failed mutation after the audit row
  // leaves a phantom log entry, whereas a failed audit after the mutation leaves an
  // unlogged change. The latter is the worse failure and is what this does.
  await logServerAudit(req, {
    action: "assign_role",
    entity_type: "User",
    entity_id: targetUser._id.toString(),
    details: `${targetUser.email || targetUser._id} -> [${roles.join(", ")}]${nextTenantId ? ` (tenant ${nextTenantId})` : " (platform)"}`,
  });
  return undefined;
};

// How many OTHER accounts in this institution hold the administrator role.
//
// The query mirrors appRolesOf()'s legacy fallback for the same reason the staff
// list does: $size: 0 does not match a missing field, so a pre-migration
// administrator document has to be counted through its `app_role` mirror or the
// school looks administrator-less when it is not.
const countTenantAdmins = async (database, tenantId, excludeUserId) => {
  const tenant = String(tenantId);
  return database.collection("User").countDocuments({
    tenant_id: tenant,
    ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
    $or: [
      { app_roles: APP_ROLES.SCHOOL_ADMIN },
      { app_roles: { $exists: false }, app_role: APP_ROLES.SCHOOL_ADMIN },
      { app_roles: { $size: 0 }, app_role: APP_ROLES.SCHOOL_ADMIN },
    ],
  });
};

// Back-compat alias for the single-role call sites and the `setRole` action the
// existing client still sends. It is the same function, not a parallel path —
// that duplication is what the original two-route disagreement was.
const assignUserRole = (req, { user_id, app_role, app_roles } = {}) =>
  assignUserRoles(req, { user_id, app_roles: app_roles ?? app_role });

// Once an examination reaches one of these states its answer key is frozen for
// every role: the key is the input to evaluation, so changing it afterwards would
// silently invalidate every Result already computed from it. Mirrors the exam
// status ladder in src/components/exams/ExamWorkflowSteps.jsx.
const FROZEN_EXAM_STATUSES = new Set(["evaluated", "reviewed", "published"]);

// Result lifecycle is draft -> reviewed -> published. Teachers see only the two
// signed-off states; "draft" means evaluation ran but a coordinator has not yet
// verified the sheet.
const TEACHER_VISIBLE_RESULT_STATUSES = ["reviewed", "published"];

const normalizeEmail = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? "" : trimmed.toLowerCase();
};
const EMAIL_FIELDS = {
  User: ["email"],
  Teacher: ["email"],
  Student: ["student_email", "parent_email", "email"],
  Parent: ["email"],
};
const normalizeEmailFields = (name, data = {}) => {
  const fields = EMAIL_FIELDS[name];
  if (!fields || !data || typeof data !== "object") return data;
  const result = { ...data };
  for (const field of fields) {
    if (field in result) result[field] = normalizeEmail(result[field]);
  }
  return result;
};
// Helper for safely intersecting client _id criteria with an authorized set of ID strings
const intersectIdCriteria = (criteria, allowedIds) => {
  const allowedSet = new Set((allowedIds || []).map(String));
  if (allowedSet.size === 0) return null;

  if (criteria?._id) {
    if (criteria._id instanceof ObjectId) {
      return allowedSet.has(criteria._id.toString()) ? criteria._id : null;
    }
    if (typeof criteria._id === "string") {
      return allowedSet.has(criteria._id) && ObjectId.isValid(criteria._id) ? new ObjectId(criteria._id) : null;
    }
    if (Array.isArray(criteria._id?.$in)) {
      const matched = criteria._id.$in
        .map((id) => (id instanceof ObjectId ? id : ObjectId.isValid(id) ? new ObjectId(id) : null))
        .filter((oid) => oid && allowedSet.has(oid.toString()));
      return matched.length ? { $in: matched } : null;
    }
    return null;
  }
  const allowedOids = [...allowedSet].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  return allowedOids.length ? { $in: allowedOids } : null;
};

// Helper for safely intersecting client string-field criteria (like student_id or school_class_ids) with an authorized set
const intersectStringFieldCriteria = (criteria, field, allowedValues) => {
  const allowedSet = new Set((allowedValues || []).map(String));
  if (allowedSet.size === 0) return null;

  if (criteria?.[field]) {
    if (typeof criteria[field] === "string") {
      return allowedSet.has(criteria[field]) ? criteria[field] : null;
    }
    if (Array.isArray(criteria[field]?.$in)) {
      const matched = criteria[field].$in.map(String).filter((val) => allowedSet.has(val));
      return matched.length ? { $in: matched } : null;
    }
    return null;
  }
  return { $in: [...allowedSet] };
};

// Forms still submit human-readable selections. Resolve them once, inside the
// tenant boundary, to the canonical IDs consumed by authorization.
const hydrateRelationshipIds = async (req, name, data = {}) => {
  if (platform(req) || !req.user?.tenant_id || !data || typeof data !== "object") return data;
  const result = { ...data };
  const database = await db();
  const resolve = async (collection, names, createIfMissing = true) => {
    if (!Array.isArray(names) || names.length === 0) return [];
    const coll = database.collection(collection);
    const existing = await coll.find({ tenant_id: req.user.tenant_id, name: { $in: names } }, { projection: { _id: 1, name: 1 } }).toArray();
    const map = new Map(existing.map((doc) => [doc.name, doc._id.toString()]));
    const missing = names.filter((n) => !map.has(n));
    if (missing.length && createIfMissing) {
      const now = new Date().toISOString();
      const inserted = await coll.insertMany(missing.map((n) => ({ tenant_id: req.user.tenant_id, name: n, created_date: now, updated_date: now })));
      missing.forEach((n, i) => map.set(n, inserted.insertedIds[i].toString()));
    }
    const ids = names.map((n) => map.get(n)).filter(Boolean);
    return ids.length ? ids : null;
  };

  if (name === "Student") {
    if (!result.school_class_id && result.class_name) {
      const ids = await resolve("SchoolClass", [result.class_name], false);
      if (ids?.[0]) result.school_class_id = ids[0];
      // createIfMissing is false, so an unresolvable class_name is dropped
      // silently and the student is stored with no school_class_id -- invisible
      // to every class-scoped query (teacher reads, attendance, rosters,
      // results) while still looking correct in a UI that renders class_name.
      // Surface it instead of failing quietly; the import dialog already
      // surfaces _syncWarnings per row.
      else if (!ids?.[0]) {
        result._syncWarnings = [
          ...(Array.isArray(result._syncWarnings) ? result._syncWarnings : []),
          `Class "${result.class_name}" does not exist in this school, so no class was linked. Create the class in Academic Setup, then re-save or run scripts/backfill-student-class-ids.mjs.`,
        ];
      }
    }
    if (result.school_class_id && !result.class_name) {
      const cls = await database.collection("SchoolClass").findOne({ _id: new ObjectId(result.school_class_id), tenant_id: req.user.tenant_id }, { projection: { name: 1 } });
      if (cls) result.class_name = cls.name;
    }
    if (result.section && result.school_class_id && !result.section_id) {
      const sec = await database.collection("Section").findOne({ tenant_id: req.user.tenant_id, school_class_id: result.school_class_id, name: result.section }, { projection: { _id: 1 } });
      if (sec) result.section_id = sec._id.toString();
    }
  }

  if (name === "Teacher") {
    const classNames = Array.isArray(result.assigned_classes)
      ? result.assigned_classes
      : Array.isArray(result.classes)
        ? result.classes
        : typeof result.assigned_classes === "string" && result.assigned_classes
          ? result.assigned_classes.split(",").map((s) => s.trim()).filter(Boolean)
          : typeof result.classes === "string" && result.classes
            ? result.classes.split(",").map((s) => s.trim()).filter(Boolean)
            : null;

    if (!result.assigned_class_ids && classNames) {
      const ids = await resolve("SchoolClass", classNames, true);
      if (ids) result.assigned_class_ids = ids;
    }
    if (classNames && !result.assigned_classes) result.assigned_classes = classNames;
    if (Array.isArray(result.assigned_class_ids) && result.assigned_class_ids.length > 0 && !result.assigned_classes) {
      const oids = objectIdsOrNull(result.assigned_class_ids);
      if (oids) {
        const classes = await database.collection("SchoolClass").find({ _id: { $in: oids }, tenant_id: req.user.tenant_id }, { projection: { name: 1 } }).toArray();
        result.assigned_classes = classes.map((c) => c.name);
      }
    }

    const subjectNames = Array.isArray(result.assigned_subjects)
      ? result.assigned_subjects
      : Array.isArray(result.subjects)
        ? result.subjects
        : result.subject
          ? [result.subject]
          : typeof result.subjects === "string" && result.subjects
            ? result.subjects.split(",").map((s) => s.trim()).filter(Boolean)
            : null;

    if (!result.assigned_subject_ids && subjectNames) {
      const ids = await resolve("Subject", subjectNames, true);
      if (ids) result.assigned_subject_ids = ids;
    }
    if (subjectNames && !result.subjects) result.subjects = subjectNames;
    if (Array.isArray(result.assigned_subject_ids) && result.assigned_subject_ids.length > 0 && !result.subjects) {
      const oids = objectIdsOrNull(result.assigned_subject_ids);
      if (oids) {
        const subjects = await database.collection("Subject").find({ _id: { $in: oids }, tenant_id: req.user.tenant_id }, { projection: { name: 1 } }).toArray();
        result.subjects = subjects.map((s) => s.name);
      }
    }

    if (!result.user_id && result.email) {
      const user = await database.collection("User").findOne({ tenant_id: req.user.tenant_id, email: normalizeEmail(result.email) }, { projection: { _id: 1 } });
      if (user) result.user_id = user._id.toString();
    }
  }

  if (name === "TeacherAssignment") {
    if (!result.school_class_id && result.class_name) {
      const ids = await resolve("SchoolClass", [result.class_name], false);
      if (ids?.[0]) result.school_class_id = ids[0];
    }
    if (!result.subject_id && result.subject_name) {
      const ids = await resolve("Subject", [result.subject_name], false);
      if (ids?.[0]) result.subject_id = ids[0];
    }
    if (!result.section_id && result.section_name && result.school_class_id) {
      const sec = await database.collection("Section").findOne({ tenant_id: req.user.tenant_id, school_class_id: result.school_class_id, name: result.section_name }, { projection: { _id: 1 } });
      if (sec) result.section_id = sec._id.toString();
    }
  }

  if (name === "Enrollment") {
    if (!result.school_class_id && result.class_name) {
      const ids = await resolve("SchoolClass", [result.class_name], false);
      if (ids?.[0]) result.school_class_id = ids[0];
    }
    if (!result.section_id && (result.section_name || result.section) && result.school_class_id) {
      const sec = await database.collection("Section").findOne({ tenant_id: req.user.tenant_id, school_class_id: result.school_class_id, name: result.section_name || result.section }, { projection: { _id: 1 } });
      if (sec) result.section_id = sec._id.toString();
    }
    if (!result.academic_year_id && result.academic_year_name) {
      const yr = await database.collection("AcademicYear").findOne({ tenant_id: req.user.tenant_id, name: result.academic_year_name }, { projection: { _id: 1 } });
      if (yr) result.academic_year_id = yr._id.toString();
    }
  }

  if (name === "Examination") {
    const classNames = Array.isArray(result.class_names)
      ? result.class_names
      : result.class_name
        ? [result.class_name]
        : [];

    // Normalize class ids: accept array or legacy singular id.
    let schoolClassIds = Array.isArray(result.school_class_ids)
      ? result.school_class_ids.filter(Boolean).map(String)
      : result.school_class_id
        ? [String(result.school_class_id)]
        : [];

    if (schoolClassIds.length === 0 && classNames.length > 0) {
      const ids = await resolve("SchoolClass", classNames, true);
      if (ids) schoolClassIds = ids.map(String);
    }
    if (schoolClassIds.length > 0) {
      result.school_class_ids = [...new Set(schoolClassIds)];
      delete result.school_class_id;
    } else {
      delete result.school_class_ids;
      delete result.school_class_id;
    }

    // Academic year: explicit > academic_year_name > tenant current year.
    if (!result.academic_year_id && result.academic_year_name) {
      const yr = await database.collection("AcademicYear").findOne(
        { tenant_id: req.user.tenant_id, name: String(result.academic_year_name).trim() },
        { projection: { _id: 1 } }
      );
      if (yr) result.academic_year_id = yr._id.toString();
    }
    if (!result.academic_year_id && req.user?.tenant_id) {
      const currentYear = await database.collection("AcademicYear").findOne(
        { tenant_id: req.user.tenant_id, is_current: true },
        { projection: { _id: 1 } }
      );
      if (currentYear) result.academic_year_id = currentYear._id.toString();
    }

    // Uniform section list across selected classes; keep legacy singular field.
    let sectionIds = Array.isArray(result.section_ids)
      ? result.section_ids.filter(Boolean).map(String)
      : result.section_id
        ? [String(result.section_id)]
        : [];
    if (sectionIds.length > 0) {
      result.section_ids = [...new Set(sectionIds)];
      result.section_id = result.section_ids[0];
    } else {
      delete result.section_ids;
      delete result.section_id;
    }

    const subjectNames = Array.isArray(result.subjects)
      ? result.subjects
      : result.subject_name
        ? [result.subject_name]
        : result.subject
          ? [result.subject]
          : [];
    if (!result.subject_ids && subjectNames.length > 0) {
      result.subject_ids = await resolve("Subject", subjectNames, true);
    }

    // Scheduling fields: session/start_time/end_time/venue live on the Examination.
    if (result.session !== undefined) {
      const validSessions = ["morning", "afternoon", "evening", "unscheduled"];
      result.session = validSessions.includes(result.session) ? result.session : "unscheduled";
    }
    for (const f of ["start_time", "end_time", "venue"]) {
      if (result[f] === undefined || result[f] === null || result[f] === "") {
        delete result[f];
      } else {
        result[f] = String(result[f]).trim();
      }
    }
    if (result.duration_minutes !== undefined) {
      result.duration_minutes = Number(result.duration_minutes) || 0;
    }
  }

  if (name === "Attendance") {
    if (!result.school_class_id && result.class_name) {
      const ids = await resolve("SchoolClass", [result.class_name], false);
      if (ids?.[0]) result.school_class_id = ids[0];
    }
    if (!result.section_id && (result.section_name || result.section) && result.school_class_id) {
      const sec = await database.collection("Section").findOne({ tenant_id: req.user.tenant_id, school_class_id: result.school_class_id, name: result.section_name || result.section }, { projection: { _id: 1 } });
      if (sec) result.section_id = sec._id.toString();
    }
    if (!result.academic_year_id && result.academic_year_name) {
      const yr = await database.collection("AcademicYear").findOne({ tenant_id: req.user.tenant_id, name: result.academic_year_name }, { projection: { _id: 1 } });
      if (yr) result.academic_year_id = yr._id.toString();
    }
  }

  if (name === "Assignment") {
    if (!result.school_class_id && result.class_name) {
      const ids = await resolve("SchoolClass", [result.class_name], false);
      if (ids?.[0]) result.school_class_id = ids[0];
    }
    if (!result.section_id && (result.section_name || result.section) && result.school_class_id) {
      const sec = await database.collection("Section").findOne({ tenant_id: req.user.tenant_id, school_class_id: result.school_class_id, name: result.section_name || result.section }, { projection: { _id: 1 } });
      if (sec) result.section_id = sec._id.toString();
    }
    if (!result.subject_id && result.subject_name) {
      const ids = await resolve("Subject", [result.subject_name], false);
      if (ids?.[0]) result.subject_id = ids[0];
    }
    if (!result.academic_year_id && result.academic_year_name) {
      const yr = await database.collection("AcademicYear").findOne({ tenant_id: req.user.tenant_id, name: result.academic_year_name }, { projection: { _id: 1 } });
      if (yr) result.academic_year_id = yr._id.toString();
    }
  }

  if (name === "AssignmentSubmission") {
    if (result.assignment_id && ObjectId.isValid(result.assignment_id)) {
      const assignment = await database.collection("Assignment").findOne({ _id: new ObjectId(result.assignment_id), tenant_id: req.user.tenant_id });
      if (assignment) {
        if (!result.school_class_id && assignment.school_class_id) result.school_class_id = assignment.school_class_id;
        if (!result.assignment_title && assignment.title) result.assignment_title = assignment.title;
      }
    }
  }
  return result;
};
const assertTenantOwnership = (req, doc) => {
  if (platform(req)) return;
  if (!doc || doc.tenant_id !== req.user?.tenant_id) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
};
const objectIdsOrNull = (ids) => {
  if (!Array.isArray(ids) || ids.some((id) => !ObjectId.isValid(id))) return null;
  return ids.map((id) => new ObjectId(id));
};
// Phase 0/1: generic CRUD is a security boundary, not a convenience query API.
// Every scoped role receives an intersected, database-derived relationship
// predicate.  Client filters can narrow this predicate, never widen it.
const readScope = async (req, name, criteria = {}) => {
  // The "view as" scope, applied ABOVE the platform() short-circuit below.
  //
  // It has to be here rather than inside the tenant branches, because a
  // super_admin never reaches those: platform() returns the criteria untouched.
  // Putting the narrowing first is what makes "show me this school" mean it.
  //
  // Two exemptions, both deliberate:
  //
  //   Tenant  the Institutions console and the institution picker are how you
  //           LEAVE a scope, so narrowing them would trap the operator in the
  //           school they are viewing. Lead and Payment are the commercial
  //           record, which is the platform's business rather than a school's.
  //   publicRead  branding and plan lookups are global reference data, not
  //           tenant records, so a "name" filter would break rendering.
  //
  // User IS narrowed, and it is in globalOnly precisely because of the employee
  // tenant-assignment feature — so leaving it wide would have kept the original
  // defect alive on the one list that most looks like "this school's staff".
  // The commercial set is named explicitly rather than reused from globalOnly for
  // exactly that reason: globalOnly also holds User, which must stay narrowed.
  if (req.viewAs) {
    if (!PLATFORM_COMMERCIAL_RECORDS.has(name) && !publicRead.has(name)) {
      return { ...criteria, tenant_id: req.viewAs.tenant_id };
    }
    return criteria;
  }

  // `affiliate` reaches neither the platform() short-circuit above nor any tenant
  // branch below: it is not a platform role, not publicRead, not privileged, and
  // not a teacher or family primary. Control therefore falls all the way through
  // to `return deny` at the end of this function — `{ _id: null }`, an empty
  // result for every collection. That is deliberate and is the whole point of
  // giving the role its own family in server/rbac.js: a reseller reads NOTHING
  // through generic CRUD, and the entire affiliate surface is served by the
  // bespoke /api/affiliates routes, which scope every query to the caller's own
  // Affiliate document.
  if (platform(req) || publicRead.has(name)) return criteria;

  if (globalOnly.has(name)) {
    const isOwnTenant =
      name === "Tenant" &&
      req.user?.tenant_id &&
      (
        criteria._id instanceof ObjectId
          ? criteria._id.toString() === req.user.tenant_id
          : criteria._id?.$in?.some(
              (oid) => oid.toString() === req.user.tenant_id
            )
      );

    if (isOwnTenant) return criteria;

    return { _id: null };
  }

  const tenantCriteria = { ...criteria, tenant_id: req.user?.tenant_id || "__none__" };
  const roles = rolesOf(req);
  // Union: any held privileged role earns the institution-wide announcement
  // read. A principal who also coordinates exams is still a principal.
  if (roles.some((role) => PRIVILEGED_TENANT_ROLES.has(role))) return tenantCriteria;

  // Institute announcements: privileged staff can see every tenant
  // announcement; other tenant roles see only the announcements the school
  // admin targeted at their role. An empty or missing target_roles means the
  // announcement is sent to everyone.
  if (name === "TenantAnnouncement") {
    if (!req.user?.tenant_id) return { _id: null };
    return {
      ...tenantCriteria,
      // Any held role, not the primary: a teacher who also coordinates exams
      // should still receive the notice addressed to teachers.
      $or: [
        { target_roles: { $in: roles } },
        { target_roles: { $exists: false } },
        { target_roles: [] },
      ],
    };
  }

  const database = await db();
  const deny = { _id: null };
  let ownStudentIds = studentIdsForUser(req.user);

  // Family accounts are scoped to their OWN records, and with more than one
  // family role held that is the union of what each role owns — never a widening
  // beyond the person's own household. A parent who is also a student may see
  // the children they parent and the record they are a student in; neither
  // branch reaches anyone else's data, so combining them cannot escalate.
  if (roles.some((held) => FAMILY_ROLES.has(held))) {
    const isParent = hasRole(req, APP_ROLES.PARENT);
    if (isParent) {
      const normEmail = normalizeEmail(req.user.email);
      const parentDoc = await database.collection("Parent").findOne({
        tenant_id: req.user.tenant_id,
        $or: [
          { user_id: req.user._id.toString() },
          ...(normEmail ? [{ email: normEmail }] : []),
        ],
        status: { $ne: "inactive" },
      });
      if (parentDoc) {
        const links = await database.collection("ParentStudent").find({
          tenant_id: req.user.tenant_id,
          parent_id: parentDoc._id.toString(),
        }).toArray();
        const linkedFromTable = links.map((l) => l.student_id).filter(Boolean);
        ownStudentIds = [...new Set([...ownStudentIds, ...linkedFromTable])];
      }
      if (normEmail) {
        const legacyStudents = await database.collection("Student").find({
          tenant_id: req.user.tenant_id,
          parent_email: normEmail,
        }, { projection: { _id: 1 } }).toArray();
        ownStudentIds = [...new Set([...ownStudentIds, ...legacyStudents.map((s) => s._id.toString())])];
      }
    }

    if (!ownStudentIds.length) return deny;
    const ownObjectIds = objectIdsOrNull(ownStudentIds);
    if (!ownObjectIds) return deny;

    if (name === "Student") {
      const idCrit = intersectIdCriteria(criteria, ownStudentIds);
      return idCrit ? { ...tenantCriteria, _id: idCrit } : deny;
    }
    if (name === "Enrollment") {
      const studentCrit = intersectStringFieldCriteria(criteria, "student_id", ownStudentIds);
      return studentCrit ? { ...tenantCriteria, student_id: studentCrit } : deny;
    }
    if (name === "ParentStudent") {
      const studentCrit = intersectStringFieldCriteria(criteria, "student_id", ownStudentIds);
      return studentCrit ? { ...tenantCriteria, student_id: studentCrit } : deny;
    }
    if (name === "Parent") {
      // A parent sees the parent records behind their own children; a student sees
      // the parents of their own record. Both are "my household", so an account
      // holding both roles is answered with the union rather than whichever role
      // happened to be primary.
      const links = await database.collection("ParentStudent").find({
        tenant_id: req.user.tenant_id,
        student_id: { $in: ownStudentIds },
      }).toArray();
      const parentIds = [...new Set(links.map((l) => l.parent_id).filter(Boolean))];
      if (!parentIds.length) return deny;
      const orConditions = [];
      if (isParent) {
        const normEmail = normalizeEmail(req.user.email);
        orConditions.push({ user_id: req.user._id.toString() });
        if (normEmail) orConditions.push({ email: normEmail });
      }
      if (hasRole(req, APP_ROLES.STUDENT)) {
        // The student half is intersected with the request criteria rather than
        // returned whole, so a filtered read stays filtered.
        const idCrit = intersectIdCriteria(criteria, parentIds);
        if (idCrit) orConditions.push({ _id: idCrit });
      }
      if (!orConditions.length) return deny;
      return { ...tenantCriteria, $or: orConditions };
    }
    if (name === "Result") {
      const studentCrit = intersectStringFieldCriteria(criteria, "student_id", ownStudentIds);
      return studentCrit ? { ...tenantCriteria, student_id: studentCrit, status: "published" } : deny;
    }
    if (name === "OMRSheet") {
      const studentCrit = intersectStringFieldCriteria(criteria, "student_id", ownStudentIds);
      return studentCrit ? { ...tenantCriteria, student_id: studentCrit, status: { $in: ["evaluated", "processed"] } } : deny;
    }
    if (name === "Attendance") {
      const studentCrit = intersectStringFieldCriteria(criteria, "student_id", ownStudentIds);
      return studentCrit ? { ...tenantCriteria, student_id: studentCrit } : deny;
    }
    if (name === "AssignmentSubmission") {
      const studentCrit = intersectStringFieldCriteria(criteria, "student_id", ownStudentIds);
      return studentCrit ? { ...tenantCriteria, student_id: studentCrit } : deny;
    }
    if (name === "AcademicYear" || name === "Subject") {
      return tenantCriteria;
    }

    const [students, enrollments] = await Promise.all([
      database.collection("Student").find(
        { _id: { $in: ownObjectIds }, tenant_id: req.user.tenant_id },
        { projection: { school_class_id: 1, class_name: 1, section_id: 1 } }
      ).toArray(),
      database.collection("Enrollment").find(
        { student_id: { $in: ownStudentIds }, tenant_id: req.user.tenant_id },
        { projection: { school_class_id: 1, section_id: 1 } }
      ).toArray(),
    ]);
    let classIds = [...new Set([
      ...students.map((s) => s.school_class_id),
      ...enrollments.map((e) => e.school_class_id),
    ].filter(Boolean))];
    if (!classIds.length) {
      const classNames = students.map((s) => s.class_name).filter(Boolean);
      if (classNames.length) {
        const classes = await database.collection("SchoolClass").find(
          { tenant_id: req.user.tenant_id, name: { $in: classNames } },
          { projection: { _id: 1 } }
        ).toArray();
        classIds = classes.map((c) => c._id.toString());
      }
    }
    if (!classIds.length) return deny;

    if (name === "AnswerKey") {
      // Students/parents may view answer keys only for PUBLISHED exams in their
      // class, so results breakdown (correct vs wrong) renders correctly without
      // leaking keys for scheduled paper exams.
      const scopedExams = await database.collection("Examination").find(
        { tenant_id: req.user.tenant_id, school_class_ids: { $in: classIds }, status: "published" },
        { projection: { _id: 1 } }
      ).toArray();
      const examIds = scopedExams.map((x) => x._id.toString());
      const examCrit = intersectStringFieldCriteria(criteria, "examination_id", examIds);
      return examCrit ? { ...tenantCriteria, examination_id: examCrit } : deny;
    }
    if (name === "Examination") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_ids", classIds);
      return classCrit
        ? { ...tenantCriteria, school_class_ids: classCrit, status: { $in: ["published", "scheduled"] } }
        : deny;
    }
    if (name === "SchoolClass") {
      const idCrit = intersectIdCriteria(criteria, classIds);
      return idCrit ? { ...tenantCriteria, _id: idCrit } : deny;
    }
    if (name === "Section") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_id", classIds);
      return classCrit ? { ...tenantCriteria, school_class_id: classCrit } : deny;
    }
    if (name === "TeacherAssignment") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_id", classIds);
      return classCrit ? { ...tenantCriteria, school_class_id: classCrit } : deny;
    }
    if (name === "Assignment") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_id", classIds);
      return classCrit ? { ...tenantCriteria, school_class_id: classCrit, status: "published" } : deny;
    }
    return deny;
  }

  // Teacher scope: a teacher reads only their assigned classes. This is the
  // narrowing that must NOT catch a multi-role account — a teacher who is also
  // an exam coordinator is governed by the coordinator's tenant-wide reach, not
  // by the ceiling of the teaching job they also do. The test is the PRIMARY
  // role rather than "holds teacher", so the intent is local and does not depend
  // on the PRIVILEGED_TENANT_ROLES short-circuit above happening to catch every
  // wider role first.
  if (roleOf(req) === APP_ROLES.TEACHER) {
    const teacher = await database.collection("Teacher").findOne({
      tenant_id: req.user?.tenant_id,
      $or: [
        { user_id: req.user._id.toString() },
        { email: normalizeEmail(req.user.email) },
      ],
      status: "active",
    });
    if (name === "Teacher") {
      if (!teacher) return deny;
      const idCrit = intersectIdCriteria(criteria, [teacher._id.toString()]);
      return idCrit ? { ...tenantCriteria, _id: idCrit } : deny;
    }
    if (!teacher) return deny;

    const assignments = await teacherAssignmentsFor(database, req, teacher);

    if (!teacherAssignmentIsValid(teacher, req.user, assignments)) return deny;

    const classIds = teacherClassIds(teacher, assignments);

    if (!classIds.length) return deny;

    if (name === "SchoolClass") {
      const idCrit = intersectIdCriteria(criteria, classIds);
      return idCrit ? { ...tenantCriteria, _id: idCrit } : deny;
    }
    if (name === "Section") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_id", classIds);
      return classCrit ? { ...tenantCriteria, school_class_id: classCrit } : deny;
    }
    if (name === "TeacherAssignment") {
      return {
        ...tenantCriteria,
        $or: [
          { teacher_id: teacher._id.toString() },
          { school_class_id: { $in: classIds } },
        ],
      };
    }
    if (name === "Enrollment") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_id", classIds);
      return classCrit ? { ...tenantCriteria, school_class_id: classCrit } : deny;
    }
    if (name === "Student") {
      const enrollments = await database.collection("Enrollment").find(
        { tenant_id: req.user.tenant_id, school_class_id: { $in: classIds }, status: { $ne: "withdrawn" } },
        { projection: { student_id: 1 } }
      ).toArray();
      const enrolledStudentIds = enrollments.map((e) => e.student_id).filter(Boolean);
      const enrolledObjectIds = objectIdsOrNull(enrolledStudentIds) || [];
      const classNames = await teacherClassNames(database, req, teacher, classIds);
      const matchCriteria = [
        { school_class_id: { $in: classIds } },
        // Legacy rows that only ever got a class_name (see teacherClassNames).
        ...(classNames.length ? [{ class_name: { $in: classNames } }] : []),
        ...(enrolledObjectIds.length ? [{ _id: { $in: enrolledObjectIds } }] : []),
      ];
      return { ...tenantCriteria, $or: matchCriteria };
    }
    if (name === "AnswerKey") {
      const scopedExams = await database.collection("Examination").find(
        { tenant_id: req.user.tenant_id, school_class_ids: { $in: classIds } },
        { projection: { _id: 1 } }
      ).toArray();
      const examIds = scopedExams.map((x) => x._id.toString());
      const examCrit = intersectStringFieldCriteria(criteria, "examination_id", examIds);
      return examCrit ? { ...tenantCriteria, examination_id: examCrit } : deny;
    }
    if (name === "Examination") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_ids", classIds);
      return classCrit ? { ...tenantCriteria, school_class_ids: classCrit } : deny;
    }
    if (name === "Result" || name === "OMRSheet") {
      const classNames = await teacherClassNames(database, req, teacher, classIds);
      const studentQuery = { tenant_id: req.user.tenant_id, school_class_id: { $in: classIds } };
      // Keep the student set consistent with the Student branch: a legacy
      // class_name-only student must not appear in "My Students" and then have
      // their results and OMR silently scoped away.
      const studentDocs = await database.collection("Student").find(
        classNames.length ? { $or: [studentQuery, { class_name: { $in: classNames } }] } : studentQuery,
        { projection: { _id: 1 } }
      ).toArray();
      const enrollments = await database.collection("Enrollment").find(
        { tenant_id: req.user.tenant_id, school_class_id: { $in: classIds } },
        { projection: { student_id: 1 } }
      ).toArray();
      const studentIds = [...new Set([
        ...studentDocs.map((s) => s._id.toString()),
        ...enrollments.map((e) => e.student_id),
      ].filter(Boolean))];
      if (!studentIds.length) return deny;
      const studentCrit = intersectStringFieldCriteria(criteria, "student_id", studentIds);
      if (!studentCrit) return deny;
      // A teacher may read only signed-off marks. Draft results have not been
      // through coordinator review yet and can still change after OMR
      // correction, so they are withheld rather than shown as provisional.
      // OMRSheet is the raw scan and is only ever reached through an already
      // filtered result row, so it stays unfiltered.
      if (name === "Result") {
        return { ...tenantCriteria, student_id: studentCrit, status: { $in: TEACHER_VISIBLE_RESULT_STATUSES } };
      }
      return { ...tenantCriteria, student_id: studentCrit };
    }
    if (name === "Subject" || name === "AcademicYear") {
      return tenantCriteria;
    }
    if (name === "Attendance") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_id", classIds);
      return classCrit ? { ...tenantCriteria, school_class_id: classCrit } : deny;
    }
    if (name === "Assignment") {
      return {
        ...tenantCriteria,
        $or: [
          { teacher_id: teacher._id.toString() },
          { school_class_id: { $in: classIds } },
        ],
      };
    }
    if (name === "AssignmentSubmission") {
      const classCrit = intersectStringFieldCriteria(criteria, "school_class_id", classIds);
      return classCrit ? { ...tenantCriteria, school_class_id: classCrit } : deny;
    }
    return deny;
  }
  return deny;
};
const writeAllowed = (req, name, data = {}) => {
  if (superAdmin(req)) return true;
  // Tenant and TenantAnnouncement are writable by their own tenant only;
  // the SEC-01 role matrix (canWriteEntity) decides WHICH role may actually write.
  if (name === "Tenant" || name === "TenantAnnouncement") {
    return Boolean(req.user?.tenant_id) && (!data.tenant_id || data.tenant_id === req.user.tenant_id);
  }
  return (
    !globalOnly.has(name) &&
    !publicRead.has(name) &&
    Boolean(req.user?.tenant_id) &&
    (!data.tenant_id || data.tenant_id === req.user.tenant_id)
  );
};

// --- Teacher exam scope -------------------------------------------------------
// A teacher may act on an examination only inside their ASSIGNED class AND
// subject. Both the read predicate (readScope) and the write guard
// (assertRelationshipWrite) resolve scope through these helpers so a teacher can
// never be allowed to read something they are forbidden to write, or vice versa.
const findTeacherForUser = (database, req) =>
  database.collection("Teacher").findOne({
    tenant_id: req.user.tenant_id,
    $or: [
      { user_id: req.user._id.toString() },
      { email: normalizeEmail(req.user.email) },
    ],
    status: "active",
  });

// Classes a teacher owns: the denormalized ids on the profile UNION every live
// TeacherAssignment row. The union matters — a teacher assigned purely through an
// assignment row must not fail a write check they legitimately pass on reads.
const teacherClassIds = (teacher, assignments) => [...new Set([
  ...(Array.isArray(teacher.assigned_class_ids) ? teacher.assigned_class_ids : []),
  ...assignments.map((a) => a.school_class_id),
].filter(Boolean).map(String))];

const teacherAssignmentsFor = (database, req, teacher) =>
  database.collection("TeacherAssignment").find({
    tenant_id: req.user.tenant_id,
    teacher_id: teacher._id.toString(),
    status: { $ne: "inactive" },
  }).toArray();

// Class ids a teacher is allowed to read exam rosters for.
//
// Returns null when the caller is not held to TEACHER scope — that is, when the
// primary role is not teacher, so an account that also coordinates examinations
// gets the tenant-wide roster the wider role grants. Returns
// { isTeacher: true, classIds } when they are scoped — where classIds is
// deliberately empty for a teacher with no valid assignment, so callers deny
// rather than silently treating them as unrestricted. Shared by getExamRoster
// and previewExamRoster so both apply an identical boundary.
const teacherRosterScope = async (database, req) => {
  if (roleOf(req) !== APP_ROLES.TEACHER) return null;
  const teacher = await database.collection("Teacher").findOne({
    tenant_id: req.user.tenant_id,
    $or: [
      { user_id: req.user._id.toString() },
      { email: normalizeEmail(req.user.email) },
    ],
    status: "active",
  });
  if (!teacher) return { isTeacher: true, classIds: [] };
  const assignments = await teacherAssignmentsFor(database, req, teacher);
  if (!teacherAssignmentIsValid(teacher, req.user, assignments)) return { isTeacher: true, classIds: [] };
  return { isTeacher: true, classIds: teacherClassIds(teacher, assignments) };
};

// Class NAMES a teacher owns, resolved from their class ids and cross-checked
// against the real SchoolClass docs in the tenant.
//
// This exists purely as a safety net for legacy Student rows. school_class_id is
// resolved from class_name exactly once, at write time, with
// createIfMissing=false -- so a student imported before its SchoolClass existed
// keeps a class_name and no id, looks correct in the UI, and is invisible to
// every class-scoped query. Matching on the name too keeps such students visible
// to their teacher while the backfill (scripts/backfill-student-class-ids.mjs)
// repairs the underlying data.
//
// Names are only accepted when they match a real class in the tenant, so a
// teacher whose assigned_classes holds a subject name ("English") contributes
// nothing rather than matching arbitrary students.
const teacherClassNames = async (database, req, teacher, classIds) => {
  const names = new Set();
  if (classIds.length) {
    const docs = await database.collection("SchoolClass").find(
      { tenant_id: req.user.tenant_id, _id: { $in: objectIdsOrNull(classIds) || [] } },
      { projection: { name: 1 } }
    ).toArray();
    for (const doc of docs) {
      const name = typeof doc.name === "string" ? doc.name.trim() : "";
      if (name) names.add(name);
    }
  }
  const declared = Array.isArray(teacher.assigned_classes) ? teacher.assigned_classes : [];
  const wanted = declared.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim());
  if (wanted.length) {
    const real = await database.collection("SchoolClass").find(
      { tenant_id: req.user.tenant_id, name: { $in: wanted } },
      { projection: { name: 1 } }
    ).toArray();
    for (const doc of real) {
      const name = typeof doc.name === "string" ? doc.name.trim() : "";
      if (name) names.add(name);
    }
  }
  return [...names];
};

// Subject names on an examination, normalized across every shape the data has
// accumulated: ExamFormDialog writes `subjects` (array) plus a joined `subject`,
// seed/legacy rows carry only `subject`, and older API callers send `subject_name`.
// Checking all three is what stops a subject check being bypassed by simply
// omitting the field the caller happens to know about.
const examSubjectNames = (exam) => {
  const collect = (value) => (Array.isArray(value) ? value : [value]);
  const raw = [
    ...collect(exam?.subjects),
    ...collect(exam?.subject),
    ...collect(exam?.subject_name),
  ];
  return [...new Set(
    raw
      .filter((v) => typeof v === "string" && v.trim())
      .flatMap((v) => v.split(","))
      .map((s) => s.trim())
      .filter(Boolean)
  )];
};

// Subject NAMES a teacher owns. Teacher.subjects already stores names; the id
// columns are resolved to names here so all three sources are comparable.
const teacherSubjectNames = async (database, tenantId, teacher, assignments) => {
  const ids = new Set([
    ...(Array.isArray(teacher.assigned_subject_ids) ? teacher.assigned_subject_ids : []),
    ...assignments.map((a) => a.subject_id),
  ].filter(Boolean).map(String));
  const names = new Set(
    (Array.isArray(teacher.subjects) ? teacher.subjects : []).map((s) => String(s).trim()).filter(Boolean)
  );
  const oids = objectIdsOrNull([...ids]);
  if (oids && oids.length) {
    const subjects = await database.collection("Subject")
      .find({ _id: { $in: oids }, tenant_id: tenantId }, { projection: { name: 1 } })
      .toArray();
    subjects.forEach((s) => s.name && names.add(String(s.name).trim()));
  }
  return names;
};

const assertRelationshipWrite = async (req, name, data = {}, creating = false) => {
  const database = await db();
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return;

  if (name === "TenantAnnouncement") {
    // The audience of a tenant announcement is every tenant-side role; the
    // platform roles are not tenant members and cannot be a target.
    const ALLOWED_TARGET_ROLES = new Set([...EXAM_WORKFLOW_ROLES, ...FAMILY_ROLES, APP_ROLES.TEACHER]);
    const roles = data.target_roles;
    if (roles != null && !Array.isArray(roles)) {
      throw Object.assign(new Error("target_roles must be an array of roles"), { status: 400 });
    }
    if (Array.isArray(roles)) {
      for (const r of roles) {
        if (!ALLOWED_TARGET_ROLES.has(r)) {
          throw Object.assign(new Error(`Invalid target role: ${r}`), { status: 400 });
        }
      }
    }
  }

  if (name === "ParentStudent") {
    const parentId = data.parent_id;
    const studentId = data.student_id;
    if (creating && (!parentId || !studentId)) {
      throw Object.assign(new Error("parent_id and student_id are required"), { status: 400 });
    }
    if (parentId) {
      if (!ObjectId.isValid(parentId)) throw Object.assign(new Error("Invalid parent_id"), { status: 400 });
      const p = await database.collection("Parent").findOne({ _id: new ObjectId(parentId), tenant_id: tenantId });
      if (!p) throw Object.assign(new Error("Parent does not belong to this tenant"), { status: 400 });
    }
    if (studentId) {
      if (!ObjectId.isValid(studentId)) throw Object.assign(new Error("Invalid student_id"), { status: 400 });
      const s = await database.collection("Student").findOne({ _id: new ObjectId(studentId), tenant_id: tenantId });
      if (!s) throw Object.assign(new Error("Student does not belong to this tenant"), { status: 400 });
    }
  }

  if (name === "Enrollment") {
    const studentId = data.student_id;
    const academicYearId = data.academic_year_id;
    const classId = data.school_class_id;
    const sectionId = data.section_id;
    if (creating && (!studentId || !academicYearId || !classId)) {
      throw Object.assign(new Error("student_id, academic_year_id, and school_class_id are required"), { status: 400 });
    }
    if (studentId) {
      if (!ObjectId.isValid(studentId)) throw Object.assign(new Error("Invalid student_id"), { status: 400 });
      const s = await database.collection("Student").findOne({ _id: new ObjectId(studentId), tenant_id: tenantId });
      if (!s) throw Object.assign(new Error("Student does not belong to this tenant"), { status: 400 });
    }
    if (academicYearId) {
      if (!ObjectId.isValid(academicYearId)) throw Object.assign(new Error("Invalid academic_year_id"), { status: 400 });
      const y = await database.collection("AcademicYear").findOne({ _id: new ObjectId(academicYearId), tenant_id: tenantId });
      if (!y) throw Object.assign(new Error("Academic year does not belong to this tenant"), { status: 400 });
    }
    if (classId) {
      if (!ObjectId.isValid(classId)) throw Object.assign(new Error("Invalid school_class_id"), { status: 400 });
      const c = await database.collection("SchoolClass").findOne({ _id: new ObjectId(classId), tenant_id: tenantId });
      if (!c) throw Object.assign(new Error("Class does not belong to this tenant"), { status: 400 });
    }
    if (sectionId) {
      if (!ObjectId.isValid(sectionId)) throw Object.assign(new Error("Invalid section_id"), { status: 400 });
      const sec = await database.collection("Section").findOne({ _id: new ObjectId(sectionId), tenant_id: tenantId });
      if (!sec) throw Object.assign(new Error("Section does not belong to this tenant"), { status: 400 });
      if (classId && String(sec.school_class_id) !== String(classId)) {
        throw Object.assign(new Error("Section does not belong to the specified class"), { status: 400 });
      }
    }
  }

  if (name === "Examination") {
    const classIds = Array.isArray(data.school_class_ids) ? data.school_class_ids.filter(Boolean) : [];
    const yearId = data.academic_year_id || null;
    const sectionIds = Array.isArray(data.section_ids) ? data.section_ids.filter(Boolean) : [];

    if (creating && classIds.length === 0) {
      throw Object.assign(new Error("Examination must target at least one class (school_class_ids)"), { status: 400 });
    }
    if (yearId) {
      if (!ObjectId.isValid(yearId)) throw Object.assign(new Error("Invalid academic_year_id"), { status: 400 });
      const y = await database.collection("AcademicYear").findOne({ _id: new ObjectId(yearId), tenant_id: tenantId });
      if (!y) throw Object.assign(new Error("Academic year does not belong to this tenant"), { status: 400 });
    }
    for (const classId of classIds) {
      if (!ObjectId.isValid(classId)) throw Object.assign(new Error("Invalid school_class_id"), { status: 400 });
      const c = await database.collection("SchoolClass").findOne({ _id: new ObjectId(classId), tenant_id: tenantId });
      if (!c) throw Object.assign(new Error("Class does not belong to this tenant"), { status: 400 });
    }
    for (const sectionId of sectionIds) {
      if (!ObjectId.isValid(sectionId)) throw Object.assign(new Error("Invalid section_id"), { status: 400 });
      const sec = await database.collection("Section").findOne({ _id: new ObjectId(sectionId), tenant_id: tenantId });
      if (!sec) throw Object.assign(new Error("Section does not belong to this tenant"), { status: 400 });
      if (classIds.length > 0 && !classIds.map(String).includes(String(sec.school_class_id))) {
        throw Object.assign(new Error("Section does not belong to any class selected for this examination"), { status: 400 });
      }
    }
  }

  if (name === "OMRSheet") {
    // Closing the generic-write bypass: a student_id may only ever be assigned
    // to a sheet if that student is on the examination's authoritative roster.
    const studentId = data.student_id;
    if (!studentId) return;

    if (!ObjectId.isValid(studentId)) throw Object.assign(new Error("Invalid student_id"), { status: 400 });
    const student = await database.collection("Student").findOne({ _id: new ObjectId(studentId), tenant_id: tenantId });
    if (!student) throw Object.assign(new Error("Student does not belong to this tenant"), { status: 400 });

    let examinationId = data.examination_id;
    if (!examinationId && !creating) {
      const existingId = req.params?.id || data.id || data._id;
      if (existingId && ObjectId.isValid(existingId)) {
        const existing = await database.collection("OMRSheet").findOne(
          { _id: new ObjectId(existingId) },
          { projection: { examination_id: 1, tenant_id: 1 } }
        );
        if (existing) examinationId = existing.examination_id;
      }
    }
    if (!examinationId) {
      throw Object.assign(new Error("OMRSheet requires examination_id to assign a student"), { status: 400 });
    }
    if (!ObjectId.isValid(examinationId)) throw Object.assign(new Error("Invalid examination_id"), { status: 400 });

    const inRoster = await studentInExamRoster({
      tenantId,
      examinationId: String(examinationId),
      studentId: String(studentId),
    });
    if (!inRoster) {
      throw Object.assign(new Error("Student is not on this examination's roster"), { status: 400 });
    }
  }

  if (name === "TeacherAssignment") {
    const teacherId = data.teacher_id;
    const academicYearId = data.academic_year_id;
    const classId = data.school_class_id;
    const sectionId = data.section_id;
    const subjectId = data.subject_id;
    if (creating && (!teacherId || !academicYearId || !classId)) {
      throw Object.assign(new Error("teacher_id, academic_year_id, and school_class_id are required"), { status: 400 });
    }
    if (teacherId) {
      if (!ObjectId.isValid(teacherId)) throw Object.assign(new Error("Invalid teacher_id"), { status: 400 });
      const t = await database.collection("Teacher").findOne({ _id: new ObjectId(teacherId), tenant_id: tenantId });
      if (!t) throw Object.assign(new Error("Teacher does not belong to this tenant"), { status: 400 });
    }
    if (academicYearId) {
      if (!ObjectId.isValid(academicYearId)) throw Object.assign(new Error("Invalid academic_year_id"), { status: 400 });
      const y = await database.collection("AcademicYear").findOne({ _id: new ObjectId(academicYearId), tenant_id: tenantId });
      if (!y) throw Object.assign(new Error("Academic year does not belong to this tenant"), { status: 400 });
    }
    if (classId) {
      if (!ObjectId.isValid(classId)) throw Object.assign(new Error("Invalid school_class_id"), { status: 400 });
      const c = await database.collection("SchoolClass").findOne({ _id: new ObjectId(classId), tenant_id: tenantId });
      if (!c) throw Object.assign(new Error("Class does not belong to this tenant"), { status: 400 });
    }
    if (sectionId) {
      if (!ObjectId.isValid(sectionId)) throw Object.assign(new Error("Invalid section_id"), { status: 400 });
      const sec = await database.collection("Section").findOne({ _id: new ObjectId(sectionId), tenant_id: tenantId });
      if (!sec) throw Object.assign(new Error("Section does not belong to this tenant"), { status: 400 });
      if (classId && String(sec.school_class_id) !== String(classId)) {
        throw Object.assign(new Error("Section does not belong to the specified class"), { status: 400 });
      }
    }
    if (subjectId) {
      if (!ObjectId.isValid(subjectId)) throw Object.assign(new Error("Invalid subject_id"), { status: 400 });
      const s = await database.collection("Subject").findOne({ _id: new ObjectId(subjectId), tenant_id: tenantId });
      if (!s) throw Object.assign(new Error("Subject does not belong to this tenant"), { status: 400 });
    }
  }

  if (name === "Attendance") {
    const studentId = data.student_id;
    const classId = data.school_class_id;
    const sectionId = data.section_id;
    const academicYearId = data.academic_year_id;
    if (creating && (!studentId || !classId)) {
      throw Object.assign(new Error("student_id and school_class_id are required"), { status: 400 });
    }
    if (studentId) {
      if (!ObjectId.isValid(studentId)) throw Object.assign(new Error("Invalid student_id"), { status: 400 });
      const s = await database.collection("Student").findOne({ _id: new ObjectId(studentId), tenant_id: tenantId });
      if (!s) throw Object.assign(new Error("Student does not belong to this tenant"), { status: 400 });
    }
    if (classId) {
      if (!ObjectId.isValid(classId)) throw Object.assign(new Error("Invalid school_class_id"), { status: 400 });
      const c = await database.collection("SchoolClass").findOne({ _id: new ObjectId(classId), tenant_id: tenantId });
      if (!c) throw Object.assign(new Error("Class does not belong to this tenant"), { status: 400 });
    }
    if (sectionId) {
      if (!ObjectId.isValid(sectionId)) throw Object.assign(new Error("Invalid section_id"), { status: 400 });
      const sec = await database.collection("Section").findOne({ _id: new ObjectId(sectionId), tenant_id: tenantId });
      if (!sec) throw Object.assign(new Error("Section does not belong to this tenant"), { status: 400 });
      if (classId && String(sec.school_class_id) !== String(classId)) {
        throw Object.assign(new Error("Section does not belong to the specified class"), { status: 400 });
      }
    }
    if (academicYearId) {
      if (!ObjectId.isValid(academicYearId)) throw Object.assign(new Error("Invalid academic_year_id"), { status: 400 });
      const y = await database.collection("AcademicYear").findOne({ _id: new ObjectId(academicYearId), tenant_id: tenantId });
      if (!y) throw Object.assign(new Error("Academic year does not belong to this tenant"), { status: 400 });
    }
    if (roleOf(req) === APP_ROLES.TEACHER) {
      const teacher = await database.collection("Teacher").findOne({
        tenant_id: tenantId,
        $or: [
          { user_id: req.user._id.toString() },
          { email: normalizeEmail(req.user.email) },
        ],
        status: "active",
      });
      const assignments = teacher ? await database.collection("TeacherAssignment").find({
        tenant_id: tenantId,
        teacher_id: teacher._id.toString(),
        status: { $ne: "inactive" },
      }).toArray() : [];
      if (!teacherAssignmentIsValid(teacher, req.user, assignments)) {
        throw Object.assign(new Error("Teacher assignment is required"), { status: 403 });
      }
      const allowedClassIds = [...new Set([
        ...(Array.isArray(teacher.assigned_class_ids) ? teacher.assigned_class_ids : []),
        ...assignments.map((a) => a.school_class_id),
      ].filter(Boolean))];
      if (classId && !allowedClassIds.includes(String(classId))) {
        throw Object.assign(new Error("Teacher cannot mark attendance for an unassigned class"), { status: 403 });
      }
      if (creating && !data.marked_by) {
        data.marked_by = req.user.full_name || req.user.email;
      }
    }
  }

  if (name === "Assignment") {
    const classId = data.school_class_id;
    const sectionId = data.section_id;
    const subjectId = data.subject_id;
    const academicYearId = data.academic_year_id;
    if (creating && !classId) {
      throw Object.assign(new Error("school_class_id is required"), { status: 400 });
    }
    if (classId) {
      if (!ObjectId.isValid(classId)) throw Object.assign(new Error("Invalid school_class_id"), { status: 400 });
      const c = await database.collection("SchoolClass").findOne({ _id: new ObjectId(classId), tenant_id: tenantId });
      if (!c) throw Object.assign(new Error("Class does not belong to this tenant"), { status: 400 });
    }
    if (sectionId) {
      if (!ObjectId.isValid(sectionId)) throw Object.assign(new Error("Invalid section_id"), { status: 400 });
      const sec = await database.collection("Section").findOne({ _id: new ObjectId(sectionId), tenant_id: tenantId });
      if (!sec) throw Object.assign(new Error("Section does not belong to this tenant"), { status: 400 });
      if (classId && String(sec.school_class_id) !== String(classId)) {
        throw Object.assign(new Error("Section does not belong to the specified class"), { status: 400 });
      }
    }
    if (subjectId) {
      if (!ObjectId.isValid(subjectId)) throw Object.assign(new Error("Invalid subject_id"), { status: 400 });
      const s = await database.collection("Subject").findOne({ _id: new ObjectId(subjectId), tenant_id: tenantId });
      if (!s) throw Object.assign(new Error("Subject does not belong to this tenant"), { status: 400 });
    }
    if (academicYearId) {
      if (!ObjectId.isValid(academicYearId)) throw Object.assign(new Error("Invalid academic_year_id"), { status: 400 });
      const y = await database.collection("AcademicYear").findOne({ _id: new ObjectId(academicYearId), tenant_id: tenantId });
      if (!y) throw Object.assign(new Error("Academic year does not belong to this tenant"), { status: 400 });
    }
    if (roleOf(req) === APP_ROLES.TEACHER) {
      const teacher = await database.collection("Teacher").findOne({
        tenant_id: tenantId,
        $or: [
          { user_id: req.user._id.toString() },
          { email: normalizeEmail(req.user.email) },
        ],
        status: "active",
      });
      const assignments = teacher ? await database.collection("TeacherAssignment").find({
        tenant_id: tenantId,
        teacher_id: teacher._id.toString(),
        status: { $ne: "inactive" },
      }).toArray() : [];
      if (!teacherAssignmentIsValid(teacher, req.user, assignments)) {
        throw Object.assign(new Error("Teacher assignment is required"), { status: 403 });
      }
      const allowedClassIds = [...new Set([
        ...(Array.isArray(teacher.assigned_class_ids) ? teacher.assigned_class_ids : []),
        ...assignments.map((a) => a.school_class_id),
      ].filter(Boolean))];
      if (classId && !allowedClassIds.includes(String(classId))) {
        throw Object.assign(new Error("Teacher cannot manage assignments for an unassigned class"), { status: 403 });
      }
      if (creating && !data.teacher_id && teacher) {
        data.teacher_id = teacher._id.toString();
      }
    }
  }

  if (name === "AssignmentSubmission") {
    const assignmentId = data.assignment_id;
    const studentId = data.student_id;
    if (creating && (!assignmentId || !studentId)) {
      throw Object.assign(new Error("assignment_id and student_id are required"), { status: 400 });
    }
    let assignment = null;
    if (assignmentId) {
      if (!ObjectId.isValid(assignmentId)) throw Object.assign(new Error("Invalid assignment_id"), { status: 400 });
      assignment = await database.collection("Assignment").findOne({ _id: new ObjectId(assignmentId), tenant_id: tenantId });
      if (!assignment) throw Object.assign(new Error("Assignment does not belong to this tenant"), { status: 400 });
    }
    if (studentId) {
      if (!ObjectId.isValid(studentId)) throw Object.assign(new Error("Invalid student_id"), { status: 400 });
      const s = await database.collection("Student").findOne({ _id: new ObjectId(studentId), tenant_id: tenantId });
      if (!s) throw Object.assign(new Error("Student does not belong to this tenant"), { status: 400 });
    }
    if (hasRole(req, APP_ROLES.STUDENT)) {
      const ownStudentIds = studentIdsForUser(req.user);
      if (studentId && !ownStudentIds.includes(String(studentId))) {
        throw Object.assign(new Error("Student cannot submit assignment for another student"), { status: 403 });
      }
      if ("marks_obtained" in data || "teacher_feedback" in data) {
        delete data.marks_obtained;
        delete data.teacher_feedback;
      }
    }
    if (roleOf(req) === APP_ROLES.TEACHER) {
      const teacher = await database.collection("Teacher").findOne({
        tenant_id: tenantId,
        $or: [
          { user_id: req.user._id.toString() },
          { email: normalizeEmail(req.user.email) },
        ],
        status: "active",
      });
      const assignments = teacher ? await database.collection("TeacherAssignment").find({
        tenant_id: tenantId,
        teacher_id: teacher._id.toString(),
        status: { $ne: "inactive" },
      }).toArray() : [];
      if (!teacherAssignmentIsValid(teacher, req.user, assignments)) {
        throw Object.assign(new Error("Teacher assignment is required"), { status: 403 });
      }
      const allowedClassIds = [...new Set([
        ...(Array.isArray(teacher.assigned_class_ids) ? teacher.assigned_class_ids : []),
        ...assignments.map((a) => a.school_class_id),
      ].filter(Boolean))];
      const classId = data.school_class_id || assignment?.school_class_id;
      if (classId && !allowedClassIds.includes(String(classId))) {
        throw Object.assign(new Error("Teacher cannot grade submissions for an unassigned class"), { status: 403 });
      }
    }
  }

  // --- Examination (teacher) --------------------------------------------------
  if (roleOf(req) === APP_ROLES.TEACHER && name === "Examination") {
    const teacher = await findTeacherForUser(database, req);
    if (!teacherAssignmentIsValid(teacher, req.user)) {
      throw Object.assign(new Error("Teacher assignment is required"), { status: 403 });
    }
    const assignments = await teacherAssignmentsFor(database, req, teacher);
    const allowedClassIds = teacherClassIds(teacher, assignments);

    // A teacher may only create or move an examination inside every assigned
    // class. Subject scope is deliberately NOT enforced here: teachers own exam
    // and subject authoring through the exam dialog, and the answer key -- the
    // artifact that actually leaks questions -- is scope-checked below.
    const ids = (Array.isArray(data.school_class_ids) ? data.school_class_ids : []).map(String);
    if ("school_class_ids" in data || creating) {
      if (!ids.length || ids.some((id) => !allowedClassIds.includes(id))) {
        throw Object.assign(new Error("Examination is outside assigned classes"), { status: 403 });
      }
    }

    // Teachers legitimately set status only at create time, and only `draft`:
    // evaluation and publication are owned by the exam workflow. Without this a
    // teacher could POST an already-`published` examination and skip sign-off,
    // and could not un-freeze a locked answer key by moving status backwards.
    if (creating) {
      if (data.status && data.status !== "draft") {
        throw Object.assign(new Error("Teachers can only create examinations as drafts"), { status: 403 });
      }
    } else if ("status" in data) {
      throw Object.assign(new Error("Teachers cannot change examination status"), { status: 403 });
    }
  }

  // --- AnswerKey --------------------------------------------------------------
  // An answer key is a child of an Examination, so it inherits two invariants:
  //   1. FREEZE — once the parent exam is evaluated/reviewed/published the key is
  //      authoritative for already-computed Result documents and may not change.
  //   2. SCOPE  — a teacher may only key exams inside their assigned class+subject.
  // Both apply regardless of role, so this block must run before the teacher-only
  // guards above return.
  if (name === "AnswerKey") {
    // On update the body carries only { answers }, so fall back to the target
    // document to learn which examination this key belongs to.
    let examId = data.examination_id || null;
    if (!examId && !creating && ObjectId.isValid(req.params?.id)) {
      const existing = await database.collection("AnswerKey").findOne(
        { _id: new ObjectId(req.params.id), tenant_id: tenantId },
        { projection: { examination_id: 1 } }
      );
      examId = existing?.examination_id || null;
    }
    if (!examId || !ObjectId.isValid(String(examId))) {
      throw Object.assign(new Error("examination_id is required"), { status: 400 });
    }

    const exam = await database.collection("Examination").findOne(
      { _id: new ObjectId(String(examId)), tenant_id: tenantId },
      { projection: { school_class_ids: 1, subjects: 1, subject: 1, subject_name: 1, status: 1 } }
    );
    if (!exam) {
      throw Object.assign(new Error("Answer key is outside this tenant"), { status: 400 });
    }

    if (FROZEN_EXAM_STATUSES.has(exam.status)) {
      throw Object.assign(
        new Error("Answer key is locked: this examination has already been evaluated"),
        { status: 409 }
      );
    }

    // The panel resolves a key with filter(...) then takes the first hit, and
    // evaluation resolves it with findOne. A second key for the same paper set
    // would be picked arbitrarily, so reject the duplicate up front.
    if (creating) {
      const duplicate = await database.collection("AnswerKey").findOne(
        { tenant_id: tenantId, examination_id: String(examId), paper_set: data.paper_set ?? null },
        { projection: { _id: 1 } }
      );
      if (duplicate) {
        throw Object.assign(new Error("An answer key already exists for this paper set"), { status: 409 });
      }
    }

    if (roleOf(req) === APP_ROLES.TEACHER) {
      const teacher = await findTeacherForUser(database, req);
      if (!teacherAssignmentIsValid(teacher, req.user)) {
        throw Object.assign(new Error("Teacher assignment is required"), { status: 403 });
      }
      const assignments = await teacherAssignmentsFor(database, req, teacher);
      const allowedClassIds = teacherClassIds(teacher, assignments);
      const examClassIds = (Array.isArray(exam.school_class_ids) ? exam.school_class_ids : []).map(String);
      if (!examClassIds.length || examClassIds.some((id) => !allowedClassIds.includes(id))) {
        throw Object.assign(new Error("Answer key is outside assigned classes"), { status: 403 });
      }

      const allowedSubjects = await teacherSubjectNames(database, tenantId, teacher, assignments);
      const subjects = examSubjectNames(exam);
      if (!subjects.length || subjects.some((s) => !allowedSubjects.has(s))) {
        throw Object.assign(new Error("Answer key is outside assigned subjects"), { status: 403 });
      }
    }
  }
};

// Authentication Routes
app.post(
  "/api/auth/register",
  route(async (req, res) => {
    const { email, password, full_name, role, app_role, school_name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    // SEC-05: per-IP registration throttle before any DB or bcrypt work.
    const ip = getClientIp(req);
    const reg = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.register.scope, key: ip, windowMs: RATE_LIMITS.register.windowMs })
    );
    if (reg.count > RATE_LIMITS.register.limit) return tooMany(res, reg.resetAt);

    const database = await db();
    const existing = await database.collection("User").findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "Email already in use" });
    }

    // SEC-06: public registration NEVER grants platform roles. The env-driven
    // ADMIN_EMAIL / ADMIN_PASSWORD bootstrapAdmin() is the authoritative and
    // only way a super_admin account is created; the earlier countUsers===0
    // first-registrant promotion has been removed.
    const assignedAppRole = "school_admin";
    const assignedRole = "user";

    const password_hash = await hashPassword(password);
    const now = new Date().toISOString();

    let tenantId = null;
    if (assignedAppRole === "school_admin") {
      const defaultTenant = {
        name: school_name?.trim() || `${full_name || normalizedEmail.split("@")[0]}'s Institution`,
        // The subdomain is a public tenant identifier resolved by publicSite/
        // branding, so it is validated and made unique rather than slugged
        // blindly. The previous inline slug could produce an empty string (e.g.
        // school_name "!!!") and could collide with a real institution, which let
        // a registrant shadow a school's portal.
        subdomain: normalizeSubdomain(school_name || normalizedEmail.split("@")[0]),
        status: "active",
        white_label_enabled: true,
        created_date: now,
        updated_date: now,
      };
      assertSubdomainUsable(defaultTenant.subdomain);
      await assertSubdomainAvailable(database.collection("Tenant"), defaultTenant.subdomain);
      const tenantResult = await database.collection("Tenant").insertOne(defaultTenant);
      tenantId = tenantResult.insertedId.toString();
    }

    const user = {
      email: normalizedEmail,
      full_name: full_name?.trim() || normalizedEmail.split("@")[0],
      password_hash,
      role: assignedRole,
      // Canonical set plus the primary-role mirror. Registration only ever mints a
      // school_admin today, but writing the pair here means the invariant holds
      // from the very first account rather than from whenever the array arrives.
      app_role: assignedAppRole,
      app_roles: [assignedAppRole],
      // Self-service registration is the one creation path where the address is
      // unproven, so the account starts unverified and a token is issued below.
      // The tenant is created active on purpose: activation is this account
      // state, not a second flag on the tenant. A `status: "pending"` tenant
      // would be a second source of truth that branding lookup, plan entitlement
      // and the login flow would each have to learn to interpret, and any of
      // them getting it wrong re-opens the gap this gate exists to close.
      email_verified: false,
      ...(tenantId && { tenant_id: tenantId }),
      created_date: now,
      updated_date: now,
    };
    const result = await database.collection("User").insertOne(user);
    const created = { ...user, _id: result.insertedId };

    // Best-effort: a mail failure must not discard a registration the user
    // believes succeeded. They can request a resend from the verify screen.
    let issued = { delivered: false, email_configured: false };
    try {
      issued = await issueEmailVerification(created);
    } catch (error) {
      console.warn("[verify-email] could not issue a token at registration:", error.message);
    }

    // Server-derived actor: the document just written, not the request body, so
    // the audit trail records who the account actually is.
    await logServerAudit(req, {
      action: "register",
      entity_type: "User",
      entity_id: result.insertedId.toString(),
      details: `self-service registration for ${normalizedEmail}`,
      actor: { ...created, tenant_id: tenantId || "" },
    });

    res.json({
      token: createToken(result.insertedId.toString()),
      user: out(safeUser(created)),
      // The client routes to the verify screen on this flag rather than
      // inferring it from a 403 later.
      email_verified: false,
      verification_required: true,
      verification_delivered: issued.delivered,
      verification_email_configured: issued.email_configured,
      ...(issued.dev_verification_token ? { dev_verification_token: issued.dev_verification_token } : {}),
    });
  })
);

app.post(
  "/api/auth/login",
  route(async (req, res) => {
    const { email, identifier: rawId, password, tenant_id, school } = req.body || {};
    const inputIdentifier = String(rawId || email || "").trim();
    if (!inputIdentifier || !password) {
      return res.status(400).json({ error: "Email or identifier and password are required" });
    }
    const isEmail = inputIdentifier.includes("@");
    const normalizedIdentifier = inputIdentifier.toLowerCase();
    const ip = getClientIp(req);

    const database = await db();

    // Resolve scoped institution (if client signed in through dedicated portal or query)
    let scopedTenant = null;
    if (tenant_id || (typeof school === "string" && school.trim())) {
      if (tenant_id) {
        scopedTenant = await database
          .collection("Tenant")
          .findOne({ _id: new ObjectId(String(tenant_id)) })
          .catch(() => null);
      } else {
        // Tolerant institution match: trim surrounding whitespace and match
        // case-insensitively on subdomain/custom_domain, and on the display name
        // (which may carry leading/trailing whitespace from onboarding forms).
        const s = school.trim();
        const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        scopedTenant = await database.collection("Tenant").findOne({
          $or: [
            { subdomain: { $regex: new RegExp(`^${escaped}$`, "i") } },
            { custom_domain: { $regex: new RegExp(`^${escaped}$`, "i") } },
            { name: { $regex: new RegExp(`^\\s*${escaped}\\s*$`, "i") } },
          ],
        });
      }
      if (!scopedTenant) {
        return res.status(403).json({ error: "Institution not found" });
      }
    }

    // Rate-limiting failure key (account, IP) composite
    const acctPrefix = scopedTenant ? `${scopedTenant._id.toString()}:` : "";
    const acctKey = `${acctPrefix}${normalizedIdentifier}|${ip}`;

    // SEC-05: lockout + failed-attempt counters gate the request BEFORE any
    // bcrypt work. The failure key is the (account, IP) composite so one hostile
    // IP cannot permanently lock a shared account; the per-IP aggregate bounds
    // distributed password spraying regardless of account.
    const lockRemaining = await rateStore.remainingLock({ scope: RATE_LIMITS.loginLockout.scope, key: acctKey });
    if (lockRemaining > 0) return tooMany(res, Date.now() + lockRemaining);
    const failed = await runLimit(() =>
      rateStore.get({ scope: RATE_LIMITS.loginFail.scope, key: acctKey, windowMs: RATE_LIMITS.loginFail.windowMs })
    );
    const ipFailed = await runLimit(() =>
      rateStore.get({ scope: RATE_LIMITS.loginIpFail.scope, key: ip, windowMs: RATE_LIMITS.loginIpFail.windowMs })
    );
    if (failed.count >= RATE_LIMITS.loginFail.limit || ipFailed.count >= RATE_LIMITS.loginIpFail.limit) {
      return tooMany(res, Math.max(failed.resetAt, ipFailed.resetAt));
    }

    let user = null;

    if (!isEmail) {
      // Non-email identifier (Roll Number or Admission ID)
      if (!scopedTenant) {
        return res.status(400).json({
          error: "To sign in with a Roll Number or Student ID, please use your school's dedicated portal URL.",
        });
      }

      const escapedId = inputIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tenantIdStr = scopedTenant._id.toString();

      // Look up student by roll_number or admission_number in this tenant
      const student = await database.collection("Student").findOne({
        tenant_id: tenantIdStr,
        $or: [
          { roll_number: inputIdentifier },
          { admission_number: inputIdentifier },
          { roll_number: { $regex: new RegExp(`^${escapedId}$`, "i") } },
          { admission_number: { $regex: new RegExp(`^${escapedId}$`, "i") } },
        ],
      });

      if (student) {
        const studentIdStr = student._id.toString();
        const userOrConditions = [
          { linked_student_id: studentIdStr },
          { linked_student_id: student._id },
          { linked_student_ids: studentIdStr },
        ];
        if (student.student_email) userOrConditions.push({ email: student.student_email.toLowerCase().trim() });
        if (student.email) userOrConditions.push({ email: student.email.toLowerCase().trim() });

        user = await database.collection("User").findOne({
          tenant_id: tenantIdStr,
          $or: userOrConditions,
        });
      }
    } else {
      user = await database.collection("User").findOne({ email: normalizedIdentifier });
    }

    if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      const failResult = await runLimit(() =>
        rateStore.incr({ scope: RATE_LIMITS.loginFail.scope, key: acctKey, windowMs: RATE_LIMITS.loginFail.windowMs })
      );
      await runLimit(() =>
        rateStore.incr({ scope: RATE_LIMITS.loginIpFail.scope, key: ip, windowMs: RATE_LIMITS.loginIpFail.windowMs })
      );
      if (failResult.count >= RATE_LIMITS.loginFail.limit) {
        await rateStore.setLock({ scope: RATE_LIMITS.loginLockout.scope, key: acctKey, ttlMs: RATE_LIMITS.loginLockout.ttlMs });
      }
      return res.status(401).json({ error: isEmail ? "Invalid email or password" : "Invalid roll number/ID or password" });
    }

    // Success resets the account+IP failure counter and any lockout. The per-IP
    // aggregate is intentionally kept for cross-account spray protection.
    await runLimit(() => rateStore.del({ scope: RATE_LIMITS.loginFail.scope, key: acctKey }));
    await runLimit(() => rateStore.del({ scope: RATE_LIMITS.loginLockout.scope, key: acctKey }));

    // Institute-scoped login (strict): when the client signed in through an
    // institution, the account must belong to that tenant. Platform roles are
    // exempt. The canonical tenant is always resolved from the user's own
    // tenant_id, never from client input.
    if (scopedTenant && !PLATFORM_ROLES.has(user.app_role) && user.tenant_id !== scopedTenant._id.toString()) {
      return res.status(403).json({ error: `This account is not registered with ${scopedTenant.name}` });
    }

    let tenant = scopedTenant;
    if (!tenant && user.tenant_id) {
      tenant = await database.collection("Tenant").findOne({ _id: new ObjectId(user.tenant_id) }).catch(() => null);
    }
    res.json({
      token: createToken(user._id.toString()),
      user: out(safeUser(user)),
      // Login still succeeds for an unverified account — refusing here would make
      // the verify screen unreachable and would break "log in, discover you must
      // verify". The global gate is what withholds access, and it lets
      // /api/auth/login, /api/auth/me and the verification endpoints through so
      // the client can observe and resolve the state.
      email_verified: isEmailVerified(user),
      ...(tenant && {
        tenant: {
          id: tenant._id.toString(),
          name: tenant.name,
          subdomain: tenant.subdomain,
          custom_domain: tenant.custom_domain,
        },
      }),
    });
  })
);

app.post(
  "/api/auth/reset-password-request",
  route(async (req, res) => {
    const email = req.body?.email?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "Email is required" });
    // SEC-05: per-email + per-IP throttles BEFORE the lookup and for existing and
    // nonexistent emails alike, so the reset flow stays uniform (no side-channel
    // to distinguish accounts) while inbox flooding is bounded.
    const ip = getClientIp(req);
    const byEmail = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.resetRequestEmail.scope, key: email, windowMs: RATE_LIMITS.resetRequestEmail.windowMs })
    );
    const byIp = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.resetRequestIp.scope, key: ip, windowMs: RATE_LIMITS.resetRequestIp.windowMs })
    );
    if (byEmail.count > RATE_LIMITS.resetRequestEmail.limit || byIp.count > RATE_LIMITS.resetRequestIp.limit) {
      return tooMany(res, Math.max(byEmail.resetAt, byIp.resetAt));
    }
    const database = await db();
    const user = await database.collection("User").findOne({ email });
    if (user) {
      const resetToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString();
      await database
        .collection("User")
        .updateOne(
          { _id: user._id },
          { $set: { reset_password_token: hashedToken, reset_password_expires_at: expiresAt, updated_date: new Date().toISOString() } }
        );
    }
    return res.json({ message: "If an account exists with that email, password reset instructions have been generated." });
  })
);

app.post(
  "/api/auth/reset-password",
  route(async (req, res) => {
    const { resetToken, newPassword } = req.body || {};
    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: "Reset token and new password are required" });
    }
    // SEC-05: per-IP reset-execution throttle bounds token-guessing floods and
    // the bcrypt cost of this endpoint. Token single-use/expiry is untouched.
    const ip = getClientIp(req);
    const done = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.resetPasswordIp.scope, key: ip, windowMs: RATE_LIMITS.resetPasswordIp.windowMs })
    );
    if (done.count > RATE_LIMITS.resetPasswordIp.limit) return tooMany(res, done.resetAt);
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    const database = await db();
    const user = await database.collection("User").findOne({
      reset_password_token: hashedToken,
      reset_password_expires_at: { $gt: new Date().toISOString() },
    });
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }
    const password_hash = await hashPassword(newPassword);
    await database.collection("User").updateOne(
      { _id: user._id },
      {
        $set: { password_hash, updated_date: new Date().toISOString() },
        $unset: {
          reset_password_token: "",
          reset_password_expires_at: "",
          ...(user.must_change_password ? { must_change_password: "" } : {}),
        },
      }
    );
    res.json({ success: true });
  })
);

// --- Email verification ---------------------------------------------------------
//
// The account is created unverified at self-service registration and can do
// nothing until the address is proven. Proving it is the ONLY thing the
// verification token is allowed to do: it flips email_verified false -> true and
// touches nothing else. It cannot change the email, the tenant, the role or any
// other field, and it is single-use and time-limited. This is enforced by
// construction below — the handler builds its own $set from constant keys and
// never spreads the request body — rather than by validating a whitelist of
// fields, so a future field added to the body has nowhere to land.

// Unauthenticated: the recipient is following a link in an email, possibly in a
// browser that never held a session. A token is the credential.
app.post(
  "/api/auth/verify-email",
  route(async (req, res) => {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Verification token is required" });
    }
    const ip = getClientIp(req);
    const done = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.verifyEmailIp.scope, key: ip, windowMs: RATE_LIMITS.verifyEmailIp.windowMs })
    );
    if (done.count > RATE_LIMITS.verifyEmailIp.limit) return tooMany(res, done.resetAt);

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const database = await db();
    // Single query: the token must match AND be unexpired. `email_verified:false`
    // in the same predicate is what makes this idempotent-safe and prevents a
    // replayed link from doing anything on an already-verified account.
    const user = await database.collection("User").findOne({
      email_verification_token: hashedToken,
      email_verification_expires_at: { $gt: new Date().toISOString() },
      email_verified: false,
    });
    if (!user) {
      // Used, expired, already verified and nonexistent are deliberately
      // indistinguishable, matching the reset-token behaviour, so this endpoint
      // cannot be used to probe which addresses have accounts.
      return res.status(400).json({ error: "Invalid or expired verification link" });
    }
    // Constant keys only. No request-derived value enters this update.
    await database.collection("User").updateOne(
      { _id: user._id },
      {
        $set: { email_verified: true, updated_date: new Date().toISOString() },
        // The token is destroyed on use, so a leaked inbox copy cannot be replayed.
        $unset: { email_verification_token: "", email_verification_expires_at: "" },
      }
    );
    // Audited after the write so the event records the account that actually
    // exists. Actor comes from the matched document, not from req.body.
    await logServerAudit(req, {
      action: "verify_email",
      entity_type: "User",
      entity_id: user._id.toString(),
      details: `email verified for ${user.email}`,
      actor: { tenant_id: user.tenant_id || "", full_name: user.full_name, email: user.email, app_role: user.app_role },
    });
    res.json({ success: true, email: user.email });
  })
);

// Authenticated resend. Requires a session so it cannot be used to mail an
// arbitrary address, and is rate limited per user and per IP because it is the
// inbox-flooding vector. Requires no password: the point is to help a user who
// cannot get in, and possession of the session already proves the account is
// theirs to a useful degree — a full inbox is the failure mode being prevented.
app.post(
  "/api/auth/resend-verification",
  auth,
  route(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    const ip = getClientIp(req);
    const byUser = await runLimit(() =>
      rateStore.incr({
        scope: RATE_LIMITS.verifyEmailResend.scope,
        key: req.user._id.toString(),
        windowMs: RATE_LIMITS.verifyEmailResend.windowMs,
      })
    );
    const byIp = await runLimit(() =>
      rateStore.incr({
        scope: RATE_LIMITS.verifyEmailResendIp.scope,
        key: ip,
        windowMs: RATE_LIMITS.verifyEmailResendIp.windowMs,
      })
    );
    if (byUser.count > RATE_LIMITS.verifyEmailResend.limit || byIp.count > RATE_LIMITS.verifyEmailResendIp.limit) {
      return tooMany(res, Math.max(byUser.resetAt, byIp.resetAt));
    }
    if (isEmailVerified(req.user)) {
      return res.json({ success: true, already_verified: true, email: req.user.email });
    }
    const issued = await issueEmailVerification(req.user);
    await logServerAudit(req, {
      action: "resend_verification",
      entity_type: "User",
      entity_id: req.user._id.toString(),
      details: `verification email reissued for ${req.user.email}`,
    });
    res.json({
      success: true,
      email: req.user.email,
      // Surfaced so the UI can say "we emailed you" honestly when SMTP is
      // missing, rather than implying a message was sent.
      delivered: issued.delivered,
      email_configured: issued.email_configured,
      ...(issued.dev_verification_token ? { dev_verification_token: issued.dev_verification_token } : {}),
    });
  })
);

// Authenticated password change. Used for the first-login flow (a student/parent
// flagged `must_change_password` must call this before using the portal) and for
// any logged-in user updating their own password. Current password is always
// verified; the new password must differ from it. The must-change flag is
// cleared on success so a reused default password can never gate future logins.
app.post(
  "/api/auth/change-password",
  auth,
  route(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new passwords are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "New password must be different from the current password" });
    }
    // SEC-05: per-IP throttle bounds brute force against this endpoint.
    const ip = getClientIp(req);
    const done = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.changePassword.scope, key: ip, windowMs: RATE_LIMITS.changePassword.windowMs })
    );
    if (done.count > RATE_LIMITS.changePassword.limit) return tooMany(res, done.resetAt);

    const database = await db();
    const user = await database.collection("User").findOne(
      { _id: req.user._id },
      { projection: { password_hash: 1 } }
    );
    if (!user || !user.password_hash) {
      return res.status(400).json({ error: "This account has no recoverable password" });
    }
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const password_hash = await hashPassword(newPassword);
    await database.collection("User").updateOne(
      { _id: req.user._id },
      { $set: { password_hash, updated_date: new Date().toISOString() }, $unset: { must_change_password: "" } }
    );
    await logServerAudit(req, {
      action: "PASSWORD_CHANGED",
      entity_type: "User",
      entity_id: req.user._id.toString(),
      details: `password rotated${req.user.must_change_password ? " as mandatory first-login change" : ""}`,
    });
    res.json({ success: true });
  })
);

app.get(
  "/api/health",
  route(async (_req, res) => {
    await db();
    res.json({ ok: true, app: "examos", timestamp: new Date().toISOString() });
  })
);

// Scheduled domain monitoring (Phase 3). Vercel Cron (vercel.json `crons`)
// calls this path on a schedule; a manual trigger also exists as the
// `runDomainMonitor` super-admin function. Protected by CRON_SECRET — with no
// secret configured the endpoint refuses to run (503) so an unconfigured cron
// can never expose or spam the monitor.
app.get(
  "/api/cron/domain-monitor",
  route(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const provided = String((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!secret) {
      return res.status(503).json({ error: "Cron is not configured (CRON_SECRET unset)" });
    }
    if (!verifyCronToken(secret, provided)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const summary = await getDomainMonitor()({ force: req.query.force === "1" });
    res.json({ ok: true, ran_at: new Date().toISOString(), ...summary });
  })
);

// Scheduled affiliate subscription-renewal reminders.
//
// Protected by CRON_SECRET exactly like the domain monitor above, and refuses to run
// when it is unset rather than running unauthenticated: this route sends real messages
// to real customers, so an unconfigured cron must be inert, not open.
//
// The run is DAILY, not hourly. Reminders are keyed on whole UTC calendar days (see
// matchingLeadDays), so an hourly schedule would scan the same set of subscriptions
// twenty-four times to take the same action on one of them, and the delivery log's
// unique index would be doing all the deduplication work.
app.get(
  "/api/cron/affiliate-renewal-reminders",
  route(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const provided = String((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!secret) {
      return res.status(503).json({ error: "Cron is not configured (CRON_SECRET unset)" });
    }
    if (!verifyCronToken(secret, provided)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const database = await db();
    const nowIso = new Date().toISOString();
    // Bounded by the longest lead day any affiliate could have configured, so a
    // 365-day reminder horizon is scanned in one indexed range query rather than by
    // loading the collection.
    const horizonIso = new Date(Date.now() + (MAX_LEAD_DAY + 1) * 24 * 60 * 60 * 1000).toISOString();

    const due = await database
      .collection("Subscription")
      .find({
        status: "active",
        next_due_at: { $ne: null, $lte: horizonIso },
      })
      .limit(2000)
      .toArray();

    // Filtered on ObjectId validity, not just truthiness: affiliate_id is stored as a
    // string, and `new ObjectId("garbage")` throws — which would abort the whole run on
    // one damaged row and silently skip every remaining institution's reminder.
    const affiliateIds = [
      ...new Set(
        due
          .map((doc) => String(doc.affiliate_id || ""))
          .filter((id) => id && ObjectId.isValid(id))
      ),
    ];
    const affiliates = affiliateIds.length
      ? await database.collection("Affiliate").find({ _id: { $in: affiliateIds.map((id) => new ObjectId(id)) } }).toArray()
      : [];
    const affiliateById = new Map(affiliates.map((a) => [String(a._id), a]));

    const results = { scanned: due.length, sent: 0, failed: 0, skipped: 0 };

    // The delivery log's unique key includes lead_days, which is what lets the 7-day
    // and on-the-day reminders for one month both go out. It also means a MANUAL
    // reminder (recorded with lead_days 0) would NOT collide with an automatic one, so
    // an affiliate who clicked "Remind" this morning would still receive the automated
    // 7-day notice that evening — two of the same message, one period apart.
    //
    // One query up front closes that: any channel already used for a subscription's
    // current period blocks the automated send on that channel, whether it was a manual
    // send or an earlier automated one. Read in a single round trip because doing it
    // per subscription would be two thousand queries on a full run.
    const candidateKeys = due
      .map((doc) => {
        const key = periodKeyFor(doc.next_due_at);
        return key ? { subscription_id: String(doc._id), period_key: key } : null;
      })
      .filter(Boolean);
    const alreadyUsed = new Set();
    if (candidateKeys.length) {
      const priorSends = await database
        .collection("AffiliateReminderDelivery")
        .find({
          subscription_id: { $in: [...new Set(candidateKeys.map((k) => k.subscription_id))] },
          period_key: { $in: [...new Set(candidateKeys.map((k) => k.period_key))] },
        })
        .project({ subscription_id: 1, period_key: 1, channel: 1 })
        .toArray();
      for (const row of priorSends) {
        alreadyUsed.add(`${row.subscription_id}|${row.period_key}|${row.channel}`);
      }
    }

    for (const subscription of due) {
      const affiliate = affiliateById.get(String(subscription.affiliate_id));
      // No profile means no commission policy and no reminder wording. Skipped rather
      // than defaulted, because a guessed channel list would send a message nobody
      // configured.
      if (!affiliate) {
        results.skipped += 1;
        continue;
      }
      const settings = affiliateReminderSettings(affiliate);
      const leadDays = matchingLeadDays(subscription.next_due_at, settings.reminder_lead_days, nowIso);
      if (!leadDays.length) continue;
      if (!settings.reminder_channels.length) {
        results.skipped += 1;
        continue;
      }
      const periodKey = periodKeyFor(subscription.next_due_at);
      const subscriptionId = String(subscription._id);

      for (const leadDay of leadDays) {
        for (const channel of settings.reminder_channels) {
          if (alreadyUsed.has(`${subscriptionId}|${periodKey}|${channel}`)) {
            results.skipped += 1;
            continue;
          }
          try {
            const outcome = await sendAffiliateReminder({
              subscription,
              affiliate,
              channel,
              leadDays: leadDay,
              trigger: "auto",
            });
            if (outcome.skipped) results.skipped += 1;
            else if (outcome.ok) {
              // Marked locally as well as in the database, so a second lead day in the
              // same run (7 and 1 can coincide on a one-day cycle) cannot send twice.
              alreadyUsed.add(`${subscriptionId}|${periodKey}|${channel}`);
              results.sent += 1;
            } else results.failed += 1;
          } catch (err) {
            // One provider failure must not abandon the remaining subscriptions in the
            // run: every other institution with a due date today still needs its
            // reminder, and this run is the only thing that will send it.
            results.failed += 1;
            console.warn("[affiliate-reminders] send failed:", err?.message || err);
          }
        }
      }
    }

    return res.json({ ok: true, ran_at: nowIso, ...results });
  })
);

app.get(
  "/api/auth/me",
  auth,
  route(async (req, res) => {
    // Fail closed. An account whose roles normalize to nothing has no
    // entitlements, so it is reported as null rather than being promoted to a
    // default. Defaulting to school_admin here handed the full school-admin
    // sidebar and PAGE_ROLES.schoolAdmin routes to a role-less account while
    // the API layer denied every action — a guaranteed-broken admin UI. The
    // client treats null as "no access".
    //
    // `app_roles` is the canonical field and `app_role` its primary-role mirror;
    // both are returned so a client on either version of the shape works, and
    // the array is normalized on the way out so an unmigrated document does not
    // leak a stale or hand-edited value to the browser.
    const appRoleList = appRolesOf(req.user);
    const appRole = appRoleList[0] ?? null;
    if (!appRole) {
      return res.status(403).json({
        error: "This account has no assigned role. Contact your institution administrator.",
        code: "NO_ASSIGNED_ROLE",
        uid: req.user._id.toString(),
        email: req.user?.email,
        app_role: null,
        app_roles: [],
      });
    }
    res.json({
      ...(req.user ? out(safeUser(req.user)) : {}),
      uid: req.user?._id.toString(),
      email: req.user?.email,
      full_name: req.user?.full_name || req.user?.email,
      role: req.user?.role || "user",
      app_role: appRole,
      // Normalized, ordered, validated. Spreading safeUser() above would carry the
      // raw stored value, so this deliberately overwrites it.
      app_roles: appRoleList,
      // Normalized to a real boolean. safeUser already carries the raw field, but
      // a document predating the feature has none, and the client should not have
      // to distinguish "false" from "undefined" to decide which screen to show.
      // Matches the gate's own default: absence is verified.
      email_verified: isEmailVerified(req.user),
    });
  })
);

// File Upload (SEC-03: purpose-scoped, signature-validated, tenant-owned)
const uploadErrorHandler = (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File too large (50MB max)" : `Upload error: ${err.code}`;
    return res.status(400).json({ error: message });
  }
  next(err);
};

app.post(
  "/api/upload",
  auth,
  upload.single("file"),
  route(async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // An unrecognized purpose is a client bug, not a permission problem, and it
    // must not be silently rewritten: coercing purpose=logo (typo) to "omr" would
    // write the file into the wrong bucket and check it against the wrong roles.
    // An absent purpose still falls back to "omr" for older callers.
    if (req.body?.purpose !== undefined && !ALLOWED_UPLOADS[req.body.purpose]) {
      return res.status(400).json({ error: `Unknown upload purpose "${String(req.body.purpose).slice(0, 40)}"` });
    }
    const purpose = ALLOWED_UPLOADS[req.body?.purpose] ? req.body.purpose : "omr";
    if (!canUploadPurpose(req, purpose)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const originalExt = path.extname(file.originalname || "").toLowerCase();
    const typeSpec = ALLOWED_UPLOADS[purpose].find((s) => s.ext === originalExt);

    const reject = (message, status = 400) => res.status(status).json({ error: message });

    if (!typeSpec) {
      return reject(`File type ".${originalExt.replace(/^\./, "")}" is not allowed for ${purpose} uploads`);
    }
    if (file.size > UPLOAD_SIZE_CAP[purpose]) {
      return reject(`File exceeds the ${Math.round(UPLOAD_SIZE_CAP[purpose] / (1024 * 1024))}MB limit for ${purpose} uploads`);
    }

    const head = file.buffer.subarray(0, 16);
    if (!hasSignature(head, typeSpec.sig)) {
      return reject("File contents do not match its declared type");
    }
    if (typeSpec.sig === "csv" && !looksLikeCsvText(file.buffer.subarray(0, 512))) {
      return reject("CSV file contains binary or control data");
    }

    const storedName = `${crypto.randomUUID()}${typeSpec.ext}`;
    const contentType = SERVED_CONTENT_TYPES[typeSpec.ext] || "application/octet-stream";

    // Branding logos are intentionally public assets (login page, marketing
    // navbar/footer, portals) served by the narrow public route above.
    if (purpose === "logo") {
      if (s3.getStorage().mode === "s3") {
        await s3.putObject({ Key: s3.publicKey(storedName), Body: file.buffer, ContentType: contentType });
      } else {
        const dest = path.join(publicUploadsDir, storedName);
        fs.writeFileSync(dest, file.buffer);
      }
      return res.json({
        file_url: `/api/public/uploads/${storedName}`,
        filename: storedName,
        size: file.size,
        purpose,
      });
    }

    let tenantId = req.user?.tenant_id;
    if (req.viewAs) {
      // A scoped platform owner stores inside the school it is viewing. The body's
      // tenant_id is ignored rather than trusted, so an upload cannot land in
      // another school's storage prefix while the banner claims otherwise.
      tenantId = req.viewAs.tenant_id;
    } else if (!tenantId && platform(req)) {
      if (typeof req.body?.tenant_id === "string" && req.body.tenant_id.trim()) {
        tenantId = req.body.tenant_id.trim();
      } else {
        tenantId = "platform";
      }
    }
    if (!tenantId) {
      return reject("Tenant context required for this upload purpose");
    }

    if (s3.getStorage().mode === "s3") {
      await s3.putObject({
        Key: s3.privateKey(tenantId, storedName),
        Body: file.buffer,
        ContentType: contentType,
      });
    } else {
      const destDir = path.join(privateUploadsDir, tenantId);
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, storedName);
      fs.writeFileSync(dest, file.buffer);
    }
    res.json({
      file_url: `/api/files/${storedName}?token=${signFileToken(tenantId, storedName)}`,
      filename: storedName,
      size: file.size,
      purpose,
    });
  }),
  uploadErrorHandler
);

// Authenticated, tenant-verified file download (SEC-03). Private files are only
// reachable when the caller's tenant owns the file: the tenant segment of the
// storage path is derived from req.user, never from the client or the URL.
app.get(
  "/api/files/:filename",
  route(async (req, res) => {
    const { filename } = req.params;
    if (!STORED_FILE_RE.test(filename)) {
      return res.status(404).json({ error: "Not found" });
    }
    const ext = path.extname(filename).toLowerCase();

    let s3Key = null;
    let filePath = null;

    if (s3.getStorage().mode === "s3") {
      if (req.user) {
        if (platform(req)) {
          const found = (await s3.listKeys("private/", { limit: 2000 })).find((k) => k.endsWith(`/${filename}`));
          if (found) s3Key = found;
        } else {
          const candidate = s3.privateKey(req.user?.tenant_id || "__none__", filename);
          if (await s3.objectExists(candidate)) s3Key = candidate;
        }
      } else {
        // No bearer: require an unforgeable, still-valid signed capability token.
        // This is the only path that serves browser-rendered <img>/<a> requests.
        const ownerTenant = verifyFileToken(filename, req.query.token);
        if (!ownerTenant) return res.status(401).json({ error: "Authentication required" });
        const candidate = s3.privateKey(ownerTenant, filename);
        if (await s3.objectExists(candidate)) s3Key = candidate;
      }
    } else if (req.user) {
      if (platform(req)) {
        let tenants = [];
        try {
          tenants = fs.readdirSync(privateUploadsDir).filter((f) => /^[0-9a-f]{24}$/.test(f) || f === "platform");
        } catch {
          tenants = [];
        }
        for (const tenantId of tenants) {
          const candidate = path.join(privateUploadsDir, tenantId, filename);
          if (fs.existsSync(candidate)) {
            filePath = candidate;
            break;
          }
        }
      } else {
        const candidate = path.join(privateUploadsDir, req.user?.tenant_id || "__none__", filename);
        if (fs.existsSync(candidate)) filePath = candidate;
      }
    } else {
      // No bearer: require an unforgeable, still-valid signed capability token.
      // This is the only path that serves browser-rendered <img>/<a> requests.
      const ownerTenant = verifyFileToken(filename, req.query.token);
      if (!ownerTenant) return res.status(401).json({ error: "Authentication required" });
      const candidate = path.join(privateUploadsDir, ownerTenant, filename);
      if (fs.existsSync(candidate)) filePath = candidate;
    }

    if (!s3Key && !filePath) return res.status(404).json({ error: "Not found" });
    if (filePath) {
      try {
        filePath = safeResolveUnder(privateUploadsDir, path.relative(privateUploadsDir, filePath));
      } catch {
        return res.status(404).json({ error: "Not found" });
      }
    }

    res.setHeader("Content-Type", SERVED_CONTENT_TYPES[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");

    if (s3Key) {
      const obj = await s3.getObject(s3Key);
      const body = obj.Body;
      body.on("error", () => {
        if (!res.headersSent) res.status(404).json({ error: "Not found" });
      });
      return body.pipe(res);
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      if (!res.headersSent) res.status(404).json({ error: "Not found" });
    });
    stream.pipe(res);
  })
);

// Entity CRUD Endpoints
app.get(
  "/api/entities/:name",
  route(async (req, res) => {
    if (!req.user && !publicRead.has(req.params.name)) return res.status(401).json({ error: "Authentication required" });
    if (req.user && req.params.name === "AuditLog" && !canReadAuditLog(req)) return res.status(403).json({ error: "Forbidden" });
    const rows = await (await col(req.params.name))
      .find(req.user ? await readScope(req, req.params.name) : {})
      .sort(sort(req.query.sort))
      .limit(Number(req.query.limit) || 10000)
      .toArray();
    res.json(presentAll(req.params.name, rows, req));
  })
);

app.post(
  "/api/entities/:name/filter",
  route(async (req, res) => {
    if (!req.user && !publicRead.has(req.params.name)) return res.status(401).json({ error: "Authentication required" });
    if (req.user && req.params.name === "AuditLog" && !canReadAuditLog(req)) return res.status(403).json({ error: "Forbidden" });
    const criteria = query(req.body.query);
    const rows = await (await col(req.params.name))
      .find(req.user ? await readScope(req, req.params.name, criteria) : criteria)
      .sort(sort(req.body.sort))
      .skip(req.body.skip || 0)
      .limit(req.body.limit || 10000)
      .toArray();
    res.json(presentAll(req.params.name, rows, req));
  })
);

app.get(
  "/api/entities/:name/:id",
  auth,
  route(async (req, res) => {
    if (req.params.name === "AuditLog" && !canReadAuditLog(req)) return res.status(403).json({ error: "Forbidden" });
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Not found" });
    const row = await (await col(req.params.name)).findOne(
      await readScope(req, req.params.name, { _id: new ObjectId(req.params.id) })
    );
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(present(req.params.name, row, req));
  })
);

const syncRelatedEntitiesAfterWrite = async (req, name, doc) => {
  const tenantId = req.user?.tenant_id || doc?.tenant_id;
  if (!doc || !tenantId) return {};
  const database = await db();
  const warnings = [];

  const syncStudentParentAndEnrollment = async () => {
    // A real, authoritative student id inside the tenant
    const studentOid = doc._id && ObjectId.isValid(doc._id) ? new ObjectId(doc._id) : null;
    if (!studentOid) return null;

    const studentId = studentOid.toString();
    const now = new Date().toISOString();
    let resolvedYearId = null;

    // ---- Parent synchronization (idempotent, canonical) ----
    // Identity rules: email -> phone -> none. Never auto-create a User.
    let parentId = null;
    const normPhone = (v) => {
      if (v === null || v === undefined || v === "") return null;
      return String(v).replace(/[^\d+]/g, "").trim();
    };
    const parentEmail = doc.parent_email ? normalizeEmail(doc.parent_email) : null;
    const parentPhone = doc.parent_phone ? normPhone(doc.parent_phone) : null;

    if (parentEmail) {
      const existing = await database.collection("Parent").findOne(
        { tenant_id: tenantId, email: normalizeEmail(doc.parent_email) },
        { projection: { _id: 1 } }
      );
      parentId = existing ? existing._id.toString() : null;
      if (!parentId) {
        const res = await database.collection("Parent").insertOne({
          tenant_id: tenantId,
          full_name: doc.parent_name ? String(doc.parent_name).trim() : null,
          name: doc.parent_name ? String(doc.parent_name).trim() : null,
          email: normalizeEmail(doc.parent_email),
          phone: parentPhone,
          relationship_type: doc.parent_relationship || "parent",
          status: "active",
          created_date: now,
          updated_date: now,
        });
        parentId = res.insertedId.toString();
      }
    } else if (parentPhone) {
      const existing = await database.collection("Parent").findOne(
        { tenant_id: tenantId, phone: parentPhone },
        { projection: { _id: 1 } }
      );
      parentId = existing ? existing._id.toString() : null;
      if (!parentId) {
        const res = await database.collection("Parent").insertOne({
          tenant_id: tenantId,
          full_name: doc.parent_name ? String(doc.parent_name).trim() : null,
          name: doc.parent_name ? String(doc.parent_name).trim() : null,
          phone: parentPhone,
          relationship_type: doc.parent_relationship || "parent",
          status: "active",
          created_date: now,
          updated_date: now,
        });
        parentId = res.insertedId.toString();
      }
    }

    // Sync display fields onto the resolved parent (never touch user_id/auth).
    if (parentId && ObjectId.isValid(parentId)) {
      const parentUpdates = { updated_date: now };
      if (doc.parent_name) parentUpdates.full_name = String(doc.parent_name).trim();
      if (doc.parent_name) parentUpdates.name = String(doc.parent_name).trim();
      if (parentEmail) parentUpdates.email = parentEmail;
      if (parentPhone) parentUpdates.phone = parentPhone;
      await database.collection("Parent").updateOne(
        { _id: new ObjectId(parentId), tenant_id: tenantId },
        { $set: parentUpdates }
      );

      // ParentStudent upsert (idempotent via unique index). Preserve existing
      // emergency-contact / pickup flags rather than blindly setting them.
      const existingLink = await database.collection("ParentStudent").findOne(
        { tenant_id: tenantId, parent_id: parentId, student_id: studentId },
        { projection: { is_primary: 1, is_emergency_contact: 1, can_pickup: 1 } }
      );
      if (existingLink) {
        await database.collection("ParentStudent").updateOne(
          { _id: existingLink._id, tenant_id: tenantId },
          { $set: { is_primary: true, updated_date: now } }
        );
      } else {
        await database.collection("ParentStudent").insertOne({
          tenant_id: tenantId,
          parent_id: parentId,
          student_id: studentId,
          relationship: doc.parent_relationship || "parent",
          is_primary: true,
          is_emergency_contact: false,
          can_pickup: false,
          created_date: now,
          updated_date: now,
        });
      }
    }

    // ---- Enrollment auto-creation (references academic structures, NEVER creates them) ----
    // Class/section are resolved only; a Student may exist without an Enrollment.
    let schoolClassId = null;
    if (doc.school_class_id && ObjectId.isValid(doc.school_class_id)) {
      const cls = await database.collection("SchoolClass").findOne(
        { _id: new ObjectId(doc.school_class_id), tenant_id: tenantId },
        { projection: { _id: 1 } }
      );
      if (cls) schoolClassId = cls._id.toString();
    } else if (doc.class_name) {
      const cls = await database.collection("SchoolClass").findOne(
        { tenant_id: tenantId, name: String(doc.class_name).trim() },
        { projection: { _id: 1 } }
      );
      if (cls) schoolClassId = cls._id.toString();
    }

    let sectionId = null;
    if (doc.section_id && ObjectId.isValid(doc.section_id)) {
      const sec = await database.collection("Section").findOne(
        { _id: new ObjectId(doc.section_id), tenant_id: tenantId },
        { projection: { _id: 1 } }
      );
      if (sec) sectionId = sec._id.toString();
    } else if (doc.section && schoolClassId && ObjectId.isValid(schoolClassId)) {
      const sec = await database.collection("Section").findOne(
        { tenant_id: tenantId, school_class_id: new ObjectId(schoolClassId), name: String(doc.section).trim() },
        { projection: { _id: 1 } }
      );
      if (sec) sectionId = sec._id.toString();
    }

    if (doc.class_name && !schoolClassId) {
      warnings.push(`Enrollment could not be created because class "${doc.class_name}" could not be resolved.`);
    }
    if (doc.section && !sectionId && schoolClassId) {
      warnings.push(`Enrollment could not be created because section "${doc.section}" could not be resolved.`);
    }

    const classAndSectionResolved = !doc.class_name || !!schoolClassId;
    const sectionResolved = !doc.section || !!sectionId;

    if (classAndSectionResolved && sectionResolved) {
      // Resolve current AcademicYear server-side (never trust client blindly).
      const currentYears = await database.collection("AcademicYear")
        .find({ tenant_id: tenantId, is_current: true }, { projection: { _id: 1 } })
        .toArray();

      if (currentYears.length === 1 && currentYears[0]._id) {
        const academicYearId = currentYears[0]._id.toString();
        resolvedYearId = academicYearId;

        // Upsert the enrollment for the current academic year only. If one
        // already exists, update placement fields only (never lifecycle).
        const existingEnrollment = await database.collection("Enrollment").findOne(
          { tenant_id: tenantId, academic_year_id: academicYearId, student_id: studentId },
          { projection: { _id: 1 } }
        );
        if (existingEnrollment) {
          const placement = { updated_date: now };
          if (schoolClassId) placement.school_class_id = schoolClassId;
          if (sectionId) placement.section_id = sectionId;
          if (doc.roll_number) placement.roll_number = String(doc.roll_number).trim();
          await database.collection("Enrollment").updateOne(
            { _id: existingEnrollment._id, tenant_id: tenantId },
            { $set: placement }
          );
        } else {
          await database.collection("Enrollment").insertOne({
            tenant_id: tenantId,
            student_id: studentId,
            academic_year_id: academicYearId,
            school_class_id: schoolClassId || null,
            section_id: sectionId || null,
            roll_number: doc.roll_number ? String(doc.roll_number).trim() : null,
            status: "enrolled",
            enrollment_date: new Date().toISOString().split("T")[0],
            created_date: now,
            updated_date: now,
          });
        }

        // Keep the Student's own reference fields in sync with the canonical
        // current-year enrollment (class/section ids and academic year).
        const studentRefUpdate = {
          academic_year_id: academicYearId,
          updated_date: now,
        };
        if (schoolClassId) studentRefUpdate.school_class_id = schoolClassId;
        if (sectionId) studentRefUpdate.section_id = sectionId;
        await database.collection("Student").updateOne(
          { _id: studentOid, tenant_id: tenantId },
          { $set: studentRefUpdate }
        );
      } else if (currentYears.length === 0) {
        warnings.push("Enrollment could not be created because there is no current academic year.");
      } else {
        warnings.push("Enrollment could not be created because multiple current academic years exist.");
      }
    }
    return { academicYearId: resolvedYearId, schoolClassId, sectionId };
  };

  if (name === "Enrollment" && doc.student_id && ObjectId.isValid(doc.student_id)) {
    const studentUpdate = {
      academic_year_id: doc.academic_year_id || null,
      school_class_id: doc.school_class_id || null,
      section_id: doc.section_id || null,
      updated_date: new Date().toISOString(),
    };
    if (doc.roll_number) studentUpdate.roll_number = doc.roll_number;
    if (doc.school_class_id && ObjectId.isValid(doc.school_class_id)) {
      const cls = await database.collection("SchoolClass").findOne({ _id: new ObjectId(doc.school_class_id), tenant_id: tenantId }, { projection: { name: 1 } });
      if (cls) studentUpdate.class_name = cls.name;
    }
    if (doc.section_id && ObjectId.isValid(doc.section_id)) {
      const sec = await database.collection("Section").findOne({ _id: new ObjectId(doc.section_id), tenant_id: tenantId }, { projection: { name: 1 } });
      if (sec) studentUpdate.section = sec.name;
    }
    await database.collection("Student").updateOne(
      { _id: new ObjectId(doc.student_id), tenant_id: tenantId },
      { $set: studentUpdate }
    );
  }

  if (name === "Student") {
    const placement = await syncStudentParentAndEnrollment();
    await syncEnrollmentRosters({
      tenantId,
      academicYearId: placement?.academicYearId || doc.academic_year_id || null,
      schoolClassId: placement?.schoolClassId || doc.school_class_id || null,
      sectionId: placement?.sectionId || doc.section_id || null,
    });
  }

  if (name === "TeacherAssignment" && doc.teacher_id && ObjectId.isValid(doc.teacher_id)) {
    const allAssignments = await database.collection("TeacherAssignment").find({
      tenant_id: tenantId,
      teacher_id: doc.teacher_id,
      status: { $ne: "inactive" },
    }).toArray();
    const classIds = [...new Set(allAssignments.map((a) => a.school_class_id).filter(Boolean))];
    const subjectIds = [...new Set(allAssignments.map((a) => a.subject_id).filter(Boolean))];
    const teacherUpdate = {
      assigned_class_ids: classIds,
      assigned_subject_ids: subjectIds,
      updated_date: new Date().toISOString(),
    };
    const classOids = objectIdsOrNull(classIds);
    if (classOids && classOids.length > 0) {
      const classes = await database.collection("SchoolClass").find({ _id: { $in: classOids }, tenant_id: tenantId }, { projection: { name: 1 } }).toArray();
      teacherUpdate.assigned_classes = classes.map((c) => c.name);
    }
    const subjectOids = objectIdsOrNull(subjectIds);
    if (subjectOids && subjectOids.length > 0) {
      const subjects = await database.collection("Subject").find({ _id: { $in: subjectOids }, tenant_id: tenantId }, { projection: { name: 1 } }).toArray();
      teacherUpdate.subjects = subjects.map((s) => s.name);
    }
    await database.collection("Teacher").updateOne(
      { _id: new ObjectId(doc.teacher_id), tenant_id: tenantId },
      { $set: teacherUpdate }
    );
  }

  if (name === "ParentStudent" && doc.parent_id && ObjectId.isValid(doc.parent_id)) {
    const parent = await database.collection("Parent").findOne({ _id: new ObjectId(doc.parent_id), tenant_id: tenantId });
    if (parent) {
      const allLinks = await database.collection("ParentStudent").find({ tenant_id: tenantId, parent_id: doc.parent_id }).toArray();
      const studentIds = [...new Set(allLinks.map((l) => l.student_id).filter(Boolean))];
      if (parent.user_id && ObjectId.isValid(parent.user_id)) {
        await database.collection("User").updateOne(
          { _id: new ObjectId(parent.user_id), tenant_id: tenantId },
          { $set: { linked_student_ids: studentIds, linked_student_id: studentIds[0] || null, updated_date: new Date().toISOString() } }
        );
      }
    }
  }

  if (name === "AcademicYear" && doc.is_current) {
    const docId = doc._id || doc.id;
    if (ObjectId.isValid(docId)) {
      await database.collection("AcademicYear").updateMany(
        { tenant_id: tenantId, _id: { $ne: new ObjectId(docId) } },
        { $set: { is_current: false, updated_date: new Date().toISOString() } }
      );
    }
  }

  if (name === "Examination" && (doc._id || doc.id)) {
    await ensureExamRoster({ tenantId, examinationId: String(doc._id || doc.id), db: database });
  }

  if (name === "Enrollment" && doc.student_id) {
    await syncEnrollmentRosters({
      tenantId,
      academicYearId: doc.academic_year_id || null,
      schoolClassId: doc.school_class_id || null,
      sectionId: doc.section_id || null,
    });
  }

  return { warnings };
};

app.post(
  "/api/entities/:name",
  auth,
  route(async (req, res) => {
    // User creation is never generic CRUD. provisionUser() is the only path that
    // may mint an account, because it is the only one that enforces the
    // delegation matrix, resolves the tenant, syncs the domain profile
    // (Teacher/Student/Parent/ParentStudent), rolls back on partial failure and
    // writes the audit event. A raw insert here would bypass all of it.
    if (req.params.name === "User") {
      return res.status(403).json({ error: "Accounts are created through staff provisioning, not entity CRUD" });
    }
    let body = normalizeEmailFields(req.params.name, req.body);
    if (!writeAllowed(req, req.params.name, body)) return res.status(403).json({ error: "Forbidden" });
    if (!canWriteEntity(req, req.params.name, "create")) return res.status(403).json({ error: "Forbidden" });
    body = await hydrateRelationshipIds(req, req.params.name, body);
    await assertRelationshipWrite(req, req.params.name, body, true);
    let studentAssignmentWarnings = [];
    if (req.params.name === "Student" && req.user.tenant_id) {
      const assignment = await autoAssignStudentNumbers(await db(), req.user.tenant_id, body);
      body.admission_number = assignment.admission_number;
      body.roll_number = assignment.roll_number;
      studentAssignmentWarnings = assignment.warnings;
    }
    if (req.params.name === "Examination") {
      const numQ = Number(body.num_questions || body.number_of_questions) || 50;
      const maxM = Number(body.max_marks) || 100;
      if (body.marks_per_question == null) {
        body.marks_per_question = +(maxM / numQ).toFixed(4);
      }
      if (body.num_questions == null) body.num_questions = numQ;
      if (body.max_marks == null) body.max_marks = maxM;
    }
    if (req.params.name === "Tenant") {
      // Normalize institution identity so the branded school login / institution
      // lookup always resolves: trim the display name and derive a canonical,
      // lowercase slug subdomain (falling back to the name when blank).
      body.name = String(body.name || "").trim();
      // Same normalization and the same uniqueness guarantee as the register and
      // trial paths, so a Tenant cannot be created with an empty, overlong or
      // colliding portal address through the generic entity API. The unique index
      // backs this; the guard reports it as a 409 instead of a 500.
      body.subdomain = normalizeSubdomain(body.subdomain || body.name);
      assertSubdomainUsable(body.subdomain);
      await assertSubdomainAvailable(await col("Tenant"), body.subdomain);
    }
    let row = {
      ...body,
      // A scoped platform owner creates INSIDE the school it is viewing. Forced
      // rather than refused, because the client legitimately omits tenant_id on
      // create and a refusal would break the ordinary case; and unlike a privilege
      // field, an over-broad tenant_id here is corrected by the server rather than
      // trusted. A caller with no scope keeps the platform behaviour of writing
      // whatever tenant_id the body names.
      ...(req.viewAs
        ? { tenant_id: req.viewAs.tenant_id }
        : !platform(req) && { tenant_id: req.user.tenant_id }),
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
    };
    if (req.params.name === "Student") {
      const tenantId = row.tenant_id || req.user.tenant_id;
      const tenant = await (await db()).collection("Tenant").findOne({ _id: ObjectId.isValid(String(tenantId)) ? new ObjectId(String(tenantId)) : tenantId }, { projection: { custom_domain: 1, subdomain: 1 } });
      const emailUpdates = await ensureStudentEmails({ database: await db(), tenantId, student: row, tenant });
      if (Object.keys(emailUpdates).length) row = { ...row, ...emailUpdates };
    }
    // Response-only channel; see the bulk path for why it must not persist.
    const hydrateWarnings = Array.isArray(row._syncWarnings) ? row._syncWarnings : [];
    delete row._syncWarnings;
    const result = await (await col(req.params.name)).insertOne(row);
    if (SERVER_AUDIT_ENTITIES.has(req.params.name)) {
      await logServerAudit(req, {
        action: "create",
        entity_type: req.params.name,
        entity_id: result.insertedId.toString(),
        details: row.name || row.full_name || req.params.name,
      });
    }
    if (req.params.name === "Tenant") {
      // No longer auto-seed demo data for newly created institutions; they
      // start empty and are populated by the school admin.
    }
    const createdDoc = { ...row, _id: result.insertedId };
    const syncResult = await syncRelatedEntitiesAfterWrite(req, req.params.name, createdDoc);
    if (hydrateWarnings.length) createdDoc._syncWarnings = [...hydrateWarnings, ...(studentAssignmentWarnings || []), ...(syncResult?.warnings || [])];
    else if (studentAssignmentWarnings.length) createdDoc._syncWarnings = [...studentAssignmentWarnings, ...(syncResult?.warnings || [])];
    else if (syncResult?.warnings?.length) createdDoc._syncWarnings = syncResult.warnings;
    if (req.params.name === "Student" && createdDoc._id) {
      const provisioned = await provisionAutoLogins({
        database: await db(),
        tenantId: req.user.tenant_id,
        student: createdDoc,
        studentId: createdDoc._id.toString(),
        creatorRoles: rolesOf(req),
      });
      if (provisioned.student || provisioned.parent) createdDoc._provisioned = provisioned;
    }
    res.status(201).json(present(req.params.name, createdDoc, req));
  })
);

app.post(
  "/api/entities/:name/bulk",
  auth,
  route(async (req, res) => {
    // Same rule as the single-create path: User is provisioned, never inserted.
    if (req.params.name === "User") {
      return res.status(403).json({ error: "Accounts are created through staff provisioning, not entity CRUD" });
    }
    let items = req.body.items?.map((item) => normalizeEmailFields(req.params.name, item));
    if (!items?.every((item) => writeAllowed(req, req.params.name, item))) return res.status(403).json({ error: "Forbidden" });
    if (!canWriteEntity(req, req.params.name, "create")) return res.status(403).json({ error: "Forbidden" });
    items = await Promise.all(items.map((item) => hydrateRelationshipIds(req, req.params.name, item)));
    for (const item of items) await assertRelationshipWrite(req, req.params.name, item, true);
    if (req.params.name === "Student" && req.user.tenant_id) {
      const database = await db();
      const tenant = await database.collection("Tenant").findOne({ _id: ObjectId.isValid(String(req.user.tenant_id)) ? new ObjectId(String(req.user.tenant_id)) : req.user.tenant_id }, { projection: { custom_domain: 1, subdomain: 1 } });
      for (const item of items) {
        const assignment = await autoAssignStudentNumbers(database, req.user.tenant_id, item);
        item.admission_number = assignment.admission_number;
        item.roll_number = assignment.roll_number;
        if (assignment.warnings.length) item._syncWarnings = [...(item._syncWarnings || []), ...assignment.warnings];
        const emailUpdates = await ensureStudentEmails({ database, tenantId: req.user.tenant_id, student: item, tenant });
        if (Object.keys(emailUpdates).length) Object.assign(item, emailUpdates);
      }
    }
    const now = new Date().toISOString();
    // _syncWarnings is a response-only channel (the import dialog reads it per
    // row). Carrying it into the inserted document would persist advisory text
    // into the record itself, so pull it out here and re-attach to the response.
    const warningsByIndex = items.map((item) => (Array.isArray(item._syncWarnings) ? item._syncWarnings : []));
    const rows = items.map(({ _syncWarnings, ...item }) => ({
      ...item,
      // Forced to the scope, exactly as on the single-create path: a bulk import
      // must not be a way around it.
      ...(req.viewAs
        ? { tenant_id: req.viewAs.tenant_id }
        : !platform(req) && { tenant_id: req.user.tenant_id }),
      created_date: now,
      updated_date: now,
    }));
    const result = await (await col(req.params.name)).insertMany(rows);
    if (SERVER_AUDIT_ENTITIES.has(req.params.name)) {
      await logServerAudit(req, {
        action: "create_many",
        entity_type: req.params.name,
        entity_id: "",
        details: `${rows.length} ${req.params.name} records created`,
      });
    }
    const database = await db();
    const outputDocs = rows.map((item, i) => ({ ...item, _id: result.insertedIds[i] }));
    for (let i = 0; i < outputDocs.length; i++) {
      const doc = outputDocs[i];
      if (req.params.name !== "Student") continue;
      const carried = warningsByIndex[i] || [];
      const syncResult = await syncRelatedEntitiesAfterWrite(req, "Student", doc);
      if (carried.length) doc._syncWarnings = [...carried, ...(syncResult?.warnings || [])];
      else if (syncResult?.warnings?.length) doc._syncWarnings = syncResult.warnings;
      const provisioned = await provisionAutoLogins({
        database,
        tenantId: req.user.tenant_id,
        student: doc,
        studentId: doc._id?.toString(),
        creatorRoles: rolesOf(req),
      });
      if (provisioned.student || provisioned.parent) doc._provisioned = provisioned;
    }
    res.json(outputDocs.map((doc) => out(doc)));
  })
);

app.patch(
  "/api/entities/:name/bulk",
  auth,
  route(async (req, res) => {
    // A bulk User update is a bulk role change: it must not be a quieter way to
    // change privileges than the single-record path, so it is refused outright.
    if (req.params.name === "User") {
      return res.status(403).json({ error: "Use staff access to change a role" });
    }
    let items = req.body.items?.map((item) => normalizeEmailFields(req.params.name, item));
    // Every item is checked, not just the first: this route was the unguarded one,
    // so a caller could carry a billing field in item 2 and have it written while
    // item 1 looked innocuous. `items` may also be missing entirely, which the
    // guard's own shape tolerates and the writeAllowed check below rejects.
    if (req.params.name === "Tenant") {
      for (const item of items || []) {
        const refusedBillingWrite = tenantBillingWriteRefused(req, item);
        if (refusedBillingWrite) return res.status(refusedBillingWrite.status).json({ error: refusedBillingWrite.error });
      }
    }
    if (!items?.every((item) => writeAllowed(req, req.params.name, item))) return res.status(403).json({ error: "Forbidden" });
    if (!canWriteEntity(req, req.params.name, "update")) return res.status(403).json({ error: "Forbidden" });
    items = await Promise.all(items.map((item) => hydrateRelationshipIds(req, req.params.name, item)));
    for (const item of items) await assertRelationshipWrite(req, req.params.name, item);
    const target = await col(req.params.name);
    for (const { id, ...data } of items) {
      // _syncWarnings is response-only; see the bulk create path.
      const { _syncWarnings: _bw, ...dataNoWarn } = data;
      // A scoped platform owner cannot re-parent a row out of the school it is
      // viewing, so the strip-and-force is the same one the create paths use. The
      // target lookup below already resolves through readScope, which narrows to
      // the scope, so the row it updates is that school's row either way.
      const stripped = platform(req) && !req.viewAs
        ? dataNoWarn
        : (() => {
            const { tenant_id: _, ...rest } = dataNoWarn;
            return req.viewAs ? { ...rest, tenant_id: req.viewAs.tenant_id } : rest;
          })();
      const criteria = await readScope(req, req.params.name, { _id: new ObjectId(id) });
      let setData = { ...stripped, updated_date: new Date().toISOString() };
      if (req.params.name === "Student") {
        const tenantId = req.viewAs?.tenant_id || req.user.tenant_id;
        if (tenantId) {
          const database = await db();
          const tenant = await database.collection("Tenant").findOne({ _id: ObjectId.isValid(String(tenantId)) ? new ObjectId(String(tenantId)) : tenantId }, { projection: { custom_domain: 1, subdomain: 1 } });
          const current = await target.findOne(criteria, { projection: { full_name: 1, student_email: 1, parent_email: 1, parent_name: 1 } });
          const emailUpdates = await ensureStudentEmails({ database, tenantId, student: { ...current, ...setData }, tenant });
          if (Object.keys(emailUpdates).length) Object.assign(setData, emailUpdates);
        }
      }
      await target.updateOne(criteria, { $set: setData });
    }
    const syncWarnings = [];
    const provisionedRows = {};
    if (req.params.name === "Student") {
      const database = await db();
      for (const { id } of items) {
        const updated = await target.findOne(await readScope(req, req.params.name, { _id: new ObjectId(id) }));
        if (!updated) continue;
        const syncResult = await syncRelatedEntitiesAfterWrite(req, "Student", updated);
        if (syncResult?.warnings?.length) syncWarnings.push(...syncResult.warnings);
        const provisioned = await provisionAutoLogins({
          database,
          tenantId: req.user.tenant_id,
          student: updated,
          studentId: updated._id?.toString(),
          creatorRoles: rolesOf(req),
        });
        if (provisioned.student || provisioned.parent) provisionedRows[updated._id.toString()] = provisioned;
      }
    }
    if (SERVER_AUDIT_ENTITIES.has(req.params.name)) {
      await logServerAudit(req, {
        action: "update_many",
        entity_type: req.params.name,
        entity_id: "",
        details: `${items.length} ${req.params.name} records updated`,
      });
    }
    res.json({
      ok: true,
      ...(syncWarnings.length && { syncWarnings }),
      ...(Object.keys(provisionedRows).length && { provisioned: provisionedRows }),
    });
  })
);

app.patch(
  "/api/entities/:name/many",
  auth,
  route(async (req, res) => {
    let rawUpdate = normalizeEmailFields(req.params.name, req.body.update?.$set || req.body.update);
    // A mass update is a privilege change at the same scale as a mass delete:
    // every role, tenant, credential and identity field is refused outright, and
    // an app_role body is refused with a route-specific message because it has no
    // assignUserRole path here (that endpoint is per-account by design).
    if (req.params.name === "User") {
      const many = rawUpdate || {};
      if (Object.prototype.hasOwnProperty.call(many, "app_role")) {
        return res.status(403).json({ error: "Use staff access to change a role" });
      }
      const refusedByGuard = userPrivilegeWriteRefused(many, {
        hasTenantId: true,
        tenantId: many.tenant_id,
      });
      if (refusedByGuard) return res.status(refusedByGuard.status).json({ error: refusedByGuard.error });
    }
    if (req.params.name === "Tenant") {
      const refusedBillingWrite = tenantBillingWriteRefused(req, rawUpdate);
      if (refusedBillingWrite) return res.status(refusedBillingWrite.status).json({ error: refusedBillingWrite.error });
    }
    if (!writeAllowed(req, req.params.name, rawUpdate)) return res.status(403).json({ error: "Forbidden" });
    if (!canWriteEntity(req, req.params.name, "update")) return res.status(403).json({ error: "Forbidden" });
    rawUpdate = await hydrateRelationshipIds(req, req.params.name, rawUpdate);
    await assertRelationshipWrite(req, req.params.name, rawUpdate);
    const { _id: _muid, id: _mid, tenant_id: _mtid, _syncWarnings: _muw, ...updateWithoutId } = rawUpdate || {};
    const update = platform(req) && rawUpdate?.tenant_id ? { ...updateWithoutId, tenant_id: rawUpdate.tenant_id } : updateWithoutId;
    const result = await (await col(req.params.name)).updateMany(
      await readScope(req, req.params.name, query(req.body.query)),
      { $set: { ...update, updated_date: new Date().toISOString() } }
    );
    if (SERVER_AUDIT_ENTITIES.has(req.params.name)) {
      await logServerAudit(req, {
        action: "update_many",
        entity_type: req.params.name,
        entity_id: "",
        details: `${result.modifiedCount} ${req.params.name} records updated`,
      });
    }
    res.json({ modifiedCount: result.modifiedCount });
  })
);

app.delete(
  "/api/entities/:name/many",
  auth,
  route(async (req, res) => {
    // A mass delete of accounts is refused for the same reason the single-record
    // route refuses it, and this asymmetry was the hole: DELETE /entities/User/:id
    // returned 403 "use your profile's delete-account flow" while
    // DELETE /entities/User/many had no such check, so a super_admin — or anyone
    // else who can reach canWriteEntity(User,'delete') — could delete every
    // account in every tenant with one request, and User was absent from
    // SERVER_AUDIT_ENTITIES so it left no trace. Deletion is per-account via
    // deleteMyAccount, which re-checks ownership and a fresh password.
    if (req.params.name === "User") {
      return res.status(403).json({ error: "Use the delete-account flow to remove an account" });
    }
    if (!writeAllowed(req, req.params.name)) return res.status(403).json({ error: "Forbidden" });
    if (!canWriteEntity(req, req.params.name, "delete")) return res.status(403).json({ error: "Forbidden" });
    const criteria = await readScope(req, req.params.name, query(req.body.query));
    const deletedEnrollments = req.params.name === "Enrollment"
      ? await (await col(req.params.name)).find(criteria).toArray()
      : [];
    const result = await (await col(req.params.name)).deleteMany(criteria);
    if (SERVER_AUDIT_ENTITIES.has(req.params.name)) {
      await logServerAudit(req, {
        action: "delete_many",
        entity_type: req.params.name,
        entity_id: "",
        details: `${result.deletedCount} ${req.params.name} records deleted`,
      });
    }
    if (deletedEnrollments.length > 0 && req.user?.tenant_id) {
      for (const doc of deletedEnrollments) {
        await syncEnrollmentRosters({
          tenantId: req.user.tenant_id,
          academicYearId: doc.academic_year_id || null,
          schoolClassId: doc.school_class_id || null,
          sectionId: doc.section_id || null,
        });
      }
    }
    res.json({ deletedCount: result.deletedCount });
  })
);

app.patch(
  "/api/entities/:name/:id",
  auth,
  route(async (req, res) => {
    const wrapperRefused = assertFlatUpdateBody(req.body);
    if (wrapperRefused) return res.status(wrapperRefused.status).json({ error: wrapperRefused.error });
    let body = normalizeEmailFields(req.params.name, req.body);
    if (req.params.name === "Tenant") {
      const refusedBillingWrite = tenantBillingWriteRefused(req, body);
      if (refusedBillingWrite) return res.status(refusedBillingWrite.status).json({ error: refusedBillingWrite.error });
    }
    if (!writeAllowed(req, req.params.name, body)) return res.status(403).json({ error: "Forbidden" });
    if (!canWriteEntity(req, req.params.name, "update")) return res.status(403).json({ error: "Forbidden" });
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Not found" });
    body = await hydrateRelationshipIds(req, req.params.name, body);
    await assertRelationshipWrite(req, req.params.name, body);
    const target = await col(req.params.name);
    const criteria = await readScope(req, req.params.name, { _id: new ObjectId(req.params.id) });
    const { _id: _oid, id: _uid, tenant_id: _tid, _syncWarnings: _sw, ...updateData } = body;
    // `let` because the User branch below REPLACES its contents rather than
    // merging into them. It was `const finalData = updateData` merged with
    // restData, which meant every field the guard had deliberately stripped from
    // restData (role, app_role, tenant_id) was still sitting in the object being
    // written, and the $set then overwrote whatever assignUserRole had just done.
    let finalData = platform(req) && body.tenant_id ? { ...updateData, tenant_id: body.tenant_id } : updateData;
    // A role change is a privilege change, so it never travels through generic
    // entity CRUD. Delegates to assignUserRole, which enforces the delegation
    // matrix, keeps role/tenant consistent and writes the audit event — the same
    // path manageStaff setRole uses. Without this, super_admin could mint or
    // self-demote an account through a route that bypassed both the hierarchy
    // check and the audit trail.
    if (req.params.name === "User") {
      const refusedByGuard = userPrivilegeWriteRefused(updateData, {
        hasTenantId: true,
        tenantId: body.tenant_id,
      });
      if (refusedByGuard) return res.status(refusedByGuard.status).json({ error: refusedByGuard.error });
      if (Object.prototype.hasOwnProperty.call(updateData, "app_role")
        || Object.prototype.hasOwnProperty.call(updateData, "app_roles")) {
        // The only permitted role write: delegated so it is hierarchy-checked
        // against the delegation matrix, keeps role/tenant consistent, and is
        // audited. Without this a caller could mint or self-promote an account
        // through a route that bypassed both. `app_roles` is the canonical field
        // and is accepted alongside the single-role mirror, so a multi-role set
        // cannot be smuggled in through the generic $set either.
        const { app_role: _newRole, app_roles: _newRoles, role: _legacyRole, ...restData } = updateData;
        const refused = await assignUserRoles(req, {
          user_id: req.params.id,
          app_roles: _newRoles !== undefined ? _newRoles : _newRole,
        });
        if (refused) return res.status(refused.status).json({ error: refused.error });
        // REPLACE, never merge. The earlier `for (entry of restData) finalData[k]=v`
        // was an additive merge onto a copy of the unsanitised body, so a request
        // carrying app_role *and* a tenant_id or a legacy role still wrote both
        // through the generic $set — a cross-tenant account move and a forged
        // super_admin `role` field, on a route that appeared to be delegating.
        // assignUserRole owns role *and* tenant; anything it did not set is not
        // this route's to write.
        finalData = restData;
      }
    }
    // Custom-domain lifecycle is owned by verifyCustomDomain/manageCustomDomain.
    // A plain tenant update must never stamp a status over verified/live. When the
    // domain CHANGES without an explicit lifecycle write, the verification cycle
    // restarts (status resets to pending, timestamps cleared) so a stale live/
    // verified state can never ride along a brand-new domain. An explicitly
    // cleared domain removes the lifecycle fields entirely. Stored values are
    // always canonical (shared normalizeHost) and uniqueness is enforced here too.
    if (req.params.name === "Tenant" && Object.prototype.hasOwnProperty.call(finalData, "custom_domain")) {
      const raw = typeof finalData.custom_domain === "string" ? finalData.custom_domain : "";
      const next = raw ? normalizeHost(raw) : "";
      if (raw && !next) return res.status(400).json({ error: "Enter a valid domain, e.g. exam.yourschool.edu" });
      if (next) {
        await assertCustomDomainAvailable(col("Tenant"), next, req.params.id);
        finalData.custom_domain = next;
      }
      if (next && finalData.custom_domain_status === undefined) {
        delete finalData.custom_domain_status;
        const stored = await target.findOne(criteria, { projection: { custom_domain: 1 } }).catch(() => null);
        const prev = normalizeHost(stored?.custom_domain);
        if (prev !== next) {
          finalData.custom_domain_status = "pending";
          finalData.custom_domain_verified = false;
          finalData.custom_domain_live_at = null;
          finalData.dns_status = "pending";
          finalData.tls_status = "pending";
          finalData.hosting_status = "";
          finalData.hosting_provider = "";
          finalData.hosting_verification = [];
        }
      } else if (!next) {
        finalData.custom_domain = "";
        finalData.custom_domain_status = "";
        finalData.custom_domain_verified = false;
        finalData.custom_domain_live_at = null;
        finalData.dns_status = "";
        finalData.tls_status = "";
        finalData.hosting_status = "";
        finalData.hosting_provider = "";
        finalData.hosting_verification = [];
      }
    }
    const before = SERVER_AUDIT_ENTITIES.has(req.params.name) ? await target.findOne({ ...criteria, projection: { name: 1, full_name: 1, status: 1 } }) : null;
    let updateSet = { ...finalData, updated_date: new Date().toISOString() };
    if (req.params.name === "Student") {
      const tenantId = req.viewAs?.tenant_id || req.user.tenant_id;
      if (tenantId) {
        const database = await db();
        const tenant = await database.collection("Tenant").findOne({ _id: ObjectId.isValid(String(tenantId)) ? new ObjectId(String(tenantId)) : tenantId }, { projection: { custom_domain: 1, subdomain: 1 } });
        const emailUpdates = await ensureStudentEmails({ database, tenantId, student: { ...before || {}, ...updateSet }, tenant });
        if (Object.keys(emailUpdates).length) {
          Object.assign(updateSet, emailUpdates);
        }
      }
    }
    const result = await target.findOneAndUpdate(
      criteria,
      { $set: updateSet },
      { returnDocument: "after" }
    );
    if (!result) return res.status(404).json({ error: "Not found" });
    if (SERVER_AUDIT_ENTITIES.has(req.params.name)) {
      let action = "update";
      if (req.params.name === "Tenant" && finalData.status && before?.status !== finalData.status) {
        action = finalData.status === "suspended" ? "suspend" : finalData.status === "active" ? "activate" : "update";
      }
      await logServerAudit(req, {
        action,
        entity_type: req.params.name,
        entity_id: result._id.toString(),
        details: result.name || result.full_name || req.params.name,
      });
    }
    const syncResult = await syncRelatedEntitiesAfterWrite(req, req.params.name, result);
    const resultOut = present(req.params.name, result, req);
    if (syncResult?.warnings?.length) resultOut._syncWarnings = syncResult.warnings;
    if (req.params.name === "Student" && result._id) {
      const provisioned = await provisionAutoLogins({
        database: await db(),
        tenantId: req.user.tenant_id,
        student: result,
        studentId: result._id.toString(),
        creatorRoles: rolesOf(req),
      });
      if (provisioned.student || provisioned.parent) resultOut._provisioned = provisioned;
    }
    res.json(resultOut);
  })
);

app.delete(
  "/api/entities/:name/:id",
  auth,
  route(async (req, res) => {
    // User is absent from SERVER_AUDIT_ENTITIES, so a generic delete here would
    // remove an account with no audit event and none of the ownership cleanup
    // deleteMyAccount performs. Accounts are removed through that function.
    if (req.params.name === "User") {
      return res.status(403).json({ error: "Use the account deletion flow to remove a user" });
    }
    if (!writeAllowed(req, req.params.name)) return res.status(403).json({ error: "Forbidden" });
    if (!canWriteEntity(req, req.params.name, "delete")) return res.status(403).json({ error: "Forbidden" });
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Not found" });
    const target = await col(req.params.name);
    const criteria = await readScope(req, req.params.name, { _id: new ObjectId(req.params.id) });
    const before = SERVER_AUDIT_ENTITIES.has(req.params.name) ? await target.findOne({ ...criteria, projection: { name: 1, full_name: 1 } }) : null;
    const deletedEnrollment = req.params.name === "Enrollment" ? await target.findOne(criteria) : null;
    const result = await target.deleteOne(criteria);
    if (SERVER_AUDIT_ENTITIES.has(req.params.name)) {
      await logServerAudit(req, {
        action: "delete",
        entity_type: req.params.name,
        entity_id: req.params.id,
        details: before?.name || before?.full_name || req.params.name,
      });
    }
    if (deletedEnrollment && req.user?.tenant_id) {
      await syncEnrollmentRosters({
        tenantId: req.user.tenant_id,
        academicYearId: deletedEnrollment.academic_year_id || null,
        schoolClassId: deletedEnrollment.school_class_id || null,
        sectionId: deletedEnrollment.section_id || null,
      });
    }
    res.json({ deletedCount: result.deletedCount });
  })
);

// Hierarchical User Provisioning (Server-Authoritative)
app.post(
  "/api/users/provision",
  auth,
  route(async (req, res) => {
    const database = await db();
    const safeResult = await provisionUser(req.user, req.body, {
      database,
      req,
      logAudit: logServerAudit,
    });
    res.status(201).json({ success: true, user: out(safeResult) });
  })
);

// User Invitations
app.post(
  "/api/users/invite",
  auth,
  route(async (req, res) => {
    if (!isExamWorkflow(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const email = req.body?.email?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "Email is required" });
    const requested = req.body?.app_roles !== undefined ? req.body.app_roles
      : req.body?.role !== undefined ? req.body.role
        : "teacher";
    const shape = validateAppRoleSet(requested);
    if (shape.error) return res.status(400).json({ error: shape.error });
    const roles = shape.roles;
    const role = roles[0];
    // An INVITATION can mint a new identity, so it is governed by the provisioning
    // matrix — which is why a school_admin cannot invite a new school_admin even
    // though they may promote an existing one via manageStaff setRoles. Every
    // requested role is delegation-checked, not just the primary: validating only
    // the primary makes the outcome depend on the hierarchy remaining a linear
    // chain, which is a property of the current table rather than of the rule.
    const provision = canProvisionRoleSet(rolesOf(req), roles);
    if (provision.error) return res.status(403).json({ error: provision.error });
    if (!superAdmin(req) && roles.some((held) => PLATFORM_ROLES.has(held))) {
      return res.status(403).json({ error: "Cannot assign platform roles" });
    }
    // Resolved here rather than read straight off req.user, for the same reason as
    // manageStaff: super_admin has no institution of its own, so the previous
    // `req.user?.tenant_id || null` wrote a null tenant and produced an invited
    // account that could authenticate but never reach a school's data. A platform
    // caller now names the institution it is inviting into; a school_admin is
    // pinned to its own and a mismatched tenant_id is refused with 404.
    const { tenantId, error: tenantError } = resolveStaffTenant(req, req.body?.tenant_id);
    if (tenantError) return res.status(tenantError.status).json({ error: tenantError.error });
    // A named institution must EXIST and be ACTIVE before a role is written onto
    // an account under it. resolveStaffTenant only decides which institution the
    // actor may act in; it is pure and cannot tell a real id from a well-formed
    // one that names nothing or a disabled school. Without this an invite can bind
    // an account to a tenant that can never be administered again. Same policy as
    // provisionUser(): 404 for a name that resolves to nothing, 400 for a disabled
    // institution.
    if (tenantId) {
      if (!ObjectId.isValid(String(tenantId))) {
        return res.status(404).json({ error: "Institution not found" });
      }
      const namedTenant = await (await db()).collection("Tenant").findOne({ _id: new ObjectId(String(tenantId)) });
      if (!namedTenant) return res.status(404).json({ error: "Institution not found" });
      if (namedTenant.status && namedTenant.status !== "active") {
        return res.status(400).json({ error: "Cannot invite into an inactive institution" });
      }
    }
    if (!roles.some((held) => PLATFORM_ROLES.has(held)) && !tenantId) {
      return res.status(400).json({ error: `tenant_id is required to invite a ${role} into an institution` });
    }
    // SEC-05: per-admin daily quota + per-recipient cooldown. Counted for every
    // attempt that reaches authorization (whether the recipient exists or is
    // brand new) so the quota bounds invites AND cooldown blocks same-tenant
    // repeats, while requests already rejected by validation/role checks and
    // cross-tenant ownership checks consume nothing. The recipient key is
    // scoped to the inviting tenant so another tenant's invite (an idempotent
    // update, per the audit) is not blocked.
    const database = await db();
    const existing = await database.collection("User").findOne({ email });
    const adminKey = `admin:${req.user._id.toString()}`;
    const recipientKey = `${tenantId || "platform"}|${email}`;
    const adminInvites = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.inviteAdmin.scope, key: adminKey, windowMs: RATE_LIMITS.inviteAdmin.windowMs })
    );
    const recipientInvites = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.inviteRecipient.scope, key: recipientKey, windowMs: RATE_LIMITS.inviteRecipient.windowMs })
    );
    if (adminInvites.count > RATE_LIMITS.inviteAdmin.limit || recipientInvites.count > RATE_LIMITS.inviteRecipient.limit) {
      return tooMany(res, Math.max(adminInvites.resetAt, recipientInvites.resetAt));
    }
    if (existing) {
      if (tenantId && !existing.tenant_id) {
        await database.collection("User").updateOne(
          { _id: existing._id },
          { $set: { tenant_id: tenantId, app_roles: roles, app_role: role, updated_date: new Date().toISOString() } }
        );
      }
      await logServerAudit(req, {
        action: "invite",
        entity_type: "User",
        entity_id: existing._id.toString(),
        details: `${email} (${role})`,
      });
      return res.json({ message: "User updated/invited." });
    }
    const now = new Date().toISOString();
    const inserted = await database.collection("User").insertOne({
      email,
      full_name: email.split("@")[0],
      role: "user",
      // Canonical set plus the primary-role mirror, written together.
      app_role: role,
      app_roles: roles,
      tenant_id: tenantId,
      invited: true,
      invite_role: role,
      // Invited by a verified administrator inside the product. The invite
      // channel is the trust relationship, not the mailbox, so requiring the
      // invitee to prove the address would lock out staff an administrator has
      // already vouched for. Verified by construction.
      email_verified: true,
      created_date: now,
      updated_date: now,
    });
    await logServerAudit(req, {
      action: "invite",
      entity_type: "User",
      entity_id: inserted.insertedId.toString(),
      details: `${email} (${role})`,
    });
    res.json({ success: true });
  })
);

// Data Extraction Integration
app.post(
  "/api/integrations/extract",
  auth,
  route(async (req, res) => {
    // Parsing a roster file is staff work: it reads a tenant CSV/XLSX and
    // returns structured student records. Authentication alone let a student or
    // parent drive the parser over their own institution's data, so the role is
    // checked here rather than relying on the file being tenant-scoped.
    if (!canExtractRoster(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { file_url } = req.body || {};
    if (!file_url) return res.status(400).json({ error: "file_url is required" });

    let students = [];
    let filePath = null;
    let s3Key = null;

    if (typeof file_url !== "string") {
      return res.status(400).json({ error: "Invalid file_url" });
    }
    const pathOnly = file_url.split("?")[0];

    if (s3.getStorage().mode === "s3" && pathOnly.startsWith("/api/files/")) {
      // S3 path: resolve the tenant-scoped object for this authenticated user.
      const filename = path.basename(pathOnly);
      if (!STORED_FILE_RE.test(filename)) {
        return res.status(400).json({ error: "Invalid file_url" });
      }
      if (platform(req)) {
        const found = (await s3.listKeys("private/", { limit: 2000 })).find((k) => k.endsWith(`/${filename}`));
        if (found) s3Key = found;
      } else {
        const candidate = s3.privateKey(req.user?.tenant_id || "__none__", filename);
        if (await s3.objectExists(candidate)) s3Key = candidate;
      }
    } else if (pathOnly.startsWith("/api/files/")) {
      const filename = path.basename(pathOnly);
      if (!STORED_FILE_RE.test(filename)) {
        return res.status(400).json({ error: "Invalid file_url" });
      }
      if (platform(req)) {
        let candidate = path.join(privateUploadsDir, "platform", filename);
        if (!fs.existsSync(candidate)) {
          let tenants = [];
          try {
            tenants = fs.readdirSync(privateUploadsDir);
          } catch {}
          for (const tid of tenants) {
            const checkPath = path.join(privateUploadsDir, tid, filename);
            if (fs.existsSync(checkPath)) {
              candidate = checkPath;
              break;
            }
          }
        }
        filePath = candidate;
      } else {
        filePath = path.join(privateUploadsDir, req.user?.tenant_id || "__none__", filename);
      }
    } else if (pathOnly.startsWith("/uploads/") || pathOnly.startsWith("/api/uploads/")) {
      const filename = path.basename(pathOnly);
      filePath = path.join(uploadsDir, filename);
    }

    if (filePath) {
      try {
        filePath = safeResolveUnder(uploadsDir, filePath);
      } catch {
        return res.status(400).json({ error: "Invalid file_url" });
      }
    }

    let content = null;
    if (s3Key) {
      try {
        content = (await s3.getObjectBuffer(s3Key)).toString("utf-8");
      } catch {
        /* fall through with content=null */
      }
    } else if (filePath && fs.existsSync(filePath)) {
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        /* fall through with content=null */
      }
    }

    if (content) {
      try {
        const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length > 1) {
          const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
            const row = {};
            headers.forEach((h, idx) => {
              const val = cols[idx] || "";
              if (h.includes("class")) row.class_name = val;
              else if (h.includes("name") && !h.includes("parent")) row.full_name = val;
              else if (h.includes("admission") || h.includes("adm")) row.admission_number = val;
              else if (h.includes("roll")) row.roll_number = val;
              else if (h.includes("sec")) row.section = val;
              else if (h.includes("gender")) row.gender = val;
              else if (h.includes("student_email") || (h.includes("email") && !h.includes("parent"))) row.student_email = val;
              else if (h.includes("student_phone") || (h.includes("phone") && !h.includes("parent"))) row.student_phone = val;
              else if (h.includes("parent_name") || h.includes("father") || h.includes("mother")) row.parent_name = val;
              else if (h.includes("parent_email")) row.parent_email = val;
              else if (h.includes("parent_phone")) row.parent_phone = val;
            });
            if (row.full_name) {
              students.push(row);
            }
          }
        }
      } catch (err) {
        console.warn("CSV parse warning:", err);
      }
    }

    // Default sample if no rows parsed
    if (students.length === 0) {
      students = [
        { full_name: "Aarav Patel", admission_number: "ADM-101", roll_number: "01", class_name: "Class 10", section: "A", gender: "Male", student_email: "aarav@school.test", parent_name: "Rajesh Patel", parent_email: "rajesh@school.test", parent_phone: "+91 9876543210" },
        { full_name: "Ananya Sharma", admission_number: "ADM-102", roll_number: "02", class_name: "Class 10", section: "A", gender: "Female", student_email: "ananya@school.test", parent_name: "Vikram Sharma", parent_email: "vikram@school.test", parent_phone: "+91 9876543211" },
        { full_name: "Rohan Gupta", admission_number: "ADM-103", roll_number: "03", class_name: "Class 10", section: "B", gender: "Male", student_email: "rohan@school.test", parent_name: "Sanjay Gupta", parent_email: "sanjay@school.test", parent_phone: "+91 9876543212" },
      ];
    }

    res.json({
      status: "success",
      output: { students },
    });
  })
);

app.post("/api/integrations/:name", auth, (_req, res) => res.json({ status: "success", output: {} }));

// Atomic Academic Structure Provisioning (Large School Setup Wizard)
app.post(
  "/api/functions/setupAcademicStructure",
  auth,
  route(async (req, res) => {
    try {
      const result = await setupAcademicStructure({ user: req.user, payload: req.body });
      return res.json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || "Failed to setup academic structure" });
    }
  })
);

// Atomic Batch Attendance Save
app.post(
  "/api/functions/saveBatchAttendance",
  auth,
  route(async (req, res) => {
    try {
      const result = await saveBatchAttendance({ user: req.user, payload: req.body });
      return res.json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || "Failed to save batch attendance" });
    }
  })
);

// Attendance History Aggregation (3-State Marked / Partially Marked / Unmarked)
app.post(
  "/api/functions/getAttendanceHistory",
  auth,
  route(async (req, res) => {
    try {
      const result = await getAttendanceHistory({ user: req.user, payload: req.body });
      return res.json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || "Failed to load attendance history" });
    }
  })
);

// Exam Attendance: categorized roster (present / absent / needs_review / unmarked)
app.post(
  "/api/functions/getExamAttendance",
  auth,
  route(async (req, res) => {
    try {
      if (!examWorkflow(req)) return res.status(403).json({ error: "Insufficient permissions for exam attendance" });
      const { examination_id } = req.body || {};
      if (!examination_id) return res.status(400).json({ error: "examination_id is required" });
      const result = await getExamAttendance({ examination_id, user: req.user });
      return res.json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || "Failed to load exam attendance" });
    }
  })
);

// Reconcile exam absentees — flips only strictly unmarked students to absent
app.post(
  "/api/functions/reconcileExamAbsentees",
  auth,
  route(async (req, res) => {
    try {
      if (!examWorkflow(req)) return res.status(403).json({ error: "Insufficient permissions for exam attendance" });
      const { examination_id } = req.body || {};
      if (!examination_id) return res.status(400).json({ error: "examination_id is required" });
      const result = await reconcileExamAbsentees({ examination_id, user: req.user });
      return res.json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message || "Failed to reconcile exam absentees" });
    }
  })
);

// ============================================================================
// LEAD MANAGEMENT — Super Admin only
// ----------------------------------------------------------------------------
// The public LeadForm stays the sole source of inquiry data; this block adds the
// secure operational layer on top. Every route except the two WhatsApp webhook
// endpoints enforces requireSuperAdmin server-side. Recipients for outbound
// email are always derived from the stored lead, never from the client.

const parseLeadId = (raw) => {
  const id = String(raw || "");
  if (!ObjectId.isValid(id)) throw Object.assign(new Error("Invalid lead ID"), { statusCode: 400 });
  return new ObjectId(id);
};

// List leads with server-side search / type / status filters, pagination and
// head-line statistics.
app.get(
  "/api/leads",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const coll = database.collection("Lead");
    const { search, type, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const filters = {};
    if (type === "demo" || type === "contact") filters.type = type;
    if (status === "new" || status === "contacted" || status === "closed") filters.status = status;
    if (search && String(search).trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filters.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { organization: { $regex: q, $options: "i" } },
      ];
    }

    const statsDocs = await Promise.all([
      coll.countDocuments({}),
      coll.countDocuments({ status: "new" }),
      coll.countDocuments({ type: "demo" }),
      coll.countDocuments({ type: "contact" }),
    ]);
    const [total, docs] = await Promise.all([
      coll.countDocuments(filters),
      coll
        .find(filters)
        .sort({ created_date: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    return res.json({
      data: docs.map((doc) => present("Lead", doc, req)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      limit: pageSize,
      stats: { total: statsDocs[0], new: statsDocs[1], demo: statsDocs[2], contact: statsDocs[3] },
    });
  })
);

// Manual email to a lead. Recipient is server-forced to the stored lead.email;
// the client can never redirect the message to an arbitrary address.
// Accepts JSON ({ subject, message }) or multipart/form-data with an optional
// "attachments" file field (multiple files, max 10). Message is HTML from the
// rich-text composer; a stripped plain-text version is sent alongside.
const stripHtmlToText = (html) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Lead merge-field tags ({{name}}, {{email}}, {{organization}}, {{phone}},
// {{message}}, {{created_date}}) are replaced server-side before sending. Lead-
// provided values (e.g. the enquiry message) are HTML-escaped when they land in
// an HTML body so a visitor can never inject markup/scripts into the outgoing
// template. Unknown tags are left untouched for the template author.
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const LEAD_TOKEN_PATTERN = /\{\{\s*(name|email|organization|phone|message|created_date)\s*\}\}/g;

const leadTokenValues = (lead, html = true) => {
  const pick = (v) => (html ? escapeHtml(v) : String(v ?? ""));
  return {
    name: pick(lead.name),
    email: pick(lead.email),
    organization: pick(lead.organization),
    phone: pick(lead.phone),
    message: pick(lead.message),
    created_date: lead.created_date
      ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(lead.created_date))
      : "",
  };
};

const mergeLeadTokens = (input, lead, html = true) => {
  const values = leadTokenValues(lead, html);
  return String(input || "").replace(LEAD_TOKEN_PATTERN, (_, key) => values[key] ?? "");
};

app.post(
  "/api/leads/:id/email",
  requireSuperAdmin,
  upload.array("attachments", 10),
  route(async (req, res) => {
    const database = await db();
    const id = parseLeadId(req.params.id);
    const lead = await database.collection("Lead").findOne({ _id: id });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const subject = mergeLeadTokens(String(req.body?.subject || "").trim(), lead, false);
    const message = mergeLeadTokens(String(req.body?.message || "").trim(), lead, true);
    const plainText = stripHtmlToText(message);
    if (!subject) return res.status(400).json({ error: "Subject is required" });
    if (!plainText) return res.status(400).json({ error: "Message is required" });
    if (!lead.email) return res.status(400).json({ error: "This lead has no email address on file" });

    const attachments = (req.files || []).map((f) => ({
      filename: f.originalname || "attachment",
      content: f.buffer,
      contentType: f.mimetype || "application/octet-stream",
    }));

    const limiter = await runLimit(() =>
      rateStore.incr({
        scope: RATE_LIMITS.leadEmail.scope,
        key: `admin:${req.user._id}`,
        windowMs: RATE_LIMITS.leadEmail.windowMs,
      })
    );
    if (limiter.count > RATE_LIMITS.leadEmail.limit) return tooMany(res, limiter.resetAt);

    const result = await sendEmail({
      to: lead.email,
      subject,
      text: plainText,
      html: message || undefined,
      attachments,
    });
    if (!result.ok) {
      await recordMessage({ lead_id: id, channel: "email", direction: "outbound", subject, message: plainText, status: "failed", error: result.error });
      const code = result.error === "Email is not configured" ? 503 : 502;
      return res.status(code).json({ error: result.error });
    }
    const comm = await recordMessage({
      lead_id: id,
      channel: "email",
      direction: "outbound",
      subject,
      message: plainText,
      html_content: message || undefined,
      attachments: attachments.map((a) => ({ filename: a.filename, size: Buffer.byteLength(a.content), contentType: a.contentType })),
      status: "sent",
      external_message_id: result.messageId,
    });
    await logServerAudit(req, { action: "email_sent", entity_type: "Lead", entity_id: id.toString(), details: `Email to ${lead.email}` });
    return res.json({ success: true, communication: comm.doc ? out(comm.doc) : { status: "sent" } });
  })
);

app.get(
  "/api/leads/:id/email-history",
  requireSuperAdmin,
  route(async (req, res) => {
    const id = parseLeadId(req.params.id);
    const emails = await listMessages({ lead_id: id, channel: "email" });
    return res.json({ emails });
  })
);

// WhatsApp conversation for a lead (inbound from webhook, outbound from admin).
app.get(
  "/api/leads/:id/whatsapp",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const id = parseLeadId(req.params.id);
    const lead = await database.collection("Lead").findOne({ _id: id }, { projection: { phone: 1 } });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const [config, messages] = await Promise.all([
      getEffectiveWhatsAppConfig(),
      listMessages({ lead_id: id, channel: "whatsapp" }),
    ]);
    return res.json({ configured: isWhatsAppConfigured(config), lead_phone: lead.phone || "", messages });
  })
);

// Manual WhatsApp message to a lead. Accepts exactly one kind:
//   { message }                             -> free-form text (24h window)
//   { template_name }                       -> approved template (any time)
//   { body, buttons, header?, footer? }     -> interactive reply buttons (24h)
//   { body, sections, button?, header?, footer? } -> interactive list (24h)
//   { body, url, button_text?, header?, footer? } -> interactive CTA (24h)
app.post(
  "/api/leads/:id/whatsapp/messages",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const id = parseLeadId(req.params.id);
    const lead = await database.collection("Lead").findOne({ _id: id }, { projection: { phone: 1, name: 1 } });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.phone) return res.status(400).json({ error: "Phone number not provided for this lead." });

    const config = await getEffectiveWhatsAppConfig();
    if (!isWhatsAppConfigured(config)) return res.status(503).json({ error: "WhatsApp is not configured." });

    const body = req.body || {};
    const message = String(body.message || "").trim();
    const templateName = String(body.template_name || "").trim();
    const ctaBody = String(body.body || "").trim();
    const buttons = Array.isArray(body.buttons) ? body.buttons : [];
    const sections = Array.isArray(body.sections) ? body.sections : [];
    const contactName = buildContactName(lead.name);
    const kinds = [Boolean(message), Boolean(templateName), Boolean(String(body.url || "").trim() && ctaBody), buttons.length > 0, sections.length > 0].filter(Boolean).length;
    if (kinds !== 1) {
      return res.status(400).json({ error: "Provide exactly one message kind (text, template, buttons, list, or CTA)" });
    }
    if (message.length > 1000) return res.status(400).json({ error: "Message is too long (max 1000 characters)" });

    const limiter = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.leadWhatsapp.scope, key: `admin:${req.user._id}`, windowMs: RATE_LIMITS.leadWhatsapp.windowMs })
    );
    if (limiter.count > RATE_LIMITS.leadWhatsapp.limit) return tooMany(res, limiter.resetAt);

    let kind = "text";
    let result;
    let summary = message;
    if (templateName) {
      kind = "template";
      summary = `[Template] ${templateName}`;
      result = await sendWhatsAppTemplate({ to: lead.phone, templateName, contactName });
    } else if (buttons.length > 0) {
      kind = "buttons";
      const titles = buttons.map((b) => String(b?.title ?? b ?? "").trim()).filter(Boolean);
      summary = `${ctaBody}\n[${titles.join(" | ")}]`;
      result = await sendInteractiveButtons({ to: lead.phone, body: body.body, buttons: titles, header: body.header, footer: body.footer, contactName });
    } else if (sections.length > 0) {
      kind = "list";
      summary = `${ctaBody}\n${sections.map((s) => `- ${String(s?.title || "").trim()}: ${(s?.rows || []).map((r) => r?.title).filter(Boolean).join(", ")}`).join("\n")}`;
      result = await sendInteractiveList({ to: lead.phone, body: body.body, sections, button: body.button, header: body.header, footer: body.footer, contactName });
    } else if (String(body.url || "").trim()) {
      kind = "cta";
      summary = `${ctaBody}\n(${String(body.url).trim()})`;
      result = await sendInteractiveCta({ to: lead.phone, body: body.body, url: body.url, buttonText: body.button_text, header: body.header, footer: body.footer, contactName });
    } else {
      result = await sendWhatsAppMessage({ to: lead.phone, text: message, contactName });
    }

    const recordMeta = { lead_id: id, channel: "whatsapp", direction: "outbound", msg_type: kind, message: summary.slice(0, 1000) };
    if (kind === "template") recordMeta.template_name = templateName;

    if (!result.ok) {
      await recordMessage({ ...recordMeta, status: "failed", error: result.error });
      return res.status(502).json({ error: result.error });
    }
    const comm = await recordMessage({
      ...recordMeta,
      status: "sent",
      external_message_id: result.messageId,
      provider_message_id: result.messageId,
    });
    await logServerAudit(req, { action: "whatsapp_sent", entity_type: "Lead", entity_id: id.toString(), details: `${kind} to ${lead.phone}` });
    return res.json({ success: true, message: comm.doc ? out(comm.doc) : { status: "sent" } });
  })
);

// Approved WhatsApp templates for the composer picker (Super Admin only).
app.get(
  "/api/leads/:id/whatsapp/templates",
  requireSuperAdmin,
  route(async (req, res) => {
    const config = await getEffectiveWhatsAppConfig();
    if (!isWhatsAppConfigured(config)) return res.status(503).json({ error: "WhatsApp is not configured." });
    const result = await listWhatsAppTemplates();
    if (!result.ok) return res.status(502).json({ error: result.error });
    return res.json({ templates: result.templates });
  })
);

// Free-form WhatsApp media (image / video / document / audio, 24h window).
// Two input paths: a multipart file upload (stored in our public uploads so
// Avexwa can fetch the resulting URL) or a { media_url } + optional caption
// JSON body for external / locally-untestable URLs.
const WHATSAPP_MIME_MEDIA = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/3gpp": "video",
  "video/3gp": "video",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/amr": "audio",
  "audio/ogg": "audio",
  "audio/opus": "audio",
  "text/plain": "document",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
};
const WHATSAPP_MEDIA_SIZE_LIMITS = { image: 5, video: 16, audio: 16, document: 50 }; // MB
const WHATSAPP_EXT_FALLBACK = { image: ".jpg", video: ".mp4", audio: ".m4a", document: ".pdf" };

app.post(
  "/api/leads/:id/whatsapp/media",
  requireSuperAdmin,
  upload.single("file"),
  route(async (req, res) => {
    const database = await db();
    const id = parseLeadId(req.params.id);
    const lead = await database.collection("Lead").findOne({ _id: id }, { projection: { phone: 1, name: 1 } });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.phone) return res.status(400).json({ error: "Phone number not provided for this lead." });

    const config = await getEffectiveWhatsAppConfig();
    if (!isWhatsAppConfigured(config)) return res.status(503).json({ error: "WhatsApp is not configured." });

    const limiter = await runLimit(() =>
      rateStore.incr({ scope: RATE_LIMITS.leadWhatsapp.scope, key: `admin:${req.user._id}`, windowMs: RATE_LIMITS.leadWhatsapp.windowMs })
    );
    if (limiter.count > RATE_LIMITS.leadWhatsapp.limit) return tooMany(res, limiter.resetAt);

    const caption = String(req.body?.caption || "").trim().slice(0, 500);
    let mediaType = "";
    let mediaUrl = "";
    let storedName = "";

    if (req.file) {
      const file = req.file;
      mediaType = WHATSAPP_MIME_MEDIA[(file.mimetype || "").toLowerCase()] || "";
      if (!mediaType) {
        return res.status(400).json({ error: "Unsupported media type. Use a jpeg/png/webp image, mp4/3gp video, pdf/office document, or supported audio." });
      }
      const sizeCap = (WHATSAPP_MEDIA_SIZE_LIMITS[mediaType] || 50) * 1024 * 1024;
      if (file.size > sizeCap) {
        return res.status(400).json({ error: `File exceeds the ${sizeCap / (1024 * 1024)}MB limit for ${mediaType} media` });
      }
      const ext = path.extname(file.originalname || "").toLowerCase() || WHATSAPP_EXT_FALLBACK[mediaType];
      storedName = `${crypto.randomUUID()}${ext}`;
      if (s3.getStorage().mode === "s3") {
        await s3.putObject({ Key: s3.publicKey(storedName), Body: file.buffer, ContentType: file.mimetype || "application/octet-stream" });
      } else {
        fs.writeFileSync(path.join(publicUploadsDir, storedName), file.buffer);
      }
      const publicBase = String(process.env.LEAD_MANAGEMENT_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      mediaUrl = `${publicBase}/api/public/uploads/${storedName}`;
    } else {
      mediaType = String(req.body?.media_type || "").trim().toLowerCase();
      mediaUrl = String(req.body?.media_url || "").trim();
    }

    if (!["image", "video", "document", "audio"].includes(mediaType)) {
      return res.status(400).json({ error: "Media type must be image, video, document or audio" });
    }
    if (!mediaUrl) return res.status(400).json({ error: "Media URL is required" });

    const result = await sendWhatsAppMedia({ to: lead.phone, mediaType, url: mediaUrl, caption, contactName: buildContactName(lead.name) });
    const recordMeta = { lead_id: id, channel: "whatsapp", direction: "outbound", msg_type: mediaType, media_url: mediaUrl };
    if (caption) recordMeta.caption = caption;

    if (!result.ok) {
      await recordMessage({ ...recordMeta, message: caption || `[${mediaType}]`, status: "failed", error: result.error });
      return res.status(502).json({ error: result.error });
    }
    const comm = await recordMessage({
      ...recordMeta,
      message: caption || `[${mediaType}]`,
      status: "sent",
      external_message_id: result.messageId,
      provider_message_id: result.messageId,
    });
    await logServerAudit(req, { action: "whatsapp_sent", entity_type: "Lead", entity_id: id.toString(), details: `media ${mediaType} to ${lead.phone}` });
    return res.json({ success: true, message: comm.doc ? out(comm.doc) : { status: "sent" } });
  })
);

// Notification settings (toggles + recipient lists; no provider secrets).
app.get(
  "/api/lead-settings",
  requireSuperAdmin,
  route(async (req, res) => {
    const [settings, capabilities] = await Promise.all([getLeadSettings(), getNotificationCapabilities()]);
    return res.json({ settings, capabilities });
  })
);

app.put(
  "/api/lead-settings",
  requireSuperAdmin,
  route(async (req, res) => {
    const parsed = parseLeadSettingsBody(req.body || {});
    const settings = await saveLeadSettings({ ...parsed, updated_by: req.user?.email || "super_admin" });
    const capabilities = await getNotificationCapabilities();
    await logServerAudit(req, {
      action: "lead_settings_updated",
      entity_type: "Lead",
      entity_id: "",
      details: `Email:${parsed.email_notifications.enabled} WhatsApp:${parsed.whatsapp_notifications.enabled}`,
    });
    return res.json({ settings, capabilities });
  })
);

// Encrypted Connection Settings (SMTP + WhatsApp credentials, masked in responses).
app.get(
  "/api/integration-settings",
  requireSuperAdmin,
  route(async (req, res) => {
    const settings = await getMaskedIntegrationSettings();
    return res.json({ settings, encryption_available: encryptionAvailable() });
  })
);

app.put(
  "/api/integration-settings",
  requireSuperAdmin,
  route(async (req, res) => {
    const smtpIn = req.body?.smtp || {};
    const waIn = req.body?.whatsapp || {};
    if (!encryptionAvailable() && (Boolean(String(smtpIn.pass || "").trim()) || Boolean(String(waIn.token || "").trim()))) {
      return res.status(503).json({ error: "SETTINGS_ENC_KEY is not configured; cannot store provider secrets" });
    }
    const settings = await saveIntegrationSettings({
      smtp: smtpIn,
      whatsapp: waIn,
      updated_by: req.user?.email || "super_admin",
    });
    await logServerAudit(req, { action: "integration_settings_updated", entity_type: "Lead", entity_id: "", details: "Connection settings saved" });
    return res.json({ settings, encryption_available: encryptionAvailable() });
  })
);

// WhatsApp webhooks (public by necessity; the operator registers this URL with
// Avexwa, which POSTs JSON events here). Authenticity is enforced by requiring
// a ?secret= query token matching the env-only WHATSAPP_WEBHOOK_SECRET — the
// URL, including that token, is what the operator hands to Avexwa. Fail-closed:
// if the secret is not configured, webhooks are rejected.
app.post("/api/webhooks/whatsapp", async (req, res) => {
  try {
    const secret = (process.env.WHATSAPP_WEBHOOK_SECRET || "").trim();
    if (!secret || req.query.secret !== secret) {
      return res.status(401).json({ error: "Invalid webhook token" });
    }
    const outcome = await ingestInboundWhatsApp(req.body || {});
    // Always acknowledge receipt (fast 200) so Avexwa stops retrying; unknown
    // senders and duplicates are dropped inside the ingester.
    return res.status(200).json({ received: true, ...outcome });
  } catch (err) {
    console.warn("WhatsApp webhook ingest error:", err?.message || err);
    return res.status(200).json({ received: true });
  }
});

// Ceiling on how many students one provisionStudentLogins call may touch. The
// work per student includes a bcrypt hash (~tens of milliseconds) and several
// sequential lookups, so a whole-tenant run in a single request would hold a
// connection open long enough to time out. The client chunks by the ids a dry
// run returns, which also gives it something to report progress against.
const PROVISION_LOGIN_CHUNK_MAX = 500;

// --- Affiliate programme (super admin surface) ---------------------------------
//
// Bespoke routes rather than generic entity CRUD for the same reason Lead
// Management is: every one of these either aggregates across collections,
// enforces a privilege write, or moves money, and the generic path can do none
// of those safely. ENTITY_WRITE_ROLES keeps Affiliate and AffiliateSale
// super-admin-only anyway, but the generic endpoint would still accept an
// arbitrary field map, and `commission_rate` is exactly the kind of field that
// must not be settable by a body that was never validated.

// Password for a newly appointed reseller. Generated server-side with
// crypto.randomBytes because it is a credential for an account that can mint
// institutions, and Math.random() in the browser (as CreateAdminDialog still
// does) is not a source for that. Rendered once to the super admin and never
// stored in plaintext, so it cannot be read back off the profile.
const generateAffiliatePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  const bytes = crypto.randomBytes(14);
  let password = "";
  for (let i = 0; i < bytes.length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
};

const AFFILIATE_CODE_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The fields a super admin may change on an existing affiliate, and the only
// fields they may change. Anything else is refused by name rather than ignored:
// a silently dropped field is how a client ends up believing it saved something
// it did not, which is the same class of defect as the flat-update guard below.
const AFFILIATE_EDITABLE_FIELDS = new Set(["full_name", "phone", "code", "commission_rate", "status", "notes"]);

// The reminder configuration an affiliate or a super admin may set on a profile.
//
// Kept apart from AFFILIATE_EDITABLE_FIELDS on purpose: that list is the super-admin
// PATCH /api/affiliates/:id allowlist and includes `commission_rate`, which decides
// what the platform owes and is deliberately NOT settable from this list. Money and
// message wording are different powers and are gated differently.
const AFFILIATE_REMINDER_EDITABLE_FIELDS = new Set([
  "reminder_channels",
  "reminder_lead_days",
  "reminder_email_subject",
  "reminder_email_template",
  "reminder_whatsapp_template_name",
  "reminder_pay_link",
  // Present in the list so that an affiliate ATTEMPTING it gets an explicit refusal
  // rather than a field silently ignored — see the commission_mode guard in the route.
  "commission_mode",
]);

const normalizeAffiliateCode = (value) => {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!code) return { ok: true, code: null };
  if (!AFFILIATE_CODE_PATTERN.test(code)) {
    return { ok: false, error: "Referral code must be 3-24 characters using letters, numbers, dash or underscore" };
  }
  return { ok: true, code };
};

// Every figure both the admin page and the portal show is derived from the sale
// ledger at read time. Nothing is stored on the profile, so a voided or corrected
// sale cannot leave a stale counter behind.
const affiliateSummariesById = async (database) => {
  const rows = await database.collection("AffiliateSale").aggregate([
    {
      $group: {
        _id: "$affiliate_id",
        sales_count: { $sum: 1 },
        earned: { $sum: "$commission_amount" },
        approved: {
          $sum: { $cond: [{ $eq: ["$status", "approved"] }, "$commission_amount", 0] },
        },
        paid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$commission_amount", 0] } },
      },
    },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, row]));
};

// Either the platform owner or a reseller.
//
// This admits the ROLE; it does not grant access to a particular affiliate. Which
// profile a request may act on is decided by loadAffiliateForActor() below, from the
// session rather than from the id in the path — a middleware cannot do that, because
// the id it would have to trust is the one thing an affiliate must not be able to
// choose.
const requireSuperAdminOrAffiliate = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!superAdmin(req) && !canSellAsAffiliate(req)) return res.status(403).json({ error: "Forbidden" });
  next();
};

// Resolve the Affiliate a request may act on.
//
// A super admin may name any affiliate. An affiliate may only ever act on their own,
// and "their own" is derived from req.user's own Affiliate profile — the id in the
// path is only ever COMPARED, never trusted. Both a profile that does not exist and a
// profile belonging to somebody else return null, so every route below answers 404 for
// both: a reseller must not be able to learn that another reseller's id is real by
// watching for a 403 instead of a 404.
const loadAffiliateForActor = async (database, req, affiliateId) => {
  const id = String(affiliateId || "");
  if (!ObjectId.isValid(id)) return null;
  const doc = await database.collection("Affiliate").findOne({ _id: new ObjectId(id) });
  if (!doc) return null;
  if (!superAdmin(req)) {
    const own = await database.collection("Affiliate").findOne({ user_id: req.user._id.toString() });
    if (!own || String(own._id) !== String(doc._id)) return null;
  }
  return doc;
};

// The reminder policy as both pages read it.
//
// Defaults are applied at READ time, not only at save time, because a profile created
// before this feature existed has none of these fields and must still behave like one
// configured with the defaults. Without this an older profile would render an empty
// channel list, which reads as "this affiliate has reminders switched off" — the
// opposite of the truth, and the kind of quiet difference nobody would report.
const asListOr = (value, fallback) => (Array.isArray(value) ? value : fallback);

const affiliateReminderSettings = (affiliate) => ({
  // Money. Super-admin policy, surfaced here for rendering but only writable by them.
  commission_mode: normalizeCommissionMode(affiliate?.commission_mode),
  // An EXPLICIT empty array is respected (an affiliate who wants automatic reminders
  // off but manual sends still available), while an absent field falls back to the
  // defaults. These are different intentions and must not be collapsed into one.
  reminder_channels: normalizeChannels(asListOr(affiliate?.reminder_channels, ["email"])),
  reminder_lead_days: normalizeLeadDays(asListOr(affiliate?.reminder_lead_days, DEFAULT_LEAD_DAYS)),
  reminder_email_subject: String(affiliate?.reminder_email_subject || ""),
  reminder_email_template: String(affiliate?.reminder_email_template || ""),
  reminder_whatsapp_template_name: String(affiliate?.reminder_whatsapp_template_name || ""),
  reminder_pay_link: String(affiliate?.reminder_pay_link || ""),
});

// A subscription as the pages consume it.
//
// The stored fields are the truth; `days_until_due` is derived at read time so the
// "3 days left" badge cannot go stale between renders, and is not stored because a
// stored countdown is wrong within a day of being written.
const presentSubscription = (doc, req) => {
  if (!doc) return doc;
  const period = computePeriod(doc);
  return {
    ...present("Subscription", doc, req),
    next_due_at: doc.next_due_at || period?.nextDueAt || null,
    days_until_due: doc.next_due_at ? daysUntilDue(doc.next_due_at, new Date().toISOString()) : null,
  };
};

// Load one subscription that the given affiliate profile owns.
//
// Scoped on affiliate_id in the query itself rather than filtered afterwards: a
// subscription belonging to a different affiliate must never be loaded into memory at
// all, so that no code path downstream can accidentally render or send from it.
const loadOwnedSubscription = async (database, affiliate, subscriptionId) => {
  const id = String(subscriptionId || "");
  if (!ObjectId.isValid(id)) return null;
  return database.collection("Subscription").findOne({
    _id: new ObjectId(id),
    affiliate_id: String(affiliate._id),
  });
};

// List affiliates with server-side search / status filter, pagination and
// head-line statistics.
app.get(
  "/api/affiliates",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const coll = database.collection("Affiliate");
    const { search, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const filters = {};
    if (status === "active" || status === "suspended") filters.status = status;
    if (search && String(search).trim()) {
      const q = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filters.$or = [
        { full_name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { code: { $regex: q, $options: "i" } },
      ];
    }

    const [summaries, allAffiliates] = await Promise.all([
      affiliateSummariesById(database),
      coll.find(filters).sort({ created_date: -1 }).toArray(),
    ]);

    // Month-to-date is bucketed in JS rather than with a date expression because
    // created_date is an ISO STRING, not a BSON date (the schema convention
    // across this codebase), so $dateFromString would be the only way to filter
    // it in the database and the row set is already in hand.
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartIso = monthStart.toISOString();
    const salesThisMonth = await database.collection("AffiliateSale").countDocuments({
      created_date: { $gte: monthStartIso },
    });

    const rows = allAffiliates.map((affiliate) => {
      const summary = summaries.get(affiliate._id.toString());
      return {
        ...present("Affiliate", affiliate, req),
        ...affiliateReminderSettings(affiliate),
        sales_count: summary?.sales_count || 0,
        earned: summary?.earned || 0,
        approved: summary?.approved || 0,
        paid: summary?.paid || 0,
      };
    });
    const ordered = rows.slice((page - 1) * pageSize, page * pageSize);

    // Renewal health, computed with indexed range queries on the denormalised
    // next_due_at rather than by loading the subscriptions and filtering in JS.
    const nowIso = new Date().toISOString();
    const inSevenDaysIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const subscriptionStats = await database.collection("Subscription").aggregate([
      {
        $match: {
          status: "active",
          next_due_at: { $ne: null, $exists: true },
        },
      },
      {
        $group: {
          _id: null,
          active: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $lt: ["$next_due_at", nowIso] }, 1, 0] } },
          due_this_week: {
            $sum: { $cond: [{ $and: [{ $gte: ["$next_due_at", nowIso] }, { $lte: ["$next_due_at", inSevenDaysIso] }] }, 1, 0] },
          },
        },
      },
    ]).toArray();

    return res.json({
      data: ordered,
      total: rows.length,
      page,
      pages: Math.max(1, Math.ceil(rows.length / pageSize)),
      limit: pageSize,
      stats: {
        total: await coll.countDocuments({}),
        active: await coll.countDocuments({ status: "active" }),
        sales_this_month: salesThisMonth,
        // What the platform owes across every affiliate right now: approved and
        // paid both count as settled, so this is the approved-but-unsent figure.
        payable: rollupSummaries(rows).payable,
        // Defaults to zero when the collection is empty, so a fresh install shows
        // 0 rather than nulls in the stat row.
        subscriptions: subscriptionStats[0]?.active || 0,
        overdue: subscriptionStats[0]?.overdue || 0,
        due_this_week: subscriptionStats[0]?.due_this_week || 0,
      },
    });
  })
);

// Appoint a reseller: the login AND the profile are created together, or neither
// is. The password is generated here with crypto.randomBytes rather than in the
// browser, and returned exactly once.
app.post(
  "/api/affiliates",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const body = req.body || {};

    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: "A valid email is required" });

    const fullName = String(body.full_name || "").trim();
    if (!fullName) return res.status(400).json({ error: "Full name is required" });

    const rate = normalizeCommissionRate(body.commission_rate ?? 0);
    if (rate === null) return res.status(400).json({ error: "Commission rate must be a whole number between 0 and 100" });

    const status = body.status === "suspended" ? "suspended" : "active";

    const codeResult = normalizeAffiliateCode(body.code);
    if (!codeResult.ok) return res.status(400).json({ error: codeResult.error });
    if (codeResult.code) {
      const taken = await database.collection("Affiliate").findOne({ code: codeResult.code });
      if (taken) return res.status(409).json({ error: "That referral code is already in use" });
    }

    const existingUser = await database.collection("User").findOne({ email });
    if (existingUser) return res.status(409).json({ error: "Email already in use" });

    // canProvisionRoleSet, not a literal check: this mints a credential, so it is
    // governed by the same delegation matrix as every other account creation.
    const provision = canProvisionRoleSet(rolesOf(req), [APP_ROLES.AFFILIATE]);
    if (provision.error) return res.status(403).json({ error: provision.error });

    const now = new Date().toISOString();
    const password = generateAffiliatePassword();
    const passwordHash = await bcrypt.hash(password, 10);

    // The User insert and the Affiliate insert are rolled back against each
    // other. A login with no profile would authenticate and then find no
    // commission record to read; a profile with no login could never be used at
    // all. Neither is a state the operator can repair from the UI.
    let insertedUserId = null;
    try {
      const userResult = await database.collection("User").insertOne({
        email,
        full_name: fullName,
        phone: body.phone ? String(body.phone).trim() : null,
        password_hash: passwordHash,
        role: "user",
        app_role: APP_ROLES.AFFILIATE,
        app_roles: [APP_ROLES.AFFILIATE],
        // No tenant. An affiliate is a platform relationship, and a reseller that
        // belonged to an institution would be one provisionUser() call away from
        // reading that school's students.
        tenant_id: null,
        // Appointed by a verified administrator from inside the product, so the
        // mailbox is proven by the same argument as any provisioned account.
        email_verified: true,
        created_date: now,
        updated_date: now,
      });
      insertedUserId = userResult.insertedId;

      const affiliateResult = await database.collection("Affiliate").insertOne({
        user_id: insertedUserId.toString(),
        full_name: fullName,
        email,
        phone: body.phone ? String(body.phone).trim() : null,
        code: codeResult.code,
        commission_rate: rate,
        status,
        notes: String(body.notes || "").trim().slice(0, 500),
        created_date: now,
        updated_date: now,
      });

      await logServerAudit(req, {
        action: "affiliate_created",
        entity_type: "Affiliate",
        entity_id: affiliateResult.insertedId.toString(),
        details: `${email} at ${rate}%`,
      });

      return res.status(201).json({
        affiliate: present("Affiliate", { ...(await database.collection("Affiliate").findOne({ _id: affiliateResult.insertedId })) }, req),
        // Returned once and never stored in plaintext, so it cannot be read back.
        generated_password: password,
      });
    } catch (err) {
      if (insertedUserId) {
        await database.collection("User").deleteOne({ _id: insertedUserId }).catch(() => {});
      }
      throw err;
    }
  })
);

// Change a reseller's rate, code or status.
//
// An allowlist rather than a $set of the request body: commission_rate decides
// what the platform owes, and a body that could set `user_id` would repoint a
// profile at another person's ledger.
app.patch(
  "/api/affiliates/:id",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(404).json({ error: "Affiliate not found" });

    const affiliate = await database.collection("Affiliate").findOne({ _id: new ObjectId(id) });
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

    const body = req.body || {};
    const refused = Object.keys(body).find((field) => !AFFILIATE_EDITABLE_FIELDS.has(field));
    if (refused) {
      return res.status(400).json({ error: `'${refused}' cannot be changed here` });
    }

    const update = {};
    if (body.full_name !== undefined) {
      const fullName = String(body.full_name).trim();
      if (!fullName) return res.status(400).json({ error: "Full name is required" });
      update.full_name = fullName;
    }
    if (body.phone !== undefined) update.phone = String(body.phone).trim();
    if (body.notes !== undefined) update.notes = String(body.notes).slice(0, 500);
    if (body.status !== undefined) {
      if (body.status !== "active" && body.status !== "suspended") {
        return res.status(400).json({ error: "Status must be active or suspended" });
      }
      update.status = body.status;
    }
    if (body.commission_rate !== undefined) {
      const rate = normalizeCommissionRate(body.commission_rate);
      if (rate === null) return res.status(400).json({ error: "Commission rate must be a whole number between 0 and 100" });
      update.commission_rate = rate;
    }
    if (body.code !== undefined) {
      const codeResult = normalizeAffiliateCode(body.code);
      if (!codeResult.ok) return res.status(400).json({ error: codeResult.error });
      if (codeResult.code && codeResult.code !== affiliate.code) {
        const taken = await database.collection("Affiliate").findOne({ code: codeResult.code, _id: { $ne: affiliate._id } });
        if (taken) return res.status(409).json({ error: "That referral code is already in use" });
      }
      update.code = codeResult.code;
    }

    if (!Object.keys(update).length) {
      return res.json({ affiliate: present("Affiliate", affiliate, req) });
    }

    const now = new Date().toISOString();
    await database.collection("Affiliate").updateOne({ _id: affiliate._id }, { $set: { ...update, updated_date: now } });
    const updated = await database.collection("Affiliate").findOne({ _id: affiliate._id });
    await logServerAudit(req, {
      action: "affiliate_updated",
      entity_type: "Affiliate",
      entity_id: affiliate._id.toString(),
      details: Object.entries(update)
        .filter(([field]) => field !== "updated_date")
        .map(([field, value]) => `${field}=${value}`)
        .join(", ")
        .slice(0, 500),
    });
    return res.json({ affiliate: present("Affiliate", updated, req) });
  })
);

// One reseller's sales, newest first.
app.get(
  "/api/affiliates/:id/sales",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(404).json({ error: "Affiliate not found" });

    const affiliate = await database.collection("Affiliate").findOne({ _id: new ObjectId(id) });
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const [total, docs] = await Promise.all([
      database.collection("AffiliateSale").countDocuments({ affiliate_id: affiliate._id.toString() }),
      database.collection("AffiliateSale")
        .find({ affiliate_id: affiliate._id.toString() })
        .sort({ created_date: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    return res.json({
      data: docs.map((doc) => present("AffiliateSale", doc, req)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      limit: pageSize,
    });
  })
);

// Advance a commission through its lifecycle. One route, because the two steps
// have identical authorization and differ only in which transition they name —
// two routes would be two places to forget the audit event.
app.post(
  "/api/affiliates/:id/sales/:saleId/:action",
  requireSuperAdmin,
  route(async (req, res) => {
    const database = await db();
    const [id, saleId, action] = [String(req.params.id), String(req.params.saleId), String(req.params.action)];
    if (!ObjectId.isValid(id) || !ObjectId.isValid(saleId)) {
      return res.status(404).json({ error: "Affiliate sale not found" });
    }

    const transition = action === "approve" ? "approved" : action === "pay" ? "paid" : null;
    if (!transition) return res.status(404).json({ error: "Unknown affiliate sale action" });

    const affiliate = await database.collection("Affiliate").findOne({ _id: new ObjectId(id) });
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

    const sale = await database.collection("AffiliateSale").findOne({
      _id: new ObjectId(saleId),
      affiliate_id: affiliate._id.toString(),
    });
    if (!sale) return res.status(404).json({ error: "Affiliate sale not found" });

    // The transition table is the authority, not a hand-written inequality: it is
    // what makes "approved cannot be un-approved" and "paid is final" statements
    // rather than an omission someone can fix by accident.
    if (!canTransitionSale(sale.status, transition)) {
      return res.status(409).json({
        error: `A ${sale.status} commission cannot become ${transition}`,
      });
    }

    const now = new Date().toISOString();
    const set = { status: transition, updated_date: now };
    if (transition === "approved") set.approved_date = now;
    if (transition === "paid") {
      set.paid_date = now;
      const note = String(req.body?.note || "").trim().slice(0, 500);
      if (note) set.admin_note = note;
    }

    await database.collection("AffiliateSale").updateOne({ _id: sale._id }, { $set: set });
    const updated = await database.collection("AffiliateSale").findOne({ _id: sale._id });
    await logServerAudit(req, {
      action: transition === "approved" ? "affiliate_commission_approved" : "affiliate_commission_paid",
      entity_type: "AffiliateSale",
      entity_id: sale._id.toString(),
      details: `${affiliate.email} ₹${sale.commission_amount} (${transition})`,
    });
    return res.json({ sale: present("AffiliateSale", updated, req) });
  })
);

// --- Subscription renewal and reminders --------------------------------------
//
// Every route below resolves the acting affiliate with loadAffiliateForActor(), so a
// reseller can only ever reach their own profile and its subscriptions, and the
// platform owner can reach any. Nothing here reads or writes a raw tenant_id from the
// request.

// One affiliate's subscriptions, with the derived due countdown attached.
app.get(
  "/api/affiliates/:id/subscriptions",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const filter = { affiliate_id: String(affiliate._id) };
    if (req.query.status === "active" || req.query.status === "cancelled") filter.status = req.query.status;

    const [total, docs] = await Promise.all([
      database.collection("Subscription").countDocuments(filter),
      database.collection("Subscription")
        .find(filter)
        .sort({ next_due_at: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    return res.json({
      data: docs.map((doc) => presentSubscription(doc, req)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      limit: pageSize,
    });
  })
);

// The reminder policy on one profile, with the options the settings dialog needs.
app.get(
  "/api/affiliates/:id/subscription-settings",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });
    return res.json({
      settings: affiliateReminderSettings(affiliate),
      options: {
        channels: REMINDER_CHANNELS,
        commission_modes: COMMISSION_MODES,
        placeholders: TEMPLATE_PLACEHOLDERS,
        max_lead_day: MAX_LEAD_DAY,
        default_lead_days: DEFAULT_LEAD_DAYS,
      },
      // Whether the caller is allowed to change the money field, so the UI can hide
      // the control instead of offering it and having the request refused.
      can_set_commission_mode: superAdmin(req),
    });
  })
);

// Change the reminder policy. Reachable by the affiliate as well as the super admin,
// because drafting their own wording and choosing their own channels is theirs to do.
// `commission_mode` is the exception and stays super-admin-only.
app.patch(
  "/api/affiliates/:id/subscription-settings",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

    const body = req.body || {};
    const refused = Object.keys(body).find((field) => !AFFILIATE_REMINDER_EDITABLE_FIELDS.has(field));
    if (refused) return res.status(400).json({ error: `'${refused}' cannot be changed here` });

    if (body.commission_mode !== undefined && !superAdmin(req)) {
      // An explicit 403 rather than a silent drop: this field decides what the
      // platform pays, and an affiliate who believes they set it has been told
      // something false.
      return res.status(403).json({ error: "Only a super admin can change the commission mode" });
    }

    const update = {};
    if (body.commission_mode !== undefined) {
      if (!isCommissionMode(body.commission_mode)) {
        return res.status(400).json({ error: `Commission mode must be one of ${COMMISSION_MODES.join(", ")}` });
      }
      update.commission_mode = body.commission_mode;
    }
    if (body.reminder_channels !== undefined) {
      if (!Array.isArray(body.reminder_channels)) {
        return res.status(400).json({ error: "Reminder channels must be a list" });
      }
      const channels = normalizeChannels(body.reminder_channels);
      // Refused rather than stored empty: a profile with no channel can never be
      // reminded, and saving that by accident looks like the feature is broken.
      if (!channels.length) {
        return res.status(400).json({ error: "Choose at least one reminder channel" });
      }
      update.reminder_channels = channels;
    }
    if (body.reminder_lead_days !== undefined) {
      if (!Array.isArray(body.reminder_lead_days)) {
        return res.status(400).json({ error: "Reminder lead days must be a list" });
      }
      update.reminder_lead_days = normalizeLeadDays(body.reminder_lead_days);
    }
    if (body.reminder_email_subject !== undefined) {
      update.reminder_email_subject = String(body.reminder_email_subject).slice(0, 200);
    }
    if (body.reminder_email_template !== undefined) {
      const body_ = String(body.reminder_email_template);
      if (body_.length > 5000) return res.status(400).json({ error: "The email draft is too long (5000 characters maximum)" });
      update.reminder_email_template = body_;
    }
    if (body.reminder_whatsapp_template_name !== undefined) {
      update.reminder_whatsapp_template_name = String(body.reminder_whatsapp_template_name).trim().slice(0, 120);
    }
    if (body.reminder_pay_link !== undefined) {
      const link = String(body.reminder_pay_link).trim();
      // A link that goes into a customer-facing message has to be a real absolute
      // http(s) URL. A "javascript:" value here would be an injection the affiliate
      // sends to their own institution's inbox, which is still a defect worth refusing.
      if (link && !/^https?:\/\//i.test(link)) {
        return res.status(400).json({ error: "The payment link must be a full http(s) URL" });
      }
      update.reminder_pay_link = link.slice(0, 500);
    }

    if (!Object.keys(update).length) {
      return res.json({ settings: affiliateReminderSettings(affiliate) });
    }

    const now = new Date().toISOString();
    await database.collection("Affiliate").updateOne(
      { _id: affiliate._id },
      { $set: { ...update, updated_date: now } }
    );
    const updated = await database.collection("Affiliate").findOne({ _id: affiliate._id });
    await logServerAudit(req, {
      action: "affiliate_reminder_settings",
      entity_type: "Affiliate",
      entity_id: String(affiliate._id),
      details: Object.keys(update)
        .filter((field) => field !== "updated_date")
        .map((field) => `${field}=${JSON.stringify(update[field])}`)
        .join(", ")
        .slice(0, 500),
    });
    return res.json({ settings: affiliateReminderSettings(updated) });
  })
);

// The approved templates a super admin can pick from. Reading the provider's list is
// the only way to know a template is approved: sending an unapproved one fails at the
// provider, and a renewal reminder is the wrong moment to discover that.
app.get(
  "/api/affiliates/:id/whatsapp-templates",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });
    const result = await listWhatsAppTemplates();
    if (!result.ok) return res.status(502).json({ error: result.error || "Could not load WhatsApp templates" });
    return res.json({ templates: result.templates || [] });
  })
);

// What the saved draft will actually read for one subscription. This exists so the
// person pressing Send sees the same text the customer will receive, rather than a
// draft full of {{due_date}} tokens.
app.get(
  "/api/affiliates/:id/subscriptions/:subId/reminder-preview",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });
    const subscription = await loadOwnedSubscription(database, affiliate, req.params.subId);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    const settings = affiliateReminderSettings(affiliate);
    const recipient = await resolveRecipient(subscription);
    const now = new Date().toISOString();
    return res.json({
      recipient,
      preview: {
        email_subject: renderReminder(settings.reminder_email_subject, { subscription, affiliate, now }),
        email_body: renderReminder(settings.reminder_email_template, { subscription, affiliate, now }),
      },
    });
  })
);

// Send a reminder now, by hand.
//
// The delivery log's unique index still applies: a manual send is recorded with
// trigger "manual", and if the same reminder already went out this period the send is
// skipped rather than duplicated. That is deliberate — a "Send again" button that
// silently does nothing is confusing, so the response says `skipped` explicitly and
// the UI surfaces it as "already sent" rather than an error.
app.post(
  "/api/affiliates/:id/subscriptions/:subId/send-reminder",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });
    const subscription = await loadOwnedSubscription(database, affiliate, req.params.subId);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    const settings = affiliateReminderSettings(affiliate);
    const requested = String(req.body?.channel || "").trim();
    const channel = requested || settings.reminder_channels[0];
    if (!REMINDER_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: `Channel must be one of ${REMINDER_CHANNELS.join(" or ")}` });
    }

    const limit = await runLimit(() =>
      rateStore.incr({
        scope: RATE_LIMITS.affiliateReminder.scope,
        key: `affiliate:${req.user._id.toString()}`,
        windowMs: RATE_LIMITS.affiliateReminder.windowMs,
      })
    );
    if (limit.count > RATE_LIMITS.affiliateReminder.limit) return tooMany(res, limit.resetAt);

    // A manual send is allowed to override the saved draft for this one message —
    // that is the whole reason to have a Send button rather than only a schedule.
    const subjectOverride = req.body?.subject !== undefined ? String(req.body.subject).slice(0, 200) : undefined;
    const bodyOverride = req.body?.body !== undefined ? String(req.body.body).slice(0, 5000) : undefined;

    const result = await sendAffiliateReminder({
      subscription,
      affiliate,
      channel,
      leadDays: Number(req.body?.lead_days) || 0,
      trigger: "manual",
      actor: req.user._id.toString(),
      subjectOverride,
      bodyOverride,
    });

    if (!result.ok) return res.status(502).json({ error: result.error || "The reminder could not be sent" });

    await logServerAudit(req, {
      action: "affiliate_reminder_sent",
      entity_type: "Subscription",
      entity_id: String(subscription._id),
      details: `${channel} to ${subscription.tenant_name}${result.skipped ? " (already sent this period)" : ""}`,
    });

    return res.json({
      sent: !result.skipped,
      skipped: Boolean(result.skipped),
      message: result.skipped
        ? "This reminder was already sent for this billing period"
        : `Reminder sent to ${subscription.tenant_name}`,
      delivery_id: result.delivery_id || null,
    });
  })
);

// Record a renewal payment and advance the billing period.
//
// The client sends the `paid_through` it believes it is advancing FROM, and the update
// is conditional on it still matching. Without that, a double-clicked button books two
// renewals and pushes the due date out two months — the kind of error nobody notices
// until an institution is told it is paid up for longer than it is.
app.post(
  "/api/affiliates/:id/subscriptions/:subId/renew",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });
    const subscription = await loadOwnedSubscription(database, affiliate, req.params.subId);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });
    if (subscription.status !== "active") {
      return res.status(409).json({ error: "A cancelled subscription cannot be renewed" });
    }

    const expected = String(req.body?.paid_through || "");
    if (!expected || expected !== String(subscription.paid_through)) {
      return res.status(409).json({
        error: "This subscription has already moved on since you loaded it. Reload and try again.",
      });
    }

    const now = new Date().toISOString();
    const advanced = { ...subscription, paid_through: subscription.next_due_at || subscription.paid_through };
    const period = computePeriod(advanced);
    if (!period) return res.status(400).json({ error: "This subscription has no billing period to advance" });

    // The commission decision is snapshotted on the subscription, not read from the
    // affiliate's current setting, so switching an affiliate to "one_time" does not
    // retroactively change the renewal that is happening right now.
    const recurring = shouldCreateCommission(subscription.commission_mode);
    const commissionRate = Number(subscription.commission_rate) || 0;
    const commissionAmount = computeCommission(subscription.plan_price, commissionRate);
    let renewalSaleId = null;

    // CLAIM THE PERIOD FIRST.
    //
    // This conditional update is the concurrency guard, so it has to happen before the
    // payment is written rather than after: two simultaneous renewals both read the
    // same `paid_through`, and whichever writes the Payment first must be the one that
    // wins the claim. The loser sees modifiedCount 0 and is refused. Writing the money
    // first and checking afterwards would leave both renewals paid and one period
    // advanced — the exact failure the `expected` check above exists to prevent.
    const claim = await database.collection("Subscription").updateOne(
      { _id: subscription._id, paid_through: expected },
      { $set: { paid_through: advanced.paid_through, next_due_at: period.nextDueAt, updated_date: now } }
    );
    if (claim.modifiedCount !== 1) {
      return res.status(409).json({
        error: "This subscription has already moved on since you loaded it. Reload and try again.",
      });
    }

    // The period advanced but the ledger rows did not. Put the period back, or the
    // institution is marked paid for a month nobody collected — and the refund is
    // discovered at the next renewal instead of now. Same compensating-rollback shape
    // the sale branch uses for its own partial writes.
    const rollbackPeriod = async () => {
      await database
        .collection("Subscription")
        .updateOne(
          { _id: subscription._id, paid_through: advanced.paid_through },
          { $set: { paid_through: subscription.paid_through, next_due_at: subscription.next_due_at, updated_date: now } }
        )
        .catch(() => {});
    };

    const payment = {
      tenant_id: subscription.tenant_id,
      affiliate_id: subscription.affiliate_id,
      amount: Number(subscription.plan_price) || 0,
      currency: subscription.currency || "INR",
      status: "paid",
      plan_name: subscription.plan_name || "",
      plan_id: subscription.plan_id || "",
      billing_cycle: subscription.billing_cycle || "",
      payment_method: String(req.body?.payment_method || "Offline (UPI/Bank)").slice(0, 60),
      kind: "subscription_renewal",
      subscription_id: String(subscription._id),
      paid_at: now,
      created_date: now,
      updated_date: now,
    };
    try {
      await database.collection("Payment").insertOne(payment);

      if (recurring) {
        // A renewal under a recurring-commission affiliate books a NEW sale rather than
        // editing the old one, so the commission re-enters the same pending -> approved
        // -> paid checkpoint as every other commission the platform owes.
        const renewalSale = {
          affiliate_id: subscription.affiliate_id,
          affiliate_user_id: subscription.affiliate_user_id,
          tenant_id: subscription.tenant_id,
          tenant_name: subscription.tenant_name,
          tenant_subdomain: subscription.tenant_subdomain,
          plan_id: subscription.plan_id,
          plan_name: subscription.plan_name,
          plan_price: subscription.plan_price,
          billing_cycle: subscription.billing_cycle,
          school_contact_name: subscription.contact?.name || "",
          school_contact_email: subscription.contact?.email || "",
          school_contact_phone: subscription.contact?.phone || null,
          amount: subscription.plan_price,
          commission_rate: commissionRate,
          commission_amount: commissionAmount,
          kind: "renewal",
          subscription_id: String(subscription._id),
          period_key: period.periodKey,
          status: "pending",
          admin_note: "",
          approved_date: null,
          paid_date: null,
          created_date: now,
          updated_date: now,
        };
        const renewalResult = await database.collection("AffiliateSale").insertOne(renewalSale);
        renewalSaleId = renewalResult.insertedId.toString();
      }
    } catch (ledgerError) {
      await rollbackPeriod();
      throw ledgerError;
    }

    await logServerAudit(req, {
      action: "affiliate_subscription_renewed",
      entity_type: "Subscription",
      entity_id: String(subscription._id),
      details: `${subscription.tenant_name} renewed to ${period.nextDueAt}${recurring ? ` (commission ₹${commissionAmount})` : ""}`,
    });

    const updated = await database.collection("Subscription").findOne({ _id: subscription._id });
    return res.status(201).json({
      subscription: presentSubscription(updated, req),
      commission_created: recurring,
      renewal_sale_id: renewalSaleId,
      commission_amount: recurring ? commissionAmount : 0,
    });
  })
);

// What was actually sent for this subscription, and what the provider said.
//
// This is the evidence behind the "already sent" state: an operator who is told a
// reminder was skipped can come here and see the row that beat them to it, including
// the provider message id or the reason it failed.
app.get(
  "/api/affiliates/:id/subscriptions/:subId/deliveries",
  requireSuperAdminOrAffiliate,
  route(async (req, res) => {
    const database = await db();
    const affiliate = await loadAffiliateForActor(database, req, req.params.id);
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });
    const subscription = await loadOwnedSubscription(database, affiliate, req.params.subId);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    const rows = await listDeliveries(subscription._id, req.query.limit);
    return res.json({
      data: rows.map((row) => ({
        id: String(row._id),
        channel: row.channel,
        status: row.status,
        trigger: row.trigger,
        lead_days: row.lead_days,
        period_key: row.period_key,
        provider_message_id: row.provider_message_id || null,
        error: row.error || null,
        sent_at: row.sent_at || null,
        created_date: row.created_date,
      })),
    });
  })
);

// Backend Functions
app.post(
  "/api/functions/:name",
  route(async (req, res) => {
    const database = await db();
    const fnName = req.params.name;

    // Public / unauthenticated or authenticated functions
    if (fnName === "publicSite") {
      const { action, school, type, ...formData } = req.body || {};
      if (action === "plans") {
        const plans = await database.collection("SubscriptionPlan").find({}).toArray();
        return res.json({ plans: presentAll("SubscriptionPlan", plans, req) });
      }
      if (action === "lookup") {
        const q = typeof school === "string" ? school.trim() : "";
        if (!q || q.length < 2) return res.json({ tenants: [] });
        const ip = getClientIp(req);
        const looked = await runLimit(() =>
          rateStore.incr({ scope: RATE_LIMITS.tenantLookup.scope, key: ip, windowMs: RATE_LIMITS.tenantLookup.windowMs })
        );
        if (looked.count > RATE_LIMITS.tenantLookup.limit) return tooMany(res, looked.resetAt);
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tenants = await database
          .collection("Tenant")
          .find({
            status: "active",
            $or: [
              { name: { $regex: new RegExp(escaped, "i") } },
              { subdomain: { $regex: new RegExp(`^${escaped}`, "i") } },
              { custom_domain: { $regex: new RegExp(`^${escaped}`, "i") } },
              { city: { $regex: new RegExp(`^${escaped}`, "i") } },
            ],
          })
          .sort({ name: 1 })
          .limit(8)
          .project({ name: 1, subdomain: 1, custom_domain: 1, city: 1, logo_url: 1, address: 1 })
          .toArray();
        return res.json({
          tenants: tenants.map((t) => ({
            id: (out(t) || {}).id,
            name: t.name,
            subdomain: t.subdomain,
            custom_domain: t.custom_domain,
            city: t.city,
            logo_url: t.logo_url,
            address: t.address,
          })),
        });
      }
      if (action === "branding") {
        if (!school) return res.json({ branding: null });
        const bEsc = String(school).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const bHost = normalizeHost(school);
        // custom_domain matches on the exact canonical hostname only — a
        // deterministic, non-regex mapping so a domain can never resolve to the
        // wrong tenant (uniqueness is enforced elsewhere in the pipeline).
        const brandCriteria = {
          $or: [
            { subdomain: { $regex: new RegExp(`^${bEsc}$`, "i") } },
            { name: { $regex: new RegExp(`^\\s*${bEsc}\\s*$`, "i") } },
          ],
        };
        if (bHost) brandCriteria.$or.unshift({ custom_domain: bHost });
        const tenant = await database.collection("Tenant").findOne(brandCriteria);
        // Never `out(tenant)` here. This branch is reached before the auth
        // middleware (see the pre-auth block above), so it is answered to
        // anonymous callers, and `out()` is a raw spread with no redaction — it
        // returned the whole document including student_default_password, the
        // shared portal credential. The tenant is matched by $regex on
        // name/subdomain, so a guessable school name was enough. redactTenantBranding
        // is a strict subset of the authenticated public allowlist and contains
        // exactly the fields the login and marketing pages consume.
        return res.json({ branding: tenant ? redactTenantBranding(out(tenant)) : null });
      }
      if (action === "lead") {
        const ip = getClientIp(req);
        const leadRate = await runLimit(() =>
          rateStore.incr({ scope: RATE_LIMITS.leadCreate.scope, key: ip, windowMs: RATE_LIMITS.leadCreate.windowMs })
        );
        if (leadRate.count > RATE_LIMITS.leadCreate.limit) return tooMany(res, leadRate.resetAt);
        const lead = {
          type: type || "contact",
          ...formData,
          status: "new",
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString(),
        };
        const result = await database.collection("Lead").insertOne(lead);
        // Fire-and-forget admin notifications AFTER persistence. Fully guarded
        // inside notifyLeadCreated — a provider outage never fails the public
        // lead submission, never blocks the response, and the public response
        // contract is unchanged. Idempotent via an atomic claim on the lead.
        notifyLeadCreated({ ...lead, _id: result.insertedId }).catch((err) =>
          console.warn("Lead notification non-fatal error:", err?.message || err)
        );
        return res.json({ success: true, lead: out({ ...lead, _id: result.insertedId }) });
      }
      return res.json({ ok: true });
    }

    // Require authentication for remaining functions
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (fnName === "getExamTimetable") {
      try {
        // Reuse the Examination entity read scope verbatim so the date sheet can
        // never widen what the same role may already read: a student/parent gets
        // their own classes' published|scheduled exams, staff get the tenant's.
        const criteria = await readScope(req, "Examination");
        const result = await getExamTimetable({ user: req.user, criteria });
        return res.json(result);
      } catch (err) {
        const status = err.statusCode || 500;
        return res.status(status).json({ error: err.message || "Failed to load exam date sheet" });
      }
    }

    // Authoritative roster for an examination (server-derived, tenant-scoped by
    // session). Used by OMR assignment/upload dropdowns so the UI can never offer
    // a student who is not on the exam roster.
    //
    // Teachers may read the roster so they can print blank OMR sheets for the
    // classes they teach. Reading is not grading: processOMRSheet, OMRSheet
    // writes and evaluateExamination all stay restricted to examWorkflow roles.
    if (fnName === "getExamRoster") {
      // Union: exam-workflow roles, or the teacher who is scoped to their classes.
      const rosterRoles = examWorkflow(req) || hasRole(req, APP_ROLES.TEACHER);
      if (!rosterRoles) return res.status(403).json({ error: "Forbidden" });
      const { examination_id } = req.body || {};
      if (!examination_id) return res.status(400).json({ error: "examination_id is required" });
      try {
        if (!ObjectId.isValid(examination_id)) return res.status(400).json({ error: "Invalid examination_id" });
        const exam = await database.collection("Examination").findOne({ _id: new ObjectId(examination_id) });
        if (!exam) return res.status(404).json({ error: "Examination not found" });
        assertTenantOwnership(req, exam);

        // A teacher must be assigned to EVERY class in the exam's scope, so they
        // can never read a partially-assigned exam's roster.
        const teacherScope = await teacherRosterScope(database, req);
        if (teacherScope) {
          if (!teacherScope.classIds.length) {
            return res.status(403).json({ error: "Forbidden" });
          }
          const examClassIds = resolveExamScope(exam).school_class_ids;
          if (!examClassIds.length || !examClassIds.every((id) => teacherScope.classIds.includes(id))) {
            return res.status(403).json({ error: "Forbidden" });
          }
        }

        const rows = await getExamRoster({ tenantId: String(exam.tenant_id), examinationId: String(examination_id) });
        return res.json({ examination_id: String(examination_id), students: rows });
      } catch (err) {
        const status = err.status || err.statusCode || 500;
        return res.status(status).json({ error: err.message || "Failed to load exam roster" });
      }
    }

    // Non-persisted roster count for the exam form, derived straight from
    // Enrollment for the selected academic year / classes / sections.
    if (fnName === "previewExamRoster") {
      const previewRoles = superAdmin(req) || hasAnyRole(req, STAFF_ROLES);
      if (!previewRoles) return res.status(403).json({ error: "Forbidden" });
      const { academic_year_id, school_class_ids, section_ids } = req.body || {};
      let classIds = Array.isArray(school_class_ids) ? school_class_ids : [];
      try {
        // Teachers may only preview rosters for the classes they are assigned to.
        const teacherScope = await teacherRosterScope(database, req);
        if (teacherScope) {
          if (!teacherScope.classIds.length) return res.status(403).json({ error: "Forbidden" });
          classIds = classIds.filter((id) => teacherScope.classIds.includes(String(id)));
          if (!classIds.length) return res.status(403).json({ error: "Forbidden" });
        }
        // A platform admin impersonating a tenant has no tenant_id on the session
        // token, so derive the tenant from the selected academic year (which is
        // tenant-owned) instead of req.user.tenant_id.
        let tenantId = req.user.tenant_id;
        if (academic_year_id && ObjectId.isValid(academic_year_id)) {
          const year = await database.collection("AcademicYear").findOne({ _id: new ObjectId(academic_year_id) });
          if (year) {
            assertTenantOwnership(req, year);
            tenantId = String(year.tenant_id);
          }
        }
        if (!tenantId && platform(req) && typeof req.body?.tenant_id === "string") {
          tenantId = req.body.tenant_id;
        }
        const { students: rows, stats } = await deriveEnrolledStudents({
          db: database,
          exam: {
            tenant_id: tenantId,
            academic_year_id,
            school_class_ids: classIds,
            section_ids: Array.isArray(section_ids) ? section_ids : [],
          },
        });
        return res.json({ count: rows.length, students: rows, stats });
      } catch (err) {
        const status = err.status || err.statusCode || 500;
        return res.status(status).json({ error: err.message || "Failed to preview exam roster" });
      }
    }

    // Pre-fill preview for the Add-Student form (non-mutating; assignment at save is authoritative).
    if (fnName === "getNextStudentNumbers") {
      if (!req.user?.tenant_id) return res.status(403).json({ error: "Tenant unavailable" });
      if (!canWriteEntity(req, "Student", "create")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { school_class_id, section_id, class_name, section, academic_year_id } = req.body || {};
      const tenantId = req.user.tenant_id;
      const scope = await resolvePlacementScope({
        database,
        tenantId,
        doc: { school_class_id, section_id, class_name, section, academic_year_id },
      });
      const [admission_number, roll_number] = await Promise.all([
        previewNextAdmissionNumber(database, tenantId),
        scope.resolved ? previewNextRollNumber(database, scope) : Promise.resolve(null),
      ]);
      return res.json({ admission_number, roll_number });
    }

    if (fnName === "provisionStudentLogins") {
      // Backfill the portal logins of students that exist without one. A Student
      // row and a portal login are separate documents: the login is minted as a
      // side effect of admitting a student (provisionAutoLogins), so any row
      // written by another path can leave a family that simply cannot sign in.
      //
      // This is deliberately NOT the bulk-update endpoint. That path would, per
      // student, write a no-op updated_date, re-run the Parent/ParentStudent
      // sync, and burn a bcrypt hash — even for the rows that already have a
      // login and would be reused untouched. Here only students that are
      // actually missing a login are considered, and the only record write is
      // the address backfill that makes provisioning possible at all.
      if (!canProvisionStudentLogins(req)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const tenantId = req.user?.tenant_id;
      if (!tenantId) return res.status(403).json({ error: "Tenant unavailable" });

      const { student_ids: rawIds, dry_run: dryRun } = req.body || {};

      try {
        // The tenant comes from the session only. A client-supplied tenant_id
        // could otherwise aim the backfill at another institution.
        const studentQuery = { tenant_id: tenantId };
        if (rawIds !== undefined) {
          if (!Array.isArray(rawIds)) return res.status(400).json({ error: "student_ids must be an array" });
          // Bound one request's WORK: a run over a large tenant is chunked by the
          // client so a single request cannot hold a connection open for minutes.
          // The cap is on the writing pass only — a dry run is a single indexed
          // read and is how the client learns what to chunk.
          if (!dryRun && rawIds.length > PROVISION_LOGIN_CHUNK_MAX) {
            return res.status(400).json({ error: `Send at most ${PROVISION_LOGIN_CHUNK_MAX} student ids per call` });
          }
          const ids = rawIds.filter((id) => ObjectId.isValid(String(id))).map((id) => new ObjectId(String(id)));
          if (!ids.length) return res.json({ scanned: 0, processed: 0, created_count: 0, reused_count: 0, rows: [], default_password: null });
          studentQuery._id = { $in: ids };
        }

        const students = await database
          .collection("Student")
          .find(studentQuery, {
            projection: {
              full_name: 1, student_email: 1, parent_email: 1,
              parent_name: 1, student_phone: 1, parent_phone: 1,
            },
          })
          .toArray();

        // The emails that already have an account. One query for the whole run
        // instead of a lookup per student, and it is what makes the dry run
        // meaningful rather than a guess.
        const existingEmails = new Set(
          (await database.collection("User").find({ tenant_id: tenantId }, { projection: { email: 1 } }).toArray())
            .map((u) => normalizeEmail(u.email))
            .filter(Boolean)
        );

        const needsLogin = (s) => {
          const sEmail = normalizeEmail(s.student_email);
          const pEmail = normalizeEmail(s.parent_email);
          return !(sEmail && existingEmails.has(sEmail)) || !(pEmail && existingEmails.has(pEmail));
        };
        const pending = students.filter(needsLogin);

        if (dryRun) {
          // No writes at all. `missing_ids` is what the client then chunks its
          // writing pass against; `sample` is the preview the confirmation shows.
          // `emails_to_generate` counts rows that have no address yet and will
          // have one generated, which is itself a record change and is worth
          // saying out loud before the administrator confirms.
          const emailsToGenerate = pending.filter(
            (s) => !normalizeEmail(s.student_email) || !normalizeEmail(s.parent_email)
          ).length;
          return res.json({
            scanned: students.length,
            missing_count: pending.length,
            missing_ids: pending.map((s) => s._id.toString()),
            emails_to_generate: emailsToGenerate,
            sample: pending.slice(0, 10).map((s) => ({
              id: s._id.toString(),
              full_name: s.full_name || "",
              student_email: normalizeEmail(s.student_email) || null,
              parent_email: normalizeEmail(s.parent_email) || null,
            })),
          });
        }

        const tenant = await database.collection("Tenant").findOne(
          { _id: ObjectId.isValid(String(tenantId)) ? new ObjectId(String(tenantId)) : tenantId },
          { projection: { custom_domain: 1, subdomain: 1 } }
        );

        const now = new Date().toISOString();
        const rows = [];
        const skipped = [];
        let created = 0;
        let reused = 0;
        let defaultPassword = null;

        for (const student of pending) {
          // A row admitted without an address can never be provisioned, so the
          // address is generated and persisted first — the same backfill the
          // create and import paths already perform.
          const emailUpdates = await ensureStudentEmails({ database, tenantId, student, tenant });
          let effective = student;
          if (Object.keys(emailUpdates).length) {
            await database.collection("Student").updateOne(
              { _id: student._id, tenant_id: tenantId },
              { $set: { ...emailUpdates, updated_date: now } }
            );
            effective = { ...student, ...emailUpdates };
          }

          try {
            const provisioned = await provisionAutoLogins({
              database,
              tenantId,
              student: effective,
              studentId: student._id.toString(),
              creatorRoles: rolesOf(req),
            });
            const reusedSet = new Set(provisioned.reused || []);
            for (const [type, key] of [["student", "student"], ["parent", "parent"]]) {
              const credential = provisioned[key];
              if (!credential?.email) continue;
              const isReused = reusedSet.has(credential.email);
              if (isReused) reused += 1;
              else created += 1;
              rows.push({
                type,
                name: credential.full_name || (type === "parent" ? effective.parent_name || "" : effective.full_name || ""),
                email: credential.email,
                reused: isReused,
              });
            }
            if (provisioned.default_password && !defaultPassword) defaultPassword = provisioned.default_password;
          } catch (err) {
            // One bad row must not abandon the rest of the roster; it is reported
            // and the run continues.
            skipped.push({ id: student._id.toString(), reason: err.message || "Provisioning failed" });
          }
        }

        await logServerAudit(req, {
          action: "provision_student_logins",
          entity_type: "Student",
          entity_id: "",
          details: `${pending.length} students checked, ${created} portal logins created, ${reused} reused${skipped.length ? `, ${skipped.length} failed` : ""}`,
        });

        return res.json({
          scanned: students.length,
          processed: pending.length,
          created_count: created,
          reused_count: reused,
          rows,
          default_password: defaultPassword,
          ...(skipped.length && { skipped }),
        });
      } catch (err) {
        const status = err.status || err.statusCode || 500;
        return res.status(status).json({ error: err.message || "Failed to create portal logins" });
      }
    }

    if (fnName === "getMyTenant") {
      // A tenant is only ever readable by its own members. super_admin keeps the
      // cross-tenant read the institutions console needs; every other role is
      // pinned to its own tenant_id from the verified session, so a
      // client-supplied tenant_id can never select a different institution.
      const id = resolveReadableTenantId(req, req.body?.tenant_id);
      if (!id) return res.status(403).json({ error: "Tenant unavailable" });
      if (!ObjectId.isValid(String(id))) return res.status(404).json({ error: "Institution not found" });
      const tenantDoc = await database.collection("Tenant").findOne({ _id: new ObjectId(String(id)) });
      if (!tenantDoc) return res.status(404).json({ error: "Institution not found" });
      return res.json({ tenant: present("Tenant", tenantDoc, req) });
    }

    if (fnName === "deleteMyAccount") {
      // Deleting an account is irreversible and orphans whatever that account
      // owns (a tenant, its roster, its exam history), so it is guarded rather
      // than open to any authenticated role: platform operators are denied, and
      // everyone else must re-authenticate with their current password. A
      // school administrator closes their institution through the admin
      // surface, not by removing their own login.
      if (!canDeleteOwnAccount(req)) {
        return res.status(403).json({ error: "Platform accounts cannot be deleted through this endpoint" });
      }
      const { password } = req.body || {};
      if (!password) {
        return res.status(400).json({ error: "Confirm your current password to delete this account" });
      }
      const matches = await verifyPassword(password, req.user.password_hash || "");
      if (!matches) {
        return res.status(401).json({ error: "Incorrect password" });
      }
      // The same last-administrator invariant the role-change path enforces. Role
      // demotion and account deletion are two different routes to the identical
      // outcome, so guarding only one of them would leave the invariant enforced
      // in name only: an institution whose sole administrator deletes their own
      // login is just as unmanageable as one whose sole administrator is demoted,
      // and neither the school nor the platform can fix it from inside the school
      // because minting an administrator is a platform action.
      if (hasRole(req, APP_ROLES.SCHOOL_ADMIN) && req.user?.tenant_id) {
        const remainingAdmins = await countTenantAdmins(database, req.user.tenant_id, req.user._id);
        if (remainingAdmins === 0) {
          return res.status(400).json({
            error: "This is the only administrator for this institution. Promote another account to administrator before removing your own login, or ask the platform to appoint one.",
          });
        }
      }
      await database.collection("User").deleteOne({ _id: req.user._id });
      await logServerAudit(req, {
        action: "delete_own_account",
        entity_type: "User",
        entity_id: req.user._id.toString(),
        details: `self-service deletion by ${rolesOf(req).join(", ")}`,
      });
      return res.json({ success: true });
    }

    if (fnName === "manageStaff") {
      // resolveStaffTenant() answers "which institution is this actor allowed to
      // act in". It is pure and does no I/O, so it cannot tell a real tenant id
      // from a well-formed one that names nothing. Every caller must then confirm
      // the id RESOLVES to a live institution before reading or writing under it.
      //
      // This is not cosmetic. Without it a super_admin (or any caller whose
      // tenant_id reaches here) could name an arbitrary string and have staff
      // listed under it, or -- worse -- have a role written onto an account in an
      // institution that does not exist or has been switched off, producing an
      // account bound to a tenant that can never be administered again.
      //
      // Same policy as provisionUser(): the id must parse, the Tenant must exist,
      // and it must not be inactive. Refusals are 404 for a name that resolves to
      // nothing and 400 for one that resolves to a disabled institution, so the
      // client can tell "no such institution" from "not available".
      const { action, user_id, app_role, app_roles, email, tenant_id } = req.body || {};
      // canManageStaff, not canWriteEntity(Teacher, "create"). That write matrix
      // answers "may this actor create a Teacher RECORD", which is school-admin-only
      // for reasons that have nothing to do with staffing — reusing it would re-couple
      // the two, so any future edit to Teacher.create would silently change who can
      // manage staff. principal is admitted here (their hierarchy already authorized
      // appointing an exam coordinator or a teacher); exam_coordinator and below are
      // not, because they are managed BY this surface.
      if (!canManageStaff(req)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      // Every staff-management action resolves its institution the same way, so a
      // super_admin acting inside a school cannot list one institution's staff and
      // write into another. A school_admin is pinned to its own tenant and a
      // mismatched tenant_id is refused with 404.
      const { tenantId, error: tenantError } = resolveStaffTenant(req, tenant_id);
      if (tenantError) return res.status(tenantError.status).json({ error: tenantError.error });
      // requireLiveTenant() is the shared implementation near the auth middleware,
      // the same one the view-as scope uses, so the two features cannot drift into
      // disagreeing about whether an id names a live institution.
      const live = await requireLiveTenant(tenantId);
      if (!live.ok) return res.status(live.status).json({ error: live.error });

      if (action === "list") {
        // A staff list, so it is scoped to STAFF accounts. Family logins are
        // excluded: a student's and a parent's portal credentials are family
        // accounts that arrive as a side effect of admitting a student, and they
        // are managed on the Students and Parents pages — listing them here only
        // invited an administrator to edit role sets the provisioning matrix
        // deliberately keeps off this surface.
        //
        // Accounts with NO recognizable role are deliberately NOT excluded. They
        // are locked out by the NO_ASSIGNED_ROLE gate and this table is the only
        // place an administrator can give them a role; hiding them here would
        // leave them unfixable from any screen. The client splits on
        // `app_roles.length === 0` and renders them as a separate Unassigned group.
        //
        // The query reproduces the app_roles -> app_role legacy fallback that
        // appRolesOf() applies in JS, because a document predating the array must
        // appear exactly as it did before the field existed. $size: 0 does NOT match
        // a missing field, so the absent and empty-array cases need their own
        // branches or a pre-migration staff account silently disappears.
        const staffRoleList = [...STAFF_ROLES];
        const staffScoped = {
          $or: [
            { app_roles: { $in: staffRoleList } },
            { app_role: { $in: staffRoleList }, app_roles: { $exists: false } },
            { app_role: { $in: staffRoleList }, app_roles: { $size: 0 } },
            // No role at all: $nin also matches a missing app_role field.
            { app_role: { $nin: APP_ROLE_PRECEDENCE }, app_roles: { $exists: false } },
            { app_role: { $nin: APP_ROLE_PRECEDENCE }, app_roles: { $size: 0 } },
          ],
        };
        const staff = await database
          .collection("User")
          .find(tenantId ? { tenant_id: tenantId, ...staffScoped } : staffScoped)
          .toArray();
        // creatable_roles and assignable_roles are both sent rather than
        // reimplemented in the client, and they are deliberately DIFFERENT lists:
        //
        //   creatable_roles   minting, from PROVISIONING_HIERARCHY. principal,
        //                     exam_coordinator, teacher. Never school_admin.
        //   assignable_roles  re-labelling an existing account, from
        //                     ROLE_ASSIGNMENT_HIERARCHY. The same three, PLUS
        //                     school_admin for a school_admin.
        //
        // The /staff screen used to carry its own copy of this map, which had
        // already drifted from PROVISIONING_HIERARCHY: it omitted exam_coordinator
        // from every parent's list and offered exam_coordinator only the family
        // roles. The client now renders exactly what the policy authorizes.
        return res.json({
          // Each row carries its own normalized role set AND a mirror rebuilt from
          // it, so the two can never be seen disagreeing. Normalizing only
          // app_roles would leave a stale app_role in the payload for any client
          // still reading the mirror, and would report a disagreement that does not
          // exist to any client reading both.
          staff: staff.map((u) => {
            const held = appRolesOf(u);
            return out({ ...safeUser(u), app_roles: held, app_role: held[0] ?? null });
          }),
          creatable_roles: staffCreatableRolesFor(rolesOf(req)),
          assignable_roles: staffAssignableRolesFor(rolesOf(req)),
          tenant_id: tenantId,
        });
      }

      if (action === "setRole" || action === "setRoles") {
        // A scope does NOT reach assignUserRoles through resolveStaffTenant: this
        // action names its target by user_id and never sends a tenant_id, and the
        // delegation matrix deliberately exempts the platform owner from the
        // tenant boundary. So the boundary is re-stated here, against the target's
        // own tenant. 404 rather than 403, so the reply does not confirm that an
        // account in another institution exists.
        if (req.viewAs) {
          // Shape before boundary: a malformed id is a bad request whatever the
          // scope, and assignUserRoles answers it with 400. Swallowing that into a
          // 404 here would make a client bug look like a missing account.
          if (!ObjectId.isValid(String(user_id ?? ""))) {
            return res.status(400).json({ error: "Invalid user id" });
          }
          const target = await database
            .collection("User")
            .findOne({ _id: new ObjectId(String(user_id)) });
          if (!target || String(target.tenant_id || "") !== req.viewAs.tenant_id) {
            return res.status(404).json({ error: "Institution not found" });
          }
        }
        const refused = await assignUserRoles(req, {
          user_id,
          app_roles: app_roles !== undefined ? app_roles : app_role,
        });
        if (refused) return res.status(refused.status).json({ error: refused.error });
        return res.json({ success: true });
      }

      if (action === "invite") {
        if (!email) return res.status(400).json({ error: "Email required" });
        const shape = validateAppRoleSet(app_roles !== undefined ? app_roles : app_role || "teacher");
        if (shape.error) return res.status(400).json({ error: shape.error });
        const requestedRoles = shape.roles;
        const requestedRole = requestedRoles[0];
        // An INVITATION, so the PROVISIONING matrix, not the assignment one. Note this
        // action updates an existing account when the email already matches — but it
        // is still an invitation, its purpose is to bring someone new into the
        // school, and its UI surface is the create form, which is authorized by
        // `creatable_roles` and never offered school_admin. Promoting an existing
        // account is `setRoles`, and that is where school_admin -> school_admin is
        // permitted. Validating every role rather than only the primary keeps the
        // decision independent of each hierarchy row staying a linear chain.
        const provision = canProvisionRoleSet(rolesOf(req), requestedRoles);
        if (provision.error) return res.status(403).json({ error: provision.error });
        if (!superAdmin(req) && requestedRoles.some((held) => PLATFORM_ROLES.has(held))) {
          return res.status(403).json({ error: "Cannot assign platform roles" });
        }
        // A tenant role attached to no institution is an account that can
        // authenticate but can never reach any school's data. Before this,
        // super_admin had no tenant of its own, so `tenant_id: req.user.tenant_id`
        // wrote null and the invite landed unusable. A platform caller must now say
        // which institution it is acting for; the same rule assignUserRole applies
        // when it writes role and tenant together.
        if (!requestedRoles.some((held) => PLATFORM_ROLES.has(held)) && !tenantId) {
          return res.status(400).json({ error: `tenant_id is required to invite a ${requestedRole} into an institution` });
        }
        const normalizedEmail = email.toLowerCase().trim();
        const existing = await database.collection("User").findOne({ email: normalizedEmail });
        if (existing && !superAdmin(req) && existing.tenant_id && existing.tenant_id !== tenantId) {
          return res.status(403).json({ error: "User belongs to another tenant and cannot be assigned here" });
        }
        // SEC-05: same per-admin quota + per-recipient cooldown as /users/invite,
        // counted only for attempts that pass authorization.
        const adminKey = `admin:${req.user._id.toString()}`;
        const recipientKey = `${req.user?.tenant_id || "platform"}|${normalizedEmail}`;
        const adminInvites = await runLimit(() =>
          rateStore.incr({ scope: RATE_LIMITS.inviteAdmin.scope, key: adminKey, windowMs: RATE_LIMITS.inviteAdmin.windowMs })
        );
        const recipientInvites = await runLimit(() =>
          rateStore.incr({ scope: RATE_LIMITS.inviteRecipient.scope, key: recipientKey, windowMs: RATE_LIMITS.inviteRecipient.windowMs })
        );
        if (adminInvites.count > RATE_LIMITS.inviteAdmin.limit || recipientInvites.count > RATE_LIMITS.inviteRecipient.limit) {
          return tooMany(res, Math.max(adminInvites.resetAt, recipientInvites.resetAt));
        }
        const now = new Date().toISOString();
        if (existing) {
          await database.collection("User").updateOne(
            { _id: existing._id },
            { $set: { ...(tenantId && { tenant_id: tenantId }), app_roles: requestedRoles, app_role: requestedRole, updated_date: now } }
          );
          await logServerAudit(req, {
            action: "invite",
            entity_type: "User",
            entity_id: existing._id.toString(),
            details: `${normalizedEmail} (${requestedRole})`,
          });
          return res.json({ success: true, linked: true });
        }
        const inserted = await database.collection("User").insertOne({
          email: normalizedEmail,
          full_name: normalizedEmail.split("@")[0],
          role: "user",
          // Canonical set plus the primary-role mirror, written together.
          app_role: requestedRole,
          app_roles: requestedRoles,
          tenant_id: tenantId,
          invited: true,
          // Same reasoning as /api/users/invite: the inviter is an authenticated,
          // verified administrator acting inside their own institution.
          email_verified: true,
          created_date: now,
          updated_date: now,
        });
        await logServerAudit(req, {
          action: "invite",
          entity_type: "User",
          entity_id: inserted.insertedId.toString(),
          details: `${normalizedEmail} (${requestedRole})`,
        });
        return res.json({ success: true, linked: false });
      }
      // getAssignedTenants / setAssignedTenants are called by appClient.users.* for
      // the employee tenant-assignment feature, but there is no implementation
      // here — the handler has always fallen through to the `{ ok: true }` below, so
      // the client has been reading a false success. That is a pre-existing gap and
      // not this change's to close, but a SCOPED caller must not be told "ok" for a
      // platform-level action it is not scoped for, so it is refused outright while a
      // scope is active rather than silently succeeding.
      if ((action === "getAssignedTenants" || action === "setAssignedTenants") && req.viewAs) {
        return res.status(403).json({
          error:
            "Managing employee tenant assignments is a platform action and is not available while viewing a single institution.",
        });
      }
      return res.json({ ok: true });
    }

    if (fnName === "linkMyAccount") {
      if (!hasAnyRole(req, FAMILY_ROLES)) {
        return res.status(403).json({ error: "Account linking is only available to student and parent accounts" });
      }
      const userTenantId = req.user.tenant_id;
      const userEmail = normalizeEmail(req.user.email);
      if (!userTenantId || !userEmail) {
        return res.json({ linked_student_id: req.user.linked_student_id || null });
      }

      let linkedStudentIds = [];
      const parentDoc = await database.collection("Parent").findOne({
        tenant_id: userTenantId,
        $or: [{ user_id: req.user._id.toString() }, { email: userEmail }],
        status: { $ne: "inactive" },
      });
      if (parentDoc) {
        if (!parentDoc.user_id) {
          await database.collection("Parent").updateOne(
            { _id: parentDoc._id },
            { $set: { user_id: req.user._id.toString(), updated_date: new Date().toISOString() } }
          );
        }
        const parentLinks = await database.collection("ParentStudent").find({
          tenant_id: userTenantId,
          parent_id: parentDoc._id.toString(),
        }).toArray();
        const pStudentIds = parentLinks.map((l) => l.student_id).filter(Boolean);
        if (pStudentIds.length) {
          linkedStudentIds.push(...pStudentIds);
        }
      }

      const students = await database
        .collection("Student")
        .find({
          tenant_id: userTenantId,
          $or: [{ student_email: userEmail }, { parent_email: userEmail }, { email: userEmail }],
        })
        .toArray();

      if (students.some((student) => student.tenant_id !== userTenantId)) {
        return res.status(409).json({ error: "Account could not be linked." });
      }

      const isStudent = students.some((student) => student.student_email === userEmail || student.email === userEmail);
      // A student identity must resolve to exactly one student. A parent identity
      // intentionally resolves to every child sharing its verified parent email.
      if (isStudent && students.length !== 1) return res.status(409).json({ error: "Student account matches multiple records. Please contact your school administrator." });

      if (students.length > 0) {
        linkedStudentIds.push(...students.map((student) => student._id.toString()));
      }
      linkedStudentIds = [...new Set(linkedStudentIds.filter(Boolean))];

      if (linkedStudentIds.length === 0) {
        return res.json({ linked_student_id: req.user.linked_student_id || null });
      }

      const app_role = isStudent ? "student" : "parent";
      const linkedStudentId = linkedStudentIds[0];
      // email_verified is intentionally not set here. This route is behind the
      // global verification gate, so the caller has already proven the address;
      // the roster match only decides which records to link. Re-asserting it would
      // imply the institution confirmed the address, which is not what happens.
      await database.collection("User").updateOne(
        { _id: req.user._id },
        {
          $set: {
            linked_student_id: linkedStudentId,
            ...(app_role === "parent" && { linked_student_ids: linkedStudentIds }),
            // The roster match decided which single family role this is, so the
            // mirror is re-stamped with the canonical set to match.
            app_role,
            app_roles: [app_role],
            updated_date: new Date().toISOString(),
          },
        }
      );
      return res.json({ linked_student_id: linkedStudentId, linked_student_ids: linkedStudentIds, role: app_role });
    }

    if (fnName === "startFreeTrial") {
      const { plan_id, school_name } = req.body || {};
      if (req.user.tenant_id) {
        return res.status(403).json({ error: "Free trial is only available to accounts without an institution" });
      }
      // A trial mints a Tenant and self-promotes the caller to its school_admin.
      // "Has no tenant yet" is not an authorization check on its own: /api/users/
      // /invite creates tenant-less accounts, so any role reaching this function
      // could otherwise claim an institution and become its administrator. Only a
      // platform role that has not yet claimed an institution may start one.
      if (!canStartTrial(req)) {
        return res.status(403).json({ error: `Role '${rolesOf(req).join(", ")}' cannot start an institution trial` });
      }
      const now = new Date().toISOString();
      const plan = plan_id ? await database.collection("SubscriptionPlan").findOne({ _id: new ObjectId(plan_id) }) : null;
      const tenantDoc = {
        name: school_name?.trim() || `${req.user.full_name || req.user.email.split("@")[0]}'s Institution`,
        // A trial mints a real, public tenant identity, so it gets the same
        // normalization and uniqueness rules as register: a trial must not be able
        // to claim a portal address that already belongs to an institution.
        subdomain: normalizeSubdomain(school_name || req.user.email.split("@")[0]),
        subscription_plan_id: plan_id || null,
        plan_name: plan?.name || "Free Trial",
        status: "active",
        white_label_enabled: Boolean(plan?.white_label_enabled),
        created_date: now,
        updated_date: now,
      };
      assertSubdomainUsable(tenantDoc.subdomain);
      await assertSubdomainAvailable(database.collection("Tenant"), tenantDoc.subdomain);
      const tenantResult = await database.collection("Tenant").insertOne(tenantDoc);
      const tenantId = tenantResult.insertedId.toString();
      await database.collection("User").updateOne(
        { _id: req.user._id },
        { $set: { tenant_id: tenantId, app_role: "school_admin", app_roles: ["school_admin"], updated_date: now } }
      );
      await logServerAudit(req, {
        action: "start_free_trial",
        entity_type: "Tenant",
        entity_id: tenantId,
        details: tenantDoc.name,
      });
      return res.json({ success: true, tenant: out({ ...tenantDoc, _id: tenantResult.insertedId }) });
    }

    // Plan changes: the sales-assisted upgrade path.
    //
    // There is no payment gateway in this application. An institution asking for a
    // bigger plan raises a request here, and a platform operator approves it after
    // collecting the money offline (UPI, bank transfer), which is the same model
    // affiliateSell already records. Approval is therefore a MONEY-MOVING action,
    // which is why it is separate from canRequestPlanChange and why the whole
    // lifecycle runs through this function rather than generic entity CRUD:
    // ENTITY_WRITE_ROLES.PlanChangeRequest is empty, and tenantBillingWriteRefused
    // refuses the Tenant fields it would otherwise write for any non-platform role.
    if (fnName === "planUpgrade") {
      const { action = "", ...payload } = req.body || {};
      const now = new Date().toISOString();

      // Apply a plan to a tenant and snapshot its quotas. ONE place, so the request
      // path and any future one cannot drift on which fields a plan implies.
      //
      // The period end is derived with addMonths + normalizeInterval rather than a
      // fresh month calculation: the plan's `billing_cycle` label is free text and
      // is not even self-consistent (the seeds write "month", the plan editor's
      // default is "monthly"), and normalizeInterval is already the tested rule for
      // turning that label into a month count. addMonths clamps the day, so a plan
      // approved on the 31st is due on the 28th/29th of the next month rather than
      // overflowing into the month after.
      const applyPlanToTenant = async (database, tenantId, plan) => {
        const periodEnd = addMonths(now, normalizeInterval(plan.billing_cycle));
        const fields = {
          subscription_plan_id: plan._id.toString(),
          plan_name: plan.name || "",
          // Quota snapshot. These two Tenant fields are what the student and OMR
          // guards read (Students.jsx, OMRUploadPanel), and nothing had ever
          // written them, so both guards were dead code. Writing them here is what
          // makes a plan limit enforceable at all.
          student_limit: plan.student_limit ?? null,
          omr_sheet_limit_per_month: plan.omr_sheet_limit ?? null,
          white_label_enabled: Boolean(plan.white_label_enabled),
          subscription_period_start: now,
          subscription_period_end: periodEnd,
          updated_date: now,
        };
        await database.collection("Tenant").updateOne(
          { _id: new ObjectId(String(tenantId)) },
          { $set: fields }
        );
        return fields;
      };

      // ---- submit ----------------------------------------------------------
      if (action === "submit") {
        if (!canRequestPlanChange(req)) {
          return res.status(403).json({ error: "Forbidden" });
        }
        // A tenant-less caller has no institution to upgrade. Checked explicitly
        // rather than inferred: /api/users/invite mints tenant-less accounts, so
        // holding the role does not imply having a school.
        const tenantId = req.user?.tenant_id;
        if (!tenantId) {
          return res.status(400).json({ error: "No institution is associated with this account" });
        }
        if (!ObjectId.isValid(String(payload.to_plan_id || ""))) {
          return res.status(400).json({ error: "A valid to_plan_id is required" });
        }
        const database3 = await db();
        const plan = await database3.collection("SubscriptionPlan").findOne({
          _id: new ObjectId(String(payload.to_plan_id)),
        });
        if (!plan) return res.status(404).json({ error: "Subscription plan not found" });

        const tenant = await database3.collection("Tenant").findOne({
          _id: new ObjectId(String(tenantId)),
        });
        if (!tenant) return res.status(404).json({ error: "Institution not found" });
        // Asking for the plan you already have is a mistake, not a request. Refused
        // rather than queued, so the approver's queue only holds real changes.
        if (tenant.subscription_plan_id && tenant.subscription_plan_id === plan._id.toString()) {
          return res.status(400).json({ error: "Your institution is already on this plan" });
        }

        const budget = await runLimit(() =>
          rateStore.incr({
            scope: RATE_LIMITS.planChangeRequest.scope,
            key: `tenant:${tenantId}`,
            windowMs: RATE_LIMITS.planChangeRequest.windowMs,
          })
        );
        if (budget.count > RATE_LIMITS.planChangeRequest.limit) {
          return tooMany(res, budget.resetAt);
        }

        // One live request per school. The unique partial index is the real
        // guarantee; this check is what turns a duplicate into a readable 409
        // instead of a raw duplicate-key error.
        const existing = await database3.collection("PlanChangeRequest").findOne({
          tenant_id: String(tenantId),
          status: "pending",
        });
        if (existing) {
          return res.status(409).json({
            error: "A plan change request is already pending for your institution",
            request_id: existing._id.toString(),
          });
        }

        // The from/to plan names and prices are SNAPSHOTS. A later edit to the
        // catalogue must not silently rewrite what was asked for or what was agreed.
        const doc = {
          tenant_id: String(tenantId),
          tenant_name: tenant.name || "",
          from_plan_id: tenant.subscription_plan_id || null,
          from_plan_name: tenant.plan_name || null,
          to_plan_id: plan._id.toString(),
          to_plan_name: plan.name || "",
          to_plan_price: Number(plan.price) || 0,
          to_plan_billing_cycle: plan.billing_cycle || "",
          reason: String(payload.reason || "").trim().slice(0, 500),
          status: "pending",
          requested_by: req.user._id.toString(),
          requested_by_email: req.user.email || "",
          requested_date: now,
          decided_by: null,
          decided_by_email: null,
          decided_date: null,
          decision_note: "",
          payment_id: null,
          created_date: now,
          updated_date: now,
        };
        const inserted = await database3.collection("PlanChangeRequest").insertOne(doc);
        await logServerAudit(req, {
          action: "plan_change_requested",
          entity_type: "PlanChangeRequest",
          entity_id: inserted.insertedId.toString(),
          details: `${tenant.name}: ${doc.from_plan_name || "no plan"} → ${doc.to_plan_name}`,
        });
        return res.status(201).json({
          success: true,
          request: out({ ...doc, _id: inserted.insertedId }),
        });
      }

      // ---- approve / reject / cancel ---------------------------------------
      // All three move the same lifecycle, so they share the load and the guards
      // below rather than repeating the lookup three times.
      if (!["approve", "reject", "cancel"].includes(action)) {
        return res.status(400).json({ error: `Unknown planUpgrade action '${action}'` });
      }
      const isApprover = canApprovePlanChanges(req);
      if (action === "cancel") {
        // Cancelling is the institution withdrawing its own request, so it needs the
        // REQUEST capability, not the approver one. It is additionally bounded to the
        // caller's own tenant below, so holding the role is not enough.
        if (!canRequestPlanChange(req)) return res.status(403).json({ error: "Forbidden" });
      } else if (!isApprover) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!ObjectId.isValid(String(payload.request_id || ""))) {
        return res.status(400).json({ error: "A valid request_id is required" });
      }

      const database3 = await db();
      const request = await database3.collection("PlanChangeRequest").findOne({
        _id: new ObjectId(String(payload.request_id)),
      });
      if (!request) return res.status(404).json({ error: "Plan change request not found" });

      // A canceller must own the request. Checked against the stored tenant_id and
      // never against a client-supplied one.
      if (action === "cancel" && request.tenant_id !== String(req.user?.tenant_id || "")) {
        return res.status(404).json({ error: "Plan change request not found" });
      }

      // The whole point of a queue is that two operators do not both approve it.
      // Approve below re-checks this with a conditional update, but refusing early
      // keeps the second caller from writing a Payment for a request someone else
      // already took.
      if (request.status !== "pending") {
        return res.status(409).json({
          error: `This request was already ${request.status}`,
        });
      }

      const note = String(payload.note || "").trim().slice(0, 500);

      if (action === "reject") {
        // A rejection with no reason is not actionable for the school, so the note is
        // required rather than optional here.
        if (!note) {
          return res.status(400).json({ error: "A reason is required when rejecting a plan change" });
        }
        await database3.collection("PlanChangeRequest").updateOne(
          { _id: request._id, status: "pending" },
          {
            $set: {
              status: "rejected",
              decision_note: note,
              decided_by: req.user._id.toString(),
              decided_by_email: req.user.email || "",
              decided_date: now,
              updated_date: now,
            },
          }
        );
        await logServerAudit(req, {
          action: "plan_change_rejected",
          entity_type: "PlanChangeRequest",
          entity_id: request._id.toString(),
          details: `${request.tenant_name} → ${request.to_plan_name}: ${note}`,
        });
        return res.json({ success: true });
      }

      if (action === "cancel") {
        await database3.collection("PlanChangeRequest").updateOne(
          { _id: request._id, status: "pending" },
          {
            $set: {
              status: "cancelled",
              decision_note: note,
              decided_by: req.user._id.toString(),
              decided_by_email: req.user.email || "",
              decided_date: now,
              updated_date: now,
            },
          }
        );
        await logServerAudit(req, {
          action: "plan_change_cancelled",
          entity_type: "PlanChangeRequest",
          entity_id: request._id.toString(),
          details: `${request.tenant_name} withdrew its request for ${request.to_plan_name}`,
        });
        return res.json({ success: true });
      }

      // ---- approve ----------------------------------------------------------
      // Money was collected offline before this call, so the amount and method are
      // captured from the operator and the ledger records it as collected — the same
      // honesty as affiliateSell's "recorded as collected rather than claiming a
      // gateway confirmed it".
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: "A valid amount is required" });
      }
      const paymentMethod = String(payload.payment_method || "").trim().slice(0, 60);
      if (!paymentMethod) {
        return res.status(400).json({ error: "A payment method is required" });
      }
      const plan = await database3.collection("SubscriptionPlan").findOne({
        _id: new ObjectId(String(request.to_plan_id)),
      });
      if (!plan) return res.status(404).json({ error: "Subscription plan not found" });
      const tenant = await database3.collection("Tenant").findOne({
        _id: new ObjectId(String(request.tenant_id)),
      });
      if (!tenant) return res.status(404).json({ error: "Institution not found" });
      // An operator may have already corrected this institution's plan through the
      // institutions console since the request was raised. Recording a payment for a
      // plan it is already on would book money against nothing.
      if (tenant.subscription_plan_id === plan._id.toString()) {
        return res.status(409).json({
          error: "This institution is already on the requested plan. Cancel the request instead",
        });
      }

      // Captured BEFORE any write so the rollback below can put them back. An
      // institution with no quota snapshot yet has `undefined` here, which is not the
      // same as null — hence the explicit hasOwnProperty test when restoring.
      const previous = {};
      for (const field of TENANT_BILLING_FIELDS) previous[field] = tenant[field];

      let paymentResult = null;
      try {
        await applyPlanToTenant(database3, request.tenant_id, plan);

        paymentResult = await database3.collection("Payment").insertOne({
          tenant_id: request.tenant_id,
          amount,
          currency: "INR",
          status: "paid",
          plan_name: plan.name || "",
          plan_id: plan._id.toString(),
          billing_cycle: plan.billing_cycle || "",
          payment_method: paymentMethod,
          // Offline collection: this records what an operator confirmed receiving,
          // not a gateway confirmation.
          provider: "offline_manual",
          request_id: request._id.toString(),
          recorded_by: req.user._id.toString(),
          recorded_by_email: req.user.email || "",
          period_start: now,
          period_end: addMonths(now, normalizeInterval(plan.billing_cycle)),
          created_date: now,
          updated_date: now,
        });

        // Conditional on status: "pending", so the second of two concurrent approvals
        // matches nothing and is refused rather than writing a second Payment.
        const claimed = await database3.collection("PlanChangeRequest").updateOne(
          { _id: request._id, status: "pending" },
          {
            $set: {
              status: "approved",
              applied_plan_id: plan._id.toString(),
              decision_note: note,
              payment_id: paymentResult.insertedId.toString(),
              decided_by: req.user._id.toString(),
              decided_by_email: req.user.email || "",
              decided_date: now,
              updated_date: now,
            },
          }
        );
        if (claimed.matchedCount !== 1) {
          throw Object.assign(new Error("Plan change request is no longer pending"), {
            status: 409,
            clientSafe: true,
          });
        }
      } catch (err) {
        // A half-approved upgrade is the worst outcome available here: the school has
        // the new plan's quotas with no payment recorded, or a payment with no
        // entitlement. Undo this branch's writes, newest first, exactly as
        // affiliateSell does for a half-minted institution.
        if (paymentResult) {
          await database3.collection("Payment")
            .deleteOne({ _id: paymentResult.insertedId })
            .catch(() => {});
        }
        await database3.collection("Tenant").updateOne(
          { _id: new ObjectId(String(request.tenant_id)) },
          {
            $set: { ...previous, updated_date: now },
            $unset: Object.fromEntries(
              TENANT_BILLING_FIELDS
                .filter((field) => !Object.prototype.hasOwnProperty.call(tenant, field))
                .map((field) => [field, ""])
            ),
          }
        ).catch(() => {});
        if (err.clientSafe) return res.status(err.status).json({ error: err.message });
        throw err;
      }

      await logServerAudit(req, {
        action: "plan_change_approved",
        entity_type: "PlanChangeRequest",
        entity_id: request._id.toString(),
        details: `${request.tenant_name} → ${plan.name} (₹${amount} ${paymentMethod})`,
      });
      await logServerAudit(req, {
        action: "plan_change_applied",
        entity_type: "Tenant",
        entity_id: request.tenant_id,
        details: `Plan ${plan.name} applied by ${req.user.email}`,
      });
      return res.json({
        success: true,
        payment_id: paymentResult.insertedId.toString(),
      });
    }

    // Two actions on one function, both scoped to the caller's OWN Affiliate
    // document.
    // document. The scoping is the whole design: an affiliate is denied by
    // readScope() for every generic entity read, so this route is the only way
    // they see anything, and every query below filters on the profile resolved
    // from req.user rather than on anything the client supplied. There is no
    // affiliate_id parameter anywhere in this handler, because there is nothing
    // the caller could put there that would be safe.
    if (fnName === "affiliateSell") {
      if (!canSellAsAffiliate(req)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const database2 = await db();
      // One profile per login: an account that somehow held the role without a
      // profile cannot sell, because there is no rate to compute a commission
      // from and no ledger to write to. Refused rather than defaulted to 0% —
      // a silent 0% would look to the affiliate like the system had lost their
      // rate, and would book a sale with no commission against it.
      const affiliate = await database2.collection("Affiliate").findOne({
        user_id: req.user._id.toString(),
      });
      if (!affiliate) {
        return res.status(404).json({ error: "No affiliate profile is set up for this account" });
      }
      // Suspension is the kill switch. Checked on EVERY action, not just the
      // selling one, so a suspended reseller's summary stops being current too.
      if (affiliate.status !== "active") {
        return res.status(403).json({ error: "This affiliate account is suspended" });
      }

      const { action = "summary", ...payload } = req.body || {};

      if (action === "summary") {
        const [sales, subscriptions] = await Promise.all([
          database2.collection("AffiliateSale")
            .find({ affiliate_id: affiliate._id.toString() })
            .sort({ created_date: -1 })
            .limit(200)
            .toArray(),
          database2.collection("Subscription")
            .find({ affiliate_id: affiliate._id.toString() })
            .sort({ next_due_at: 1 })
            .limit(200)
            .toArray(),
        ]);
        return res.json({
          affiliate: {
            id: affiliate._id.toString(),
            full_name: affiliate.full_name,
            email: affiliate.email,
            code: affiliate.code,
            commission_rate: affiliate.commission_rate,
            status: affiliate.status,
            // The reseller's own reminder policy, with defaults applied, so the portal
            // renders correctly for a profile created before this existed.
            ...affiliateReminderSettings(affiliate),
          },
          summary: summarizeSales(sales),
          sales: sales.map((doc) => present("AffiliateSale", doc, req)),
          subscriptions: subscriptions.map((doc) => presentSubscription(doc, req)),
        });
      }

      if (action !== "sell") {
        return res.status(400).json({ error: `Unknown affiliate action '${action}'` });
      }

      const schoolName = String(payload.school_name || "").trim();
      if (!schoolName) return res.status(400).json({ error: "Institution name is required" });

      const contactName = String(payload.school_contact_name || "").trim();
      if (!contactName) return res.status(400).json({ error: "School contact name is required" });

      const contactEmail = String(payload.school_contact_email || "").trim().toLowerCase();
      if (!EMAIL_PATTERN.test(contactEmail)) {
        return res.status(400).json({ error: "A valid school contact email is required" });
      }

      const contactPhone = String(payload.school_contact_phone || "").trim();

      if (!ObjectId.isValid(String(payload.plan_id || ""))) {
        return res.status(400).json({ error: "A valid plan_id is required" });
      }
      const plan = await database2.collection("SubscriptionPlan").findOne({
        _id: new ObjectId(String(payload.plan_id)),
      });
      if (!plan) return res.status(404).json({ error: "Subscription plan not found" });

      // Bounded per affiliate, not per IP: this mints a real Tenant and a real
      // school administrator login, so the budget that matters is how much of the
      // platform one reseller account can provision. A reseller behind a school
      // NAT must not be limited by whoever else shares that address.
      const sellLimit = await runLimit(() =>
        rateStore.incr({
          scope: RATE_LIMITS.affiliateSell.scope,
          key: `affiliate:${req.user._id.toString()}`,
          windowMs: RATE_LIMITS.affiliateSell.windowMs,
        })
      );
      if (sellLimit.count > RATE_LIMITS.affiliateSell.limit) {
        return tooMany(res, sellLimit.resetAt);
      }

      const subdomain = normalizeSubdomain(
        String(payload.tenant_subdomain || "").trim() || schoolName
      );
      assertSubdomainUsable(subdomain);
      await assertSubdomainAvailable(database2.collection("Tenant"), subdomain);

      // Checked before anything is written. The unique index on User is per
      // (tenant_id, email), so a second school with the same administrator email
      // would NOT trip it — which is why this has to be an explicit refusal.
      const adminEmailTaken = await database2.collection("User").findOne({ email: contactEmail });
      if (adminEmailTaken) {
        return res.status(409).json({ error: "That school contact email already has an account" });
      }

      const planPrice = Number(plan.price) || 0;
      // Snapshotted from the profile onto the sale. The affiliate's RATE is copied
      // rather than read at render time so that raising their rate later cannot
      // retroactively inflate what they earned on sales already made.
      const commissionRate = affiliate.commission_rate;
      const commissionAmount = computeCommission(planPrice, commissionRate);
      const schoolPassword = generateAffiliatePassword();

      const now = new Date().toISOString();
      let tenantResult = null;
      let adminResult = null;
      try {
        tenantResult = await database2.collection("Tenant").insertOne({
          name: schoolName,
          subdomain,
          subscription_plan_id: plan._id.toString(),
          plan_name: plan.name || "",
          status: "active",
          white_label_enabled: Boolean(plan.white_label_enabled),
          contact_email: contactEmail,
          contact_phone: contactPhone || null,
          address: String(payload.address || "").trim() || null,
          board_type: String(payload.board_type || "").trim() || null,
          // Attribution. This is what makes a school "an affiliate sale" rather
          // than just another tenant, and it is the only field that distinguishes
          // the two.
          affiliate_id: affiliate._id.toString(),
          created_date: now,
          updated_date: now,
        });
        const tenantId = tenantResult.insertedId.toString();

        // The school's administrator is written INLINE rather than through
        // provisionUser(), because provisionUser() gates a non-super_admin creator
        // onto its OWN tenant — and this creator has none. The affiliate's own
        // account is never touched: no $set on req.user anywhere in this branch,
        // so a reseller stays tenant-less and keeps no access to the school they
        // just created.
        adminResult = await database2.collection("User").insertOne({
          email: contactEmail,
          full_name: contactName,
          phone: contactPhone || null,
          password_hash: await bcrypt.hash(schoolPassword, 10),
          role: "user",
          app_role: APP_ROLES.SCHOOL_ADMIN,
          app_roles: [APP_ROLES.SCHOOL_ADMIN],
          tenant_id: tenantId,
          email_verified: true,
          must_change_password: true,
          created_date: now,
          updated_date: now,
        });

        const saleResult = await database2.collection("AffiliateSale").insertOne({
          affiliate_id: affiliate._id.toString(),
          affiliate_user_id: req.user._id.toString(),
          tenant_id: tenantId,
          tenant_name: schoolName,
          tenant_subdomain: subdomain,
          plan_id: plan._id.toString(),
          plan_name: plan.name || "",
          plan_price: planPrice,
          billing_cycle: plan.billing_cycle || "",
          school_contact_name: contactName,
          school_contact_email: contactEmail,
          school_contact_phone: contactPhone || null,
          amount: planPrice,
          commission_rate: commissionRate,
          commission_amount: commissionAmount,
          // Credited immediately, per the agreed model: the affiliate's balance
          // moves the moment the sale exists. Approval is what makes it PAYABLE,
          // so a super admin still holds the checkpoint before money leaves.
          status: "pending",
          admin_note: "",
          approved_date: null,
          paid_date: null,
          created_date: now,
          updated_date: now,
        });

        // Money was collected offline (UPI/bank) before this call, so the ledger
        // records it as collected rather than claiming a gateway confirmed it.
        //
        // `paid_at` is written separately from `created_date` because they are
        // different facts the moment this row is not written at the instant of
        // collection: a renewal Payment is recorded later, and the subscription
        // period has to start when the money arrived, not when somebody typed.
        await database2.collection("Payment").insertOne({
          tenant_id: tenantId,
          affiliate_id: affiliate._id.toString(),
          amount: planPrice,
          currency: "INR",
          status: "paid",
          plan_name: plan.name || "",
          plan_id: plan._id.toString(),
          billing_cycle: plan.billing_cycle || "",
          payment_method: String(payload.payment_method || "Offline (UPI/Bank)").slice(0, 60),
          kind: "subscription",
          paid_at: now,
          created_date: now,
          updated_date: now,
        });

        // The subscription is the RENEWING thing; the sale above is a one-off money
        // event that happens to start it. They are separate documents because only one
        // of them repeats — the sale is written once and never touched again, while
        // `paid_through` moves every month for the life of the institution.
        //
        // Both policy fields are SNAPSHOT here, exactly like the commission rate on the
        // sale. A super admin who later switches an affiliate to recurring commission,
        // or corrects their rate, must not retroactively rewrite what a subscription
        // that already started was sold on.
        const subscriptionStartedAt = now;
        const subscriptionDoc = {
          affiliate_id: affiliate._id.toString(),
          affiliate_user_id: req.user._id.toString(),
          tenant_id: tenantId,
          tenant_name: schoolName,
          tenant_subdomain: subdomain,
          plan_id: plan._id.toString(),
          plan_name: plan.name || "",
          plan_price: planPrice,
          currency: "INR",
          billing_cycle: plan.billing_cycle || "",
          interval_months: normalizeInterval(plan.billing_cycle),
          commission_mode: normalizeCommissionMode(affiliate.commission_mode),
          commission_rate: commissionRate,
          sale_id: saleResult.insertedId.toString(),
          contact: {
            name: contactName,
            email: contactEmail,
            phone: contactPhone || null,
          },
          subscription_started_at: subscriptionStartedAt,
          // The first payment covers the period from today to the end of that month,
          // so `paid_through` IS the start date and the due date is derived from it.
          paid_through: subscriptionStartedAt,
          next_due_at: null,
          status: "active",
          created_date: now,
          updated_date: now,
        };
        subscriptionDoc.next_due_at = computePeriod(subscriptionDoc)?.nextDueAt || null;
        const subscriptionResult = await database2.collection("Subscription").insertOne(subscriptionDoc);

        await logServerAudit(req, {
          action: "affiliate_sale",
          entity_type: "AffiliateSale",
          entity_id: saleResult.insertedId.toString(),
          details: `${schoolName} on ${plan.name} — ₹${commissionAmount} at ${commissionRate}%`,
        });
        await logServerAudit(req, {
          action: "affiliate_sale_tenant",
          entity_type: "Tenant",
          entity_id: tenantId,
          details: `Affiliate sale by ${affiliate.email}`,
        });

        return res.status(201).json({
          success: true,
          tenant: out({ _id: tenantResult.insertedId, name: schoolName, subdomain }),
          sale: out({ _id: saleResult.insertedId, commission_amount: commissionAmount, commission_rate: commissionRate, amount: planPrice }),
          // The period the sale bought. Returned so the portal can show "due on"
          // immediately without a second round trip.
          subscription: out({
            _id: subscriptionResult.insertedId,
            plan_name: subscriptionDoc.plan_name,
            subscription_started_at: subscriptionDoc.subscription_started_at,
            paid_through: subscriptionDoc.paid_through,
            next_due_at: subscriptionDoc.next_due_at,
            commission_mode: subscriptionDoc.commission_mode,
          }),
          // Returned once. The affiliate hands this to the school; it is not
          // stored in plaintext and cannot be retrieved afterwards.
          school_admin_password: schoolPassword,
        });
      } catch (err) {
        // A half-minted institution is worse than a refused sale: a Tenant with
        // no administrator cannot be onboarded, and a sale row for it would
        // book commission against a sale that cannot be delivered. Undo every
        // write this branch made, newest first.
        if (adminResult) {
          await database2.collection("User").deleteOne({ _id: adminResult.insertedId }).catch(() => {});
        }
        if (tenantResult) {
          await database2.collection("Subscription")
            .deleteMany({ tenant_id: tenantResult.insertedId.toString() })
            .catch(() => {});
          await database2.collection("AffiliateSale")
            .deleteMany({ tenant_id: tenantResult.insertedId.toString() })
            .catch(() => {});
          await database2.collection("Payment")
            .deleteMany({ tenant_id: tenantResult.insertedId.toString() })
            .catch(() => {});
          await database2.collection("Tenant").deleteOne({ _id: tenantResult.insertedId }).catch(() => {});
        }
        throw err;
      }
    }

    if (fnName === "processOMRSheet" || fnName === "processOmrSheet") {
      if (!examWorkflow(req)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { omr_sheet_id, override_student_id } = req.body || {};
      if (!omr_sheet_id) return res.status(400).json({ error: "omr_sheet_id is required" });
      const sheet = await database.collection("OMRSheet").findOne({ _id: new ObjectId(omr_sheet_id) });
      if (!sheet) return res.status(404).json({ error: "OMR Sheet not found" });
      assertTenantOwnership(req, sheet);

      // Optional identity override (teacher review flow): re-assign the sheet to a
      // specific student from the examination roster without re-scanning the image.
      let identityOverrideActive = false;
      let overrideStudentId = null;
      if (typeof override_student_id === "string" && override_student_id) {
        const overrideStudent = await database.collection("Student").findOne({
          _id: new ObjectId(override_student_id),
          tenant_id: sheet.tenant_id,
        });
        if (!overrideStudent) {
          return res.status(400).json({ error: "Override student not found in this tenant" });
        }
        identityOverrideActive = true;
        overrideStudentId = override_student_id;
      }

      if (!sheet.examination_id) {
        return res.status(400).json({ error: "OMR Sheet has no associated examination" });
      }
      const exam = await database.collection("Examination").findOne({ _id: new ObjectId(sheet.examination_id) });
      if (!exam) return res.status(404).json({ error: "Examination not found" });
      assertTenantOwnership(req, exam);

      // Override must be a student on the examination's authoritative roster
      // (year/class-scoped, mirroring identityResolver semantics).
      if (identityOverrideActive) {
        const inRoster = await studentInExamRoster({
          tenantId: exam.tenant_id,
          examinationId: String(exam._id.toString()),
          studentId: String(override_student_id),
        });
        if (!inRoster) {
          return res.status(400).json({ error: "Override student is not enrolled in this examination" });
        }
      }

      if (sheet.student_id) {
        const student = await database.collection("Student").findOne({ _id: new ObjectId(sheet.student_id) });
        if (student) {
          assertTenantOwnership(req, student);
        }
      }

      const numQuestions = Number(exam.num_questions || exam.number_of_questions) || 50;
      const optionCount = Number(exam.options_per_question) || 4;
      const options = ["A", "B", "C", "D", "E"].slice(0, optionCount);

      // Look up the answer key for this sheet's paper set (strictly tenant-scoped)
      const paperSet = sheet.paper_set || "A";
      const answerKey = await database.collection("AnswerKey").findOne({
        examination_id: sheet.examination_id,
        paper_set: paperSet,
        tenant_id: exam.tenant_id,
      }) || await database.collection("AnswerKey").findOne({
        examination_id: sheet.examination_id,
        tenant_id: exam.tenant_id,
      });
      const keyAnswers = answerKey?.answers || {};

      const isExplicitMock = process.env.OMR_ENGINE_MODE === "mock";
      const isNoImageFixture = !sheet.image_url;

      let extractedAnswers = {};
      let confidenceScores = {};
      let questionResults = {};
      let flaggedQuestions = [];
      let engineUsed = "opencv";
      let engineVersion = "1.0.0";
      let selectedTemplateId = sheet.template_id || exam.template_id;
      if (!selectedTemplateId) {
        selectedTemplateId = numQuestions <= 20 ? "a4_20q_4opt_v1" : numQuestions <= 50 ? "a4_50q_4opt_v1" : "a4_100q_4opt_v1";
      }
      let annotatedImageUrl = null;
      let annotatedFilename = null;
      let capturedAdmissionDetection = null;
      let numDigitsForEngine = 6;

      // Determine tenant-level num_digits override (from tenant doc or runtime config)
      const tenantDocForGrid = await database.collection("Tenant").findOne({ _id: new ObjectId(exam.tenant_id) }).catch(() => null);
      if (tenantDocForGrid?.admission_number_num_digits && Number(tenantDocForGrid.admission_number_num_digits) > 0) {
        numDigitsForEngine = Number(tenantDocForGrid.admission_number_num_digits);
      }

      if (!identityOverrideActive && !isExplicitMock && !isNoImageFixture) {
        // --- REAL PYTHON + OPENCV COMPUTER VISION PIPELINE ---
        const resolvedImagePath = await stageOmrFile(sheet.image_url, sheet.tenant_id);
        if (!resolvedImagePath) {
          await database.collection("OMRSheet").updateOne(
            { _id: new ObjectId(omr_sheet_id) },
            {
              $set: {
                status: "failed",
                processing_status: "failed",
                error_code: "IMAGE_NOT_FOUND",
                error_details: "OMR image file could not be resolved on the server",
                processed_at: new Date().toISOString(),
                updated_date: new Date().toISOString(),
              },
            }
          );
          await logServerAudit(req, {
            action: "process_omr",
            entity_type: "OMRSheet",
            entity_id: omr_sheet_id,
            details: "status=failed error_code=IMAGE_NOT_FOUND",
          });
          return res.status(422).json({
            success: false,
            error: "OMR image file could not be found or resolved",
            error_code: "IMAGE_NOT_FOUND",
          });
        }

        annotatedFilename = `${crypto.randomUUID()}.png`;
        const inS3Mode = s3.getStorage().mode === "s3";
        let annotatedFilePath;
        if (inS3Mode) {
          // CV engine writes the annotation to OS-temp; pushed to S3 after the run.
          ensureOmrScratchDir();
          annotatedFilePath = omrScratchPath(annotatedFilename);
        } else {
          const tenantUploadDir = path.join(privateUploadsDir, sheet.tenant_id);
          fs.mkdirSync(tenantUploadDir, { recursive: true });
          annotatedFilePath = path.join(tenantUploadDir, annotatedFilename);
        }

        try {
          const { result: cvResult } = await runOmrEvaluator({
            imagePath: resolvedImagePath,
            templateId: selectedTemplateId,
            numQuestions,
            numOptions: optionCount,
            annotatedPath: annotatedFilePath,
            numDigits: numDigitsForEngine,
          });

          capturedAdmissionDetection = cvResult.admission_number_detection || null;

          extractedAnswers = cvResult.extracted_answers || cvResult.answers || {};
          questionResults = cvResult.question_results || {};
          flaggedQuestions = cvResult.flagged_questions || [];
          engineUsed = cvResult.engine || "opencv";
          engineVersion = cvResult.engine_version || "1.0.0";
          selectedTemplateId = cvResult.template_id || selectedTemplateId;

          for (const [qStr, qRes] of Object.entries(questionResults)) {
            confidenceScores[qStr] = qRes.confidence ?? 0.8;
          }

          if (fs.existsSync(annotatedFilePath)) {
            if (inS3Mode) {
              await s3.putObject({
                Key: s3.privateKey(sheet.tenant_id, annotatedFilename),
                Body: fs.createReadStream(annotatedFilePath),
                ContentType: "image/png",
              });
              try { fs.unlinkSync(annotatedFilePath); } catch {}
            }
            annotatedImageUrl = `/api/files/${annotatedFilename}?token=${signFileToken(sheet.tenant_id, annotatedFilename)}`;
          }
        } catch (cvErr) {
          const errorCode = cvErr.code || cvErr.payload?.error_code || "OMR_PROCESSING_FAILED";
          const errorDetails = cvErr.payload?.error_message || cvErr.message;
          const markersFound = cvErr.payload?.markers_found ?? null;

          if (inS3Mode) {
            try {
              await s3.deleteObject(s3.privateKey(sheet.tenant_id, annotatedFilename));
            } catch {}
          }
          if (fs.existsSync(annotatedFilePath)) {
            try { fs.unlinkSync(annotatedFilePath); } catch {}
          }

          await database.collection("OMRSheet").updateOne(
            { _id: new ObjectId(omr_sheet_id) },
            {
              $set: {
                status: "failed",
                processing_status: "failed",
                error_code: errorCode,
                error_details: errorDetails,
                ...(markersFound != null && { markers_found: markersFound }),
                processed_at: new Date().toISOString(),
                updated_date: new Date().toISOString(),
              },
            }
          );

          await logServerAudit(req, {
            action: "process_omr",
            entity_type: "OMRSheet",
            entity_id: omr_sheet_id,
            details: `status=failed error_code=${errorCode}`,
          });

          return res.status(422).json({
            success: false,
            error: `OMR processing failed: ${errorCode}`,
            error_code: errorCode,
            details: errorDetails,
            markers_found: markersFound,
          });
        }
      } else if (!identityOverrideActive) {
        // --- DETERMINISTIC MOCK PIPELINE (Development / No-Image Fixtures Only) ---
        engineUsed = "mock";
        const hashFloat = (seed) => {
          const hash = crypto.createHash("sha256").update(seed).digest();
          return (hash.readUInt32BE(0) % 10000) / 10000;
        };

        const sheetSeed = omr_sheet_id;
        for (let q = 1; q <= numQuestions; q++) {
          const qSeed = `${sheetSeed}-q${q}`;
          const h = hashFloat(qSeed);
          const confSeed = `${sheetSeed}-conf${q}`;
          const rawConf = hashFloat(confSeed);
          const confidence = +(0.45 + rawConf * 0.55).toFixed(3);

          const correctAns = keyAnswers[String(q)] || keyAnswers[q];

          if (confidence >= 0.65) {
            if (correctAns) {
              if (h < 0.92) {
                extractedAnswers[String(q)] = correctAns;
              } else {
                const wrongIdx = Math.floor(h * options.length) % options.length;
                const picked = options[wrongIdx];
                extractedAnswers[String(q)] = picked === correctAns ? options[(wrongIdx + 1) % options.length] : picked;
              }
            } else {
              extractedAnswers[String(q)] = options[Math.floor(h * options.length)];
            }
          } else {
            flaggedQuestions.push(q);
            if (correctAns) {
              if (h < 0.60) {
                extractedAnswers[String(q)] = correctAns;
              } else {
                const wrongIdx = Math.floor(h * options.length) % options.length;
                const picked = options[wrongIdx];
                extractedAnswers[String(q)] = picked === correctAns ? options[(wrongIdx + 1) % options.length] : picked;
              }
            } else {
              extractedAnswers[String(q)] = options[Math.floor(h * options.length)];
            }
          }
          confidenceScores[String(q)] = confidence;
          questionResults[String(q)] = {
            answer: extractedAnswers[String(q)] || null,
            confidence,
            status: confidence >= 0.65 ? "detected" : "ambiguous",
          };
        }

        for (let q = 1; q <= numQuestions; q++) {
          const blankSeed = `${sheetSeed}-blank${q}`;
          if (hashFloat(blankSeed) < 0.03) {
            extractedAnswers[String(q)] = "";
            confidenceScores[String(q)] = 0.95;
            if (questionResults[String(q)]) {
              questionResults[String(q)].answer = null;
              questionResults[String(q)].status = "blank";
            }
            const idx = flaggedQuestions.indexOf(q);
            if (idx !== -1) flaggedQuestions.splice(idx, 1);
          }
        }
      }

      // --- Identity override: preserve answers already extracted by the prior scan ---
      if (identityOverrideActive) {
        extractedAnswers = sheet.extracted_answers || sheet.answers || {};
        questionResults = sheet.question_results || {};
        confidenceScores = sheet.confidence_scores || {};
        flaggedQuestions = sheet.flagged_questions || [];
        engineUsed = sheet.engine || engineUsed;
        engineVersion = sheet.engine_version || engineVersion;
        annotatedImageUrl = sheet.annotated_image_url || null;
        annotatedFilename = sheet.annotated_filename || null;
        selectedTemplateId = sheet.template_id || selectedTemplateId;
      }

      // --- Sheet Dedup: image SHA-256 hash ---
      let imageSha256 = null;
      let redundantDuplicate = false;
      if (!isExplicitMock && !isNoImageFixture) {
        try {
          const resolvedImagePath = await stageOmrFile(sheet.image_url, sheet.tenant_id);
          if (resolvedImagePath && fs.existsSync(resolvedImagePath)) {
            imageSha256 = crypto.createHash("sha256").update(fs.readFileSync(resolvedImagePath)).digest("hex");
            const existingDuplicate = await database.collection("OMRSheet").findOne({
              examination_id: sheet.examination_id,
              image_sha256: imageSha256,
              _id: { $ne: new ObjectId(omr_sheet_id) },
              is_active: { $ne: false },
            });
            if (existingDuplicate) {
              redundantDuplicate = true;
            }
          }
        } catch (_e) {
          // hash computation is best-effort; do not block processing
        }
      }

      // --- Admission Number Detection (from CV engine or mock) ---
      let admissionNumberDetection = capturedAdmissionDetection || null;

      if (isExplicitMock || isNoImageFixture) {
        // Deterministic mock: derive a fake admission number from sheet id for dev/testing
        const mockHash = crypto.createHash("sha256").update(`${omr_sheet_id}-adm`).digest();
        const mockAdm = String(mockHash.readUInt32BE(0) % 1000000).padStart(6, "0");
        admissionNumberDetection = {
          raw: mockAdm,
          canonical: mockAdm,
          status: "detected",
          column_details: [],
        };
      }

      if (redundantDuplicate) {
        await database.collection("OMRSheet").updateOne(
          { _id: new ObjectId(omr_sheet_id) },
          {
            $set: {
              status: "rejected",
              processing_status: "rejected",
              error_code: "DUPLICATE_FILE_UPLOAD",
              error_details: "This image is an identical duplicate of an already-processed OMR sheet for this examination.",
              processed_at: new Date().toISOString(),
              updated_date: new Date().toISOString(),
            },
          }
        );
        await logServerAudit(req, {
          action: "process_omr",
          entity_type: "OMRSheet",
          entity_id: omr_sheet_id,
          details: "status=rejected error_code=DUPLICATE_FILE_UPLOAD",
        });
        return res.status(409).json({
          success: false,
          error: "Duplicate OMR sheet image rejected",
          error_code: "DUPLICATE_FILE_UPLOAD",
        });
      }

      // --- Identity Resolution ---
      let resolved;
      if (identityOverrideActive && overrideStudentId) {
        resolved = { identity_status: "matched", student_id: overrideStudentId, reason: null };
      } else {
        resolved = await resolveStudentIdentity({
          tenantId: exam.tenant_id,
          examinationId: sheet.examination_id,
          admissionNumberDetection,
          db: database,
        });
      }

      const identityStatus = resolved.identity_status;
      let studentId = sheet.student_id || resolved.student_id || null;
      let matched = identityStatus === "matched";

      // ---- Deterministic Replace & Archive ----
      if (studentId) {
        await database.collection("OMRSheet").updateMany(
          {
            examination_id: sheet.examination_id,
            student_id: studentId,
            _id: { $ne: new ObjectId(omr_sheet_id) },
          },
          {
            $set: {
              is_active: false,
              status: "archived_superseded",
              updated_date: new Date().toISOString(),
            },
          }
        );
      }

      const status = identityStatus === "needs_review" || flaggedQuestions.length > 0 ? "needs_review" : "completed";
      const processingStatus = flaggedQuestions.length > 0 ? "review_required" : "completed";
      const evaluationStatus = flaggedQuestions.length > 0 ? "needs_review" : identityStatus === "needs_review" ? "pending_identity" : "completed";
      const attendanceStatus = identityStatus === "matched" ? "present" : identityStatus === "needs_review" ? "needs_review" : "unmarked";

      // ---- Attendance recording: matched → present; pre-linked misread → needs_review ----
      let attendanceRecorded = false;
      if (identityStatus === "matched" && studentId) {
        await recordExamAttendance({
          tenant_id: exam.tenant_id,
          examination_id: sheet.examination_id,
          student_id: studentId,
          omr_sheet_id,
          status: "present",
        });
        attendanceRecorded = true;
      } else if (identityStatus === "needs_review" && studentId) {
        // A sheet pre-linked to a student but with unreadable bubbles must NOT be
        // silently swept to absent by reconciliation. Persist an explicit
        // needs_review attendance marker for that student.
        await recordExamAttendance({
          tenant_id: exam.tenant_id,
          examination_id: sheet.examination_id,
          student_id: studentId,
          omr_sheet_id,
          status: "needs_review",
        });
        attendanceRecorded = true;
      }

      // ---- Grade & upsert Result when matched ----
      let gradedResult = null;
      if (identityStatus === "matched" && studentId) {
        const numQ = Number(exam.num_questions || exam.number_of_questions) || 50;
        const maxMarks = Number(exam.max_marks) || (numQ * (Number(exam.marks_per_question) || 1));
        const marksPerQuestion = exam.marks_per_question != null && Number(exam.marks_per_question) > 0
          ? Number(exam.marks_per_question)
          : (maxMarks && numQ ? +(maxMarks / numQ).toFixed(4) : 1);
        const negativeMarks = Number(exam.negative_marks || exam.negative_mark_value) || 0;
        const passingMarks = exam.passing_marks != null ? Number(exam.passing_marks) : Math.round(maxMarks * 0.33);

        let correctCount = 0;
        let incorrectCount = 0;
        let blankCount = 0;
        const responses = extractedAnswers;

        for (let q = 1; q <= numQ; q++) {
          const studentAns = responses[String(q)] || responses[q] || "";
          const correctAns = keyAnswers[String(q)] || keyAnswers[q] || "";
          if (!studentAns) {
            blankCount++;
          } else if (correctAns && studentAns === correctAns) {
            correctCount++;
          } else {
            incorrectCount++;
          }
        }

        const score = Math.max(0, +(correctCount * marksPerQuestion - incorrectCount * negativeMarks).toFixed(2));
        const percentage = +((score / maxMarks) * 100).toFixed(2);

        let grade = "F";
        if (percentage >= 90) grade = "A+";
        else if (percentage >= 80) grade = "A";
        else if (percentage >= 70) grade = "B+";
        else if (percentage >= 60) grade = "B";
        else if (percentage >= 50) grade = "C";
        else if (percentage >= 33) grade = "D";

        const nowForResult = new Date().toISOString();
        gradedResult = {
          examination_id: sheet.examination_id,
          student_id: studentId,
          tenant_id: exam.tenant_id,
          omr_sheet_id,
          total_marks: score,
          percentage,
          grade,
          passed: score >= passingMarks,
          correct_count: correctCount,
          correct_answers: correctCount,
          wrong_count: incorrectCount,
          incorrect_answers: incorrectCount,
          skipped_count: blankCount,
          unattempted: blankCount,
          status: "draft",
          created_date: nowForResult,
          updated_date: nowForResult,
        };

        await database.collection("Result").updateOne(
          { tenant_id: exam.tenant_id, examination_id: sheet.examination_id, student_id: studentId },
          { $set: gradedResult },
          { upsert: true }
        );
      }

      const updated = await database.collection("OMRSheet").findOneAndUpdate(
        { _id: new ObjectId(omr_sheet_id) },
        {
          $set: {
            answers: extractedAnswers,
            extracted_answers: extractedAnswers,
            confidence_scores: confidenceScores,
            question_results: questionResults,
            ...(studentId && { student_id: studentId }),
            status,
            processing_status: processingStatus,
            engine: engineUsed,
            engine_version: engineVersion,
            template_id: selectedTemplateId,
            flagged_questions: flaggedQuestions,
            flagged_count: flaggedQuestions.length,
            annotated_image_url: annotatedImageUrl,
            annotated_filename: annotatedImageUrl ? annotatedFilename : null,
            matched,
            identity_status: identityStatus,
            attendance_status: attendanceStatus,
            evaluation_status: evaluationStatus,
            admission_number_detection: admissionNumberDetection,
            attendance_recorded: attendanceRecorded,
            ...(resolved.reason && { match_error: resolved.reason }),
            ...(imageSha256 && { image_sha256: imageSha256 }),
            processed_at: new Date().toISOString(),
            updated_date: new Date().toISOString(),
          },
        },
        { returnDocument: "after" }
      );

      await logServerAudit(req, {
        action: "process_omr",
        entity_type: "OMRSheet",
        entity_id: omr_sheet_id,
        details: `status=${status} identity=${identityStatus} flagged=${flaggedQuestions.length} engine=${engineUsed}`,
      });

      return res.json({
        success: true,
        sheet: out(updated),
        matched,
        identity_status: identityStatus,
        attendance_status: attendanceStatus,
        evaluation_status: evaluationStatus,
        match_error: resolved.reason || null,
        attempted_admission_number: resolved.attempted_adm || null,
        admission_number_detection: admissionNumberDetection,
        processing_status: processingStatus,
        flagged_count: flaggedQuestions.length,
        total_questions: numQuestions,
        avg_confidence: +(
          Object.values(confidenceScores).reduce((a, b) => a + b, 0) /
          (Object.keys(confidenceScores).length || 1)
        ).toFixed(3),
        annotated_image_url: annotatedImageUrl,
      });
    }

    if (fnName === "evaluateExamination") {
      if (!examWorkflow(req)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { examination_id } = req.body || {};
      if (!examination_id) return res.status(400).json({ error: "examination_id is required" });

      const exam = await database.collection("Examination").findOne({ _id: new ObjectId(examination_id) });
      if (!exam) return res.status(404).json({ error: "Examination not found" });
      assertTenantOwnership(req, exam);

      // Find the answer key — strictly scoped to examination tenant
      const answerKeyDoc = await database.collection("AnswerKey").findOne({ examination_id, tenant_id: exam.tenant_id }) ||
        await database.collection("AnswerKey").findOne({ examination_id });
      if (answerKeyDoc && answerKeyDoc.tenant_id && answerKeyDoc.tenant_id !== exam.tenant_id) {
        return res.status(403).json({ error: "AnswerKey does not belong to examination tenant" });
      }
      const keyAnswers = answerKeyDoc?.answers || {};
      const sheets = await database.collection("OMRSheet").find({ examination_id, student_id: { $exists: true, $ne: null } }).toArray();

      // Authoritative roster gate: only sheets whose assigned student is on the
      // persisted ExamRoster may produce a Result. Sheets re-assigned to a
      // non-roster student (stale or bypassed) are never evaluated.
      const rosterIds = new Set(await getExamRosterStudentIds({
        tenantId: exam.tenant_id,
        examinationId: String(examination_id),
      }));

      // Only evaluate sheets that completed OMR recognition with confident
      // answers. Sheets awaiting manual review (needs_review) are NEVER graded
      // automatically — fabricated/low-confidence reads must not affect results.
      const evaluableSheets = sheets.filter(
        (s) =>
          s.status === "completed" &&
          s.processing_status === "completed" &&
          rosterIds.has(String(s.student_id)) &&
          (s.extracted_answers || s.answers)
      );

      const reviewedPending = sheets.filter(
        (s) => s.status === "needs_review" || s.processing_status === "review_required"
      ).length;

      if (evaluableSheets.length === 0) {
        return res.json({
          success: true,
          count: 0,
          results: [],
          message: reviewedPending > 0
            ? `${reviewedPending} OMR sheet(s) still need manual review before evaluation.`
            : "No completed OMR sheets with assigned students found.",
        });
      }

      const numQ = Number(exam.num_questions || exam.number_of_questions) || 50;
      const maxMarks = Number(exam.max_marks) || (numQ * (Number(exam.marks_per_question) || 1));
      const marksPerQuestion = exam.marks_per_question != null && Number(exam.marks_per_question) > 0
        ? Number(exam.marks_per_question)
        : (maxMarks && numQ ? +(maxMarks / numQ).toFixed(4) : 1);
      const negativeMarks = Number(exam.negative_marks || exam.negative_mark_value) || 0;
      const passingMarks = exam.passing_marks != null ? Number(exam.passing_marks) : Math.round(maxMarks * 0.33);

      const calculatedResults = [];

      for (const sheet of evaluableSheets) {
        if (sheet.tenant_id && sheet.tenant_id !== exam.tenant_id) continue;
        const student = await database.collection("Student").findOne({ _id: new ObjectId(sheet.student_id) });
        if (!student || (student.tenant_id && student.tenant_id !== exam.tenant_id)) continue;

        let correctCount = 0;
        let incorrectCount = 0;
        let blankCount = 0;
        // Prefer extracted_answers (reviewed/corrected) over raw answers
        const responses = sheet.extracted_answers || sheet.answers || {};

        for (let q = 1; q <= numQ; q++) {
          // Use string keys consistently to avoid numeric/string mismatch
          const studentAns = responses[String(q)] || responses[q] || "";
          const correctAns = keyAnswers[String(q)] || keyAnswers[q] || "";
          if (!studentAns) {
            blankCount++;
          } else if (correctAns && studentAns === correctAns) {
            correctCount++;
          } else {
            incorrectCount++;
          }
        }

        const score = Math.max(0, +(correctCount * marksPerQuestion - incorrectCount * negativeMarks).toFixed(2));
        const percentage = +((score / maxMarks) * 100).toFixed(2);

        let grade = "F";
        if (percentage >= 90) grade = "A+";
        else if (percentage >= 80) grade = "A";
        else if (percentage >= 70) grade = "B+";
        else if (percentage >= 60) grade = "B";
        else if (percentage >= 50) grade = "C";
        else if (percentage >= 33) grade = "D";

        calculatedResults.push({
          examination_id,
          student_id: sheet.student_id,
          tenant_id: exam.tenant_id,
          omr_sheet_id: sheet._id.toString(),
          total_marks: score,
          percentage,
          grade,
          passed: score >= passingMarks,
          correct_count: correctCount,
          correct_answers: correctCount,
          wrong_count: incorrectCount,
          incorrect_answers: incorrectCount,
          skipped_count: blankCount,
          unattempted: blankCount,
          status: "draft",
          created_date: new Date().toISOString(),
          updated_date: new Date().toISOString(),
        });
      }

      // Sort by total marks desc and assign ranks
      calculatedResults.sort((a, b) => b.total_marks - a.total_marks);
      calculatedResults.forEach((r, idx) => {
        r.rank = idx + 1;
      });

      // Calculate percentiles
      const n = calculatedResults.length;
      calculatedResults.forEach((r, idx) => {
        const below = n - idx - 1;
        r.percentile = n > 1 ? +((below / (n - 1)) * 100).toFixed(2) : 100;
      });

      // Upsert into Result collection — strictly tenant-scoped filter so a result
      // can never be overwritten from another tenant's view of the exam.
      for (const resDoc of calculatedResults) {
        await database.collection("Result").updateOne(
          {
            examination_id: resDoc.examination_id,
            student_id: resDoc.student_id,
            tenant_id: resDoc.tenant_id,
          },
          { $set: resDoc },
          { upsert: true }
        );
      }

      // Update examination status to evaluated
      await database.collection("Examination").updateOne(
        { _id: new ObjectId(examination_id) },
        { $set: { status: "evaluated", updated_date: new Date().toISOString() } }
      );

      await logServerAudit(req, {
        action: "evaluate",
        entity_type: "Examination",
        entity_id: examination_id,
        details: `${calculatedResults.length} results evaluated for ${exam.name || ""}`,
      });

      return res.json({ success: true, count: calculatedResults.length, results: calculatedResults });
    }

    if (fnName === "verifyCustomDomain") {
      // The domain lifecycle writes the Tenant, so it follows the same gate.
      if (!canWriteEntity(req, "Tenant", "update")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { custom_domain, domain, tenant_id } = req.body || {};
      const targetId = platform(req) ? (tenant_id || req.user.tenant_id) : req.user.tenant_id;
      if (!targetId) return res.status(400).json({ error: "Tenant is required" });

      const host = normalizeHost(custom_domain || domain || "");
      if (!host) {
        return res.status(400).json({ error: "Enter a valid domain, e.g. exam.yourschool.edu" });
      }

      // A normalized domain belongs to exactly one tenant — including while it's
      // still pending, since the write below reserves it for this tenant.
      await assertCustomDomainAvailable(database.collection("Tenant"), host, targetId);

      const checkedAt = new Date().toISOString();
      const dns = await domainVerifier.checkChain(host);
      if (!dns.verified) {
        await database.collection("Tenant").updateOne(
          { _id: new ObjectId(targetId) },
          {
            $set: {
              custom_domain: host,
              custom_domain_verified: false,
              custom_domain_status: "pending",
              custom_domain_checked_at: checkedAt,
              custom_domain_live_at: null,
              dns_status: "failed",
              tls_status: "pending",
              hosting_status: HOSTING_STATUS.NOT_CONFIGURED,
              hosting_provider: getHostingProvider().name,
              updated_date: checkedAt,
            },
          }
        );
        return res.json({
          success: false,
          verified: false,
          live: false,
          reason: dns.reason,
          dns_status: "failed",
          tls_status: "pending",
          found_record: dns.record,
          message:
            dns.reason === REASONS.DNS_TARGET_MISMATCH && dns.record
              ? `A DNS record (${dns.record}) is set for ${host}, but it doesn't point to ${PLATFORM_CNAME_TARGET}. Check the CNAME value and re-verify.`
              : `We couldn't find a DNS record pointing ${host} to ${PLATFORM_CNAME_TARGET}. Check the CNAME value and DNS propagation, then re-verify.`,
        });
      }

      const probe = await domainVerifier.probeDomain(host);
      const live = probe.live;
      const liveAt = new Date().toISOString();
      const tls_status = live ? "ready" : probe.reason === REASONS.TLS_FAILED ? "failed" : "pending";
      await database.collection("Tenant").updateOne(
        { _id: new ObjectId(targetId) },
        {
          $set: {
            custom_domain: host,
            custom_domain_verified: true,
            custom_domain_status: live ? "live" : "verified",
            custom_domain_checked_at: checkedAt,
            custom_domain_live_at: live ? liveAt : null,
            dns_status: "verified",
            tls_status,
            hosting_status: live ? HOSTING_STATUS.CONFIGURED : HOSTING_STATUS.NOT_CONFIGURED,
            hosting_provider: getHostingProvider().name,
            updated_date: checkedAt,
          },
        }
      );
      return res.json({
        success: true,
        verified: true,
        live,
        reason: probe.reason,
        dns_status: "verified",
        tls_status,
        found_record: dns.record,
        message: live
          ? `${host} is live — you're now accessing the platform at your own address.`
          : `DNS verified — ${host} points to ${PLATFORM_CNAME_TARGET}. We'll activate it shortly; re-verify to confirm when it's live.`,
      });
    }

    if (fnName === "manageCustomDomain") {
      if (!superAdmin(req)) return res.status(403).json({ error: "Forbidden" });
      const { action, tenant_id } = req.body || {};
      if (action === "activate") {
        if (!tenant_id) return res.status(400).json({ error: "Tenant is required" });
        const tenant = await database.collection("Tenant").findOne({ _id: new ObjectId(String(tenant_id)) });
        if (!tenant) return res.status(404).json({ error: "Tenant not found" });
        const host = normalizeHost(tenant.custom_domain || "");
        if (!host) return res.status(400).json({ error: "Tenant has no custom domain" });

        // Activation never trusts a stale verified flag. DNS, hosting attach
        // (Vercel) and the LIVE identity probe are all re-run right now.
        const checkedAt = new Date().toISOString();
        const now = new Date().toISOString();
        const hosting = getHostingProvider();
        const decision = await runCustomDomainActivation({ verifier: domainVerifier, hosting, host });
        const collection = database.collection("Tenant");
        const tenantId = new ObjectId(String(tenant_id));

        if (decision.stage === ACTIVATION_STAGE.DNS_FAILED) {
          await collection.updateOne(
            { _id: tenantId },
            {
              $set: {
                dns_status: "failed",
                custom_domain_status: "pending",
                custom_domain_verified: false,
                custom_domain_live_at: null,
                hosting_status: decision.hosting?.status || HOSTING_STATUS.NOT_CONFIGURED,
                hosting_provider: hosting.name,
                hosting_verification: [],
                tls_status: "pending",
                custom_domain_checked_at: checkedAt,
                updated_date: now,
              },
            }
          );
          return res.json({
            success: false,
            live: false,
            reason: decision.dns.reason,
            dns_status: "failed",
            found_record: decision.dns.record,
            message: `${host} — ${humanReason(decision.dns.reason)}. Fix the DNS record so it points to ${PLATFORM_CNAME_TARGET}, then activate again.`,
          });
        }

        if (decision.stage === ACTIVATION_STAGE.HOSTING_FAILED) {
          await collection.updateOne(
            { _id: tenantId },
            {
              $set: {
                dns_status: "verified",
                custom_domain_status: "verified",
                custom_domain_verified: true,
                custom_domain_live_at: null,
                hosting_status: HOSTING_STATUS.FAILED,
                hosting_provider: hosting.name,
                hosting_verification: [],
                tls_status: "pending",
                custom_domain_checked_at: checkedAt,
                updated_date: now,
              },
            }
          );
          return res.json({
            success: false,
            live: false,
            reason: decision.hosting?.attach?.reason || "hosting_error",
            dns_status: "verified",
            hosting_status: HOSTING_STATUS.FAILED,
            message: `${host} — ${decision.hosting?.attach?.message || "Hosting automation failed."} The domain stays verified — fix the hosting issue and click Activate to retry.`,
          });
        }

        if (decision.stage === ACTIVATION_STAGE.VERIFICATION_PENDING) {
          const records = (decision.hosting?.verification || [])
            .map((r) => `${r.type} record${r.name ? ` for ${r.name}` : ""} = "${r.required}"`)
            .join("; ");
          await collection.updateOne(
            { _id: tenantId },
            {
              $set: {
                dns_status: "verified",
                custom_domain_status: "verified",
                custom_domain_verified: true,
                custom_domain_live_at: null,
                hosting_status: HOSTING_STATUS.CONFIGURING,
                hosting_provider: hosting.name,
                hosting_verification: decision.hosting?.verification || [],
                tls_status: "pending",
                custom_domain_checked_at: checkedAt,
                updated_date: now,
              },
            }
          );
          return res.json({
            success: false,
            live: false,
            reason: "verification_pending",
            dns_status: "verified",
            hosting_status: HOSTING_STATUS.CONFIGURING,
            message: records
              ? `${host} is attached to the platform hosting, but the hosting provider has not confirmed DNS ownership yet. Complete this at your DNS provider: ${records}. Then click Activate again.`
              : `${host} is attached to the platform hosting, but the hosting provider has not confirmed DNS ownership yet. Wait for propagation, then click Activate again.`,
          });
        }

        // PROBE_FAILED and unconfigured-manual stages both land here: the hosting
        // side is fine, but the Phase 1 live identity probe is the authority.
        const probe = decision.probe;
        let live = probe?.live || false;
        if (!live && req.body?.force && superAdmin(req) && probe?.reachable) {
          // Super-admin escape hatch: allow activation when the app is reachable
          // but the identity/TLS probe has a false negative. Not reachable from
          // the UI.
          live = true;
        }

        const hostingStatus =
          decision.stage === ACTIVATION_STAGE.LIVE ? HOSTING_STATUS.CONFIGURED : decision.hosting?.status || HOSTING_STATUS.CONFIGURED;

        if (!live) {
          await collection.updateOne(
            { _id: tenantId },
            {
              $set: {
                custom_domain_status: "verified",
                custom_domain_verified: true,
                custom_domain_live_at: null,
                custom_domain_checked_at: checkedAt,
                dns_status: "verified",
                tls_status: probe?.reason === REASONS.TLS_FAILED ? "failed" : "pending",
                hosting_status: hostingStatus,
                hosting_provider: hosting.name,
                hosting_verification: [],
                updated_date: now,
              },
            }
          );
          return res.json({
            success: false,
            live: false,
            reason: probe?.reason || null,
            dns_status: "verified",
            tls_status: probe?.reason === REASONS.TLS_FAILED ? "failed" : "pending",
            hosting_status: hostingStatus,
            message: `${host} — ${humanReason(probe?.reason)}. Make sure the domain is attached to the hosting with valid TLS and DNS has propagated, then activate again.`,
          });
        }
        await collection.updateOne(
          { _id: tenantId },
          {
            $set: {
              custom_domain_status: "live",
              custom_domain_verified: true,
              custom_domain_live_at: now,
              custom_domain_checked_at: checkedAt,
              dns_status: "verified",
              tls_status: "ready",
              hosting_status: HOSTING_STATUS.CONFIGURED,
              hosting_provider: hosting.name,
              hosting_verification: [],
              updated_date: now,
            },
          }
        );
        await logServerAudit(req, {
          action: "activate_custom_domain",
          entity_type: "Tenant",
          entity_id: tenant_id,
          details: `${host} activated (live, provider ${hosting.name})`,
        });
        return res.json({ success: true, live: true, hosting_status: HOSTING_STATUS.CONFIGURED, message: `${host} is now live.` });
      }
      if (action === "revoke") {
        if (!tenant_id) return res.status(400).json({ error: "Tenant is required" });
        const now = new Date().toISOString();
        await database.collection("Tenant").updateOne(
          { _id: new ObjectId(String(tenant_id)) },
          {
            $set: {
              custom_domain_status: "verified",
              custom_domain_verified: true,
              custom_domain_live_at: null,
              hosting_status: HOSTING_STATUS.NOT_CONFIGURED,
              hosting_provider: "",
              hosting_verification: [],
              updated_date: now,
            },
          }
        );
        return res.json({ success: true, message: "Domain activation revoked — it will need to be re-verified to go live again." });
      }
      return res.status(400).json({ error: "Unknown action" });
    }

    if (fnName === "runDomainMonitor") {
      if (!superAdmin(req)) return res.status(403).json({ error: "Forbidden" });
      const summary = await getDomainMonitor()({ force: req.body?.force === true });
      await logServerAudit(req, {
        action: "custom_domain_monitor_manual",
        entity_type: "Tenant",
        entity_id: "",
        details: `Manual monitor run: candidates ${summary.candidates}, checked ${summary.checked}, problems ${summary.problems}, alerts ${summary.alerts}${summary.error ? ` (error: ${summary.error})` : ""}`,
      });
      return res.json({ ok: true, ...summary });
    }

    if (fnName === "sendTestDomainAlert") {
      if (!superAdmin(req)) return res.status(403).json({ error: "Forbidden" });
      const emailConfig = await getEffectiveEmailConfig();
      if (!isEmailConfigured(emailConfig)) {
        return res.json({ ok: true, delivered: 0, email_configured: false, message: "SMTP is not configured; alert would not be delivered." });
      }
      const now = new Date().toISOString();
      const change = {
        host: "test.example.edu",
        tenantName: "Test School (alert verification)",
        tenantId: "",
        from: { status: "live", dns_status: "verified", tls_status: "ready", degraded: false },
        to: { status: "verified", dns_status: "verified", tls_status: "failed", degraded: true },
        problems: [
          { code: "tls_failed", human: "TLS certificate invalid or missing", detail: "Test alert — no real problem detected." },
        ],
        degraded: true,
        detected_at: now,
      };
      const { subject, text, html } = buildDomainAlert({
        change,
        cnameTarget: PLATFORM_CNAME_TARGET,
        baseUrl: adminUrl(),
      });
      const emails = await listSuperAdminEmails();
      let delivered = 0;
      for (const to of emails) {
        try {
          const result = await sendEmail({ to, subject, text, html });
          if (result.ok) delivered += 1;
        } catch {
          /* per-recipient failures are non-fatal */
        }
      }
      await logServerAudit(req, {
        action: "custom_domain_test_alert",
        entity_type: "Tenant",
        entity_id: "",
        details: `Test domain alert emailed to ${delivered}/${emails.length} recipient(s)`,
      });
      return res.json({ ok: true, delivered, recipients: emails.length, email_configured: true });
    }

    if (fnName === "getDomainMonitorStatus") {
      if (!superAdmin(req)) return res.status(403).json({ error: "Forbidden" });
      const [emailConfig, runDoc] = await Promise.all([getEffectiveEmailConfig(), getMonitorRunDoc()]);
      const emails = await listSuperAdminEmails();
      const hostingProvider = getHostingProvider();
      const provider =
        typeof hostingProvider.describe === "function"
          ? await hostingProvider.describe()
          : {
              name: hostingProvider.name,
              verificationCapable: hostingProvider.verificationCapable,
              configured: Boolean(hostingProvider.isConfigured?.()),
              requiredEnv: [],
            };
      const requiredEnvMissing = (provider.requiredEnv || []).filter((key) => !process.env[key]);
      return res.json({
        ok: true,
        monitor_configured: true,
        crons_enabled: Boolean(process.env.CRON_SECRET),
        cname_target: PLATFORM_CNAME_TARGET,
        base_url: adminUrl(),
        email_configured: isEmailConfigured(emailConfig),
        alert_recipients: emails.length,
        last_run: runDoc?.last_run || null,
        run_history_count: (runDoc?.runs || []).length,
        hosting: {
          active_provider: provider.name,
          provider,
          required_env_missing: requiredEnvMissing,
          pinned: Boolean(process.env.HOSTING_PROVIDER),
        },
      });
    }

    if (fnName === "logAudit") {
      const { action, entity_type, entity_id, details } = req.body || {};
      if (!action || !entity_type) {
        return res.status(400).json({ error: "action and entity_type are required" });
      }
      const allowedRoles = CLIENT_AUDIT_EVENTS.get(`${String(action)}:${String(entity_type)}`);
      // Union: any held role the client is allowed to self-report for. A teacher
      // who also coordinates exams may log the coordinator events, and the
      // tenant_id written below is still this account's own.
      if (!allowedRoles || !hasAnyRole(req, allowedRoles)) {
        return res.status(400).json({ error: "Audit event not permitted" });
      }
      const now = new Date().toISOString();
      await database.collection("AuditLog").insertOne({
        tenant_id: req.user.tenant_id || "",
        actor_name: req.user.full_name || req.user.email || "Unknown",
        // Every held role, so an event by a multi-role account is not recorded as
        // if only one of its roles were acting.
        actor_role: rolesOf(req).join(","),
        action: String(action),
        entity_type: String(entity_type),
        entity_id: entity_id ? String(entity_id) : "",
        details: details ? String(details) : "",
        created_date: now,
        updated_date: now,
      });
      return res.json({ success: true });
    }

    res.status(501).json({ error: `Function ${fnName} not recognized.` });
  })
);

const seedTenantInitialData = async (database, tenantId, tenantName, subdomain) => {
  // Demo/sample data seeder. No longer called automatically on tenant creation;
  // retained for manual use when a tenant should be populated with sample content.
  try {
    const now = new Date().toISOString();
    const cleanSub = (subdomain || "school").toLowerCase().replace(/[^a-z0-9]/g, "");

    // 1. Classes
    const class10 = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "Class 10",
      sections: ["A", "B"],
      created_date: now,
      updated_date: now,
    };
    const class12 = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "Class 12",
      sections: ["Science", "Commerce"],
      created_date: now,
      updated_date: now,
    };
    await database.collection("SchoolClass").insertMany([class10, class12]);

    // 2. Subjects
    const subjects = ["Mathematics", "Physics", "Chemistry", "English Literature", "Computer Science", "Biology"];
    const subjectDocs = subjects.map((sub) => ({
        _id: new ObjectId(),
        tenant_id: tenantId,
        name: sub,
        created_date: now,
        updated_date: now,
      }));
    await database.collection("Subject").insertMany(subjectDocs);

    // 3. Teachers
    const teachers = [
      { name: "Anita Deshmukh", email: `anita.${cleanSub}@school.test`, subject: "Mathematics", role: "teacher" },
      { name: "Kavita Nair", email: `kavita.${cleanSub}@school.test`, subject: "Physics", role: "teacher" },
      { name: "Pradeep Menon", email: `pradeep.${cleanSub}@school.test`, subject: "Chemistry", role: "exam_coordinator" },
    ];
    for (const t of teachers) {
      await database.collection("Teacher").insertOne({
        tenant_id: tenantId,
        full_name: t.name,
        email: t.email,
        phone: "+91 98200" + Math.floor(10000 + Math.random() * 90000),
        assigned_subject_ids: [subjectDocs.find((s) => s.name === t.subject)._id.toString()],
        assigned_class_ids: [class10._id.toString(), class12._id.toString()],
        status: "active",
        created_date: now,
        updated_date: now,
      });
    }

    // 4. Students
    const studentNames = [
      { name: "Aarav Sharma", roll: "1001", sec: "A", cls: "Class 10", email: `aarav.${cleanSub}@student.test` },
      { name: "Diya Patel", roll: "1002", sec: "A", cls: "Class 10", email: `diya.${cleanSub}@student.test` },
      { name: "Rohan Gupta", roll: "1003", sec: "B", cls: "Class 10", email: `rohan.${cleanSub}@student.test` },
      { name: "Ananya Iyer", roll: "1201", sec: "Science", cls: "Class 12", email: `ananya.${cleanSub}@student.test` },
      { name: "Kabir Mehta", roll: "1202", sec: "Commerce", cls: "Class 12", email: `kabir.${cleanSub}@student.test` },
      { name: "Sanya Verma", roll: "1203", sec: "Science", cls: "Class 12", email: `sanya.${cleanSub}@student.test` },
    ];

    const studentDocs = [];
    for (const s of studentNames) {
      const doc = {
        _id: new ObjectId(),
        tenant_id: tenantId,
        full_name: s.name,
        roll_number: s.roll,
        school_class_id: (s.cls === "Class 10" ? class10 : class12)._id.toString(),
        class_name: s.cls,
        section: s.sec,
        student_email: s.email,
        email: s.email,
        parent_name: `Mr./Mrs. ${s.name.split(" ")[1]}`,
        parent_email: `parent.${s.email}`,
        parent_phone: "+91 98330" + Math.floor(10000 + Math.random() * 90000),
        status: "active",
        created_date: now,
        updated_date: now,
      };
      await database.collection("Student").insertOne(doc);
      studentDocs.push(doc);
    }

    // 5. Sample Examination (Mathematics Unit Test)
    const examDate = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0];
    const examDoc = {
      _id: new ObjectId(),
      tenant_id: tenantId,
      name: "Unit Test 1 — Mathematics",
      subject: "Mathematics",
      class_name: "Class 10",
      class_names: ["Class 10"],
      school_class_ids: [class10._id.toString()],
      subject_ids: [subjectDocs.find((s) => s.name === "Mathematics")._id.toString()],
      exam_date: examDate,
      duration_minutes: 60,
      num_questions: 25,
      options_per_question: 4,
      marks_per_question: 2,
      negative_marks: 0.5,
      negative_marking: true,
      negative_mark_value: 0.5,
      max_marks: 50,
      passing_marks: 18,
      paper_sets: ["A"],
      status: "published",
      created_date: now,
      updated_date: now,
    };
    await database.collection("Examination").insertOne(examDoc);

    // 6. Answer Key
    const opts = ["A", "B", "C", "D"];
    const mathKey = {};
    for (let q = 1; q <= 25; q++) {
      mathKey[String(q)] = opts[(q * 3) % 4];
    }
    await database.collection("AnswerKey").insertOne({
      examination_id: examDoc._id.toString(),
      paper_set: "A",
      answers: mathKey,
      created_date: now,
      updated_date: now,
    });

    // 7. OMR Sheets & Results for Class 10 students
    const class10Students = studentDocs.filter((s) => s.class_name === "Class 10");
    const results = [];
    for (let i = 0; i < class10Students.length; i++) {
      const st = class10Students[i];
      const answers = {};
      const confidenceScores = {};
      let correct = 0, wrong = 0, blank = 0;
      const proficiency = 0.7 + i * 0.1;

      for (let q = 1; q <= 25; q++) {
        const k = String(q);
        confidenceScores[k] = +(0.85 + Math.random() * 0.14).toFixed(3);
        if (Math.random() < proficiency) {
          answers[k] = mathKey[k];
          correct++;
        } else if (Math.random() < 0.8) {
          answers[k] = opts[Math.floor(Math.random() * 4)];
          wrong++;
        } else {
          answers[k] = "";
          blank++;
        }
      }

      const totalMarks = Math.max(0, +(correct * 2 - wrong * 0.5).toFixed(2));
      const percentage = +((totalMarks / 50) * 100).toFixed(2);
      let grade = "F";
      if (percentage >= 90) grade = "A+";
      else if (percentage >= 80) grade = "A";
      else if (percentage >= 70) grade = "B+";
      else if (percentage >= 60) grade = "B";
      else if (percentage >= 50) grade = "C";
      else if (percentage >= 33) grade = "D";

      const sheetDoc = {
        _id: new ObjectId(),
        tenant_id: tenantId,
        examination_id: examDoc._id.toString(),
        student_id: st._id.toString(),
        paper_set: "A",
        image_url: "https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=600&auto=format&fit=crop&q=80",
        answers,
        extracted_answers: answers,
        confidence_scores: confidenceScores,
        status: "completed",
        matched: true,
        flagged_questions: [],
        processed_at: examDate,
        created_date: examDate,
        updated_date: examDate,
      };
      await database.collection("OMRSheet").insertOne(sheetDoc);

      results.push({
        examination_id: examDoc._id.toString(),
        student_id: st._id.toString(),
        tenant_id: tenantId,
        omr_sheet_id: sheetDoc._id.toString(),
        total_marks: totalMarks,
        percentage,
        grade,
        passed: totalMarks >= 18,
        correct_answers: correct,
        incorrect_answers: wrong,
        unattempted: blank,
        status: "published",
        created_date: examDate,
        updated_date: examDate,
      });
    }

    // Assign ranks
    results.sort((a, b) => b.total_marks - a.total_marks);
    const n = results.length;
    results.forEach((r, idx) => {
      r.rank = idx + 1;
      const below = n - idx - 1;
      r.percentile = n > 1 ? +((below / (n - 1)) * 100).toFixed(2) : 100;
    });
    if (results.length > 0) {
      await database.collection("Result").insertMany(results);
    }

    // 8. Welcome Announcement
    await database.collection("TenantAnnouncement").insertOne({
      tenant_id: tenantId,
      title: `Welcome to ${tenantName || "Avexora ExamOS"}`,
      message: "Academic year portal is now active. Class schedules, OMR examinations, and report cards are ready for students, teachers, and parents.",
      is_active: true,
      created_date: now,
      updated_date: now,
    });
  } catch (err) {
    console.error("Error auto-seeding tenant initial data:", err);
  }
};

const bootstrapAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  const adminName = process.env.ADMIN_FULL_NAME?.trim() || "Platform Administrator";
  if (!adminEmail || !adminPassword) return;

  try {
    const database = await db();
    const password_hash = await hashPassword(adminPassword);
    const now = new Date().toISOString();
    const existingUser = await database.collection("User").findOne({ email: adminEmail });
    if (existingUser) {
      await database.collection("User").updateOne(
        { _id: existingUser._id },
        {
          $set: {
            full_name: adminName,
            password_hash,
            role: "admin",
            app_role: "super_admin",
            app_roles: ["super_admin"],
            // The platform admin is created from the operator's own environment,
            // so there is no third party to prove anything to. Verified by
            // construction, on both branches so a re-bootstrap cannot leave the
            // account stuck.
            email_verified: true,
            updated_date: now,
          },
        }
      );
    } else {
      await database.collection("User").insertOne({
        email: adminEmail,
        full_name: adminName,
        password_hash,
        role: "admin",
        app_role: "super_admin",
        app_roles: ["super_admin"],
        email_verified: true,
        created_date: now,
        updated_date: now,
      });
    }

    // Seed default subscription plans if none exist
    const planCount = await database.collection("SubscriptionPlan").countDocuments();
    if (planCount === 0) {
      await database.collection("SubscriptionPlan").insertMany([
        {
          name: "Standard Institution",
          price: 4999,
          billing_cycle: "month",
          student_limit: 1000,
          omr_sheet_limit: 5000,
          exam_limit: 50,
          white_label_enabled: true,
          hide_powered_by_enabled: false,
          ai_enabled: true,
          parent_portal_enabled: true,
          whatsapp_enabled: true,
          custom_domain_enabled: false,
          created_date: now,
          updated_date: now,
        },
        {
          name: "Enterprise Pro",
          price: 12999,
          billing_cycle: "month",
          student_limit: 10000,
          omr_sheet_limit: 50000,
          exam_limit: 500,
          white_label_enabled: true,
          hide_powered_by_enabled: true,
          ai_enabled: true,
          parent_portal_enabled: true,
          whatsapp_enabled: true,
          custom_domain_enabled: true,
          created_date: now,
          updated_date: now,
        },
      ]);
    }

    // Seed default platform branding if none exist
    const brandingCount = await database.collection("PlatformBranding").countDocuments();
    if (brandingCount === 0) {
      await database.collection("PlatformBranding").insertOne({
        platform_name: "Avexora ExamOS",
        primary_color: "#2563EB",
        accent_color: "#0F172A",
        created_date: now,
        updated_date: now,
      });
    }
  } catch (error) {
    console.error("Admin bootstrap warning:", error?.message || error);
  }
};

bootstrapAdmin().catch(() => {});

// Database-level protection: a normalized custom_domain can belong to exactly
// one tenant. The partial unique index excludes null/missing and empty-string
// values so tenants without a custom domain are unaffected. If pre-existing
// duplicates block creation, report and skip — never crash and never touch data.
const ensureCustomDomainIndex = async () => {
  try {
    const database = await db();
    const duplicates = await database
      .collection("Tenant")
      .aggregate([
        { $match: { custom_domain: { $type: "string", $ne: "" } } },
        { $group: { _id: "$custom_domain", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();
    if (duplicates.length) {
      console.warn(
        `[custom-domain] Skipping unique index: ${duplicates.length} duplicate custom_domain value(s) exist:`,
        duplicates.map((d) => d._id)
      );
      return;
    }
    // "Is a non-empty string" written as $type + $gt, NOT $ne: "". MongoDB
    // rejects $ne inside a partialFilterExpression ("Expression not supported in
    // partial index: $not"), so the original spec never built and custom-domain
    // uniqueness was silently not enforced — the create always threw, was caught
    // as a warning, and the boot carried on. $gt: "" expresses the same
    // predicate using operators a partial index does accept, and unlike
    // $type alone it still excludes "", so the many tenants that have no custom
    // domain do not all collide on the empty string.
    const options = {
      name: "custom_domain_unique",
      unique: true,
      partialFilterExpression: { custom_domain: { $type: "string", $gt: "" } },
    };
    try {
      await database.collection("Tenant").createIndex({ custom_domain: 1 }, options);
    } catch (error) {
      // An index named custom_domain_1 from an earlier deploy conflicts with the
      // corrected spec on the same key. Swap it rather than leaving the weaker
      // (or absent) index in place.
      if (error?.code === 85 || error?.code === 86) {
        console.warn("[custom-domain] Replacing conflicting custom_domain_1 index");
        await database.collection("Tenant").dropIndex("custom_domain_1");
        await database.collection("Tenant").createIndex({ custom_domain: 1 }, options);
      } else {
        throw error;
      }
    }
    console.log("[custom-domain] unique index on Tenant.custom_domain ensured");
  } catch (error) {
    console.warn("[custom-domain] Could not ensure unique index:", error?.message || error);
  }
};
ensureCustomDomainIndex().catch(() => {});

// Register the Vercel hosting provider when credentials are present so domain
// attachment automation is available (Phase 2). Without credentials the app
// runs exactly as before, using the manual provider.
const vercelProvider = createVercelProvider({});
if (vercelProvider.isConfigured()) registerHostingProvider(vercelProvider);

// Self-hosted / local scheduled monitoring (not used on Vercel, where the
// `crons` block in vercel.json drives the same endpoint). Opt-in via env so a
// server never silently probes without configuration.
if (!process.env.VERCEL && process.env.DOMAIN_MONITOR_INTERVAL_MS) {
  const interval = Number(process.env.DOMAIN_MONITOR_INTERVAL_MS);
  if (Number.isFinite(interval) && interval >= 60000) {
    setInterval(() => {
      getDomainMonitor()({}).catch((err) => console.warn("[domain-monitor] tick failed:", err?.message || err));
    }, interval);
  }
}

if (!process.env.VERCEL) {
  app.listen(Number(process.env.PORT || 3090), () =>
    console.log(`API listening on port ${process.env.PORT || 3090}`)
  );
}

export default app;
