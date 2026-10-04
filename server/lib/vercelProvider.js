// Vercel hosting provider for the custom-domain pipeline (Phase 2).
//
// The rest of EXAM OS talks to HostingProvider only; this file is the only place
// that knows how Vercel's REST API works. It attaches a tenant's custom domain
// to the Vercel project behind the platform (examos.avexora.in), reports Vercel's
// DNS-ownership verification status, and never decides LIVE on its own — the
// Phase 1 identity probe remains the final authority.
//
// Config (environment):
//   VERCEL_TOKEN        — required; Vercel API token with project-domain scope
//   VERCEL_PROJECT_ID   — the Vercel project behind the platform (recommended)
//   VERCEL_PROJECT_NAME — fallback if PROJECT_ID is not set
//
// Every method resolves with a normalized result object; it never rejects.

import { HOSTING_STATUS } from "./hosting.js";
import { withRetry } from "./httpRetry.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apiErrorMessage = (data) => {
  const code = data?.error?.code || data?.error?.name;
  const msg = data?.error?.message || data?.message;
  if (code && msg) return `${code}: ${msg}`;
  return msg || (code ? `Vercel API error ${code}` : "Unknown Vercel API error");
};

const normalizeVerificationRecords = (records) =>
  Array.isArray(records)
    ? records.map((r) => ({
        type: r.type || "TXT",
        name: r.domain || "",
        required: r.value || r.required || "",
        reason: r.reason || "",
      }))
    : [];

