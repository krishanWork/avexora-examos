// Shared plumbing for the live RBAC harness.
//
// The harness used to be one 1948-line top-level script, which meant every new suite
// had to be appended to that script to reuse its server, scratch database and fixtures.
// This module owns the parts that are not tests:
//
//   - the scratch database, its per-run name, and its teardown
//   - spawning the real server against that database, with a scrubbed environment
//   - the JSON api() helper, and apiUpload() for the multipart upload routes
//   - check(), which accumulates results and prints them
//   - fixture tracking, so cleanup can prove it removed everything it created
//
// Suites receive a context object and never import this module directly, so there is
// one server and one fixture set per run rather than one per suite.
//
// Nothing here is imported by `npm test` (server/test) — the pure-policy suite must
// stay runnable without a database.

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";

// The repo root, found by walking up to package.json rather than by counting "../"
// hops. This tree used to live in scripts/ and moved twice since, and a fixed hop count
// silently pointed every spawned child at the wrong directory.
export const root = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return dir;
    dir = up;
  }
})();

export const MONGO_BASE = "mongodb://localhost:27017";
export const runId = `${Date.now().toString(36)}c${crypto.randomBytes(3).toString("hex")}`;
export const dbName = `avexora_examos_rbac_${runId}`;
export const scratchUri = `${MONGO_BASE}/${dbName}`;

export const ADMIN_EMAIL = `rbac-admin-${runId}@example.test`;
export const ADMIN_PASS = crypto.randomBytes(12).toString("hex");
export const TEST_PASSWORD = "TempPass1!";
export const em = (x) => `rbac-${runId}-${x}@example.test`;

// Collections the harness writes tenant-scoped rows into. cleanup() walks these so it
// can prove it left nothing behind before dropping the scratch database.
const DATA_COLLECTIONS = [
  "Student", "Teacher", "Examination", "OMRSheet", "Result", "SchoolClass", "Subject",
  "TenantAnnouncement", "AnswerKey", "OMRCorrection", "AuditLog", "Enrollment",
  "ExamRoster", "AcademicYear",
  // Added with the entity-matrix suite. Without them here, a fixture row in one of
  // these collections would survive the tenant sweep and make the "no fixtures remain"
  // check fail for a reason unrelated to the suite under test.
  "Section", "Parent", "ParentStudent", "TeacherAssignment", "Assignment",
  "AssignmentSubmission", "Lead", "Payment", "PlatformBranding", "SubscriptionPlan",
  "Announcement",
];

export const createHarness = () => {
  const checks = [];
  const userIds = new Set();
  const tenantIds = new Set();
  const trackedTenant = (id) => tenantIds.add(id.toString());

  let base;
  let agentSeq = 0;
  let child = null;
  let stopServer = null;
  let serverLogs = [];
  let superToken = null;
  let uploadsDir = null;

  const client = new MongoClient(scratchUri, { serverSelectionTimeoutMS: 10000 });
  let DB = null;

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

  // Multipart POST, for POST /api/upload. The server runs multer.memoryStorage, so the
  // bytes must be sent as a real multipart/form-data body for the purpose gate at
  // rbac.js canUploadPurpose to be reached at all.
  //
  // Built by hand against the global fetch rather than adding a multipart dependency:
  // the boundary has to be reproducible in the assertions either way, and the payloads
  // here are small buffers with a known magic signature.
  const apiUpload = async (pathName, { token, filename, bytes, fields = {} } = {}) => {
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

  const hashPw = (pw) => bcrypt.hash(pw, 4);
  const findUserByEmail = (email) => DB.collection("User").findOne({ email: String(email).toLowerCase().trim() });

  // The server honours UPLOADS_DIR (server/index.js). Point it at a temp dir so the
  // upload suite's logo and import fixtures land outside the repo, and remove it in
  // teardown.
  const makeUploadsDir = () => {
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rbac-uploads-"));
    return uploadsDir;
  };

  const envForServer = (port) => {
    const env = {
      ...process.env,
      MONGODB_URI: MONGO_BASE,
      MONGODB_DB: dbName,
      PORT: String(port),
      JWT_SECRET: "rbac-test-secret",
      ADMIN_EMAIL,
      ADMIN_PASSWORD: ADMIN_PASS,
      CLIENT_ORIGIN: `http://127.0.0.1:${port}`,
      UPLOADS_DIR: makeUploadsDir(),
      // With no SMTP configured there is no way to obtain a verification token, so the
      // harness opts in to the explicit development escape hatch and drives the real
      // verify-email endpoint with it. Never set in a real deployment.
      EMAIL_VERIFICATION_DEV_TOKEN: "1",
      // The verification flow must be deterministic, and this machine's .env really does
      // have working SMTP credentials. Deleting the keys is not enough: the server
      // loads .env itself, and dotenv does not overwrite a variable that is already
      // present. Setting them to the empty string is what actually neutralizes them, so
      // isEmailConfigured() is false and no real message is sent during a scratch run.
      SMTP_HOST: "",
      SMTP_FROM: "",
    };
    delete env.VERCEL;
    for (const key of Object.keys(env)) {
      if (/^SMTP_(USER|PASS|PORT|SECURE)/.test(key)) delete env[key];
    }
    return env;
  };

  const boot = async () => {
    await client.connect();
    DB = client.db(dbName);

    const ix = spawnSync(process.execPath, ["server/ensure-indexes.js"], {
      cwd: root,
      env: { ...process.env, MONGODB_URI: MONGO_BASE, MONGODB_DB: dbName },
      timeout: 30000,
      encoding: "utf8",
    });
    check("ensure-indexes.js runs idempotently on scratch DB", ix.status === 0, ix.stdout?.trim());

    const port = await getFreePort();
    base = `http://127.0.0.1:${port}/api`;

    serverLogs = [];
    child = spawn(process.execPath, ["server/index.js"], {
      cwd: root,
      env: envForServer(port),
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

    check("Scratch database isolated", true, `scratch db=${dbName}`);
    return { superToken, port };
  };

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
      console.error("Cleanup error:", err.message);
    }
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
    if (uploadsDir) {
      // The upload suite asserts on this directory, so it must outlive the server and
      // be inspected before teardown; removal here is only the final sweep.
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
  };

  const context = {
    // mutable per-run singletons, exposed as getters so a suite holding `ctx` always
    // sees the current value even though these are reassigned during boot
    get base() { return base; },
    get DB() { return DB; },
    get superToken() { return superToken; },
    get uploadsDir() { return uploadsDir; },
    get serverLogs() { return serverLogs; },
    checks,
    userIds,
    tenantIds,
    trackedTenant,
    check,
    waitFor,
    api,
    apiUpload,
    hashPw,
    findUserByEmail,
    boot,
    cleanup,
    runId,
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASS,
    testPassword: TEST_PASSWORD,
    email: em,
    ObjectId,
  };

  return context;
};