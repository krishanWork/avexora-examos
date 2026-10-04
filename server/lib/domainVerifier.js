// Custom-domain verification pipeline. Provider-agnostic: it only reasons about
// DNS records, TLS and the app's own identity markers — never about Vercel, AWS
// or any hosting vendor.
//
// All DNS and network access is performed through injected callbacks so unit
// tests run fully mocked (no production DNS/network calls in tests).

import dns from "node:dns";
import { normalizeHost, classifyHost, isPrivateIp } from "../../shared/custom-domain.js";

export const REASONS = Object.freeze({
  DNS_NOT_FOUND: "DNS_NOT_FOUND",
  DNS_TARGET_MISMATCH: "DNS_TARGET_MISMATCH",
  DNS_REQUEST_FAILED: "DNS_REQUEST_FAILED",
  SSRF_BLOCKED: "SSRF_BLOCKED",
  TLS_FAILED: "TLS_FAILED",
  APP_NOT_REACHABLE: "APP_NOT_REACHABLE",
  APP_IDENTITY_FAILED: "APP_IDENTITY_FAILED",
});

// Friendly, non-technical wording for super-admin surfaces. Never includes
// stack traces or infra internals.
export const humanReason = (reason) =>
  ({
    [REASONS.DNS_NOT_FOUND]: "DNS not found",
    [REASONS.DNS_TARGET_MISMATCH]: "DNS target mismatch",
    [REASONS.DNS_REQUEST_FAILED]: "DNS query failed",
    [REASONS.SSRF_BLOCKED]: "Domain resolves to a private address",
    [REASONS.TLS_FAILED]: "TLS not ready",
    [REASONS.APP_NOT_REACHABLE]: "Application not reachable",
    [REASONS.APP_IDENTITY_FAILED]: "Application identity check failed",
  })[reason] || "Verification failed";

const NETWORK_DNS_ERRORS = new Set(["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED", "EBUSY", "EBADRESP", "EBADQUERY", "EBADNAME", "ENETUNREACH", "EHOSTUNREACH", "EFORMERR", "ECONNRESET"]);
const NOT_FOUND_DNS_ERRORS = new Set(["ENOTFOUND", "EAI_AGAIN", "ENODATA", "ENOENT"]);

