# Centralized "Create Portal Logins" for Students

## Answer to the question asked

Portal logins **are already created when a student is added** — single create (`POST /api/entities/Student`, server/index.js:3803) and bulk import (`POST .../bulk`, server/index.js:3874) both call `provisionAutoLogins` and return `_provisioned`. The gap is only for **pre-existing roster rows that were inserted outside those flows** (e.g. `krishans@avexora.in`), which have no `User` document and therefore cannot log in. The centralized button exists to backfill those, and is a no-op for everyone already provisioned.

## Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Who can run it | **school_admin** only in the UI |
| Execution path | **Dedicated server function** (`provisionStudentLogins`), not the bulk-update endpoint |
| Scope | Selected rows when the selection bar has rows, otherwise the whole tenant |

Server-side gate is `canWriteEntity(req, "Student", "update")` (school_admin, exam_coordinator; super_admin bypasses by design) **and** `canAnyProvisionRole(rolesOf(req), "student")`. The UI's school_admin-only gate is a deliberate subset, which the frontend/server parity suite permits (rule 3: frontend must be a subset, never an over-grant).

## Problem found while planning

`ENTITY_WRITE_ROLES.Student.update = ["school_admin", "exam_coordinator"]` (server/rbac.js:467) and `manage_students` (src/lib/permissions.js:39) both **exclude `principal`**. The per-row "Create Portal Logins" button added earlier is gated on `[SUPER_ADMIN, PRINCIPAL, SCHOOL_ADMIN]`, so **for principals it renders and then 403s**. Step 1 removes `PRINCIPAL` from that gate.

## Why not the existing bulk-update path

`PATCH /api/entities/:name/bulk` (server/index.js:3887) would work for school_admin but, per student: writes a no-op `updated_date`, re-runs `syncRelatedEntitiesAfterWrite`, and burns a fresh `bcrypt.hash` (server/provisioning.js:190) even when the account already exists. The response also carries a `provisioned` entry for every row. A whole-tenant backfill would be hundreds of wasted writes and hashes.

## Implementation

### 1. `server/rbac.js` — one named gate

- Export `PROVISION_STUDENT_LOGIN_ROLES`, derived (not hand-written) from `ENTITY_WRITE_ROLES.Student.update`, so it cannot drift.
- Export `canProvisionStudentLogins(req)`: `isSuperAdmin(req) || (hasAnyRole(req, PROVISION_STUDENT_LOGIN_ROLES) && canAnyProvisionRole(rolesOf(req), "student"))`.

### 2. `server/index.js` — new function branch

Add an `if (fnName === "provisionStudentLogins")` branch alongside the other authenticated functions (after the shared `if (!req.user)` 401 at server/index.js:5170; `req.user` is already populated by the pre-route optional-auth middleware).

Body: `{ student_ids?: string[], dry_run?: boolean }`.

1. `403` unless `canProvisionStudentLogins(req)`.
2. Tenant comes from `req.user.tenant_id` only — never from the body.
3. Load students scoped to that tenant. With `student_ids`: filter `{ _id: { $in: ids.filter(ObjectId.isValid) }, tenant_id }`; without: `{ tenant_id }`. Project `full_name, student_email, parent_email, parent_name, student_phone, parent_phone`.
4. Load the tenant's existing User emails into a `Set` (`User.find({ tenant_id }, { projection: { email: 1 } })`).
5. Load the tenant doc projected to `{ custom_domain, subdomain }` (needed by `ensureStudentEmails` for generated addresses).
6. **`dry_run: true`** — no writes. Return `{ scanned, missing_count, missing_ids, emails_to_generate, sample: first 10 }`, where a student is *missing* when its `student_email` or `parent_email` is absent or not in the User email set.
7. **Run** — `400` if `student_ids.length > 500`. For each id:
   - `ensureStudentEmails({ database, tenantId, student, tenant })`; if it returns keys, `$set` them on the Student (this is the one intentional write — it is what makes provisioning possible for rows that never had addresses).
   - `provisionAutoLogins({ database, tenantId, student: merged, studentId, creatorRoles: rolesOf(req) })`.
   - Accumulate `{ type, name, email, reused }` rows and counts of created vs reused.
