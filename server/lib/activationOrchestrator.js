// Orchestrates the activate step of the custom-domain pipeline (Phase 2).
//
// Order of operations matters:
//   1. DNS gate  — the domain must already pass the Phase 1 chain rules, so a
//      misconfigured school CNAME is rejected before any vendor API is hit.
//   2. Attach    — ask the hosting provider to attach the domain to the
//      platform's project (Vercel API). The manual provider short-circuits here.
//   3. Verify    — for automation-capable providers, wait for the vendor to
//      confirm DNS ownership of the domain (polls the provider).
//   4. Probe     — the Phase 1 live probe (HTTPS/TLS + EXAM OS identity) is the
//      FINAL and ONLY authority for LIVE. A domain is never marked live just
//      because the Vercel API accepted it.
//
// The orchestrator is pure orchestration: providers and verifiers are injected
// so every branch is unit-testable offline.

import { HOSTING_STATUS } from "./hosting.js";

export const ACTIVATION_STAGE = Object.freeze({
  DNS_FAILED: "dns_failed",
  HOSTING_UNCONFIGURED: "hosting_unconfigured",
  HOSTING_FAILED: "hosting_failed",
  VERIFICATION_PENDING: "verification_pending",
  PROBE_FAILED: "probe_failed",
  LIVE: "live",
});

export async function runCustomDomainActivation({ verifier, hosting, host }) {
  const dns = await verifier.checkChain(host);
  if (!dns.verified) {
    return { stage: ACTIVATION_STAGE.DNS_FAILED, dns, hosting: null, probe: null };
  }

  const attach = await hosting.addCustomDomain(host);

  if (!attach.implemented) {
    // Manual provider: nothing to automate. Probe immediately (Phase 1 flow).
    const probe = await verifier.probeDomain(host);
    const live = probe.live;
    return {
      stage: live ? ACTIVATION_STAGE.LIVE : ACTIVATION_STAGE.PROBE_FAILED,
      dns,
      hosting: { status: HOSTING_STATUS.NOT_CONFIGURED, attach },
      probe,
    };
  }

  if (attach.status === HOSTING_STATUS.FAILED) {
    return {
      stage: ACTIVATION_STAGE.HOSTING_FAILED,
      dns,
      hosting: { status: HOSTING_STATUS.FAILED, attach },
      probe: null,
    };
  }

  if (!hosting.verificationCapable) {
    const probe = await verifier.probeDomain(host);
    const live = probe.live;
    return {
      stage: live ? ACTIVATION_STAGE.LIVE : ACTIVATION_STAGE.PROBE_FAILED,
      dns,
      hosting: { status: attach.status || HOSTING_STATUS.CONFIGURED, attach },
      probe,
    };
  }

  // Automation-capable provider (vercel): wait for DNS-ownership verification.
  let verifiedStatus = { verified: Boolean(attach.verified) };
  if (!verifiedStatus.verified) {
    try {
      verifiedStatus = await hosting.waitUntilVerified(host);
    } catch {
      verifiedStatus = { verified: false, verification: attach.verification || [], attempts: 0 };
    }
  }

  if (!verifiedStatus.verified) {
    return {
      stage: ACTIVATION_STAGE.VERIFICATION_PENDING,
      dns,
      hosting: {
        status: HOSTING_STATUS.CONFIGURING,
        attach,
        verification: verifiedStatus.verification || attach.verification || [],
      },
      probe: null,
    };
  }

  const probe = await verifier.probeDomain(host);
  const live = probe.live;
  return {
    stage: live ? ACTIVATION_STAGE.LIVE : ACTIVATION_STAGE.PROBE_FAILED,
    dns,
    hosting: { status: HOSTING_STATUS.CONFIGURED, attach, verified: true },
    probe,
  };
}