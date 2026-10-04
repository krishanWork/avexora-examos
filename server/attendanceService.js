import { ObjectId } from "mongodb";
import { db, getClient } from "./db.js";
import { getExamRoster } from "./examRosterService.js";
import { EXAM_WORKFLOW_ROLES, APP_ROLES, appRolesOf, primaryAppRole, hasAnyRole } from "./rbac.js";

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * Authorize attendance operation for the user.
 * Roles: school_admin, principal, exam_coordinator can manage any class in tenant.
 * Teacher can only manage assigned classes & sections.
 */
export async function authorizeAttendanceAction(user, { school_class_id, section_id }) {
  if (!user || !user.tenant_id) {
    const err = new Error("Authentication required with active tenant context");
    err.statusCode = 401;
    throw err;
  }

  // Two rules, matching the rest of the codebase. The tenant-wide branch is a
  // capability, so ANY held exam-workflow role earns it. The teacher branch is a
  // SCOPE narrowing to assigned classes, so it applies only when the PRIMARY role
  // is teacher — a teacher who is also an exam coordinator manages the whole
  // institution through the branch above instead of being held to the class
  // ceiling of the teaching job they also do.
  const roles = appRolesOf(user);
  const role = primaryAppRole(user);
  const tenantId = String(user.tenant_id);

  if (hasAnyRole({ user }, EXAM_WORKFLOW_ROLES)) {
    return { role, tenantId, isTeacher: false };
  }

  if (role === APP_ROLES.TEACHER) {
    const database = await db();
    const teacher = await database.collection("Teacher").findOne({
      tenant_id: tenantId,
      $or: [
        { user_id: String(user._id || user.id) },
        { email: normalizeEmail(user.email) },
      ],
      status: "active",
    });

    if (!teacher) {
      const err = new Error("Active teacher record not found for this account");
      err.statusCode = 403;
      throw err;
    }

    const assignments = await database.collection("TeacherAssignment").find({
      tenant_id: tenantId,
      teacher_id: teacher._id.toString(),
      status: { $ne: "inactive" },
    }).toArray();

    const allowedClassIds = new Set([
      ...(Array.isArray(teacher.assigned_class_ids) ? teacher.assigned_class_ids : []),
      ...assignments.map((a) => String(a.school_class_id)),
    ].filter(Boolean));

    if (school_class_id && !allowedClassIds.has(String(school_class_id))) {
      const err = new Error("Teacher is not assigned to mark attendance for this class");
      err.statusCode = 403;
      throw err;
    }

    if (section_id && section_id !== "all") {
      const assignedSections = assignments
        .filter((a) => String(a.school_class_id) === String(school_class_id) && a.section_id)
        .map((a) => String(a.section_id));

      if (assignedSections.length > 0 && !assignedSections.includes(String(section_id))) {
        const err = new Error("Teacher is not assigned to mark attendance for this section");
        err.statusCode = 403;
        throw err;
      }
    }

    return { role, tenantId, isTeacher: true, teacher };
  }

  const err = new Error(`Role '${role}' is not authorized to record or view attendance management`);
  err.statusCode = 403;
  throw err;
}

/**
 * Atomic batch save of student attendance with roster & academic-year validation.
 */
