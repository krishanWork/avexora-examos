# Plan: Create `EXAMOS_ARCHITECTURE.md`

## Goal

Create a single, evidence-based architecture document at repo root: `EXAMOS_ARCHITECTURE.md`. It documents ExamOS **as it exists today** (verified by source) and, in clearly separated sections, a **proposed** target. No application code, config, schema, dependency, or test file is modified. The only file created is the document.

## Constraints (non-negotiable)

- Read-only with respect to the application. One new markdown file only.
- Every material claim cites repository evidence: `path` + symbol/route/constant name. Prefer symbol names over line numbers (line numbers drift; a `route()` path or an `export const` name does not).
- Label every claim with one of:
  - *(Current)* — verified in source.
  - `INFERRED` — reasoned from source but not directly asserted by it.
  - `PROPOSED` — not implemented.
  - `NOT CURRENTLY IMPLEMENTED` — named in requirements/UI but absent from code.
- Never invent infrastructure. No Redis, message queue, Kafka, WebSockets, API gateway, Kubernetes, microservices, or cloud services unless they exist in the repo. The repo has **no** Redis, no queue, no WebSocket, no gateway, no container config.
- Current architecture and proposed architecture must be in separate sections and never mixed.
- The backend is the security boundary. Frontend role/permission checks are UX only; state this explicitly wherever frontend guards are described.

## Verified evidence base (already gathered — use as the source of truth)

### Runtime shape
- `api/index.js` → `export default app` imported from `../server/index.js`; this is the Vercel serverless function. `server/index.js` is **6,746 lines**.
- `server/index.js:6740` — `app.listen` runs only when `process.env.VERCEL` is unset; port `process.env.PORT || 3090`.
- `vercel.json` — `buildCommand: npm run build`, `outputDirectory: dist`, function `api/index.js` with `maxDuration: 300`, `memory: 1024`, `includeFiles: server/omr-engine/**/*.mjs,server/omr-engine/templates/**/*.json`; hourly cron `/api/cron/domain-monitor`; rewrites `/api/(.*)` → `/api` and `/(.*)` → `/index.html`; security headers on `/`, `/index.html`, `/assets/(.*)`.
- `package.json` — Node `>=20`, ESM, `dev` = concurrent server+client, `test` = `node --test server/test`, `lint`, `typecheck` (tsc over `jsconfig.json`), `test:rbac`, `backfill:email-verified`.

### Middleware / request lifecycle order (`server/index.js`)
`installApiLogging(app)` (line 83) → `cors` allowlist from `CLIENT_ORIGIN`, `credentials:false` (423) → `express.json({limit:"25mb"})` / `express.urlencoded` (424–425) → security headers incl. `SECURITY_CSP`, conditional HSTS (442) → public uploads route (598) → token hydration `app.use` (658) → first-login gate `FIRST_LOGIN_ALLOW` (672) → email-verification gate `VERIFICATION_ALLOWED_PATHS` (706) → routes. `route()` wrapper (584) maps Mongo `11000` → 409 and `err.statusCode` → HTTP status.

### Auth
- `createToken` (646) — `jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" })`; `getUserFromToken` (648) re-reads the `User` document on **every** request, so the JWT carries only an id.
- `JWT_SECRET` missing ⇒ `process.exit(1)` at startup (115–119).
- `hashPassword` bcrypt cost 10 (644).
- `/api/auth/me` (2904) fails closed on an unknown/missing `app_role` → 403 `NO_ASSIGNED_ROLE`; returns `email_verified` normalized boolean.
- Gates: first-login (`MUST_CHANGE_PASSWORD`, allowlist `FIRST_LOGIN_ALLOW = {/api/auth/me, /api/auth/change-password}`) and email verification (`EMAIL_UNVERIFIED`, allowlist in `server/rbac.js: VERIFICATION_ALLOWED_PATHS`).
- Reset token TTL 1h (`RESET_TOKEN_EXPIRY_MS`), verification token TTL 24h (`VERIFICATION_TOKEN_EXPIRY_MS`).
- `server/rate-limit.js` — `RATE_LIMITS` table (loginFail 10/15m per account+IP, loginIpFail 100/15m, loginLockout 30m, register 10/15m, tenantLookup 60/15m, reset/verify/invite/lead budgets). `getClientIp` trusts `req.socket.remoteAddress` off-Vercel and only the first `X-Forwarded-For` hop on Vercel. `getRateStore` → `MongoRateStore` when `VERCEL` or `RATE_LIMIT_STORE=mongo`, else `MemoryRateStore`. `runLimit` fails **open** with a warning.

