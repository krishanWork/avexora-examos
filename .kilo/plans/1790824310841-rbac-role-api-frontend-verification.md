# RBAC Verification — Per-Role API Testing (Backend) and Frontend Data Flow

## Context

`server/rbac.js` is the single authoritative role policy: 8 roles, a multi-role model
(`app_roles` canonical, `app_role` a primary-role mirror), and one write matrix
(`ENTITY_WRITE_ROLES`, `server/rbac.js:447`) that every generic entity write is gated by.
`rbac-audit/00-README.md` was written against an older, inline version of that policy; the
policy has since been centralised and most of its findings addressed, so the audit's §4
matrix and §9 test matrix are **stale** and must not be used as the specification.

Three layers exist today, and they are unevenly verified:

| Layer | File | Coverage |
|---|---|---|
| Pure policy | `server/test/rbac.test.mjs` | 1125 lines, `npm test`, no DB — good |
| Live HTTP | `server/test-live/rbac-live.mjs` | 1948 lines / 210 checks, needs local mongod |
| Client mirror | `src/lib/permissions.js`, `src/lib/roles.js`, `src/components/layout/AppLayout.jsx` | **zero** automated coverage |

Measured gaps that this plan closes:

1. **Client mirror is untested.** `rbac-audit/ISSUE-016` records three live frontend
   over-grants against the backend matrix, and nothing fails when they change. There is no
   invariant test and no frontend runner in `package.json`.
2. **Live harness under-covers the write matrix.** Entities never exercised against any
   role: `Section`, `Parent`, `ParentStudent`, `TeacherAssignment`, `Enrollment`,
   `Assignment`, `AssignmentSubmission`, `OMRCorrection`. Capability gates never exercised:
   `UPLOAD_PURPOSE_ROLES` (`server/rbac.js:503`), `canExtractRoster` (`server/rbac.js:521`).
   Service-level authorization in `attendanceService.js`, `academicSetupService.js` and
   `examTimetableService.js` is never reached.
3. **Nav/route agreement is unverified and currently broken.**
   `AppLayout.jsx:91` gives `exam_coordinator` a `/academic-setup` nav item, but
   `PAGE_ROLES.schoolStructure` (`src/lib/permissions.js:59`) is
   `["super_admin","school_admin","principal"]` and `App.jsx:147` gates that route with it —
   so the coordinator sees a nav entry that bounces to `/home`. Same class of defect in
   `CommandPalette.jsx:102-119`, whose 16 nav destinations are **unfiltered by role**: a
   teacher or coordinator is offered "Billing & Subscription Usage", "White Label Branding"
   and "CRM Leads & Admissions", all of which `RoleGuard` will refuse.

Objective: make every role's backend enforcement and the client's derived view of it
asserted by an executable test, and fix the divergences those tests expose.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend verification mechanism | `node --test` parity test, no browser | No frontend runner exists; adding one is a separate project. The permission maps are pure data, so the invariant is testable without rendering. |
| Drift resolution | Narrow the **frontend**; never widen the backend | `ISSUE-016` warns explicitly that widening converts a UX defect into a privilege grant. Backend is the stricter side in all three cases. |
| Backend scope | Close all identified gaps | A green `npm run test:rbac` currently overstates coverage; 8 of 27 entity rows and all three upload/capability gates are unverified. |
| Harness structure | Extract shared plumbing; add per-area suites | 1948-line top-level script cannot absorb ~60 more checks. |
| Product-side role changes | **Out of scope** | `super_admin` cross-tenant write (`ISSUE-010`) and `employee` cross-tenant write remain product decisions. Tests pin current behaviour; they do not change it. |

## Tasks

### 1. Make the client permission modules importable from `node --test`

`src/lib/permissions.js:1` imports `@/lib/roles`, which Node cannot resolve (Vite alias
only; Node subpath imports require a `#` prefix).

- [ ] Change that one import to relative: `import { getAppRoles } from "./roles";`.
      Behaviour-identical; Vite resolves it identically. Every other file keeps `@/lib/...`.
