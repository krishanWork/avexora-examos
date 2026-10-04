import { test } from "node:test";
import assert from "node:assert/strict";

import { createDomainMonitor, buildDomainAlert, verifyCronToken } from "../lib/domainMonitor.js";
import { REASONS } from "../lib/domainVerifier.js";

const NOW = new Date("2026-01-01T00:00:00Z");

const mkTenant = (over = {}) => ({
  _id: "t1",
  name: "Test School",
  custom_domain: "exam.school.edu",
  custom_domain_status: "live",
  dns_status: "verified",
  tls_status: "ready",
  domain_fail_count: 0,
  custom_domain_checked_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
  ...over,
});

const chainedOk = (over = {}) => ({ verified: true, reason: null, record: null, ...over });
const probeOk = (over = {}) => ({ live: true, reason: null, reachable: true, ...over });

const mkVerifier = ({ chain = chainedOk(), probe = probeOk() } = {}) => ({
  checkChain: async () => chain,
  probeDomain: async () => probe,
});

const harness = (tenants, verifier) => {
  const updates = [];
  const notifications = [];
  const audits = [];
  const monitor = createDomainMonitor({
    verifier,
    listTenants: async () => tenants,
    updateTenant: async (id, $set) => updates.push({ id, $set }),
    notify: async (t, c) => {
      notifications.push({ id: String(t._id), change: c });
      return { delivered: 1 };
    },
    audit: async (t, c) => audits.push(c),
    nowIs: NOW,
    opts: { liveCooldownMs: 0, degradedCooldownMs: 0, degradeAfterFails: 2 },
  });
  return { monitor, updates, notifications, audits };
};

test("no tenants produces an empty summary", async () => {
  const { monitor } = harness([], mkVerifier());
  const s = await monitor({});
  assert.equal(s.candidates, 0);
  assert.equal(s.checked, 0);
});

test("healthy live domain stays live and publishes no alert", async () => {
  const { monitor, updates, notifications } = harness([mkTenant()], mkVerifier());
  const s = await monitor({});
  assert.equal(s.checked, 1);
  assert.equal(s.problems, 0);
  assert.equal(notifications.length, 0);
  const write = updates[0].$set;
  assert.equal(write.custom_domain_status, undefined);
  assert.equal(write.dns_status, "verified");
  assert.equal(write.tls_status, "ready");
  assert.equal(write.domain_fail_count, 0);
});

test("DNS chain failure degrades LIVE immediately and alerts", async () => {
  const tenant = mkTenant({ custom_domain_live_at: "2025-12-25T00:00:00Z" });
  const verifier = mkVerifier({
    chain: chainedOk({ verified: false, reason: "dns_target_mismatch", record: "other.example" }),
  });
  const { monitor, updates, notifications, audits } = harness([tenant], verifier);
  const s = await monitor({});
  assert.equal(s.problems, 1);
  assert.deepEqual(s.degraded, ["exam.school.edu"]);
  assert.equal(notifications.length, 1);
  assert.equal(audits.length, 1);
  const write = updates[0].$set;
  assert.equal(write.custom_domain_status, "verified");
  assert.equal(write.dns_status, "failed");
  assert.equal(write.tls_status, "pending");
  assert.equal(write.domain_degraded, true);
  assert.equal(write.custom_domain_live_at, null);
  assert.equal(write.domain_last_live_at, "2025-12-25T00:00:00Z");
  assert.equal(write.domain_issues[0].code, "dns_target_mismatch");
});

test("probe failure degrades only after consecutive failures", async () => {
  const probeFail = probeOk({ live: false, reason: "app_not_reachable", reachable: false });
  const first = harness([mkTenant()], mkVerifier({ probe: probeFail }));
  const s1 = await first.monitor({});
  assert.equal(s1.alerts, 0);
  assert.equal(first.updates[0].$set.domain_fail_count, 1);
  assert.equal(first.updates[0].$set.custom_domain_status, undefined); // still live

  // Second consecutive failure triggers the degrade + alert.
  const second = harness([mkTenant({ domain_fail_count: 1 })], mkVerifier({ probe: probeFail }));
  const s2 = await second.monitor({});
  assert.equal(s2.alerts, 1);
  assert.equal(second.updates[0].$set.custom_domain_status, "verified");
  assert.equal(second.updates[0].$set.domain_fail_count, 2);
});