export async function saveBatchAttendance({ user, payload }) {
  const {
    academic_year_id,
    school_class_id,
    section_id,
    date,
    records = [],
  } = payload || {};

  if (!academic_year_id) {
    const err = new Error("academic_year_id is required");
    err.statusCode = 400;
    throw err;
  }
  if (!school_class_id) {
    const err = new Error("school_class_id is required");
    err.statusCode = 400;
    throw err;
  }
  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const err = new Error("Valid date in YYYY-MM-DD format is required");
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(records) || records.length === 0) {
    const err = new Error("At least one attendance record is required in records array");
    err.statusCode = 400;
    throw err;
  }

  const { tenantId, role } = await authorizeAttendanceAction(user, { school_class_id, section_id });
  const database = await db();
  const client = await getClient();

  // 1. Resolve & Validate Academic Year Date Boundary
  let academicYearQuery = { tenant_id: tenantId };
  if (ObjectId.isValid(academic_year_id)) {
    academicYearQuery._id = new ObjectId(academic_year_id);
  } else {
    academicYearQuery.name = String(academic_year_id);
  }
  const academicYear = await database.collection("AcademicYear").findOne(academicYearQuery);
  if (!academicYear) {
    const err = new Error("Academic year not found for this tenant");
    err.statusCode = 400;
    throw err;
  }

  const cleanYearId = academicYear._id.toString();
  if (academicYear.start_date && date < academicYear.start_date) {
    const err = new Error(`Attendance date ${date} precedes academic year start date (${academicYear.start_date})`);
    err.statusCode = 400;
    throw err;
  }
  if (academicYear.end_date && date > academicYear.end_date) {
    const err = new Error(`Attendance date ${date} exceeds academic year end date (${academicYear.end_date})`);
    err.statusCode = 400;
    throw err;
  }

  // 2. Resolve Class & Section
  const classDoc = await database.collection("SchoolClass").findOne({
    tenant_id: tenantId,
    ...(ObjectId.isValid(school_class_id) ? { _id: new ObjectId(school_class_id) } : { name: school_class_id }),
  });
  if (!classDoc) {
    const err = new Error("School class not found for this tenant");
    err.statusCode = 400;
    throw err;
  }
  const cleanClassId = classDoc._id.toString();

  let cleanSectionId = null;
  if (section_id && section_id !== "all") {
    const secDoc = await database.collection("Section").findOne({
      tenant_id: tenantId,
      ...(ObjectId.isValid(section_id) ? { _id: new ObjectId(section_id) } : { name: section_id, school_class_id: cleanClassId }),
    });
    if (!secDoc) {
      const err = new Error("Section not found for this tenant");
      err.statusCode = 400;
      throw err;
    }
    if (String(secDoc.school_class_id) !== cleanClassId) {
      const err = new Error("Section does not belong to specified school class");
      err.statusCode = 400;
      throw err;
    }
    cleanSectionId = secDoc._id.toString();
  }

  // 3. Resolve Active Roster (Enrollment first, fall back to active Student records)
  const enrollmentQuery = {
    tenant_id: tenantId,
    academic_year_id: cleanYearId,
    school_class_id: cleanClassId,
    ...(cleanSectionId ? { section_id: cleanSectionId } : {}),
  };
  const enrollments = await database.collection("Enrollment").find(enrollmentQuery).toArray();
  const enrolledStudentIds = new Set(enrollments.map((e) => String(e.student_id)));

  // Fallback: also pull students assigned to this class/section in Student collection
  const studentQuery = {
    tenant_id: tenantId,
    school_class_id: cleanClassId,
    ...(cleanSectionId ? { section_id: cleanSectionId } : {}),
    status: { $ne: "inactive" },
  };
  const directStudents = await database.collection("Student").find(studentQuery, { projection: { _id: 1, section_id: 1 } }).toArray();
  const studentSectionMap = new Map();
  for (const s of directStudents) {
    const sid = s._id.toString();
    enrolledStudentIds.add(sid);
    studentSectionMap.set(sid, s.section_id || cleanSectionId);
  }
  for (const e of enrollments) {
    studentSectionMap.set(String(e.student_id), e.section_id || cleanSectionId);
  }

  // 4. Validate All Records in Payload
  const validStatuses = new Set(["present", "absent", "late", "excused"]);
  const bulkOperations = [];
  const now = new Date().toISOString();
  const markedBy = user.full_name || user.email || role;

  for (let i = 0; i < records.length; i++) {
    const item = records[i];
    if (!item || !item.student_id) {
      const err = new Error(`Record at index ${i} is missing student_id`);
      err.statusCode = 400;
      throw err;
    }

    const sid = String(item.student_id);
    if (!enrolledStudentIds.has(sid)) {
      const err = new Error(`Student ${sid} is not enrolled in class ${classDoc.name} for academic year ${academicYear.name}`);
      err.statusCode = 400;
      throw err;
    }

    const status = String(item.status || "present").toLowerCase();
    if (!validStatuses.has(status)) {
      const err = new Error(`Invalid attendance status '${item.status}'. Must be present, absent, late, or excused`);
      err.statusCode = 400;
      throw err;
    }

    const assignedSecId = cleanSectionId || studentSectionMap.get(sid) || null;

    bulkOperations.push({
      updateOne: {
        filter: {
          tenant_id: tenantId,
          academic_year_id: cleanYearId,
          student_id: sid,
          date,
        },
        update: {
          $set: {
            school_class_id: cleanClassId,
            section_id: assignedSecId,
            status,
            remarks: typeof item.remarks === "string" ? item.remarks.trim() : "",
            marked_by: markedBy,
            updated_date: now,
          },
          $setOnInsert: {
            created_date: now,
          },
        },
        upsert: true,
      },
    });
  }

  // 5. Transactional Execution via MongoDB Session
  let session = null;
  let isTransactional = false;
  try {
    session = client.startSession();
  } catch (_e) {
    session = null;
  }

  const executeBulk = async (s = null) => {
    const opt = s ? { session: s } : {};
    return await database.collection("Attendance").bulkWrite(bulkOperations, opt);
  };

  let bulkResult = null;
  if (session) {
    try {
      await session.withTransaction(async () => {
        bulkResult = await executeBulk(session);
      });
      isTransactional = true;
    } catch (err) {
      // If standalone mongod doesn't support replica set transactions, fallback to validated batch
      if (
        err.message?.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
        err.message?.includes("Transactions are not supported") ||
        // A standalone deployment rejects retryable writes too, and it does so at
        // session start rather than at commit — so this is the message a local or
        // single-node mongod actually produces, and it was missing here. Without it the
        // fallback above never ran and every saveBatchAttendance returned 500 in
        // development, which is exactly the case the fallback exists to serve.
        err.message?.includes("retryable writes")
      ) {
        bulkResult = await executeBulk(null);
        isTransactional = false;
      } else {
        throw err;
      }
    } finally {
      await session.endSession();
    }
  } else {
    bulkResult = await executeBulk(null);
    isTransactional = false;
  }

  // Log Audit record
  await database.collection("AuditLog").insertOne({
    tenant_id: tenantId,
    actor_name: user.full_name || user.email,
    actor_role: role,
    action: "BATCH_RECORD_ATTENDANCE",
    entity_type: "Attendance",
    details: JSON.stringify({
      academic_year_id: cleanYearId,
      class_id: cleanClassId,
      section_id: cleanSectionId,
      date,
      count: records.length,
      upserted: bulkResult.upsertedCount,
      modified: bulkResult.modifiedCount,
      transactional: isTransactional,
    }),
    created_date: now,
  }).catch(() => {});

  return {
    success: true,
    academic_year_id: cleanYearId,
    school_class_id: cleanClassId,
    section_id: cleanSectionId,
    date,
    total_processed: records.length,
    upserted_count: bulkResult.upsertedCount || 0,
    modified_count: bulkResult.modifiedCount || 0,
    matched_count: bulkResult.matchedCount || 0,
    transactional: isTransactional,
  };
}

