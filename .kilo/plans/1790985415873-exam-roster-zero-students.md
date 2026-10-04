# Fix: "0 students on the exam roster" when creating an exam

## Context

On `/examinations` → Create Examination → step 2 "Who Takes It", the roster preview
always shows **0 students** even though the school has students.

The count comes from `previewExamRoster` (`server/index.js:5199`) →
`deriveEnrolledStudents` (`server/examRosterService.js:60`), which counts via two paths:

1. **Enrollment path** — `Enrollment` docs matching `{tenant_id, status ∉ [withdrawn, inactive], academic_year_id, school_class_id ∈ selection}` plus `section_id ∈ selection` when sections are picked.
2. **Placement fallback** — for classes with *no* matching enrollment, `Student` docs with `status: "active"` (exact) and `school_class_id ∈ selection`, plus `section_id ∈ selection` when sections are picked.

Failure modes that yield 0 for a tenant that visibly has students:

- **Students missing `school_class_id` (known, documented)** — students imported before
  their SchoolClass existed, or whose CSV `class_name` didn't exactly match a configured
  class, keep only `class_name`. `server/index.js:2042-2051` documents these as
  "invisible to every class-scoped query (teacher reads, attendance, rosters, results)".
  Teachers got a name-matching safety net (`teacherClassNames`, `server/index.js:2056`);
  the exam roster derivation did **not**.
- **Students/enrollments missing `section_id`** — rows storing only a section *name*
  (legacy imports, seed data) are excluded the moment any section chip is selected
  (`examRosterService.js:81` and `:104-106`).
- **Strict `status: "active"`** (`examRosterService.js:112`) drops students with a
  missing or nonstandard status. Attendance uses the tolerant
  `status: { $ne: "inactive" }` (`attendanceService.js:199`).
- **No remediation UX** — `ExamFormDialog.jsx:343` renders a bare "0 students", and the
  repair tool the code references (`scripts/backfill-student-class-ids.mjs`) does not
  exist in the repo.

## Decisions

1. Fix in `deriveEnrolledStudents` only — it is the single derivation used by the preview,
   the persisted roster (`ensureExamRoster`), OMR print, attendance and evaluation. One
   fix repairs every consumer.
2. Name fallbacks only match names of **real** SchoolClass/Section docs of the selected
   scope (SchoolClass names are unique per tenant — `ux_school_class_tenant_name`;
   Section names unique per class — `ux_section_tenant_class_name`), mirroring
   `teacherClassNames`. No security widening.
3. Placement name-fallback applies only to **uncovered** classes (classes with no
   matching enrollment), preserving the documented "enrollment wins for covered classes"
   design (`examRosterService.js:13`).
4. Student status filter relaxed to `{ $nin: ["inactive", "withdrawn", "archived"] }`
   (missing status → included), matching attendance semantics.
5. `deriveEnrolledStudents` return shape changes from `records[]` to
   `{ students, stats }` so the preview can explain a 0. Exactly two callers to update:
   `ensureExamRoster` (`examRosterService.js:195`) and `previewExamRoster`
   (`server/index.js:5226`).
6. Add the missing `scripts/backfill-student-class-ids.mjs` (dry-run by default).

## Tasks (ordered)

### 1. `server/examRosterService.js` — tolerant derivation
In `deriveEnrolledStudents`:
- Load selected SchoolClass docs once (`{ tenant_id, _id: { $in: scope.school_class_ids } }`)
  → `classIdToName` map; derive `uncoveredClassNames` = names of the uncovered class ids.
- Load selected Section docs once (`{ tenant_id, _id: { $in: scope.section_ids } }`)
  → `selectedSectionNames` set.
- Enrollment query (when sections selected): broaden the section condition to
  `{ $or: [ { section_id: { $in: ids } }, { section_name: { $in: names } }, { section: { $in: names } } ] }`.
- Placement branch: broaden the class condition to
  `{ $or: [ { school_class_id: { $in: uncoveredIds } }, { class_name: { $in: uncoveredClassNames } } ] }`;
  when sections selected, broaden the section condition the same way as above
  (fields `section_id`, `section`).
- Student status: `status: { $nin: ["inactive", "withdrawn", "archived"] }`.
- Keep the `seenStudentIds` dedupe (a student matching both paths counts once).
- Return `{ students: records, stats: { enrollment, placement, unlinked } }` where
  `unlinked` = active students in the tenant whose `class_name` matches a selected
  class but who have no `school_class_id` (the repair-needed signal).

### 2. `server/index.js` — preview response
`previewExamRoster` (`:5226-5235`): consume the new shape; respond
`{ count, students, stats }`.

### 3. `src/components/exams/ExamFormDialog.jsx` — explain 0
- Store `stats` alongside `count` in `fetchPreview` (`:193-194`).
- When `preview.count === 0` (`:341-345`), render an actionable message:
  - if `stats.unlinked > 0`: "No rostered students match. N student(s) in these classes have no class linked — re-save them in Students (or run the backfill script)."
  - else: "No active students or enrollments found for this selection."
- Mirror the same message on the Review step Roster row (`:423`).

### 4. `scripts/backfill-student-class-ids.mjs` (new)
Connect via `../server/db.js`. Per tenant (or `--tenant <id>`):
1. Students with `class_name` set and `school_class_id` missing → resolve SchoolClass by
   `{ tenant_id, name }` (unique) → `$set school_class_id`.
2. Students with `section` name + `school_class_id` and `section_id` missing → resolve
   Section by `{ tenant_id, school_class_id, name }` → `$set section_id`.
3. `--enroll` flag (off by default): insert missing current-year `Enrollment` rows
   (`status: "enrolled"`) for students with a resolved `school_class_id` who have no
   enrollment for the tenant's current academic year (respect the
   `ux_enrollment_tenant_year_student` unique index — insert only when absent).
Default is dry-run printing a per-step table; `--apply` to write.

### 5. `server/test/examRosterService.test.mjs` (new)
Follow the fake-collection pattern of `server/test/uniqueness.test.mjs` (stub
`database.collection(name).find(query)` with in-memory filtering for the exact query
shapes used). Cover:
- student with `class_name` only (no `school_class_id`) is counted via the name fallback;
- student with section name only (no `section_id`) is counted when that section is selected;
- archived/inactive students excluded; student with missing `status` included;
- student matching both enrollment and placement counted once.

## Risks

- Return-shape change touches `ensureExamRoster` — update all `derived` usages
  (`examRosterService.js:195-196`, `:219`); `kept` (`:283`) is unaffected.
- `$nin` status includes unusual statuses (e.g. "pending") — acceptable, matches
  attendance semantics; they stay visible until explicitly archived.
- Name fallback is conservative (uncovered classes only): a class that has *some*
  enrollments keeps enrollment-authoritative membership; the backfill script's
  `--enroll` step repairs mixed-data tenants.

## Validation

1. `node --test server/test/examRosterService.test.mjs` (fits the existing `node --test` suite).
2. Manual: `/examinations` → Create → "Who Takes It" → select a class only → count > 0;
   add a section chip → count reflects that section; Review step shows the same count.
3. After Create, the exam detail / OMR print (`getExamRoster`) lists the same students.
4. Run `node scripts/backfill-student-class-ids.mjs` (dry-run) to quantify unlinked
   students; `--apply` (and `--enroll` if enrollment rows are missing); re-check preview.

## Open questions

None blocking. Whether the tenant's 0 is class-level (missing `school_class_id`) or
section-level (missing `section_id`) is answered by the `stats` breakdown after ship;
the fix covers both shapes.
