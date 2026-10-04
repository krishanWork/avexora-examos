// Exam Roster Service — single source of truth for the set of students
// eligible to sit an Examination (OMR identity, exam attendance, evaluation).
//
// Roster chain:
//   Examination → AcademicYear → Enrollment (active) → Student (active)
//
// Tenants whose students were bulk-imported rather than enrolled have no
// Enrollment rows at all, which used to produce a silently empty roster for
// everyone (admins included) and broke OMR printing, evaluation, attendance and
// result visibility. So for any class in the exam's scope that has no active
// enrollment, membership falls back to the student's current placement
// (Student.school_class_id / section_id) and is tagged source:"placement".
// Enrollment always wins for a class that does have enrollments.
//
// The roster is persisted in the ExamRoster collection (one doc per
// exam + student) so OMR, attendance, and results all read the same set and
// never drift from each other. Persisted entries are rebuilt whenever an
// Examination is created/updated or an Enrollment changes.
//
// Source precedence: manual > enrollment > placement.

import { ObjectId } from "mongodb";
import { db } from "./db.js";

const ACTIVE_ENROLLMENT_STATUSES = {
  $nin: ["withdrawn", "inactive"],
};

// Students are counted unless they are explicitly withdrawn, inactive or
// archived. A missing status (legacy / imported rows) must not silently
// drop a student from every class-scoped query — mirrors the tolerance
// attendanceService applies ({ status: { $ne: "inactive" } }).
const ROSTER_STUDENT_STATUSES = {
  $nin: ["inactive", "withdrawn", "archived"],
};

const toObjectIds = (ids) =>
  (ids || []).filter(Boolean).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

// Minimal query matcher for the in-memory test doubles: supports top-level
// equality (null matches a missing field), $in / $nin, $or and $and.
export function matchesQuery(doc, query) {
  if (!query || typeof query !== "object") return true;
  for (const [key, condition] of Object.entries(query)) {
    if (key === "$or") {
      if (!Array.isArray(condition) || !condition.some((sub) => matchesQuery(doc, sub))) return false;
      continue;
    }
    if (key === "$and") {
      if (!Array.isArray(condition) || !condition.every((sub) => matchesQuery(doc, sub))) return false;
      continue;
    }
    if (condition !== null && typeof condition === "object") {
      if ("$in" in condition) {
        const list = condition.$in || [];
        if (!list.some((item) => String(item) === String(doc[key] ?? ""))) return false;
      }
      if ("$nin" in condition) {
        const list = condition.$nin || [];
        if (list.some((item) => String(item) === String(doc[key] ?? ""))) return false;
      }
      continue;
    }
    // Null matches both an explicit null and a missing field.
    if (condition === null) {
      if (doc[key] != null) return false;
      continue;
    }
    if (String(doc[key] ?? "") !== String(condition)) return false;
  }
  return true;
}

/**
 * Derive the exam's scope from its document, falling back to the tenant's
 * current academic year for legacy examinations created before academic-year
 * linking existed. Section ids are a uniform list applied across classes.
 */
export function resolveExamScope(exam) {
  const schoolClassIds = Array.isArray(exam.school_class_ids)
    ? exam.school_class_ids.filter(Boolean).map(String)
    : exam.school_class_id
      ? [String(exam.school_class_id)]
      : [];
  const sectionIds = Array.isArray(exam.section_ids)
    ? exam.section_ids.filter(Boolean).map(String)
    : [];
  return {
    academic_year_id: exam.academic_year_id ? String(exam.academic_year_id) : null,
    school_class_ids: schoolClassIds,
    section_ids: sectionIds,
  };
}

/**
 * Build the roster for an exam. Never resolves loose class_name; only
 * authoritative ids. Returns records enriched from Student.
 *
 * Classes that have at least one active enrollment are derived from Enrollment
 * (tagged "enrollment"). Classes with no enrollment at all fall back to current
 * Student placement (tagged "placement") so enrollment-less tenants are not
 * left with an empty roster. This is a per-class decision: a partially enrolled
 * exam uses Enrollment where it exists and placement for the rest.
 *
 * Legacy tolerance: rows written before the canonical-id fields existed (or
 * whose class/section name did not exactly match a configured class/section)
 * keep only `class_name` / `section`. For uncovered classes such students are
 * matched by name against the tenant's real SchoolClass docs, and sections
 * selected by name against the tenant's real Section docs. SchoolClass names
 * are unique per tenant and Section names unique per class, so name matching
 * is unambiguous and cannot widen beyond the selected scope.
 *
 * Returns { students, stats } where stats carries the per-source counts used
 * by the exam form to explain an empty roster:
 *   enrollment — students matched through Enrollment rows
 *   placement  — students matched through current placement
 *   unlinked   — active students whose class_name matches a selected class
 *                but who carry no school_class_id (data repair needed)
 */