/**
 * Aggregates marked dates & attendance rates across the academic year for a class/section.
 * Returns 3-state summary: 'marked', 'partially_marked', 'unmarked'.
 */
export async function getAttendanceHistory({ user, payload }) {
  const {
    academic_year_id,
    school_class_id,
    section_id,
    month,
  } = payload || {};

  if (!academic_year_id) {
    const err = new Error("academic_year_id is required");
    err.statusCode = 400;
    throw err;
  }
  if (!school_class_id) {
    const err = new Error("school_class_id is required");
    err.statusCode = 400;
    throw err;
  }

  const { tenantId } = await authorizeAttendanceAction(user, { school_class_id, section_id });
  const database = await db();

  // Resolve Academic Year
  const yearQuery = { tenant_id: tenantId };
  if (ObjectId.isValid(academic_year_id)) {
    yearQuery._id = new ObjectId(academic_year_id);
  } else {
    yearQuery.name = String(academic_year_id);
  }
  const academicYear = await database.collection("AcademicYear").findOne(yearQuery);
  if (!academicYear) {
    const err = new Error("Academic year not found");
    err.statusCode = 400;
    throw err;
  }
  const cleanYearId = academicYear._id.toString();

  // Resolve Class
  const classDoc = await database.collection("SchoolClass").findOne({
    tenant_id: tenantId,
    ...(ObjectId.isValid(school_class_id) ? { _id: new ObjectId(school_class_id) } : { name: school_class_id }),
  });
  if (!classDoc) {
    const err = new Error("School class not found");
    err.statusCode = 400;
    throw err;
  }
  const cleanClassId = classDoc._id.toString();

  // Resolve Section if specified
  let cleanSectionId = null;
  if (section_id && section_id !== "all") {
    const secDoc = await database.collection("Section").findOne({
      tenant_id: tenantId,
      ...(ObjectId.isValid(section_id) ? { _id: new ObjectId(section_id) } : { name: section_id, school_class_id: cleanClassId }),
    });
    if (secDoc) cleanSectionId = secDoc._id.toString();
  }

  // 1. Calculate Active Enrolled Roster Size
  const enrollQuery = {
    tenant_id: tenantId,
    academic_year_id: cleanYearId,
    school_class_id: cleanClassId,
    ...(cleanSectionId ? { section_id: cleanSectionId } : {}),
  };
  let totalEnrolled = await database.collection("Enrollment").countDocuments(enrollQuery);
  if (totalEnrolled === 0) {
    totalEnrolled = await database.collection("Student").countDocuments({
      tenant_id: tenantId,
      school_class_id: cleanClassId,
      ...(cleanSectionId ? { section_id: cleanSectionId } : {}),
      status: { $ne: "inactive" },
    });
  }

  // 2. Query Marked Records Aggregation
  const matchCriteria = {
    tenant_id: tenantId,
    academic_year_id: cleanYearId,
    school_class_id: cleanClassId,
    ...(cleanSectionId ? { section_id: cleanSectionId } : {}),
  };
  if (month && typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    matchCriteria.date = { $regex: `^${month}` };
  }

  const grouped = await database.collection("Attendance").aggregate([
    { $match: matchCriteria },
    {
      $group: {
        _id: "$date",
        marked_count: { $sum: 1 },
        present_count: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
        absent_count: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
        late_count: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
        excused_count: { $sum: { $cond: [{ $eq: ["$status", "excused"] }, 1, 0] } },
      },
    },
    { $sort: { _id: -1 } },
  ]).toArray();

  let cumulativePresent = 0;
  let cumulativeLate = 0;
  let cumulativeDenominator = 0;

  const history = grouped.map((row) => {
    const marked = row.marked_count;
    const present = row.present_count;
    const late = row.late_count;
    const absent = row.absent_count;
    const excused = row.excused_count;

    let status = "unmarked";
    if (marked === 0) {
      status = "unmarked";
    } else if (totalEnrolled > 0 && marked < totalEnrolled) {
      status = "partially_marked";
    } else {
      status = "marked";
    }

    const denominator = totalEnrolled > 0 ? totalEnrolled : marked;
    const ratePct = denominator > 0 ? Math.round(((present + late) / denominator) * 100) : 0;

    cumulativePresent += present;
    cumulativeLate += late;
    cumulativeDenominator += denominator;

    return {
      date: row._id,
      status,
      marked_count: marked,
      total_enrolled: totalEnrolled,
      present_count: present,
      absent_count: absent,
      late_count: late,
      excused_count: excused,
      rate_pct: Math.min(100, ratePct),
    };
  });

  const overallAverageRate = cumulativeDenominator > 0
    ? Math.round(((cumulativePresent + cumulativeLate) / cumulativeDenominator) * 100)
    : 0;

  return {
    academic_year: {
      id: cleanYearId,
      name: academicYear.name,
      start_date: academicYear.start_date || "",
      end_date: academicYear.end_date || "",
    },
    class: {
      id: cleanClassId,
      name: classDoc.name,
    },
    section_id: cleanSectionId,
    total_enrolled: totalEnrolled,
    marked_days_count: history.length,
    overall_average_rate: overallAverageRate,
    history,
  };
}

