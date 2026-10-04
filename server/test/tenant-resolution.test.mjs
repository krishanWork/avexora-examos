import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHost } from "../../shared/custom-domain.js";

// Tenant isolation is guaranteed by deterministic canonical matching + the
// one-to-one uniqueness guard. This models the branding lookup predicate used
// by publicSite: a custom_domain is matched by exact canonical equality (never
// regex), so a given Host always maps to exactly one tenant.
const resolveTenant = (tenants, requested) => {
  const canonical = normalizeHost(requested);
  if (!canonical) return null;
  return tenants.find((t) => normalizeHost(t.custom_domain) === canonical) || null;
};

const tenants = [
  { id: "tenant-a", name: "Tenant A", custom_domain: "exam.school.edu" },
  { id: "tenant-b", name: "Tenant B", custom_domain: "portal.college.edu" },
];

test("custom domain A resolves to tenant A", () => {
  for (const variant of ["exam.school.edu", "https://EXAM.SCHOOL.EDU/", "exam.school.edu."]) {
    const t = resolveTenant(tenants, variant);
    assert.equal(t?.id, "tenant-a");
  }
});

test("custom domain B resolves to tenant B, never tenant A", () => {
  const t = resolveTenant(tenants, "portal.college.edu");
  assert.equal(t?.id, "tenant-b");
});

test("unknown domain resolves to no tenant", () => {
  assert.equal(resolveTenant(tenants, "unknown.school.edu"), null);
});

test("a similar-looking host does not match a different tenant", () => {
  assert.equal(resolveTenant(tenants, "exam.school2.edu"), null);
  assert.equal(resolveTenant(tenants, "portal.college"), null);
});

test("a tenant without a custom domain never matches another tenant's domain", () => {
  const mixed = [...tenants, { id: "tenant-c", name: "Tenant C", custom_domain: "" }];
  const t = resolveTenant(mixed, "exam.school.edu");
  assert.equal(t?.id, "tenant-a");
});

test("non-hostname garbage cannot hijack a tenant", () => {
  assert.equal(resolveTenant(tenants, "https://exam.school.edu/path?x=1"), null);
});