- [ ] Extract the `NAV` map from `src/components/layout/AppLayout.jsx:29-109` into a new
      plain module `src/lib/nav.js` (no JSX, no React). `AppLayout` imports it. No item
      changes. This is a pure move that makes nav testable.
- [ ] Verify nothing else in `src/lib` uses `@/` imports that would block a direct
      `node --test` import (only `permissions.js` and `roles.js` are in scope).

### 2. Fix the three frontend over-grants

In `src/lib/permissions.js`, remove only the roles the backend refuses:

- [ ] `manage_students` (line 22): drop `principal`.
      Backend `Student.create/update = ["school_admin","exam_coordinator"]`,
      `Enrollment.create/update = ["school_admin","exam_coordinator"]`.
- [ ] `manage_students` is consumed at `src/pages/Enrollments.jsx:24` and
      `src/pages/Students.jsx:428`; both become read-only for `principal`. Confirm this is
      intended — `ISSUE-016` records it as the desired outcome.
- [ ] `manage_teachers` (line 23): drop `principal`.
      Backend `Teacher.create/update/delete = ["school_admin"]`.
      Consumed at `src/pages/Teachers.jsx:22`.
- [ ] `manage_crm` (line 24): drop `principal` and `exam_coordinator`.
      Backend `Parent` and `ParentStudent` C/U/D = `["school_admin"]`.
      Consumed at `src/pages/Parents.jsx:26`.
- [ ] Leave `PAGE_ROLES` untouched in this step. Task 4 changes it separately.
- [ ] Add the subset invariant as a header comment on `PERMISSIONS`, naming the backend
      matrix as authoritative.

### 3. Add the frontend/backend parity test

New file `server/test/frontend-rbac-parity.test.mjs`, picked up by `npm test`
(`node --test server/test`). No browser, no DB, no new dependency.

**3a. Vocabulary and ordering.** Import both `server/rbac.js` and `src/lib/roles.js`;
assert `APP_ROLES` and `APP_ROLE_PRECEDENCE` are identical element-for-element, and that
`PLATFORM_ROLES` / `EXAM_WORKFLOW_ROLES` / `FAMILY_ROLES` agree as sets.

**3b. Union-vs-primary semantics.** Assert `can()` (frontend) and `hasAnyRole` (server)
both answer as a union over held roles, and that `getAppRole` and `primaryAppRole` return
the same value for: single role, multi-role staff set, `app_roles` present with a
disagreeing `app_role` mirror, legacy document with only `app_role`, and an unknown role.

**3c. The subset invariant (the core test).** Declare an explicit table in the test file
mapping each of the 15 `PERMISSIONS` actions to its backend authority:

| Frontend action | Backend authority |
|---|---|
| `manage_students` | `ENTITY_WRITE_ROLES.Student.create` ∪ `Enrollment.create` |
| `manage_teachers` | `ENTITY_WRITE_ROLES.Teacher.create` |
| `manage_crm` | `ENTITY_WRITE_ROLES.Parent.create` ∪ `ParentStudent.create` |
| `manage_academics` | `ENTITY_WRITE_ROLES.SchoolClass.create` |
| `manage_billing` | `ENTITY_WRITE_ROLES.Tenant.update` |
| `manage_assignments` | `ENTITY_WRITE_ROLES.Assignment.create` |
| `submit_assignments` | `ENTITY_WRITE_ROLES.AssignmentSubmission.create` |
| `mark_attendance` | `ENTITY_WRITE_ROLES.Attendance.create` |
| `delete_students` | `ENTITY_WRITE_ROLES.Student.delete` |
| `edit_answer_key` | `ENTITY_WRITE_ROLES.AnswerKey.update` |
| `manage_staff` | `STAFF_MANAGE_ROLES` |
| `review_results` | `EXAM_WORKFLOW_ROLES` |
| `evaluate_exam` | `EXAM_WORKFLOW_ROLES` |
| `publish_results` | `EXAM_WORKFLOW_ROLES` |
| `view_academic_dashboards` | read-only page — no write verb to compare |

