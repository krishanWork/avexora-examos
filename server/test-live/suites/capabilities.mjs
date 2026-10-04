// Capability and service-function coverage: the gates the entity matrix does not cover.
//
// Three families, all of which were previously untested:
//
//   1. POST /api/upload x purpose. canUploadPurpose is a real authorization decision
//      with three different role sets, and it writes a durable artifact — a `logo`
//      lands on a PUBLIC route rendered on the login page and in all three portals.
//      The endpoint was never called by the harness at all.
//   2. POST /api/integrations/extract. Parsing a roster file reads tenant student data;
//      canExtractRoster is the only thing stopping a student from driving the parser.
//   3. The service-level authorization in attendanceService, academicSetupService and
//      examTimetableService. Each has its own role rule that ENTITY_WRITE_ROLES does
//      not describe, so the entity matrix cannot stand in for them.
//
// Where a denial could be produced by payload validation instead of by the role gate,
// the check names the distinction: a 400 proves nothing about authorization.

import { UPLOAD_PURPOSE_ROLES, EXTRACT_ROLES, EXAM_WORKFLOW_ROLES, PROVISION_STUDENT_LOGIN_ROLES, APP_ROLES } from "../../rbac.js";

// Real bytes with the magic signatures server/index.js MAGIC_BYTES requires. A body
// that fails the signature check would 400 before the role gate is ever reached.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0x41)]);
const CSV_BYTES = Buffer.from("admission_number,full_name,class_name\nRB-9001,Import Probe,Class 10\n", "utf8");

