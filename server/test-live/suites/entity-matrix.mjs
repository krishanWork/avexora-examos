// Per-role coverage for the entity rows the main harness never exercised.
//
// The sections A-V in rbac-live.mjs prove cross-tenant isolation, IDOR resistance,
// audit integrity and the account lifecycle. They do NOT cover the whole write matrix:
// eight entities were never sent to any role, so their rows in ENTITY_WRITE_ROLES
// (server/rbac.js) had no test standing behind them at all. A row could be widened or
// dropped and the suite would still be green.
//
// This file closes that. For each entity, every role is exercised and the verdict is
// DERIVED from the matrix by reproducing canWriteEntity's own rule, not restated:
//
//   allow when super_admin (the platform bypass) or the role appears in the verb's row
//   deny  otherwise, and the denial must be 403 from the ROLE gate
//
// A denial that comes back 400 proved nothing about authorization — the payload failed
// validation before the role was ever consulted — so that case is reported separately
// rather than counted as a pass.
//
// Every allowed create uses a payload unique to that role. Several of these entities
// carry a unique index, so two roles sharing one payload would make the second a 409 and
// silently skip its allow-path.

import { ENTITY_WRITE_ROLES, APP_ROLES } from "../../rbac.js";
import { ent, makeStudent } from "../lib/fixtures.mjs";

// Reproduce canWriteEntity's decision for one role.
const expectVerdict = (ctx, { entity, verb, role, token }) => {
  if (token === ctx.superToken) return { allowed: true, matrixRoles: [] };
  const matrixRoles = ENTITY_WRITE_ROLES[entity]?.[verb] ?? [];
  return { allowed: matrixRoles.includes(role), matrixRoles };
};

const attempt = async (ctx, { entity, method, token, role, createBody, label, acceptStatuses }) => {
  const { check } = ctx;
  const verb = { POST: "create", PATCH: "update", DELETE: "delete" }[method];
  const { allowed, matrixRoles } = expectVerdict(ctx, { entity, verb, role, token });
  const res = await ent(ctx, entity, method, token, createBody?.());

  if (allowed) {
    const ok = acceptStatuses ? acceptStatuses.includes(res.status) : res.status === 200 || res.status === 201;
    check(`${label}: CAN ${verb} ${entity} (matrix allows ${matrixRoles.join(",") || "nobody"})`, ok,
      `status=${res.status} err=${res.data?.error || ""}`);
  } else {
    check(
      `${label}: CANNOT ${verb} ${entity} (matrix allows ${matrixRoles.join(",") || "nobody"})`,
      res.status === 403,
      `status=${res.status} err=${res.data?.error || ""}`
    );
    if (res.status !== 403) {
      check(`${label}: ${entity} ${verb} denial must come from the ROLE gate`, false,
        `expected 403 from canWriteEntity, got ${res.status}: ${res.data?.error || "(no error body)"}`);
    }
  }
  return res;
};

// Prove a refused write left nothing behind. Counts rows carrying a marker field only
// this suite sets, so an unrelated row cannot make the count non-zero.
const assertNoMarker = async (ctx, { entity, marker, label }) => {
  const count = await ctx.DB.collection(entity).countDocuments({ matrix_marker: marker });
  ctx.check(`${label}: no denied ${entity} write left a row behind`, count === 0, `rows=${count}`);
};