Rules asserted for every row:
- `PERMISSIONS[action]` minus `super_admin` is a **subset** of the backend authority.
  `super_admin` is stripped because the backend bypasses every check rather than being
  listed (`server/rbac.js:483`); assert separately that `super_admin` is present in every
  frontend action, since the backend always permits it.
- Every role named in a `PERMISSIONS` value is a member of `VALID_APP_ROLES` (catches typos).
- The `view_academic_dashboards` row asserts no backend write verb is claimed for it, so a
  future edit that makes it gate a write fails loudly rather than passing vacuously.
- Under-grants are permitted and must not fail. Record them in the failure message only if
  the assertion itself fails, so the test never blocks on a UX-only narrowing.

**3d. Route coverage.** Parse `src/App.jsx` and assert every `<Route>` inside the
`ProtectedRoute` element is wrapped in a `RoleGuard`, and that each `roles={PAGE_ROLES.X}`
key exists. This closes `ISSUE-007` as a regression test — `/student-portal`,
`/parent-portal` and `/checkout` are now guarded in `App.jsx:98-110`, and the test keeps
them guarded.

**3e. Nav agreement.** Using `src/lib/nav.js`, assert for every role: each of its nav `to`
paths is admitted by at least one `PAGE_ROLES` group containing that role. This **fails
on first run** for `exam_coordinator` → `/academic-setup`; Task 4 fixes it.

### 4. Fix nav and page-gate divergences

- [ ] `src/lib/nav.js`: remove the `/academic-setup` entry from the `EXAM_COORDINATOR` list.
      A coordinator cannot write `SchoolClass`/`Section`/`AcademicYear`
      (`ENTITY_WRITE_ROLES`, all `school_admin` only) and `authorizeAcademicSetup`
      (`server/academicSetupService.js:26,41,73`) admits only `school_admin` and
      `super_admin`, so the page was never usable by that role.
- [ ] `src/components/shared/CommandPalette.jsx`: filter `navItems` (line 102) and the Quick
      Actions block (line 132) through `PAGE_ROLES` using `hasAnyRole` from
      `src/lib/roles.js`. Reuse the same `to` → `PAGE_ROLES` group mapping the parity test
      asserts, so palette and sidebar cannot diverge again. Consider exporting that mapping
      from `src/lib/nav.js` so both surfaces read one table.
- [ ] Extend the parity test to assert the CommandPalette destination set equals the nav
      destination set per role, so a future unfiltered list fails.
- [ ] Add to `src/lib/permissions.js` a comment recording that `exam_coordinator` reaches
      `/students` read-only and has no `/academic-setup` route.

### 5. Extract live-harness plumbing

`server/test-live/rbac-live.mjs` is a single 1948-line top-level script. Split it so the
new suites can share one server, one scratch database and one fixture set.

- [ ] New `server/test-live/lib/harness.mjs`, exporting the pieces currently inline:
      `check`, `getFreePort`, `waitFor`, the `api()` helper, `apiUpload()` (new, below),
      scratch-DB connection + teardown, `userIds`/`tenantIds` tracking, `cleanup`, and the
      `envForServer()` builder that neutralises SMTP (`rbac-live.mjs:180-207`).
- [ ] New `server/test-live/lib/fixtures.mjs`, exporting the tenant/user/fixture builders
      currently at `rbac-live.mjs:424-616`: `makeTenantAdmin`, `makeUser`, `makeAccessible`,
      `seedUser`, `seedRoleSet`, `seedLegacyUser`, `makeStudent`, `ent`, and the
      `SchoolClass` / `AcademicYear` / `Teacher` / `Examination` seeds. Return a single
      context object; do not use module-level mutable globals.
- [ ] Rewrite `rbac-live.mjs` as an orchestrator that boots the harness, builds fixtures
      once, runs each suite, then tears down. **All 210 existing checks must still run and
      pass, with identical names.** This is the acceptance gate for the refactor — if any
      existing check changes name or outcome, the refactor is wrong.
- [ ] New `server/test-live/lib/upload.mjs` with `apiUpload(token, purpose, filename, bytes)`.
      Build a `multipart/form-data` body by hand against the global `fetch` + `FormData` +
      `Blob` (Node ≥ 20, already required by `package.json` engines). Do not add a
      multipart dependency.
