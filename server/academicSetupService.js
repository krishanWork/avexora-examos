import { ObjectId } from "mongodb";
import { db, getClient } from "./db.js";
import { APP_ROLES, appRolesOf } from "./rbac.js";

/**
 * Validates role and determines target tenant_id.
 * - school_admin: strictly req.user.tenant_id
 * - super_admin: validated target_tenant_id from payload/body
 * - all other roles: rejected
 */
export async function authorizeAcademicSetup(user, bodyTenantId) {
  // Multi-role aware: the gate is a union over held roles, and the branches below
  // are keyed on the PRIMARY role because they decide which tenant the write
  // lands in. An account that is primarily a school administrator but also holds
  // teacher is admitted by the school_admin branch, which is correct — it is
  // still scoped to its own institution.
  const roles = appRolesOf(user);
  if (!roles.length) {
    const err = new Error("Authentication required");
    err.statusCode = 401;
    throw err;
  }

  const role = roles[0];

  if (role === APP_ROLES.SCHOOL_ADMIN) {
    if (!user.tenant_id) {
      const err = new Error("school_admin has no tenant_id assigned");
      err.statusCode = 403;
      throw err;
    }
    // If client supplied a tenant_id, it must match user.tenant_id
    if (bodyTenantId && String(bodyTenantId).trim() !== String(user.tenant_id).trim()) {
      const err = new Error("Forbidden: school_admin cannot operate on another tenant");
      err.statusCode = 403;
      throw err;
    }
    return String(user.tenant_id).trim();
  }

  if (role === APP_ROLES.SUPER_ADMIN) {
    if (!bodyTenantId || typeof bodyTenantId !== "string" || !bodyTenantId.trim()) {
      const err = new Error("target_tenant_id is required for super_admin academic setup");
      err.statusCode = 400;
      throw err;
    }
    const database = await db();
    const targetTenantId = bodyTenantId.trim();
    let tenantDoc = null;

    if (ObjectId.isValid(targetTenantId)) {
      tenantDoc = await database.collection("Tenant").findOne({
        _id: new ObjectId(targetTenantId),
        status: { $ne: "deleted" },
      });
    }
    if (!tenantDoc) {
      tenantDoc = await database.collection("Tenant").findOne({
        tenant_id: targetTenantId,
        status: { $ne: "deleted" },
      });
    }

    if (!tenantDoc) {
      const err = new Error(`Target tenant not found or inactive: ${targetTenantId}`);
      err.statusCode = 400;
      throw err;
    }

    return String(tenantDoc.tenant_id || tenantDoc._id.toString());
  }

  const err = new Error(`Forbidden: Role '${role}' is not authorized to configure academic structure`);
  err.statusCode = 403;
  throw err;
}

/**
 * Atomic setup of academic structure (AcademicYear, SchoolClasses, Sections, Subjects).
 * Uses MongoDB session transaction when supported, with Safe Additive semantics.
 */