// ============================================================================
// EXAM ATTENDANCE FUNCTIONS
// ============================================================================

/**
 * Load an examination and assert tenant ownership when a user context is given.
 * Availability + secret subspace are never a factor: exam attendance is reachable
 * through authorized exam-workflow RPCs only (handled by the caller).
 */
async function loadExamForAttendance({ examination_id, user }) {
  if (!examination_id || !ObjectId.isValid(examination_id)) {
    const err = new Error("valid examination_id is required");
    err.statusCode = 400;
    throw err;
  }
  const database = await db();
  const exam = await database.collection("Examination").findOne({ _id: new ObjectId(examination_id) });
  if (!exam) {
    const err = new Error("Examination not found");
    err.statusCode = 404;
    throw err;
  }
  if (user && user.tenant_id && String(exam.tenant_id) !== String(user.tenant_id)) {
    const err = new Error("Examination not found");
    err.statusCode = 404;
    throw err;
  }
  return exam;
}

/**
 * Record exam attendance for a student (idempotent upsert).
 * The record is enriched with the exam's academic_year, class/section placement
 * (from the roster/Enrollment) and exam_date so exam records never collide with
 * daily attendance and teacher scoping works on school_class_id.
 * Called by processOMRSheet when identity_status === "matched".
 */
export async function recordExamAttendance({ tenant_id, examination_id, student_id, omr_sheet_id, status = "present" }) {
  const database = await db();
  const now = new Date().toISOString();

  const exam = await loadExamForAttendance({ examination_id });

  const scope = {
    school_class_id: null,
    section_id: null,
    academic_year_id: exam.academic_year_id ? String(exam.academic_year_id) : null,
    date: exam.exam_date || null,
  };

  // Placement is authoritative from the student's Enrollment when available.
  if (scope.academic_year_id) {
    const enrollment = await database.collection("Enrollment").findOne(
      {
        tenant_id: String(tenant_id),
        student_id: String(student_id),
        academic_year_id: scope.academic_year_id,
        status: { $nin: ["withdrawn", "inactive"] },
      },
      { projection: { school_class_id: 1, section_id: 1 } }
    );
    if (enrollment) {
      scope.school_class_id = enrollment.school_class_id ? String(enrollment.school_class_id) : null;
      scope.section_id = enrollment.section_id ? String(enrollment.section_id) : null;
    }
  }
  if (!scope.school_class_id) {
    const examClassIds = Array.isArray(exam.school_class_ids) && exam.school_class_ids.length
      ? exam.school_class_ids
      : exam.school_class_id ? [exam.school_class_id] : [];
    scope.school_class_id = examClassIds[0] ? String(examClassIds[0]) : null;
  }
  if (!scope.section_id) {
    const examSectionIds = Array.isArray(exam.section_ids) && exam.section_ids.length
      ? exam.section_ids
      : exam.section_id ? [exam.section_id] : [];
    scope.section_id = examSectionIds[0] ? String(examSectionIds[0]) : null;
  }

  const set = {
    status,
    omr_sheet_id,
    scanned_at: now,
    type: "exam",
    updated_date: now,
  };
  if (scope.academic_year_id) set.academic_year_id = scope.academic_year_id;
  if (scope.school_class_id) set.school_class_id = scope.school_class_id;
  if (scope.section_id) set.section_id = scope.section_id;
  if (scope.date) set.date = scope.date;

  await database.collection("Attendance").updateOne(
    { tenant_id: String(tenant_id), examination_id: String(examination_id), student_id: String(student_id) },
    { $set: set, $setOnInsert: { created_date: now } },
    { upsert: true }
  );

  return { success: true, tenant_id: String(tenant_id), examination_id: String(examination_id), student_id: String(student_id), status };
}

