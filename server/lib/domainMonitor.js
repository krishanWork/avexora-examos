// Domain monitor (Phase 3) — detect + record + alert. It is intentionally
// NON-DESTRUCTIVE: it never attaches, detaches, redeploys or rewrites DNS. It
// only re-runs the Phase 1 checks (DNS chain + LIVE identity probe) and:
//   - records the observed dns/tls status on the tenant document
//   - degrades a LIVE domain back to verified when its checks fail
//   - restores it to LIVE when it recovers (only if the monitor degraded it)
//   - alerts the recipients (via the injected notify callback) on the
//     LIVE -> degraded transition, at most once per problem
//
// The Phase 1 evaluator remains the only authority; hosting providers are never
// consulted here, so a monitoring incident can never auto-detach a working
// Vercel domain.

import crypto from "node:crypto";
import { REASONS, humanReason } from "./domainVerifier.js";
import { normalizeHost } from "../../shared/custom-domain.js";

const DEFAULT_OPTS = Object.freeze({
  scanLimit: 80, // candidates fetched per run (cooldown skips are applied after)
  perRunProbeLimit: 40, // max tenants actually probed per run
  degradeAfterFails: 2, // consecutive probe failures before LIVE degrades
  liveCooldownMs: 15 * 60 * 1000,
  degradedCooldownMs: 5 * 60 * 1000,
  maxIssues: 10,
  leaseMs: 15 * 60 * 1000, // max legitimate runtime is well below this (40 probes × ~8s)
});

