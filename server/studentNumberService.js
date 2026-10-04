import { ObjectId } from "mongodb";
import { canonicalAdmissionNumber, formatFullAdmissionNumber } from "./admissionNumberUtils.js";

const DEFAULT_NUM_DIGITS = 6;
const ADMISSION_SEQUENCE_KEY = (tenantId) => `student:admission:${tenantId}`;

export async function getTenantAdmissionConfig(database, tenantId) {
  const tenant = await database.collection("Tenant").findOne(
    { _id: new ObjectId(tenantId) },
    { projection: { admission_number_fixed_prefix: 1, admission_number_num_digits: 1 } }
  );
  const numDigits = tenant?.admission_number_num_digits && Number(tenant.admission_number_num_digits) > 0
    ? Number(tenant.admission_number_num_digits)
    : DEFAULT_NUM_DIGITS;
  return {
    num_digits: numDigits,
    fixed_prefix: tenant?.admission_number_fixed_prefix || null,
  };
}

/**
 * Non-mutating preview: the highest numeric admission core in the tenant + 1.
 * Only used for form pre-fill; the authoritative assignment happens at save time
 * via assignNextAdmissionNumber (atomic counter, so previews never burn numbers).
 */
export async function previewNextAdmissionCore(database, tenantId) {
  const config = await getTenantAdmissionConfig(database, tenantId);
  const students = await database.collection("Student").find(
    { tenant_id: tenantId, admission_number: { $exists: true, $type: "string" } },
    { projection: { admission_number: 1 } }
  ).toArray();

  let maxCore = 0;
  for (const s of students) {
    const core = canonicalAdmissionNumber(s.admission_number, { fixed_prefix: config.fixed_prefix });
    if (!core) continue;
    const numeric = Number.parseInt(core, 10);
    if (Number.isFinite(numeric) && numeric > maxCore) maxCore = numeric;
  }
  return maxCore + 1;
}

export async function previewNextAdmissionNumber(database, tenantId) {
  const config = await getTenantAdmissionConfig(database, tenantId);
  const core = await previewNextAdmissionCore(database, tenantId);
  return formatFullAdmissionNumber(
    String(core).padStart(config.num_digits, "0"),
    { fixed_prefix: config.fixed_prefix }
  );
}

/**
 * Authoritative, atomic assignment. Uses a per-tenant counter so two concurrent
 * creates can never receive the same number and numbers are never reused.
 * Returns the formatted admission number (prefix + zero-padded core).
 */
export async function assignNextAdmissionNumber(database, tenantId) {
  const config = await getTenantAdmissionConfig(database, tenantId);
  const seed = await previewNextAdmissionCore(database, tenantId);

  const counters = database.collection("SequenceCounter");
  const key = ADMISSION_SEQUENCE_KEY(tenantId);
  let result = null;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    try {
      // Two-step counter: seed once (insert-only), then atomic $inc. Mongo rejects
      // combining $setOnInsert and $inc on the same path in a single update.
      await counters.updateOne(
        { _id: key },
        { $setOnInsert: { seq: seed } },
        { upsert: true }
      );
      result = await counters.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { returnDocument: "after" }
      );
    } catch (err) {
      // Parallel first-use upserts can race on the _id key — retry.
      if (err?.code !== 11000 || attempt === 2) throw err;
    }
  }

  const core = (result?.seq ?? seed).toString().padStart(config.num_digits, "0");
  return formatFullAdmissionNumber(core, { fixed_prefix: config.fixed_prefix });
}

/**
 * Resolve the placement scope (academic year + class + section) for roll-number
 * sequencing. Mirrors the resolver used by syncStudentParentAndEnrollment.
 * Returns { resolved, academicYearId, schoolClassId, sectionId }.
 */
export async function resolvePlacementScope({ database, tenantId, doc }) {
  let schoolClassId = null;
  if (doc.school_class_id && ObjectId.isValid(doc.school_class_id)) {
    const cls = await database.collection("SchoolClass").findOne(
      { _id: new ObjectId(doc.school_class_id), tenant_id: tenantId },
      { projection: { _id: 1 } }
    );
    if (cls) schoolClassId = cls._id.toString();
  } else if (doc.class_name) {
    const cls = await database.collection("SchoolClass").findOne(
      { tenant_id: tenantId, name: String(doc.class_name).trim() },
      { projection: { _id: 1 } }
    );
    if (cls) schoolClassId = cls._id.toString();
  }

  let sectionId = null;
  if (doc.section_id && ObjectId.isValid(doc.section_id)) {
    const sec = await database.collection("Section").findOne(
      { _id: new ObjectId(doc.section_id), tenant_id: tenantId },
      { projection: { _id: 1 } }
    );
    if (sec) sectionId = sec._id.toString();
  } else if (doc.section && schoolClassId) {
    const sec = await database.collection("Section").findOne(
      { tenant_id: tenantId, school_class_id: new ObjectId(schoolClassId), name: String(doc.section).trim() },
      { projection: { _id: 1 } }
    );
    if (sec) sectionId = sec._id.toString();
  }

  const classResolved = schoolClassId !== null;
  const sectionResolved = !doc.section || sectionId !== null;

  let academicYearId = null;
  if (doc.academic_year_id && ObjectId.isValid(doc.academic_year_id)) {
    const year = await database.collection("AcademicYear").findOne(
      { _id: new ObjectId(doc.academic_year_id), tenant_id: tenantId },
      { projection: { _id: 1 } }
    );
    if (year) academicYearId = year._id.toString();
  }
  if (!academicYearId) {
    const currentYears = await database.collection("AcademicYear")
      .find({ tenant_id: tenantId, is_current: true }, { projection: { _id: 1 } })
      .toArray();
    if (currentYears.length === 1) academicYearId = currentYears[0]._id.toString();
  }

  return {
    tenant_id: tenantId,
    resolved: Boolean(academicYearId && classResolved && sectionResolved),
    academicYearId,
    schoolClassId,
    sectionId,
  };
}