- [ ] Set `UPLOADS_DIR` to a fresh `fs.mkdtemp` path in the harness server env. The server
      honours it (`server/index.js:148`), and without it logo uploads write into the repo's
      `uploads/` tree. Delete the temp dir in `cleanup`.

### 6. Close the entity-matrix gaps per role

New suite `server/test-live/suites/entity-matrix.mjs`. For each entity below, and for every
role in `VALID_APP_ROLES`, assert **allow** (2xx) where `canWriteEntity` says yes and
**deny** (403) where it says no. Denials must also assert the record was not written
(re-read after), matching the existing H3/H4 pattern at `rbac-live.mjs:1203-1210`.

- [ ] `Section`, `Parent`, `ParentStudent`, `TeacherAssignment` — `school_admin` only.
- [ ] `Enrollment` — `school_admin`, `exam_coordinator` (C/U); `school_admin` (D).
- [ ] `Assignment` — `school_admin`, `principal`, `exam_coordinator`, `teacher` (C/U);
      `school_admin`, `teacher` (D).
- [ ] `AssignmentSubmission` — the one family write. `school_admin`, `teacher`, `student`
      (C/U); `school_admin` (D). Add the ownership checks: a student may submit only against
      their own `linked_student_id`, and a teacher only for an assigned class.
- [ ] `OMRCorrection` — `school_admin`, `principal`, `exam_coordinator` (C); no U, no D.
- [ ] `Section` requires a `school_class_id`; `ParentStudent` a `student_id`. Build valid
      relationship payloads or the request 400s before reaching the role check, making the
      assertion vacuous. See `assertRelationshipWrite` (`server/index.js:3968`).

### 7. Close the capability and service-function gaps

New suite `server/test-live/suites/capabilities.mjs`.

- [ ] `POST /api/upload` × purpose. Use real bytes with correct magic signatures from
      `MAGIC_BYTES` (`server/index.js:168`): a PNG header for `omr`, CSV text for `import`,
      PNG for `logo`.
      - `logo` → allow `super_admin`, `school_admin`; deny `principal`,
        `exam_coordinator`, `teacher`, `student`, `parent`, `employee`.
      - `import` → allow `super_admin`, `school_admin`, `exam_coordinator`; deny the rest.
      - `omr` → allow `super_admin`, `school_admin`, `principal`, `exam_coordinator`;
        deny `teacher`, `student`, `parent`, `employee`.
      - Unknown purpose → 400 for every role, including `super_admin`
        (`server/index.js:3185`), and assert no file was written.
      - Assert the denied uploads left no file in the temp `UPLOADS_DIR`.
- [ ] `POST /api/integrations/extract` (`server/index.js:4340`). Allow
      `super_admin`, `school_admin`, `exam_coordinator`; deny the rest with 403. Also assert
      the 403 precedes the `file_url` validation, so it is the role and not the payload
      producing the refusal.
- [ ] `POST /api/functions/setupAcademicStructure` → `authorizeAcademicSetup`
      (`server/academicSetupService.js:11`). `school_admin` succeeds with own tenant;
      `school_admin` naming another tenant → 403; `super_admin` without
      `target_tenant_id` → 400; `super_admin` with a live tenant succeeds;
      `principal`, `exam_coordinator`, `teacher`, `student`, `parent` → 403.
- [ ] `POST /api/functions/saveBatchAttendance` and `getAttendanceHistory` →
      `authorizeAttendanceAction` (`server/attendanceService.js:15`). Teacher succeeds for
      an assigned class, 403 for an unassigned one and for another tenant's;
      `exam_coordinator` allowed; `student`/`parent` denied.
- [ ] `POST /api/functions/getExamAttendance` — `examWorkflow` gate
      (`server/index.js:4528`). Allow the three workflow roles; deny `teacher`, `student`,
      `parent`, `employee`.
