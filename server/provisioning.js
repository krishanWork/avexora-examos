import crypto from "crypto";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import {
  PROVISIONING_HIERARCHY,
  canProvisionRole,
  canAnyProvisionRole,
  canProvisionRoleSet,
  appRolesOf,
  primaryAppRole,
  redactSecrets,
} from "./rbac.js";

// The delegation matrix and canProvisionRole are defined once, in ./rbac.js, and
// re-exported here for the call sites that already import them from this module.
// They used to be declared in both files, which is how the two copies drifted.

// 1. Canonical Provisioning Hierarchy Policy
export { PROVISIONING_HIERARCHY, canProvisionRole };

// Strips credential material from a User before it is serialized.
//
// This delegates to the shared list in rbac.js instead of destructuring its own
// copy of the field names. The previous version named each field inline, so
// adding a secret to SECRET_ENTITY_FIELDS (as email_verification_token
// required) left this function quietly passing it through on every
// provisioning response — a second list to forget to update, which is precisely
// how the role matrices drifted before rbac.js existed.
export const safeUser = (doc) => redactSecrets(doc);

// Secure random credential generator. Never derive passwords from emails or
// names, and never persist the plaintext — it is returned exactly once.
const generateTempPassword = () => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(14);
  let pw = "";
  for (let i = 0; i < bytes.length; i++) {
    pw += chars[bytes[i] % chars.length];
  }
  return pw;
};

// Institution-wide default password applied to brand-new student/parent portal
// accounts. Configured per tenant as `student_default_password`; production
// falls back to this value until a school_admin sets their own.
export const PROVISIONING_DEFAULT_PASSWORD = process.env.PROVISIONING_DEFAULT_PASSWORD || "Welcome@123";

// Resolve the tenant's configured default student/parent password. Used to
// hash the shared value into each brand-new user; existing users are never
// touched. Never logs the resolved value.
export const resolveDefaultStudentPassword = async (database, tenantId) => {
  if (!database || !tenantId) return PROVISIONING_DEFAULT_PASSWORD;
  try {
    const filter = ObjectId.isValid(String(tenantId))
      ? { _id: new ObjectId(String(tenantId)) }
      : { _id: String(tenantId) };
    const tenant = await database
      .collection("Tenant")
      .findOne(filter, { projection: { student_default_password: 1 } });
    if (tenant && typeof tenant.student_default_password === "string" && tenant.student_default_password.trim()) {
      return tenant.student_default_password.trim();
    }
  } catch {
    // fall through to the platform default
  }
  return PROVISIONING_DEFAULT_PASSWORD;
};

const emailOf = (v) => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};
const slugifyName = (fullName) => {
  if (typeof fullName !== "string") return "";
  const trimmed = fullName.trim().toLowerCase();
  if (!trimmed) return "";
  // Replace non alphanumeric with dots, collapse dots, trim
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return slug;
};

const getTenantEmailDomain = (tenant) => {
  if (!tenant) return null;
  // Prefer custom domain if present (non-empty)
  if (typeof tenant.custom_domain === "string" && tenant.custom_domain.trim()) {
    return tenant.custom_domain.trim().toLowerCase();
  }
  if (typeof tenant.subdomain === "string" && tenant.subdomain.trim()) {
    return `${tenant.subdomain.trim().toLowerCase()}.school`;
  }
  return null;
};