function rollScopeQuery(scope) {
  const query = {
    tenant_id: scope.tenant_id,
    academic_year_id: scope.academicYearId,
    school_class_id: scope.schoolClassId,
  };
  if (scope.sectionId) query.section_id = scope.sectionId;
  else query.section_id = { $in: [null, ""] };
  return query;
}

/**
 * Preview the next roll number within (class, [section], academic year).
 * Non-numeric legacy rolls are ignored for sequencing.
 */
export async function previewNextRollNumber(database, scope) {
  if (!scope || !scope.resolved) return null;
  const students = await database.collection("Student").find(
    rollScopeQuery(scope),
    { projection: { roll_number: 1 } }
  ).toArray();

  let max = 0;
  for (const s of students) {
    if (s.roll_number == null) continue;
    const numeric = Number.parseInt(String(s.roll_number).trim(), 10);
    if (Number.isFinite(numeric) && numeric > max) max = numeric;
  }
  return max + 1;
}

/**
 * True when another student already holds `roll` in the given placement scope.
 */
export async function rollNumberTaken(database, scope, roll) {
  if (!scope || !scope.resolved || roll === "") return false;
  const query = rollScopeQuery(scope);
  query.roll_number = String(roll).trim();
  const existing = await database.collection("Student").findOne(query, { projection: { _id: 1 } });
  return Boolean(existing);
}

/**
 * True when another student in the tenant canonicalizes to the same admission
 * core as `admissionNumber`. Prevents ambiguous OMR identity matches.
 */
export async function admissionNumberInUse(database, tenantId, admissionNumber, config) {
  const requestedCanonical = canonicalAdmissionNumber(admissionNumber, { fixed_prefix: config.fixed_prefix });
  if (!requestedCanonical) return false;
  const students = await database.collection("Student").find(
    { tenant_id: tenantId, admission_number: { $exists: true, $type: "string" } },
    { projection: { admission_number: 1 } }
  ).toArray();
  return students.some(
    (s) => canonicalAdmissionNumber(s.admission_number, { fixed_prefix: config.fixed_prefix }) === requestedCanonical
  );
}

/**
 * Apply auto-assignment for a student payload at create time.
 * - admission_number blank -> atomic next-per-tenant
 * - roll_number blank     -> next per (class, section, year) when scope resolves
 * - provided values are respected; roll override validated against duplicates
 * Returns { admission_number, roll_number, rollScope, warnings }.
 */
export async function autoAssignStudentNumbers(database, tenantId, doc, { skipRoll = false } = {}) {
  const warnings = [];
  let admissionNumber = doc.admission_number ? String(doc.admission_number).trim() : "";
  let rollNumber = doc.roll_number != null ? String(doc.roll_number).trim() : "";

  if (!admissionNumber) {
    admissionNumber = await assignNextAdmissionNumber(database, tenantId);
  } else {
    const config = await getTenantAdmissionConfig(database, tenantId);
    if (await admissionNumberInUse(database, tenantId, admissionNumber, config)) {
      const err = new Error(`Admission number ${admissionNumber} is already in use.`);
      err.statusCode = 409;
      throw err;
    }
  }

  const scope = skipRoll
    ? { resolved: false }
    : await resolvePlacementScope({ database, tenantId, doc });

  if (scope.resolved && !rollNumber) {
    const nextRoll = await previewNextRollNumber(database, scope);
    if (nextRoll != null) rollNumber = String(nextRoll);
  } else if (scope.resolved && rollNumber) {
    if (await rollNumberTaken(database, scope, rollNumber)) {
      const err = new Error(
        `Roll number ${rollNumber} is already assigned in this class${scope.sectionId ? " and section" : ""}.`
      );
      err.statusCode = 409;
      throw err;
    }
  } else if (!scope.resolved && !rollNumber && doc.class_name) {
    warnings.push(`Roll number not auto-assigned: class or section could not be resolved.`);
  }

  return { admission_number: admissionNumber, roll_number: rollNumber, scope, warnings };
}