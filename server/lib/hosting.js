// Hosting-provider abstraction. The custom-domain pipeline must never depend on
// a specific hosting vendor. Every hosting operation flows through a provider
// registered here; providers implement the same contract so later phases can
// add real automation (Vercel, then any other provider) without touching
// application logic.
//
// THE INVARIANT: a hosting provider reports its own state, but EXAM OS decides
// LIVE. The Phase 1 DNS/TLS/identity probe remains the only authority — a
// provider saying "verified" never marks a domain live on its own.
//
// Phase 1 shipped only the "manual" provider (out-of-band operator attachment).
// Phase 2 added the "vercel" provider. Phase 5 hardens the contract so any
// future provider (AWS, Cloudflare, Netlify, Railway, …) can slot in behind the
// stable platform domain (examos.avexora.in) without school DNS changes.

export const HOSTING_STATUS = Object.freeze({
  NOT_CONFIGURED: "not_configured",
  CONFIGURING: "configuring",
  CONFIGURED: "configured",
  FAILED: "failed",
});

// Conformance helpers. The contract surface is split so a provider can declare
// only the capabilities it actually supports, and the application never assumes
// a method exists that the provider did not promise.
export const REQUIRED_PROVIDER_METHODS = Object.freeze([
  "addCustomDomain", // attach a domain behind the platform's stable hostname
  "getDomainStatus", // current provider-side state for a domain
  "waitUntilVerified", // bounded poll for provider-side DNS-ownership confirmation
  "removeCustomDomain",
]);

export const OPTIONAL_PROVIDER_METHODS = Object.freeze(["verifyDomain", "checkTls"]);

// Runs structural checks against the contract. Returns a list of problems
// (empty = conformant). Never assumes anything about vendor internals.
export const validateProviderContract = (provider) => {
  if (!provider || typeof provider !== "object") return ["provider is not an object"];
  const problems = [];
  if (typeof provider.name !== "string" || !provider.name) problems.push("name must be a non-empty string");
  if (typeof provider.verificationCapable !== "boolean") problems.push("verificationCapable must be a boolean");
  // IMPORTANT: isConfigured() must be synchronous so selection stays cheap and
  // deterministic (async would coerce every call to a truthy Promise).
  if (typeof provider.isConfigured !== "function") problems.push("isConfigured() must be a function (synchronous)");
  for (const method of REQUIRED_PROVIDER_METHODS) {
    if (typeof provider[method] !== "function") problems.push(`missing required method ${method}()`);
  }
  for (const method of OPTIONAL_PROVIDER_METHODS) {
    if (typeof provider[method] !== "function" && provider[method] !== undefined) {
      problems.push(`${method}() must be a function when present (optional capability)`);
    }
  }
  return problems;
};

const manualProvider = {
  name: "manual",
  verificationCapable: false,
  isConfigured() {
    return false;
  },
  async addCustomDomain() {
    return { implemented: false, status: HOSTING_STATUS.NOT_CONFIGURED };
  },
  async getDomainStatus() {
    return { implemented: false, status: HOSTING_STATUS.NOT_CONFIGURED };
  },
  async waitUntilVerified() {
    return { verified: false, verification: [], attempts: 0 };
  },
  async removeCustomDomain() {
    return { implemented: false, status: HOSTING_STATUS.NOT_CONFIGURED };
  },
  async describe() {
    return {
      name: "manual",
      verificationCapable: false,
      configured: false,
      requiredEnv: [],
      state: "no automation",
    };
  },
};

const registry = new Map([["manual", manualProvider]]);

export const registerHostingProvider = (provider) => {
  if (!provider?.name) throw new Error("Hosting provider requires a name");
  const problems = validateProviderContract(provider);
  if (problems.length) throw new Error(`Hosting provider "${provider.name}" violates the contract: ${problems.join("; ")}`);
  registry.set(provider.name, provider);
};

// Never mutates provider state; used by ops introspection and tests.
export const listHostingProviders = async () => {
  const providers = [];
  for (const provider of registry.values()) {
    if (typeof provider.describe === "function") {
      providers.push(await provider.describe());
    } else {
      providers.push({
        name: provider.name,
        verificationCapable: provider.verificationCapable,
        configured: Boolean(provider.isConfigured?.()),
        requiredEnv: [],
      });
    }
  }
  return providers;
};

// Production selection:
//   - HOSTING_PROVIDER (deployment configuration, set by the platform operator)
//     pins the platform to a specific provider. An unknown override is a
//     deployment misconfiguration — warn loudly instead of silently redirecting.
//   - Otherwise the first configured automation provider wins (e.g. vercel);
//   - otherwise the manual provider.
export const getHostingProvider = (name) => {
  const preferred = name || process.env.HOSTING_PROVIDER;
  if (preferred) {
    const found = registry.get(preferred);
    if (!found) {
      console.warn(`[hosting] HOSTING_PROVIDER "${preferred}" is not a registered provider; using the manual provider.`);
      return manualProvider;
    }
    return found;
  }
  for (const provider of registry.values()) {
    if (provider.name !== "manual" && provider.isConfigured()) return provider;
  }
  return manualProvider;
};

// Test hook: clears the registry back to the singleton manual provider so tests
// can register providers in isolation without cross-test pollution.
export const resetHostingRegistry = () => {
  registry.clear();
  registry.set("manual", manualProvider);
};