export async function deriveEnrolledStudents({ db: database, exam }) {
  const scope = resolveExamScope(exam);
  const tenantId = exam.tenant_id;
  let academicYearId = scope.academic_year_id;
  if (!academicYearId) {
    const current = await database.collection("AcademicYear").findOne(
      { tenant_id: tenantId, is_current: true },
      { projection: { _id: 1 } }
    );
    academicYearId = current ? current._id.toString() : null;
  }
  const empty = { students: [], stats: { enrollment: 0, placement: 0, unlinked: 0 } };
  if (!academicYearId || scope.school_class_ids.length === 0) {
    return empty;
  }

  // Resolve the selected structures once. Id-only lookups: the maps below
  // turn legacy name-only rows into exact matches against real documents.
  const classDocs = await database.collection("SchoolClass")
    .find(
      { tenant_id: tenantId, _id: { $in: toObjectIds(scope.school_class_ids) } },
      { projection: { _id: 1, name: 1 } }
    )
    .toArray();
  const classIdToName = new Map(classDocs.map((c) => [c._id.toString(), c.name]));
  const selectedClassNames = [...new Set(scope.school_class_ids
    .map((id) => classIdToName.get(id))
    .filter(Boolean))];

  let selectedSectionNames = [];
  let sectionKeyToId = new Map();
  if (scope.section_ids.length > 0) {
    const sectionDocs = await database.collection("Section")
      .find(
        { tenant_id: tenantId, _id: { $in: toObjectIds(scope.section_ids) } },
        { projection: { _id: 1, name: 1, school_class_id: 1 } }
      )
      .toArray();
    selectedSectionNames = [...new Set(sectionDocs.map((s) => s.name).filter(Boolean))];
    // Section names are unique per class, so the class-scoped key is
    // unambiguous and lets a legacy section name resolve to its id.
    sectionKeyToId = new Map(
      sectionDocs.map((s) => [`${s.school_class_id ? String(s.school_class_id) : ""}::${String(s.name).trim()}`, s._id.toString()])
    );
  }

  // A section condition that accepts both the canonical section_id and the
  // legacy name fields (section_name / section) of the selected sections.
  const sectionOr = scope.section_ids.length > 0
    ? [{ section_id: { $in: scope.section_ids } }]
    : [];
  if (selectedSectionNames.length > 0) {
    sectionOr.push({ section_name: { $in: selectedSectionNames } });
    sectionOr.push({ section: { $in: selectedSectionNames } });
  }

  const enrollmentQuery = {
    tenant_id: tenantId,
    status: ACTIVE_ENROLLMENT_STATUSES,
    academic_year_id: academicYearId,
    school_class_id: { $in: scope.school_class_ids },
  };
  if (sectionOr.length > 0) enrollmentQuery.$or = sectionOr;

  const enrollments = await database.collection("Enrollment")
    .find(enrollmentQuery, { projection: { student_id: 1, school_class_id: 1, section_id: 1, academic_year_id: 1 } })
    .toArray();

  // Which classes in scope actually have enrollment, and which do not.
  const enrolledClassIds = new Set();
  for (const e of enrollments) {
    if (e.school_class_id) enrolledClassIds.add(String(e.school_class_id));
  }
  const uncoveredClassIds = scope.school_class_ids.filter((id) => !enrolledClassIds.has(id));
  const uncoveredClassNameToId = new Map(
    uncoveredClassIds
      .map((id) => [classIdToName.get(id), id])
      .filter(([name]) => Boolean(name))
  );

  // One targeted read for both paths. The section condition deliberately
  // applies only to the placement branch: an enrollment row's own section_id
  // is authoritative, and must not be re-checked against the student's current
  // section (a student who moved sections mid-year keeps their enrollment).
  const studentOr = [];
  const enrollmentIds = [...new Set(enrollments.map((e) => String(e.student_id)))]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (enrollmentIds.length > 0) studentOr.push({ _id: { $in: enrollmentIds } });
  if (uncoveredClassIds.length > 0) {
    // Placement branch: canonical class id, or the legacy class_name of one
    // of the uncovered classes. Section (when selected) narrows both.
    const classMatch = [{ school_class_id: { $in: uncoveredClassIds } }];
    if (selectedClassNames.length > 0) {
      const uncoveredNames = uncoveredClassIds
        .map((id) => classIdToName.get(id))
        .filter(Boolean);
      if (uncoveredNames.length > 0) classMatch.push({ class_name: { $in: uncoveredNames } });
    }
    const placementBranch = { $and: [{ $or: classMatch }] };
    if (sectionOr.length > 0) placementBranch.$and.push({ $or: sectionOr });
    studentOr.push(placementBranch);
  }

  const students = studentOr.length > 0
    ? await database.collection("Student").find({
        tenant_id: tenantId,
        status: ROSTER_STUDENT_STATUSES,
        $or: studentOr,
      }, {
        projection: {
          _id: 1, admission_number: 1, full_name: 1, roll_number: 1,
          school_class_id: 1, section_id: 1, class_name: 1, section: 1,
        },
      }).toArray()
    : [];

  const studentMap = new Map(students.map((s) => [s._id.toString(), s]));
  const records = [];
  const seenStudentIds = new Set();

  const toRecord = (studentId, student, schoolClassId, sectionId, source) => {
    if (seenStudentIds.has(studentId)) return;
    seenStudentIds.add(studentId);
    records.push({
      student_id: studentId,
      admission_number: student.admission_number || "",
      full_name: student.full_name || "",
      roll_number: student.roll_number || "",
      school_class_id: schoolClassId,
      section_id: sectionId,
      academic_year_id: academicYearId,
      source,
    });
  };

  // 1. Enrollment is authoritative for every class that has any active row.
  for (const e of enrollments) {
    const studentId = String(e.student_id);
    const student = studentMap.get(studentId);
    if (!student) continue;
    let enrollmentSectionId = e.section_id
      ? String(e.section_id)
      : (student.section_id ? String(student.section_id) : null);
    if (!enrollmentSectionId && student.section && e.school_class_id) {
      enrollmentSectionId = sectionKeyToId.get(`${String(e.school_class_id)}::${String(student.section).trim()}`) || null;
    }
    toRecord(studentId, student, e.school_class_id ? String(e.school_class_id) : null, enrollmentSectionId, "enrollment");
  }

  // 2. Fall back to current placement for classes with no enrollment at all.
  // A student's own school_class_id wins when it points inside the scope; a
  // missing or out-of-scope id falls back to the legacy class_name match.
  if (uncoveredClassIds.length > 0) {
    for (const student of students) {
      const classId = student.school_class_id ? String(student.school_class_id) : null;
      let resolvedClassId = null;
      if (classId && uncoveredClassIds.includes(classId)) {
        resolvedClassId = classId;
      } else if (!classId || !scope.school_class_ids.includes(classId)) {
        const name = student.class_name ? String(student.class_name).trim() : "";
        resolvedClassId = name ? (uncoveredClassNameToId.get(name) || null) : null;
      }
      if (!resolvedClassId) continue;
      let placementSectionId = student.section_id ? String(student.section_id) : null;
      if (!placementSectionId && student.section) {
        placementSectionId = sectionKeyToId.get(`${resolvedClassId}::${String(student.section).trim()}`) || null;
      }
      toRecord(student._id.toString(), student, resolvedClassId, placementSectionId, "placement");
    }
  }

  // Diagnostic for the exam form: active students whose class_name matches a
  // selected class but who carry no school_class_id. They are invisible to
  // class-scoped queries until re-saved (or repaired by
  // scripts/backfill-student-class-ids.mjs).
  const unlinked = selectedClassNames.length > 0
    ? await database.collection("Student").countDocuments({
        tenant_id: tenantId,
        status: ROSTER_STUDENT_STATUSES,
        school_class_id: null,
        class_name: { $in: selectedClassNames },
      })
    : 0;

  return {
    students: records,
    stats: {
      enrollment: records.filter((r) => r.source === "enrollment").length,
      placement: records.filter((r) => r.source === "placement").length,
      unlinked,
    },
  };
}

