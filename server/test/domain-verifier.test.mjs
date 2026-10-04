import test from "node:test";
import assert from "node:assert/strict";
import { createDomainVerifier, REASONS } from "../lib/domainVerifier.js";
import { makeVerifier } from "./helpers.mjs";

const PLATFORM_IPS = ["64.29.17.1", "216.198.79.1"];

const makeErroringVerifier = (failCname = true) =>
  createDomainVerifier({
    resolveCname: () =>
      failCname
        ? Promise.reject(Object.assign(new Error("servfail"), { code: "ESERVFAIL" }))
        : Promise.resolve([]),
    resolve4: () => Promise.reject(Object.assign(new Error("servfail"), { code: "ESERVFAIL" })),
    resolve6: () => Promise.resolve([]),
    fetch: () => Promise.reject(new Error("no fetch")),
    timeoutMs: 40,
    cnameTarget: "examos.avexora.in",
    platformDomains: ["avexora.in", "examos.avexora.in", "www.examos.avexora.in"],
    platformDomain: "avexora.in",
  });

test("correct CNAME through the platform target verifies", async () => {
  const v = makeVerifier({
    records: { cname: { "exam.school.edu": ["examos.avexora.in"] } },
  });
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.verified, true);
  assert.equal(r.record, "examos.avexora.in");
});

test("multi-hop CNAME chain terminating at the platform verifies", async () => {
  const v = makeVerifier({
    records: {
      cname: {
        "exam.school.edu": ["cdn.example.net"],
        "cdn.example.net": ["examos.avexora.in"],
      },
    },
  });
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.verified, true);
  assert.equal(r.record, "examos.avexora.in");
});

test("CNAME chain through a platform-owned host verifies", async () => {
  const v = makeVerifier({
    records: { cname: { "exam.school.edu": ["www.examos.avexora.in"] } },
  });
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.verified, true);
  assert.equal(r.record, "www.examos.avexora.in");
});

test("wrong CNAME is rejected even when IPs overlap (direct provider hostname)", async () => {
  // exam.school.edu -> cname.vercel-dns.com with A records identical to the
  // platform's. The chain exists but never traverses a platform-owned host, so
  // IP overlap must NOT make this pass — the architectural contract wins.
  const v = makeVerifier({
    records: {
      cname: { "exam.school.edu": ["cname.vercel-dns.com"] },
      a: { "cname.vercel-dns.com": PLATFORM_IPS, "examos.avexora.in": PLATFORM_IPS },
    },
  });
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.verified, false);
  assert.equal(r.reason, REASONS.DNS_TARGET_MISMATCH);
  assert.equal(r.record, "cname.vercel-dns.com");
});

test("CNAME to an unpinned third party is a mismatch", async () => {
  const v = makeVerifier({
    records: {
      cname: {
        "exam.school.edu": ["alias.example.net"],
        "alias.example.net": ["tenant.another-cdn.com"],
      },
    },
  });
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.verified, false);
  assert.equal(r.reason, REASONS.DNS_TARGET_MISMATCH);
});

test("NXDOMAIN host is DNS_NOT_FOUND", async () => {
  const v = makeVerifier({ records: { nxdomain: ["exam.school.edu"] } });
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.verified, false);
  assert.equal(r.reason, REASONS.DNS_NOT_FOUND);
});

test("SERVFAIL is DNS_REQUEST_FAILED", async () => {
  const v = makeErroringVerifier(true);
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.verified, false);
  assert.equal(r.reason, REASONS.DNS_REQUEST_FAILED);
});

test("DNS timeout is DNS_REQUEST_FAILED", async () => {
  const v = createDomainVerifier({
    resolveCname: () => new Promise(() => {}),
    resolve4: () => Promise.resolve([]),
    resolve6: () => Promise.resolve([]),
    fetch: () => Promise.reject(new Error("no fetch")),
    timeoutMs: 20,
    cnameTarget: "examos.avexora.in",
    platformDomains: ["avexora.in", "examos.avexora.in", "www.examos.avexora.in"],
    platformDomain: "avexora.in",
  });
  const r = await v.checkChain("exam.school.edu");
  assert.equal(r.reason, REASONS.DNS_REQUEST_FAILED);
});

test("CNAME loop terminates and never hangs", async () => {
  const v = makeVerifier({
    records: {
      cname: {
        "a.school.edu": ["b.school.edu"],
        "b.school.edu": ["a.school.edu"],
      },
    },
  });
  const r = await v.checkChain("a.school.edu");
  assert.equal(r.verified, false);
  assert.equal(r.reason, REASONS.DNS_TARGET_MISMATCH);
  assert.ok(r.chain.length < 10, "chain must be bounded");
});

test("runaway chain deeper than the limit is DNS_REQUEST_FAILED", async () => {
  const nodes = {};
  for (let i = 1; i < 12; i++) nodes[`h${i}.school.edu`] = [`h${i + 1}.school.edu`];
  const v = createDomainVerifier({
    resolveCname: (host) => (nodes[host] ? Promise.resolve(nodes[host]) : Promise.resolve([])),
    resolve4: () => Promise.resolve([]),
    resolve6: () => Promise.resolve([]),
    fetch: () => Promise.reject(new Error("no fetch")),
    timeoutMs: 40,
    cnameTarget: "examos.avexora.in",
    platformDomains: ["avexora.in", "examos.avexora.in", "www.examos.avexora.in"],
    platformDomain: "avexora.in",
  });
  const r = await v.checkChain("h1.school.edu");
  assert.equal(r.reason, REASONS.DNS_REQUEST_FAILED);
});

test("apex / CNAME-flattened host resolving to platform IPs verifies", async () => {
  const v = makeVerifier({
    records: {
      a: { "lpu.edu": PLATFORM_IPS, "examos.avexora.in": PLATFORM_IPS },
    },
  });
  const r = await v.checkChain("lpu.edu");
  assert.equal(r.verified, true);
  assert.equal(r.reason, null);
});

test("apex host resolving to unrelated IPs is a mismatch", async () => {
  const v = makeVerifier({
    records: {
      a: { "lpu.edu": ["93.184.216.34"], "examos.avexora.in": PLATFORM_IPS },
    },
  });
  const r = await v.checkChain("lpu.edu");
  assert.equal(r.verified, false);
  assert.equal(r.reason, REASONS.DNS_TARGET_MISMATCH);
});

test("existing host with no CNAME and no A records is DNS_NOT_FOUND", async () => {
  const v = makeVerifier({ records: {} });
  const r = await v.checkChain("empty.school.edu");
  assert.equal(r.verified, false);
  assert.equal(r.reason, REASONS.DNS_NOT_FOUND);
});