const pickUniqueLocalPart = async (database, tenantId, baseSlug) => {
  if (!baseSlug) return baseSlug;
  // Try base, then base.2, base.3,...
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? baseSlug : `${baseSlug}.${i + 1}`;
    // Check User.email, Student.student_email, Parent.email in this tenant
    const [user, student, parent] = await Promise.all([
      database.collection("User").findOne({ tenant_id: tenantId, email: candidate }),
      database.collection("Student").findOne({ tenant_id: tenantId, $or: [{ student_email: candidate }, { email: candidate }] }),
      database.collection("Parent").findOne({ tenant_id: tenantId, $or: [{ email: candidate }, { parent_email: candidate }] }),
    ]);
    if (!user && !student && !parent) return candidate;
  }
  // Fallback to include timestamp/random suffix
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${baseSlug}.${Date.now().toString(36)}.${rnd}`;
};

export const generateStudentEmail = async ({ database, tenantId, fullName, tenant }) => {
  const slug = slugifyName(fullName);
  const baseSlug = slug || "student";
  const local = await pickUniqueLocalPart(database, tenantId, baseSlug);
  const domain = getTenantEmailDomain(tenant);
  if (domain) return `${local}@${domain}`;
  // Fallback: include tenant id fragment if no domain available
  const tid = typeof tenantId === "string" ? tenantId.slice(-6) : String(tenantId || "school").slice(-6);
  return `${local}@student.${tid}.local`;
};

export const generateParentEmail = async ({ database, tenantId, fullName, studentEmail, tenant }) => {
  let baseSlug = slugifyName(fullName);
  if (!baseSlug) {
    // derive from student email local part
    if (typeof studentEmail === "string" && studentEmail.includes("@")) {
      baseSlug = `parent.${studentEmail.split("@")[0]}`;
    } else {
      baseSlug = "parent";
    }
  } else {
    baseSlug = `parent.${baseSlug}`;
  }
  const local = await pickUniqueLocalPart(database, tenantId, baseSlug);
  const domain = getTenantEmailDomain(tenant);
  if (domain) return `${local}@${domain}`;
  const tid = typeof tenantId === "string" ? tenantId.slice(-6) : String(tenantId || "school").slice(-6);
  return `${local}@parent.${tid}.local`;
};


/**
 * Auto-provision portal logins for a freshly created Student (single or bulk).
 *
 * SHARED DEFAULT PASSWORD MODEL (locked):
 *  - Brand-new student/parent Users are created with the institution-wide
 *    default password (`Tenant.student_default_password`, falling back to
 *    PROVISIONING_DEFAULT_PASSWORD) and are flagged `must_change_password: true`
 *    so first login forces a password change.
 *  - If a User already exists for that email, the account is REUSED. Its
 *    password is NEVER reset or replaced, and the must-change flag is never
 *    set/cleared on it.
 *  - Existing Users are only ever linked to the new student when the role is
 *    compatible (student/parent). Nothing else is mutated.
 *  - The shared default is a school-known value, so it is returned exactly once
 *    in the response for the requesting admin; it is never logged and is never
 *    persisted (only the per-user bcrypt hashes are written to MongoDB).
 *
 * Returns { shared, default_password, student?, parent?, reused[] } where each
 * credential is { email, full_name } (no per-user plaintext is ever produced).
 */
export const provisionAutoLogins = async ({ database, tenantId, student, studentId, creatorRoles, creatorRole }) => {
  const result = { reused: [] };
  if (!database || !tenantId || !student) return result;
  // Union over the creator's held roles: a principal who is also an exam
  // coordinator may still auto-provision the family logins, because the
  // principal role is what authorizes it.
  //
  // `creatorRole` is still accepted for a caller that has not been updated. It is
  // a real fallback, not a comment: this function gates a SIDE EFFECT (minting a
  // student/parent portal login on every Student creation), so a caller still
  // passing the old single-role property would otherwise produce an empty role
  // set, fail the delegation check, and silently stop onboarding portal logins.
  // That failure is invisible -- the Student record is still created, so the bug
  // would only surface as a family that cannot log in.
  const held = appRolesOf(creatorRoles ?? creatorRole);
  if (!canAnyProvisionRole(held, "student") && !canAnyProvisionRole(held, "parent")) {
    return result;
  }

  const now = new Date().toISOString();
  const provisioned = {};
  const defaultPassword = await resolveDefaultStudentPassword(database, tenantId);
  const password_hash = await bcrypt.hash(defaultPassword, 10);

  const provision = async (role, email, fullName, phone) => {
    const normEmail = emailOf(email);
    if (!normEmail) return;
    const existing = await database.collection("User").findOne({ email: normEmail }, { projection: { _id: 1, app_role: 1, app_roles: 1, email_verified: 1 } });
    if (existing) {
      result.reused.push(normEmail);
      // Deliberately NOT setting email_verified here, unlike the create paths.
      // This branch reuses an account that already exists and does NOT reset its
      // password, so the person holding the credential is whoever chose it — not
      // necessarily the rostered person. Marking it verified here would let
      // whoever self-registered a victim's address inherit that person's
      // student/parent view, converting this feature into the account takeover
      // it is meant to help against. An account that reached this point is
      // already verified, or is left unverified and completes the normal
      // verification flow, which is the behaviour we want.
      const existingRoles = appRolesOf(existing);
      const compatible = (role === "student" && existingRoles.includes("student"))
        || (role === "parent" && existingRoles.includes("parent"));
      if (studentId && compatible) {
        const user = await database.collection("User").findOne({ _id: existing._id }, { projection: { linked_student_id: 1, linked_student_ids: 1 } });
        const ids = Array.isArray(user?.linked_student_ids) ? user.linked_student_ids.map(String) : [];
        if (user?.linked_student_id) ids.push(String(user.linked_student_id));
        if (!ids.includes(String(studentId))) ids.push(String(studentId));
        const uniqueIds = [...new Set(ids.filter(Boolean))];
        await database.collection("User").updateOne(
          { _id: existing._id },
          { $set: { tenant_id: tenantId, linked_student_id: String(studentId), linked_student_ids: uniqueIds, updated_date: now } }
        );
        if (role === "parent") {
          const parent = await database.collection("Parent").findOne(
            { tenant_id: tenantId, email: normEmail },
            { projection: { _id: 1, user_id: 1 } }
          );
          if (parent && !parent.user_id) {
            await database.collection("Parent").updateOne(
              { _id: parent._id },
              { $set: { user_id: existing._id.toString(), updated_date: now } }
            );
          }
        }
      }
      return;
    }

    const userDoc = {
      email: normEmail,
      full_name: (fullName || "").trim() || normEmail,
      phone: phone ? String(phone).trim() : null,
      password_hash,
      must_change_password: true,
      role: "user",
      app_role: role,
      // Canonical field alongside the mirror. A family account holds exactly one
      // role, so the two cannot disagree — but writing both here means no reader
      // has to know that this path predates the array.
      app_roles: [role],
      tenant_id: tenantId,
      // Provisioned by a verified administrator from within the product, and the
      // password is issued by the system rather than chosen at a public signup.
      // Verified by construction; only /api/auth/register produces unverified
      // accounts.
      email_verified: true,
      ...(studentId && { linked_student_id: String(studentId), linked_student_ids: [String(studentId)] }),
      created_date: now,
      updated_date: now,
    };
    const inserted = await database.collection("User").insertOne(userDoc);
    const userId = inserted.insertedId;

    if (role === "parent" && studentId) {
      const parent = await database.collection("Parent").findOne(
        { tenant_id: tenantId, email: normEmail },
        { projection: { _id: 1, user_id: 1 } }
      );
      if (parent && !parent.user_id) {
        await database.collection("Parent").updateOne(
          { _id: parent._id },
          { $set: { user_id: userId.toString(), updated_date: now } }
        );
      }
    }
    if (role === "student" && studentId) {
      await database.collection("User").updateOne(
        { _id: userId },
        { $set: { linked_student_id: String(studentId), linked_student_ids: [String(studentId)] } }
      );
    }

    provisioned[role] = { email: normEmail, full_name: userDoc.full_name };
  };

  await provision("student", student.student_email, student.full_name || student.name, student.student_phone);
  await provision("parent", student.parent_email, student.parent_name, student.parent_phone);

  return {
    shared: true,
    default_password: defaultPassword,
    student: provisioned.student,
    parent: provisioned.parent,
    reused: result.reused,
  };
};

/**
 * Server-authoritative user and account provisioning function.
 * Enforces:
 * - Authentication & creator role validation
 * - Strict hierarchy delegation matrix
 * - Tenant isolation (server-derived tenant for school-level creators; validated target tenant for super_admin)
 * - Required fields validation & mass-assignment prevention
 * - Duplicate email rejection
 * - Direct credential creation with bcrypt hashing
 * - Synchronized domain profile creation (Teacher, Student, Parent, ParentStudent)
 * - Rollback on partial failure
 * - Server-authoritative audit event logging
 * - Sanitized return object (zero credential / secret leak)
 */
export const provisionUser = async (creator, data = {}, { database, req, logAudit } = {}) => {
  // The creator's full role set. Delegation is answered by the union, matching
  // every other capability check: a principal who is also a teacher may still
  // provision the roles the principal row authorizes.
  const creatorRoles = appRolesOf(creator);
  const creatorRole = primaryAppRole(creator);
  const creatorTenantId = creator?.tenant_id;

  if (!creatorRole) {
    throw Object.assign(new Error("Unauthorized: authentication required"), { status: 401 });
  }

  // A single `role` is still the normal shape; `app_roles` accepts a set. Both
  // normalize through the same validator, so the two-field API is one policy.
  const requested = data.app_roles !== undefined ? data.app_roles
    : data.role !== undefined ? data.role
      : data.app_role;
  if (requested === undefined || requested === null || requested === "") {
    throw Object.assign(new Error("Target role is required"), { status: 400 });
  }

  // 1. Validate the requested role set: shape and family exclusivity first, then
  // the delegation matrix.
  //
  // canProvisionRoleSet, NOT canAssignRoleSet. This endpoint MINTS an account — it
  // creates a credential for someone who is not yet inside the school — so it is
  // governed by PROVISIONING_HIERARCHY, which has no school_admin -> school_admin
  // row. That is the difference between "a school administrator may promote a
  // colleague" and "may create a new administrator", and the two are enforced by
  // two matrices rather than by one matrix plus an exception.
  //
  // It checks EVERY requested role, not just the primary one. The family chains are
  // currently linear, which makes a primary-only check accidentally sufficient — a
  // principal whose set primary is exam_coordinator can only have teacher below it.
  // That is a property of the current hierarchy table rather than of the rule, and
  // it would stop holding the moment a hierarchy gains a branch. Delegation is a
  // per-role question, so it is asked per role.
  const provision = canProvisionRoleSet(creatorRoles, requested);
  if (provision.error) {
    const status = provision.roles.length ? 400 : 403;
    throw Object.assign(new Error(provision.error), { status });
  }
  const targetRoles = provision.roles;
  const targetRole = targetRoles[0];

  // 2. Tenant isolation & resolution
  let effectiveTenantId = null;
  if (creatorRole === "super_admin") {
    // Only super_admin may explicitly select the target tenant
    if (!data.tenant_id) {
      throw Object.assign(new Error("tenant_id is required: a super_admin provisions into a named institution"), { status: 400 });
    }
    if (!ObjectId.isValid(String(data.tenant_id))) {
      throw Object.assign(new Error("Invalid tenant_id format"), { status: 400 });
    }
    const tenant = await database
      .collection("Tenant")
      .findOne({ _id: new ObjectId(String(data.tenant_id)) });
    if (!tenant) {
      throw Object.assign(new Error("Target institution not found"), { status: 404 });
    }
    if (tenant.status && tenant.status !== "active") {
      throw Object.assign(new Error("Cannot provision an administrator for an inactive institution"), { status: 400 });
    }
    effectiveTenantId = tenant._id.toString();
  } else {
    // School-level creators MUST be bound to their own tenant
    if (!creatorTenantId) {
      throw Object.assign(new Error("Forbidden: Creator has no associated institution"), { status: 403 });
    }
    // Reject any client-supplied tenant_id attempting to escape creator's tenant
    if (data.tenant_id && String(data.tenant_id) !== String(creatorTenantId)) {
      throw Object.assign(new Error("Forbidden: Cross-tenant account creation is prohibited"), { status: 403 });
    }
    effectiveTenantId = String(creatorTenantId);
  }

  // 3. Input Validation
  const email = (data.email || data.login_id || "").toLowerCase().trim();
  if (!email) {
    throw Object.assign(new Error("Email / Login ID is required"), { status: 400 });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw Object.assign(new Error("Invalid email format"), { status: 400 });
  }

  const password = data.password;
  if (!password || typeof password !== "string" || password.length < 6) {
    throw Object.assign(new Error("Password is required and must be at least 6 characters"), { status: 400 });
  }

  const fullName = (data.full_name || data.name || "").trim();
  if (!fullName) {
    throw Object.assign(new Error("Full name is required"), { status: 400 });
  }

  // 4. Check duplicate email / login ID
  const existingUser = await database.collection("User").findOne({ email });
  if (existingUser) {
    throw Object.assign(new Error("Email already in use"), { status: 409 });
  }

  // 5. Cardinality: maximum 1 active principal per tenant. Tested against the
  // whole set, not the primary role: an account provisioned as
  // school_admin + principal IS a principal for this purpose, and keying the
  // check off the primary role would let a second one straight through.
  if (targetRoles.includes("principal")) {
    const existingPrincipal = await database.collection("User").findOne({
      tenant_id: effectiveTenantId,
      $or: [
        { app_role: "principal" },
        { app_roles: "principal" },
      ],
    });
    if (existingPrincipal) {
      throw Object.assign(new Error("An active principal already exists for this institution"), { status: 409 });
    }
  }

  // 6. Hash password using bcrypt
  const password_hash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();

  // 7. Create User record (strictly prevent client mass assignment)
  const userToInsert = {
    email,
    full_name: fullName,
    phone: data.phone ? String(data.phone).trim() : null,
    password_hash,
    // The legacy `role` field is not an authorization input (app_role is), and
    // it is always the same value for a provisioned account. It was previously
    // written as `targetRole === "school_admin" ? "user" : "user"`, a dead
    // ternary that looked like it distinguished an administrator.
    role: "user",
    // Canonical set plus the primary-role mirror, written together so they can
    // never disagree. targetRoles is already normalized, ordered and validated.
    app_role: targetRole,
    app_roles: targetRoles,
    tenant_id: effectiveTenantId,
    // Provisioned by a verified administrator from inside the product. Verified
    // by construction; only /api/auth/register creates unverified accounts.
    email_verified: true,
    created_date: now,
    updated_date: now,
  };

  const insertResult = await database.collection("User").insertOne(userToInsert);
  const userId = insertResult.insertedId;
  const userDoc = { ...userToInsert, _id: userId, id: userId.toString() };

  // 8. Synchronize domain profiles atomically with rollback on failure
  const createdEntities = [];
  try {
    if (targetRoles.includes("teacher")) {
      const existingTeacher = await database.collection("Teacher").findOne({
        tenant_id: effectiveTenantId,
        email,
      });
      if (existingTeacher) {
        await database.collection("Teacher").updateOne(
          { _id: existingTeacher._id },
          { $set: { user_id: userId.toString(), updated_date: now } }
        );
      } else {
        const teacherDoc = {
          tenant_id: effectiveTenantId,
          full_name: fullName,
          name: fullName,
          email,
          phone: data.phone ? String(data.phone).trim() : null,
          user_id: userId.toString(),
          status: "active",
          created_date: now,
          updated_date: now,
        };
        const tRes = await database.collection("Teacher").insertOne(teacherDoc);
        createdEntities.push({ collection: "Teacher", _id: tRes.insertedId });
      }
    } else if (targetRoles.includes("student")) {
      const existingStudent = await database.collection("Student").findOne({
        tenant_id: effectiveTenantId,
        $or: [{ email }, { student_email: email }],
      });
      if (existingStudent) {
        await database.collection("User").updateOne(
          { _id: userId },
          { $set: { linked_student_id: existingStudent._id.toString() } }
        );
        userDoc.linked_student_id = existingStudent._id.toString();
      } else {
        const studentDoc = {
          tenant_id: effectiveTenantId,
          full_name: fullName,
          name: fullName,
          email,
          student_email: email,
          phone: data.phone ? String(data.phone).trim() : null,
          status: "active",
          created_date: now,
          updated_date: now,
        };
        const sRes = await database.collection("Student").insertOne(studentDoc);
        createdEntities.push({ collection: "Student", _id: sRes.insertedId });
        await database.collection("User").updateOne(
          { _id: userId },
          { $set: { linked_student_id: sRes.insertedId.toString() } }
        );
        userDoc.linked_student_id = sRes.insertedId.toString();
      }
    } else if (targetRoles.includes("parent")) {
      const existingParent = await database.collection("Parent").findOne({
        tenant_id: effectiveTenantId,
        email,
      });
      let parentId = null;
      if (existingParent) {
        parentId = existingParent._id.toString();
        await database.collection("Parent").updateOne(
          { _id: existingParent._id },
          { $set: { user_id: userId.toString(), updated_date: now } }
        );
      } else {
        const parentDoc = {
          tenant_id: effectiveTenantId,
          full_name: fullName,
          name: fullName,
          email,
          phone: data.phone ? String(data.phone).trim() : null,
          user_id: userId.toString(),
          status: "active",
          created_date: now,
          updated_date: now,
        };
        const pRes = await database.collection("Parent").insertOne(parentDoc);
        createdEntities.push({ collection: "Parent", _id: pRes.insertedId });
        parentId = pRes.insertedId.toString();
      }

      // Link child student if provided and verified inside tenant
      if (data.student_id && ObjectId.isValid(String(data.student_id))) {
        const targetStudent = await database.collection("Student").findOne({
          _id: new ObjectId(String(data.student_id)),
          tenant_id: effectiveTenantId,
        });
        if (targetStudent) {
          const psDoc = {
            tenant_id: effectiveTenantId,
            parent_id: parentId,
            student_id: targetStudent._id.toString(),
            relationship: data.relationship || "parent",
            created_date: now,
            updated_date: now,
          };
          const existingPs = await database.collection("ParentStudent").findOne(
            { tenant_id: effectiveTenantId, parent_id: parentId, student_id: targetStudent._id.toString() },
            { projection: { _id: 1 } }
          );
          if (existingPs) {
            await database.collection("ParentStudent").updateOne(
              { _id: existingPs._id, tenant_id: effectiveTenantId },
              { $set: { updated_date: now } }
            );
          } else {
            const psRes = await database.collection("ParentStudent").insertOne({
              ...psDoc,
              is_primary: data.is_primary !== false,
            });
            createdEntities.push({ collection: "ParentStudent", _id: psRes.insertedId });
          }
          await database.collection("User").updateOne(
            { _id: userId },
            {
              $set: {
                linked_student_id: targetStudent._id.toString(),
                linked_student_ids: [targetStudent._id.toString()],
              },
            }
          );
          userDoc.linked_student_id = targetStudent._id.toString();
          userDoc.linked_student_ids = [targetStudent._id.toString()];
        }
      }
    }
  } catch (err) {
    // Partial failure rollback: ensure no orphaned records remain
    await database.collection("User").deleteOne({ _id: userId }).catch(() => {});
    for (const ent of createdEntities) {
      await database.collection(ent.collection).deleteOne({ _id: ent._id }).catch(() => {});
    }
    throw err;
  }

  // 9. Write server-authoritative audit event
  if (typeof logAudit === "function") {
    await logAudit(req, {
      action: "USER_PROVISIONED",
      entity_type: "User",
      entity_id: userId.toString(),
      details: `actor: [${creatorRoles.join(", ")}], target_roles: [${targetRoles.join(", ")}], tenant: ${effectiveTenantId}`,
    }).catch(() => {});
  }

  // 10. Return safe user object (strictly sanitized)
  return safeUser(userDoc);
};

export const ensureStudentEmails = async ({ database, tenantId, student, tenant }) => {
  const updates = {};
  const sEmail = emailOf(student?.student_email);
  if (!sEmail && student?.full_name) {
    const gen = await generateStudentEmail({ database, tenantId, fullName: student.full_name, tenant });
    if (gen) updates.student_email = gen;
  }
  const pEmail = emailOf(student?.parent_email);
  if (!pEmail && (student?.parent_name || (student?.full_name && sEmail))) {
    const gen = await generateParentEmail({ database, tenantId, fullName: student?.parent_name || student?.full_name, studentEmail: updates.student_email || sEmail || student?.student_email, tenant });
    if (gen) updates.parent_email = gen;
  }
  return updates;
};