- [ ] `POST /api/functions/getExamTimetable` (`server/index.js:5143`). Assert the family
      read boundary: `student` and `parent` receive their own classes'
      `published|scheduled` exams only, and **no** exam material
      (`EXAM_MATERIAL_ROLES`, `server/examTimetableService.js:44`); staff receive the
      tenant's. A teacher sees material.
- [ ] `Lead`, `Payment`, `PlatformBranding`, `SubscriptionPlan`, `Announcement` read
      attempts per role, asserting `globalOnly` 404s and `publicRead` 200s as declared.

### 8. Wire up and document

- [ ] `package.json`: keep `test` as `node --test server/test` (the parity test is picked
      up automatically — confirm the file glob matches `.test.mjs` and not
      `rbac-live.mjs`, which lives in `server/test-live/`). Add
      `"test:parity": "node --test server/test/frontend-rbac-parity.test.mjs"` for a fast
      inner loop. No new dependency.
- [ ] Add a short header to `server/test-live/rbac-live.mjs` and
      `src/lib/permissions.js` stating the invariant each now protects, in the style of the
      existing `server/rbac.js` comments.
- [ ] Record the outcome in `rbac-audit/`: mark `ISSUE-007` and `ISSUE-016` resolved with a
      pointer to the test that pins them, and add the new nav/palette divergences found in
      Task 4 as findings with their own IDs. Do **not** rewrite
      `rbac-audit/00-README.md` §4 or §9 — note at the top of that file that it predates
      `server/rbac.js` and points to the matrix in code as authoritative.

## Risks

| Risk | Mitigation |
|---|---|
| Harness refactor silently drops or renames existing checks | Acceptance gate is "all 210 existing checks still run and pass with identical names". Capture the pre-refactor check-name list first and diff it after. |
| Narrowing `manage_crm` removes `principal` and `exam_coordinator` from `/parents` entirely | `PAGE_ROLES.crmAdmin` still admits both roles, so the page stays reachable read-only. That is the pattern `ISSUE-016` names as correct (`/academic-setup` + `manage_academics`). Verify no page gates *all* content on the permission. |
| Parity test's action→authority table is itself a hand-maintained copy — the same drift risk it exists to catch | The table lives in one place in the test, names the backend export it derives from, and a test asserts every `PERMISSIONS` key appears in it, so a new frontend action cannot be added without an authority being declared. |
| Live suite needs a running local mongod | Precondition below. Harness already isolates to a per-run scratch DB and drops it. |
| `npm test` and `npm run test:rbac` disagree about what "verified" means | `npm test` is pure policy + parity, no DB; `npm run test:rbac` is live HTTP. State this split in both file headers. |

## Validation

Precondition: `mongod` reachable at `mongodb://localhost:27017`. The binary is installed at
`/opt/homebrew/bin/mongod`; start it before running the live suite.

1. `npm test` — green. Includes the new parity suite plus the existing 116.
2. `npm run test:rbac` — green, with the 210 pre-existing checks present by name and the
   new entity/capability checks added. Scratch DB dropped; temp `UPLOADS_DIR` removed.
3. `npm run lint` — clean.
4. Negative control for the parity test: temporarily add `exam_coordinator` to
   `manage_teachers` in `src/lib/permissions.js`, confirm `npm test` fails naming the
   over-grant, then revert. This proves the test is load-bearing rather than vacuous.
5. Negative control for nav agreement: temporarily re-add `/academic-setup` to
   `exam_coordinator` in `src/lib/nav.js`, confirm the parity test fails, then revert.
6. Confirm `git status` shows no stray files under `uploads/` and no leftover
   `avexora_examos_rbac_*` scratch databases.

## Out of scope

- `ISSUE-010` — whether `super_admin`/`employee` may write cross-tenant. A product decision.
  Tests pin current behaviour; they do not change it.
- `ISSUE-013` — public registration creating a tenant `school_admin`.
- `ISSUE-008` — client-only impersonation. Task 4 touches `CommandPalette`, not
  `src/lib/impersonation.js`.
- Any browser-based or rendered-UI verification. A frontend test runner would be a separate
  project; this plan proves the permission data, not the pixels.
