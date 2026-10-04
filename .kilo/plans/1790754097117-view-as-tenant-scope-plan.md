# Plan: server-side "view as school" scope

## Problem (verified in code, two independent defects)

A `super_admin` who "enters" a school sees **every** institution's data while the UI claims otherwise.

1. `src/lib/impersonation.js:22-27` — `startImpersonation()` writes to **sessionStorage only**. The real
   `super_admin` JWT is still sent, so this is explicitly "a rendering convenience, never a security
   boundary".
2. `server/index.js:1541` — `readScope()` short-circuits on `platform(req)` and returns the criteria
   untouched, so a `super_admin` token bypasses tenant scoping on every entity read.
3. `src/pages/StaffAccess.jsx:121` — `isPlatformOwner = hasAnyRole(user, ["super_admin"])`. Under the
   overlay `user.app_roles` is `["school_admin"]`, so this is **false**: the institution picker
   disappears and `load()` (line 98-102) is called with **no `tenant_id`**.
4. `server/index.js:5286` — `find(tenantId ? { tenant_id: tenantId, ...staffScoped } : staffScoped)`.
   With no tenant, a `super_admin` receives the staff of **every** school, rendered under a banner
   naming one school.

A second, separate instance of the same defect exists **without** impersonation: a `super_admin` who
opens `/staff` and has not picked an institution either spins forever (`loading` starts `true`,
line 46, and `load()` is only called when `selectedTenantId` is set, line 149) or, after a role change
(`changeRoles` → `load()` at line 179), fires an unscoped call that returns every school's staff.

## Decisions (agreed)

| # | Decision |
|---|---|
| 1 | The server **narrows** on a client-supplied scope. It is a display/authority constraint, not a real impersonation session. |
| 2 | The scope is sent **only while a "view as" session is active**. The Staff Access institution picker keeps its explicit per-call `tenant_id`; platform-wide browsing is otherwise unchanged. |
| 3 | The scope constrains **reads and writes**. |
| 4 | `/staff` with no institution chosen shows an **empty state and sends no request**. A deliberate "All institutions" control may still fetch the platform-wide list. |
| 5 | Of `globalOnly = {Lead, Payment, Tenant, User}`, only **`User`** narrows. `Tenant`/`Lead`/`Payment` stay platform-wide so the Institutions console and breadcrumbs still work while impersonating. |
| 6 | Student/parent impersonation narrows to the **school only**, and the banner says so. |

**Monotonicity is the safety argument.** The header can only ever *remove* rows a `super_admin` could
already read, so it cannot create a privilege escalation. A caller that omits it gets today's
platform-wide read — no regression. It is still client-driven, so impersonation remains **not** a
security boundary, and the docs must keep saying that.

## Contract

Header `X-View-As-Tenant: <tenantId>`, honoured **only** for `super_admin` (matching the
`applyImpersonation` gate at `src/lib/impersonation.js:34-39`). For any other caller the header is
**ignored**, never applied — a non-platform account must not be able to move its own scope.

Resolution happens once, in middleware, right after `req.user` is populated
(`server/index.js:678-684`): unparseable id or unknown `Tenant` → **404 "Institution not found"**;
existing but disabled → **400 "Cannot manage staff for an inactive institution"** (identical to
`requireLiveTenant`, `server/index.js:5219-5232`). Failing closed matters here: a scope that silently
fails open would show *more* than the operator asked for.

## Tasks

1. **`server/index.js` — scope middleware.** After the auth middleware, read
   `req.headers["x-view-as-tenant"]`. Absent → `req.viewAs = null`. Present and not `super_admin` →
   `req.viewAs = null` (ignored). Present and `super_admin` → validate as above, set
   `req.viewAs = { tenant_id }`, or short-circuit with the error. One extra `Tenant.findOne` per
   request, paid only while impersonating. No caching (a cached scope would outlive a disabled tenant).

2. **`server/index.js:1540` — narrow in `readScope`, above the `platform()` short-circuit.** Order
   matters: the `globalOnly` branch (line 1543) currently returns `{_id: null}` for non-platform, so
   the `User` case must be handled **before** it. While `req.viewAs` is set: `User` →
   `{ ...criteria, tenant_id: scope }`; `Tenant`/`Lead`/`Payment` and anything in `publicRead` →
   unchanged; everything else → `{ ...criteria, tenant_id: scope }`. This is what makes decision 5 and
   the "reads" half of decision 3 fall out of one place, and it covers update/delete/bulk for free
   (call sites at lines 3791, 3800, 3857, 3889, 3929, 4064 all resolve their target through
   `readScope`).

3. **`server/index.js:3669` — entity create.** `...(!platform(req) && { tenant_id: req.user.tenant_id })`
   lets a platform caller write any `tenant_id` from the body. Add a scoped branch that **forces**
   `tenant_id: req.viewAs.tenant_id`. Force, do not refuse: the client legitimately omits `tenant_id`
   on create, so refusing would break the common case and a refusal is not needed for safety.

