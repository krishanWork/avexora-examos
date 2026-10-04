import { test } from "node:test";
import assert from "node:assert/strict";

import { runCustomDomainActivation, ACTIVATION_STAGE } from "../lib/activationOrchestrator.js";
import { HOSTING_STATUS } from "../lib/hosting.js";

const HOST = "exam.school.edu";

const makeFakeVerifier = ({ chainVerified = true, live = true, reason = null } = {}) => {
  const calls = [];
  return {
    calls,
    checkChain: async () => {
      calls.push("checkChain");
      return { verified: chainVerified, reason: chainVerified ? null : "dns_mismatch", record: null };
    },
    probeDomain: async () => {
      calls.push("probeDomain");
      return { live, reason, tls: live ? "valid" : false, reachable: true };
    },
  };
};

const makeFakeHosting = ({ addResult, verificationCapable = true, waitResult = { verified: true, verification: [] }, name = "fake" }) => {
  const calls = [];
  return {
    name,
    verificationCapable,
    calls,
    addCustomDomain: async (host) => {
      calls.push(["add", host]);
      return addResult;
    },
    waitUntilVerified: async (host) => {
      calls.push(["wait", host]);
      return waitResult;
    },
  };
};

const pendingRecords = [{ type: "CNAME", required: "still-needed.example" }];

test("DNS gate: a failed chain stops before any hosting call", async () => {
  const verifier = makeFakeVerifier({ chainVerified: false });
  const hosting = makeFakeHosting({ addResult: { implemented: true, status: HOSTING_STATUS.CONFIGURED } });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.DNS_FAILED);
  assert.deepEqual(hosting.calls, []);
  assert.deepEqual(verifier.calls, ["checkChain"]);
});

test("manual provider: probe decides, live -> LIVE", async () => {
  const verifier = makeFakeVerifier({ live: true });
  const hosting = makeFakeHosting({ addResult: { implemented: false, status: HOSTING_STATUS.NOT_CONFIGURED } });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.LIVE);
  assert.deepEqual(hosting.calls, [["add", HOST]]);
  assert.deepEqual(verifier.calls, ["checkChain", "probeDomain"]);
});

test("manual provider: probe decides, not live -> PROBE_FAILED", async () => {
  const verifier = makeFakeVerifier({ live: false, reason: "app_not_reachable" });
  const hosting = makeFakeHosting({ addResult: { implemented: false, status: HOSTING_STATUS.NOT_CONFIGURED } });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.PROBE_FAILED);
  assert.equal(d.probe.reason, "app_not_reachable");
});

test("hosting failure: clear error, LIVE probe is never reached", async () => {
  const verifier = makeFakeVerifier();
  const hosting = makeFakeHosting({
    addResult: { implemented: true, status: HOSTING_STATUS.FAILED, reason: "rate_limited", message: "rate limited" },
  });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.HOSTING_FAILED);
  assert.deepEqual(verifier.calls, ["checkChain"]);
  assert.equal(d.hosting.status, HOSTING_STATUS.FAILED);
});

test("attach already verified skips the polling wait and probes immediately", async () => {
  const verifier = makeFakeVerifier({ live: true });
  const hosting = makeFakeHosting({
    addResult: { implemented: true, status: HOSTING_STATUS.CONFIGURED, verified: true, verification: [] },
  });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.LIVE);
  assert.deepEqual(hosting.calls, [["add", HOST]]);
});

test("verification pending: attached but unverified keeps the domain VERIFIED with records", async () => {
  const verifier = makeFakeVerifier();
  const hosting = makeFakeHosting({
    addResult: { implemented: true, status: HOSTING_STATUS.CONFIGURING, verified: false, verification: pendingRecords },
    waitResult: { verified: false, verification: pendingRecords, attempts: 3 },
  });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.VERIFICATION_PENDING);
  assert.deepEqual(verifier.calls, ["checkChain"]);
  assert.deepEqual(hosting.calls, [["add", HOST], ["wait", HOST]]);
  assert.equal(d.hosting.verification[0].required, "still-needed.example");
  assert.equal(d.hosting.status, HOSTING_STATUS.CONFIGURING);
});

test("vercel flow: attach -> verified -> probe live -> LIVE", async () => {
  const verifier = makeFakeVerifier({ live: true });
  const hosting = makeFakeHosting({
    addResult: { implemented: true, status: HOSTING_STATUS.CONFIGURING, verified: false, verification: [] },
    waitResult: { verified: true, verification: [], attempts: 2 },
  });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.LIVE);
  assert.deepEqual(verifier.calls, ["checkChain", "probeDomain"]);
  assert.equal(d.hosting.status, HOSTING_STATUS.CONFIGURED);
});

test("vercel flow: verified on hosting but probe fails -> PROBE_FAILED (probe is the authority)", async () => {
  const verifier = makeFakeVerifier({ live: false, reason: "app_identity_failed" });
  const hosting = makeFakeHosting({
    addResult: { implemented: true, status: HOSTING_STATUS.CONFIGURING, verified: false, verification: [] },
    waitResult: { verified: true, verification: [], attempts: 1 },
  });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.PROBE_FAILED);
  assert.equal(d.hosting.status, HOSTING_STATUS.CONFIGURED);
  assert.equal(d.probe.reason, "app_identity_failed");
});

test("provider not verification-capable still probes after a configured attach", async () => {
  const verifier = makeFakeVerifier({ live: true });
  const hosting = makeFakeHosting({
    verificationCapable: false,
    addResult: { implemented: true, status: HOSTING_STATUS.CONFIGURED, verified: true, verification: [] },
  });
  const d = await runCustomDomainActivation({ verifier, hosting, host: HOST });
  assert.equal(d.stage, ACTIVATION_STAGE.LIVE);
  assert.deepEqual(verifier.calls, ["checkChain", "probeDomain"]);
  assert.ok(!hosting.calls.some(([c]) => c === "wait"));
});