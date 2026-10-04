// Live RBAC harness: real HTTP against a real server, on a throwaway database.
//
// What this covers, in order:
//   A-V  the per-role sections below — super_admin, school_admin, principal,
//         exam_coordinator, teacher, student, parent, cross-tenant isolation,
//         sensitive functions, audit integrity, account lifecycle, multi-role,
//         anonymous/public, and the view-as scope
//   X    suites/entity-matrix.mjs — the eight ENTITY_WRITE_ROLES rows no section above
//         ever sent to a role, each role judged against the matrix itself
//   Y    suites/capabilities.mjs — the three upload purposes, the roster-extract gate,
//         and the role rules that live in attendanceService / academicSetupService /
//         examTimetableService rather than in the entity matrix
//
// Requires a local mongod on localhost:27017. Nothing outside the per-run scratch
// database is touched. Uploads are redirected to a temp UPLOADS_DIR and the S3
// credentials are blanked, so the upload probes cannot reach the real bucket; both are
// cleaned up on the way out even when a check fails.
//
// This is the LIVE suite. The pure-policy suite is `npm test` (server/test): no
// database, no fixtures, and it carries the frontend/backend parity test. That is the
// one that should gate a commit. Run this when the change touches routing,
// authorization order, or the write matrix.
//
// What these suites guarantee, precisely: that the server's ENFORCED behaviour matches
// ENTITY_WRITE_ROLES, row by row, and that a denial comes from the role gate rather than
// from something downstream. That is a consistency guarantee, not a correctness one.
// Widening the matrix itself is invisible here — the expectation and the enforcement read
// the same table, so both move together. Changing who may do what is a product decision
// and belongs in a code review, not in a test assertion. (Verified: a hardcoded exception
// in canWriteEntity diverging from the matrix fails with a named check; editing the matrix
// row passes. That is the intended split.)
//
// Check names are part of the contract — append rather than rewrite when adding
// coverage.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { runEntityMatrixSuite } from "./suites/entity-matrix.mjs";
import { runCapabilitiesSuite } from "./suites/capabilities.mjs";

// The repo root, found by walking up to package.json rather than by counting
// "../" hops. This file used to live in scripts/ (one level down) and is now in
// server/test-live/ (two levels down); a fixed number of hops silently pointed
// every spawned child process at the wrong directory, so the root is located by
// a marker file instead.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = (() => {
  let dir = here;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return here; // no package.json anywhere: fall back
    dir = up;
  }
})();
const MONGO_BASE = "mongodb://localhost:27017";
const runId = `${Date.now().toString(36)}c${crypto.randomBytes(3).toString("hex")}`;
const dbName = `avexora_examos_rbac_${runId}`;
const scratchUri = `${MONGO_BASE}/${dbName}`;

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass, detail: detail.replace(/\s+/g, " ").slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  --  ${detail}` : ""}`);
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });

const waitFor = async (fn, { timeout = 25000, interval = 250 } = {}) => {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timeout: ${lastErr?.message || "no result"}`);
};

const ADMIN_EMAIL = `rbac-admin-${runId}@example.test`;
const ADMIN_PASS = crypto.randomBytes(12).toString("hex");
const TEST_PASSWORD = "TempPass1!";
const em = (x) => `rbac-${runId}-${x}@example.test`;

let base;
let agentSeq = 0;
const api = async (pathName, { token, method = "GET", body, headers: extraHeaders } = {}) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const url = new URL(base);
  const seq = ++agentSeq;
  return new Promise((resolve, reject) => {
    const agent = new http.Agent({ keepAlive: false, maxSockets: 1, maxFreeSockets: 0, agentSeq: seq });
    const req = http.request(
      {
        host: "127.0.0.1",
        port: url.port,
        path: `${url.pathname.replace(/\/$/, "")}${pathName}`,
        method,
        agent,
        headers: {
          "Content-Type": "application/json",
          ...(payload !== undefined ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // Lets a test state the "view as" scope the client would send, and send a
          // malformed one, without a second HTTP helper.
          ...(extraHeaders || {}),
          "X-Trace": String(seq),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = {};
          try {
            data = JSON.parse(raw);
          } catch {
            /* non-JSON body */
          }
          resolve({ status: res.statusCode, data, raw });
        });
      }
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
};

const client = new MongoClient(scratchUri, { serverSelectionTimeoutMS: 10000 });
await client.connect();
const DB = client.db(dbName);
const hashPw = (pw) => bcrypt.hash(pw, 4);
const findUserByEmail = (email) => DB.collection("User").findOne({ email: email.toLowerCase().trim() });

const userIds = new Set();
const tenantIds = new Set();
const trackedTenant = (id) => tenantIds.add(id.toString());

let child = null;
let stopServer = null;
let superToken = null;
let serverLogs = [];
let uploadsDir = null;
// Module scope, not inside boot(): the upload suite asserts on this directory and
// cleanup() removes it, both of which run outside the function that creates it.
const cleanupUploadsDir = () => {
  if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
};

// A multipart POST, for POST /api/upload.
//
// api() above can only express JSON, and the server runs multer.memoryStorage, so the
// purpose gate at canUploadPurpose is only reachable with a real multipart/form-data
// body. Built from the global fetch + FormData + Blob rather than adding a multipart
// dependency for the handful of small fixtures the upload suite needs.
const uploadProbe = async (pathName, { token, filename, bytes, fields = {} } = {}) => {
  const url = new URL(base);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  if (filename !== undefined) {
    form.append("file", new Blob([bytes], { type: "application/octet-stream" }), filename);
  }
  const res = await fetch(`${url.origin}${url.pathname.replace(/\/$/, "")}${pathName}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, data, raw };
};

const DATA_COLLECTIONS = ["Student", "Teacher", "Examination", "OMRSheet", "Result", "SchoolClass", "Subject", "TenantAnnouncement", "AnswerKey", "OMRCorrection", "AuditLog", "Enrollment", "ExamRoster", "AcademicYear"];

const cleanup = async () => {
  try {
    if (child && stopServer) await stopServer();
    const tenantArr = [...tenantIds].map((t) => t.toString());
    if (tenantArr.length > 0) {
      for (const collName of DATA_COLLECTIONS) {
        const r = await DB.collection(collName).deleteMany({ tenant_id: { $in: tenantArr } });
        if (r.deletedCount > 0) console.log(`cleanup: removed ${r.deletedCount} ${collName}(s) in harness tenants`);
      }
      const u = await DB.collection("User").deleteMany({ tenant_id: { $in: tenantArr } });
      if (u.deletedCount > 0) console.log(`cleanup: removed ${u.deletedCount} User(s) in harness tenants`);
      const t = await DB.collection("Tenant").deleteMany({ _id: { $in: tenantArr.map((x) => new ObjectId(x)) } });
      if (t.deletedCount > 0) console.log(`cleanup: removed ${t.deletedCount} harness Tenant(s)`);
    }
    if (userIds.size > 0) {
      const ids = [...userIds].map((i) => (ObjectId.isValid(i) ? new ObjectId(i) : i));
      const u2 = await DB.collection("User").deleteMany({ _id: { $in: ids } });
      if (u2.deletedCount > 0) console.log(`cleanup: removed ${u2.deletedCount} tracked User(s)`);
    }
    let remaining = 0;
    if (tenantArr.length > 0) {
      for (const collName of DATA_COLLECTIONS) {
        remaining += await DB.collection(collName).countDocuments({ tenant_id: { $in: tenantArr } });
      }
      remaining += await DB.collection("Tenant").countDocuments({ _id: { $in: tenantArr.map((x) => new ObjectId(x)) } });
    }
    if (userIds.size > 0) {
      const ids = [...userIds].map((i) => (ObjectId.isValid(i) ? new ObjectId(i) : i));
      remaining += await DB.collection("User").countDocuments({ _id: { $in: ids } });
    }
    check("Cleanup: no harness fixtures remain before drop", remaining === 0, `remaining=${remaining}`);
  } catch (err) {
    check("Cleanup: error during fixture removal", false, err.message);
  }
};