4. **`server/index.js:3790` — bulk update.** `platform(req) ? dataNoWarn : strip tenant_id` likewise
   lets a scoped caller re-parent a row. Treat a scoped caller as non-platform for the strip **and**
   force `tenant_id` to the scope. Sweep for the same pattern on any other platform branch that
   trusts a body `tenant_id` (notably `/upload`, and the `bulk create` path near line 3709).

5. **`server/rbac.js:558` — intersect in `resolveStaffTenant`.** It is pure and takes `req`, so the
   scope belongs here: when `req.viewAs` is set, an absent `requestedTenantId` resolves to the scope
   and a `requestedTenantId` that differs from it is **404 "Institution not found"** — the same
   "don't confirm another institution exists" rule the cross-tenant branch already applies. This alone
   covers `manageStaff` (`server/index.js:5249`) and `/users/invite` (`:4137`).

6. **`server/index.js:5317` — `manageStaff setRole`/`setRoles` under a scope.** `assignUserRoles`
   exempts `super_admin` from the tenant boundary, so the scope does not reach it through step 5.
   While scoped, load the target and require `target.tenant_id === req.viewAs.tenant_id`, else **404**
   with nothing written.

7. **`server/index.js` — `manageStaff getAssignedTenants`/`setAssignedTenants`.** Platform-level
   employee feature; while scoped, a target outside the scope is **404** and `setAssignedTenants` is
   refused outright.

8. **`src/api/appClient.js:10` — send the header centrally.** `request()` already merges
   `options.headers`, so add `X-View-As-Tenant` from the impersonation record there; every API call is
   then covered without touching call sites. Import the reader from `@/lib/impersonation` rather than
   re-reading `sessionStorage`, keeping one owner for that key.

9. **`src/api/appClient.js:102` — `UploadFile`.** It has its own `fetch` and currently hand-rolls the
   impersonation tenant from `sessionStorage` (lines 94-101). Replace that ad-hoc read with the same
   header; the upload route then sees a consistent scope. Keep appending the body's `tenant_id` —
   the server, not the client, decides which wins.

10. **`src/pages/StaffAccess.jsx` — kill the loading trap and the unscoped reload.** `loading`
    (line 46) is never cleared when no request is made, so a platform owner with no selection spins
    forever and never sees the empty message that already exists (line 504). Guard every `load()`
    call site (lines 149, 179, 502) so no request is issued while a platform owner has no
    `selectedTenantId`. Add the explicit "All institutions" control per decision 4. While
    impersonating, keep the picker hidden (the overlay already makes `isPlatformOwner` false) and show
    the impersonated school's name in the page header so the table is self-describing.

11. **`src/components/shared/ImpersonationBanner.jsx` — state the scope honestly.** For student and
    parent impersonation the scope is the school, not the one child (decision 6); the banner must not
    imply otherwise. Also fix the stale comment at `src/lib/impersonation.js:22-27`, which claims the
    overlay changes nothing about what the API may do — that is no longer true.

## Tests

- `server/test/rbac.test.mjs` — `resolveStaffTenant` under `req.viewAs`: absent request → the scope;
    matching request → the scope; different request → 404. Pure, no DB.
- `server/test-live/rbac-live.mjs` — a super_admin **with** the header sees only that school's
    `Student` rows, and **without** it still sees every school (the no-regression case, which must
    fail loudly if the header is ever ignored by accident).
- `manageStaff list` with the header and no `tenant_id` → that school's staff; with a conflicting
  `tenant_id` → 404.
- `manageStaff setRoles` on a user in another school while scoped → 404 **and the stored roles are
  unchanged** (assert against the document, not a hand-computed value).
- `entities/User` with the header → only that school's accounts; `entities/Tenant` → still every
  institution (decision 5, in both directions).
- A `school_admin` sending the header is ignored: its own-tenant list is unaffected and its
  cross-tenant attempt still 404s.
- Header naming an unknown tenant → 404; a disabled tenant → 400.
- A scoped entity create with a foreign `tenant_id` in the body lands in the scoped school.

## Docs

`EXAMOS_ARCHITECTURE.md`, beside the §9.7 staff-management material: the header contract, the
monotonicity argument, the `globalOnly` exemption and why, and — stated plainly — that impersonation
narrows what is shown and does **not** revoke platform authority, since a caller who omits the header
still holds it. Correct the stale "never a security boundary" comment in the code to match.

## Risks

- A platform-only view that *needs* cross-tenant data while impersonating (a cross-school comparison
  screen) becomes school-scoped. `Tenant` is exempt, so the Institutions console survives; anything
  else found in implementation should get the same explicit exemption rather than a client-side
  workaround.
- One extra `Tenant.findOne` per request while impersonating. Acceptable; not worth caching.
- The header is client-driven, so a determined caller can omit it. That is the accepted cost of
  decision 1 and the reason the docs must not overstate the guarantee.

## Out of scope

Real impersonation tokens; auditing scoped reads; narrowing `Lead`/`Payment`/`Tenant`; a
per-student scope dimension for the family portals.