export function createVercelProvider({
  token = process.env.VERCEL_TOKEN,
  projectId = process.env.VERCEL_PROJECT_ID,
  projectName = process.env.VERCEL_PROJECT_NAME,
  fetchImpl = globalThis.fetch,
  baseUrl = "https://api.vercel.com",
  timeoutMs = 10000,
  pollIntervalMs = 5000,
  maxAttempts = 20,
  retryAttempts = 3,
  retryBaseDelayMs = 250,
  retryMaxDelayMs = 4000,
} = {}) {
  const state = { projectId };

  const request = async (path, { method = "GET", body } = {}) => {
    if (!token) {
      return { ok: false, status: 0, data: { error: { message: "VERCEL_TOKEN is not configured" } } };
    }
    const fetchOnce = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(body ? { "Content-Length": String(Buffer.byteLength(JSON.stringify(body))) } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
      } catch (err) {
        const aborted = err?.name === "AbortError";
        return {
          ok: false,
          status: 0,
          data: { error: { message: aborted ? "Vercel API timed out" : `Vercel API unreachable (${err?.message || "network error"})` } },
        };
      } finally {
        clearTimeout(timer);
      }
    };
    return withRetry({
      run: fetchOnce,
      attempts: retryAttempts,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
    });
  };

  const resolveProjectId = async () => {
    if (state.projectId) return state.projectId;
    if (!projectName) return null;
    const res = await request(`/v6/projects/${encodeURIComponent(projectName)}`);
    if (res.ok && res.data?.id) {
      state.projectId = res.data.id;
      return state.projectId;
    }
    return null;
  };

  return {
    name: "vercel",
    verificationCapable: true,
    requiredEnv: ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"],
    isConfigured() {
      return Boolean(token && (projectId || projectName));
    },
    async describe() {
      return {
        name: "vercel",
        verificationCapable: true,
        configured: this.isConfigured(),
        requiredEnv: this.requiredEnv,
        state: this.isConfigured() ? "configured" : "not_configured",
      };
    },

    async addCustomDomain(host) {
      if (!this.isConfigured()) {
        return {
          implemented: true,
          status: HOSTING_STATUS.NOT_CONFIGURED,
          message: "Vercel automation is not configured (set VERCEL_TOKEN and VERCEL_PROJECT_ID).",
        };
      }
      const id = await resolveProjectId();
      if (!id) {
        return { implemented: true, status: HOSTING_STATUS.FAILED, reason: "no_project", message: "Vercel project could not be resolved (set VERCEL_PROJECT_ID or VERCEL_PROJECT_NAME)." };
      }
      const res = await request(`/v10/projects/${encodeURIComponent(id)}/domains`, {
        method: "POST",
        body: { name: host },
      });
      if (res.ok) {
        const verification = normalizeVerificationRecords(res.data?.verification);
        return {
          implemented: true,
          status: res.data?.verified ? HOSTING_STATUS.CONFIGURED : HOSTING_STATUS.CONFIGURING,
          verified: Boolean(res.data?.verified),
          verification,
          message: res.data?.verified ? "Domain attached to Vercel and verified." : "Domain attached to Vercel; DNS ownership verification pending.",
        };
      }
      if (res.status === 409 || res.status === 400) {
        const verification = normalizeVerificationRecords(res.data?.verification);
        if (verification.length) {
          return {
            implemented: true,
            status: HOSTING_STATUS.CONFIGURING,
            verified: false,
            verification,
            reason: "conflict",
            message: `Vercel reported a conflict (${apiErrorMessage(res.data)}).`,
          };
        }
        // Idempotent retry path: the conflict returned no proof records, so the
        // domain is likely already attached (e.g. a previous activate). Re-query
        // the current state instead of declaring FAILED — "click Activate to
        // retry" must converge, not cycle.
        const current = await this.getDomainStatus(host);
        if (current.verified) {
          return { implemented: true, status: HOSTING_STATUS.CONFIGURED, verified: true, verification: current.verification, reason: "conflict", message: "Domain is already attached to Vercel and verified." };
        }
        if (current.status === HOSTING_STATUS.CONFIGURING && current.reason !== "not_attached") {
          return { implemented: true, status: HOSTING_STATUS.CONFIGURING, verified: false, verification: current.verification, reason: "conflict", message: "Domain is already attached to Vercel; DNS ownership verification is still pending." };
        }
        // 409 with no records and the domain not present on this project: a
        // genuine attach failure (e.g. owned by a different project).
        return {
          implemented: true,
          status: HOSTING_STATUS.FAILED,
          verified: false,
          verification,
          reason: "conflict",
          message: `Vercel reported a conflict (${apiErrorMessage(res.data)}).`,
        };
      }
      if (res.status === 429) {
        return { implemented: true, status: HOSTING_STATUS.FAILED, reason: "rate_limited", message: "Vercel API rate limit reached — retry shortly." };
      }
      return { implemented: true, status: HOSTING_STATUS.FAILED, reason: "api_error", message: `Vercel API error — ${apiErrorMessage(res.data)}` };
    },

    async getDomainStatus(host) {
      const id = await resolveProjectId();
      if (!id) {
        return { implemented: true, verified: false, verification: [], status: HOSTING_STATUS.FAILED, reason: "no_project", message: "Vercel project could not be resolved." };
      }
      const res = await request(`/v8/projects/${encodeURIComponent(id)}/domains/${encodeURIComponent(host)}`);
      if (res.ok) {
        const verification = normalizeVerificationRecords(res.data?.verification);
        return {
          implemented: true,
          verified: Boolean(res.data?.verified),
          verification,
          status: res.data?.verified ? HOSTING_STATUS.CONFIGURED : HOSTING_STATUS.CONFIGURING,
          message: res.data?.verified ? "Domain verified on Vercel." : `Domain not verified yet (${verification.length} record(s) required).`,
        };
      }
      if (res.status === 404) {
        return { implemented: true, verified: false, verification: [], status: HOSTING_STATUS.CONFIGURING, reason: "not_attached", message: "Domain is not attached to the Vercel project." };
      }
      return { implemented: true, verified: false, verification: [], status: HOSTING_STATUS.FAILED, reason: "api_error", message: `Vercel API error — ${apiErrorMessage(res.data)}` };
    },

    async verifyDomain(host) {
      const id = await resolveProjectId();
      if (!id) {
        return { implemented: true, verified: false, verification: [], status: HOSTING_STATUS.FAILED, reason: "no_project", message: "Vercel project could not be resolved." };
      }
      const res = await request(`/v8/projects/${encodeURIComponent(id)}/domains/${encodeURIComponent(host)}/verify`, { method: "POST" });
      if (res.ok) {
        return {
          implemented: true,
          verified: Boolean(res.data?.verified),
          verification: normalizeVerificationRecords(res.data?.verification),
          message: res.data?.verified ? "Domain verification re-triggered and succeeded." : "Verification re-triggered; DNS ownership not detected yet.",
        };
      }
      return { implemented: true, verified: false, verification: [], status: HOSTING_STATUS.FAILED, reason: "api_error", message: `Vercel API error — ${apiErrorMessage(res.data)}` };
    },

    async waitUntilVerified(host, { intervalMs = pollIntervalMs, attempts = maxAttempts } = {}) {
      let last = { verified: false, verification: [], attempts: 0 };
      for (let i = 0; i < attempts; i += 1) {
        last = await this.getDomainStatus(host);
        if (last.verified) return { verified: true, verification: last.verification, attempts: i + 1 };
        if (intervalMs > 0) await sleep(intervalMs);
      }
      return { verified: false, verification: last.verification, attempts };
    },

    async removeCustomDomain(host) {
      const id = await resolveProjectId();
      if (!id) {
        return { implemented: true, status: HOSTING_STATUS.NOT_CONFIGURED, message: "Vercel automation is not configured." };
      }
      const res = await request(`/v10/projects/${encodeURIComponent(id)}/domains/${encodeURIComponent(host)}`, { method: "DELETE" });
      if (res.ok) {
        return { implemented: true, status: HOSTING_STATUS.NOT_CONFIGURED, removed: true, message: "Domain removed from the Vercel project." };
      }
      return { implemented: true, status: HOSTING_STATUS.FAILED, reason: "api_error", message: `Vercel API error — ${apiErrorMessage(res.data)}` };
    },

    async checkTls() {
      // Vercel does not expose a stable per-domain TLS status; the Phase 1 live
      // probe (valid certificate check) stays the authority for TLS readiness.
      return { implemented: false, status: HOSTING_STATUS.NOT_CONFIGURED };
    },
  };
}