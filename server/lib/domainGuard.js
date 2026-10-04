// One-to-one guarantee between a normalized custom_domain and its tenant.
// Application-level guard that backs the DB partial unique index; also covers
// values stored before normalization existed (which the raw index cannot see).

import { ObjectId } from "mongodb";

export const assertCustomDomainAvailable = async (collection, host, excludeTenantId) => {
  if (!host) return;
  const exclusion =
    excludeTenantId && ObjectId.isValid(String(excludeTenantId))
      ? { _id: { $ne: new ObjectId(String(excludeTenantId)) } }
      : {};
  const existing = await collection.findOne(
    { custom_domain: host, ...exclusion },
    { projection: { name: 1 } }
  );
  if (existing) {
    const error = new Error(
      `This domain is already assigned to ${existing.name || "another institution"}. Choose a different domain or contact support.`
    );
    error.statusCode = 409;
    throw error;
  }
};

// --- Portal subdomain identity -------------------------------------------------
//
// The subdomain is a public, guessable tenant identifier: publicSite/branding
// resolves a tenant from it, and it is what a *.avexora.in portal URL carries.
// It therefore needs the same one-to-one guarantee as custom_domain, and it was
// missing both halves of it — no validation and no uniqueness — which let a
// registrant create a second tenant on a real school's subdomain. Because
// branding resolution is a findOne over a regex, a duplicate could then return
// the *victim* tenant to an anonymous caller.

// DNS label limit. The subdomain is one label of a hostname.
const SUBDOMAIN_MAX_LENGTH = 63;
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Names the platform itself resolves on, plus the marketing/labelled routes that
// are not tenant portals. A tenant must never be able to shadow one.
const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "admin", "platform", "avexora", "examos",
  "mail", "smtp", "cdn", "assets", "static", "status", "help",
  "support", "docs", "blog", "login", "auth", "accounts",
]);

// Reduce free text to a candidate subdomain, or return null when nothing usable
// survives. This never throws: callers decide whether an unusable value is a
// validation error or a generated fallback.
export const normalizeSubdomain = (value) => {
  const slug = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  return slug.slice(0, SUBDOMAIN_MAX_LENGTH).replace(/-+$/g, "");
};

export const isReservedSubdomain = (value) => RESERVED_SUBDOMAINS.has(String(value ?? "").toLowerCase());

// Validate a candidate for storage. Throws a 400/409 with a user-facing message
// so the register route can surface it directly.
export const assertSubdomainUsable = (subdomain) => {
  if (!subdomain) {
    const error = new Error("Enter an institution name that produces a usable portal address.");
    error.statusCode = 400;
    throw error;
  }
  if (subdomain.length > SUBDOMAIN_MAX_LENGTH) {
    const error = new Error(`Portal address must be ${SUBDOMAIN_MAX_LENGTH} characters or fewer.`);
    error.statusCode = 400;
    throw error;
  }
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    const error = new Error("Portal address may contain only lowercase letters, numbers and hyphens.");
    error.statusCode = 400;
    throw error;
  }
  if (isReservedSubdomain(subdomain)) {
    const error = new Error("That portal address is reserved. Choose a different institution name.");
    error.statusCode = 409;
    throw error;
  }
  return subdomain;
};

// One-to-one guarantee for the portal subdomain, mirroring
// assertCustomDomainAvailable. excludeTenantId lets a tenant keep its own address
// when renaming.
export const assertSubdomainAvailable = async (collection, subdomain, excludeTenantId) => {
  if (!subdomain) return;
  const exclusion =
    excludeTenantId && ObjectId.isValid(String(excludeTenantId))
      ? { _id: { $ne: new ObjectId(String(excludeTenantId)) } }
      : {};
  const existing = await collection.findOne(
    { subdomain, ...exclusion },
    { projection: { name: 1 } }
  );
  if (existing) {
    const error = new Error(
      `The portal address "${subdomain}" is already taken by ${existing.name || "another institution"}. Choose a different institution name.`
    );
    error.statusCode = 409;
    throw error;
  }
};