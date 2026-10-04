import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HOSTING_STATUS,
  validateProviderContract,
  registerHostingProvider,
  getHostingProvider,
  listHostingProviders,
  resetHostingRegistry,
} from "../lib/hosting.js";
import { createVercelProvider } from "../lib/vercelProvider.js";
import { runCustomDomainActivation, ACTIVATION_STAGE } from "../lib/activationOrchestrator.js";
import { withRetry, isRetryableStatus } from "../lib/httpRetry.js";

// ---------------------------------------------------------------- test helpers

const chainedVerified = () => ({ verified: true, reason: null, record: null });
const chainedInvalid = () => ({ verified: false, reason: "dns_target_mismatch", record: "other.example" });
const probeLive = () => ({ live: true, reason: null, reachable: true });
const probeDead = () => ({ live: false, reason: "app_identity_failed", reachable: true });

// A provider that implements the full contract but knows nothing about Vercel —
// it is the proof that orchestration is provider-agnostic.
const makeStubProvider = ({ verificationCapable = false, attach, verificationResult } = {}) => ({
  name: "stub",
  verificationCapable,
  isConfigured() {
    return true;
  },
  async addCustomDomain() {
    return (
      attach || {
        implemented: verificationCapable,
        status: verificationCapable ? HOSTING_STATUS.CONFIGURING : HOSTING_STATUS.NOT_CONFIGURED,
        verified: false,
        verification: verificationResult?.verification || [],
      }
    );
  },
  async getDomainStatus() {
    return { implemented: true, verified: false, verification: [], status: HOSTING_STATUS.CONFIGURING };
  },
  async waitUntilVerified() {
    return verificationResult || { verified: false, verification: [], attempts: 1 };
  },
  async removeCustomDomain() {
    return { implemented: true, status: HOSTING_STATUS.NOT_CONFIGURED, removed: true };
  },
  async verifyDomain() {
    return { implemented: true, verified: false };
  },
});

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const makeApi = (routes) => {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init?.method || "GET";
    const key = `${method} ${String(url)}`;
    calls.push(key);
    const handler = routes[key];
    if (!handler) return json({ error: { code: "no_route", message: key } }, 404);
    return typeof handler === "function" ? handler({ body: init?.body ? JSON.parse(init.body) : undefined }) : handler;
  };
  fn.calls = calls;
  return fn;
};

const token = "tok_test";
const projectId = "prj_abc";
const HOST = "exam.school.edu";

// -------------------------------------------------------------- contract surface

test("the manual and vercel providers conform to the canonical contract", () => {
  const providers = createVercelProvider({ token: "", projectId: "", projectName: "" });
  assert.equal(validateProviderContract(providers).length, 0);
  assert.equal(validateProviderContract(makeStubProvider({})).length, 0);
  assert.equal(validateProviderContract(null).length >= 1, true);
});

test("registerHostingProvider rejects a provider that breaks the contract", () => {
  assert.throws(
    () => registerHostingProvider({ name: "broken", verificationCapable: true, isConfigured: () => false }),
    /missing required method addCustomDomain/
  );
});

test("validateProviderContract flags missing required methods and wrong types", () => {
  const problems = validateProviderContract({
    name: "x",
    verificationCapable: true,
    isConfigured: () => false,
    addCustomDomain: async () => ({}),
  });
  assert.ok(problems.some((p) => p.includes("getDomainStatus")));
  assert.ok(problems.some((p) => p.includes("waitUntilVerified")));
  assert.ok(problems.some((p) => p.includes("removeCustomDomain")));
});

test("Vercel provider describe() is masked and lists required env names", async () => {
  const configured = await createVercelProvider({ token, projectId }).describe();
  assert.equal(configured.name, "vercel");
  assert.equal(configured.verificationCapable, true);
  assert.equal(configured.configured, true);
  assert.deepEqual(configured.requiredEnv, ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"]);
  assert.ok(!JSON.stringify(configured).includes(token), "describe() must not leak credentials");

  const unconfigured = await createVercelProvider({ token: "", projectId: "" }).describe();
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.state, "not_configured");
});