### RBAC (`server/rbac.js` — pure, no req/db)
- `APP_ROLES` = 8 roles: `super_admin`, `employee`, `school_admin`, `principal`, `exam_coordinator`, `teacher`, `student`, `parent`. `VALID_APP_ROLES` is a `Set` over the values.
- Role groups: `PLATFORM_ROLES`, `EXAM_WORKFLOW_ROLES`, `STAFF_ROLES`, `FAMILY_ROLES`, `EXAM_MATERIAL_ROLES`.
- `PROVISIONING_HIERARCHY` + `canProvisionRole`.
- `ENTITY_WRITE_ROLES` — 27 entities × {create, update, delete} allowlists. `canWriteEntity` fails closed for unknown entity/verb and **always denies `AuditLog`**, even for `super_admin`. `User` has empty allowlists.
- `UPLOAD_PURPOSE_ROLES` (`logo`, `import`, `omr`) + `canUploadPurpose` — validates the purpose name *before* the super_admin bypass.
- `EXTRACT_ROLES` + `canExtractRoster`; `TRIAL_ROLES` + `canStartTrial`; `canDeleteOwnAccount`; `canReadAuditLog`; `resolveReadableTenantId`.
- Redaction: `SECRET_ENTITY_FIELDS` (7 credential fields), `TENANT_PUBLIC_FIELDS`, `TENANT_ADMIN_FIELDS`, `redactTenant`, `redactTenantBranding`, `redactSecrets`.
- `CLIENT_QUERY_OPERATORS = {$eq, $in, $ne}` + `isSafeQueryValue` — client filters may use equality only, never operators.
- `isEmailVerified`, `VERIFICATION_ALLOWED_PATHS`, `EMAIL_UNVERIFIED_RESPONSE`.
- `server/crm-authorization.js` — `PRIVILEGED_TENANT_ROLES = EXAM_WORKFLOW_ROLES`, `CRM_SCOPED_ROLES`, `studentIdsForUser`, `teacherAssignmentIsValid`, `canAccess` (fail-closed, stable IDs only, never display names).

### Multi-tenancy
- `server/index.js:113-114` — `publicRead = {Announcement, PlatformBranding, SubscriptionPlan}`, `globalOnly = {Lead, Payment, Tenant, User}`.
- `readScope` (1436) — platform roles bypass; `globalOnly` entities return `{_id: null}` except a tenant reading its own Tenant; otherwise `tenantCriteria` pins `tenant_id` to `req.user.tenant_id`; `PRIVILEGED_TENANT_ROLES` (via `crm-authorization.js`) get the whole tenant; `TenantAnnouncement` is role-targeted for non-privileged roles; then per-entity relationship narrowing for `student`/`parent`/`teacher` using `intersectIdCriteria` / `intersectStringFieldCriteria` — **client filters narrow, never widen**.
- `assertTenantOwnership` (1423) — 404 (not 403) on tenant mismatch.
- Family scoping specifics: `Result` for family requires `status: "published"`; `OMRSheet` for family requires `status ∈ {evaluated, processed}`; `Examination` for students requires `status: "published"` and class membership.
- `server/ensure-indexes.js` — 447 lines, **not** run at startup; preflight duplicate scans for `(tenant_id, admission_number)` and `Tenant.subdomain` abort without modifying data; compound per-tenant unique indexes with partial filters.
- `server/db.js` — `MONGODB_URI` required, `MONGODB_DB || "avexora_examos"`, 8s server-selection/connect timeouts, lazily connected.

### API surface (route families, from `rg` over `app.(get|post|put|patch|delete)`)
Auth: `POST /api/auth/register|login|reset-password-request|reset-password|verify-email|resend-verification|change-password`, `GET /api/auth/me`.
Ops: `GET /api/health`, `GET /api/cron/domain-monitor` (Bearer `CRON_SECRET`, 503 when unset).
Files: `POST /api/upload` (multer, `upload.single("file")`), `GET /api/files/:filename`, `GET /api/public/uploads/:filename`.
Generic CRUD: `GET/POST /api/entities/:name`, `POST /api/entities/:name/filter`, `GET/PATCH/DELETE /api/entities/:name/:id`, `POST/PATCH /api/entities/:name/bulk`, `PATCH/DELETE /api/entities/:name/many`. `col()` rejects any name outside the 27-entry `allowed` set with 404.
Users: `POST /api/users/provision`, `POST /api/users/invite`.
Integrations: `POST /api/integrations/extract`, `POST /api/integrations/:name` (auth only, returns empty output).
Functions: `POST /api/functions/:name` with an `if (fnName === ...)` chain — `publicSite`, `getExamTimetable`, `getExamRoster`, `previewExamRoster`, `getNextStudentNumbers`, `getMyTenant`, `deleteMyAccount`, `manageStaff`, `linkMyAccount`, `startFreeTrial`, `processOMRSheet`/`processOmrSheet`, `evaluateExamination`, `verifyCustomDomain`, `manageCustomDomain`, `runDomainMonitor`, `sendTestDomainAlert`, `getDomainMonitorStatus`, `logAudit`. Plus five dedicated `POST /api/functions/<name>` routes (setupAcademicStructure, saveBatchAttendance, getAttendanceHistory, getExamAttendance, reconcileExamAbsentees).
Leads: `GET/POST /api/leads`, `POST /api/leads/:id/email`, `GET /api/leads/:id/email-history`, `GET/POST /api/leads/:id/whatsapp`, `GET /api/leads/:id/whatsapp/messages|templates`, `POST /api/leads/:id/whatsapp/media`, `POST /api/webhooks/whatsapp`, `GET/PUT /api/lead-settings`, `GET/PUT /api/integration-settings`.