8. Return `{ processed, created_count, reused_count, rows, default_password }`. `default_password` is the existing tenant-wide shared default already exposed on every `_provisioned` payload; it is returned once, never logged, never persisted in plaintext.
9. One `logServerAudit(req, { action: "provision_student_logins", entity_type: "Student", entity_id: "", details: "<n> students, <c> logins created, <r> reused" })`.

Add a `SERVER_AUDIT_ENTITIES`-independent call — `Student` is already in that set for entity routes, but this branch logs explicitly.

### 3. `src/lib/permissions.js` — one named client gate

Export `STUDENT_LOGIN_ROLES = ["school_admin"]` and use it for **both** buttons so they cannot drift apart.

### 4. `src/pages/Students.jsx`

1. Per-row button: switch the inline `hasAnyRole(...)` list to `STUDENT_LOGIN_ROLES` (drops the 403ing `PRINCIPAL`).
2. Header action "Create Portal Logins" (icon `KeyRound`, next to Bulk Import), gated on `STUDENT_LOGIN_ROLES`, disabled while a run is in flight and when there are no students in scope.
3. Handler:
   - `ids = selectedIds.length ? selectedIds : students.map(s => s.id)` (the page already loads the full tenant roster).
   - Invoke `provisionStudentLogins` with `dry_run: true` → open an `AlertDialog` (component already exists at src/components/ui/alert-dialog.jsx) stating how many of N students are missing logins, that existing accounts are reused untouched, and that new logins use the institution default password.
   - On confirm: loop `missing_ids` in chunks of 100, aggregating `rows` / `default_password`, showing a busy state.
   - Toast summary, then `load()`, then open `CredentialRevealModal` with the aggregated rows.
4. Wording in the confirm dialog must say students will be *checked/created*, not "N accounts will be created": a parent shared by two siblings appears missing on the first pass and is reused on the second.

### 5. `src/components/students/CredentialRevealModal.jsx`

Cap the rendered table at 200 rows and show a "+N more" footer line — a tenant-wide backfill can be hundreds of rows and the shared default password is identical for all of them anyway.

### 6. Tests

- `server/test/rbac.test.mjs`: `canProvisionStudentLogins` admits super_admin / school_admin / exam_coordinator (including multi-role holders) and refuses principal, teacher, student, parent, employee.
- `server/test/frontend-rbac-parity.test.mjs`: every role in `STUDENT_LOGIN_ROLES` is admitted by the server gate (subset rule).
- Live: add a case to `server/test-live/suites/capabilities.mjs` asserting a principal receives 403 and a school_admin does not.

## Risks and edge cases

- **bcrypt cost**: one hash per newly created login, sequential. A 300-student backfill is roughly 30s of hashing, which is why the run is chunked at 100 with a visible busy state rather than one unbounded request.
- **Shared parent email**: siblings produce one User; the second student hits the reuse branch and is added to `linked_student_ids` (server/provisioning.js:210-219). No duplicate accounts.
- **Email generation side effect**: students with no address get one generated and persisted. That is required for provisioning and is the same behaviour the create/import paths already have.
- **Reused accounts are never reset**: no password change, and `email_verified` is deliberately not set on reuse (server/provisioning.js:198-206).
- **Idempotent**: re-running finds nothing missing and returns zero rows.

## Validation

1. `node --test server/test/*.mjs server/test-live/rbac-live.mjs` (expect current 65 passing plus the new cases).
2. `npx vite build --mode production`.
3. Live, as school_admin on tenant "Testing 2": dry run should report the unprovisioned roster; confirm; verify `User` documents exist for `krishans@avexora.in` (app_role `student`) and `dilips@avexora.in` (app_role `parent`) with `must_change_password: true`; then log in as `krishans@avexora.in` with the tenant default password.
4. Re-run the dry run: `missing_count` must be 0 (proves idempotency).
5. Log in as a principal and confirm the button is absent.