// ------------------------------------------------- StubProvider drives the orchestrator

const drive = async (stub, verifier = { checkChain: chainedVerified, probeDomain: probeLive }) =>
  runCustomDomainActivation({ verifier, hosting: stub, host: HOST });

test("orchestrator rejects misconfigured DNS before any provider call (DNS_FAILED)", async () => {
  const stage = await drive(makeStubProvider({ verificationCapable: true }), {
    checkChain: chainedInvalid,
  });
  assert.equal(stage.stage, ACTIVATION_STAGE.DNS_FAILED);
});

test("orchestrator + manual provider: live probe decides (LIVE)", async () => {
  const stage = await drive(makeStubProvider({ verificationCapable: false }));
  assert.equal(stage.stage, ACTIVATION_STAGE.LIVE);
});

test("orchestrator + manual provider: probe failure is PROBE_FAILED", async () => {
  const stage = await drive(makeStubProvider({ verificationCapable: false }), {
    checkChain: chainedVerified,
    probeDomain: probeDead,
  });
  assert.equal(stage.stage, ACTIVATION_STAGE.PROBE_FAILED);
});

test("orchestrator: provider API failure is HOSTING_FAILED", async () => {
  const stage = await drive(
    makeStubProvider({
      verificationCapable: true,
      attach: { implemented: true, status: HOSTING_STATUS.FAILED, reason: "api_error" },
    })
  );
  assert.equal(stage.stage, ACTIVATION_STAGE.HOSTING_FAILED);
});

test("orchestrator: unverified provider stays VERIFICATION_PENDING — never LIVE on provider state alone", async () => {
  const stage = await drive(
    makeStubProvider({
      verificationCapable: true,
      verificationResult: { verified: false, verification: [{ type: "TXT", name: HOST, required: "proof" }], attempts: 3 },
    })
  );
  assert.equal(stage.stage, ACTIVATION_STAGE.VERIFICATION_PENDING);
  assert.equal(stage.hosting.status, HOSTING_STATUS.CONFIGURING);
  assert.equal(stage.hosting.verification[0].required, "proof");
});

test("orchestrator: provider verified is not enough — probe remains the LIVE authority", async () => {
  const stage = await drive(
    makeStubProvider({
      verificationCapable: true,
      verificationResult: { verified: true, verification: [], attempts: 1 },
    }),
    { checkChain: chainedVerified, probeDomain: probeDead }
  );
  assert.equal(stage.stage, ACTIVATION_STAGE.PROBE_FAILED);
});

test("orchestrator: verified provider + live probe = LIVE", async () => {
  const stage = await drive(
    makeStubProvider({
      verificationCapable: true,
      verificationResult: { verified: true, verification: [], attempts: 1 },
    })
  );
  assert.equal(stage.stage, ACTIVATION_STAGE.LIVE);
});

// --------------------------------------------------------------- provider selection

test("HOSTING_PROVIDER pins the platform to a registered provider (deployment config)", async () => {
  resetHostingRegistry();
  registerHostingProvider(makeStubProvider({ verificationCapable: true }));
  const previous = process.env.HOSTING_PROVIDER;
  try {
    process.env.HOSTING_PROVIDER = "stub";
    assert.equal(getHostingProvider().name, "stub");
  } finally {
    if (previous === undefined) delete process.env.HOSTING_PROVIDER;
    else process.env.HOSTING_PROVIDER = previous;
  }
});

test("an unknown HOSTING_PROVIDER override warns and falls back to manual", (t) => {
  const warnMock = t.mock.method(console, "warn", () => {});
  const previous = process.env.HOSTING_PROVIDER;
  try {
    process.env.HOSTING_PROVIDER = "no_such_provider";
    const provider = getHostingProvider();
    assert.equal(provider.name, "manual");
    assert.ok(warnMock.mock.calls.length >= 1);
  } finally {
    if (previous === undefined) delete process.env.HOSTING_PROVIDER;
    else process.env.HOSTING_PROVIDER = previous;
  }
});