try {
  check("Scratch database isolated", true, `scratch db=${dbName}`);

  const ix = spawnSync(process.execPath, ["server/ensure-indexes.js"], {
    cwd: root,
    env: { ...process.env, MONGODB_URI: MONGO_BASE, MONGODB_DB: dbName },
    timeout: 30000,
    encoding: "utf8",
  });
  check("ensure-indexes.js runs idempotently on scratch DB", ix.status === 0, ix.stdout?.trim());

  const port = await getFreePort();
  base = `http://127.0.0.1:${port}/api`;

  // Uploads are a durable artifact written outside the database, so the harness
  // points them at a temp directory and removes it on the way out. Without this the
  // logo/import fixtures would land in the repo's uploads/ tree.
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rbac-uploads-"));

  const srvEnv = {
    ...process.env,
    MONGODB_URI: MONGO_BASE,
    MONGODB_DB: dbName,
    PORT: String(port),
    JWT_SECRET: "rbac-test-secret",
    ADMIN_EMAIL,
    ADMIN_PASSWORD: ADMIN_PASS,
    UPLOADS_DIR: uploadsDir,
    CLIENT_ORIGIN: `http://127.0.0.1:${port}`,
    // With no SMTP configured there is no way to obtain a verification token,
    // so the harness opts in to the explicit development escape hatch and drives
    // the real verify-email endpoint with it. Never set in a real deployment.
    EMAIL_VERIFICATION_DEV_TOKEN: "1",
    // The verification flow must be deterministic, and this machine's .env
    // really does have working SMTP credentials. Deleting the keys is not
    // enough: the server process loads .env itself, and dotenv does not
    // overwrite a variable that is already present. Setting them to the empty
    // string is what actually neutralizes them, so isEmailConfigured() is false
    // and no real message is sent anywhere during a scratch run.
    SMTP_HOST: "",
    SMTP_FROM: "",
    // Same reasoning for S3. This machine's .env has live bucket credentials, and the
    // server resolves storage mode at startup: with a valid bucket it runs in s3 mode
    // and POST /api/upload writes through to the REAL bucket. The upload suite creates
    // throwaway probe files, so the harness must force the local-disk path that
    // UPLOADS_DIR then captures. Emptying AWS_BUCKET_NAME is what makes
    // lib/s3.js fall back to local (it throws in production instead, which is correct:
    // production has no local disk to fall back TO).
    AWS_BUCKET_NAME: "",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_REGION: "",
  };
  delete srvEnv.VERCEL;
  for (const key of Object.keys(srvEnv)) {
    if (key.startsWith("SMTP_USER") || key.startsWith("SMTP_PASS") || key.startsWith("SMTP_PORT") || key.startsWith("SMTP_SECURE")) {
      delete srvEnv[key];
    }
  }

  serverLogs = [];
  child = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: srvEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => serverLogs.push(d.toString()));
  child.stderr.on("data", (d) => serverLogs.push(d.toString()));
  stopServer = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  };

  await waitFor(async () => (await api("/health")).status === 200);

  const adminLogin = await waitFor(async () => {
    const r = await api("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASS } });
    return r.status === 200 ? r.data : null;
  });
  superToken = adminLogin.token;

  const probe1 = await api("/entities/User/filter", { method: "POST", token: superToken, body: { query: {} } });
  check("probe: minimal filter works right after login", probe1.status === 200 && Array.isArray(probe1.data), `status=${probe1.status} isArr=${Array.isArray(probe1.data)}`);
  const probe2 = await api("/auth/me", { method: "GET", token: superToken });
  check("probe: /auth/me after filter works", probe2.status === 200, `status=${probe2.status}`);

  // Email verification flow, exercised for real rather than bypassed. The token
  // is captured from the registration response (dev escape hatch) and spent
  // against the live endpoint, so a token that is not stored hashed, is not
  // single-use, or is refused after verification fails here.
  const verificationChecks = async () => {
    const email = em("verifyflow");
    const reg = await api("/auth/register", {
      method: "POST",
      body: { email, password: TEST_PASSWORD, full_name: "Verify Flow", school_name: `Verify Flow ${runId}` },
    });
    check("verify: register returns a session and flags verification required", reg.status === 200 && reg.data.verification_required === true, `status=${reg.status}`);
    check("verify: register reports the account unverified", reg.data.email_verified === false, `email_verified=${reg.data.email_verified}`);
    const tok = reg.data.dev_verification_token;
    check("verify: dev token is issued when email is not configured", typeof tok === "string" && tok.length > 32, `present=${typeof tok === "string"}`);
    if (reg.data.user?.tenant_id) trackedTenant(reg.data.user.tenant_id);
    if (reg.data.user?.id) userIds.add(reg.data.user.id);
    const token = reg.data.token;
    if (!token) return null;

    const db = await findUserByEmail(email);
    check("verify: account is stored unverified", db?.email_verified === false, `stored=${db?.email_verified}`);
    check(
      "verify: only a hash of the token is stored",
      typeof db?.email_verification_token === "string" && db.email_verification_token.length === 64 && db.email_verification_token !== tok,
      `len=${db?.email_verification_token?.length}`
    );
    check("verify: token expiry is stored", Boolean(db?.email_verification_expires_at), `present=${Boolean(db?.email_verification_expires_at)}`);

    const me = await api("/auth/me", { token });
    check("verify: unverified account may still read /auth/me", me.status === 200, `status=${me.status}`);
    check("verify: /auth/me reports email_verified false", me.data?.email_verified === false, `email_verified=${me.data?.email_verified}`);

    const blocked = await api("/entities/SchoolClass", { token });
    check("verify: unverified account is blocked from entity API", blocked.status === 403, `status=${blocked.status}`);
    check("verify: block carries the EMAIL_UNVERIFIED code", blocked.data?.code === "EMAIL_UNVERIFIED", `code=${blocked.data?.code}`);

    const blockedPath = await api("/auth/change-password", { method: "POST", token, body: {} });
    check("verify: an unverified account is blocked even from non-allowlisted auth routes", blockedPath.status === 403 && blockedPath.data?.code === "EMAIL_UNVERIFIED", `status=${blockedPath.status} code=${blockedPath.data?.code}`);

    const bad = await api("/auth/verify-email", { method: "POST", body: { token: `${tok}x` } });
    check("verify: a wrong token is refused", bad.status === 400, `status=${bad.status}`);
    const stillBlocked = await api("/entities/SchoolClass", { token });
    check("verify: a failed attempt does not verify the account", stillBlocked.status === 403, `status=${stillBlocked.status}`);

    const good = await api("/auth/verify-email", { method: "POST", body: { token: tok } });
    check("verify: a valid token verifies the account", good.status === 200 && good.data?.success === true, `status=${good.status}`);

    const after = await findUserByEmail(email);
    check("verify: account is now verified", after?.email_verified === true, `stored=${after?.email_verified}`);
    check("verify: token is destroyed on use", !after?.email_verification_token && !after?.email_verification_expires_at, `tokenStillPresent=${Boolean(after?.email_verification_token)}`);

    const replay = await api("/auth/verify-email", { method: "POST", body: { token: tok } });
    check("verify: the same token cannot be replayed", replay.status === 400, `status=${replay.status}`);

    const open = await api("/entities/SchoolClass", { token });
    check("verify: verified account regains full API access", open.status === 200, `status=${open.status}`);

    const resendAnon = await api("/auth/resend-verification", { method: "POST" });
    check("verify: resend requires authentication", resendAnon.status === 401, `status=${resendAnon.status}`);

    // A second unverified account, used only for the resend checks.
    const email2 = em("resendflow");
    const reg2 = await api("/auth/register", {
      method: "POST",
      body: { email: email2, password: TEST_PASSWORD, full_name: "Resend Flow", school_name: `Resend Flow ${runId}` },
    });
    if (reg2.data?.user?.tenant_id) trackedTenant(reg2.data.user.tenant_id);
    if (reg2.data?.user?.id) userIds.add(reg2.data.user.id);
    const resend = await api("/auth/resend-verification", { method: "POST", token: reg2.data.token });
    check("verify: resend succeeds for an unverified session", resend.status === 200 && resend.data?.success === true, `status=${resend.status}`);
    check("verify: resend reports delivery state honestly", resend.data?.delivered === false && resend.data?.email_configured === false, `delivered=${resend.data?.delivered} configured=${resend.data?.email_configured}`);
    const resendAgain = await api("/auth/resend-verification", { method: "POST", token: reg2.data.token });
    check("verify: resend rotates to a new token", resendAgain.status === 200, `status=${resendAgain.status}`);

    const staleToken = await api("/auth/verify-email", { method: "POST", body: { token: reg2.data.dev_verification_token } });
    check("verify: a resend invalidates the token it replaced", staleToken.status === 400, `status=${staleToken.status}`);

    const reg2Token = resendAgain.data?.dev_verification_token;
    const reg2Verify = await api("/auth/verify-email", { method: "POST", body: { token: reg2Token } });
    const reg2Db = await findUserByEmail(email2);
    const resendVerified = await api("/auth/resend-verification", { method: "POST", token: reg2.data.token });
    check(
      "verify: resend on a verified account is a no-op",
      resendVerified.status === 200 && resendVerified.data?.already_verified === true,
      `status=${resendVerified.status} already=${resendVerified.data?.already_verified} verifyStatus=${reg2Verify.status} stored=${reg2Db?.email_verified}`
    );

    return { token, tenantId: reg.data.user?.tenant_id };
  };

  // Escalation attempt: the activation switch must not be writable through the
  // generic entity API by an account that is allowed to write User records at
  // all. Without this, a super_admin could simply clear the flag and any other
  // gate would be pointless.
  const verificationWriteGuard = async () => {
    const email = em("writeguard");
    const reg = await api("/auth/register", {
      method: "POST",
      body: { email, password: TEST_PASSWORD, full_name: "Write Guard", school_name: `Write Guard ${runId}` },
    });
    const target = reg.data.user;
    if (target?.tenant_id) trackedTenant(target.tenant_id);
    if (target?.id) userIds.add(target.id);

    const single = await api(`/entities/User/${target.id}`, {
      method: "PATCH",
      token: superToken,
      body: { email_verified: true },
    });
    check("verify: PATCH /entities/User/:id refuses email_verified", single.status === 403, `status=${single.status} err=${single.data?.error}`);

    const bulk = await api("/entities/User/many", {
      method: "PATCH",
      token: superToken,
      body: { query: { id: target.id }, update: { email_verified: true } },
    });
    check("verify: PATCH /entities/User/many refuses email_verified", bulk.status === 403, `status=${bulk.status} err=${bulk.data?.error}`);

    const stillBlocked = await api("/entities/SchoolClass", { token: reg.data.token });
    check("verify: the refused write did not verify the account", stillBlocked.status === 403, `status=${stillBlocked.status}`);
    const db = await findUserByEmail(email);
    check("verify: account is still unverified in the database", db?.email_verified === false, `stored=${db?.email_verified}`);

    const tokenWrite = await api(`/entities/User/${target.id}`, {
      method: "PATCH",
      token: superToken,
      body: { email_verification_token: "x" },
    });
    check("verify: PATCH cannot plant a verification token either", tokenWrite.status === 403, `status=${tokenWrite.status}`);

    const combined = await api(`/entities/User/${target.id}`, {
      method: "PATCH",
      token: superToken,
      body: { app_role: "school_admin", email_verified: true },
    });
    check("verify: app_role delegation cannot smuggle email_verified", combined.status === 403, `status=${combined.status}`);

    // Regression: the single-record PATCH used to take req.body verbatim while
    // the guards are all field-name based, so wrapping the payload in `update`
    // matched no guarded key and was $set as a literal subdocument. The body
    // must be a flat field map, and a wrapper is refused rather than unwrapped,
    // so the two routes cannot drift apart again.
    const wrappedToken = await api(`/entities/User/${target.id}`, {
      method: "PATCH",
      token: superToken,
      body: { update: { email_verification_token: "planted" } },
    });
    check("verify: a wrapped body cannot bypass the single-record PATCH guard", wrappedToken.status === 400, `status=${wrappedToken.status}`);

    const wrappedRole = await api(`/entities/User/${target.id}`, {
      method: "PATCH",
      token: superToken,
      body: { update: { role: "admin" } },
    });
    check("verify: a wrapped body cannot write a legacy role either", wrappedRole.status === 400, `status=${wrappedRole.status}`);

    const operatorBody = await api(`/entities/User/${target.id}`, {
      method: "PATCH",
      token: superToken,
      body: { $set: { email_verified: true } },
    });
    check("verify: a raw $set operator body is refused", operatorBody.status === 400, `status=${operatorBody.status}`);

    const flatStillWorks = await api(`/entities/User/${target.id}`, {
      method: "PATCH",
      token: superToken,
      body: { full_name: "Write Guard Renamed" },
    });
    check("verify: a flat field body still updates normally", flatStillWorks.status === 200, `status=${flatStillWorks.status}`);

    const stillUnverified = await findUserByEmail(email);
    // The account legitimately holds a pending token from its own registration,
    // so only the refusal outcome is asserted: still unverified, and no `update`
    // subdocument was smuggled onto the record.
    check(
      "verify: none of the refused writes verified the account",
      stillUnverified?.email_verified === false && !stillUnverified?.update,
      `verified=${stillUnverified?.email_verified} strayField=${Boolean(stillUnverified?.update)}`
    );

    await api("/auth/verify-email", { method: "POST", body: { token: reg.data.dev_verification_token } });
  };

  await verificationChecks();
  await verificationWriteGuard();

  const makeTenantAdmin = async (label) => {
    const email = em(`admin-${label}-${runId}`.replace(/-/g, ""));
    const r = await api("/auth/register", {
      method: "POST",
      body: { email, password: TEST_PASSWORD, full_name: `RBAC Admin ${label}`, school_name: `RBAC Test ${label} ${runId}` },
    });
    if (r.status !== 200) throw new Error(`register ${label} failed: ${r.status} ${r.raw}`);
    const user = r.data.user;
    userIds.add(user.id);
    trackedTenant(user.tenant_id);
    check(`fixture: tenant ${label} admin registered`, Boolean(user.tenant_id), `role=${user.app_role}`);
    // Registration deliberately produces an unverified account. Every later
    // check in this harness assumes a usable school_admin session, so complete
    // the real flow here instead of editing the flag, which would let a broken
    // verification path pass unnoticed.
    const v = await api("/auth/verify-email", { method: "POST", body: { token: r.data.dev_verification_token } });
    if (v.status !== 200) throw new Error(`verify ${label} failed: ${v.status} ${v.raw}`);
    check(`fixture: tenant ${label} admin verified`, true);
    return { token: r.data.token, tenantId: user.tenant_id, email };
  };

  const tenantA = await makeTenantAdmin("A");
  const tenantB = await makeTenantAdmin("B");
  const tenantAId = tenantA.tenantId;
  const tenantBId = tenantB.tenantId;
  const adminAToken = tenantA.token;
  const adminBToken = tenantB.token;


  const invite = async (token, email, role) => api("/users/invite", { method: "POST", token, body: { email, role } });
  const makeUser = async (token, email, role) => {
    const r = await invite(token, email, role);
    if (r.status !== 200) throw new Error(`invite ${email} failed: ${r.status} ${r.raw}`);
    const u = await findUserByEmail(email);
    if (!u) throw new Error(`invited user not found: ${email}`);
    userIds.add(u._id.toString());
    return u;
  };
  const makeAccessible = async (email) => {
    const u = await findUserByEmail(email);
    await DB.collection("User").updateOne({ _id: u._id }, { $set: { password_hash: await hashPw(TEST_PASSWORD) } });
    const r = await api("/auth/login", { method: "POST", body: { email, password: TEST_PASSWORD } });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${r.raw}`);
    return r.data.token;
  };

  const seedUser = async (email, role, tenantId) => {
    const doc = {
      email: email.toLowerCase().trim(),
      password_hash: await hashPw(TEST_PASSWORD),
      role: "user",
      app_role: role,
      app_roles: [role],
      tenant_id: tenantId,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
    };
    const res = await DB.collection("User").insertOne(doc);
    userIds.add(res.insertedId.toString());
    return doc;
  };

  // A multi-role account, seeded the way the assignment path writes one: the
  // canonical array plus a mirror of the primary role. `app_role` is passed
  // explicitly so a test can also plant a DISAGREEING mirror and prove the
  // canonical array is what is read.
  const seedRoleSet = async (email, roles, tenantId, { mirror } = {}) => {
    const primary = roles[0];
    const doc = {
      email: email.toLowerCase().trim(),
      password_hash: await hashPw(TEST_PASSWORD),
      role: "user",
      app_roles: roles,
      app_role: mirror !== undefined ? mirror : primary,
      tenant_id: tenantId,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
    };
    const res = await DB.collection("User").insertOne(doc);
    userIds.add(res.insertedId.toString());
    return doc;
  };

  // A pre-migration document: no app_roles at all, only the old mirror. Used to
  // prove the deploy is safe before the backfill has run anywhere.
  const seedLegacyUser = async (email, role, tenantId) => {
    const doc = {
      email: email.toLowerCase().trim(),
      password_hash: await hashPw(TEST_PASSWORD),
      role: "user",
      app_role: role,
      tenant_id: tenantId,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
    };
    const res = await DB.collection("User").insertOne(doc);
    userIds.add(res.insertedId.toString());
    return doc;
  };

  const principalEmail = em("principal");
  const ecEmail = em("examcoord");
  const teacherEmail = em("teacher");
  const studentEmail = em("student");
  const parentEmail = em("parent");
  const bTeacherEmail = em("bteacher");

  await makeUser(adminAToken, principalEmail, "principal");
  await seedUser(ecEmail, "exam_coordinator", tenantAId);
  await makeUser(adminAToken, teacherEmail, "teacher");
  await makeUser(adminAToken, studentEmail, "student");
  await makeUser(adminAToken, parentEmail, "parent");
  await makeUser(adminBToken, bTeacherEmail, "teacher");

  const principalToken = await makeAccessible(principalEmail);
  const ecToken = await makeAccessible(ecEmail);
  const teacherToken = await makeAccessible(teacherEmail);
  const studentToken = await makeAccessible(studentEmail);
  const parentToken = await makeAccessible(parentEmail);
  const bTeacherToken = await makeAccessible(bTeacherEmail);

  const ent = async (name, method, token, body, extra = "") =>
    api(`/entities/${name}${extra}${method === "filter" ? "/filter" : ""}`, {
      method: method === "filter" ? "POST" : method,
      token,
      body: ["POST", "PATCH", "filter"].includes(method) ? body : undefined,
    });

  let studentSeed = 0;
  const nextStudentEmail = () => `rbac-${runId}-s${studentSeed++}@example.test`;
  const makeStudent = async (token, tenant_id, doc = {}) =>
    ent("Student", "POST", token, { tenant_id, full_name: "RBAC Student", roll_number: "RN1", class_name: "Class 10", section: "A", status: "active", student_email: nextStudentEmail(), parent_email: "", ...doc });

  // Classes must exist before the students below. Student hydration resolves
  // class_name with createIfMissing=false, so a student created before its
  // class exists is stored with no school_class_id and is invisible to the
  // teacher scope -- correct server behaviour, but it would make every
  // class-scoping assertion below vacuous.
  const classA = await ent("SchoolClass", "POST", adminAToken, { tenant_id: tenantAId, name: "Class 10" });
  check("fixture: admin creates Class 10", classA.status === 201, `${classA.status}`);
  const classB = await ent("SchoolClass", "POST", adminAToken, { tenant_id: tenantAId, name: "Class 12" });
  check("fixture: admin creates Class 12", classB.status === 201, `${classB.status}`);

  // An academic year must exist before any exam roster can resolve:
  // deriveEnrolledStudents() scopes every query to it and returns [] without
  // one. The harness previously seeded none, which silently made the exam
  // roster empty and turned the OMR/evaluate audit assertions (K7/K8) into
  // no-ops rather than real coverage.
  const yearA = await ent("AcademicYear", "POST", adminAToken, {
    tenant_id: tenantAId,
    name: "2026-2027",
    start_date: "2026-04-01",
    end_date: "2027-03-31",
    is_current: true,
    status: "active",
  });
  check("fixture: admin creates current AcademicYear", yearA.status === 201, `${yearA.status}`);

  const studentA1 = await makeStudent(adminAToken, tenantAId);
  check("fixture: admin creates tenant-A student", studentA1.status === 201, `${studentA1.status}`);
  const studentA1Id = studentA1.data.id;

  const bStudent = await makeStudent(superToken, tenantBId, { full_name: "Tenant B student", roll_number: "RB1", class_name: "Class 11" });
  check("fixture: super creates tenant-B student (cross-tenant write)", bStudent.status === 201, `${bStudent.status}`);
  const bStudentId = bStudent.data.id;

  await DB.collection("User").updateOne({ email: studentEmail }, { $set: { linked_student_id: studentA1Id, app_role: "student" } });
  await ent("Teacher", "POST", adminAToken, { tenant_id: tenantAId, full_name: "RBAC Teacher A", email: teacherEmail, subject: "Math", classes: ["Class 10"], status: "active" });
  await ent("Teacher", "POST", adminBToken, { tenant_id: tenantBId, full_name: "RBAC Teacher B", email: bTeacherEmail, subject: "Math", classes: ["Class 11"], status: "active" });

  const examA = await ent("Examination", "POST", adminAToken, { tenant_id: tenantAId, name: "RBAC Final", subject_name: "Math", class_name: "Class 10", status: "published" });
  check("fixture: admin creates tenant-A examination", examA.status === 201, `${examA.status}`);
  const examAId = examA.data.id;
  let akAId;

  // Answer-key scope fixtures. examA is `published`, so it is frozen and cannot
  // be used for key writes; the draft/evaluated twins below cover each branch.
  // The teacher owns Class 10 + Math and nothing else.
  const examKeyDraft = await ent("Examination", "POST", adminAToken, { tenant_id: tenantAId, name: "RBAC Keyable", subject_name: "Math", class_name: "Class 10", status: "draft" });
  check("fixture: admin creates draft Class 10 Math examination", examKeyDraft.status === 201, `${examKeyDraft.status}`);
  const examKeyDraftId = examKeyDraft.data.id;

  const examKeyOtherSubject = await ent("Examination", "POST", adminAToken, { tenant_id: tenantAId, name: "RBAC Physics", subject_name: "Physics", class_name: "Class 10", status: "draft" });
  check("fixture: admin creates draft Class 10 Physics examination", examKeyOtherSubject.status === 201, `${examKeyOtherSubject.status}`);
  const examKeyOtherSubjectId = examKeyOtherSubject.data.id;

  const examKeyOtherClass = await ent("Examination", "POST", adminAToken, { tenant_id: tenantAId, name: "RBAC Class12", subject_name: "Math", class_name: "Class 12", status: "draft" });
  check("fixture: admin creates draft Class 12 Math examination", examKeyOtherClass.status === 201, `${examKeyOtherClass.status}`);
  const examKeyOtherClassId = examKeyOtherClass.data.id;

  const examKeyFrozen = await ent("Examination", "POST", adminAToken, { tenant_id: tenantAId, name: "RBAC Evaluated", subject_name: "Math", class_name: "Class 10", status: "evaluated" });
  check("fixture: admin creates evaluated Class 10 Math examination", examKeyFrozen.status === 201, `${examKeyFrozen.status}`);
  const examKeyFrozenId = examKeyFrozen.data.id;


  // -------------------------------------------------------------------------
  // A — super_admin (platform owner)
  {
    const r1 = await ent("Student", "GET", superToken, null, `/${bStudentId}`);
    check("A1: super reads cross-tenant student", r1.status === 200 && r1.data.tenant_id === tenantBId, `status=${r1.status}`);
    const r2 = await ent("Examination", "GET", superToken, null, `/${examAId}`);
    check("A2: super reads tenant-A examination", r2.status === 200, `status=${r2.status}`);
    const r3 = await api("/functions/processOMRSheet", { method: "POST", token: superToken, body: {} });
    check("A3: super passes processOMRSheet gate (reaches 400 input check)", r3.status === 400, `status=${r3.status} msg=${r3.data.error}`);
    const r4 = await api("/functions/evaluateExamination", { method: "POST", token: superToken, body: {} });
    check("A4: super passes evaluateExamination gate (reaches 400 input check)", r4.status === 400, `status=${r4.status} msg=${r4.data.error}`);
    const r5 = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "list" } });
    const clean = Array.isArray(r5.data.staff) && r5.data.staff.every((s) => !("password_hash" in s));
    check("A5: super manageStaff list works and never leaks password_hash", r5.status === 200 && clean, `status=${r5.status} staff=${r5.data.staff?.length}`);

    // --- super_admin staffing an institution from /staff ------------------------
    // super_admin holds no institution of its own, so the screen gives it a picker
    // and every call names the school it is acting for. The hierarchy now states
    // the platform owner's reach instead of a per-caller bypass disagreeing with
    // it: previously this dropdown held one option, "School Administrator".
    const superRoles = r5.data.creatable_roles;
    const superOffer = Array.isArray(superRoles)
      && superRoles.includes("principal")
      && superRoles.includes("exam_coordinator")
      && superRoles.includes("teacher")
      && !superRoles.includes("student")
      && !superRoles.includes("parent")
      && !superRoles.includes("school_admin");
    check("A5b: super sees the three staff roles — never the family roles or the administrator role", r5.status === 200 && superOffer, `creatable_roles=${JSON.stringify(superRoles)}`);

    const scopedA = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "list", tenant_id: tenantAId } });
    const scopedATenants = Array.isArray(scopedA.data.staff) && scopedA.data.staff.length > 0 && scopedA.data.staff.every((s) => String(s.tenant_id) === String(tenantAId));
    check("A5c: super can scope the staff list to one institution", scopedA.status === 200 && scopedATenants, `status=${scopedA.status} staff=${scopedA.data.staff?.length} allInTenantA=${scopedATenants}`);

    // The screen's real call: provision into the picked institution. The account
    // must land IN that institution — not tenant-less, which is what
    // `req.user?.tenant_id || null` produced for a super_admin.
    const provEmail = em("super-provisions");
    const prov = await api("/users/provision", {
      method: "POST",
      token: superToken,
      body: { email: provEmail, full_name: "Super Provisioned Coord", password: TEST_PASSWORD, role: "exam_coordinator", tenant_id: tenantAId },
    });
    const provisioned = await findUserByEmail(provEmail);
    if (provisioned) userIds.add(provisioned._id.toString());
    check(
      "A5d: super CAN provision an exam_coordinator into a named institution, and it carries that tenant",
      prov.status === 201 && provisioned?.app_role === "exam_coordinator" && String(provisioned?.tenant_id) === String(tenantAId),
      `status=${prov.status} role=${provisioned?.app_role} tenant=${provisioned?.tenant_id} err=${prov.data.error || ""}`
    );

    // A tenant role attached to no institution is an account that can authenticate
    // but never reach a school. Both invite paths must refuse it for a platform
    // caller. This check runs before the rate limiter, so refusals cost no quota.
    const orphanInvite = await api("/users/invite", { method: "POST", token: superToken, body: { email: em("orphan-invite"), role: "teacher" } });
    const orphanMs = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "invite", email: em("orphan-ms"), app_role: "teacher" } });
    check("A5e: super CANNOT invite a tenant role with no institution (both invite paths refuse)", orphanInvite.status === 400 && orphanMs.status === 400, `users/invite=${orphanInvite.status} manageStaff=${orphanMs.status}`);

    // A school_admin is pinned to its own institution: naming another is refused
    // 404 rather than silently ignored, so it can neither read nor write across.
    const foreignList = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "list", tenant_id: tenantBId } });
    const foreignInvite = await api("/users/invite", { method: "POST", token: adminAToken, body: { email: em("cross-invite"), role: "teacher", tenant_id: tenantBId } });
    check("A5f: a school_admin naming another institution is refused 404 on both paths", foreignList.status === 404 && foreignInvite.status === 404, `list=${foreignList.status} invite=${foreignInvite.status}`);

    // --- User privilege-state invariants across every User write route ---------
    // Even super_admin has no legitimate reason to move an account, forge a role,
    // write a password hash, or delete accounts in bulk. These routes are the
    // ones that were asymmetric: DELETE /User/:id refused, DELETE /User/many did
    // not; the single PATCH delegated app_role but then wrote the same request's
    // tenant_id and role through its own $set, over the delegation.
    const victim = await findUserByEmail(bTeacherEmail);
    const victimId = victim._id.toString();
    // Snapshotted whole. The fixture legitimately carries a legacy `role` field,
    // so the invariant is "unchanged", not "absent" — a forged value would differ
    // from the snapshot, and that is what A8 asserts.
    const before = { app_role: victim.app_role, tenant: victim.tenant_id.toString(), role: victim.role };

    // A: mass deletion of accounts, by broad query and by explicit email list.
    const delMany = await api("/entities/User/many", { method: "DELETE", token: superToken, body: { query: {} } });
    const delManyByEmail = await api("/entities/User/many", { method: "DELETE", token: superToken, body: { query: { email: { $in: [bTeacherEmail, tenantB.email] } } } });
    check(
      "A6: super CANNOT mass-delete accounts via DELETE /entities/User/many",
      delMany.status === 403 && delManyByEmail.status === 403,
      `broad=${delMany.status} byEmail=${delManyByEmail.status}`
    );

    // B: the single-record smuggle. app_role is delegated, but pairing it with a
    // tenant_id or a legacy role must not reach the generic $set.
    const smuggleRole = await ent("User", "PATCH", superToken, { app_role: "teacher", role: "super_admin" }, `/${victimId}`);
    const smuggleTenant = await ent("User", "PATCH", superToken, { app_role: "teacher", tenant_id: tenantAId }, `/${victimId}`);
    const afterSmuggle = await findUserByEmail(bTeacherEmail);
    check(
      "A7: PATCH /entities/User/:id refuses app_role combined with role or tenant_id",
      smuggleRole.status === 403 && smuggleTenant.status === 403,
      `withRole=${smuggleRole.status} withTenant=${smuggleTenant.status}`
    );
    check(
      "A8: ...and the refused requests changed nothing (no forged role, no tenant move)",
      afterSmuggle.app_role === before.app_role &&
        afterSmuggle.tenant_id.toString() === before.tenant &&
        afterSmuggle.role === before.role,
      `app_role ${before.app_role}->${afterSmuggle.app_role} tenantMoved=${afterSmuggle.tenant_id.toString() !== before.tenant} role ${before.role}->${afterSmuggle.role}`
    );

    // C: credential and role writes through the bulk route.
    const manyPatch = (update) => api("/entities/User/many", { method: "PATCH", token: superToken, body: { query: {}, update } });
    const manyHash = await manyPatch({ password_hash: "x" });
    const manySet = await manyPatch({ $set: { password_hash: "x" } });
    const manyRole = await manyPatch({ role: "super_admin" });
    const manyTenant = await manyPatch({ tenant_id: tenantAId });
    const manyAppRole = await manyPatch({ app_role: "super_admin" });
    check(
      "A9: PATCH /entities/User/many refuses credentials, role, legacy role and tenant moves",
      manyHash.status === 403 && manySet.status === 403 && manyRole.status === 403 && manyTenant.status === 403 && manyAppRole.status === 403,
      `hash=${manyHash.status} $set=${manySet.status} role=${manyRole.status} tenant=${manyTenant.status} app_role=${manyAppRole.status}`
    );
    const stillHasHash = await findUserByEmail(bTeacherEmail);
    check(
      "A10: ...and the bulk refusals left password_hash intact",
      Boolean(stillHasHash.password_hash),
      `password_hash present=${Boolean(stillHasHash.password_hash)}`
    );

    // D: a mixed bulk body must be refused on the offending item, not just the first.
    const mixedBulk = await api("/entities/User/bulk", { method: "PATCH", token: superToken, body: { items: [{ id: victimId, full_name: "ok" }, { id: victimId, password_hash: "x" }] } });
    check("A11: bulk User update refuses a privileged field on a later item", mixedBulk.status === 403, `status=${mixedBulk.status}`);
  }

  // -------------------------------------------------------------------------
  // B — school_admin (tenant A)
  {
    const s2 = await makeStudent(adminAToken, tenantAId, { full_name: "B student", roll_number: "BN1" });
    check("B1: school_admin creates own-tenant Student", s2.status === 201, `${s2.status}`);
    const s2Id = s2.data.id;
    const t1 = await ent("Teacher", "POST", adminAToken, { tenant_id: tenantAId, full_name: "B Teacher", email: em("bteacher"), subject: "Math", status: "active" });
    check("B2: school_admin creates own-tenant Teacher", t1.status === 201, `${t1.status}`);
    const e2 = await ent("Examination", "POST", adminAToken, { tenant_id: tenantAId, name: "B Exam", subject_name: "Sci", class_name: "Class 10", status: "draft" });
    check("B3: school_admin creates own-tenant Examination", e2.status === 201, `${e2.status}`);

    const an = await ent("TenantAnnouncement", "POST", adminAToken, { tenant_id: tenantAId, title: "Assembly", message: "tomorrow", type: "info" });
    check("B4: school_admin creates TenantAnnouncement (SchoolDashboard)", an.status === 201, `${an.status}`);
    const anPatch = await ent("TenantAnnouncement", "PATCH", adminAToken, { message: "updated" }, `/${an.data.id}`);
    check("B5: school_admin updates TenantAnnouncement", anPatch.status === 200, `${anPatch.status}`);
    const anDel = await ent("TenantAnnouncement", "DELETE", adminAToken, null, `/${an.data.id}`);
    check("B6: school_admin deletes TenantAnnouncement", anDel.status === 200, `${anDel.status}`);

    const sub = await ent("Subject", "POST", adminAToken, { tenant_id: tenantAId, name: "Physics" });
    check("B7: school_admin creates Subject", sub.status === 201, `${sub.status}`);

    const ak = await ent("AnswerKey", "POST", adminAToken, { tenant_id: tenantAId, examination_id: examKeyDraftId, content: "{}" });
    check("B8: school_admin creates AnswerKey", ak.status === 201, `${ak.status}`);
    akAId = ak.data.id;
    const akPatch = await ent("AnswerKey", "PATCH", adminAToken, { content: "{updated}" }, `/${akAId}`);
    check("B9: school_admin updates AnswerKey", akPatch.status === 200, `${akPatch.status}`);

    const sDel = await ent("Student", "DELETE", adminAToken, null, `/${s2Id}`);
    check("B10: school_admin deletes own-tenant Student (delete_students)", sDel.status === 200, `${sDel.status}`);

    const x = await makeStudent(adminAToken, tenantBId, { full_name: "Should fail" });
    check("B11: school_admin CANNOT write cross-tenant (create Student in tenant B)", x.status === 403, `status=${x.status}`);
    const flt = await ent("Student", "filter", adminAToken, { query: { tenant_id: tenantBId } });
    const leaked = Array.isArray(flt.data) ? flt.data.filter((r) => r.tenant_id === tenantBId) : [];
    check("B12: school_admin CANNOT read cross-tenant students", leaked.length === 0, `status=${flt.status} type=${Array.isArray(flt.data) ? "array" : typeof flt.data} body=${flt.raw.slice(0, 120)}`);

    const tCreate = await ent("Tenant", "POST", adminAToken, { name: "Rogue" });
    check("B13: school_admin CANNOT create Tenant (platform-only)", tCreate.status === 403, `status=${tCreate.status}`);
    const uCreate = await ent("User", "POST", adminAToken, { email: em("rogue"), app_role: "teacher" });
    check("B14: school_admin CANNOT create User (platform-only)", uCreate.status === 403, `status=${uCreate.status}`);

    const invSuper = await invite(adminAToken, em("wantsuper"), "super_admin");
    const invEmp = await invite(adminAToken, em("wantemp"), "employee");
    check("B15: school_admin CANNOT invite platform roles via /users/invite", invSuper.status === 403 && invEmp.status === 403, `super=${invSuper.status} employee=${invEmp.status}`);
    const msInvite = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "invite", email: em("wantsuper2"), app_role: "super_admin" } });
    const msSet = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "setRole", user_id: (await findUserByEmail(teacherEmail))._id.toString(), app_role: "super_admin" } });
    check("B16: school_admin CANNOT assign platform roles via manageStaff", msInvite.status === 403 && msSet.status === 403, `invite=${msInvite.status} setRole=${msSet.status}`);

    const msList = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "list" } });
    const clean = Array.isArray(msList.data.staff) && msList.data.staff.length > 0 && msList.data.staff.every((s) => !("password_hash" in s));
    check("B17: manageStaff list returns only tenant staff without password_hash", msList.status === 200 && clean, `status=${msList.status} staff=${msList.data.staff?.length}`);

    // The staff screen renders `creatable_roles` rather than its own copy of the
    // delegation matrix, so the wire contract itself is the thing worth pinning:
    // exam_coordinator must be offerable, and the family portal roles must not.
    const creatable = msList.data.creatable_roles;
    const offerable = Array.isArray(creatable)
      && creatable.includes("exam_coordinator")
      && !creatable.includes("student")
      && !creatable.includes("parent");
    check("B17b: manageStaff list sends creatable_roles with exam_coordinator and no family roles", msList.status === 200 && offerable, `creatable_roles=${JSON.stringify(creatable)}`);

    // And the server must honour what it advertised, or the dropdown offers a role
    // that 403s on submit. This is the exact call the Role dropdown makes.
    const coordTargetEmail = em("promotetocoord");
    await makeUser(adminAToken, coordTargetEmail, "teacher");
    const setCoord = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "setRole", user_id: (await findUserByEmail(coordTargetEmail))._id.toString(), app_role: "exam_coordinator" } });
    const becameCoord = (await findUserByEmail(coordTargetEmail))?.app_role === "exam_coordinator";
    check("B17c: school_admin CAN promote own-tenant staff to exam_coordinator", setCoord.status === 200 && becameCoord, `status=${setCoord.status} stored=${becameCoord} err=${setCoord.data.error || ""}`);

    // A coordinator staffs nobody, and cannot reach the staff screen to try: the
    // route is gated by PAGE_ROLES.schoolAdmin and the server refuses manageStaff
    // to every non-school_admin, exactly as C10/E9 assert for principal and teacher.
    const coordToken = await makeAccessible(coordTargetEmail);
    const coordList = await api("/functions/manageStaff", { method: "POST", token: coordToken, body: { action: "list" } });
    check("B17d: exam_coordinator CANNOT manage staff (the screen is school-admin only)", coordList.status === 403, `status=${coordList.status}`);

    // The family roles stay provisionable — they are simply not staff-screen roles.
    // provisionAutoLogins() depends on this, since admitting a Student mints the
    // portal login through canProvisionRole(creator, "student"/"parent").
    const invStudent = await invite(adminAToken, em("via-api"), "student");
    check("B17e: family roles remain provisionable outside the staff screen", invStudent.status === 200, `status=${invStudent.status}`);

    const reRoleEmail = em("rerole");
    await makeUser(adminAToken, reRoleEmail, "teacher");
    const setRoleOk = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "setRole", user_id: (await findUserByEmail(reRoleEmail))._id.toString(), app_role: "principal" } });
    check("B18: school_admin can retrain own-tenant staff role (legit flow)", setRoleOk.status === 200, `status=${setRoleOk.status}`);

    const ownTenant = await ent("Tenant", "GET", adminAToken, null, `/${tenantAId}`);
    const otherTenant = await ent("Tenant", "GET", adminAToken, null, `/${tenantBId}`);
    check("B19: tenant read own=200 / other-tenant=404", ownTenant.status === 200 && otherTenant.status === 404, `own=${ownTenant.status} other=${otherTenant.status}`);
  }

  // -------------------------------------------------------------------------
  // C — principal (tenant A)
  {
    const e1 = await ent("Examination", "POST", principalToken, { tenant_id: tenantAId, name: "P Exam", subject_name: "Eng", class_name: "Class 10", status: "draft" });
    check("C1: principal creates Examination", e1.status === 201, `${e1.status}`);
    const o1 = await ent("OMRSheet", "POST", principalToken, { tenant_id: tenantAId, examination_id: examAId, status: "pending" });
    check("C2: principal creates OMRSheet", o1.status === 201, `${o1.status}`);
    const s1 = await ent("Subject", "POST", principalToken, { tenant_id: tenantAId, name: "Chemistry" });
    check("C3: principal creates Subject (exam dialog flow)", s1.status === 201, `${s1.status}`);
    const r1 = await ent("Result", "POST", principalToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id, status: "draft" });
    check("C4: principal creates Result", r1.status === 201, `${r1.status}`);
    const t1 = await ent("Teacher", "POST", principalToken, { tenant_id: tenantAId, full_name: "P Teacher", email: em("pteacher"), status: "active" });
    check("C5: principal CANNOT create Teacher", t1.status === 403, `${t1.status}`);
    const s2 = await makeStudent(principalToken, tenantAId);
    check("C6: principal CANNOT create Student", s2.status === 403, `${s2.status}`);
    const eDel = await ent("Examination", "DELETE", principalToken, null, `/${examAId}`);
    check("C7: principal CANNOT delete Examination (school_admin only)", eDel.status === 403, `${eDel.status}`);
    const sDel = await ent("Student", "DELETE", principalToken, null, `/${studentA1Id}`);
    check("C8: principal CANNOT delete Student", sDel.status === 403, `${sDel.status}`);
    const sUpd = await ent("Subject", "PATCH", principalToken, { name: "Chem" }, `/${s1.data.id}`);
    check("C9: principal CANNOT update Subject (update=school_admin)", sUpd.status === 403, `${sUpd.status}`);
    // Staffing is the principal's remit, so /staff is now theirs (canManageStaff).
    // This INVERTED when principal was admitted: it used to be a 403 here.
    const ms = await api("/functions/manageStaff", { method: "POST", token: principalToken, body: { action: "list" } });
    check("C10: principal CAN manage staff", ms.status === 200, `${ms.status}`);
    // ...but reaching the screen is not the same as having any authority in it. The
    // hierarchy is what decides that, and it still stops a principal at teacher and
    // exam_coordinator: no peer promotion, and never an administrator.
    const principalSees = Array.isArray(ms.data?.assignable_roles) ? ms.data.assignable_roles : [];
    const principalAssignPeer = await api("/functions/manageStaff", {
      method: "POST", token: principalToken,
      body: { action: "setRoles", user_id: (await findUserByEmail(teacherEmail))._id.toString(), app_roles: ["teacher", "principal"] },
    });
    const principalMintAdmin = await api("/functions/manageStaff", {
      method: "POST", token: principalToken,
      body: { action: "setRoles", user_id: (await findUserByEmail(teacherEmail))._id.toString(), app_roles: ["teacher", "school_admin"] },
    });
    check(
      "C10b: principal may assign staff roles but never a peer principal or an administrator",
      principalAssignPeer.status === 403
        && principalMintAdmin.status === 403
        && !principalSees.includes("school_admin")
        && !principalSees.includes("principal"),
      `peer=${principalAssignPeer.status} admin=${principalMintAdmin.status} assignable_roles=${JSON.stringify(principalSees)}`
    );

    // CROSS-TENANT. Widening this gate is exactly when tenant scoping has to be
    // re-proved, because a principal is a new actor on an endpoint that was
    // previously school-admin-only. 404, not 403: the reply must not confirm that
    // another institution exists, so "not yours" and "not there" are identical.
    const principalForeignList = await api("/functions/manageStaff", { method: "POST", token: principalToken, body: { action: "list", tenant_id: tenantBId } });
    const principalForeignSet = await api("/functions/manageStaff", {
      method: "POST", token: principalToken,
      body: { action: "setRoles", user_id: (await findUserByEmail(bTeacherEmail))._id.toString(), app_roles: ["teacher", "exam_coordinator"] },
    });
    const bTeacherAfter = await findUserByEmail(bTeacherEmail);
    const bUntouched = bTeacherAfter.app_role === "teacher"
      && Array.isArray(bTeacherAfter.app_roles)
      && bTeacherAfter.app_roles.includes("teacher")
      && !bTeacherAfter.app_roles.includes("exam_coordinator");
    check(
      "C10c: principal CANNOT read or write another institution's staff (404, never 403)",
      principalForeignList.status === 404 && principalForeignSet.status === 404 && bUntouched,
      `list=${principalForeignList.status} set=${principalForeignSet.status} b=${JSON.stringify(bTeacherAfter.app_roles)}`
    );

    const omr = await api("/functions/processOMRSheet", { method: "POST", token: principalToken, body: {} });
    check("C11: principal passes processOMRSheet gate (reaches 400)", omr.status === 400, `status=${omr.status} msg=${omr.data.error}`);
    const an = await ent("TenantAnnouncement", "POST", principalToken, { tenant_id: tenantAId, title: "Nope", message: "x", type: "info" });
    check("C12: principal CANNOT create TenantAnnouncement (school_admin only)", an.status === 403, `${an.status}`);
  }

  // -------------------------------------------------------------------------
  // D — exam_coordinator (tenant A)
  {
    const e1 = await ent("Examination", "POST", ecToken, { tenant_id: tenantAId, name: "EC Exam", subject_name: "Bio", class_name: "Class 10", status: "draft" });
    check("D1: exam_coordinator creates Examination", e1.status === 201, `${e1.status}`);
    const ak = await ent("AnswerKey", "POST", ecToken, { tenant_id: tenantAId, examination_id: examKeyDraftId, paper_set: "B", content: "{}" });
    check("D2: exam_coordinator creates AnswerKey", ak.status === 201, `${ak.status} err=${ak.data.error}`);
    const akPatch = await ent("AnswerKey", "PATCH", ecToken, { content: "{v2}" }, `/${ak.data.id}`);
    check("D3: exam_coordinator updates AnswerKey", akPatch.status === 200, `${akPatch.status}`);
    const o1 = await ent("OMRSheet", "POST", ecToken, { tenant_id: tenantAId, examination_id: examAId, status: "pending" });
    check("D4: exam_coordinator creates OMRSheet", o1.status === 201, `${o1.status}`);
    const s1 = await makeStudent(ecToken, tenantAId, { full_name: "EC Student", roll_number: "EC1" });
    check("D5: exam_coordinator creates Student", s1.status === 201, `${s1.status}`);
    const s1Id = s1.data.id;
    const sub = await ent("Subject", "POST", ecToken, { tenant_id: tenantAId, name: "Zoology" });
    check("D6: exam_coordinator creates Subject", sub.status === 201, `${sub.status}`);
    const sDel = await ent("Student", "DELETE", ecToken, null, `/${s1Id}`);
    check("D7: exam_coordinator CANNOT delete Student", sDel.status === 403, `${sDel.status}`);
    const t1 = await ent("Teacher", "POST", ecToken, { tenant_id: tenantAId, full_name: "EC Teacher", email: em("ecTeacher"), status: "active" });
    check("D8: exam_coordinator CANNOT create Teacher", t1.status === 403, `${t1.status}`);
    const eDel = await ent("Examination", "DELETE", ecToken, null, `/${examAId}`);
    check("D9: exam_coordinator CANNOT delete Examination", eDel.status === 403, `${eDel.status}`);
    const rDel = await ent("Result", "DELETE", ecToken, null, `/${studentA1Id}`);
    check("D10: exam_coordinator CANNOT delete Result", rDel.status === 403, `${rDel.status}`);
    const ev = await api("/functions/evaluateExamination", { method: "POST", token: ecToken, body: {} });
    check("D11: exam_coordinator passes evaluateExamination gate (reaches 400)", ev.status === 400, `status=${ev.status} msg=${ev.data.error}`);
  }

  // -------------------------------------------------------------------------
  // E — teacher (tenant A)
  {
    const read = await ent("Examination", "GET", teacherToken, null, `/${examAId}`);
    check("E1: teacher reads own-tenant Examination", read.status === 200, `${read.status}`);
    const e1 = await ent("Examination", "POST", teacherToken, { tenant_id: tenantAId, name: "T Exam", subject_name: "CS", class_name: "Class 10", status: "draft" });
    check("E2: teacher creates Examination", e1.status === 201, `${e1.status} err=${e1.data.error}`);
    const e1Id = e1.data.id;
    const e1Published = await ent("Examination", "POST", teacherToken, { tenant_id: tenantAId, name: "T Sneaky", subject_name: "CS", class_name: "Class 10", status: "published" });
    check("E2a: teacher CANNOT create an already-published Examination", e1Published.status === 403, `${e1Published.status} err=${e1Published.data.error}`);
    const e1Status = await ent("Examination", "PATCH", teacherToken, { status: "published" }, `/${e1Id}`);
    check("E2b: teacher CANNOT change examination status", e1Status.status === 403, `${e1Status.status} err=${e1Status.data.error}`);
    const e1OtherClass = await ent("Examination", "POST", teacherToken, { tenant_id: tenantAId, name: "T Class12", subject_name: "Math", class_name: "Class 12", status: "draft" });
    check("E2c: teacher CANNOT create Examination for an unassigned class", e1OtherClass.status === 403, `${e1OtherClass.status} err=${e1OtherClass.data.error}`);
    const sub = await ent("Subject", "POST", teacherToken, { tenant_id: tenantAId, name: "Computer Science" });
    check("E3: teacher creates Subject (exam dialog flow)", sub.status === 201, `${sub.status}`);
    const ak = await ent("AnswerKey", "POST", teacherToken, { tenant_id: tenantAId, examination_id: examKeyDraftId, paper_set: "T", content: "{}" });
    check("E4: teacher creates AnswerKey for assigned class+subject", ak.status === 201, `${ak.status} err=${ak.data.error}`);
    const akTId = ak.data.id;
    const akPatch = await ent("AnswerKey", "PATCH", teacherToken, { content: "x" }, `/${akTId}`);
    check("E5: teacher updates AnswerKey for assigned class+subject", akPatch.status === 200, `${akPatch.status} err=${akPatch.data.error}`);

    const akOtherSubject = await ent("AnswerKey", "POST", teacherToken, { tenant_id: tenantAId, examination_id: examKeyOtherSubjectId, content: "{}" });
    check("E5a: teacher CANNOT create AnswerKey for unassigned subject", akOtherSubject.status === 403, `${akOtherSubject.status}`);
    const akOtherClass = await ent("AnswerKey", "POST", teacherToken, { tenant_id: tenantAId, examination_id: examKeyOtherClassId, content: "{}" });
    check("E5b: teacher CANNOT create AnswerKey for unassigned class", akOtherClass.status === 403, `${akOtherClass.status}`);
    const akOtherTeacher = await ent("AnswerKey", "POST", bTeacherToken, { tenant_id: tenantAId, examination_id: examKeyDraftId, content: "{}" });
    check("E5c: teacher CANNOT create AnswerKey for another tenant's exam", akOtherTeacher.status === 403, `${akOtherTeacher.status}`);

    const akFrozen = await ent("AnswerKey", "POST", teacherToken, { tenant_id: tenantAId, examination_id: examKeyFrozenId, content: "{}" });
    check("E5d: teacher CANNOT create AnswerKey once exam is evaluated", akFrozen.status === 409, `${akFrozen.status} err=${akFrozen.data.error}`);
    const akFrozenAdmin = await ent("AnswerKey", "POST", adminAToken, { tenant_id: tenantAId, examination_id: examKeyFrozenId, content: "{}" });
    check("E5e: freeze applies to school_admin too, not just teachers", akFrozenAdmin.status === 409, `${akFrozenAdmin.status} err=${akFrozenAdmin.data.error}`);

    const akDup = await ent("AnswerKey", "POST", adminAToken, { tenant_id: tenantAId, examination_id: examKeyDraftId, paper_set: "T", content: "{}" });
    check("E5f: duplicate AnswerKey for same exam+paper_set is rejected", akDup.status === 409, `${akDup.status} err=${akDup.data.error}`);

    const akOnPublished = await ent("AnswerKey", "POST", adminAToken, { tenant_id: tenantAId, examination_id: examAId, content: "{}" });
    check("E5g: school_admin CANNOT create AnswerKey for a published exam", akOnPublished.status === 409, `${akOnPublished.status} err=${akOnPublished.data.error}`);

    const akDel = await ent("AnswerKey", "DELETE", teacherToken, null, `/${akTId}`);
    check("E5h: teacher CANNOT delete AnswerKey", akDel.status === 403, `${akDel.status}`);

    const r1 = await ent("Result", "POST", teacherToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id });
    check("E6: teacher CANNOT create Result", r1.status === 403, `${r1.status}`);
    const s1 = await makeStudent(teacherToken, tenantAId);
    check("E7: teacher CANNOT create Student", s1.status === 403, `${s1.status}`);
    const t1 = await ent("Teacher", "POST", teacherToken, { tenant_id: tenantAId, full_name: "T2", email: em("tt2"), status: "active" });
    check("E8: teacher CANNOT create Teacher", t1.status === 403, `${t1.status}`);
    const ms = await api("/functions/manageStaff", { method: "POST", token: teacherToken, body: { action: "list" } });
    check("E9: teacher CANNOT manage staff", ms.status === 403, `${ms.status}`);
    const omr = await api("/functions/processOMRSheet", { method: "POST", token: teacherToken, body: {} });
    const ev = await api("/functions/evaluateExamination", { method: "POST", token: teacherToken, body: {} });
    check("E10: teacher blocked from OMR/evaluate functions", omr.status === 403 && ev.status === 403, `processOMR=${omr.status} evaluate=${ev.status}`);
    const an = await ent("TenantAnnouncement", "POST", teacherToken, { tenant_id: tenantAId, title: "Nope", message: "x", type: "info" });
    check("E11: teacher CANNOT create TenantAnnouncement", an.status === 403, `${an.status}`);

    // Student detail: reachable from Teacher Portal, but only inside the
    // teacher's assigned classes, and without a class roster to walk.
    const own = await ent("Student", "GET", teacherToken, null, `/${studentA1Id}`);
    check("E12: teacher reads student detail in an assigned class", own.status === 200, `${own.status} err=${own.data.error}`);
    const far = await makeStudent(adminAToken, tenantAId, { full_name: "Class 12 student", roll_number: "C12", class_name: "Class 12" });
    const farRes = await ent("Student", "GET", teacherToken, null, `/${far.data.id}`);
    check("E13: teacher CANNOT read student detail outside assigned classes", farRes.status === 404, `${farRes.status}`);
    const roster = await ent("Student", "filter", teacherToken, {});
    const rosterRows = Array.isArray(roster.data) ? roster.data : [];
    const rosterScoped = rosterRows.every((s) => s.class_name === "Class 10");
    check("E14: teacher student list is scoped to assigned classes", roster.status === 200 && rosterScoped, `status=${roster.status} rows=${rosterRows.length} leaked=${rosterRows.filter((s) => s.class_name !== "Class 10").length}`);

    // Legacy Student shape: class_name but no school_class_id. This is what an
    // import produces when the SchoolClass did not exist yet, because
    // hydrateRelationshipIds resolves with createIfMissing=false and then drops
    // it silently. The row still renders fine in the UI, but every class-scoped
    // query (teacher reads, attendance, rosters, results) used to miss it --
    // which is what made a teacher's "My Students" read 0.
    const legacy = await makeStudent(adminAToken, tenantAId, { full_name: "Legacy Shape Student", roll_number: "LG1", class_name: "Class 10" });
    await DB.collection("Student").updateOne({ _id: new ObjectId(legacy.data.id) }, { $unset: { school_class_id: "", section_id: "" } });
    const legacyRes = await ent("Student", "GET", teacherToken, null, `/${legacy.data.id}`);
    check("E14a: teacher reads a class_name-only student in an assigned class", legacyRes.status === 200, `status=${legacyRes.status} err=${legacyRes.data.error}`);
    const legacyRoster = await ent("Student", "filter", teacherToken, {});
    const legacyListed = Array.isArray(legacyRoster.data) && legacyRoster.data.some((s) => s.id === legacy.data.id);
    check("E14b: class_name-only student appears in the teacher student list", legacyRoster.status === 200 && legacyListed, `status=${legacyRoster.status}`);
    const legacyFar = await makeStudent(adminAToken, tenantAId, { full_name: "Legacy Class 12", roll_number: "LG2", class_name: "Class 12" });
    await DB.collection("Student").updateOne({ _id: new ObjectId(legacyFar.data.id) }, { $unset: { school_class_id: "", section_id: "" } });
    const legacyFarRes = await ent("Student", "GET", teacherToken, null, `/${legacyFar.data.id}`);
    check("E14c: class_name fallback does NOT leak an unassigned class", legacyFarRes.status === 404, `status=${legacyFarRes.status}`);

    // A class_name matching no SchoolClass must warn instead of failing quietly.
    const orphan = await makeStudent(adminAToken, tenantAId, { full_name: "Orphan Class Student", roll_number: "OR1", class_name: "Class 99" });
    const orphanWarned = Array.isArray(orphan.data?._syncWarnings) && orphan.data._syncWarnings.some((w) => /does not exist in this school/i.test(w));
    check("E14d: unresolvable class_name returns a _syncWarning", orphan.status === 201 && orphanWarned, `status=${orphan.status} warnings=${JSON.stringify(orphan.data?._syncWarnings)}`);
    const orphanStored = await DB.collection("Student").findOne({ _id: new ObjectId(orphan.data.id) });
    check("E14e: _syncWarnings is not persisted onto the Student document", orphanStored?._syncWarnings === undefined, `stored=${JSON.stringify(orphanStored?._syncWarnings)}`);

    // ---- Exam roster: placement fallback + teacher read scope -------------
    // Tenants populated by bulk import have Student rows with school_class_id
    // but no Enrollment documents, so the enrollment-derived roster came back
    // empty for everyone and OMR print/upload showed "no students". Derivation
    // now falls back to current placement per class.
    const examRosterAdmin = await api("/functions/getExamRoster", { method: "POST", token: adminAToken, body: { examination_id: examAId } });
    const adminRosterRows = Array.isArray(examRosterAdmin.data?.students) ? examRosterAdmin.data.students : [];
    check("E18a: exam roster is non-empty with no Enrollment rows (placement fallback)", examRosterAdmin.status === 200 && adminRosterRows.length > 0, `status=${examRosterAdmin.status} rows=${adminRosterRows.length}`);
    check("E18b: fallback roster members are tagged source=placement", adminRosterRows.every((r) => r.source === "placement"), `sources=${JSON.stringify([...new Set(adminRosterRows.map((r) => r.source))])}`);
    check("E18c: roster contains the Class 10 student despite zero Enrollment", adminRosterRows.some((r) => String(r.student_id) === String(studentA1Id)), `has=${adminRosterRows.some((r) => String(r.student_id) === String(studentA1Id))}`);

    const persistedRoster = await DB.collection("ExamRoster").find({ tenant_id: tenantAId, examination_id: String(examAId) }).toArray();
    check("E18d: ExamRoster rows are persisted with source=placement", persistedRoster.length > 0 && persistedRoster.every((r) => r.source === "placement"), `rows=${persistedRoster.length} sources=${JSON.stringify([...new Set(persistedRoster.map((r) => r.source))])}`);

    // A real Enrollment must take precedence and promote the stored row.
    const enrollYear = await DB.collection("AcademicYear").findOne({ tenant_id: tenantAId, is_current: true });
    await DB.collection("Enrollment").insertOne({
      tenant_id: tenantAId,
      academic_year_id: String(enrollYear._id),
      student_id: String(studentA1Id),
      school_class_id: String(classA.data.id),
      section_id: null,
      status: "active",
      created_date: new Date().toISOString(),
    });
    const afterEnroll = await api("/functions/getExamRoster", { method: "POST", token: adminAToken, body: { examination_id: examAId } });
    const promoted = (afterEnroll.data?.students || []).find((r) => String(r.student_id) === String(studentA1Id));
    check("E18e: a real Enrollment promotes placement -> enrollment", afterEnroll.status === 200 && promoted?.source === "enrollment", `source=${promoted?.source}`);

    // Teacher read scope: assigned class allowed, other class / other tenant denied.
    const tRoster = await api("/functions/getExamRoster", { method: "POST", token: teacherToken, body: { examination_id: examAId } });
    check("E19a: teacher CAN read the exam roster for an assigned class", tRoster.status === 200, `status=${tRoster.status} err=${tRoster.data?.error}`);
    const examFar = await ent("Examination", "POST", adminAToken, { tenant_id: tenantAId, name: "RBAC Class12 Exam", subject_name: "Math", class_name: "Class 12", status: "draft" });
    const tRosterFar = await api("/functions/getExamRoster", { method: "POST", token: teacherToken, body: { examination_id: examFar.data.id } });
    check("E19b: teacher CANNOT read the roster for an unassigned class", tRosterFar.status === 403, `status=${tRosterFar.status}`);
    const bExam = await ent("Examination", "POST", adminBToken, { tenant_id: tenantBId, name: "Tenant B Exam", subject_name: "Math", class_name: "Class 11", status: "draft" });
    const tRosterCross = await api("/functions/getExamRoster", { method: "POST", token: teacherToken, body: { examination_id: bExam.data.id } });
    // 404 (not 403) is deliberate: tenant ownership is asserted before the role
    // check so a cross-tenant probe cannot confirm the exam exists.
    check("E19c: teacher CANNOT read another tenant's exam roster", tRosterCross.status === 404 || tRosterCross.status === 403, `status=${tRosterCross.status}`);
    // Reading a roster must not grant the grading pipeline.
    const tUpload = await ent("OMRSheet", "POST", teacherToken, { tenant_id: tenantAId, examination_id: examAId, status: "pending" });
    check("E19d: teacher CANNOT create OMRSheet (read-only OMR)", tUpload.status === 403, `status=${tUpload.status}`);
    const tPreview = await api("/functions/previewExamRoster", { method: "POST", token: teacherToken, body: { academic_year_id: String(enrollYear._id), school_class_ids: [classA.data.id] } });
    check("E19e: teacher CAN still preview their own class roster", tPreview.status === 200, `status=${tPreview.status}`);

    // Results: only reviewed/published are visible to a teacher.
    const rDraft = await ent("Result", "POST", adminAToken, { tenant_id: tenantAId, examination_id: examKeyDraftId, student_id: studentA1Id, score: 10, status: "draft" });
    check("E15a: fixture creates a draft Result", rDraft.status === 201, `draft=${rDraft.status} err=${rDraft.data.error}`);
    // examA already has a Result for this student from roster sync, and
    // ux_result_tenant_exam_student forbids a second one, so sign it off.
    const existing = await ent("Result", "filter", adminAToken, { query: { examination_id: examAId, student_id: studentA1Id } });
    const existingId = existing.data?.[0]?.id;
    const rReviewed = existingId
      ? await ent("Result", "PATCH", adminAToken, { status: "reviewed" }, `/${existingId}`)
      : { status: 0 };
    check("E15: fixture signs off a reviewed Result", rReviewed.status === 200, `reviewed=${rReviewed.status} err=${rReviewed.data?.error}`);
    const draftById = await ent("Result", "GET", teacherToken, null, `/${rDraft.data.id}`);
    check("E16: teacher CANNOT read a draft Result by id", draftById.status === 404, `${draftById.status}`);
    const resList = await ent("Result", "filter", teacherToken, {});
    const resRows = Array.isArray(resList.data) ? resList.data : [];
    const noDraft = resRows.every((r) => r.status !== "draft");
    const sawReviewed = resRows.some((r) => r.status === "reviewed");
    check("E17: teacher Result list hides drafts but shows reviewed", resList.status === 200 && noDraft && sawReviewed, `status=${resList.status} rows=${resRows.length}`);
  }

  // -------------------------------------------------------------------------
  // F — student (tenant A)
  {
    const ownTenant = await ent("Tenant", "GET", studentToken, null, `/${tenantAId}`);
    check("F1: student reads OWN Tenant", ownTenant.status === 200, `status=${ownTenant.status}`);
    const otherTenant = await ent("Tenant", "GET", studentToken, null, `/${tenantBId}`);
    check("F2: student CANNOT read other-tenant Tenant", otherTenant.status === 404, `status=${otherTenant.status}`);
    const flt = await ent("Examination", "filter", studentToken, { query: { tenant_id: tenantAId } });
    const rows = Array.isArray(flt.data) ? flt.data : [];
    const allOwn = rows.every((e) => e.tenant_id === tenantAId);
    check("F3: student reads own-tenant Examinations", flt.status === 200 && rows.length > 0 && allOwn, `status=${flt.status} rows=${rows.length}`);
    const gmt = await api("/functions/getMyTenant", { method: "POST", token: studentToken, body: {} });
    check("F4: student getMyTenant works (portal regression)", gmt.status === 200, `status=${gmt.status}`);

    const creates = [
      ["Examination", { tenant_id: tenantAId, name: "X", subject_name: "M", class_name: "C" }],
      ["AnswerKey", { tenant_id: tenantAId, examination_id: examAId, content: "{}" }],
      ["OMRSheet", { tenant_id: tenantAId, examination_id: examAId }],
      ["Result", { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id }],
      ["Teacher", { tenant_id: tenantAId, full_name: "X", email: em("x"), status: "active" }],
      ["User", { email: em("x"), app_role: "teacher" }],
      ["Tenant", { name: "X" }],
      ["AuditLog", { action: "forge", entity_type: "X" }],
    ];
    let allDenied = true;
    for (const [name, body] of creates) {
      const r = await ent(name, "POST", studentToken, body);
      if (r.status !== 403) allDenied = false;
    }
    check("F5: student CANNOT create Examination/AnswerKey/OMRSheet/Result/Teacher/User/Tenant/AuditLog", allDenied, "");

    const sPatch = await ent("Student", "PATCH", studentToken, { full_name: "Hacked" }, `/${studentA1Id}`);
    const sDel = await ent("Student", "DELETE", studentToken, null, `/${studentA1Id}`);
    check("F6: student CANNOT update/delete Student", sPatch.status === 403 && sDel.status === 403, `patch=${sPatch.status} delete=${sDel.status}`);
    const tPatch = await ent("Teacher", "PATCH", studentToken, { full_name: "Hacked" }, `/${teacherEmail}`);
    check("F7: student CANNOT update Teacher", tPatch.status === 403, `${tPatch.status}`);
    const ePatch = await ent("Examination", "PATCH", studentToken, { name: "Hacked" }, `/${examAId}`);
    check("F8: student CANNOT update Examination", ePatch.status === 403, `${ePatch.status}`);
    const tUpd = await ent("Tenant", "PATCH", studentToken, { name: "Hacked" }, `/${tenantAId}`);
    const tDel = await ent("Tenant", "DELETE", studentToken, null, `/${tenantAId}`);
    check("F9: student CANNOT update/delete own Tenant", tUpd.status === 403 && tDel.status === 403, `patch=${tUpd.status} delete=${tDel.status}`);

    const al = await ent("AuditLog", "GET", studentToken);
    const alFlt = await ent("AuditLog", "filter", studentToken, { query: {} });
    check("F10: student CANNOT read AuditLog", al.status === 403 && alFlt.status === 403, `list=${al.status} filter=${alFlt.status}`);

    const ms = await api("/functions/manageStaff", { method: "POST", token: studentToken, body: { action: "list" } });
    const msSet = await api("/functions/manageStaff", { method: "POST", token: studentToken, body: { action: "setRole", user_id: "000000000000", app_role: "school_admin" } });
    check("F11: student CANNOT manage staff (no self-promotion)", ms.status === 403 && msSet.status === 403, `list=${ms.status} setRole=${msSet.status}`);
    const inv = await invite(studentToken, em("invite"), "teacher");
    check("F12: student CANNOT invite users", inv.status === 403, `${inv.status}`);
    const t3 = await api("/functions/startFreeTrial", { method: "POST", token: studentToken, body: {} });
    check("F13: student CANNOT startFreeTrial (has tenant)", t3.status === 403, `${t3.status}`);
    const omr = await api("/functions/processOMRSheet", { method: "POST", token: studentToken, body: {} });
    const ev = await api("/functions/evaluateExamination", { method: "POST", token: studentToken, body: {} });
    const vcd = await api("/functions/verifyCustomDomain", { method: "POST", token: studentToken, body: {} });
    check("F14: student blocked from OMR/evaluate/verifyCustomDomain", omr.status === 403 && ev.status === 403 && vcd.status === 403, `omr=${omr.status} ev=${ev.status} vcd=${vcd.status}`);
    const burnerEmail = em("burner");
    await invite(adminAToken, burnerEmail, "student");
    const burnerToken = await makeAccessible(burnerEmail);
    // deleteMyAccount now requires the caller to re-authenticate, and the route
    // refuses a wrong password before it refuses to delete anything. The burner
    // is invited without a password it can be assumed to know, so assert the
    // confirmation requirement rather than a successful deletion.
    const delNoPwd = await api("/functions/deleteMyAccount", { method: "POST", token: burnerToken, body: {} });
    const delWrongPwd = await api("/functions/deleteMyAccount", { method: "POST", token: burnerToken, body: { password: "not-the-password" } });
    const burnerSurvives = await findUserByEmail(burnerEmail);
    check(
      "F15: deleteMyAccount requires password confirmation and deletes nothing without it",
      delNoPwd.status === 400 && delWrongPwd.status === 401 && Boolean(burnerSurvives),
      `nopwd=${delNoPwd.status} wrongpwd=${delWrongPwd.status} stillPresent=${Boolean(burnerSurvives)}`
    );
    // A platform operator is excluded from self-service deletion regardless of
    // the password, so the check must not depend on a password we do not have.
    const emDel = await api("/functions/deleteMyAccount", { method: "POST", token: superToken, body: { password: "irrelevant" } });
    check("F16: super_admin CANNOT delete its own account (platform excluded)", emDel.status === 403, `${emDel.status}`);
  }

  // -------------------------------------------------------------------------
  // G — parent (tenant A)
  {
    const ownTenant = await ent("Tenant", "GET", parentToken, null, `/${tenantAId}`);
    check("G1: parent reads OWN Tenant", ownTenant.status === 200, `status=${ownTenant.status}`);
    const e1 = await ent("Examination", "POST", parentToken, { tenant_id: tenantAId, name: "H", subject_name: "M" });
    const r1 = await ent("Result", "POST", parentToken, { tenant_id: tenantAId, examination_id: examAId });
    check("G2: parent CANNOT create Examination/Result", e1.status === 403 && r1.status === 403, `exam=${e1.status} result=${r1.status}`);
    const sPatch = await ent("Student", "PATCH", parentToken, { full_name: "Hacked" }, `/${studentA1Id}`);
    check("G3: parent CANNOT update Student", sPatch.status === 403, `${sPatch.status}`);
    const al = await ent("AuditLog", "GET", parentToken);
    check("G4: parent CANNOT read AuditLog", al.status === 403, `${al.status}`);
    const ms = await api("/functions/manageStaff", { method: "POST", token: parentToken, body: { action: "list" } });
    const t3 = await api("/functions/startFreeTrial", { method: "POST", token: parentToken, body: {} });
    check("G5: parent CANNOT manage staff or startFreeTrial", ms.status === 403 && t3.status === 403, `staff=${ms.status} trial=${t3.status}`);
  }

  // -------------------------------------------------------------------------
  // H — cross-tenant isolation (tenants A vs B)
  {
    const flt = await ent("Student", "filter", adminBToken, { query: { tenant_id: tenantAId } });
    const leaked = (flt.data || []).filter((s) => s.tenant_id === tenantAId);
    check("H1: tenant-B admin CANNOT read tenant-A students", leaked.length === 0, `status=${flt.status} leaked=${leaked.length}`);
    const g1 = await ent("Student", "GET", adminBToken, null, `/${studentA1Id}`);
    check("H2: tenant-B admin CANNOT read tenant-A student by id", g1.status === 404, `status=${g1.status}`);
    const p1 = await ent("Student", "PATCH", adminBToken, { full_name: "Hacked" }, `/${studentA1Id}`);
    const p1After = await ent("Student", "GET", adminAToken, null, `/${studentA1Id}`);
    const p1Denied = p1.status === 403 || p1.status === 404 || (p1.status === 200 && p1After.data?.full_name === "RBAC Student");
    check("H3: tenant-B admin CANNOT update tenant-A student", p1Denied && p1After.status === 200, `patch=${p1.status} still=${p1After.status}`);
    const d1 = await ent("Student", "DELETE", adminBToken, null, `/${studentA1Id}`);
    const d1After = await ent("Student", "GET", adminAToken, null, `/${studentA1Id}`);
    const d1Noop = d1.status === 403 || d1.status === 404 || d1.data?.deletedCount === 0;
    check("H4: tenant-B admin CANNOT delete tenant-A student", d1Noop && d1After.status === 200, `del=${d1.status} cnt=${d1.data?.deletedCount} still=${d1After.status}`);
    const c1 = await makeStudent(adminBToken, tenantAId);
    check("H5: tenant-B admin CANNOT create student claiming tenant A", c1.status === 403, `${c1.status}`);
    const tUpd = await ent("Tenant", "PATCH", adminBToken, { name: "Hacked" }, `/${tenantAId}`);
    const tAfter = await ent("Tenant", "GET", adminAToken, null, `/${tenantAId}`);
    check("H6: tenant-B admin CANNOT update tenant-A Tenant", (tUpd.status === 403 || tUpd.status === 404) && tAfter.status === 200 && tAfter.data.name !== "Hacked", `patch=${tUpd.status} still=${tAfter.status}`);
    const bRead = await ent("Examination", "filter", bTeacherToken, { query: { tenant_id: tenantAId } });
    const bLeak = (bRead.data || []).filter((e) => e.tenant_id === tenantAId);
    check("H7: tenant-B teacher CANNOT read tenant-A examinations", bLeak.length === 0, `status=${bRead.status} leaked=${bLeak.length}`);
  }

  // -------------------------------------------------------------------------
  // I — sensitive function endpoints per role
  {
    const probe = async (fnName, token) => {
      const r = await api(`/functions/${fnName}`, { method: "POST", token, body: {} });
      return r.status;
    };
    const evalRoles = {
      school_admin: await probe("evaluateExamination", adminAToken),
      principal: await probe("evaluateExamination", principalToken),
      exam_coordinator: await probe("evaluateExamination", ecToken),
      teacher: await probe("evaluateExamination", teacherToken),
      student: await probe("evaluateExamination", studentToken),
    };
    check(
      "I1: evaluateExamination gated to exam workflow (super/school_admin/principal/exam_coordinator)",
      evalRoles.school_admin === 400 && evalRoles.principal === 400 && evalRoles.exam_coordinator === 400 && evalRoles.teacher === 403 && evalRoles.student === 403,
      JSON.stringify(evalRoles)
    );

    const vcdRoles = {
      school_admin: await probe("verifyCustomDomain", adminAToken),
      principal: await probe("verifyCustomDomain", principalToken),
      exam_coordinator: await probe("verifyCustomDomain", ecToken),
      teacher: await probe("verifyCustomDomain", teacherToken),
    };
    // school_admin must get past the gate; 400 (not 403) means it reached the
    // handler and was rejected on the empty domain input, which is the same
    // signal I1 uses. The 200 in an older revision of this assertion predated the
    // host normalization that now requires a domain.
    check(
      "I2: verifyCustomDomain gated to super_admin/school_admin",
      vcdRoles.school_admin !== 403 && vcdRoles.school_admin !== 401 && vcdRoles.principal === 403 && vcdRoles.exam_coordinator === 403 && vcdRoles.teacher === 403,
      JSON.stringify(vcdRoles)
    );

    const trial = { school_admin: await probe("startFreeTrial", adminAToken), student: await probe("startFreeTrial", studentToken), teacher: await probe("startFreeTrial", teacherToken) };
    check("I3: startFreeTrial blocked for any tenant-holding user", trial.school_admin === 403 && trial.student === 403 && trial.teacher === 403, JSON.stringify(trial));

    const spoofBody = (action, entity_type) => ({
      action, entity_type,
      entity_id: examAId,
      details: "spoof attempt",
      actor_name: "SPOOF", actor_role: "super_admin", tenant_id: tenantBId,
    });
    const studentForgeries = [
      ["delete", "Examination"],
      ["delete", "Result"],
      ["assign_role", "User"],
      ["process_omr", "OMRSheet"],
      ["change_role", "User"],
      ["evaluate", "Examination"],
      ["publish_results", "Examination"],
      ["rbac_spoof_test", "Examination"],
      ["create", "SchoolClass"],
    ];
    const stResults = [];
    for (const [action, entity_type] of studentForgeries) {
      const r = await api("/functions/logAudit", { method: "POST", token: studentToken, body: spoofBody(action, entity_type) });
      stResults.push(r.status);
    }
    const forgedLeaked = await DB.collection("AuditLog").countDocuments({ details: "spoof attempt", actor_name: "SPOOF" });
    check(
      "I4: student CANNOT write ANY audit event (allowlist + role gate)",
      stResults.every((s) => s !== 200) && forgedLeaked === 0,
      `statuses=${stResults.join(",")} leaked=${forgedLeaked}`
    );

    const staffAllowed = await api("/functions/logAudit", {
      method: "POST", token: adminAToken,
      body: { action: "create", entity_type: "SchoolClass", entity_id: examAId, details: "spoof attempt", actor_name: "SPOOF", actor_role: "super_admin", tenant_id: tenantBId },
    });
    check("I5: school_admin can log an allowlisted echo event", staffAllowed.status === 200, `status=${staffAllowed.status}`);

    const staffForge = await api("/functions/logAudit", { method: "POST", token: adminAToken, body: spoofBody("delete", "Examination") });
    check("I6: school_admin CANNOT manufacture DELETE Examination via logAudit", staffForge.status !== 200, `status=${staffForge.status}`);

    const allowedDoc = await DB.collection("AuditLog").findOne({ action: "create", entity_type: "SchoolClass", details: "spoof attempt" });
    const adminAUser = await DB.collection("User").findOne({ tenant_id: tenantAId, app_role: "school_admin" });
    check(
      "I7: logAudit derives actor/tenant server-side, ignores client spoof",
      allowedDoc && allowedDoc.actor_role === "school_admin" && allowedDoc.actor_name !== "SPOOF" && allowedDoc.actor_name === adminAUser?.full_name && allowedDoc.tenant_id === tenantAId && allowedDoc.entity_id === examAId,
      `role=${allowedDoc?.actor_role} actor=${allowedDoc?.actor_name} tenant=${allowedDoc?.tenant_id}`
    );
  }

  // -------------------------------------------------------------------------
  // J — AuditLog integrity + credential hygiene
  {
    const c1 = await ent("AuditLog", "POST", superToken, { action: "forge", entity_type: "X" });
    const u1 = await ent("AuditLog", "PATCH", superToken, { action: "forge2" }, `/${c1.data?.id || "000000000000000000000000"}`);
    const d1 = await ent("AuditLog", "DELETE", superToken, null, `/${c1.data?.id || "000000000000000000000000"}`);
    check("J1: AuditLog generic write forbidden EVEN for super_admin", c1.status === 403 && u1.status === 403 && d1.status === 403, `create=${c1.status} update=${u1.status} delete=${d1.status}`);

    const alRead = await ent("AuditLog", "filter", adminAToken, { query: {} });
    const hasSpoof = (alRead.data || []).some((r) => r.action === "create" && r.entity_type === "SchoolClass" && r.tenant_id === tenantAId);
    check("J2: school_admin can read AuditLog incl server-written events", alRead.status === 200 && hasSpoof, `status=${alRead.status} rows=${alRead.data?.length} hasSpoof=${hasSpoof}`);

    const me = await api("/auth/me", { token: studentToken });
    check("J3: /auth/me never leaks password_hash", me.status === 200 && !("password_hash" in me.data), `fields=${Object.keys(me.data).join(",")}`);
  }

  // -------------------------------------------------------------------------
  // K — SEC-02: audit integrity, server-authoritative events, employee RBAC
  {
    const alCreate = await ent("AuditLog", "POST", adminAToken, { action: "forge", entity_type: "X" });
    const alPatch = await ent("AuditLog", "PATCH", adminAToken, { action: "forge2" }, "/000000000000000000000000");
    const alDelete = await ent("AuditLog", "DELETE", adminAToken, null, "/000000000000000000000000");
    check("K1: generic AuditLog write forbidden for school_admin", alCreate.status === 403 && alPatch.status === 403 && alDelete.status === 403, `create=${alCreate.status} update=${alPatch.status} delete=${alDelete.status}`);

    const auditStudent = await makeStudent(adminAToken, tenantAId, { full_name: "Audit Target", roll_number: "AU1" });
    check("K2: school_admin creates Student (server audit target)", auditStudent.status === 201, `${auditStudent.status}`);
    const auditStudentId = auditStudent.data.id;
    const createRow = await DB.collection("AuditLog").findOne({ action: "create", entity_type: "Student", entity_id: auditStudentId });
    check("K3: successful create writes server-audit row with server-derived actor/tenant", Boolean(createRow) && createRow.tenant_id === tenantAId && createRow.actor_role === "school_admin", `role=${createRow?.actor_role} tenant=${createRow?.tenant_id}`);

    const delStatus = await ent("Student", "DELETE", adminAToken, null, `/${auditStudentId}`);
    const delRow = await DB.collection("AuditLog").findOne({ action: "delete", entity_type: "Student", entity_id: auditStudentId });
    check("K4: successful delete writes server-audit row", delStatus.status === 200 && Boolean(delRow), `del=${delStatus.status} row=${Boolean(delRow)}`);

    const failedCreate = await makeStudent(studentToken, tenantAId);
    const failRow = await DB.collection("AuditLog").findOne({ action: "create", entity_type: "Student", entity_id: failedCreate.data?.id || "nonexfailed" });
    check("K5: failed mutation creates NO audit event", failedCreate.status === 403 && !failRow, `status=${failedCreate.status} fakeRow=${Boolean(failRow)}`);

    const roleTargetEmail = em("audrole");
    await makeUser(adminAToken, roleTargetEmail, "teacher");
    const roleTarget = await findUserByEmail(roleTargetEmail);
    const setRole = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "setRole", user_id: roleTarget._id.toString(), app_role: "principal" } });
    const roleRow = await DB.collection("AuditLog").findOne({ action: "assign_role", entity_type: "User", entity_id: roleTarget._id.toString() });
    check("K6: manageStaff setRole writes assign_role server-audit row", setRole.status === 200 && Boolean(roleRow) && roleRow.tenant_id === tenantAId, `set=${setRole.status} row=${Boolean(roleRow)}`);

    const omrSheet = await ent("OMRSheet", "POST", ecToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id, status: "pending" });
    const omrSheetId = omrSheet.data?.id;
    const processed = await api("/functions/processOMRSheet", { method: "POST", token: adminAToken, body: { omr_sheet_id: omrSheetId } });
    const omrRow = omrSheetId ? await DB.collection("AuditLog").findOne({ action: "process_omr", entity_type: "OMRSheet", entity_id: omrSheetId }) : null;
    check("K7: processOMRSheet writes process_omr server-audit row", processed.status === 200 && Boolean(omrRow), `proc=${processed.status} row=${Boolean(omrRow)}`);

    if (omrSheetId) {
      await DB.collection("OMRSheet").updateOne(
        { _id: new ObjectId(omrSheetId) },
        { $set: { status: "completed", processing_status: "completed", extracted_answers: { "1": "A" } } }
      );
    }
    const evaluated = await api("/functions/evaluateExamination", { method: "POST", token: adminAToken, body: { examination_id: examAId } });
    const evalRow = await DB.collection("AuditLog").findOne({ action: "evaluate", entity_type: "Examination", entity_id: examAId });
    check("K8: evaluateExamination writes evaluate server-audit row", evaluated.status === 200 && Boolean(evalRow), `eval=${evaluated.status} row=${Boolean(evalRow)}`);

    await makeStudent(adminBToken, tenantBId, { full_name: "B Audit" });
    const aView = await ent("AuditLog", "filter", adminAToken, { query: {} });
    const aSeesB = (aView.data || []).some((r) => r.tenant_id === tenantBId);
    check("K9: school_admin A CANNOT see tenant-B audit rows", aView.status === 200 && !aSeesB, `status=${aView.status} leaked=${aSeesB}`);
    const bView = await ent("AuditLog", "filter", adminBToken, { query: {} });
    const bSawOwn = (bView.data || []).some((r) => r.tenant_id === tenantBId && r.action === "create" && r.entity_type === "Student");
    check("K10: school_admin B CAN read own-tenant audit rows", bView.status === 200 && bSawOwn, `status=${bView.status} sawOwn=${bSawOwn}`);

    const empEmail = em("employee");
    const empUser = await seedUser(empEmail, "employee", tenantAId);
    check("K11: employee account initialized for RBAC testing", Boolean(empUser), `exists=${Boolean(empUser)}`);
    const empToken = await makeAccessible(empEmail);
    const empWrite = await ent("Examination", "POST", empToken, { tenant_id: tenantAId, name: "Emp Forge", subject_name: "M" });
    const empUserWrite = await ent("User", "POST", empToken, { email: em("empforge") });
    const empAuditWrite = await ent("AuditLog", "POST", empToken, { action: "forge", entity_type: "X" });
    check("K12: employee CANNOT write entities/users/audit (not super_admin)", empWrite.status === 403 && empUserWrite.status === 403 && empAuditWrite.status === 403, `exam=${empWrite.status} user=${empUserWrite.status} audit=${empAuditWrite.status}`);
    const empSetRole = await api("/functions/manageStaff", { method: "POST", token: empToken, body: { action: "setRole", user_id: (await findUserByEmail(teacherEmail))._id.toString(), app_role: "super_admin" } });
    check("K13: employee CANNOT assign platform roles", empSetRole.status === 403, `${empSetRole.status}`);
    const empRead = await ent("Examination", "GET", empToken, null, `/${examAId}`);
    check("K14: employee CAN read across tenants (platform read)", empRead.status === 200, `${empRead.status}`);
    const empAuditRead = await ent("AuditLog", "filter", empToken, { query: {} });
    check("K15: employee CAN read AuditLog (platform)", empAuditRead.status === 200, `${empAuditRead.status}`);
    const empLogForge = await api("/functions/logAudit", { method: "POST", token: empToken, body: { action: "delete", entity_type: "Examination", entity_id: examAId, details: "spoof" } });
    check("K16: employee CANNOT write forged sensitive audit events via logAudit", empLogForge.status !== 200, `${empLogForge.status}`);
  }

  // -------------------------------------------------------------------------
  // R — regression: public reads, unauthenticated guard, staff read access
  {
    const anonExam = await ent("Examination", "GET", null);
    check("R1: Examination requires authentication (not publicRead)", anonExam.status === 401, `${anonExam.status}`);
    const anonAnn = await ent("TenantAnnouncement", "GET", null);
    check("R2: anonymous TenantAnnouncement GET rejected (SEC-06, not publicRead)", anonAnn.status === 401, `${anonAnn.status}`);
    const anonAnnF = await ent("TenantAnnouncement", "filter", null, { query: {} });
    check("R2a: anonymous TenantAnnouncement filter rejected (SEC-06)", anonAnnF.status === 401, `${anonAnnF.status}`);
    const annCreate = await ent("TenantAnnouncement", "POST", adminAToken, { tenant_id: tenantAId, title: "SEC06 leak probe", message: "tenant A only", type: "info" });
    check("R2b: school_admin A creates own-tenant announcement (write preserved)", annCreate.status === 201, `${annCreate.status}`);
    const annId = annCreate.data.id;
    const aOwn = await ent("TenantAnnouncement", "GET", adminAToken, null, `/${annId}`);
    check("R2c: school_admin A reads own-tenant announcement", aOwn.status === 200 && aOwn.data?.tenant_id === tenantAId, `${aOwn.status}`);
    const bView = await ent("TenantAnnouncement", "GET", adminBToken);
    const leaked = (bView.data || []).some((r) => r.tenant_id === tenantAId);
    check("R2d: school_admin B CANNOT see tenant-A announcements", bView.status === 200 && !leaked, `status=${bView.status} leaked=${leaked}`);
    const bFilter = await ent("TenantAnnouncement", "filter", adminBToken, { query: {} });
    const leakedF = (bFilter.data || []).some((r) => r.tenant_id === tenantAId);
    check("R2e: cross-tenant filter read stays scoped to own tenant", bFilter.status === 200 && !leakedF, `status=${bFilter.status} leaked=${leakedF}`);
    for (const name of ["Announcement", "PlatformBranding", "SubscriptionPlan"]) {
      const pub = await ent(name, "GET", null);
      check(`R6: ${name} remains publicly readable`, pub.status === 200, `${pub.status}`);
    }
    const tRead = await ent("Examination", "GET", teacherToken, null, `/${examAId}`);
    check("R3: teacher reads own-tenant data", tRead.status === 200, `${tRead.status}`);
    const pRead = await ent("Student", "GET", principalToken, null, `/${studentA1Id}`);
    check("R4: principal reads own-tenant Student (oversight)", pRead.status === 200, `${pRead.status}`);
    const pFlt = await ent("Result", "filter", principalToken, { query: { examination_id: examAId } });
    check("R5: principal reads results for exam review", pFlt.status === 200, `${pFlt.status}`);
  }

  // --- Billing: the self-upgrade hole, and the request path that replaces it -------
  //
  // The finding these assertions exist for: ENTITY_WRITE_ROLES.Tenant.update admits
  // school_admin for everything else they legitimately edit, and no guard covered
  // subscription_plan_id, so one PATCH granted any institution the top plan and its
  // quotas for nothing. The guard is asserted on ALL THREE Tenant write routes,
  // because /bulk carried arbitrary per-item field maps and had no guard at all.
  {
    const plansRes = await ent("SubscriptionPlan", "GET", adminAToken);
    const catalogue = plansRes.data || [];
    const topPlan = [...catalogue].sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0))[0];
    check("BIL1: the plan catalogue is readable so an upgrade target exists", plansRes.status === 200 && Boolean(topPlan?.id), `status=${plansRes.status} plans=${catalogue.length}`);

    // A fresh plan the institution cannot already be on, so every refusal below is
    // about the guard rather than about asking for the current plan.
    const freshPlan = await ent("SubscriptionPlan", "POST", superToken, {
      name: `Guard Probe ${Date.now()}`,
      price: 777,
      billing_cycle: "month",
      student_limit: 5,
      omr_sheet_limit: 5,
      exam_limit: 5,
    });
    const probeId = freshPlan.data?.id;
    check("BIL2: super_admin can create a probe plan", freshPlan.status === 201 && Boolean(probeId), `${freshPlan.status}`);

    const before = await ent("Tenant", "GET", adminAToken, null, `/${tenantAId}`);

    for (const field of [
      "subscription_plan_id",
      "plan_name",
      "subscription_period_start",
      "subscription_period_end",
      "student_limit",
      "omr_sheet_limit_per_month",
    ]) {
      const single = await ent("Tenant", "PATCH", adminAToken, { [field]: "2030-01-01T00:00:00.000Z" }, `/${tenantAId}`);
      check(`BIL3: school_admin CANNOT self-write Tenant.${field}`, single.status === 403, `status=${single.status} err=${single.data?.error}`);

      const many = await api(`/entities/Tenant/many`, {
        method: "PATCH",
        token: adminAToken,
        body: { query: { id: tenantAId }, update: { [field]: "2030-01-01T00:00:00.000Z" } },
      });
      check(`BIL4: school_admin CANNOT self-write Tenant.${field} via /many`, many.status === 403, `status=${many.status}`);

      // The route that had no guard at all. The field goes in item 2 so a guard that
      // only inspected the first item would still be caught.
      const bulk = await api(`/entities/Tenant/bulk`, {
        method: "PATCH",
        token: adminAToken,
        body: { items: [{ id: tenantBId, name: "Probe" }, { id: tenantAId, [field]: "2030-01-01T00:00:00.000Z" }] },
      });
      check(`BIL5: school_admin CANNOT self-write Tenant.${field} via /bulk`, bulk.status === 403, `status=${bulk.status}`);
    }

    const after = await ent("Tenant", "GET", adminAToken, null, `/${tenantAId}`);
    check(
      "BIL6: none of the six guarded fields moved",
      before.data?.subscription_plan_id === after.data?.subscription_plan_id
        && before.data?.student_limit === after.data?.student_limit
        && before.data?.omr_sheet_limit_per_month === after.data?.omr_sheet_limit_per_month
        && before.data?.plan_name === after.data?.plan_name,
      `plan ${before.data?.subscription_plan_id} -> ${after.data?.subscription_plan_id}`
    );

    // A non-billing Tenant edit must still work, or the guard has broken the console.
    const benign = await ent("Tenant", "PATCH", adminAToken, { address: "Probe Street" }, `/${tenantAId}`);
    check("BIL7: school_admin can still edit non-billing Tenant fields", benign.status === 200, `status=${benign.status}`);

    // Platform roles keep the institutions-console override, which is what
    // TenantFormDialog's plan selector depends on.
    const platformWrite = await ent("Tenant", "PATCH", superToken, { subscription_plan_id: probeId }, `/${tenantAId}`);
    check("BIL8: super_admin may still set the plan directly (console override)", platformWrite.status === 200, `status=${platformWrite.status} err=${platformWrite.data?.error}`);

    // --- the request path --------------------------------------------------
    // Put the institution back so the request below is a real change.
    await ent("Tenant", "PATCH", superToken, { subscription_plan_id: null, plan_name: null, student_limit: null, omr_sheet_limit_per_month: null }, `/${tenantAId}`);

    const submitByAdmin = await api("/functions/planUpgrade", { method: "POST", token: adminAToken, body: { action: "submit", to_plan_id: probeId } });
    check("BIL9: school_admin CAN raise a plan change request", submitByAdmin.status === 201, `status=${submitByAdmin.status} err=${submitByAdmin.data?.error}`);
    const requestId = submitByAdmin.data?.request?.id;

    const dup = await api("/functions/planUpgrade", { method: "POST", token: adminAToken, body: { action: "submit", to_plan_id: probeId } });
    check("BIL10: a second live request for the same institution is refused", dup.status === 409, `status=${dup.status} err=${dup.data?.error}`);

    // The critical one: the requester must not be able to approve itself.
    const selfApprove = await api("/functions/planUpgrade", { method: "POST", token: adminAToken, body: { action: "approve", request_id: requestId, amount: 777, payment_method: "UPI" } });
    check("BIL11: school_admin CANNOT approve its own plan change", selfApprove.status === 403, `status=${selfApprove.status} err=${selfApprove.data?.error}`);

    for (const [label, token] of [
      ["principal", principalToken],
      ["teacher", teacherToken],
      ["student", studentToken],
      ["parent", parentToken],
    ]) {
      const refused = await api("/functions/planUpgrade", { method: "POST", token, body: { action: "submit", to_plan_id: probeId } });
      check(`BIL12: ${label} CANNOT raise a plan change request`, refused.status === 403, `status=${refused.status}`);
    }

    // A dedicated employee: section K's token is block-scoped there, and this section
    // needs an approver that is NOT super_admin, since the platform owner's approval
    // would pass on the bypass rather than on the role set.
    const bilEmpEmail = em("bilemployee");
    await seedUser(bilEmpEmail, "employee", tenantAId);
    const bilEmpToken = await makeAccessible(bilEmpEmail);

    // employee is a platform role and may adjudicate. It must NOT be able to raise a
    // request: approving and asking are separate capabilities.
    const empSubmit = await api("/functions/planUpgrade", { method: "POST", token: bilEmpToken, body: { action: "submit", to_plan_id: probeId } });
    check("BIL12b: employee CANNOT raise a plan change request (approve-only)", empSubmit.status === 403, `status=${empSubmit.status}`);

    const empApprove = await api("/functions/planUpgrade", { method: "POST", token: bilEmpToken, body: { action: "approve", request_id: requestId, amount: 777, payment_method: "UPI" } });
    check("BIL13: employee CAN approve a plan change", empApprove.status === 200, `status=${empApprove.status} err=${empApprove.data?.error}`);

    const applied = await ent("Tenant", "GET", adminAToken, null, `/${tenantAId}`);
    check(
      "BIL14: approval applied the plan AND snapshotted the quotas that were never written before",
      applied.data?.subscription_plan_id === probeId
        && applied.data?.student_limit === 5
        && applied.data?.omr_sheet_limit_per_month === 5,
      `plan=${applied.data?.subscription_plan_id} student_limit=${applied.data?.student_limit} omr=${applied.data?.omr_sheet_limit_per_month}`
    );
    check(
      "BIL15: approval recorded the billing period on the tenant",
      Boolean(applied.data?.subscription_period_start) && Boolean(applied.data?.subscription_period_end)
        && new Date(applied.data.subscription_period_end) > new Date(applied.data.subscription_period_start),
      `${applied.data?.subscription_period_start} -> ${applied.data?.subscription_period_end}`
    );

    const payments = await ent("Payment", "filter", superToken, { query: { tenant_id: tenantAId } });
    const mine = (payments.data || []).filter((p) => p.request_id === requestId);
    check("BIL16: approval wrote exactly one Payment, linked to the request", mine.length === 1 && mine[0].amount === 777, `payments=${mine.length} amount=${mine[0]?.amount}`);

    // The request is spent; a second approval must not book a second payment.
    const reApprove = await api("/functions/planUpgrade", { method: "POST", token: bilEmpToken, body: { action: "approve", request_id: requestId, amount: 777, payment_method: "UPI" } });
    const after2 = await ent("Payment", "filter", superToken, { query: { tenant_id: tenantAId } });
    check(
      "BIL17: an already-decided request cannot be approved twice",
      reApprove.status === 409 && (after2.data || []).filter((p) => p.request_id === requestId).length === 1,
      `status=${reApprove.status} payments=${(after2.data || []).filter((p) => p.request_id === requestId).length}`
    );

    const rejectNoNote = await api("/functions/planUpgrade", { method: "POST", token: bilEmpToken, body: { action: "reject", request_id: requestId } });
    check("BIL18: rejection requires a reason", rejectNoNote.status === 400 || rejectNoNote.status === 409, `status=${rejectNoNote.status}`);

    // Requests are readable by the platform, scoped to the own tenant for a school.
    const ownQueue = await ent("PlanChangeRequest", "filter", adminAToken, { query: {} });
    const foreignLeak = (ownQueue.data || []).some((r) => r.tenant_id !== tenantAId);
    check("BIL19: school_admin reads only its own requests", ownQueue.status === 200 && !foreignLeak, `status=${ownQueue.status} leaked=${foreignLeak}`);
    const platformQueue = await ent("PlanChangeRequest", "GET", bilEmpToken);
    check("BIL20: employee reads the platform-wide queue", platformQueue.status === 200, `${platformQueue.status}`);

    // Cancel is the institution's own action, bounded to its own request.
    const cancelByOther = await api("/functions/planUpgrade", { method: "POST", token: adminBToken, body: { action: "cancel", request_id: requestId } });
    check("BIL21: another institution cannot withdraw this request", cancelByOther.status === 404 || cancelByOther.status === 409, `status=${cancelByOther.status}`);
  }

  // --- Multi-role: the model itself, end to end ------------------------------
  {
    // The canonical case: one person who teaches and also runs the exams.
    const bothEmail = em("teacherexam");
    await seedRoleSet(bothEmail, ["teacher", "exam_coordinator"], tenantAId);
    const bothToken = await makeAccessible(bothEmail);
    const me = await api("/auth/me", { token: bothToken });
    const held = Array.isArray(me.data?.app_roles) ? me.data.app_roles : [];
    const mirrored = me.data?.app_role === "exam_coordinator";
    check(
      "M1: /auth/me returns the canonical app_roles and a matching primary mirror",
      me.status === 200 && held.includes("teacher") && held.includes("exam_coordinator") && mirrored,
      `status=${me.status} app_roles=${JSON.stringify(held)} app_role=${me.data?.app_role}`
    );

    // CAPABILITY is the union. Attendance is teacher-authorized and OMRSheet is
    // exam-coordinator-only, so this pair must clear both -- and the teacher alone
    // must fail the second. If a check ever regressed to the primary role, the
    // first assertion would still pass and only this one would catch it.
    const att = await ent("Attendance", "POST", bothToken, { tenant_id: tenantAId, class_name: "Class 10", section: "A", date: new Date().toISOString().slice(0, 10), records: [] });
    const omr = await ent("OMRSheet", "POST", bothToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id, status: "pending" });
    const omrAlone = await ent("OMRSheet", "POST", teacherToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id, status: "pending" });
    check(
      "M2: capability is the union of held roles (teacher+exam coordinator)",
      att.status !== 403 && omr.status !== 403 && omrAlone.status === 403,
      `attendance=${att.status} omr=${omr.status} teacher-alone-omr=${omrAlone.status}`
    );

    // SCOPE follows the PRIMARY role. readScope narrows a Teacher read to the
    // account's OWN Teacher record, and that narrowing is gated on the primary
    // role being teacher. exam_coordinator outranks teacher, so this account is a
    // coordinator first and must NOT be held to the ceiling of the teaching job it
    // also does.
    //
    // manageStaff is deliberately NOT the probe here: that screen is school-admin
    // only, so it answers 403 for every staff role and would prove nothing about
    // scope. A second Teacher in the same tenant separates the two cases.
    const otherTeacher = await ent("Teacher", "POST", adminAToken, {
      tenant_id: tenantAId, full_name: "RBAC Other Teacher", email: em("otherteacher"), subject: "Physics", status: "active",
    });
    const otherTeacherId = otherTeacher.data?.id;
    const asPureTeacher = await ent("Teacher", "GET", teacherToken, null, `/${otherTeacherId}`);
    const asTeacherExam = await ent("Teacher", "GET", bothToken, null, `/${otherTeacherId}`);
    check(
      "M3: read scope follows the PRIMARY role, so a teacher+exam coordinator is not narrowed like a teacher",
      asPureTeacher.status === 404 && asTeacherExam.status === 200,
      `teacher-alone=${asPureTeacher.status} teacher+exam-coordinator=${asTeacherExam.status}`
    );

    // A legacy document with NO app_roles must authorize exactly as it did before
    // the field existed. This is the property that makes the deploy order safe.
    const legacyEmail = em("legacy");
    await seedLegacyUser(legacyEmail, "exam_coordinator", tenantAId);
    const legacyToken = await makeAccessible(legacyEmail);
    const legacyOmr = await ent("OMRSheet", "POST", legacyToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id, status: "pending" });
    const legacyMe = await api("/auth/me", { token: legacyToken });
    check(
      "M4: a pre-migration account (no app_roles) still authorizes by its app_role",
      legacyOmr.status !== 403 && legacyMe.data?.app_role === "exam_coordinator",
      `omr=${legacyOmr.status} app_role=${legacyMe.data?.app_role}`
    );

    // A DISAGREEING but valid mirror must lose to the canonical array, or the two
    // fields could be read as two independent inputs and mean two things.
    const driftEmail = em("drift");
    await seedRoleSet(driftEmail, ["teacher", "exam_coordinator"], tenantAId, { mirror: "teacher" });
    const driftToken = await makeAccessible(driftEmail);
    const driftOmr = await ent("OMRSheet", "POST", driftToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id, status: "pending" });
    check(
      "M5: a stale but valid app_role mirror does not override the canonical array",
      driftOmr.status !== 403,
      `omr=${driftOmr.status}`
    );

    // FAMILY union: a parent who is also a student stays inside the family group
    // and reads own-household data through either identity.
    const famEmail = em("studparent");
    await seedRoleSet(famEmail, ["student", "parent"], tenantAId);
    const famToken = await makeAccessible(famEmail);
    const famOmr = await ent("OMRSheet", "POST", famToken, { tenant_id: tenantAId, examination_id: examAId, student_id: studentA1Id, status: "pending" });
    const famList = await api("/functions/manageStaff", { method: "POST", token: famToken, body: { action: "list" } });
    check(
      "M6: a family set (student+parent) is refused every staff capability",
      famOmr.status === 403 && famList.status === 403,
      `omr=${famOmr.status} manageStaff=${famList.status}`
    );

    // --- setRoles: assignment, shape and delegation -------------------------
    const setTargetEmail = em("setroles");
    await makeUser(adminAToken, setTargetEmail, "teacher");
    const setTarget = await findUserByEmail(setTargetEmail);
    const setRes = await api("/functions/manageStaff", {
      method: "POST",
      token: adminAToken,
      body: { action: "setRoles", user_id: setTarget._id.toString(), app_roles: ["teacher", "exam_coordinator"] },
    });
    const afterSet = await findUserByEmail(setTargetEmail);
    const setAudit = await DB.collection("AuditLog").findOne({ action: "assign_role", entity_type: "User", entity_id: setTarget._id.toString() });
    check(
      "M7: setRoles writes the whole set and mirrors the primary in one update",
      setRes.status === 200
        && Array.isArray(afterSet.app_roles) && afterSet.app_roles.includes("teacher") && afterSet.app_roles.includes("exam_coordinator")
        && afterSet.app_role === "exam_coordinator" && Boolean(setAudit),
      `status=${setRes.status} app_roles=${JSON.stringify(afterSet.app_roles)} app_role=${afterSet.app_role} audit=${Boolean(setAudit)}`
    );

    // manageStaff list must report the two fields in agreement, never a stale
    // mirror beside a fresh array.
    const listAfter = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "list" } });
    const listedRow = (listAfter.data?.staff || []).find((u) => u.id === setTarget._id.toString());
    const agrees = listedRow && Array.isArray(listedRow.app_roles) && listedRow.app_role === listedRow.app_roles[0];
    check("M8: manageStaff list rows carry a mirror that agrees with app_roles", agrees === true, `row=${JSON.stringify(listedRow?.app_roles)} mirror=${listedRow?.app_role}`);

    // The load-bearing refusals.
    const crossFamily = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: setTarget._id.toString(), app_roles: ["teacher", "parent"] },
    });
    const emptySet = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: setTarget._id.toString(), app_roles: [] },
    });
    check(
      "M9: a cross-family set and an empty set are both refused",
      crossFamily.status === 400 && emptySet.status === 400,
      `cross-family=${crossFamily.status} empty=${emptySet.status}`
    );

    // Delegation over a SET. A school_admin may bundle the staff roles below it;
    // the primary of the bundle is its WIDEST role, so the state is compared
    // against what was actually stored rather than a hand-computed value.
    const delTargetEmail = em("delroles");
    await makeUser(adminAToken, delTargetEmail, "teacher");
    const delTarget = await findUserByEmail(delTargetEmail);
    const delBundled = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: delTarget._id.toString(), app_roles: ["teacher", "exam_coordinator", "principal"] },
    });
    const afterBundle = await findUserByEmail(delTargetEmail);
    check(
      "M10: a bundled role set is written whole, with its widest role as primary",
      delBundled.status === 200
        && afterBundle.app_role === "principal"
        && JSON.stringify(afterBundle.app_roles) === JSON.stringify(["principal", "exam_coordinator", "teacher"]),
      `bundled=${delBundled.status} app_roles=${JSON.stringify(afterBundle.app_roles)} mirror=${afterBundle.app_role}`
    );

    // --- the minting/assignment split, at the HTTP layer --------------------
    //
    // The single invariant this whole feature rests on, proven with one actor: the
    // SAME school_admin may PROMOTE an existing account to administrator but may
    // not MINT a new administrator by either invitation path. The pure predicates
    // are covered in the unit suite; this proves the routing that selects between
    // them is actually wired to the right action.
    const promoteTargetEmail = em("promote-me");
    await makeUser(adminAToken, promoteTargetEmail, "teacher");
    const promoteTarget = await findUserByEmail(promoteTargetEmail);
    const promote = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: promoteTarget._id.toString(), app_roles: ["teacher", "school_admin"] },
    });
    const promoted = await findUserByEmail(promoteTargetEmail);
    check(
      "M14: a school_admin CAN promote an existing account to school_admin",
      promote.status === 200
        && Array.isArray(promoted.app_roles)
        && promoted.app_roles.includes("school_admin")
        && promoted.app_role === "school_admin",
      `promote=${promote.status} app_roles=${JSON.stringify(promoted.app_roles)}`
    );

    // Both minting paths must refuse, and must say why -- an unexplained 403 here
    // reads as a missing feature, and the remedy (promote instead) is the point.
    const mintMs = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "invite", email: em("mint-ms"), app_role: "school_admin" },
    });
    const mintInvite = await invite(adminAToken, em("mint-invite"), "school_admin");
    const mintProvision = await api("/users/provision", {
      method: "POST", token: adminAToken,
      body: { full_name: "Mint Probe", email: em("mint-provision"), password: TEST_PASSWORD, app_roles: ["school_admin"] },
    });
    const mintCreated = await findUserByEmail(em("mint-provision"));
    check(
      "M15: a school_admin CANNOT mint a new administrator on ANY of the three creation paths",
      mintMs.status === 403
        && mintInvite.status === 403
        && mintProvision.status === 403
        && /promote|platform/i.test(mintMs.data?.error || "")
        && !mintCreated,
      `manageStaff=${mintMs.status} users/invite=${mintInvite.status} provision=${mintProvision.status} created=${Boolean(mintCreated)}`
    );

    // Now that a second administrator exists, standing one of them down is allowed
    // -- and reversible, which is what makes demotion safe to permit at all.
    const demote = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: promoteTarget._id.toString(), app_roles: ["teacher"] },
    });
    const demoted = await findUserByEmail(promoteTargetEmail);
    check(
      "M16: with a second administrator in place, demoting one back to teacher is allowed",
      demote.status === 200 && demoted.app_role === "teacher" && !demoted.app_roles.includes("school_admin"),
      `demote=${demote.status} app_roles=${JSON.stringify(demoted.app_roles)}`
    );

    // --- the last-administrator invariant ----------------------------------
    //
    // Tenant A has exactly one administrator again now (adminAToken). Stripping
    // that role is refused, and refusing must not write anything.
    const soleAdmin = await DB.collection("User").findOne({ tenant_id: tenantAId, app_role: "school_admin" });
    const stripLast = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: soleAdmin._id.toString(), app_roles: ["teacher"] },
    });
    const soleAfter = await DB.collection("User").findOne({ _id: soleAdmin._id });
    check(
      "M17: the only administrator of an institution cannot be demoted (400, nothing written)",
      stripLast.status === 400
        && soleAfter.app_role === "school_admin"
        && soleAfter.app_roles.includes("school_admin"),
      `strip=${stripLast.status} stored=${JSON.stringify(soleAfter.app_roles)}`
    );

    // Self-deletion is a DIFFERENT route to the same dead end, so it needs its own
    // guard. canDeleteOwnAccount only excludes platform roles, so before this the
    // sole administrator could simply close their own login and orphan the school.
    const selfDelete = await api("/functions/deleteMyAccount", { method: "POST", token: adminAToken, body: { password: TEST_PASSWORD } });
    const stillThere = await DB.collection("User").findOne({ _id: soleAdmin._id });
    check(
      "M18: the only administrator cannot delete their own account either",
      selfDelete.status === 400 && Boolean(stillThere),
      `delete=${selfDelete.status} still_present=${Boolean(stillThere)}`
    );

    // With a second administrator appointed, the guard must release in both paths,
    // or it would be a one-way door.
    const secondAdminEmail = em("second-admin");
    await makeUser(adminAToken, secondAdminEmail, "teacher");
    const secondAdmin = await findUserByEmail(secondAdminEmail);
    const appointSecond = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: secondAdmin._id.toString(), app_roles: ["teacher", "school_admin"] },
    });
    const stripOneOfTwo = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: promoteTarget._id.toString(), app_roles: ["teacher", "school_admin"] },
    });
    const nowDemote = await api("/functions/manageStaff", {
      method: "POST", token: adminAToken,
      body: { action: "setRoles", user_id: secondAdmin._id.toString(), app_roles: ["teacher"] },
    });
    check(
      "M19: the guard releases once a second administrator exists",
      appointSecond.status === 200
        && stripOneOfTwo.status === 200
        && nowDemote.status === 200
        && (await findUserByEmail(secondAdminEmail)).app_role === "teacher",
      `appoint=${appointSecond.status} promote2=${stripOneOfTwo.status} demote2=${nowDemote.status}`
    );

    // --- the list is a STAFF list -------------------------------------------
    //
    // Family logins are excluded. They arrive as a side effect of admitting a
    // student, are managed on the Students and Parents pages, and listing them here
    // invited an administrator to edit role sets the provisioning matrix keeps off
    // this surface.
    //
    // An account with NO valid role is deliberately KEPT: it is locked out by the
    // NO_ASSIGNED_ROLE gate and this table is the only place an administrator can
    // give it a role, so filtering it away would make it unfixable from any screen.
    const orphanEmail = em("role-less");
    await seedLegacyUser(orphanEmail, "wizard", tenantAId);
    const scoped = await api("/functions/manageStaff", { method: "POST", token: adminAToken, body: { action: "list" } });
    const rows = scoped.data?.staff || [];
    const emails = rows.map((r) => (r.email || "").toLowerCase());
    const familyLeaked = rows.filter((r) => r.app_roles.some((x) => x === "student" || x === "parent"));
    check(
      "M20: the staff list excludes family logins",
      scoped.status === 200
        && !familyLeaked.length
        && !emails.includes(studentEmail)
        && !emails.includes(parentEmail),
      `rows=${rows.length} family_rows=${familyLeaked.length} student_listed=${emails.includes(studentEmail)}`
    );
    check(
      "M21: a role-less account is still listed, so it can be rescued",
      emails.includes(orphanEmail) && rows.find((r) => r.email === orphanEmail)?.app_roles.length === 0,
      `listed=${emails.includes(orphanEmail)} roles=${JSON.stringify(rows.find((r) => r.email === orphanEmail)?.app_roles)}`
    );

    // The two lists the screen renders are different lists, from different matrices,
    // and neither is ever allowed to offer a family role.
    const assignableA = Array.isArray(scoped.data?.assignable_roles) ? scoped.data.assignable_roles : [];
    const creatableA = Array.isArray(scoped.data?.creatable_roles) ? scoped.data.creatable_roles : [];
    check(
      "M22: assignable_roles offers school_admin to a school_admin; creatable_roles never does",
      assignableA.includes("school_admin")
        && !creatableA.includes("school_admin")
        && !assignableA.includes("student")
        && !assignableA.includes("parent")
        && !creatableA.includes("student")
        && !creatableA.includes("parent"),
      `assignable=${JSON.stringify(assignableA)} creatable=${JSON.stringify(creatableA)}`
    );

    // --- a named institution must resolve to a LIVE tenant -------------------
    const missingId = new ObjectId().toString();
    const missingList = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "list", tenant_id: missingId } });
    const junkList = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "list", tenant_id: "not-an-object-id" } });
    check(
      "M11: manageStaff list refuses a tenant id that resolves to nothing",
      missingList.status === 404 && junkList.status === 404,
      `missing=${missingList.status} junk=${junkList.status}`
    );

    const inactiveId = new ObjectId();
    await DB.collection("Tenant").insertOne({
      _id: inactiveId,
      name: "RBAC Retired School",
      subdomain: `retired-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      status: "inactive",
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
    });
    trackedTenant(inactiveId);
    const inactiveList = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "list", tenant_id: inactiveId.toString() } });
    const inactiveInviteMs = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "invite", email: em("inactive-ms"), app_role: "teacher", tenant_id: inactiveId.toString() } });
    const inactiveInviteUsers = await api("/users/invite", { method: "POST", token: superToken, body: { email: em("inactive-users"), role: "teacher", tenant_id: inactiveId.toString() } });
    check(
      "M12: an inactive institution is refused on list and on both invite paths",
      inactiveList.status === 400 && inactiveInviteMs.status === 400 && inactiveInviteUsers.status === 400,
      `list=${inactiveList.status} manageStaff-invite=${inactiveInviteMs.status} users-invite=${inactiveInviteUsers.status}`
    );

    const missingInviteMs = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "invite", email: em("missing-ms"), app_role: "teacher", tenant_id: missingId } });
    const missingInviteUsers = await api("/users/invite", { method: "POST", token: superToken, body: { email: em("missing-users"), role: "teacher", tenant_id: missingId } });
    check(
      "M13: a nonexistent institution is refused on both invite paths",
      missingInviteMs.status === 404 && missingInviteUsers.status === 404,
      `manageStaff=${missingInviteMs.status} users=${missingInviteUsers.status}`
    );
  }

  // -------------------------------------------------------------------------
  // V — the "view as" scope
  //
  // A platform owner who picks a school on the dashboard is asking a display
  // question: "show me this school". Before the X-View-As-Tenant header the
  // answer was always "here is every school", on every page, under a banner
  // naming one. These checks are the fix, and the no-header case beside each one
  // is the regression guard — a scope that silently stopped being honoured would
  // still pass a test that only checked the scoped half.
  {
    const asA = (tenantId) => ({ headers: { "X-View-As-Tenant": tenantId } });

    // Reads. Student is an ordinary tenant-scoped collection, so this is the
    // plain case: a super_admin token is otherwise exempt from readScope().
    const unscopedStudents = await ent("Student", "GET", superToken, null, "", "");
    const scopedStudents = await api("/entities/Student", { token: superToken, ...asA(tenantAId) });
    const scopedList = Array.isArray(scopedStudents.data) ? scopedStudents.data : [];
    const scopedAllInA = scopedList.length > 0 && scopedList.every((s) => s.tenant_id === tenantAId);
    const unscopedList = Array.isArray(unscopedStudents.data) ? unscopedStudents.data : [];
    const unscopedIsWider = unscopedList.some((s) => s.tenant_id !== tenantAId);
    check(
      "V1: a super_admin WITH a scope sees only that school, and WITHOUT it still sees every school",
      scopedStudents.status === 200
        && scopedAllInA
        && unscopedStudents.status === 200
        && unscopedIsWider,
      `scoped=${scopedStudents.status} rows=${scopedList.length} allA=${scopedAllInA} unscoped_rows=${unscopedList.length} unscoped_wider=${unscopedIsWider}`
    );

    // The original defect, on the screen it was reported from. No tenant_id in the
    // body at all, because the client overlay hides super_admin from the
    // platform-owner check and the picker never renders.
    const scopedStaff = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "list" }, ...asA(tenantAId) });
    const scopedStaffRows = scopedStaff.data?.staff || [];
    check(
      "V2: manageStaff list under a scope is that school's staff, with no tenant_id sent",
      scopedStaff.status === 200
        && scopedStaffRows.length > 0
        && scopedStaffRows.every((u) => u.tenant_id === tenantAId)
        && scopedStaff.data.tenant_id === tenantAId,
      `status=${scopedStaff.status} rows=${scopedStaffRows.length} tenant=${scopedStaff.data?.tenant_id}`
    );

    // A scope is an upper bound, not a suggestion: naming another school in the
    // body cannot widen it.
    const widenList = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "list", tenant_id: tenantBId }, ...asA(tenantAId) });
    const widenInvite = await api("/functions/manageStaff", { method: "POST", token: superToken, body: { action: "invite", email: em("scope-widen"), app_role: "teacher", tenant_id: tenantBId }, ...asA(tenantAId) });
    check(
      "V3: a scope cannot be widened by naming another institution in the body (404, not 403)",
      widenList.status === 404 && widenInvite.status === 404 && !(await findUserByEmail(em("scope-widen"))),
      `list=${widenList.status} invite=${widenInvite.status} created=${Boolean(await findUserByEmail(em("scope-widen")))}`
    );

    // Writes. The delegation matrix exempts the platform owner from the tenant
    // boundary, so this needed its own guard, and it must write NOTHING.
    const bTeacher = await findUserByEmail(bTeacherEmail);
    const bTeacherBefore = JSON.stringify(bTeacher?.app_roles);
    const crossSet = await api("/functions/manageStaff", {
      method: "POST", token: superToken, ...asA(tenantAId),
      body: { action: "setRoles", user_id: bTeacher._id.toString(), app_roles: ["teacher", "exam_coordinator"] },
    });
    const bTeacherAfter = await findUserByEmail(bTeacherEmail);
    check(
      "V4: a scoped platform owner cannot change a role outside the school, and nothing is written",
      crossSet.status === 404 && JSON.stringify(bTeacherAfter.app_roles) === bTeacherBefore,
      `status=${crossSet.status} before=${bTeacherBefore} after=${JSON.stringify(bTeacherAfter.app_roles)}`
    );

    // The same school's staff is still fully manageable while scoped — a scope that
    // refused everything would pass V4 while being useless.
    const aTeacher = await findUserByEmail(teacherEmail);
    const inScopeSet = await api("/functions/manageStaff", {
      method: "POST", token: superToken, ...asA(tenantAId),
      body: { action: "setRoles", user_id: aTeacher._id.toString(), app_roles: ["teacher", "exam_coordinator"] },
    });
    const aTeacherAfter = await findUserByEmail(teacherEmail);
    check(
      "V5: ...while a role change inside the school still works",
      inScopeSet.status === 200 && (aTeacherAfter.app_roles || []).includes("exam_coordinator"),
      `status=${inScopeSet.status} app_roles=${JSON.stringify(aTeacherAfter.app_roles)}`
    );
    // Put it back, so later checks are not reasoning about a changed fixture.
    await api("/functions/manageStaff", {
      method: "POST", token: superToken, ...asA(tenantAId),
      body: { action: "setRoles", user_id: aTeacher._id.toString(), app_roles: ["teacher"] },
    });

    // User narrows, because "this school's staff" is the whole point; Tenant stays
    // wide, because the Institutions console is how you LEAVE the scope.
    const scopedUsers = await api("/entities/User", { token: superToken, ...asA(tenantAId) });
    const scopedUserRows = Array.isArray(scopedUsers.data) ? scopedUsers.data : [];
    const scopedTenants = await api("/entities/Tenant", { token: superToken, ...asA(tenantAId) });
    const scopedTenantRows = Array.isArray(scopedTenants.data) ? scopedTenants.data : [];
    check(
      "V6: User narrows to the school under a scope, but Tenant stays platform-wide",
      scopedUsers.status === 200
        && scopedUserRows.length > 0
        && scopedUserRows.every((u) => u.tenant_id === tenantAId)
        && scopedTenants.status === 200
        && scopedTenantRows.length > 1,
      `users=${scopedUserRows.length} allA=${scopedUserRows.every((u) => u.tenant_id === tenantAId)} tenants=${scopedTenantRows.length}`
    );

    // A create while scoped lands in the school being viewed, whatever the body
    // claimed — the force, not a refusal, because the client omits tenant_id here.
    const scopedClass = await api("/entities/SchoolClass", {
      method: "POST", token: superToken, ...asA(tenantAId),
      body: { name: `Scoped Class ${runId}`, tenant_id: tenantBId },
    });
    const scopedClassRow = scopedClass.data?.id
      ? await DB.collection("SchoolClass").findOne({ _id: new ObjectId(scopedClass.data.id) })
      : null;
    check(
      "V7: a create while scoped lands in the scoped school even if the body names another",
      scopedClass.status === 201 && String(scopedClassRow?.tenant_id) === tenantAId,
      `status=${scopedClass.status} stored=${scopedClassRow?.tenant_id}`
    );

    // Ignored, not obeyed, for anyone who is not the platform owner. A
    // non-platform account is already pinned to its own tenant, and the header
    // must never be a way to move it.
    const adminIgnoresHeader = await api("/functions/manageStaff", { method: "POST", token: adminBToken, body: { action: "list", tenant_id: tenantAId }, headers: { "X-View-As-Tenant": tenantAId } });
    const adminOwnScope = await api("/functions/manageStaff", { method: "POST", token: adminBToken, body: { action: "list" }, headers: { "X-View-As-Tenant": tenantAId } });
    const bRows = adminOwnScope.data?.staff || [];
    check(
      "V8: a school_admin's scope header is IGNORED — its own tenant governs, and a cross-tenant body is still 404",
      adminIgnoresHeader.status === 404
        && adminOwnScope.status === 200
        && bRows.every((u) => u.tenant_id === tenantBId),
      `cross=${adminIgnoresHeader.status} own=${adminOwnScope.status} rows=${bRows.length} allB=${bRows.every((u) => u.tenant_id === tenantBId)}`
    );

    // Validation, and failing CLOSED. A scope that degraded to "no scope" on a bad
    // id would show more than the operator asked for, which is the failure this
    // whole change exists to remove.
    const junkScope = await api("/entities/Student", { token: superToken, headers: { "X-View-As-Tenant": "not-an-object-id" } });
    const missingScope = await api("/entities/Student", { token: superToken, headers: { "X-View-As-Tenant": new ObjectId().toString() } });
    const disabledTenant = await DB.collection("Tenant").insertOne({ name: `Disabled ${runId}`, subdomain: `disabled-${runId}`, status: "disabled" });
    const disabledScope = await api("/entities/Student", { token: superToken, headers: { "X-View-As-Tenant": disabledTenant.insertedId.toString() } });
    check(
      "V9: a scope naming nothing is 404 and a disabled institution is 400 — never a silent widening",
      junkScope.status === 404 && missingScope.status === 404 && disabledScope.status === 400,
      `junk=${junkScope.status} missing=${missingScope.status} disabled=${disabledScope.status}`
    );
  }

  // -------------------------------------------------------------------------
  // Per-role coverage for what the sections above leave untested: the entity rows
  // that were never sent to any role, and the upload/capability/service gates.
  //
  // These live in ./suites/ and receive a context built from the locals already in
  // scope, so the server, the fixtures and the cleanup path stay shared. Nothing
  // above this line is modified.
  const suiteCtx = {
    api, check, ent, DB, ObjectId, userIds, tenantIds, trackedTenant, runId, dbName,
    superToken, waitFor, findUserByEmail, hashPw,
    // The upload suite drives the multipart route, which the JSON helper cannot
    // express: the server runs multer.memoryStorage, so the purpose gate is only
    // reached by a real multipart body.
    apiUpload: uploadProbe,
    // The upload suite asserts on this directory and needs the server to have written
    // into it, so it is read at call time rather than captured at spawn time.
    get uploadsDir() {
      return uploadsDir;
    },
    get serverLogs() {
      return serverLogs;
    },
    get base() {
      return base;
    },
  };
  const suiteFixture = {
    tenantAId, tenantBId, adminAToken, adminBToken,
    principalToken, ecToken, teacherToken, studentToken, parentToken, bTeacherToken,
    studentA1Id, bStudentId, examAId, examKeyDraftId,
    classAId: classA.data.id, classBId: classB.data.id, yearAId: yearA.data.id,
    teacherEmail, studentEmail, parentEmail,
  };

  await runEntityMatrixSuite(suiteCtx, suiteFixture);
  await runCapabilitiesSuite(suiteCtx, suiteFixture);

  check("Fixture run complete", true, `users=${userIds.size} tenants=${tenantIds.size}`);
} catch (err) {
  console.error("HARNESS ERROR:", err.message);
  console.error("--- server log tail ---");
  console.error(serverLogs?.slice(-50).join("") || "");
  process.exitCode = 2;
} finally {
  await cleanup();
    cleanupUploadsDir();
  try {
    await DB.dropDatabase();
    console.log(`cleanup: dropped harness-only scratch database ${dbName}`);
  } catch (err) {
    check("Cleanup: scratch database drop failed", false, err.message);
  }
  try {
    await client.close();
  } catch {
    /* ignore */
  }
}

const results = {
  pass: checks.filter((c) => c.pass).length,
  fail: checks.filter((c) => !c.pass).length,
};
console.log("");
console.log(`RBAC test matrix: ${results.pass} passed, ${results.fail} failed (scratch db: ${dbName})`);
if (results.fail > 0 || process.exitCode) {
  console.log("SOME TESTS FAILED");
  if (!process.exitCode) process.exitCode = 1;
} else {
  console.log("ALL TESTS PASSED");
}