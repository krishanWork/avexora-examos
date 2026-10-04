// Shared fakes for the custom-domain test suite. No production DNS or network
// calls are ever made — all lookups and fetches are injected stubs.

import { createDomainVerifier } from "../lib/domainVerifier.js";

export const EXAMOS_HTML = `<!doctype html><html><head><meta name="x-examos-app" content="1"></head><body><div id="root"></div></body></html>`;
export const OTHER_APP_HTML = `<!doctype html><html><head></head><body><div id="root"></div></body></html>`;

// records: { cname: { name: [targets] }, a: { name: [ips] }, nxdomain: [names] }
export const makeFakeDns = (records = {}) => {
  const cname = records.cname || {};
  const a = records.a || {};
  const nx = new Set(records.nxdomain || []);
  const notFound = () => Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
  return {
    resolveCname: (host) => {
      if (nx.has(host)) return notFound();
      if (cname[host]) return Promise.resolve(cname[host]);
      return Promise.resolve([]);
    },
    resolve4: (host) => {
      if (nx.has(host)) return notFound();
      if (a[host]) return Promise.resolve(a[host]);
      return Promise.resolve([]);
    },
    resolve6: (host) => Promise.resolve([]),
  };
};

export const makeVerifier = (options = {}) =>
  createDomainVerifier({
    ...makeFakeDns(options.records || {}),
    fetch: options.fetch || (() => Promise.reject(new Error("no fetch"))),
    timeoutMs: options.timeoutMs ?? 40,
    maxRedirects: options.maxRedirects ?? 4,
    maxBytes: options.maxBytes ?? 512 * 1024,
    cnameTarget: "examos.avexora.in",
    platformDomains: ["avexora.in", "examos.avexora.in", "www.examos.avexora.in"],
    platformDomain: "avexora.in",
  });

export const indexResponse = (html = EXAMOS_HTML, status = 200) =>
  new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export const healthResponse = (app = "examos", status = 200) =>
  new Response(JSON.stringify({ ok: true, app, timestamp: new Date().toISOString() }), {
    status,
    headers: { "content-type": "application/json" },
  });

// Routes an APPROVED static+backend app (valid EXAM OS) by URL, plus optional
// custom pages keyed by path.
export const examosFetch = (overrides = {}) => (url) => {
  const u = String(url);
  if (overrides[u]) return Promise.resolve(overrides[u]);
  if (u.endsWith("/api/health")) return Promise.resolve(healthResponse());
  return Promise.resolve(indexResponse());
};

export const hangingFetch = () => (url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
    );
  });

export const tlsFailureFetch =
  () =>
  () =>
    Promise.reject(
      Object.assign(new Error("fetch failed"), {
        cause: Object.assign(new Error("certificate"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
      })
    );