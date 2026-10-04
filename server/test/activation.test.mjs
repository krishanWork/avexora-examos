import test from "node:test";
import assert from "node:assert/strict";
import { REASONS } from "../lib/domainVerifier.js";
import { makeVerifier, examosFetch, indexResponse, healthResponse, tlsFailureFetch, OTHER_APP_HTML } from "./helpers.mjs";

test("activation: DNS valid + EXAM OS live -> verified with live probe", async () => {
  const v = makeVerifier({
    records: {
      cname: { "exam.school.edu": ["examos.avexora.in"] },
      a: { "exam.school.edu": ["64.29.17.1"], "examos.avexora.in": ["64.29.17.1"] },
    },
    fetch: examosFetch(),
  });
  const d = await v.evaluateActivation("exam.school.edu");
  assert.equal(d.verified, true);
  assert.equal(d.probe.live, true);
});

test("activation: DNS invalid -> rejected before any live probe", async () => {
  const v = makeVerifier({ records: { nxdomain: ["exam.school.edu"] }, fetch: examosFetch() });
  const d = await v.evaluateActivation("exam.school.edu");
  assert.equal(d.verified, false);
  assert.equal(d.dns.reason, REASONS.DNS_NOT_FOUND);
  assert.equal(d.probe, null);
});

test("activation: DNS valid but wrong application -> live rejected", async () => {
  const v = makeVerifier({
    records: {
      cname: { "exam.school.edu": ["examos.avexora.in"] },
      a: { "exam.school.edu": ["64.29.17.1"] },
    },
    fetch: examosFetch({ "https://exam.school.edu/": indexResponse(OTHER_APP_HTML) }),
  });
  const d = await v.evaluateActivation("exam.school.edu");
  assert.equal(d.verified, true);
  assert.equal(d.probe.live, false);
  assert.equal(d.probe.reason, REASONS.APP_IDENTITY_FAILED);
});

test("activation: DNS valid but TLS invalid -> live rejected", async () => {
  const v = makeVerifier({
    records: {
      cname: { "exam.school.edu": ["examos.avexora.in"] },
      a: { "exam.school.edu": ["64.29.17.1"] },
    },
    fetch: tlsFailureFetch(),
  });
  const d = await v.evaluateActivation("exam.school.edu");
  assert.equal(d.verified, true);
  assert.equal(d.probe.live, false);
  assert.equal(d.probe.reason, REASONS.TLS_FAILED);
});

test("activation: stale verified flag is never trusted (DNS now broken)", async () => {
  const v = makeVerifier({
    records: { cname: { "exam.school.edu": ["something-else.example.com"] } },
    fetch: examosFetch(),
  });
  const d = await v.evaluateActivation("exam.school.edu");
  assert.equal(d.verified, false);
  assert.equal(d.dns.reason, REASONS.DNS_TARGET_MISMATCH);
});