/**
 * Persist the authoritative roster for an exam.
 *
 * Precedence: manual > enrollment > placement.
 *  - `source:"manual"` rows are never touched (explicitly added by a coordinator).
 *  - `source:"enrollment"` / `source:"placement"` rows are re-synced every time.
 *  - A row whose derived source is now stronger than the stored one is promoted
 *    (placement -> enrollment) the moment a real Enrollment appears.
 *  - Non-manual rows no longer derived (student withdrawn, moved class) are pruned.
 */
export async function ensureExamRoster({ tenantId, examinationId, db: database }) {
  const client = database || (await db());
  const exam = await client.collection("Examination").findOne({
    _id: new ObjectId(examinationId),
    tenant_id: tenantId,
  });
  if (!exam) {
    const err = new Error("Examination not found");
    err.statusCode = 404;
    throw err;
  }

  const { students: derived } = await deriveEnrolledStudents({ db: client, exam });
  const derivedStudentIds = new Set(derived.map((s) => s.student_id));

  const existing = await client.collection("ExamRoster").find({
    tenant_id: tenantId,
    examination_id: String(examinationId),
  }).toArray();

  const now = new Date().toISOString();
  // Manual members are authoritative and survive any re-sync.
  const stale = existing.filter(
    (r) => (r.source || "enrollment") !== "manual" && !derivedStudentIds.has(String(r.student_id))
  );
  const staleIds = new Set(stale.map((r) => String(r._id)));

  const existingByStudent = new Map(
    existing.filter((r) => !staleIds.has(String(r._id))).map((r) => [String(r.student_id), r])
  );

  const SOURCE_RANK = { manual: 3, enrollment: 2, placement: 1 };
  const rankOf = (source) => SOURCE_RANK[source || "enrollment"] ?? 0;

  const toInsert = [];
  const toUpdate = [];
  for (const s of derived) {
    const current = existingByStudent.get(s.student_id);
    if (!current) {
      toInsert.push(s);
      continue;
    }
    const currentSource = current.source || "enrollment";
    // Only non-manual rows are ever re-synced, and only when the derived record
    // is stronger or the weaker "placement" source whose details can drift.
    if (currentSource === "manual") continue;
    const stronger = rankOf(s.source) > rankOf(currentSource);
    const refreshable = currentSource === "placement";
    if (stronger || refreshable) {
      toUpdate.push({ _id: current._id, source: s.source, record: s });
    }
  }

  const ops = [];
  if (stale.length > 0) {
    ops.push({ deleteMany: { filter: { _id: { $in: stale.map((r) => r._id) } } } });
  }
  for (const s of toInsert) {
    ops.push({
      insertOne: {
        document: {
          tenant_id: tenantId,
          examination_id: String(examinationId),
          student_id: s.student_id,
          admission_number: s.admission_number,
          full_name: s.full_name,
          roll_number: s.roll_number,
          school_class_id: s.school_class_id,
          section_id: s.section_id,
          academic_year_id: s.academic_year_id,
          source: s.source,
          created_date: now,
          updated_date: now,
        },
      },
    });
  }
  for (const { _id, source, record } of toUpdate) {
    ops.push({
      updateOne: {
        filter: { _id },
        update: {
          $set: {
            admission_number: record.admission_number,
            full_name: record.full_name,
            roll_number: record.roll_number,
            school_class_id: record.school_class_id,
            section_id: record.section_id,
            academic_year_id: record.academic_year_id,
            source,
            updated_date: now,
          },
        },
      },
    });
  }
  if (ops.length > 0) {
    await client.collection("ExamRoster").bulkWrite(ops);
  }

  const kept = existingByStudent.size + toInsert.length;
  return {
    examination_id: String(examinationId),
    tenant_id: tenantId,
    student_count: kept,
    added: toInsert.map((s) => s.student_id),
    updated: toUpdate.map((u) => u.record.student_id),
    removed: stale.map((r) => String(r.student_id)),
  };
}

