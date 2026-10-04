// Exam Timetable Service — the official examination date sheet.
//
// Derived directly from Examination documents so the official exam timetable
// always reflects the same source of truth as the exam workflow. The weekly
// class timetable (TimetablePeriod/BellSchedule) is NOT used here: exams are
// scheduled only through their own academic_year_id, class/section ids,
// exam_date, session, start/end times and venue.
//
// Scope is never derived here. The caller resolves the Examination filter
// through readScope() and passes it in, so the date sheet a student or parent
// sees is bounded by exactly the same predicate as the entity endpoint
// (their own classes, status published|scheduled) instead of a second,
// quietly divergent rule. Exam-material fields (the paper itself) are dropped
// for family roles: a date sheet is schedule information, not exam content.

import { ObjectId } from "mongodb";
import { db } from "./db.js";
import { EXAM_MATERIAL_ROLES, appRolesOf } from "./rbac.js";

// Normalizes a stored id list that may contain nested arrays (legacy/bulk-import
// shape like [["id"]]) or non-id junk into a flat, validated set of ObjectId strings.
const normalizeIdList = (value) => [
  ...new Set(
    (Array.isArray(value) ? value.flat(Infinity) : value ? [value] : [])
      .filter(Boolean)
      .map(String)
      .filter((id) => ObjectId.isValid(id))
  ),
];

export async function getExamTimetable({ user, criteria = {}, revealExamMaterial = true }) {
  if (!user || !user.tenant_id) {
    const err = new Error("Authentication required with tenant context");
    err.statusCode = 401;
    throw err;
  }
  const tenantId = String(user.tenant_id);
  const database = await db();
  // Exam material (the question paper, paper sets, marks structure) is content,
  // not schedule data. Only staff roles get it; a family role sees the date sheet
  // for their own classes' published|scheduled exams and nothing else.
  // Union: a teacher who also coordinates examinations is a staff role, so the
  // exam content is theirs to see. Family accounts still get schedule only.
  const showMaterial = revealExamMaterial && appRolesOf(user).some((r) => EXAM_MATERIAL_ROLES.has(r));

  const exams = await database.collection("Examination").find({
    ...criteria,
    tenant_id: tenantId,
  }).toArray();

  // Resolve class names from the authoritative school_class_ids; stored
  // class_names act as a fallback for legacy docs that never had ids.
  const allClassIds = normalizeIdList(exams.flatMap((e) => e.school_class_ids));
  const classDocs = allClassIds.length
    ? await database.collection("SchoolClass").find({
        tenant_id: tenantId,
        _id: { $in: allClassIds.map((id) => new ObjectId(id)) },
      }, { projection: { _id: 1, name: 1 } }).toArray()
    : [];
  const classMap = new Map(classDocs.map((c) => [c._id.toString(), c.name]));

  // Resolve section names for uniform section lists that span the exam's classes.
  const allSectionIds = normalizeIdList(exams.flatMap((e) => e.section_ids));
  const sectionDocs = allSectionIds.length
    ? await database.collection("Section").find({
        tenant_id: tenantId,
        _id: { $in: allSectionIds.map((id) => new ObjectId(id)) },
      }, { projection: { _id: 1, name: 1, school_class_id: 1 } }).toArray()
    : [];
  const sectionMap = new Map(sectionDocs.map((s) => [s._id.toString(), s]));

  const rosterCounts = [];
  for (const e of exams) {
    rosterCounts.push(
      database.collection("ExamRoster").countDocuments({
        tenant_id: tenantId,
        examination_id: e._id.toString(),
      }).catch(() => 0)
    );
  }
  const counts = await Promise.all(rosterCounts);

  const today = new Date().toISOString().split("T")[0];

  const dateSheet = exams.map((e, idx) => {
    const date = e.exam_date || "";
    let session = "unscheduled";
    if (date) {
      if (date < today) session = "completed";
      else if (date === today) session = "today";
      else session = "upcoming";
    }

    const sectionIds = normalizeIdList(e.section_ids);
    const scopeClassIds = normalizeIdList(e.school_class_ids);
    const resolvedClassNames = scopeClassIds.map((id) => classMap.get(id)).filter(Boolean);
    const storedClassNames = Array.isArray(e.class_names) ? e.class_names : (e.class_name ? [e.class_name] : []);
    return {
      id: e._id.toString(),
      name: e.name || "",
      academic_year_id: e.academic_year_id ? String(e.academic_year_id) : null,
      subject: e.subject || (Array.isArray(e.subjects) && e.subjects.length ? e.subjects.join(", ") : ""),
      class_names: resolvedClassNames.length ? resolvedClassNames : storedClassNames,
      section_names: sectionIds
        .map((id) => sectionMap.get(id)?.name || id)
        .filter(Boolean),
      exam_date: date,
      session,
      session_label: e.session && e.session !== "unscheduled" ? e.session : null,
      start_time: e.start_time || null,
      end_time: e.end_time || null,
      venue: e.venue || null,
      duration_minutes: Number(e.duration_minutes) || 0,
      num_questions: Number(e.num_questions || e.number_of_questions) || 0,
      max_marks: Number(e.max_marks) || 0,
      paper_sets: showMaterial && Array.isArray(e.paper_sets) ? e.paper_sets : [],
      status: e.status || "draft",
      roster_count: showMaterial ? counts[idx] || 0 : 0,
      // The question paper itself is exam material, not schedule data: never
      // exposed to a student or parent through the date sheet.
      paper_url: showMaterial ? e.paper_url || null : null,
    };
  });

  dateSheet.sort((a, b) => {
    if (a.exam_date !== b.exam_date) return (a.exam_date || "9999").localeCompare(b.exam_date || "9999");
    return a.subject.localeCompare(b.subject);
  });

  return {
    tenant_id: tenantId,
    generated_at: new Date().toISOString(),
    total_exams: dateSheet.length,
    upcoming_count: dateSheet.filter((e) => e.session === "upcoming").length,
    today_count: dateSheet.filter((e) => e.session === "today").length,
    completed_count: dateSheet.filter((e) => e.session === "completed").length,
    date_sheet: dateSheet,
  };
}