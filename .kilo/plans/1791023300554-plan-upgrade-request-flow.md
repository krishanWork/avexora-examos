# School-admin plan upgrade request & approval

## Problem

`/billing` (`src/pages/Billing.jsx`) is read-only. Line 99 tells the school admin to
"contact your Avexora account manager". There is no way to upgrade, and there is no
payment system to upgrade through:

- No gateway exists. Stripe is declared in `package.json` but imported nowhere; there are
  no gateway keys in `.env`, no payment webhook, and CSP `connect-src 'self'`
  (`vercel.json:35`) would block one anyway. `Payment` is written in exactly two places:
  `affiliateSell` (`server/index.js:6506`) and `server/seed.js`.
- A `school_admin` can **already self-upgrade** through the API. `Tenant.update` admits the
  role (`server/rbac.js:524`) and none of the three Tenant write routes guard the billing
  fields, so `PATCH /api/entities/Tenant/:id` with `{"subscription_plan_id": "<top plan>"}`
  grants any plan and any entitlement flag with no payment. Any upgrade UI is cosmetic
  until this is closed.
- `tenant.student_limit` and `tenant.omr_sheet_limit_per_month` are read by the quota
  guards (`src/pages/Students.jsx:285`, `src/components/exams/OMRUploadPanel.jsx:84`) but
  written by nothing, so both "Upgrade your plan" toasts are unreachable.

## Decisions

| Decision | Choice |
|---|---|
| Upgrade mechanism | Sales-assisted request. No gateway. Money collected offline, as `affiliateSell` already assumes. |
| Effect timing | Immediate on approval, and a subscription period is recorded: `subscription_period_start = now`, `subscription_period_end = now + plan.billing_cycle`. |
| Who approves | `super_admin` + `employee`, via a new capability key — not by widening `manage_billing`, which also gates the `/billing` route. |
| Money | Approval captures amount received + method and writes a `Payment` row. |
| Enforcement | Close the PATCH hole. Direct billing-field writes refused for all **non-platform** roles; `super_admin`/`employee` keep the Institutions-console override unchanged. |
| Scope | Flow + enforcement guard + entitlement snapshot + revive the two dead quota CTAs. Adjacent defects (seeded `is_active`, `billing_cycle` vocabulary, `exam_limit`, `/checkout`) are **out of scope** except where the period math depends on it (see Task 8 note). |

## Model

New collection **`PlanChangeRequest`**. `to_plan_*` and `from_plan_*` are snapshots taken at
request time, so a later catalogue edit does not rewrite history.

```
tenant_id, tenant_name
from_plan_id, from_plan_name
to_plan_id, to_plan_name, to_plan_price, to_plan_billing_cycle
reason                      // optional, from the school
status                      // pending | approved | rejected | cancelled
requested_by, requested_by_email, requested_date
decided_by, decided_by_email, decided_date, decision_note
payment_id                  // set on approval
created_date, updated_date
```

New `Tenant` fields: `subscription_period_start`, `subscription_period_end`.
`student_limit` and `omr_sheet_limit_per_month` are finally written at approval.

## Tasks

### 1. `server/rbac.js` — policy

- `PlanChangeRequest: { create: [], update: [], delete: [] }` in `ENTITY_WRITE_ROLES` (after
  `Payment`, `:514`). Empty everywhere: every state change goes through the server function,
  same treatment as `Payment` / `AffiliateSale`.
- `PLAN_CHANGE_APPROVE_ROLES = new Set([APP_ROLES.SUPER_ADMIN, APP_ROLES.EMPLOYEE])` and
  `canApprovePlanChanges(req)` next to `canManageAffiliates` (`:632`). Union via `hasAnyRole`.
- `canRequestPlanChange(req)` derived from `ENTITY_WRITE_ROLES.Tenant.update` rather than
  restated — the same convention as `PROVISION_STUDENT_LOGIN_ROLES` (`:572`). Place it after
  `ENTITY_WRITE_ROLES` is declared.