// Constant-time comparison for the cron route's CRON_SECRET guard. Fails closed:
// unset secret or structurally-invalid header values never match.
export const verifyCronToken = (secret, header) => {
  if (!secret || typeof header !== "string" || header.length === 0) return false;
  const a = Buffer.from(String(secret));
  const b = Buffer.from(header);
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const toIso = (d) => (d ? new Date(d).toISOString() : "");
const ageMs = (iso, now) => (iso ? now.getTime() - new Date(iso).getTime() : Infinity);

// Builds an alert email (subject/text/html) from a monitor change event.
export const buildDomainAlert = ({ change, cnameTarget = "examos.avexora.in", baseUrl = "" }) => {
  const problems = (change.problems || [])
    .map((p) => `- ${p.human}${p.code ? ` (${p.code})` : ""}${p.detail ? ` — ${p.detail}` : ""}`)
    .join("\n");
  const subject = `[ExamOS] Custom domain problem: ${change.host}`;
  const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const text = [
    `The custom domain for "${change.tenantName || "a tenant"}" has a problem.`,
    "",
    `Domain:    ${change.host}`,
    `Status:    ${change.from.status || "—"} → ${change.to.status || "—"}`,
    `DNS:       ${change.from.dns_status || "—"} → ${change.to.dns_status || "—"}`,
    `TLS:       ${change.from.tls_status || "—"} → ${change.to.tls_status || "—"}`,
    `Detected:  ${toIso(change.detected_at)}, UTC`,
    "",
    problems,
    "",
    `Fix: verify the CNAME for ${change.host} points to ${cnameTarget}, the TLS certificate is valid, and the domain is attached to the platform hosting. Re-activate the domain once restored.`,
    baseUrl ? `\nOpen domain management: ${baseUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<!doctype html>
<html><body bgcolor="#f8fafc" style="margin:0;padding:24px">
  <table role="presentation" width="100%"><tr><td bgcolor="#ffffff" style="border:1px solid #e2e8f0;border-radius:12px;padding:24px;font-family:Arial,sans-serif">
    <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a">⚠ Custom domain needs attention</h2>
    <p style="color:#334155">The custom domain for <strong>${esc(change.tenantName || "a tenant")}</strong> is no longer healthy.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Domain</td><td><code>${esc(change.host)}</code></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Status</td><td>${esc(change.from.status || "—")} → ${esc(change.to.status || "—")}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">DNS</td><td>${esc(change.from.dns_status || "—")} → ${esc(change.to.dns_status || "—")}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">TLS</td><td>${esc(change.from.tls_status || "—")} → ${esc(change.to.tls_status || "—")}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Detected</td><td>${esc(toIso(change.detected_at))} UTC</td></tr>
    </table>
    <pre style="background:#f1f5f9;border-radius:8px;padding:12px;color:#334155;white-space:pre-wrap">${esc(problems)}</pre>
    <p style="color:#334155">Verify the CNAME for ${esc(change.host)} points to <code>${esc(cnameTarget)}</code>, the TLS certificate is valid, and the domain is attached to the platform hosting. Re-activate the domain once restored.</p>
    ${baseUrl ? `<p><a href="${esc(baseUrl)}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open Domain Management</a></p>` : ""}
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
};

export const createDomainMonitor = ({
  verifier,
  listTenants = async () => [],
  updateTenant = async () => {},
  notify = async () => ({}),
  audit = async () => {},
  // Coordination: concurrent cron/manual runs share a run lease. The default is
  // an acquire-always no-op so tests stay single-threaded. Fail closed: when
  // acquireLease() throws, the run must NOT proceed uncoordinated.
  acquireLease = async () => ({ acquired: true }),
  releaseLease = async () => {},
  nowIs = null, // injectable clock for tests; defaults to "right now" each run
  opts = {},
} = {}) => {
  const cfg = { ...DEFAULT_OPTS, ...opts };

  const run = async ({ force = false } = {}) => {
    const now = nowIs ? (nowIs instanceof Date ? nowIs : new Date(nowIs)) : new Date();

    const lease = await acquireLease({ now }).catch((err) => ({
      acquired: false,
      error: err?.message || "lease acquisition failed",
    }));
    if (!lease.acquired) {
      // Locked by another run, or DB unavailable. Never proceed without a lease.
      return {
        candidates: 0,
        skipped: 0,
        checked: 0,
        problems: 0,
        alerts: 0,
        degraded: [],
        updated: [],
        executed: false,
        skipped_reason: lease.error ? "lease_error" : "locked",
        error: lease.error || "another monitor run is in progress",
      };
    }

    const summary = {
      candidates: 0,
      skipped: 0,
      checked: 0,
      problems: 0,
      alerts: 0,
      degraded: [],
      updated: [],
      executed: true,
      lease_ms: cfg.leaseMs,
    };

    try {
      const tenants = await listTenants({ sort: { custom_domain_checked_at: 1 }, limit: cfg.scanLimit }).catch((err) => {
        summary.error = err?.message || "listing tenants failed";
        return [];
      });
      summary.candidates = tenants.length;

      let probed = 0;
      for (const tenant of tenants) {
        if (probed >= cfg.perRunProbeLimit) {
          summary.skipped += 1;
          continue;
        }
        const host = normalizeHost(tenant.custom_domain);
        if (!host || tenant.status === "suspended") {
          summary.skipped += 1;
          continue;
        }

      const checkedAt = toIso(now);
        const prev = {
          status: tenant.custom_domain_status || "pending",
          dns_status: tenant.dns_status || "pending",
          tls_status: tenant.tls_status || "pending",
          degraded: Boolean(tenant.domain_degraded),
        };
        const cooldownMs = prev.status === "live" ? cfg.liveCooldownMs : cfg.degradedCooldownMs;
        if (!force && ageMs(tenant.custom_domain_checked_at, now) < cooldownMs) {
          summary.skipped += 1;
          continue;
        }

        probed += 1;
        summary.checked += 1;

        const change = {
          host,
          tenantName: tenant.name || tenant.full_name || "",
          tenantId: String(tenant._id),
          from: prev,
          to: { ...prev },
          problems: [],
          degraded: false,
          detected_at: toIso(now),
        };

        let dns, probe;
        try {
          dns = await verifier.checkChain(host);
        } catch (err) {
          summary.error = err?.message || "checkChain failed";
          continue;
        }

        change.to.dns_status = dns.verified ? "verified" : "failed";

        if (!dns.verified) {
          change.problems.push({
            code: dns.reason,
            human: humanReason(dns.reason),
            detail: dns.record ? `found: ${dns.record}` : "no valid CNAME chain",
          });
          change.to.tls_status = "pending"; // TLS cannot be verified without DNS
        } else {
          try {
            probe = await verifier.probeDomain(host);
          } catch (err) {
            summary.error = err?.message || "probeDomain failed";
            continue;
          }
          change.to.tls_status = probe.live
            ? "ready"
            : probe.reason === REASONS.TLS_FAILED
              ? "failed"
              : "pending";
          if (!probe.live) {
            change.problems.push({
              code: probe.reason,
              human: humanReason(probe.reason),
              detail: probe.reachable ? "reachable but EXAM OS identity/tls failed" : "app not reachable",
            });
          }
        }

        const failing = change.problems.length > 0;
        const failCount = (Number(tenant.domain_fail_count) || 0) + (failing ? 1 : 0);
        const issues = Array.isArray(tenant.domain_issues) ? [...tenant.domain_issues] : [];
        const isProbeFailure = dns.verified;
        const shouldDegradeNow =
          failing &&
          prev.status === "live" &&
          (!isProbeFailure || failCount >= cfg.degradeAfterFails);
        const recovering =
          !failing && prev.status === "verified" && prev.degraded && change.to.dns_status === "verified";

        const $set = {
          dns_status: change.to.dns_status,
          tls_status: change.to.tls_status,
          custom_domain_checked_at: checkedAt,
          updated_date: checkedAt,
          domain_fail_count: failing ? failCount : 0,
        };

        if (shouldDegradeNow) {
          change.degraded = true;
          change.to.status = "verified";
          $set.domain_degraded = true;
          $set.custom_domain_status = "verified";
          $set.custom_domain_live_at = null;
          if (tenant.custom_domain_live_at) $set.domain_last_live_at = tenant.custom_domain_live_at;
          const nextIssue = {
            code: change.problems[0].code,
            human: change.problems[0].human,
            detail: change.problems[0].detail,
            detected_at: checkedAt,
          };
          $set.domain_issues = [...issues.filter((i) => i.code !== nextIssue.code), nextIssue].slice(-cfg.maxIssues);
          summary.degraded.push(host);
          summary.problems += 1;
          await updateTenant(tenant._id, $set).catch(() => {});
          summary.updated.push(host);
          await notify(tenant, change).catch(() => {});
          summary.alerts += 1;
          await audit(tenant, change).catch(() => {});
          continue;
        }

        if (recovering) {
          change.to.status = "live";
          change.to.tls_status = "ready";
          $set.domain_degraded = false;
          $set.custom_domain_status = "live";
          $set.custom_domain_live_at = toIso(now);
          $set.domain_issues = [];
          await updateTenant(tenant._id, $set).catch(() => {});
          summary.updated.push(host);
          await audit(tenant, change).catch(() => {});
          continue;
        }

        // No state transition: still record the observed DNS/TLS fields so the
        // tenant document always reflects the latest measurements.
        await updateTenant(tenant._id, $set).catch(() => {});
      }
    } catch (err) {
      summary.error = err?.message || "monitor run failed";
    } finally {
      try {
        await releaseLease(summary);
      } catch (err) {
        // The run already completed; the lease lapses naturally via its expiry.
        summary.history_warning = err?.message || "failed to record run history";
      }
    }

    return summary;
  };

  return run;
};