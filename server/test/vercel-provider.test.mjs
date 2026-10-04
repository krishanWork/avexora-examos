import { test } from "node:test";
import assert from "node:assert/strict";

import { createVercelProvider } from "../lib/vercelProvider.js";
import { HOSTING_STATUS } from "../lib/hosting.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Minimal fetch stub keyed by `METHOD url`.
const makeApi = (routes) => {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init?.method || "GET";
    const key = `${method} ${String(url)}`;
    calls.push(key);
    const handler = routes[key];
    if (!handler) return json({ error: { code: "no_route", message: key } }, 404);
    return typeof handler === "function"
      ? handler({ body: init?.body ? JSON.parse(init.body) : undefined })
      : handler;
  };
  fn.calls = calls;
  return fn;
};

const token = "tok_test";
const projectId = "prj_abc";
const HOST = "exam.school.edu";

test("provider reports not configured without credentials", async () => {
  const p = createVercelProvider({ token: "", projectId: "", projectName: "", fetchImpl: makeApi({}) });
  assert.equal(p.isConfigured(), false);
  assert.equal(p.name, "vercel");
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.implemented, true);
  assert.equal(r.status, HOSTING_STATUS.NOT_CONFIGURED);
});

test("addCustomDomain success resolves to CONFIGURED/verified", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": json({ name: HOST, verified: true, verification: [] }),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  assert.equal(p.isConfigured(), true);
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.CONFIGURED);
  assert.equal(r.verified, true);
  assert.equal(api.calls[0], "POST https://api.vercel.com/v10/projects/prj_abc/domains");
});

test("addCustomDomain surfaces pending verification records", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": json({
      name: HOST,
      verified: false,
      verification: [{ type: "CNAME", domain: HOST, value: "c76d818fb49abf1c.vercel-dns-017.com" }],
    }),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.CONFIGURING);
  assert.equal(r.verified, false);
  assert.equal(r.verification.length, 1);
  assert.equal(r.verification[0].type, "CNAME");
  assert.equal(r.verification[0].required, "c76d818fb49abf1c.vercel-dns-017.com");
});

test("addCustomDomain conflict with TXT proof still allows configuring", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": json(
      {
        error: { code: "conflict", message: "Domain is already defined on a different project" },
        verification: [{ type: "TXT", domain: HOST, value: "abc123" }],
      },
      409
    ),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.CONFIGURING);
  assert.equal(r.reason, "conflict");
  assert.equal(r.verification[0].required, "abc123");
});

test("addCustomDomain conflict without proof records fails", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": json({ error: { code: "conflict" } }, 409),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.FAILED);
  assert.equal(r.reason, "conflict");
});

test("addCustomDomain API error and rate limit map to FAILED", async () => {
  const errApi = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": () => json({ error: { code: "server_error", message: "boom" } }, 500),
  });
  const r1 = await createVercelProvider({ token, projectId, fetchImpl: errApi, retryAttempts: 1 }).addCustomDomain(HOST);
  assert.equal(r1.status, HOSTING_STATUS.FAILED);
  assert.equal(r1.reason, "api_error");
  assert.match(r1.message, /server_error: boom/);

  const rateApi = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": () => json({}, 429),
  });
  const r2 = await createVercelProvider({ token, projectId, fetchImpl: rateApi, retryAttempts: 1 }).addCustomDomain(HOST);
  assert.equal(r2.status, HOSTING_STATUS.FAILED);
  assert.equal(r2.reason, "rate_limited");
});

test("getDomainStatus reports verified / pending / not attached", async () => {
  const api = makeApi({
    "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu": () =>
      (api.calls.length % 2 === 1
        ? json({ name: HOST, verified: true, verification: [] })
        : json({ name: HOST, verified: false, verification: [{ type: "CNAME", domain: HOST, value: "x" }] })),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r1 = await p.getDomainStatus(HOST);
  assert.equal(r1.verified, true);
  assert.equal(r1.status, HOSTING_STATUS.CONFIGURED);
  const r2 = await p.getDomainStatus(HOST);
  assert.equal(r2.verified, false);
  assert.equal(r2.status, HOSTING_STATUS.CONFIGURING);

  const notAttached = makeApi({
    "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu": json({}, 404),
  });
  const r3 = await createVercelProvider({ token, projectId, fetchImpl: notAttached }).getDomainStatus(HOST);
  assert.equal(r3.reason, "not_attached");
});

test("waitUntilVerified polls until Vercel confirms", async () => {
  let n = 0;
  const api = makeApi({
    "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu": () => {
      n += 1;
      return json(n >= 2 ? { name: HOST, verified: true, verification: [] } : { name: HOST, verified: false, verification: [] });
    },
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api, pollIntervalMs: 0, maxAttempts: 5 });
  const r = await p.waitUntilVerified(HOST);
  assert.equal(r.verified, true);
  assert.equal(r.attempts, 2);
});

test("waitUntilVerified gives up after attempts with pending records", async () => {
  const api = makeApi({
    "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu": () =>
      json({
        name: HOST,
        verified: false,
        verification: [{ type: "CNAME", domain: HOST, value: "still-needed.example" }],
      }),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api, pollIntervalMs: 0, maxAttempts: 3 });
  const r = await p.waitUntilVerified(HOST);
  assert.equal(r.verified, false);
  assert.equal(r.attempts, 3);
  assert.equal(r.verification[0].required, "still-needed.example");
});

test("verifyDomain re-triggers verification", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu/verify": json({ name: HOST, verified: true, verification: [] }),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.verifyDomain(HOST);
  assert.equal(r.implemented, true);
  assert.equal(r.verified, true);
});

test("provider times out instead of hanging", async () => {
  const hanging = (_url, init) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () =>
        rej(Object.assign(new Error("aborted"), { name: "AbortError" }))
      );
    });
  const p = createVercelProvider({ token, projectId, fetchImpl: hanging, timeoutMs: 5, retryAttempts: 1 });
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.FAILED);
  assert.match(r.message, /timed out/);
});

test("project name resolution works when only the name is configured", async () => {
  const api = makeApi({
    "GET https://api.vercel.com/v6/projects/examos": json({ id: "prj_resolved" }),
    "POST https://api.vercel.com/v10/projects/prj_resolved/domains": json({ name: HOST, verified: true, verification: [] }),
  });
  const p = createVercelProvider({ token, projectName: "examos", fetchImpl: api });
  assert.equal(p.isConfigured(), true);
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.CONFIGURED);
  assert.ok(api.calls[0].includes("/v6/projects/examos"));
});

test("removeCustomDomain detaches the domain", async () => {
  const api = makeApi({
    "DELETE https://api.vercel.com/v10/projects/prj_abc/domains/exam.school.edu": json({}, 200),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.removeCustomDomain(HOST);
  assert.equal(r.implemented, true);
  assert.equal(r.removed, true);
  assert.equal(r.status, HOSTING_STATUS.NOT_CONFIGURED);
});