- Export `TENANT_BILLING_FIELDS` = `["subscription_plan_id", "plan_name",
  "subscription_period_start", "subscription_period_end", "student_limit",
  "omr_sheet_limit_per_month"]`. `white_label_enabled` / `powered_by_avexora` stay writable
  (branding is separately gated) — do not add them.
- Add `subscription_period_start`, `subscription_period_end` to `TENANT_PUBLIC_FIELDS`
  (`:734`) so the school admin's own `/billing` page can read them.

### 2. `server/index.js` — collections and scope

- Add `"PlanChangeRequest"` to `allowed` (`:104`), alphabetically after `"Payment"`.
- **Not** in `globalOnly` and **not** in `publicRead`. `school_admin` reads its own rows via
  the ordinary tenant branch: `readScope` adds `tenant_id: req.user.tenant_id` and
  `PRIVILEGED_TENANT_ROLES === EXAM_WORKFLOW_ROLES` (`server/crm-authorization.js:9`) already
  includes `school_admin`. No new read exception is needed.
- Add `"PlanChangeRequest"` to `PLATFORM_COMMERCIAL_RECORDS` (`:148`) so a `super_admin`
  "view as" institution still sees the platform-wide request queue.

### 3. `server/index.js` — the billing-field write guard

Add `tenantBillingWriteRefused(req, update)` beside `userPrivilegeWriteRefused` (`:566`):
return `403` naming the offending fields if any `TENANT_BILLING_FIELDS` key is present
**and** `!isPlatform(req)`. Super-admin bypass belongs *after* the field check, matching the
note at `canUploadPurpose` (`:595`): the platform override must not authorize a field the
policy does not define.

Call it on **all three** Tenant write routes. The comment at `:556-563` records exactly this
class of bug (a guard on one route and forgotten on another), and `userPrivilegeWriteRefused`
is called at only two sites today:

| Route | Line | Guard present? |
|---|---|---|
| `PATCH /api/entities/:name/bulk` | `:4094` | **No** — carries arbitrary per-item fields |
| `PATCH /api/entities/:name/many` | `:4171` | Yes, at `:4184` (User-only guard; extend) |
| `PATCH /api/entities/:name/:id` | `:4257` | Yes, at `:4284` (User-only guard; extend) |

For `bulk`, iterate `req.body.items` and check each item's keys.

### 4. `server/index.js` — `planUpgrade` function

New branch in the `/api/functions/:name` dispatcher, immediately before `affiliateSell`
(`:6326`), copying its shape: guard → payload validation → `ObjectId.isValid` → rate limit →
write → `logServerAudit` → `res.json`, with a compensating `catch`.

Shared helper `applyPlanToTenant(database, tenantId, plan, now)` — the single place that
writes plan fields, so the function and any future path cannot drift:

```js
{
  subscription_plan_id: plan._id.toString(),
  plan_name: plan.name,
  student_limit: plan.student_limit,
  omr_sheet_limit_per_month: plan.omr_sheet_limit,
  white_label_enabled: Boolean(plan.white_label_enabled),
  subscription_period_start: now,
  subscription_period_end: <now + cycleMonths(plan.billing_cycle)>,
  updated_date: now,
}
```

Actions:

- **`submit`** — `canRequestPlanChange`. Requires `req.user.tenant_id` (a tenant-less caller
  has nothing to upgrade). Validates the target plan exists and is not the tenant's current
  plan (else `400`). Refuses with `409` if a `pending` request already exists for the tenant.
  Snapshots both plans. Audits `plan_change_requested`.
- **`approve`** — `canApprovePlanChanges`. Request must be `pending` else `409`. Requires
  `amount` (positive number) and `payment_method`. Reads the tenant, captures the six billing
  field values **before** writing, then in order: apply plan → insert `Payment` → set request
  `approved` with `payment_id`, `decided_by`, `decided_date`. Audits `plan_change_approved`.
  On throw, delete the `Payment` by the inserted id and restore the captured tenant values.