test("recovery: a monitor-degraded domain that passes again is restored to LIVE", async () => {
  const tenant = mkTenant({
    custom_domain_status: "verified",
    domain_degraded: true,
    domain_fail_count: 2,
    domain_issues: [{ code: "app_not_reachable", detected_at: "2025-12-31T00:00:00Z" }],
    domain_last_live_at: "2025-12-30T00:00:00Z",
  });
  const { monitor, updates, notifications, audits } = harness([tenant], mkVerifier());
  const s = await monitor({});
  assert.equal(s.problems, 0);
  assert.equal(notifications.length, 0);
  const write = updates[0].$set;
  assert.equal(write.custom_domain_status, "live");
  assert.equal(write.domain_degraded, false);
  assert.equal(write.domain_issues.length, 0);
  assert.equal(write.domain_fail_count, 0);
  assert.ok(write.custom_domain_live_at);
  assert.equal(audits[0].to.status, "live");
});

test("a verified (never-live) tenant is recorded but never auto-promoted or alerted", async () => {
  const tenant = mkTenant({ custom_domain_status: "verified", domain_degraded: false });
  const verifier = mkVerifier({ probe: probeOk({ live: false, reason: "app_identity_failed", reachable: true }) });
  const { monitor, updates, notifications } = harness([tenant], verifier);
  await monitor({});
  assert.equal(notifications.length, 0);
  const write = updates[0].$set;
  assert.equal(write.custom_domain_status, undefined);
  assert.equal(write.tls_status, "pending");
  assert.equal(write.dns_status, "verified");
});

test("cooldown skips tenants checked recently", async () => {
  const fresh = mkTenant({ custom_domain_checked_at: NOW.toISOString() });
  const cooldown = createDomainMonitor({
    verifier: mkVerifier(),
    listTenants: async () => [fresh],
    updateTenant: async () => {
      throw new Error("should not write during cooldown");
    },
    nowIs: NOW,
    opts: { liveCooldownMs: 60 * 60 * 1000, degradedCooldownMs: 0 },
  });
  const s = await cooldown({});
  assert.equal(s.skipped, 1);
  assert.equal(s.checked, 0);
});

test("per-run probe limit is respected", async () => {
  const tenants = [1, 2, 3].map((n) =>
    mkTenant({ _id: `t${n}`, custom_domain: `exam${n}.school.edu`, name: `School ${n}` })
  );
  const updates = [];
  const monitor = createDomainMonitor({
    verifier: mkVerifier(),
    listTenants: async () => tenants,
    updateTenant: async (id, $set) => updates.push({ id, $set }),
    nowIs: NOW,
    opts: { liveCooldownMs: 0, degradedCooldownMs: 0, perRunProbeLimit: 1 },
  });
  const s = await monitor({});
  assert.equal(s.checked, 1);
  assert.equal(s.skipped, 2);
  assert.equal(updates.length, 1);
});

test("monitor survives a throwing verifier", async () => {
  const verifier = {
    checkChain: async () => {
      throw new Error("dns broken");
    },
  };
  const { monitor } = harness([mkTenant()], verifier);
  const s = await monitor({});
  assert.match(s.error, /dns broken/);
});

test("buildDomainAlert renders subject, host, target and states", () => {
  const change = {
    host: "exam.school.edu",
    tenantName: "Test School",
    from: { status: "live", dns_status: "verified", tls_status: "ready" },
    to: { status: "verified", dns_status: "failed", tls_status: "pending" },
    problems: [{ human: "DNS target mismatch", code: "dns_target_mismatch", detail: "found: other.example" }],
    detected_at: NOW.toISOString(),
  };
  const { subject, text, html } = buildDomainAlert({ change, cnameTarget: "examos.avexora.in", baseUrl: "https://app.examos.com" });
  assert.match(subject, /exam\.school\.edu/);
  assert.match(text, /examos\.avexora\.in/);
  assert.match(text, /dns_target_mismatch/);
  assert.match(html, /app\.examos\.com/);
  assert.match(html, /DNS target mismatch/);
});