export async function setupAcademicStructure({ user, payload }) {
  const targetTenantInput = payload?.target_tenant_id || payload?.tenant_id;
  const tenantId = await authorizeAcademicSetup(user, targetTenantInput);

  // `roles` is read from the audit entry below, but it was only ever computed inside
  // authorizeAcademicSetup, so it was not in scope here and every authorized call threw
  // ReferenceError: roles is not defined and returned 500. Recompute it from the same
  // helper rather than reading it off the authorization result, so the audit records the
  // full held set for a multi-role actor.
  const roles = appRolesOf(user);

  const { academic_year, classes = [], subjects = [] } = payload || {};

  if (!academic_year || !academic_year.name || typeof academic_year.name !== "string" || !academic_year.name.trim()) {
    const err = new Error("academic_year.name is required");
    err.statusCode = 400;
    throw err;
  }

  const client = await getClient();
  const database = await db();

  // Result metrics - strictly server-derived
  const created = { classes: [], sections: [], subjects: [] };
  const skipped = { classes: [], sections: [], subjects: [] };
  const conflicts = [];
  let createdCapacity = 0;
  let resolvedAcademicYear = null;
  let wasYearCreated = false;

  const executeSetup = async (session = null) => {
    const sessionOpt = session ? { session } : {};
    const now = new Date().toISOString();

    // 1. Resolve or Create AcademicYear
    const cleanYearName = academic_year.name.trim();
    let existingYear = await database.collection("AcademicYear").findOne(
      { tenant_id: tenantId, name: cleanYearName },
      sessionOpt
    );

    if (existingYear) {
      resolvedAcademicYear = existingYear;
      wasYearCreated = false;
      if (academic_year.is_current) {
        await database.collection("AcademicYear").updateMany(
          { tenant_id: tenantId, _id: { $ne: existingYear._id } },
          { $set: { is_current: false, updated_date: now } },
          sessionOpt
        );
        await database.collection("AcademicYear").updateOne(
          { _id: existingYear._id },
          { $set: { is_current: true, updated_date: now } },
          sessionOpt
        );
      }
    } else {
      if (academic_year.is_current) {
        await database.collection("AcademicYear").updateMany(
          { tenant_id: tenantId },
          { $set: { is_current: false, updated_date: now } },
          sessionOpt
        );
      }
      const yearDoc = {
        tenant_id: tenantId,
        name: cleanYearName,
        start_date: academic_year.start_date || "",
        end_date: academic_year.end_date || "",
        status: academic_year.status || "active",
        is_current: Boolean(academic_year.is_current),
        created_date: now,
        updated_date: now,
      };
      const insertRes = await database.collection("AcademicYear").insertOne(yearDoc, sessionOpt);
      resolvedAcademicYear = { ...yearDoc, _id: insertRes.insertedId };
      wasYearCreated = true;
    }

    // 2. Safe Additive Classes and Sections
    const existingClasses = await database.collection("SchoolClass").find(
      { tenant_id: tenantId },
      sessionOpt
    ).toArray();

    const classMap = new Map();
    for (const ec of existingClasses) {
      classMap.set(ec.name.trim().toLowerCase(), ec);
    }

    for (let idx = 0; idx < classes.length; idx++) {
      const cls = classes[idx];
      if (!cls || !cls.name || typeof cls.name !== "string" || !cls.name.trim()) continue;

      const cleanClassName = cls.name.trim();
      const normClassKey = cleanClassName.toLowerCase();
      let classDoc = classMap.get(normClassKey);

      if (classDoc) {
        skipped.classes.push(cleanClassName);
      } else {
        const newClass = {
          tenant_id: tenantId,
          name: cleanClassName,
          grade_level: cls.grade_level || "general",
          stage: cls.stage || "general",
          order: typeof cls.order === "number" ? cls.order : idx + 1,
          created_date: now,
          updated_date: now,
        };
        const insClass = await database.collection("SchoolClass").insertOne(newClass, sessionOpt);
        classDoc = { ...newClass, _id: insClass.insertedId };
        classMap.set(normClassKey, classDoc);
        created.classes.push(cleanClassName);
      }

      // Sections for this class
      const classIdStr = classDoc._id.toString();
      const existingSections = await database.collection("Section").find(
        { tenant_id: tenantId, school_class_id: classIdStr },
        sessionOpt
      ).toArray();

      const secMap = new Map();
      for (const es of existingSections) {
        secMap.set(es.name.trim().toLowerCase(), es);
      }

      const requestedSections = Array.isArray(cls.sections) ? cls.sections : [];
      for (const sec of requestedSections) {
        if (!sec || !sec.name || typeof sec.name !== "string" || !sec.name.trim()) continue;

        const cleanSecName = sec.name.trim();
        const normSecKey = cleanSecName.toLowerCase();
        const existingSec = secMap.get(normSecKey);

        if (existingSec) {
          skipped.sections.push({ class: cleanClassName, section: cleanSecName });
        } else {
          const cap = Number.isInteger(Number(sec.capacity)) && Number(sec.capacity) > 0
            ? Number(sec.capacity)
            : 40;

          const newSec = {
            tenant_id: tenantId,
            school_class_id: classIdStr,
            name: cleanSecName,
            stream: sec.stream ? String(sec.stream).trim() : null,
            capacity: cap,
            room_number: sec.room_number ? String(sec.room_number).trim() : null,
            created_date: now,
            updated_date: now,
          };
          const insSec = await database.collection("Section").insertOne(newSec, sessionOpt);
          secMap.set(normSecKey, { ...newSec, _id: insSec.insertedId });
          created.sections.push({
            class: cleanClassName,
            section: cleanSecName,
            capacity: cap,
            stream: newSec.stream,
          });
          createdCapacity += cap;
        }
      }
    }

    // 3. Safe Additive Subjects
    const existingSubjects = await database.collection("Subject").find(
      { tenant_id: tenantId },
      sessionOpt
    ).toArray();

    const subjNameMap = new Map();
    const subjCodeMap = new Map();
    for (const es of existingSubjects) {
      if (es.name) subjNameMap.set(es.name.trim().toLowerCase(), es);
      if (es.code) subjCodeMap.set(es.code.trim().toLowerCase(), es);
    }

    for (const subj of subjects) {
      if (!subj || !subj.name || typeof subj.name !== "string" || !subj.name.trim()) continue;

      const cleanSubjName = subj.name.trim();
      const cleanSubjCode = subj.code ? subj.code.trim() : null;
      const normSubjNameKey = cleanSubjName.toLowerCase();
      const normSubjCodeKey = cleanSubjCode ? cleanSubjCode.toLowerCase() : null;

      const matchByName = subjNameMap.get(normSubjNameKey);
      const matchByCode = normSubjCodeKey ? subjCodeMap.get(normSubjCodeKey) : null;

      if (matchByName || matchByCode) {
        skipped.subjects.push(cleanSubjName);
      } else {
        const rawStreams = Array.isArray(subj.streams)
          ? subj.streams
          : typeof subj.stream === "string" && subj.stream
            ? [subj.stream]
            : [];
        const cleanStreams = [...new Set(rawStreams.map((s) => String(s).trim()).filter(Boolean))];
        const newSubj = {
          tenant_id: tenantId,
          name: cleanSubjName,
          code: cleanSubjCode || "",
          department: subj.department ? String(subj.department).trim() : "General",
          category: subj.category ? String(subj.category).trim() : "Core",
          credits: Number(subj.credits) > 0 ? Number(subj.credits) : 1,
          applicable_stages: Array.isArray(subj.stages)
            ? subj.stages
            : Array.isArray(subj.applicable_stages)
            ? subj.applicable_stages
            : [],
          ...(cleanStreams.length > 0 && { streams: cleanStreams }),
          created_date: now,
          updated_date: now,
        };
        const insSubj = await database.collection("Subject").insertOne(newSubj, sessionOpt);
        const savedSubj = { ...newSubj, _id: insSubj.insertedId };
        subjNameMap.set(normSubjNameKey, savedSubj);
        if (normSubjCodeKey) subjCodeMap.set(normSubjCodeKey, savedSubj);
        created.subjects.push(cleanSubjName);
      }
    }

    // 4. Audit Log entry
    await database.collection("AuditLog").insertOne(
      {
        tenant_id: tenantId,
        actor_name: user.full_name || user.email || "School Admin",
        actor_role: roles.join(","),
        action: "SETUP_ACADEMIC_STRUCTURE",
        entity_type: "AcademicSetup",
        entity_id: resolvedAcademicYear?._id ? resolvedAcademicYear._id.toString() : "",
        details: JSON.stringify({
          academic_year: cleanYearName,
          created_classes: created.classes.length,
          created_sections: created.sections.length,
          created_subjects: created.subjects.length,
          created_capacity: createdCapacity,
          skipped_classes: skipped.classes.length,
          skipped_sections: skipped.sections.length,
          skipped_subjects: skipped.subjects.length,
        }),
        created_date: now,
        updated_date: now,
      },
      sessionOpt
    );
  };

  // Attempt transaction execution via MongoDB session
  let session = null;
  try {
    session = client.startSession();
  } catch (err) {
    session = null;
  }

  if (session) {
    try {
      await session.withTransaction(async () => {
        await executeSetup(session);
      });
    } catch (err) {
      // If MongoDB deployment is a standalone mongod that does not support transactions,
      // fallback gracefully to non-transactional execution.
      if (
        err.message?.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
        err.message?.includes("Transactions are not supported")
      ) {
        await executeSetup(null);
      } else {
        throw err;
      }
    } finally {
      await session.endSession();
    }
  } else {
    await executeSetup(null);
  }

  return {
    success: true,
    academic_year: {
      id: resolvedAcademicYear?._id ? resolvedAcademicYear._id.toString() : null,
      name: resolvedAcademicYear?.name || academic_year.name,
      action: wasYearCreated ? "created" : "reused",
      is_current: resolvedAcademicYear?.is_current || false,
    },
    created: {
      classes: created.classes,
      sections: created.sections,
      subjects: created.subjects,
      total_classes_count: created.classes.length,
      total_sections_count: created.sections.length,
      total_subjects_count: created.subjects.length,
      total_capacity: createdCapacity,
    },
    skipped: {
      classes: skipped.classes,
      sections: skipped.sections,
      subjects: skipped.subjects,
    },
    conflicts,
  };
}