export const createDomainVerifier = (options = {}) => {
  const deps = {
    resolveCname: dns.promises.resolveCname,
    resolve4: dns.promises.resolve4,
    resolve6: dns.promises.resolve6,
    fetch: globalThis.fetch,
    timeoutMs: 8000,
    maxRedirects: 4,
    maxBytes: 512 * 1024,
    ...options,
  };

  const cnameTarget = normalizeHost(deps.cnameTarget || "examos.avexora.in");
  const platformDomains = new Set(
    (deps.platformDomains || ["avexora.in", "examos.avexora.in", "www.examos.avexora.in", "localhost"])
      .map(normalizeHost)
      .filter(Boolean)
  );
  const platformDomain = normalizeHost(deps.platformDomain || "avexora.in");

  const dnsErrorKind = (err) => {
    const code = err?.code;
    if (!code) return "ok";
    if (NETWORK_DNS_ERRORS.has(code)) return "network";
    if (NOT_FOUND_DNS_ERRORS.has(code)) return "not-found";
    return "network";
  };

  // Race a DNS lookup against a timer, always clearing the timer so no dangling
  // timeout can fire after the lookup (or the call site) has settled.
  const withDnsTimeout = (promise) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error("DNS timeout");
        err.code = "ETIMEOUT";
        reject(err);
      }, deps.timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });

  // Follows the CNAME chain at a hostname. Empty chain = the name has no CNAME
  // record (apex/ALIAS-flattened configurations resolve directly to A/AAAA).
  const resolveCnameChain = async (host) => {
    const chain = [];
    const seen = new Set();
    let current = host;
    while (chain.length < 10 && !seen.has(current)) {
      seen.add(current);
      let targets = [];
      let error = null;
      try {
        targets = await withDnsTimeout(deps.resolveCname(current));
      } catch (err) {
        error = dnsErrorKind(err);
      }
      if (error) return { chain, error };
      if (!targets.length) break;
      const next = normalizeHost(String(targets[0]));
      if (!next) return { chain, error: "not-found" };
      chain.push(next);
      current = next;
    }
    if (chain.length >= 10) return { chain, error: "network" };
    return { chain, error: null };
  };

  const collectHostIps = async (host) => {
    const ips = new Set();
    let failed = null;
    const lookups = [deps.resolve4, deps.resolve6].map(async (look) => {
      try {
        const res = await withDnsTimeout(look(host));
        res.forEach((ip) => ips.add(String(ip)));
      } catch (err) {
        const kind = dnsErrorKind(err);
        if (kind !== "not-found") failed = failed || kind;
      }
    });
    await Promise.allSettled(lookups);
    return { ips: [...ips], failed };
  };

  const checkChain = async (host) => {
    const classification = classifyHost(host, { platformDomains: [...platformDomains], platformDomain });
    const { chain, error } = await resolveCnameChain(host);
    if (error === "network") return { verified: false, reason: REASONS.DNS_REQUEST_FAILED, record: null, classification, chain };
    if (chain.length > 0) {
      // Ordinary (chained) hostname: the DNS chain MUST traverse a platform-owned
      // host. IP overlap is deliberately ignored here so a bare CNAME to a
      // hosting-provider hostname (e.g. *.vercel-dns.com) can never verify.
      for (const hop of [host, ...chain]) {
        if (hop === cnameTarget) return { verified: true, record: cnameTarget, reason: null, classification, chain };
        if (platformDomains.has(hop)) return { verified: true, record: hop, reason: null, classification, chain };
      }
      return { verified: false, reason: REASONS.DNS_TARGET_MISMATCH, record: chain[0] || null, classification, chain };
    }
    // No CNAME record — apex / CNAME-flattened (ALIAS/ANAME). Resolution lands
    // directly on A/AAAA, so validate against the platform's own IPs.
    const { ips, failed } = await collectHostIps(host);
    if (failed === "network") return { verified: false, reason: REASONS.DNS_REQUEST_FAILED, record: null, classification, chain };
    if (ips.length === 0) return { verified: false, reason: REASONS.DNS_NOT_FOUND, record: null, classification, chain };
    const { ips: targetIps } = await collectHostIps(cnameTarget);
    const hit = ips.find((ip) => targetIps.includes(ip));
    if (hit) return { verified: true, record: cnameTarget, reason: null, classification, chain };
    return { verified: false, reason: REASONS.DNS_TARGET_MISMATCH, record: null, classification, chain };
  };

  // Resolves a host and refuses to proceed if any address is private/link-local
  // (SSRF protection incl. DNS-rebinding at each redirect hop).
  const assertPublicAddresses = async (host) => {
    const { ips, failed } = await collectHostIps(host);
    if (failed === "network") {
      const e = new Error(REASONS.DNS_REQUEST_FAILED);
      e.reason = REASONS.DNS_REQUEST_FAILED;
      throw e;
    }
    if (ips.length === 0) {
      const e = new Error(REASONS.DNS_NOT_FOUND);
      e.reason = REASONS.DNS_NOT_FOUND;
      throw e;
    }
    const privateIp = ips.find(isPrivateIp);
    if (privateIp) {
      const e = new Error(REASONS.SSRF_BLOCKED);
      e.reason = REASONS.SSRF_BLOCKED;
      throw e;
    }
  };

  const readBodyLimited = async (res) => {
    const reader = res.body?.getReader?.();
    if (!reader) return { body: await res.text(), truncated: false };
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > deps.maxBytes) return { body: null, truncated: true };
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks).toString("utf8"), truncated: false };
  };

  // SSRF-safe HTTPS fetch. Validates every host (initial + redirect hops) against
  // private ranges, never weakens TLS certificate validation, bounds response
  // size and time, and only follows a limited number of redirects.
  const safeFetch = async (host, path, redirectsLeft = deps.maxRedirects) => {
    await assertPublicAddresses(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      const url = `https://${host}${path}`;
      const res = await deps.fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "Avexora-ExamOS-DomainVerifier" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location || redirectsLeft <= 0) {
          const err = new Error(REASONS.APP_NOT_REACHABLE);
          err.reason = REASONS.APP_NOT_REACHABLE;
          throw err;
        }
        const next = new URL(location, url);
        if (next.protocol !== "https:") {
          const err = new Error(REASONS.APP_NOT_REACHABLE);
          err.reason = REASONS.APP_NOT_REACHABLE;
          throw err;
        }
        const nextHost = normalizeHost(next.hostname);
        if (!nextHost) {
          const err = new Error(REASONS.APP_NOT_REACHABLE);
          err.reason = REASONS.APP_NOT_REACHABLE;
          throw err;
        }
        return safeFetch(nextHost, next.pathname + next.search, redirectsLeft - 1);
      }
      const limited = await readBodyLimited(res);
      if (limited.truncated) {
        const err = new Error(REASONS.APP_NOT_REACHABLE);
        err.reason = REASONS.APP_NOT_REACHABLE;
        throw err;
      }
      return { status: res.status, type: res.headers.get("content-type") || "", body: limited.body };
    } catch (err) {
      if (err?.reason) throw err;
      const code = err?.cause?.code || err?.code;
      if (typeof code === "string" && code.startsWith("ERR_TLS")) {
        err.reason = REASONS.TLS_FAILED;
        err.message = REASONS.TLS_FAILED;
        throw err;
      }
      if (err?.name === "AbortError") {
        err.reason = REASONS.APP_NOT_REACHABLE;
        err.message = REASONS.APP_NOT_REACHABLE;
        throw err;
      }
      err.reason = err.reason || REASONS.APP_NOT_REACHABLE;
      err.message = err.message || REASONS.APP_NOT_REACHABLE;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const probeRoot = async (host) => {
    const index = await safeFetch(host, "/");
    if (index.status !== 200) {
      const e = new Error(REASONS.APP_NOT_REACHABLE);
      e.reason = REASONS.APP_NOT_REACHABLE;
      throw e;
    }
    const html = index.type.includes("text/html");
    const root = index.body.includes('id="root"');
    const marker = index.body.includes("x-examos-app");
    if (!html || !root || !marker) {
      const e = new Error(REASONS.APP_IDENTITY_FAILED);
      e.reason = REASONS.APP_IDENTITY_FAILED;
      throw e;
    }
  };

  const probeBackend = async (host) => {
    const health = await safeFetch(host, "/api/health");
    if (health.status !== 200) {
      const e = new Error(REASONS.APP_IDENTITY_FAILED);
      e.reason = REASONS.APP_IDENTITY_FAILED;
      throw e;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(health.body);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.ok !== true || parsed.app !== "examos") {
      const e = new Error(REASONS.APP_IDENTITY_FAILED);
      e.reason = REASONS.APP_IDENTITY_FAILED;
      throw e;
    }
  };

  // Activation decision: re-resolve DNS then run the full LIVE check. Nothing
  // from a previous verification cycle is trusted; the caller persists the result.
  const evaluateActivation = async (host) => {
    const dns = await checkChain(host);
    if (!dns.verified) return { verified: false, dns, probe: null };
    const probe = await probeDomain(host);
    return { verified: true, dns, probe };
  };

  // Full LIVE check. Requires valid DNS (handled by the caller via checkChain),
  // HTTPS reachability, valid TLS, the EXAM OS static bundle AND the EXAM OS
  // backend responding on the same domain.
  const probeDomain = async (host) => {
    try {
      await probeRoot(host);
      await probeBackend(host);
      return { live: true, reachable: true, tlsOk: true, reason: null };
    } catch (err) {
      return {
        live: false,
        reachable: err?.reason === REASONS.APP_IDENTITY_FAILED,
        tlsOk: false,
        reason: err?.reason || REASONS.APP_NOT_REACHABLE,
      };
    }
  };

  return { cnameTarget, platformDomains, checkChain, probeDomain, evaluateActivation, collectHostIps };
};