### Files / uploads
- `server/index.js:125-190` — private-by-default layout `tmp/`, `public/`, `private/<tenantId>/`; `UPLOADS_DIR` override, `os.tmpdir()` on Vercel, `cwd()/uploads` otherwise. `UPLOAD_SIZE_CAP` omr 50MB / import 25MB / logo 5MB. `ALLOWED_UPLOADS` binds extension **and** magic-byte signature per purpose; CSV validated as safe text.
- Purpose is never silently rewritten; an unknown purpose is 400, an absent purpose falls back to `omr`.
- Private file serving: bearer → tenant's own prefix; platform roles → cross-tenant scan; no bearer → HMAC capability token `signFileToken`/`verifyFileToken` (`<expiresAt>.<tenantId>.<mac>`, HMAC-SHA256 over `JWT_SECRET`, timing-safe compare, `private, no-store`, `nosniff`).
- `server/lib/s3.js` — `getStorageMode`/`initStorage`/`getStorage`; `s3` when `AWS_BUCKET_NAME` set or `STORAGE_BACKEND=s3`; `local` only off-production; **production with no valid bucket throws**; region default `ap-south-1`; SDK default credential chain fallback; `privateKey`/`publicKey` key builders; `downloadToFile`, `listKeys`.
- OMR staging (`server/index.js:312-354`): S3 objects are downloaded to `os.tmpdir()/examos-omr` because the CV engine needs a real path; annotated PNG is pushed back to S3.

