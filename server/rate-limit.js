// SEC-05: Authentication abuse controls.
//
// Threat model and limits come from the SEC-05 audit (§14 control table):
//   login           10 failed account+IP per 15 min;  100 failed per IP per 15 min; 30 min lockout
//   register        10 per IP per 15 min
//   reset-request   5 per email per 60 min; 20 per IP per 60 min
//   reset-password  30 per IP per 60 min
//   invite          50 per admin per 24 h; 1 per recipient per 24 h (recipient keyed per tenant)
//
// Storage (SEC05-009): an in-memory store is correct for the single Node process;
// a shared Mongo-backed store is used when process.env.VERCEL (multiple serverless
// instances). RATE_LIMIT_STORE=mongo forces the Mongo store for tests.
//
// 429 semantics (SEC05): HTTP 429 + a numeric Retry-After header + a generic
// {"error":"Too many attempts"} body so limit failures are distinguishable by
// status from 401/400/409 but leak nothing account-specific.
//
// Every limit duration passes through RATE_LIMIT_MS_SCALE (default 1) so tests
// can shrink windows/lockouts to seconds and verify expiry behavior. Thresholds
// (counts) are never scaled.

import { db } from "./db.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SCALE = Number(process.env.RATE_LIMIT_MS_SCALE) || 1;
const scaled = (ms) => Math.max(1, Math.floor(ms / SCALE));

export const RATE_LIMITS = {
  loginFail: { windowMs: scaled(15 * MINUTE), limit: 10, scope: "login:fail:account" },
  loginIpFail: { windowMs: scaled(15 * MINUTE), limit: 100, scope: "login:fail:ip" },
  loginLockout: { ttlMs: scaled(30 * MINUTE), scope: "login:lockout" },
  register: { windowMs: scaled(15 * MINUTE), limit: 10, scope: "register:ip" },
  tenantLookup: { windowMs: scaled(15 * MINUTE), limit: 60, scope: "tenantlookup:ip" },
  resetRequestEmail: { windowMs: scaled(60 * MINUTE), limit: 5, scope: "resetreq:email" },
  resetRequestIp: { windowMs: scaled(60 * MINUTE), limit: 20, scope: "resetreq:ip" },
  resetPasswordIp: { windowMs: scaled(60 * MINUTE), limit: 30, scope: "resetpw:ip" },
  changePassword: { windowMs: scaled(15 * MINUTE), limit: 20, scope: "changepw:ip" },
  inviteAdmin: { windowMs: scaled(DAY), limit: 50, scope: "invite:admin" },
  inviteRecipient: { windowMs: scaled(DAY), limit: 1, scope: "invite:recipient" },
  leadCreate: { windowMs: scaled(HOUR), limit: 20, scope: "lead:create" },
  leadEmail: { windowMs: scaled(HOUR), limit: 30, scope: "lead:email" },
  leadWhatsapp: { windowMs: scaled(HOUR), limit: 60, scope: "lead:whatsapp" },
  // An affiliate mints a real Tenant and a real school administrator login per
  // sale, so this is not a form-submission budget — it bounds how much of the
  // platform one reseller account can provision. Keyed on the affiliate user, not
  // the IP: a reseller behind a school NAT would otherwise be limited by whoever
  // else shares that address, and a reseller on a rotating IP would escape it.
  affiliateSell: { windowMs: scaled(DAY), limit: 20, scope: "affiliate:create" },
  // Manual renewal reminders. Bounded per AFFILIATE, not per IP and not per
  // institution: this is a bulk-messaging action pointed at a real customer's inbox
  // and phone, so the budget that matters is how many institutions one reseller can
  // message in a day. Keyed on the affiliate user for the same NAT reason as
  // affiliateSell above.
  affiliateReminder: { windowMs: scaled(HOUR), limit: 60, scope: "affiliate:reminder" },
  // Raising a plan-change request. Bounded per TENANT, not per IP: a school's whole
  // office shares one NAT address, so an IP budget would let one institution's staff
  // exhaust another's quota, and would be trivially escaped by a school on a rotating
  // connection. The caller keys this on tenant_id for the same reason affiliateSell
  // keys on the affiliate user.
  planChangeRequest: { windowMs: scaled(DAY), limit: 10, scope: "tenant:plan-change" },
  // Email verification. Two separate budgets, because they defend against
  // different things: resend is an inbox-flooding / spamming vector (bounded per
  // recipient, and loosely per IP so a shared school NAT is not locked out),
  // while the verify call itself is a token-guessing vector (bounded per IP,
  // since the token is 32 random bytes and cannot be brute-forced, but the
  // endpoint is public and each attempt costs a DB read).
  verifyEmailResend: { windowMs: scaled(60 * MINUTE), limit: 5, scope: "verify:resend:user" },
  verifyEmailResendIp: { windowMs: scaled(60 * MINUTE), limit: 30, scope: "verify:resend:ip" },
  verifyEmailIp: { windowMs: scaled(15 * MINUTE), limit: 30, scope: "verify:ip" },
};