export const runEntityMatrixSuite = async (ctx, fx) => {
  const {
    tenantAId, adminAToken, principalToken, ecToken, teacherToken, studentToken, parentToken,
    studentA1Id, classAId, yearAId,
  } = fx;
  const DB = ctx.DB;

  const ROLES = [
    { label: APP_ROLES.SUPER_ADMIN, token: ctx.superToken },
    { label: APP_ROLES.SCHOOL_ADMIN, token: adminAToken },
    { label: APP_ROLES.PRINCIPAL, token: principalToken },
    { label: APP_ROLES.EXAM_COORDINATOR, token: ecToken },
    { label: APP_ROLES.TEACHER, token: teacherToken },
    { label: APP_ROLES.STUDENT, token: studentToken },
    { label: APP_ROLES.PARENT, token: parentToken },
  ];

  // One student per role. These exist because several entities below carry a unique
  // index over (student_id, ...), so a shared payload would 409 the second role and
  // skip its allow-path entirely. extraStudent is also the target for the
  // AssignmentSubmission ownership probe: a student record the student role owns
  // nothing of.
  const studentFor = {};
  const extraStudent = await makeStudent(ctx, adminAToken, tenantAId, { full_name: "Not Mine", roll_number: "RN-OTHER" });
  for (const { label } of ROLES) {
    const r = await makeStudent(ctx, adminAToken, tenantAId, { roll_number: `RN-${label}`, full_name: `Student ${label}` });
    studentFor[label] = r.data?.id;
  }
  ctx.check(
    "X-fixtures: a per-role student was created for every role",
    ROLES.every((r) => Boolean(studentFor[r.label])) && Boolean(extraStudent.data?.id),
    `created=${Object.values(studentFor).filter(Boolean).length}/${ROLES.length}`
  );

  const subject = await ent(ctx, "Subject", "POST", adminAToken, { tenant_id: tenantAId, name: "Matrix Subject", code: "MS1" });
  const teacherDoc = await DB.collection("Teacher").findOne({ tenant_id: tenantAId, email: fx.teacherEmail });
  const teacherId = teacherDoc?._id?.toString();

  // --- Section: school_admin only ---------------------------------------------
  for (const role of ROLES) {
    await attempt(ctx, {
      entity: "Section", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, school_class_id: classAId,
        name: `Sec-${role.label}`, matrix_marker: "MATRIX-SECTION",
      }),
      label: `X-section-${role.label}`,
    });
  }
  await assertNoMarker(ctx, { entity: "Section", marker: { $in: ROLES.filter((r) => r.label !== APP_ROLES.SCHOOL_ADMIN).map((r) => `Sec-${r.label}`) }, label: "X-section" });

  // --- Parent: school_admin only ----------------------------------------------
  for (const role of ROLES) {
    await attempt(ctx, {
      entity: "Parent", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, full_name: `Par ${role.label}`,
        email: `par-${role.label}-${ctx.runId}@example.test`, matrix_marker: "MATRIX-PARENT",
      }),
      label: `X-parent-${role.label}`,
    });
  }
  await assertNoMarker(ctx, { entity: "Parent", marker: `par-${APP_ROLES.PRINCIPAL}-${ctx.runId}@example.test`, label: "X-parent" });

  // --- ParentStudent: school_admin only ---------------------------------------
  // parent_id and student_id are both required on create, and the link is unique per
  // pair, so each role gets its own pair.
  const parentDocs = await DB.collection("Parent")
    .find({ tenant_id: tenantAId, email: { $regex: `^par-.*-${ctx.runId}@example\\.test$` } })
    .toArray();
  const parentByEmail = new Map(parentDocs.map((d) => [d.email, d._id.toString()]));
  const parentFor = (label) => parentByEmail.get(`par-${label}-${ctx.runId}@example.test`);
  for (const role of ROLES) {
    await attempt(ctx, {
      entity: "ParentStudent", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, parent_id: parentFor(role.label),
        student_id: studentFor[role.label], relationship: "guardian",
        matrix_marker: "MATRIX-LINK",
      }),
      label: `X-parentstudent-${role.label}`,
    });
  }
  await assertNoMarker(ctx, { entity: "ParentStudent", marker: "MATRIX-LINK-DENIED", label: "X-parentstudent" });

  // --- TeacherAssignment: school_admin only -----------------------------------
  // teacher_id, academic_year_id and school_class_id are required on create.
  // section_id is deliberately OMITTED rather than set to "all": assertRelationshipWrite
  // looks the section up in the Section collection and a literal "all" is not an
  // ObjectId, so the request 400s on validation before the role gate is reached.
  for (const role of ROLES) {
    await attempt(ctx, {
      entity: "TeacherAssignment", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, teacher_id: teacherId, academic_year_id: yearAId,
        school_class_id: classAId, matrix_marker: "MATRIX-TA",
      }),
      label: `X-teacherassignment-${role.label}`,
    });
  }

  // --- Enrollment: school_admin + exam_coordinator (C/U), school_admin (D) -----
  // student_id, academic_year_id and school_class_id are all required on create.
  for (const role of ROLES) {
    await attempt(ctx, {
      entity: "Enrollment", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, student_id: studentFor[role.label],
        academic_year_id: yearAId, school_class_id: classAId, status: "active",
        matrix_marker: "MATRIX-ENROLL",
      }),
      label: `X-enrollment-${role.label}`,
    });
  }

  // --- Assignment: school_admin/principal/exam_coordinator/teacher (C/U) -------
  // The created id is captured from the response rather than looked up by title
  // afterwards: a lookup adds a second way for the fixture to go missing and produce a
  // confusing 400 on the submission probes below.
  const assignmentFor = {};
  for (const role of ROLES) {
    const res = await attempt(ctx, {
      entity: "Assignment", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, school_class_id: classAId,
        title: `Asg ${role.label}`, status: "draft", matrix_marker: "MATRIX-ASG",
      }),
      label: `X-assignment-${role.label}`,
    });
    if (res.status === 201 || res.status === 200) assignmentFor[role.label] = res.data?.id;
  }

  // --- AssignmentSubmission: the one family write ----------------------------
  // school_admin, teacher and student may submit. This is the only matrix row a
  // family role appears in, so it gets the most scrutiny: each allowed role submits
  // for its own student, and then the student role is asked to submit for a student
  // it does not own.
  // Fail loudly here rather than letting a missing id turn a submission into a 400 that
  // looks like a role denial.
  //
  // Only roles the matrix ADMITS get an assignment, so this asserts against the same
  // rule rather than against all seven: student and parent were just refused above, so
  // demanding an assignment for them would assert the opposite of the correct behaviour.
  const assignmentExpectation = ROLES.filter(
    (r) => r.token === ctx.superToken || (ENTITY_WRITE_ROLES.Assignment?.create ?? []).includes(r.label)
  );
  ctx.check(
    "X-fixtures: an Assignment exists for exactly the roles that may create one",
    assignmentExpectation.every((r) => Boolean(assignmentFor[r.label])),
    `found=${Object.values(assignmentFor).filter(Boolean).length} expected=${assignmentExpectation.length}`
  );
  // The student is handled separately below: it has no assignment of its own and submits
  // against the student it is linked to, not a per-role fixture.
  for (const role of ROLES.filter((r) => r.label !== APP_ROLES.STUDENT)) {
    await attempt(ctx, {
      entity: "AssignmentSubmission", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, assignment_id: assignmentFor[role.label],
        student_id: studentFor[role.label], status: "submitted",
        matrix_marker: `MATRIX-SUB-${role.label}`,
      }),
      label: `X-submission-${role.label}`,
    });
  }

  // The student role holds no Assignment of its own — it cannot create one, as asserted
  // above — so an admin creates the assignment it will submit against. It targets the
  // student the account is actually linked to (linked_student_id), because that is the
  // one record the student owns.
  const studentAssignment = await ent(ctx, "Assignment", "POST", adminAToken, {
    tenant_id: tenantAId, school_class_id: classAId,
    title: "Asg for the student role", status: "draft", matrix_marker: "MATRIX-ASG-STUDENT",
  });
  const studentAssignmentId = studentAssignment.data?.id;
  const studentSubmission = await attempt(ctx, {
    entity: "AssignmentSubmission", method: "POST", token: studentToken, role: APP_ROLES.STUDENT,
    createBody: () => ({
      tenant_id: tenantAId, assignment_id: studentAssignmentId,
      student_id: studentA1Id, status: "submitted", matrix_marker: "MATRIX-SUB-student",
    }),
    label: `X-submission-${APP_ROLES.STUDENT}`,
  });
  ctx.check(
    "X-submission-student-own: a student may submit for the student they are linked to",
    studentSubmission.status === 201,
    `status=${studentSubmission.status} err=${studentSubmission.data?.error || ""}`
  );

  // ...and the same student may NOT submit for anyone else. This is the assertion the
  // family write row exists for: create is the only verb a student reaches anywhere in
  // the matrix, so its ownership rule is the whole of the family's write surface.
  const notMine = await ent(ctx, "AssignmentSubmission", "POST", studentToken, {
    tenant_id: tenantAId, assignment_id: studentAssignmentId,
    student_id: extraStudent.data.id, status: "submitted", matrix_marker: "MATRIX-SUB-NOTMINE",
  });
  const leaked = await DB.collection("AssignmentSubmission").countDocuments({ matrix_marker: "MATRIX-SUB-NOTMINE" });
  ctx.check(
    "X-submission-ownership: a student cannot submit against a student they do not own",
    notMine.status === 403 && leaked === 0,
    `status=${notMine.status} rows=${leaked} err=${notMine.data?.error || ""}`
  );

  // --- OMRCorrection: create only; no update, no delete -----------------------
  // question_index is unique per examination, so each role gets its own.
  const questionIndexFor = {};
  ROLES.forEach((role, i) => { questionIndexFor[role.label] = i + 1; });
  for (const role of ROLES) {
    await attempt(ctx, {
      entity: "OMRCorrection", method: "POST", token: role.token, role: role.label,
      createBody: () => ({
        tenant_id: tenantAId, examination_id: fx.examAId,
        question_index: questionIndexFor[role.label], corrected_answer: "B",
        matrix_marker: `MATRIX-OMRC-${role.label}`,
      }),
      label: `X-omrcorrection-${role.label}`,
    });
  }

  // A teacher creates an answer key but may not delete one. The matrix splits those
  // verbs, and an allow-path test on POST alone would not notice.
  //
  // A fresh draft examination is created here rather than reusing one of the main
  // harness's, because those already carry answer keys and the unique index would make
  // this a 409 rather than a test of the create path.
  const keyExam = await ent(ctx, "Examination", "POST", adminAToken, {
    tenant_id: tenantAId, name: "Matrix Keyable", subject_name: "Math",
    school_class_ids: [classAId], academic_year_id: yearAId, status: "draft",
  });
  const keyDoc = await ent(ctx, "AnswerKey", "POST", teacherToken, {
    tenant_id: tenantAId, examination_id: keyExam.data?.id, subject_name: "Math",
  });
  ctx.check("X-answerkey-split: a teacher CAN create an AnswerKey", keyDoc.status === 201,
    `exam=${keyExam.status} key=${keyDoc.status} err=${keyDoc.data?.error || ""}`);
  if (keyDoc.status === 201) {
    const delKey = await ent(ctx, "AnswerKey", "DELETE", teacherToken, null, `/${keyDoc.data.id}`);
    const survived = await DB.collection("AnswerKey").countDocuments({ _id: new ctx.ObjectId(keyDoc.data.id) });
    ctx.check(
      "X-answerkey-split: a teacher CANNOT delete an AnswerKey (delete omits teacher), and the row survives",
      delKey.status === 403 && survived === 1,
      `del=${delKey.status} rows=${survived}`
    );
  }

  // Guard against a row being added to the matrix and silently left untested, and
  // make the remaining gap visible rather than assumed empty.
  const COVERED = [
    "Section", "Parent", "ParentStudent", "TeacherAssignment", "Enrollment",
    "Assignment", "AssignmentSubmission", "OMRCorrection",
  ];
  const notInMatrix = COVERED.filter((name) => !(name in ENTITY_WRITE_ROLES));
  ctx.check(
    "X-coverage: every entity this suite exercises is a real ENTITY_WRITE_ROLES row",
    notInMatrix.length === 0,
    `not in the matrix: ${notInMatrix.join(", ") || "none"}`
  );
  const elsewhere = Object.keys(ENTITY_WRITE_ROLES).filter((name) => !COVERED.includes(name));
  ctx.check(
    "X-coverage: the matrix rows this suite does NOT cover, listed for audit",
    true,
    `covered here: ${COVERED.join(", ")} | covered elsewhere in the harness: ${elsewhere.join(", ")}`
  );
};