test("an already-degraded domain never re-alerts on the same problem", async () => {
  const tenant = mkTenant({
    custom_domain_status: "verified",
    domain_degraded: true,
    domain_fail_count: 1,
    domain_issues: [{ code: "dns_target_mismatch", human: "DNS target mismatch", detected_at: "2025-12-31T00:00:00Z" }],
  });
  const verifier = mkVerifier({ chain: chainedOk({ verified: false, reason: "dns_target_mismatch", record: "other.example" }) });
  const { monitor, notifications } = harness([tenant], verifier);
  const s = await monitor({});
  assert.equal(s.alerts, 0);
  assert.equal(notifications.length, 0);
});

// --- Phase 4: lease coordination ------------------------------------------------

test("a run that acquires the lease executes and releases it with its summary", async () => {
  const released = [];
  const monitor = createDomainMonitor({
    verifier: mkVerifier(),
    listTenants: async () => [mkTenant()],
    acquireLease: async () => ({ acquired: true }),
    releaseLease: async (summary) => released.push(summary),
    nowIs: NOW,
  });
  const s = await monitor({});
  assert.equal(s.executed, true);
  assert.equal(released.length, 1);
  assert.equal(released[0].checked, 1);
  assert.equal(released[0].lease_ms, 15 * 60 * 1000);
});

test("a locked lease skips the run without consulting the verifier", async () => {
  let probes = 0;
  const monitor = createDomainMonitor({
    verifier: {
      checkChain: async () => {
        probes += 1;
        return chainedOk();
      },
      probeDomain: async () => {
        probes += 1;
        return probeOk();
      },
    },
    listTenants: async () => [mkTenant()],
    acquireLease: async () => ({ acquired: false }),
    nowIs: NOW,
  });
  const s = await monitor({});
  assert.equal(s.executed, false);
  assert.equal(s.skipped_reason, "locked");
  assert.match(s.error, /in progress/);
  assert.equal(probes, 0);
});

test("a lease acquisition failure fails safely and visibly (never runs uncoordinated)", async () => {
  let probes = 0;
  const monitor = createDomainMonitor({
    verifier: {
      checkChain: async () => {
        probes += 1;
        return chainedOk();
      },
    },
    listTenants: async () => [mkTenant()],
    acquireLease: async () => {
      throw new Error("db down");
    },
    nowIs: NOW,
  });
  const s = await monitor({});
  assert.equal(s.executed, false);
  assert.equal(s.skipped_reason, "lease_error");
  assert.match(s.error, /db down/);
  assert.equal(probes, 0);
});

test("releaseLease persists the run summary even when verification throws", async () => {
  const released = [];
  const monitor = createDomainMonitor({
    verifier: {
      checkChain: async () => {
        throw new Error("verifier exploded");
      },
    },
    listTenants: async () => [mkTenant()],
    acquireLease: async () => ({ acquired: true }),
    releaseLease: async (summary) => released.push(summary),
    nowIs: NOW,
  });
  const s = await monitor({});
  assert.equal(released.length, 1);
  assert.match(s.error, /verifier exploded/);
  assert.equal(released[0].checked, 1);
});

test("releaseLease failures surface as a history warning, not a crash", async () => {
  const monitor = createDomainMonitor({
    verifier: mkVerifier(),
    listTenants: async () => [mkTenant()],
    acquireLease: async () => ({ acquired: true }),
    releaseLease: async () => {
      throw new Error("history write failed");
    },
    nowIs: NOW,
  });
  const s = await monitor({});
  assert.equal(s.executed, true);
  assert.match(s.history_warning, /history write failed/);
});

// --- Phase 4: cron token guard ---------------------------------------------------