// --- Client-IP resolution (SEC05-008) ---------------------------------------
// Non-Vercel: the direct Node process sees the real socket address, so only
// req.socket.remoteAddress is trusted. Spoofable forwarding headers
// (X-Forwarded-For / X-Real-IP) are NEVER used.
// Vercel: the edge terminates TLS and rewrites X-Forwarded-For with the remote
// address first (single trusted hop) before handing off to the serverless
// function, so the FIRST header value is the client. Anything else is ignored.
export const getClientIp = (req, isVercel = Boolean(process.env.VERCEL)) => {
  let ip = null;
  if (isVercel) {
    const xff = req.headers?.["x-forwarded-for"];
    const first = Array.isArray(xff) ? xff[0] : typeof xff === "string" ? xff.split(",")[0].trim() : "";
    if (first) ip = first;
  }
  if (!ip) ip = req.socket?.remoteAddress || req.ip || "";
  // Normalize IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1") to plain IPv4 so one
  // client cannot occupy two key spaces on the same host.
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
};

// --- 429 response ------------------------------------------------------------
export const tooMany = (res, resetAtMs) => {
  const retryAfter = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  res.set("Retry-After", String(retryAfter));
  return res.status(429).json({ error: "Too many attempts" });
};

// --- Stores ------------------------------------------------------------------
// Common interface implemented by both stores:
//   incr({ scope, key, windowMs })      -> { count, resetAt }  (atomic; +1)
//   get({ scope, key, windowMs })       -> { count, resetAt }  (read-only)
//   del({ scope, key })                 -> remove all windows + lockout for key
//   setLock({ scope, key, ttlMs })      -> write absolute-expiry lock marker
//   remainingLock({ scope, key })       -> ms remaining, 0 if none/expired
//
// Lock markers and windowed counters share one namespace per (scope, key); del
// clears both so a login success resets failures AND lockout together.

const windowStartAt = (now, windowMs) => Math.floor(now / windowMs) * windowMs;

class MemoryRateStore {
  constructor({ maxEntries = 20000 } = {}) {
    this.maxEntries = maxEntries;
    this.counters = new Map(); // id -> { windowEnd, count }
    this.locks = new Map(); // id -> { expiresAt }
  }

  _counterId(scope, key, windowStart) {
    return `${scope}::${key}::${windowStart}`;
  }

  _lockId(scope, key) {
    return `${scope}::${key}::lock`;
  }

  _sweep(now) {
    for (const [id, entry] of this.counters) {
      if (entry.windowEnd <= now) this.counters.delete(id);
    }
    for (const [id, entry] of this.locks) {
      if (entry.expiresAt <= now) this.locks.delete(id);
    }
    // Bounded by design: evict expired entries first, then drop oldest counters
    // so malicious key churn cannot grow memory without limit.
    let overflow = this.counters.size + this.locks.size - this.maxEntries;
    if (overflow > 0) {
      for (const [id] of this.counters) {
        if (overflow <= 0) break;
        this.counters.delete(id);
        overflow--;
      }
    }
  }