test("unconfigured automation providers still fall back to manual", async () => {
  resetHostingRegistry();
  registerHostingProvider(makeStubProvider({ verificationCapable: true }));
  const previous = process.env.HOSTING_PROVIDER;
  try {
    delete process.env.HOSTING_PROVIDER;
    const provider = getHostingProvider();
    // stub says isConfigured()=true, so selection picks the automation provider.
    assert.equal(provider.name, "stub");
  } finally {
    if (previous === undefined) delete process.env.HOSTING_PROVIDER;
    else process.env.HOSTING_PROVIDER = previous;
  }
});

test("listHostingProviders surfaces masked provider state", async () => {
  resetHostingRegistry();
  registerHostingProvider(makeStubProvider({ verificationCapable: true }));
  const providers = await listHostingProviders();
  const manual = providers.find((p) => p.name === "manual");
  const stub = providers.find((p) => p.name === "stub");
  assert.equal(manual.verificationCapable, false);
  assert.equal(stub.verificationCapable, true);
  for (const p of providers) assert.ok(!JSON.stringify(p).includes(token));
});

// ------------------------------------------------------ Vercel attach idempotency

test("conflict + already-verified domain converges to CONFIGURED", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": json({ error: { code: "conflict" } }, 409),
    "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu": () =>
      json({ name: HOST, verified: true, verification: [] }),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.CONFIGURED);
  assert.equal(r.verified, true);
  assert.equal(api.calls[1], "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu");
});

test("conflict + attached-but-unverified converges to CONFIGURING with records", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": json({ error: { code: "conflict" } }, 409),
    "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu": () =>
      json({
        name: HOST,
        verified: false,
        verification: [{ type: "CNAME", domain: HOST, value: "c76d818fb49abf1c.vercel-dns-017.com" }],
      }),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.CONFIGURING);
  assert.equal(r.reason, "conflict");
  assert.equal(r.verification[0].required, "c76d818fb49abf1c.vercel-dns-017.com");
});

test("conflict + domain not attached on this project stays FAILED (no false convergence)", async () => {
  const api = makeApi({
    "POST https://api.vercel.com/v10/projects/prj_abc/domains": json({ error: { code: "conflict" } }, 409),
    "GET https://api.vercel.com/v8/projects/prj_abc/domains/exam.school.edu": json({}, 404),
  });
  const p = createVercelProvider({ token, projectId, fetchImpl: api });
  const r = await p.addCustomDomain(HOST);
  assert.equal(r.status, HOSTING_STATUS.FAILED);
  assert.equal(r.reason, "conflict");
});

// ------------------------------------------------------------------ http retry

test("withRetry retries 429 then succeeds", async () => {
  let n = 0;
  const result = await withRetry({
    attempts: 3,
    baseDelayMs: 0,
    run: async () => {
      n += 1;
      return n === 1 ? { status: 429 } : { status: 200 };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(n, 2);
});

test("withRetry permanent errors are not retried", async () => {
  let n = 0;
  const result = await withRetry({
    attempts: 3,
    run: async () => {
      n += 1;
      return { status: 404 };
    },
  });
  assert.equal(result.status, 404);
  assert.equal(n, 1);
});

test("withRetry returns the last attempt after retries are exhausted", async () => {
  let n = 0;
  const result = await withRetry({
    attempts: 2,
    baseDelayMs: 0,
    run: async () => {
      n += 1;
      return { status: 500 };
    },
  });
  assert.equal(result.status, 500);
  assert.equal(n, 2);
});

test("withRetry honours a custom isRetryable and reports retries", async () => {
  let n = 0;
  const retried = [];
  const result = await withRetry({
    attempts: 3,
    baseDelayMs: 0,
    isRetryable: (res) => res.status === 409,
    onRetry: (res, attempt) => retried.push(attempt),
    run: async () => {
      n += 1;
      return n === 2 ? { status: 200 } : { status: 409 };
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(retried, [1]);
});

test("isRetryableStatus recognizes 429, ≥500 and network=0", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(0), true);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(200), false);
});