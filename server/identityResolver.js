/**
 * Identity Resolver — Strict authorization boundary for OMR student matching.
 *
 * Matches against the authoritative persisted examination roster (ExamRoster),
 * which is rebuilt from Enrollment whenever an Examination or Enrollment changes:
 *   Examination → AcademicYear → Enrollment (active) → Student → admission_number
 *
 * One roster, one truth: OMR identity, exam attendance, and evaluation all read
 * the ExamRoster. Never queries loose class_name. Valid students not on the
 * roster are rejected with NOT_ENROLLED_IN_EXAMINATION.
 */

import { ObjectId } from "mongodb";
import { canonicalAdmissionNumber } from "./admissionNumberUtils.js";
import { getExamRoster } from "./examRosterService.js";

/**
 * Resolve student identity from OMR admission number detection.
 *
 * @param {object} params
 * @param {string} params.tenantId — Tenant ID (from authenticated session)
 * @param {string} params.examinationId — Examination ID
 * @param {object} params.admissionNumberDetection — From CV engine output
 * @param {string} params.admissionNumberDetection.canonical — Normalized admission number
 * @param {string} params.admissionNumberDetection.status — "detected" | "ambiguous" | "blank"
 * @param {Db} params.db — MongoDB database instance
 * @returns {object} { identity_status, student_id, student, reason, attempted_adm }
 */
export async function resolveStudentIdentity({ tenantId, examinationId, admissionNumberDetection, db }) {
  if (!admissionNumberDetection || admissionNumberDetection.status !== "detected") {
    return {
      identity_status: "needs_review",
      reason: "UNREADABLE_ADMISSION_BUBBLES",
      student_id: null,
      student: null,
    };
  }

  const canonicalAdm = admissionNumberDetection.canonical;
  if (!canonicalAdm) {
    return {
      identity_status: "needs_review",
      reason: "UNREADABLE_ADMISSION_BUBBLES",
      student_id: null,
      student: null,
    };
  }

  // The roster service re-derives placement and rebuilds stirle rows, so the
  // exam existence check is delegated to ensureExamRoster (throws 404 if absent).
  let roster;
  try {
    roster = await getExamRoster({ tenantId: String(tenantId), examinationId: String(examinationId) });
  } catch (err) {
    if (err.statusCode === 404) {
      return {
        identity_status: "needs_review",
        reason: "EXAMINATION_NOT_FOUND",
        student_id: null,
        student: null,
      };
    }
    throw err;
  }

  if (roster.length === 0) {
    return {
      identity_status: "needs_review",
      reason: "EMPTY_EXAM_ROSTER",
      student_id: null,
      student: null,
    };
  }

  const tenantDoc = await db.collection("Tenant").findOne({ _id: new ObjectId(tenantId) }) || {};
  const tenantConfig = {
    fixed_prefix: tenantDoc.admission_number_fixed_prefix || null,
  };
  const numDigits = tenantDoc.admission_number_num_digits || 6;

  const matched = roster.filter((row) => {
    const dbCanon = canonicalAdmissionNumber(row.admission_number, tenantConfig);
    if (!dbCanon) return false;
    if (dbCanon === canonicalAdm) return true;
    if (dbCanon.padStart(numDigits, "0") === canonicalAdm) return true;
    if (canonicalAdm.padStart(numDigits, "0") === dbCanon) return true;
    if (dbCanon.replace(/^0+/, "") === canonicalAdm.replace(/^0+/, "")) return true;
    return false;
  });

  if (matched.length === 1) {
    const student = await db.collection("Student").findOne({
      _id: new ObjectId(matched[0].student_id),
      tenant_id: String(tenantId),
    });
    if (!student) {
      return {
        identity_status: "needs_review",
        reason: "NOT_ENROLLED_IN_EXAMINATION",
        attempted_adm: canonicalAdm,
        student_id: null,
        student: null,
      };
    }
    return {
      identity_status: "matched",
      student_id: student._id.toString(),
      student,
      reason: null,
    };
  }

  if (matched.length === 0) {
    return {
      identity_status: "needs_review",
      reason: "NOT_ENROLLED_IN_EXAMINATION",
      attempted_adm: canonicalAdm,
      student_id: null,
      student: null,
    };
  }

  // Load-bearing defense against legacy unindexed duplicates
  return {
    identity_status: "needs_review",
    reason: "MULTIPLE_ROSTER_MATCHES",
    attempted_adm: canonicalAdm,
    student_id: null,
    student: null,
  };
}