/**
 * Get exam attendance for an examination.
 * The roster is the authoritative ExamRoster (persisted + rebuilt from Enrollment),
 * never a client-supplied list. Returns categorized lists: present, absent,
 * needs_review, unmarked.
 */
export async function getExamAttendance({ examination_id, user }) {
  const database = await db();

  const exam = await loadExamForAttendance({ examination_id, user });
  const tenantId = String(exam.tenant_id);

  const roster = await getExamRoster({ tenantId, examinationId: String(examination_id) });

  const attendanceRecords = await database.collection("Attendance").find({
    tenant_id: tenantId,
    examination_id: String(examination_id),
  }).toArray();

  const attendanceMap = new Map(attendanceRecords.map((a) => [String(a.student_id), a]));

  const present = [];
  const absent = [];
  const needsReview = [];
  const unmarked = [];

  for (const row of roster) {
    const record = attendanceMap.get(row.student_id);

    const entry = {
      student_id: row.student_id,
      admission_number: row.admission_number || "",
      full_name: row.full_name || "",
      roll_number: row.roll_number || "",
      school_class_id: row.school_class_id,
      section_id: row.section_id,
    };

    if (!record) {
      entry.status = "unmarked";
      unmarked.push(entry);
    } else if (record.status === "present") {
      entry.status = "present";
      entry.omr_sheet_id = record.omr_sheet_id;
      entry.scanned_at = record.scanned_at;
      present.push(entry);
    } else if (record.status === "needs_review") {
      entry.status = "needs_review";
      entry.omr_sheet_id = record.omr_sheet_id;
      needsReview.push(entry);
    } else if (record.status === "absent") {
      entry.status = "absent";
      absent.push(entry);
    } else {
      entry.status = record.status;
      unmarked.push(entry);
    }
  }

  const totalEnrolled = roster.length;
  const percentage = totalEnrolled > 0 ? Math.round((present.length / totalEnrolled) * 100) : 0;

  return {
    examination_id: String(examination_id),
    tenant_id: tenantId,
    total_enrolled: totalEnrolled,
    present_count: present.length,
    absent_count: absent.length,
    needs_review_count: needsReview.length,
    unmarked_count: unmarked.length,
    percentage,
    present,
    absent,
    needs_review: needsReview,
    unmarked,
  };
}