/**
 * Read the persisted roster for an exam (representative of Enrollment), enriched
 * with student details. Auto-rebuilds once before reading so legacy exams and
 * enrollment edits never serve a stale roster.
 */
export async function getExamRoster({ tenantId, examinationId }) {
  const client = await db();
  await ensureExamRoster({ tenantId, examinationId, db: client });
  const rows = await client.collection("ExamRoster").find({
    tenant_id: tenantId,
    examination_id: String(examinationId),
  }, { projection: { _id: 0 } }).toArray();
  return rows
    .map((r) => ({
      student_id: String(r.student_id),
      admission_number: r.admission_number || "",
      full_name: r.full_name || "",
      roll_number: r.roll_number || "",
      school_class_id: r.school_class_id ? String(r.school_class_id) : null,
      section_id: r.section_id ? String(r.section_id) : null,
      academic_year_id: r.academic_year_id ? String(r.academic_year_id) : null,
      source: r.source || "enrollment",
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function getExamRosterStudentIds({ tenantId, examinationId }) {
  const roster = await getExamRoster({ tenantId, examinationId });
  return roster.map((r) => r.student_id);
}

export async function studentInExamRoster({ tenantId, examinationId, studentId }) {
  const client = await db();
  const row = await client.collection("ExamRoster").findOne({
    tenant_id: tenantId,
    examination_id: String(examinationId),
    student_id: String(studentId),
  }, { projection: { _id: 1 } });
  return Boolean(row);
}

/**
 * Rebuild rosters for every examination that a changed enrollment could touch.
 * Called after Enrollment create/update/delete/bulk.
 */
export async function syncEnrollmentRosters({ tenantId, academicYearId, schoolClassId, sectionId }) {
  const client = await db();
  const query = { tenant_id: tenantId };
  if (academicYearId) query.academic_year_id = String(academicYearId);
  if (schoolClassId) query.school_class_ids = String(schoolClassId);
  else if (sectionId) query.section_ids = String(sectionId);

  const exams = await client.collection("Examination").find(query, { projection: { _id: 1 } }).toArray();
  const results = [];
  for (const exam of exams) {
    results.push(await ensureExamRoster({ tenantId, examinationId: exam._id.toString() }));
  }
  return { examinations_synced: results.length, results };
}