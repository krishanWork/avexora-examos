// Fixture builders for the live RBAC harness.
//
// Everything here creates rows in the harness's scratch database through the real API
// where a real API exists (so the authorization path under test is the one that gates
// the seed) and through a direct insert where it does not (multi-role sets, legacy
// pre-migration documents, and the family link rows that no public endpoint mints).
//
// A direct insert is only legitimate when the shape it writes is one the production
// code itself writes. seedRoleSet and seedLegacyUser below reproduce exactly what
// assignUserRoles and the pre-migration backfill leave behind; anything else would be
// testing a document shape the application can never produce.

import { ObjectId } from "mongodb";

// A tenant administrator, created the way a real one arrives: public registration,
// which yields an unverified account, then the real verification flow. Editing the flag
// directly would let a broken verification path pass unnoticed.
export const makeTenantAdmin = async (ctx, label) => {
  const { api, check, email: em, runId, testPassword, userIds, trackedTenant, findUserByEmail } = ctx;
  const address = em(`admin-${label}-${runId}`.replace(/-/g, ""));
  const r = await api("/auth/register", {
    method: "POST",
    body: { email: address, password: testPassword, full_name: `RBAC Admin ${label}`, school_name: `RBAC Test ${label} ${runId}` },
  });
  if (r.status !== 200) throw new Error(`register ${label} failed: ${r.status} ${r.raw}`);
  const user = r.data.user;
  userIds.add(user.id);
  trackedTenant(user.tenant_id);
  check(`fixture: tenant ${label} admin registered`, Boolean(user.tenant_id), `role=${user.app_role}`);
  const v = await api("/auth/verify-email", { method: "POST", body: { token: r.data.dev_verification_token } });
  if (v.status !== 200) throw new Error(`verify ${label} failed: ${v.status} ${v.raw}`);
  check(`fixture: tenant ${label} admin verified`, true);
  return { token: r.data.token, tenantId: user.tenant_id, email: address };
};

// Invite a user through the tenant's own invite endpoint, so provisioning is subject to
// the same hierarchy check a real invitation would face.
export const invite = (ctx, token, address, role) =>
  ctx.api("/users/invite", { method: "POST", token, body: { email: address, role } });

export const makeUser = async (ctx, token, address, role) => {
  const r = await invite(ctx, token, address, role);
  if (r.status !== 200) throw new Error(`invite ${address} failed: ${r.status} ${r.raw}`);
  const u = await ctx.findUserByEmail(address);
  if (!u) throw new Error(`invited user not found: ${address}`);
  ctx.userIds.add(u._id.toString());
  return u;
};

// An invited user arrives without a usable password, so set one and log in for real.
// This is how every role below admin gets its session.
export const makeAccessible = async (ctx, address) => {
  const { DB, api, hashPw, testPassword, findUserByEmail } = ctx;
  const u = await findUserByEmail(address);
  await DB.collection("User").updateOne({ _id: u._id }, { $set: { password_hash: await hashPw(testPassword) } });
  const r = await api("/auth/login", { method: "POST", body: { email: address, password: testPassword } });
  if (r.status !== 200) throw new Error(`login failed for ${address}: ${r.status} ${r.raw}`);
  return r.data.token;
};

const userDoc = (address, tenantId, { roles, mirror } = {}) => ({
  email: String(address).toLowerCase().trim(),
  password_hash: null, // filled by the caller with a real hash
  role: "user",
  ...(roles ? { app_roles: roles } : {}),
  app_role: mirror !== undefined ? mirror : roles?.[0],
  tenant_id: tenantId,
  created_date: new Date().toISOString(),
  updated_date: new Date().toISOString(),
});

const insertUser = async (ctx, doc) => {
  const res = await ctx.DB.collection("User").insertOne(doc);
  ctx.userIds.add(res.insertedId.toString());
  return doc;
};

export const seedUser = async (ctx, address, role, tenantId) =>
  insertUser(ctx, { ...userDoc(address, tenantId, { roles: [role] }), password_hash: await ctx.hashPw(ctx.testPassword) });

// A multi-role account, seeded the way the assignment path writes one: the canonical
// array plus a mirror of the primary role. `mirror` can be passed a DISAGREEING value
// so a test can prove the canonical array is what is read.
export const seedRoleSet = async (ctx, address, roles, tenantId, { mirror } = {}) =>
  insertUser(ctx, { ...userDoc(address, tenantId, { roles, mirror }), password_hash: await ctx.hashPw(ctx.testPassword) });

// A pre-migration document: no app_roles at all, only the old mirror. Used to prove the
// deploy is safe before the backfill has run anywhere.
export const seedLegacyUser = async (ctx, address, role, tenantId) => {
  const doc = userDoc(address, tenantId);
  delete doc.app_roles;
  doc.app_role = role;
  return insertUser(ctx, { ...doc, password_hash: await ctx.hashPw(ctx.testPassword) });
};

// The entity helper the suites use for every write/read assertion.
//
// `method` is the logical operation: GET, POST, PATCH, DELETE, or the pseudo-method
// "filter" for POST /entities/:name/filter. Passing the pseudo-method keeps the call
// sites readable and centralises the URL and body rules.
export const ent = async (ctx, name, method, token, body, extra = "") =>
  ctx.api(`/entities/${name}${extra}${method === "filter" ? "/filter" : ""}`, {
    method: method === "filter" ? "POST" : method,
    token,
    body: ["POST", "PATCH", "filter"].includes(method) ? body : undefined,
  });

// A distinct prefix from rbac-live.mjs's own counter. Both helpers mint student_email
// values with a module-level seed, and the two sequences are independent, so sharing
// the `s<N>` shape would collide with rows the main harness already created and turn
// this suite's student creates into 409s.
let studentSeed = 0;
export const nextStudentEmail = (ctx) => `rbac-${ctx.runId}-fx${studentSeed++}@example.test`;

export const makeStudent = (ctx, token, tenant_id, doc = {}) =>
  ent(ctx, "Student", "POST", token, {
    tenant_id,
    full_name: "RBAC Student",
    roll_number: "RN1",
    class_name: "Class 10",
    section: "A",
    status: "active",
    student_email: nextStudentEmail(ctx),
    parent_email: "",
    ...doc,
  });

export { ObjectId };