  async incr({ scope, key, windowMs }) {
    const now = Date.now();
    this._sweep(now);
    const windowStart = windowStartAt(now, windowMs);
    const id = this._counterId(scope, key, windowStart);
    const existing = this.counters.get(id);
    const resetAt = windowStart + windowMs;
    if (existing && existing.windowEnd > now) {
      existing.count += 1;
    } else {
      this.counters.set(id, { windowEnd: resetAt, count: 1 });
    }
    return { count: this.counters.get(id).count, resetAt };
  }

  async get({ scope, key, windowMs }) {
    const now = Date.now();
    this._sweep(now);
    const windowStart = windowStartAt(now, windowMs);
    const entry = this.counters.get(this._counterId(scope, key, windowStart));
    return { count: entry && entry.windowEnd > now ? entry.count : 0, resetAt: windowStart + windowMs };
  }

  async del({ scope, key }) {
    const now = Date.now();
    const prefix = `${scope}::${key}::`;
    for (const id of this.counters.keys()) {
      if (id.startsWith(prefix)) this.counters.delete(id);
    }
    this.locks.delete(this._lockId(scope, key));
  }

  async setLock({ scope, key, ttlMs }) {
    this.locks.set(this._lockId(scope, key), { expiresAt: Date.now() + ttlMs });
  }

  async remainingLock({ scope, key }) {
    const entry = this.locks.get(this._lockId(scope, key));
    if (!entry) return 0;
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      this.locks.delete(this._lockId(scope, key));
      return 0;
    }
    return remaining;
  }
}

class MongoRateStore {
  constructor() {
    this.collection = null;
  }

  async _coll() {
    if (!this.collection) {
      const database = await db();
      this.collection = database.collection("RateLimit");
    }
    return this.collection;
  }

  async incr({ scope, key, windowMs }) {
    const now = Date.now();
    const windowStart = windowStartAt(now, windowMs);
    const windowEnd = windowStart + windowMs;
    const coll = await this._coll();
    const doc = await coll.findOneAndUpdate(
      { scope, key, window_start: new Date(windowStart) },
      {
        $inc: { count: 1 },
        $set: { updated_date: new Date() },
        $setOnInsert: { window_end: new Date(windowEnd) },
      },
      { upsert: true, returnDocument: "after" }
    );
    return { count: doc ? doc.count : 1, resetAt: windowEnd };
  }

  async get({ scope, key, windowMs }) {
    const now = Date.now();
    const windowStart = windowStartAt(now, windowMs);
    const coll = await this._coll();
    const doc = await coll.findOne({ scope, key, window_start: new Date(windowStart) });
    return { count: doc?.count || 0, resetAt: windowStart + windowMs };
  }

  async del({ scope, key }) {
    const coll = await this._coll();
    await coll.deleteMany({ scope, key });
  }

  async setLock({ scope, key, ttlMs }) {
    const coll = await this._coll();
    const id = `${scope}::${key}::lock`;
    const lock_until = new Date(Date.now() + ttlMs);
    await coll.updateOne(
      { _id: id },
      { $set: { scope, key, lock_until, updated_date: new Date() } },
      { upsert: true }
    );
  }

  async remainingLock({ scope, key }) {
    const coll = await this._coll();
    const doc = await coll.findOne({ scope, key, lock_until: { $gt: new Date() } });
    if (!doc?.lock_until) return 0;
    return Math.max(0, doc.lock_until.getTime() - Date.now());
  }
}

let store = null;

// Chosen per SEC05-009: shared Mongo store on Vercel (multi-instance), in-memory
// store for the single-process mode, an explicit RATE_LIMIT_STORE override for
// tests. Store failures fail-open with a warning to preserve availability.
export const getRateStore = () => {
  if (store) return store;
  const forced = process.env.RATE_LIMIT_STORE?.trim();
  const useMongo = forced ? forced === "mongo" : Boolean(process.env.VERCEL);
  store = useMongo ? new MongoRateStore() : new MemoryRateStore();
  return store;
};

// Runs every auth-adjacent throttled call through this so storage failures never
// break a request (fail-open) but are visible in logs.
export const runLimit = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    console.warn("Rate-limit store error (fail-open):", err.message);
    return { count: 0, resetAt: Date.now() };
  }
};