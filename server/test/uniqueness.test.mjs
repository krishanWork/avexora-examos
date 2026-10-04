import test from "node:test";
import assert from "node:assert/strict";
import { assertCustomDomainAvailable } from "../lib/domainGuard.js";

const fakeCollection = ({ occupants = {}, guardId }) => ({
  findOne: async (query) => {
    const host = query?.custom_domain;
    const exclude = query?._id?.$ne;
    if (!host) return null;
    if (exclude != null && exclude.toString() === guardId) return null;
    return occupants[host] || null;
  },
});

const TENANT_A = "507f1f77bcf86cd799439011";
const TENANT_B = "507f1f77bcf86cd799439022";

test("tenant B cannot claim a domain owned by tenant A", async () => {
  const col = fakeCollection({ occupants: { "exam.school.edu": { name: "Oakridge Global Academy" } } });
  await assert.rejects(
    () => assertCustomDomainAvailable(col, "exam.school.edu", TENANT_B),
    (err) => err.statusCode === 409 && /already assigned to Oakridge Global Academy/.test(err.message)
  );
});

test("a pending claim is still reserved, so a second tenant is blocked", async () => {
  const col = fakeCollection({ occupants: { "exam.school.edu": { name: "Tenant A" } } });
  await assert.rejects(() => assertCustomDomainAvailable(col, "exam.school.edu", TENANT_B), /already assigned/);
});

test("a tenant may keep (update) its own domain", async () => {
  const col = fakeCollection({ occupants: { "exam.school.edu": { name: "Tenant A" } }, guardId: TENANT_A });
  await assert.doesNotReject(() => assertCustomDomainAvailable(col, "exam.school.edu", TENANT_A));
});

test("unclaimed normalized domain is available", async () => {
  const col = fakeCollection({ occupants: {} });
  await assert.doesNotReject(() => assertCustomDomainAvailable(col, "fresh.school.edu", TENANT_A));
});

test("empty host short-circuits (no check)", async () => {
  const col = fakeCollection({ occupants: {} });
  await assert.doesNotReject(() => assertCustomDomainAvailable(col, "", TENANT_A));
});