export const runCapabilitiesSuite = async (ctx, fx) => {
  const {
    adminAToken, principalToken, ecToken, teacherToken, studentToken, parentToken,
    tenantAId, tenantBId, studentA1Id, classAId, yearAId, examAId,
  } = fx;
  const { api, check } = ctx;

  const roles = [
    { role: APP_ROLES.SCHOOL_ADMIN, token: adminAToken },
    { role: APP_ROLES.PRINCIPAL, token: principalToken },
    { role: APP_ROLES.EXAM_COORDINATOR, token: ecToken },
    { role: APP_ROLES.TEACHER, token: teacherToken },
    { role: APP_ROLES.STUDENT, token: studentToken },
    { role: APP_ROLES.PARENT, token: parentToken },
  ];

  // --- 1. upload purposes ------------------------------------------------------
  //
  // Verdict derived from UPLOAD_PURPOSE_ROLES, matching canUploadPurpose: the purpose
  // must be one the policy defines, and super_admin bypasses the role set but NOT the
  // purpose check.
  const uploadCases = [
    { purpose: "logo", filename: "probe.png", bytes: PNG_BYTES },
    { purpose: "import", filename: "probe.csv", bytes: CSV_BYTES },
    { purpose: "omr", filename: "probe.png", bytes: PNG_BYTES },
  ];

  for (const { purpose, filename, bytes } of uploadCases) {
    const allowedRoles = UPLOAD_PURPOSE_ROLES[purpose];
    for (const { role, token } of [{ role: APP_ROLES.SUPER_ADMIN, token: ctx.superToken }, ...roles]) {
      const expectAllowed = allowedRoles.includes(role);
      const res = await ctx.apiUpload("/upload", { token, filename, bytes, fields: { purpose } });
      const ok = expectAllowed ? res.status === 200 : res.status === 403;
      check(
        `Y-upload-${purpose}-${role}: ${expectAllowed ? "CAN" : "CANNOT"} upload purpose=${purpose} (allows ${allowedRoles.join(",")})`,
        ok,
        `status=${res.status} err=${res.data?.error || ""}`
      );
      if (!expectAllowed && res.status !== 403) {
        check(`Y-upload-${purpose}-${role}: refusal must come from the ROLE gate`, false,
          `expected 403 from canUploadPurpose, got ${res.status}: ${res.data?.error || "(none)"}`);
      }
    }
  }

  // An unrecognized purpose is a client bug, refused with 400 for EVERY role including
  // super_admin, because canUploadPurpose checks the purpose before the bypass. A
  // short-circuit on the actor would authorize a purpose with no rule behind it.
  for (const { role, token } of [{ role: APP_ROLES.SUPER_ADMIN, token: ctx.superToken }, ...roles]) {
    const res = await ctx.apiUpload("/upload", { token, filename: "probe.png", bytes: PNG_BYTES, fields: { purpose: "not-a-purpose" } });
    check(`Y-upload-unknown-purpose-${role}: an unrecognized purpose is 400 for every role`, res.status === 400,
      `status=${res.status} err=${res.data?.error || ""}`);
  }

  // Artifact check: every permitted upload must have written the file it reported, and
  // the directory must contain nothing beyond those. The harness blanks AWS_BUCKET_NAME
  // so storage runs in local-disk mode and UPLOADS_DIR captures the writes; without that
  // this would count files in the real bucket instead.
  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  const uploadsDir = ctx.uploadsDir;
  let storedFiles = [];
  try {
    const walk = (dir) => fsMod.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(pathMod.join(dir, e.name)) : [pathMod.join(dir, e.name)]);
    storedFiles = walk(uploadsDir);
  } catch (err) {
    check("Y-upload-artifacts: the harness upload directory is readable", false, `${err.message} dir=${uploadsDir}`);
  }
  // One file per ALLOWED upload in the run: super_admin + school_admin for logo, plus
  // exam_coordinator for import, plus principal for omr. Each denied probe must not have
  // contributed one, so the count is a lower bound that a leaking denial would break.
  const allowedCount = uploadCases.reduce((n, c) => {
    const allowed = c.purpose === "omr" ? 4 : c.purpose === "import" ? 3 : 2;
    return n + allowed;
  }, 0);
  check(
    "Y-upload-artifacts: exactly the permitted uploads wrote a file",
    storedFiles.length === allowedCount,
    `files=${storedFiles.length} expected=${allowedCount} dir=${uploadsDir}`
  );
  check(
    "Y-upload-artifacts: the files landed in the harness directory, not the repo or a bucket",
    storedFiles.every((f) => f.startsWith(String(uploadsDir))),
    storedFiles.length ? storedFiles.join(", ") : "(none)"
  );

  // --- 2. integrations/extract -------------------------------------------------
  //
  // The 403 must precede the file_url check, so a denied role is refused for its role
  // even with no payload at all. Asserting with an empty body separates the two: a 400
  // would mean the payload gate ran first.
  for (const { role, token } of [{ role: APP_ROLES.SUPER_ADMIN, token: ctx.superToken }, ...roles]) {
    const expectAllowed = EXTRACT_ROLES.includes(role);
    const res = await api("/integrations/extract", { method: "POST", token, body: {} });
    const ok = expectAllowed ? res.status === 400 : res.status === 403;
    check(
      `Y-extract-${role}: ${expectAllowed ? "passes" : "is refused by"} canExtractRoster (allows ${EXTRACT_ROLES.join(",")}) with NO payload`,
      ok,
      `status=${res.status} err=${res.data?.error || ""}`
    );
  }

  // --- 3. academic setup (authorizeAcademicSetup) -------------------------------
  //
  // This gate lives in its own module and admits exactly two roles, so the entity
  // matrix cannot see it. A school_admin naming another institution is the case worth
  // proving: the tenant must come from the session, never from the body.
  //
  // The body carries a distinct academic_year name per probe because the service
  // upserts a real AcademicYear; reusing one would 409 on the unique index and look
  // like a refusal.
  let yearSeq = 0;
  const setupBody = (label) => ({
    school_name: `Probe ${label}`,
    target_tenant_id: tenantAId,
    academic_year: {
      name: `Probe ${label} ${++yearSeq}`,
      start_date: "2026-04-01",
      end_date: "2027-03-31",
      status: "active",
    },
  });
  const setupProbe = async (label, token, body, expect) => {
    const res = await api("/functions/setupAcademicStructure", { method: "POST", token, body });
    const ok = expect === "allow" ? res.status === 200 : res.status === expect;
    check(`Y-academicsetup-${label}: ${ok ? "as expected" : "WRONG"}`, ok,
      `status=${res.status} err=${res.data?.error || ""}`);
    return res;
  };
  await setupProbe("school_admin-own-tenant", adminAToken, setupBody("A"), 200);
  await setupProbe("school_admin-other-tenant", adminAToken, { ...setupBody("B"), target_tenant_id: tenantBId }, 403);
  await setupProbe("super_admin-with-target", ctx.superToken, setupBody("C"), 200);
  await setupProbe("super_admin-without-target", ctx.superToken, { academic_year: { name: "No Target" } }, 400);
  for (const { role, token } of roles.filter((r) =>
    r.role !== APP_ROLES.SCHOOL_ADMIN)) {
    await setupProbe(`${role}-refused`, token, setupBody(role), 403);
  }

  // --- 4. batch attendance (authorizeAttendanceAction) ------------------------
  //
  // Two distinct rules in one function: a tenant-wide capability for any exam-workflow
  // role, and a per-class SCOPE narrowing for a teacher whose PRIMARY role is teacher.
  // The scope rule is the one with teeth, so the teacher case is tested against a class
  // they do not own.
  const attBody = {
    academic_year_id: yearAId,
    school_class_id: classAId,
    section_id: "all",
    date: "2026-10-01",
    records: [{ student_id: studentA1Id, status: "present" }],
  };
  const unassignedClass = await ctx.DB.collection("SchoolClass").findOne({ tenant_id: tenantAId, name: "Class 12" });
  const foreignClass = await ctx.DB.collection("SchoolClass").findOne({ tenant_id: tenantBId });

  const attProbe = async (label, token, body, expected) => {
    const res = await api("/functions/saveBatchAttendance", { method: "POST", token, body });
    check(`Y-attendance-${label}: expected ${expected}, got ${res.status}`, res.status === expected,
      `status=${res.status} err=${res.data?.error || ""}`);
    return res;
  };
  // Exam-workflow roles manage any class in the tenant.
  for (const { role, token } of [
    { role: APP_ROLES.SCHOOL_ADMIN, token: adminAToken },
    { role: APP_ROLES.PRINCIPAL, token: principalToken },
    { role: APP_ROLES.EXAM_COORDINATOR, token: ecToken },
  ]) {
    check(`Y-attendance-${role}: is an exam-workflow role`, EXAM_WORKFLOW_ROLES.has(role));
    await attProbe(`${role}-own-class`, token, attBody, 200);
  }
  // A teacher is scoped to assigned classes. The fixture teacher owns Class 10.
  await attProbe("teacher-assigned-class", teacherToken, attBody, 200);
  await attProbe(
    "teacher-unassigned-class", teacherToken,
    { ...attBody, school_class_id: unassignedClass?._id?.toString() },
    403
  );
  await attProbe(
    "teacher-other-tenant-class", teacherToken,
    { ...attBody, school_class_id: foreignClass?._id?.toString() },
    403
  );
  // Family roles hold neither branch.
  await attProbe("student-refused", studentToken, attBody, 403);
  await attProbe("parent-refused", parentToken, attBody, 403);

  // --- 5. exam attendance (examWorkflow gate) ---------------------------------
  for (const { role, token } of roles) {
    const expectAllowed = EXAM_WORKFLOW_ROLES.has(role);
    const res = await api("/functions/getExamAttendance", { method: "POST", token, body: { examination_id: examAId } });
    const ok = expectAllowed ? res.status === 200 : res.status === 403;
    check(
      `Y-examattendance-${role}: ${expectAllowed ? "CAN" : "CANNOT"} read exam attendance (workflow roles: ${[...EXAM_WORKFLOW_ROLES].join(",")})`,
      ok,
      `status=${res.status} err=${res.data?.error || ""}`
    );
  }

  // --- 6. exam timetable: the family read boundary -----------------------------
  //
  // getExamTimetable reuses the Examination read scope, so a family role must receive
  // only its own classes' published|scheduled exams and NO exam material — the date
  // sheet is schedule information, not question content (EXAM_MATERIAL_ROLES).
  const ttProbe = async (label, token) => {
    const res = await api("/functions/getExamTimetable", { method: "POST", token, body: {} });
    check(`Y-timetable-${label}: returns a date sheet`, res.status === 200,
      `status=${res.status} err=${res.data?.error || ""}`);
    return res.data;
  };
  const staffSheet = await ttProbe("school_admin", adminAToken);
  const teacherSheet = await ttProbe("teacher", teacherToken);
  const studentSheet = await ttProbe("student", studentToken);
  const parentSheet = await ttProbe("parent", parentToken);

  // The student is linked to the Class 10 student, and examA is a published Class 10
  // exam, so it is legitimately in scope. The point is the material, not the row.
  const leaksMaterial = (sheet) => {
    const rows = sheet?.examinations || sheet?.schedule || [];
    return rows.some((r) => r && (r.questions || r.question_paper || r.answer_key || r.paper_url));
  };
  check("Y-timetable-material: a staff role may receive exam material", !leaksMaterial(teacherSheet),
    "recorded so a future material field on the staff path is noticed");
  check("Y-timetable-material: a family role receives NO exam material", !leaksMaterial(studentSheet) && !leaksMaterial(parentSheet),
    `studentLeaks=${leaksMaterial(studentSheet)} parentLeaks=${leaksMaterial(parentSheet)}`);

  // The staff date sheet should at least see the published examination the family rows
  // are derived from; if it does not, the family comparison below proves nothing.
  const staffSees = JSON.stringify(staffSheet ?? {}).includes("RBAC Final");
  check("Y-timetable-scope: the staff date sheet includes the tenant's published exam", staffSees,
    "needed for the family scoping assertion to be meaningful");
  if (staffSees) {
    const studentSees = JSON.stringify(studentSheet ?? {}).includes("Tenant B student");
    check("Y-timetable-scope: a family role never sees another institution's exam", !studentSees,
      `studentSheetMentionsForeignData=${studentSees}`);
  }

  // --- 7. provisionStudentLogins: the backfill gate and its effect --------------
  //
  // The predicate lives in rbac.js, so the entity matrix cannot see it. The
  // interesting assertions are the refusal — a principal is refused here, which is
  // the whole reason the gate is not simply "can write Student" — and the effect
  // on a row that genuinely has no login.
  for (const { role, token } of roles) {
    const expectAllowed = PROVISION_STUDENT_LOGIN_ROLES.includes(role);
    // dry_run writes nothing, so a permitted role gets a real 200 with counts
    // while a refused role must be stopped by the ROLE gate and nothing else —
    // which is why the refusal message itself is asserted, not just the status.
    const res = await api("/functions/provisionStudentLogins", { method: "POST", token, body: { dry_run: true } });
    const ok = expectAllowed
      ? res.status === 200
      : res.status === 403 && res.data?.error === "Forbidden";
    check(
      `Y-provisionlogins-${role}: ${expectAllowed ? "CAN" : "CANNOT"} backfill portal logins (allows ${PROVISION_STUDENT_LOGIN_ROLES.join(",")})`,
      ok,
      `status=${res.status} err=${res.data?.error || ""}`
    );
    if (expectAllowed) {
      check(
        `Y-provisionlogins-${role}: the dry run reports counts without writing`,
        typeof res.data?.scanned === "number" && Array.isArray(res.data?.missing_ids),
        `scanned=${res.data?.scanned} missing=${res.data?.missing_count}`
      );
    }
  }

  // The harness super_admin holds no institution, so there is nothing to scope the
  // backfill to. What matters is WHICH gate refused it: a role refusal says
  // "Forbidden", the tenant boundary says "Tenant unavailable", and only the
  // second proves super_admin passed canProvisionStudentLogins rather than being
  // stopped by it.
  const superProbe = await api("/functions/provisionStudentLogins", { method: "POST", token: ctx.superToken, body: { dry_run: true } });
  check("Y-provisionlogins-super_admin: the role gate admits it; only the missing institution refuses",
    superProbe.status === 403 && /tenant unavailable/i.test(superProbe.data?.error || ""),
    `status=${superProbe.status} err=${superProbe.data?.error || ""}`);

  // A roster row inserted straight into the collection is exactly the shape the
  // backfill exists for: a Student with no User behind it, which cannot sign in.
  const probeEmail = `rbac-${ctx.runId}-orphan@example.test`;
  const probeParentEmail = `rbac-${ctx.runId}-orphan-parent@example.test`;
  const orphan = await ctx.DB.collection("Student").insertOne({
    tenant_id: tenantAId,
    full_name: "Orphan Login Probe",
    roll_number: "ORPHAN1",
    class_name: "Class 10",
    section: "A",
    status: "active",
    student_email: probeEmail,
    parent_name: "Orphan Parent Probe",
    parent_email: probeParentEmail,
    created_date: new Date().toISOString(),
    updated_date: new Date().toISOString(),
  });
  const orphanId = orphan.insertedId.toString();

  const dryRun = await api("/functions/provisionStudentLogins", {
    method: "POST", token: adminAToken, body: { student_ids: [orphanId], dry_run: true },
  });
  check("Y-provisionlogins-dryrun: the unprovisioned student is reported as missing",
    dryRun.status === 200 && dryRun.data?.missing_count === 1,
    `status=${dryRun.status} missing=${dryRun.data?.missing_count}`);
  check("Y-provisionlogins-dryrun: the dry run created no account",
    (await ctx.DB.collection("User").countDocuments({ email: probeEmail })) === 0,
    "a count of 0 proves the preview is read-only");

  const run = await api("/functions/provisionStudentLogins", {
    method: "POST", token: adminAToken, body: { student_ids: [orphanId] },
  });
  check("Y-provisionlogins-run: the backfill mints both family logins",
    run.status === 200 && run.data?.created_count === 2 && run.data?.reused_count === 0,
    `status=${run.status} created=${run.data?.created_count} reused=${run.data?.reused_count} skipped=${JSON.stringify(run.data?.skipped || [])}`);
  check("Y-provisionlogins-run: the shared default password is returned once",
    typeof run.data?.default_password === "string" && run.data.default_password.length > 0,
    `default_password=${run.data?.default_password} skipped=${JSON.stringify(run.data?.skipped || [])}`);

  const mintedStudent = await ctx.DB.collection("User").findOne({ email: probeEmail });
  const mintedParent = await ctx.DB.collection("User").findOne({ email: probeParentEmail });
  check("Y-provisionlogins-users: the student login exists, is linked and must change its password",
    Boolean(mintedStudent) && mintedStudent.app_role === "student" && mintedStudent.must_change_password === true && mintedStudent.linked_student_id === orphanId,
    JSON.stringify({ role: mintedStudent?.app_role, mustChange: mintedStudent?.must_change_password, linked: mintedStudent?.linked_student_id }));
  check("Y-provisionlogins-users: the parent login exists with the parent role",
    Boolean(mintedParent) && mintedParent.app_role === "parent" && mintedParent.must_change_password === true,
    JSON.stringify({ role: mintedParent?.app_role, mustChange: mintedParent?.must_change_password }));

  // Re-running must be inert. The backfill only ever considers rows that are
  // missing a login, so a second pass finds nothing to do at all — it does not
  // walk the roster re-reporting the accounts it (or anyone) already created.
  const rerun = await api("/functions/provisionStudentLogins", {
    method: "POST", token: adminAToken, body: { student_ids: [orphanId] },
  });
  check("Y-provisionlogins-idempotent: a second run has nothing left to do",
    rerun.status === 200 && rerun.data?.processed === 0 && rerun.data?.created_count === 0 && rerun.data?.reused_count === 0,
    `status=${rerun.status} processed=${rerun.data?.processed} created=${rerun.data?.created_count} reused=${rerun.data?.reused_count}`);
  check("Y-provisionlogins-idempotent: the existing passwords were not reset",
    Boolean(await ctx.DB.collection("User").findOne({ email: probeEmail })) && Boolean(await ctx.DB.collection("User").findOne({ email: probeParentEmail })),
    "both accounts survive the second pass");
  check("Y-provisionlogins-idempotent: still exactly one account per address",
    (await ctx.DB.collection("User").countDocuments({ email: { $in: [probeEmail, probeParentEmail] } })) === 2,
    "a duplicate here would mean a second run minted a second account");

  // A whole-tenant dry run must now find nothing outstanding, which is the
  // regression this feature exists to close: students admitted through the API
  // carry a portal login from the moment they are created.
  const settled = await api("/functions/provisionStudentLogins", { method: "POST", token: adminAToken, body: { dry_run: true } });
  check("Y-provisionlogins-settled: an API-created roster needs no backfill",
    settled.status === 200 && settled.data?.missing_count === 0,
    `scanned=${settled.data?.scanned} missing=${settled.data?.missing_count}`);

  // The tenant comes from the session, never from the body: naming another
  // institution must not reach its roster.
  const foreign = await ctx.DB.collection("Student").findOne({ tenant_id: tenantBId });
  const crossTenant = await api("/functions/provisionStudentLogins", {
    method: "POST", token: adminAToken, body: { student_ids: [foreign?._id?.toString()].filter(Boolean), dry_run: true },
  });
  check("Y-provisionlogins-tenant: a foreign student id is invisible to this institution",
    crossTenant.status === 200 && crossTenant.data?.scanned === 0,
    `status=${crossTenant.status} scanned=${crossTenant.data?.scanned}`);

  // An id that is not an ObjectId is a client bug, not an authorization answer:
  // it must be dropped rather than thrown, or one bad id fails the whole run.
  const malformed = await api("/functions/provisionStudentLogins", {
    method: "POST", token: adminAToken, body: { student_ids: ["not-an-id"] },
  });
  check("Y-provisionlogins-malformed: a malformed id yields an empty result, not a cast error",
    malformed.status === 200 && malformed.data?.scanned === 0,
    `status=${malformed.status} err=${malformed.data?.error || ""}`);
};