- **`reject`** — `canApprovePlanChanges`. Requires `note`. Sets `rejected`. Audits
  `plan_change_rejected`. No tenant or payment write.
- **`cancel`** — `canRequestPlanChange`, and only the requesting tenant's own `pending`
  request. Sets `cancelled`. Audits `plan_change_cancelled`.

Guard the approve path against a plan already applied out-of-band: if
`tenant.subscription_plan_id === plan._id`, return `409` ("institution is already on this
plan") rather than writing a Payment for nothing.

### 5. Audit and indexes

- Add `"PlanChangeRequest"` to `SERVER_AUDIT_ENTITIES` (`:1112`). Combined with the empty
  `ENTITY_WRITE_ROLES` row, no client `logAudit` call can be accepted for it.
- `server/rate-limit.js`: add `planUpgradeSubmit: { windowMs: scaled(DAY), limit: 10,
  scope: "tenant:plan-change" }`, keyed on tenant rather than IP — one school's office NAT
  must not exhaust another school's budget.
- `server/ensure-indexes.js`: `{ tenant_id: 1, status: 1 }`; `{ status: 1, created_date: -1 }`
  for the approver queue; and a **unique partial** index on `{ tenant_id: 1 }` with
  `partialFilterExpression: { status: "pending" }` — the database-level guarantee of one
  live request per school, backing the `409` above.

### 6. `src/lib/permissions.js` — client mirror

- `submit_plan_change: ["super_admin", "school_admin"]` — mirrors `canRequestPlanChange`.
- `approve_plan_changes: ["super_admin", "employee"]` — mirrors `canApprovePlanChanges`.
- New `PAGE_ROLES.planRequests: ["super_admin", "employee"]` for the approver queue.
  Deliberately its own group, not `institutions`: this route grants paid entitlements.

### 7. Approver queue

- New `src/pages/PlanRequests.jsx`, route `/plan-requests` in `src/App.jsx` wrapped in
  `RoleGuard roles={PAGE_ROLES.planRequests}` inside the existing `AppLayout` group. Follow
  `SubscriptionPlans.jsx` / `AffiliatePortal.jsx`: `useState` + `useCallback` load +
  `requestSeq` ref for out-of-order guarding (the `AffiliatePortal.jsx:33-60` pattern).
- Nav entry under the platform section in `src/lib/nav.js` plus the matching `ROUTE_ACCESS`
  entry (`"/plan-requests": "planRequests"`). Both are asserted by the parity test — see
  Task 11.
- New `src/components/billing/PlanChangeApprovalDialog.jsx`: shows the tenant, from → to,
  and captures amount + method (`UPI` / `Bank transfer` / `Cash` / `Cheque`) to approve, or
  a required note to reject.
- Dialog style follows `TenantFormDialog.jsx`: `Dialog` + `DialogHeader` icon tile +
  `<form>` with `max-h-[60vh] overflow-y-auto` and a sticky `DialogFooter` using the `form=`
  attribute. Stone/indigo, not the violet marketing palette.

### 8. `src/pages/Billing.jsx` — the upgrade affordance

- Replace line 99 with: a **Change plan** button opening `PlanChangeRequestDialog`, and a
  pending-request card showing target plan, requested date, and a **Cancel request** action.
- New `PlanChangeRequestDialog.jsx` lists `active plans` from `SubscriptionPlan.filter({})`,
  marks the current plan, shows the price delta for the cycle, and takes an optional reason.
  Handle the empty-list case with `EmptyState`.
- Add the subscription period to the Current Plan card, rendered through a `cycleMonths()`
  normalizer — see Task 8 note below.
- Make `UsageBar` show an over-limit state (amber/red fill plus "Upgrade" text) when
  `used > limit`; today the bar clamps at 100% with no signal (`:70`).
- Fix the permanent skeleton: `loadBilling` early-returns on `!tenant?.id` (`:16`) before
  `setLoading(false)`, so a tenant-less caller never stops loading.

**Billing-cycle note (in scope because the period math needs it):** seeds write
`billing_cycle: "month"` (`server/index.js:7963`, `server/seed.js:69`) while `PlanFormDialog`
writes `monthly|quarterly|yearly`. Write one `cycleMonths(value)` normalizer accepting both
vocabularies (`month`/`monthly` → 1, `quarter`/`quarterly` → 3, `year`/`yearly` → 12, default
1) and use it for `subscription_period_end`. Full vocabulary reconciliation is out of
scope.

### 9. Revive the two dead quota guards

Both currently toast text that leads nowhere. Change them to open `PlanChangeRequestDialog`:

- `src/pages/Students.jsx:286` `limitToast()`
- `src/components/exams/OMRUploadPanel.jsx:91`

Both read limits off `tenant`, which `AppLayout` already provides via `useOutletContext`.
`OMRUploadPanel` computes `tenant` itself — confirm the source before wiring.

### 10. Not in this change

- Self-serve gateway checkout. `/checkout` (`src/pages/Checkout.jsx`) stays broken and
  unreachable; repairing it is separate.
- Payment/invoice history for the school admin. `Payment` is `globalOnly`, so a school admin
  cannot read their own payments — a history panel needs its own scoped endpoint.
- Seeded plans' missing `is_active` (which is why `UpgradeBrandingDialog` always says "No
  plans currently offer this option"), `exam_limit` enforcement, downgrades, cancellations,
  renewal reminders, dunning.

## Risks

1. **Quota enforcement activates for the first time.** `student_limit` has never been
   written, so `Students.jsx:285` and `OMRUploadPanel.jsx:84` have always passed. The first
   approval writes real limits, and any school already over its plan's `student_limit` will
   suddenly be blocked from admitting students. This is correct behaviour and is the point of
   the feature, but it will look like a regression. Expect support load; do not paper over it
   with a client-side bypass.
2. **Partial writes on approval.** Tenant update, `Payment` insert and request update are
   three writes. Use the compensating-rollback pattern from `affiliateSell` (`:6539-6557`)
   and capture the pre-write tenant values before touching anything.
3. **Tenant docs that already hold a hand-set plan.** Institutions onboarded through
   `TenantFormDialog` carry `subscription_plan_id` with no `subscription_period_start`. The
   `/billing` page must render a missing period as "—" rather than a fabricated date.
4. **Super-admin view-as.** Adding `PlanChangeRequest` to `PLATFORM_COMMERCIAL_RECORDS`
   keeps the queue wide; verify a view-as session can still approve, since the approval path
   writes a platform-scoped `Payment`.

## Validation

1. `npm run test:parity` — new `PAGE_ROLES.planRequests` group, its route, and its nav entry
   must all be admitted. Add the two new `PERMISSIONS` keys to `FRONTEND_ACTION_AUTHORITY` in
   `server/test/frontend-rbac-parity.test.mjs` pointing at the new `server/rbac.js`
   predicates, otherwise the subset invariant fails.
2. `npm test`, `npm run lint`, `npm run typecheck`.
3. `server/test-live/rbac-live.mjs` — add cases: `school_admin` submitting is allowed;
   `teacher`/`principal`/`exam_coordinator` submitting is `403`; `school_admin` approving is
   `403`; `affiliate`/`student`/`parent` are `403`; a `school_admin` PATCHing its own tenant
   with each of the six billing fields is `403`; a `super_admin` PATCHing the same succeeds.
   Cover all three write routes (`/bulk`, `/many`, `/:id`) — the `/bulk` route is the one
   that has no guard today.
4. Manual: as a `school_admin`, upgrade request → approve as `employee` → confirm the tenant
   gained the plan, the period, the limits, and a `Payment` row visible on
   `/super-admin` and `/platform-insights`.