### Examination + OMR
- Status ladder — `src/components/exams/ExamWorkflowSteps.jsx:5`: `draft → scheduled → omr_in_progress → evaluated → reviewed → published`, steps labelled Setup & Answer Key / Print OMR Sheets / Scan & Upload / Evaluate / Review / Publish Results.
- Server constants: `FROZEN_EXAM_STATUSES = {evaluated, reviewed, published}` (1093) — the answer key is immutable once the exam reaches these; `TEACHER_VISIBLE_RESULT_STATUSES = ["reviewed","published"]` (1098).
- `Result` lifecycle is `draft → reviewed → published`, driven from `src/components/exams/ResultsPanel.jsx` via generic `Result.update` (so it passes through `canWriteEntity`).
- Guards: teachers may only *create* examinations as `draft` and may never change status (2287–2297); `AnswerKey` writes require `examination_id`, tenant match, non-frozen parent exam, and reject a duplicate key per paper set.
- `processOMRSheet` (5220): requires `examWorkflow(req)`; `assertTenantOwnership` on sheet, exam, and student; optional `override_student_id` must be on the authoritative roster (`studentInExamRoster`); template chosen by question count (`a4_20q/50q/100q_4opt_v1`); tenant `admission_number_num_digits` override; unresolved image → `status/processing_status = failed`, `error_code: IMAGE_NOT_FOUND`, 422, audited — never a fabricated result.
- `evaluateExamination` (5772): requires `examWorkflow(req)`; only sheets with `status==="completed"` **and** `processing_status==="completed"` **and** roster membership **and** extracted answers are graded; `needs_review`/`review_required` sheets are counted and reported but never auto-graded; AnswerKey tenant cross-check; per-sheet student tenant check.
- OMR engine: `runOmrInWorker` (`omr-runner.mjs`) spawns one `Worker` per job, terminates it on settle, honours `timeoutMs`; `runOmrEvaluator` default timeout **60,000 ms** (`index.js:358`). `eval-worker.mjs` dispatches job kinds `generate` / `corrupt` / evaluate. `evaluator.mjs` `ENGINE_VERSION = "1.3.0-js-wasm"`; deterministic confidence constants; classification `confident` / `blank` / `multiple` / `needs_review`; `overallStatus = flaggedQuestions.length ? "review_required" : "completed"`. Uses `@techstark/opencv-js` WASM (not the Python `evaluator.py`, which is excluded at build time by `.vercelignore` and kept for golden-set generation).
- Roster: `server/examRosterService.js` — `resolveExamScope`, `deriveEnrolledStudents`, `ensureExamRoster`, `getExamRoster`, `getExamRosterStudentIds`, `studentInExamRoster`, `syncEnrollmentRosters`; `ExamRoster` collection.
- Correction records: `OMRCorrection` is written only client-side from `src/components/exams/review/SheetReviewer.jsx` via `bulkCreate`; it is in the `allowed` set and in `ENTITY_WRITE_ROLES` (create for `school_admin`/`principal`/`exam_coordinator`) but is **not** read anywhere server-side — results are corrected by re-running `processOMRSheet` with `override_student_id` or by editing `OMRSheet`. Mark this `INFERRED`/gap.
- Plan limits: `omr_sheet_limit_per_month` is checked **client-side only** (`OMRUploadPanel.mjs:82-94` counts this month's `OMRSheet` docs and toasts); `student_limit` likewise in `src/pages/Students.jsx:175-176`. No server-side enforcement found — a real gap worth documenting.

### Audit
- `logServerAudit` (1002) — best-effort (`try/catch` + `console.warn`), actor derived from `req.user` (or an explicit server-derived `actor` for anonymous routes), never from `req.body`; fields sliced to fixed lengths.
- `SERVER_AUDIT_EVENTS` (15 entities audited server-side); `CLIENT_AUDIT_EVENTS` (979) — a narrow allowlist of `verb:entity` pairs whose permitted roles are **read from `ENTITY_WRITE_ROLES`**, so client audit logging cannot exceed write rights.
- Reads gated by `canReadAuditLog` (platform + `school_admin` only).

### Security headers / CORS
- Server: CSP `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src` including `data: blob: static.wixstatic.com media.appclient.com *.wixstatic.com`, `frame-ancestors 'none'`, `object-src 'none'`, `worker-src 'self' blob:`; `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`; HSTS only when `req.secure` or `X-Forwarded-Proto: https`.
- `app.disable("x-powered-by")`. CORS allowlist from `CLIENT_ORIGIN`; **no default allow-all**; `credentials: false` (Bearer auth only).
- `vercel.json` repeats the same headers for `/` and `/index.html` and adds nosniff + HSTS to `/assets/(.*)`.

### Frontend
- `src/App.jsx` (196 lines) — **no `React.lazy` / code splitting**; every page is statically imported. Routes: public/marketing (`/`, `/pricing`, `/contact`, `/book-demo`, `/terms`, `/privacy`), auth (`/login`, `/s/:school`, `/s/:school/login`, `/portal/:school`, `/institute/:school`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/change-password`), platform (`/super-admin`, `/institutions`, `/tenants`, `/insights`, `/leads`, `/leads-management`, `/plans`, `/subscription-plans`, `/platform-branding`, `/employees`), tenant staff (`/dashboard`, `/teacher-portal`, `/examinations`, `/examinations/:id`, `/students`, `/students/:id`, `/parents`, `/enrollments`, `/teachers`, `/academic-setup`, `/analytics`, `/staff`, `/billing`, `/white-label`, `/audit-logs`, `/performance`, `/attendance`, `/timetable`, `/assignments`, `/announcements`), family (`/student-portal`, `/parent-portal`), `/checkout`, `*` → 404.
- `src/api/appClient.js` (166 lines) — token in `localStorage` under `avexora_examos_token`; `VITE_API_URL || "/api"`; `Proxy`-backed generic `entities` accessor; `functions.invoke(name, data)`; `integrations.Core.UploadFile` (reads `tenant_id` from the `avexora_view_as` sessionStorage impersonation key when absent); `users.getAssignedTenants`/`setAssignedTenants` route through `functions/manageStaff` because `assigned_tenant_ids` is server-secret and refused on generic writes.
- `src/lib/AuthContext.jsx` — hydrates from `auth/me`, keeps the session on `NO_ASSIGNED_ROLE` and `EMAIL_UNVERIFIED` (so `resend-verification` stays reachable), clears the token only otherwise.
- `src/components/ProtectedRoute.jsx` — spinner / `user_not_registered` / `no_assigned_role` / `email_unverified` branches, plus an explicit `email_verified === false` branch and a `must_change_password` redirect to `/change-password`.
- `src/lib/roles.js` — mirrors `APP_ROLES`, `PLATFORM_ROLES`, `TENANT_STAFF_ROLES`, `FAMILY_ROLES`, `EXAM_WORKFLOW_ROLES`, `isExamWorkflowRole`, `ROLE_PORTAL` (post-login destination per role), `rolePortal` returning `null` for no-role.
- `src/lib/impersonation.js` — **view-only** overlay in `sessionStorage` (`avexora_view_as`), gated on `app_role === "super_admin"`; the real `super_admin` JWT is still sent, so it is a rendering convenience and explicitly **not** a security boundary.
- `src/hooks/useTenantDomain.js` — any host that is not localhost/`PLATFORM_HOSTS` is a branding candidate; `functions.invoke("publicSite", {action:"branding", school: host})`; result cached in `sessionStorage` per host.
- `shared/custom-domain.js` — dependency-free, shared by browser and Node: `HOSTNAME_RE`, `normalizeHost` (lowercases, strips scheme/trailing dot, rejects paths/ports/wildcards), `classifyHost`, `isPrivateIp` (RFC1918, link-local, loopback, IPv6 ULA/link-local, CGNAT) as a DNS-rebinding guard.
- `server/lib/` — `domainGuard` (`assertCustomDomainAvailable`, `normalizeSubdomain`, `isReservedSubdomain`, `assertSubdomainUsable`, `assertSubdomainAvailable`), `domainVerifier` (`REASONS`, `createDomainVerifier`), `domainMonitor` (`verifyCronToken`, `buildDomainAlert`, `createDomainMonitor`), `hosting` (`HOSTING_STATUS`, `validateProviderContract`, provider registry, `vercelProvider` registered only when `VERCEL_TOKEN` present), `activationOrchestrator` (`ACTIVATION_STAGE`, `runCustomDomainActivation`).
- Self-hosted domain monitoring is opt-in via `DOMAIN_MONITOR_INTERVAL_MS` (min 60000ms) and disabled on Vercel where `vercel.json` drives the cron.

### Services
- `server/services/emailService.js` (`sendEmail`, `isEmailConfigured`, `getEffectiveEmailConfig`), `whatsappService.js` (message/template/media/interactive/list/CTA + `verifyApiKey`, `listWhatsAppTemplates`), `leadMessageService.js`, `leadNotificationService.js`, `leadSettingsService.js`, `integrationSettingsService.js`, `crypto.js` (`encryptionAvailable`, `encryptSecret`, `decryptSecret` gated on `SETTINGS_ENC_KEY`).
- Domain services: `academicSetupService.js`, `attendanceService.js` (`authorizeAttendanceAction`, `saveBatchAttendance`, `getAttendanceHistory`, `recordExamAttendance`, `getExamAttendance`, `reconcileExamAbsentees`), `examRosterService.js`, `examTimetableService.js` (`revealExamMaterial` flag), `identityResolver.js`, `studentNumberService.js`, `admissionNumberUtils.js`.
- `server/logger.js` — `installApiLogging`: echoes a safe `X-Request-ID` or generates a UUID, sets it on the response, logs `[API START]`/`[API END]` with method/path/status/duration and captures string `error` fields. **Console only** — no structured logging, no metrics, no tracing, no error reporting. Real observability gap.

### Data
- 30 collections referenced across `server/`+`shared/`: `AcademicYear, Announcement, AnswerKey, Assignment, AssignmentSubmission, Attendance, AuditLog, DomainMonitorRun, Enrollment, ExamRoster, Examination, IntegrationSettings, Lead, LeadSettings, OMRCorrection, OMRSheet, Parent, ParentStudent, Payment, PlatformBranding, RateLimit, Result, SchoolClass, Section, SequenceCounter, Student, Subject, SubscriptionPlan, Teacher, TeacherAssignment, Tenant, TenantAnnouncement, User`.
- `Entity` naming convention: collections are PascalCase; documents use `tenant_id`, `created_date`, `updated_date` string ISO fields (not BSON dates).
- No migrations framework. One-off `backfill-*` and `migrate-exam-roster` scripts in `scripts/` plus `server/backfill-*.js` run manually.
- `scripts/audit-admission-numbers.mjs`, `scripts/backfill-enrollments.mjs`, `scripts/backfill-student-class-ids.mjs`, `scripts/migrate-exam-roster.mjs`.

### Testing
- `server/test/` (node:test): `rbac.test.mjs` (40+ cases incl. fail-closed, AuditLog denial, delegation hierarchy, redaction subsets, query-operator safety, verification allowlist), `custom-domain.test.mjs`, `domain-monitor.test.mjs`, `domain-verifier.test.mjs`, `hosting-contract.test.mjs`, `live-probe.test.mjs`, `tenant-resolution.test.mjs`, `uniqueness.test.mjs`, `activation.test.mjs`, `activation-orchestrator.test.mjs`, `helpers.mjs`.
- `server/test-live/rbac-live.mjs` (needs `TEST_API_URL`) — 14 data collections exercised.
- `scripts/` contains 26 more `.mjs` harnesses, several requiring a live server or Mongo (`crm-authorization-test.mjs`, `omr-cv-pipeline-test.mjs` 1061 lines, `unified-exam-platform-test.mjs` 958, `phase2-crm-workflows-test.mjs` 1042, `s3-storage-integration-test.mjs`, `security-fixes-test.mjs`, `upload-security-test.mjs`, …). Only `server/test` is wired to `npm test`.
- OMR golden set: `server/omr-engine/golden/` — 10 named cases (perfect, blank_only, blur_brightness, close_margin, erasure, identity, mark_styles, multi_mark, perspective, rotated) with `.json` expectations + `.png` inputs; `scripts/omr-parity-check.mjs` asserts `engine === "opencv"`, `engine_impl === "js-wasm"`, status equality, `CONFIDENCE_TOLERANCE = 0.051`, `METRIC_TOLERANCE = 0.004`.
- **No frontend test framework, no CI config** (no `.github/`), no E2E harness.

### Configuration surface
- Server env (51 vars) — group them: `MONGODB_URI`/`MONGODB_DB`/`MONGO_URL`, `JWT_SECRET`/`PORT`/`CLIENT_ORIGIN`/`VERCEL`/`NODE_ENV`, `AWS_*`/`STORAGE_BACKEND`/`UPLOADS_DIR`, `RATE_LIMIT_*`/`CRON_SECRET`, `OMR_ENGINE_MODE`/`SKIP_BIG_UPLOAD`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_FULL_NAME`/`PROVISIONING_DEFAULT_PASSWORD` (default `Welcome@123`), `EMAIL_VERIFICATION_DEV_TOKEN`, `SMTP_*`/`SMTP_FROM`, `WHATSAPP_*`, `SETTINGS_ENC_KEY`, `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`/`VERCEL_PROJECT_NAME`/`APP_BASE_URL`/`HOSTING_PROVIDER`/`PLATFORM_CNAME_TARGET`, `DOMAIN_MONITOR_INTERVAL_MS`/`DOMAIN_MONITOR_LEASE_MS`, `LEAD_MANAGEMENT_URL`, `TEST_API_URL`, `VITE_API_URL`.
- Client env: `VITE_API_URL`, `VITE_FIREBASE_*` (7 vars). **`src/api/firebase.js` initializes Firebase Storage but is imported by nothing** — dead code; `firebase` is in `package.json` yet unused. Likewise `@stripe/react-stripe-js`/`@stripe/stripe-js` are dependencies but only `stripe` as a *CSS class name* appears in `src`; `src/pages/Checkout.jsx` is a 6-line stub. Document these as dependency/feature drift, not as architecture.

## Document outline (write in this order)

1. **Title, status header** — read-only source audit, date, branch `dev`, no files modified other than this document.
2. **Executive Summary** — what ExamOS is (multi-tenant SaaS for school exam delivery + OMR grading + parent/student portals + white-label custom domains), deployed as a Vercel serverless SPA+function, one Express monolith, MongoDB, S3, in-process worker OMR. State the security posture honestly: authorization is centralized and heavily tested; the weak points are observability, serverless OMR throughput, absent server-side plan-limit enforcement, and the single 6.7k-line file.
3. **Evidence & Labelling Conventions** — the four labels and the citation rule. Put this early so every later claim inherits it.
4. **System Context** (Mermaid `flowchart`) — browser, Vercel edge/CDN, serverless function, MongoDB, S3, SMTP, WhatsApp Cloud API, Vercel Hosting API, DNS.
5. **Runtime & Deployment** (Mermaid) — build → `dist` + `api/index.js`; cron; rewrites; headers; local `npm run dev` (Vite + Node on 3090) vs Vercel (no `listen`).
6. **Request Lifecycle** (Mermaid `sequenceDiagram`) — edge → CORS → JSON body limit → security headers → logging/request-id → session hydration → first-login gate → verification gate → route → `present()` redaction → audit. This is the single most important diagram; make it exact to the middleware order above.
7. **Frontend** — `App.jsx` route tree, no code splitting, `appClient` contract, `AuthContext` states, `ProtectedRoute` branches, `roles.js`/`permissions.js` mirrors, impersonation as a view overlay, `useTenantDomain`. **State plainly: these are UX gates; the server is the boundary.**
8. **Backend** — module inventory with one line each (`server/index.js` and its 6.7k lines; `rbac.js`; `crm-authorization.js`; `provisioning.js`; `rate-limit.js`; `db.js`; `ensure-indexes.js`; `logger.js`; the 11 services; `lib/` 8 modules; `omr-engine/` 8 files + 3 templates + 10 golden cases). Mark section boundaries present in the file (`SEC-03`, `SEC-06`, `SEC-01`, `SEC-02`, custom domain, domain monitor, lead management, functions).
9. **Authentication** (Mermaid) — register/login/reset/verify/change; JWT shape `{userId}` + per-request user re-read; bcrypt 10; the two global allowlist gates; rate-limit budgets; the login identifier path (email **or** non-email roll/admission number, which *requires* a resolved tenant).
10. **Authorization & RBAC** (Mermaid) — the 8 roles and their groups; `ENTITY_WRITE_ROLES` table (render all 27 rows, it is the core policy); the fail-closed rules; upload purposes; audit-log read/write asymmetry; provisioning hierarchy; `SEC-05`/`SEC-06` references. Cite `server/test/rbac.test.mjs` as the regression net.
11. **Multi-Tenancy & Tenant Boundary** (Mermaid) — `readScope` decision order; `publicRead`/`globalOnly`; `assertTenantOwnership` 404-not-403; index strategy; the impersonation caveat.
12. **Institution Login & Custom Domains** (Mermaid) — platform `/login` vs `/s/:school` vs hostname branding; `publicSite` `plans`/`lookup`/`branding`; `normalizeHost`; DNS verification + monitoring + hosting attach; the private-IP guard; cron secret.
13. **Examination Lifecycle** (Mermaid `stateDiagram-v2`) — the 6 statuses and the 6 UI steps; the answer-key freeze; the teacher status restriction; Result `draft→reviewed→published`; the fact that **status transitions are ordinary `Examination.update`/`Result.update` calls with no server-side transition table** (`INFERRED` gap — only the teacher restriction and the answer-key freeze are enforced).
14. **OMR Pipeline** (Mermaid `sequenceDiagram`) — upload → `OMRSheet` create → `processOMRSheet` → S3 staging to OS temp → `Worker` → OpenCV WASM evaluator → annotated PNG back to S3 → status write → audit; then `evaluateExamination` filtering to confident+rostered sheets; the "never fabricate" invariant; manual review; 60s timeout; one worker per request; `OMR_ENGINE_MODE=mock` and image-less fixtures as the only non-CV paths.
15. **File Storage** (Mermaid) — layout, purpose→type/size matrix, magic bytes, private serving (bearer / platform scan / HMAC capability token), S3 init fail-fast, OMR staging.
16. **Data Model & Collections** — the 30-collection table with role in the system; `tenant_id` convention; ISO date-string fields; no migration framework; the manual backfill scripts.
17. **API Surface** — route-family tables (per the user's chosen depth: families + auth/roles/scoping/validation/rate-limit/error semantics), **not** a per-field schema dump. Include the 18 `functions` names, the 5 dedicated function routes, and the 27-entry `allowed` entity list. Note the `11000`→409 mapping, the `route()` error contract, and the 401/403/404/409/422/429 conventions.
18. **Security Controls** — the implemented set (headers, CORS, magic bytes, capability tokens, JWT fail-fast, query-operator allowlist, redaction, privilege-field write refusal, `x-powered-by` disabled) and the **explicit non-implementation list**: no CSP nonce, no `helmet`, no WAF, no account lockout beyond rate limit, no refresh/rotation tokens, no 2FA, no session revocation (a 7d JWT stays valid until expiry — `INFERRED`, state it plainly), no brute-force protection on non-login endpoints.
19. **Audit & Observability** — `logServerAudit` semantics, `SERVER_AUDIT_EVENTS`/`CLIENT_AUDIT_EVENTS`, `canReadAuditLog`, and the observability gap: console-only `logger.js`, no metrics/tracing/alerting/error reporting. Rate-limit store failures are **fail-open** — an availability-over-security trade-off that must be stated.
20. **Testing & Quality** — `npm test` scope vs the 26 unwired `scripts/` harnesses; OMR golden parity tolerances; no frontend tests, no E2E, no CI; the existing 9 audit reports in the repo root as prior art.
21. **Architectural Problems** — ranked table (severity, evidence, impact). At minimum: (a) 6,746-line `server/index.js` mixing routing, policy, tenancy, audit, storage, OMR orchestration and lead management; (b) no code splitting in `App.jsx`; (c) OMR as a per-request worker thread on a serverless function with `maxDuration: 300` and 1024MB — no queue, no concurrency control, no retry, blocking a request for up to 60s; (d) plan limits (`student_limit`, `omr_sheet_limit_per_month`) enforced only in the client; (e) no server-side status transition table for examinations/results; (f) console-only observability; (g) `functions` dispatch by long `if` chain (additive by nature, drifts as it grows); (h) no migration framework; (i) no automated index creation at startup (manual script only) so a fresh deployment can run unindexed; (j) dead Firebase/Stripe dependencies and a stub `Checkout` page; (k) no revocation path for a 7-day JWT; (l) `OMRCorrection` written but never read server-side; (m) in-memory rate-limit store in non-Vercel single-process mode, and fail-open behaviour.
22. **Target Architecture (PROPOSED — modular monolith, incremental)** — the decision the user made. Keep one deployable. Stage it:
    - **Stage 1 — Observability & correctness first**: run `ensure-indexes` (or an idempotent startup indexer) in a controlled deploy step; add structured JSON logging with `requestId` correlation; add metrics for OMR latency/failures, auth failures, rate-limit trips; add a server-side plan-limit check; add an explicit exam/result status-transition validator.
    - **Stage 2 — Decompose the monolith** behind the existing `api/index.js` export, so deployment is unchanged: `server/app.js` (middleware + route mounting), `server/modules/{auth,entities,exams,omr,files,attendance,academic,leads,tenancy,staff}/*`, each with `{routes,service,policy}`; `server/policy/` for `readScope` + entity guards; `server/db/` for connection + index management. One route per move, no behaviour change, `server/test` green at every step.
    - **Stage 3 — Extract OMR as a queue-backed job, still one deployable**: persist an `OmrJob` collection with `queued|processing|completed|review_required|failed`, a Mongo-backed worker loop (the codebase already has `MongoRateStore` as precedent for a Mongo-backed cross-instance primitive), retries with idempotency keyed on `(omr_sheet_id, image checksum)`, and `processOMRSheet` returning `202 + jobId` with the existing UI polling. Note the tradeoff: this is still coupled to the function's `maxDuration` unless the worker is moved to a long-running runtime — call that out as the point where the deployment model itself must change.
    - **Stage 4 — Optional deployment split, only if measured need**: move the OMR worker to a long-running container; the API stays serverless. Do not preselect a cloud vendor.
    - Explicitly **out of scope**: microservices, event streaming, service mesh, Kubernetes, Redis, multi-region, a rewrite of the generic entity API.
23. **Migration Plan** — ordered, reversible, each step with a rollback note and a "how we know it worked" signal. Sequence: baseline metrics → structured logging → index deploy step → status-transition validator → server-side limits → app.js split → module extraction one at a time → OMR job queue → (optional) worker relocation. Every stage keeps `npm test` and the OMR parity check green.
24. **Architecture Decision Records** — ADR-001 modular monolith over microservices; ADR-002 generic entity API with a centralized write matrix (and its limits); ADR-003 tenant scoping in `readScope` as a read filter with intersection; ADR-004 capability tokens for private files; ADR-005 local-filesystem fallback only off production, S3 fail-fast in production; ADR-006 OpenCV WASM (`js-wasm`) rather than the Python engine at runtime; ADR-007 manual index management; ADR-008 bearer JWT without refresh/rotation (and its known cost); ADR-009 console logging (and its cost).
25. **Risks & Open Questions** — questions only code cannot answer: which deployment target is assumed long-term (does `maxDuration: 300` remain acceptable)? Is a real S3 bucket configured in every environment? Is `set` in the same region as Mongo? Is `OMR_ENGINE_MODE=mock` ever live? Who runs `ensure-indexes` and when? Is plan-limit enforcement a revenue requirement (then Stage 1 is blocking)? Is `OMRCorrection` meant to be authoritative?
26. **Appendix: Repository Evidence Index** — a table of `file → what it proves`, so a reader can re-derive every claim.

## Mermaid diagrams to include (12)

1. System context (flowchart)
2. Deployment topology (flowchart)
3. Request lifecycle (sequenceDiagram)
4. Authentication sequence (sequenceDiagram)
5. Authorization decision (flowchart) — `canWriteEntity` + `readScope`
6. Tenant boundary (flowchart)
7. Institution login & custom domain (sequenceDiagram)
8. Examination lifecycle (stateDiagram-v2)
9. OMR pipeline (sequenceDiagram)
10. File upload/serve flow (flowchart)
11. Frontend route + guard map (flowchart)
12. Backend module map (flowchart) — current, and a second diagram for the proposed Stage 2/3 layout

Each diagram must use valid Mermaid syntax (quote any node label containing `(`, `-`, `:` or `/`), and must not invent a component that does not exist.

## Validation before declaring done

1. `rg -n "EXAMOS_ARCHITECTURE" -g '!node_modules'` is not needed; simply confirm `git status` shows **only** `EXAMOS_ARCHITECTURE.md` as untracked and no tracked file modified. The worktree was **already dirty** before this task — do not attempt to clean it, and do not include pre-existing modifications in this change.
2. Re-check every route path, collection name, constant value, and env var name in the document against the source one final time; delete or downgrade to `INFERRED` anything that cannot be re-verified.
3. Confirm all 12 Mermaid blocks are syntactically valid (e.g. render or run a Mermaid parse over the fenced blocks). A broken diagram is worse than no diagram.
4. Confirm no claim asserts a Redis/queue/Kafka/WebSocket/gateway/Kubernetes/microservice component exists today.
5. Confirm the Proposed/Target sections are fully separated from the Current sections and that every item in them is labelled `PROPOSED` or `NOT CURRENTLY IMPLEMENTED`.
6. Confirm the document states that frontend guards are not a security boundary.
7. Run `npm run lint` and `npm run typecheck` **only** if the document is the sole change and the toolchain is otherwise clean; a markdown-only addition cannot break them, so skip rather than risk touching unrelated state. Note in the final response that no code was run.

## Risks for the implementing agent

- **Drift**: the document describes a file that is 6,746 lines long and actively changing. State the audit date and branch in the header and add a "re-verify before relying on line numbers" note.
- **Over-claiming**: the single largest failure mode is asserting behavior that was read only partially. When unsure, downgrade to `INFERRED` or `NOT CURRENTLY IMPLEMENTED` rather than dropping the item.
- **Diagram invention**: Mermaid is where fictional components sneak in. Every node must be traceable to a file or a documented absence.
- **Mixing current and proposed**: keep them in physically separate sections and re-check after writing.
- **Scope creep into code fixes**: the plan authorizes exactly one new file. If the agent believes a code change is warranted, it belongs in the Architectural Problems or Risks section as a recommendation, not as an edit.

## Open questions (already answered or defaulted)

- Target architecture stance → **modular monolith, incremental** (user-selected).
- API section depth → **route families + semantics**, no per-field schema (user-selected).
- Document location → repo root, `EXAMOS_ARCHITECTURE.md` (as originally requested).
- Everything else is settled by the evidence base above; no further user input is required to execute this plan.