test("verifyCronToken accepts only an exact constant-time match", () => {
  const secret = "01234567-89ab-cdef-0123-456789abcdef";
  assert.equal(verifyCronToken(secret, secret), true);
  assert.equal(verifyCronToken(secret, "01234567-89ab-cdef-0123-456789abcdeg"), false);
  assert.equal(verifyCronToken(secret, ""), false);
  assert.equal(verifyCronToken(secret, undefined), false);
  assert.equal(verifyCronToken(secret, "short"), false);
  assert.equal(verifyCronToken("", secret), false);
  assert.equal(verifyCronToken(undefined, secret), false);
});

// --- Phase 4: transition sequences ---------------------------------------------

test("full sequence: degrade, stay degraded, recover, re-degrade — at most one alert per transition", async () => {
  const badDns = mkVerifier({ chain: chainedOk({ verified: false, reason: "dns_target_mismatch", record: "other.example" }) });
  const good = mkVerifier();

  const r1 = harness([mkTenant({ _id: "t1", custom_domain_live_at: "2025-12-25T00:00:00Z" })], badDns);
  const s1 = await r1.monitor({});
  assert.equal(s1.alerts, 1);
  assert.equal(r1.notifications.length, 1);

  const degraded = mkTenant({
    _id: "t1",
    custom_domain_status: "verified",
    domain_degraded: true,
    domain_fail_count: 1,
    domain_issues: [{ code: "dns_target_mismatch", human: "DNS target mismatch", detected_at: "2025-12-31T00:00:00Z" }],
  });
  const r2 = harness([degraded], badDns);
  const s2 = await r2.monitor({});
  assert.equal(s2.alerts, 0);
  assert.equal(r2.notifications.length, 0);

  const r3 = harness([degraded], good);
  const s3 = await r3.monitor({});
  assert.equal(s3.problems, 0);
  assert.equal(s3.alerts, 0);
  assert.equal(r3.notifications.length, 0);
  assert.equal(r3.updates[0].$set.custom_domain_status, "live");

  const recovered = mkTenant({
    _id: "t1",
    custom_domain_status: "live",
    domain_degraded: false,
    domain_fail_count: 0,
    domain_issues: [],
    custom_domain_live_at: "2026-01-01T00:00:00Z",
  });
  const r4 = harness([recovered], badDns);
  const s4 = await r4.monitor({});
  assert.equal(s4.alerts, 1);
  assert.equal(r4.notifications.length, 1);
});

test("suspended tenants are never probed or alerted", async () => {
  let probes = 0;
  const monitor = createDomainMonitor({
    verifier: {
      checkChain: async () => {
        probes += 1;
        return chainedOk();
      },
    },
    listTenants: async () => [mkTenant({ status: "suspended" })],
    nowIs: NOW,
  });
  const s = await monitor({});
  assert.equal(s.skipped, 1);
  assert.equal(probes, 0);
});

test("TLS failure is recorded immediately and degrades only after consecutive failures", async () => {
  const tlsFail = probeOk({ live: false, reason: REASONS.TLS_FAILED, reachable: true });
  const r1 = harness([mkTenant()], mkVerifier({ probe: tlsFail }));
  const s1 = await r1.monitor({});
  assert.equal(s1.alerts, 0);
  assert.equal(r1.updates[0].$set.tls_status, "failed");
  assert.equal(r1.updates[0].$set.domain_fail_count, 1);

  const r2 = harness([mkTenant({ domain_fail_count: 1 })], mkVerifier({ probe: tlsFail }));
  const s2 = await r2.monitor({});
  assert.equal(s2.alerts, 1);
  assert.equal(r2.notifications[0].change.to.tls_status, "failed");
  assert.equal(r2.updates[0].$set.tls_status, "failed");
});

test("a verified tenant stuck in hosting 'configuring' is never promoted or alerted", async () => {
  const tenant = mkTenant({
    custom_domain_status: "verified",
    hosting_status: "configuring",
    domain_degraded: false,
  });
  const r = harness([tenant], mkVerifier({ probe: probeOk({ live: false, reason: "app_identity_failed", reachable: true }) }));
  const s = await r.monitor({});
  assert.equal(s.alerts, 0);
  assert.equal(r.notifications.length, 0);
  assert.equal(r.updates[0].$set.custom_domain_status, undefined);
  assert.equal(r.updates[0].$set.hosting_status, undefined);
});