/**
 * Reconcile exam absentees — flips only strictly unmarked students to absent.
 * Exempts students with needs_review or present status. The roster is the
 * authoritative persisted ExamRoster.
 */
export async function reconcileExamAbsentees({ examination_id, user }) {
  const database = await db();
  const now = new Date().toISOString();

  const exam = await loadExamForAttendance({ examination_id, user });
  const tenantId = String(exam.tenant_id);

  const roster = await getExamRoster({ tenantId, examinationId: String(examination_id) });

  const attendanceRecords = await database.collection("Attendance").find({
    tenant_id: tenantId,
    examination_id: String(examination_id),
  }).toArray();

  const attendanceMap = new Map(attendanceRecords.map((a) => [String(a.student_id), a.status]));

  const bulkOps = [];
  let markedAbsent = 0;

  for (const row of roster) {
    const status = attendanceMap.get(row.student_id);
    if (!status) {
      const set = { status: "absent", updated_date: now, type: "exam" };
      if (row.academic_year_id) set.academic_year_id = row.academic_year_id;
      if (row.school_class_id) set.school_class_id = row.school_class_id;
      if (row.section_id) set.section_id = row.section_id;
      if (exam.exam_date) set.date = exam.exam_date;
      bulkOps.push({
        updateOne: {
          filter: { tenant_id: tenantId, examination_id: String(examination_id), student_id: row.student_id },
          update: { $set: set, $setOnInsert: { created_date: now } },
          upsert: true,
        },
      });
      markedAbsent++;
    }
  }

  if (bulkOps.length > 0) {
    await database.collection("Attendance").bulkWrite(bulkOps);
  }

  return {
    success: true,
    examination_id: String(examination_id),
    total_enrolled: roster.length,
    marked_absent: markedAbsent,
    already_present_or_review: roster.length - markedAbsent,
  };
}
