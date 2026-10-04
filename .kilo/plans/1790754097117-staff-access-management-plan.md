# Staff Access: hide family logins, open `/staff` to principals, promote to school_admin

## Goal

1. **Hide students and parents from `/staff`.** Family portal logins are managed on the Students
   and Parents pages.
2. **Let a principal manage staff.** Today only `super_admin` and `school_admin` can.
3. **Let a school_admin promote a colleague to `school_admin`.** Today no UI can, anywhere.

## Decisions already made (do not re-litigate)

- **No primary-role picker.** `APP_ROLE_PRECEDENCE` keeps deriving the primary. The UI already shows
  it (`StaffAccess.jsx:294-296`, `Primary: {labels[0]}` when more than one role is held) — no work
  needed.
- **Promotion ≠ minting.** A school_admin may **promote an existing login** to school_admin, but may
  **not create a new school_admin account**. Minting a new administrator stays `super_admin`-only.
  See task 1 — this is why the two delegation matrices are split.
- **Removing `school_admin` is allowed, with one guard:** refuse any change that would leave a school
  with zero administrators. Peer demotions stay reversible.
- **Role-less accounts stay visible** in a separate *Unassigned* group, so an account locked out by
  `NO_ASSIGNED_ROLE` can still be rescued. Only students and parents are hidden.
- **Self-editing stays off** — your own row remains a read-only badge.

## Target capability model

| Capability | Predicate | super_admin | school_admin | principal |
|---|---|:-:|:-:|:-:|
| Reach `/staff`, call `manageStaff` | `canManageStaff` | ✅ | ✅ | ✅ |
| Create a new account (`provisionUser`, `manageStaff invite`, `/users/invite`) | `canProvisionRoleSet` — `PROVISIONING_HIERARCHY` | any | teacher, exam_coord, principal | teacher, exam_coord |
| Re-label an existing account (`setRole`/`setRoles`, `User` PATCH) | `canAssignRoleSet` — `ROLE_ASSIGNMENT_HIERARCHY` | any | **+ school_admin** | teacher, exam_coord |

`exam_coordinator`, `teacher`, `employee`, `student`, `parent`: no access to any of the three.

## Tasks, in order

### 1. `server/rbac.js` — split minting from assignment

Two matrices, because "may this actor create a new identity" and "may this actor re-label an
existing one" are different questions. A school_admin may hand a colleague the admin role — that
person is already vetted and already has a login — but may not mint a fresh administrator, which is
what a compromised account would use to plant a backdoor that survives the admin's own removal.

- Keep `PROVISIONING_HIERARCHY` **exactly as it is**.
- Add `ROLE_ASSIGNMENT_HIERARCHY` = `PROVISIONING_HIERARCHY` plus the creator's own level for
  `super_admin` and `school_admin` **only**. `principal` deliberately does **not** get its own
  level, so a principal can never promote a peer to principal or school_admin.
- Refactor so both share one implementation and keep the existing return shape
  (`{ error, roles }`) and `validateAppRoleSet` shape check:
  - `canAnyProvisionRole` (provisioning matrix) — unchanged signature and behaviour.
  - `canAnyAssignRole` (assignment matrix).
  - `canAssignRoleSet` → assignment matrix; **existing semantics for every role except
    school_admin/super_admin are unchanged, so the current unit tests still pass.**
  - `canProvisionRoleSet` → provisioning matrix.
- Add `STAFF_MANAGE_ROLES = new Set([SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL])` and
  `canManageStaff(req) = hasAnyRole(req, STAFF_MANAGE_ROLES)` — a union check like every other
  capability predicate.
- Add `staffAssignableRolesFor(creatorRoles)` = assignment matrix union ∩ `STAFF_ROLES`:
  - `super_admin` → `[school_admin, principal, exam_coordinator, teacher]`
  - `school_admin` → `[school_admin, principal, exam_coordinator, teacher]`
  - `principal` → `[exam_coordinator, teacher]`
  - never a family or platform role.
- `staffCreatableRoles` / `staffCreatableRolesFor` **keep reading `PROVISIONING_HIERARCHY`** — the
  create form is unchanged and the `A5b` contract holds.

### 2. `server/index.js` + `server/provisioning.js` — point each caller at the right matrix

The rule: an action that can create an identity uses the provisioning matrix; an action that can
only re-label an existing one uses the assignment matrix.

| Site | Action | Predicate |
|---|---|---|
| `index.js:1092` `assignUserRoles` | re-label | `canAssignRoleSet` (unchanged call site, new matrix) |
| `provisioning.js:267` `provisionUser` | mint | **`canAssignRoleSet` → `canProvisionRoleSet`** |
| `index.js:4067` `/users/invite` | mint | **`canAssignRoleSet` → `canProvisionRoleSet`** |
| `index.js:5217` `manageStaff invite` | mint | **`canAssignRoleSet` → `canProvisionRoleSet`** |
| `provisioning.js:110` `provisionAutoLogins` | mint family logins | `canAnyProvisionRole` (unchanged) |

`manageStaff invite` updates an *existing* account when the email matches, but it is still an
invitation — its purpose is to bring someone new in — so it keeps the minting matrix. To promote an
existing account, use `setRoles`. That two-step is deliberate and should be stated in the error
message when a school_admin tries to invite one.

### 3. `server/index.js` — `manageStaff` route

- Replace the gate `!canWriteEntity(req, "Teacher", "create")` with `!canManageStaff(req)`.
  `Teacher.create` stays `["school_admin"]`; that matrix is unrelated to staff management.
- **`list`: scope the query.** Replace `find({ tenant_id })` with a `$or` admitting only
  (a) accounts holding a staff role and (b) accounts with no recognized role. It must reproduce the
  `app_roles`→`app_role` legacy fallback, and `$size: 0` does **not** match a missing field, so the
  missing and empty-array cases need separate branches. Keep tenant scoping exactly as today. A
  role-less row is already identifiable client-side as `getAppRoles(row).length === 0`, so no new
  response field is needed.
- **`list`: add `assignable_roles: staffAssignableRolesFor(rolesOf(req))`** beside `creatable_roles`.

### 4. `server/index.js` — guard ordering, and the last-administrator invariant

Reorder `assignUserRoles` so the tenant boundary is settled **before** the hierarchy judgement:

1. validate id (400/404) → 2. normalize requested → 3. `validateAppRoleSet` (shape/family, no DB)
→ 4. load `targetUser`, 404 → 5. **tenant boundary, 404** → 6. **hierarchy, 403** (skipped for
`super_admin`) → 7. `nextTenantId` / tenant-role-requires-a-tenant, 400 →
8. **last-administrator invariant, 400** → 9. write → 10. audit.

Step 5 before step 6 matters: if the hierarchy is judged first, the 403-vs-404 ordering tells a
caller whether its own authority was insufficient *for that specific target*, which is a small but
free cross-tenant signal.

Keep **write-then-audit**, not audit-then-write. A failed mutation after the audit row leaves a
phantom log entry; a failed audit after the mutation leaves an unlogged change. The latter is worse,
and it is what the code does today.

Last-administrator check, in step 8: if the target currently holds `school_admin`, the new set does
not, and `nextTenantId` is set, count other accounts in that tenant holding `school_admin`
(excluding the target); refuse if the count is `0`. Apply to **every** caller including
`super_admin` — they can promote someone first, and a uniform rule is easier to reason about than a
special case.

Mirror the same guard onto **`delete_own_account`**. `canDeleteOwnAccount` is only
`!isPlatform(req)` (`rbac.js:419`), so a sole administrator can currently delete themselves and
strand the school through a completely different path than the one being guarded.

### 5. `src/lib/permissions.js`

- Add `PAGE_ROLES.staffManagement = ["super_admin","school_admin","principal"]`.
- **Do not widen `PAGE_ROLES.schoolAdmin`** — it also gates `/billing` and `/white-label`.
- Widen `PERMISSIONS.manage_staff` to include `principal`; add a separate
  `manage_billing: ["super_admin","school_admin"]` (task 7 needs both).
- **No `canCreateStaff` predicate.** Whether someone may create accounts is already answered
  explicitly by `creatable_roles` coming from the provisioning matrix, and the UI keys off that
  array being non-empty. A predicate with no independent behaviour would be dead code; the
  separation the review asked for lives in the two matrices, not in a third helper.

### 6. `src/App.jsx` and `src/components/layout/AppLayout.jsx`

- Move `/staff` out of the `PAGE_ROLES.schoolAdmin` block into its own
  `<RoleGuard roles={PAGE_ROLES.staffManagement}>`. `/billing` and `/white-label` stay put.
- Add `{ to: "/staff", label: "Staff Access", icon: UserCog }` to `NAV[APP_ROLES.PRINCIPAL]`
  (currently `["/billing", ...]` are school-admin-only; do not add them).

### 7. `src/pages/SchoolDashboard.jsx`

- The quick-nav at ~lines 282-287 bundles `/staff` and `/billing` behind one
  `can(user,"manage_staff")`. Split it: a principal sees **Staff Permissions** but not **Plan &
  Usage** (the latter on `can(user,"manage_billing")`).

### 8. `src/pages/StaffAccess.jsx`

- Add `assignableRoles` state from `data.assignable_roles`; keep `allowedRoles`
  (`creatable_roles`) for the create form. Use `assignableRoles` for the table's
  `withCurrentRoles(...)`.
- Partition rows: `getAppRoles(row).length > 0` → staff table; `=== 0` → a second `DataTable` under
  a short **Unassigned accounts** heading noting these are locked out of the login gate. Reuse
  `columns`; hide the second table when empty.
- Update the `withCurrentRoles` comment — its "a student or parent, which this screen still lists"
  rationale no longer holds.
- Optional polish: a `title` on each checkbox explaining that adding a wider role changes that
  person's portal and read scope. The primary label is already shown.

### 9. Tests — `server/test/rbac.test.mjs`

- `canManageStaff`: true for `super_admin`/`school_admin`/`principal`; false for the other five.
- `staffAssignableRolesFor`: `school_admin` includes `school_admin`, `principal` does not, and no
  caller ever receives a family or platform role.
- **The split itself:** `canAssignRoleSet([school_admin],["school_admin"])` allowed **but**
  `canProvisionRoleSet([school_admin],["school_admin"])` refused. Pin both — this is the invariant
  the whole task exists to establish.
- `canAssignRoleSet([principal],["school_admin"])` and `canAssignRoleSet([principal],["principal"])`
  both refused, role named in the message.
- `staffCreatableRolesFor` **still** excludes `school_admin` and family roles (protects `A5b`).
- Existing assertions at lines 943-980 stay valid — confirm rather than rewrite.

### 10. Tests — `server/test-live/rbac-live.mjs`

- **Invert `C10`** (`:859`, "principal CANNOT manage staff"): principal lists staff (200) and may
  `setRoles` to `exam_coordinator`/`teacher`, but 403 for `principal` and `school_admin`.
- **Cross-tenant, principal (new — the gap):** principal A naming tenant B on `manageStaff list` and
  on `setRoles` against a tenant-B user → **404**, not 403. `resolveStaffTenant` and
  `assignUserRoles` both answer 404 deliberately, so the reply never confirms tenant B exists.
  (school_admin already has this via `A5f`, `B11`, `B12` — do not duplicate it.)
- `B17d` (exam_coordinator → 403) unchanged and must stay.
- **Rewrite `M10`** (`:1527`), which asserts 403 for `{app_roles:["teacher","school_admin"]}` by a
  school_admin. Now permitted. Replace with the last-administrator test: demote the tenant's only
  admin → 400 **and** stored roles unchanged; with a second admin present the same demotion
  succeeds.
- New: `list` returns no student or parent row, but does return a seeded role-less account
  (`app_role: "wizard"`).
- New: `assignable_roles` includes `school_admin` for a school_admin, excludes it for a principal.
- New: a school_admin promotes a teacher to `school_admin` (200), then demotes them back (200).
- New, and the one that pins the split at the HTTP layer: a school_admin calling
  `manageStaff invite` and `POST /users/provision` with `school_admin` → **403**, while
  `setRoles` with `school_admin` → **200** for the same actor.
- New (recommended): sole admin's self-delete refused; a second admin's succeeds.

### 11. `EXAMOS_ARCHITECTURE.md`

- §9.7: the two matrices and why they differ; the guard ordering; the last-administrator invariant
  including the self-deletion route.
- §9.6 / vocabulary: `manageStaff` is now super_admin + school_admin + principal;
  `PAGE_ROLES.schoolAdmin` no longer gates `/staff`; the staff-list scoping rule.
- Delete the "a school's *second* administrator … has **no UI control today**" caveat, and replace
  it with the two-step reality: the platform creates the login, any school_admin promotes it.

## Validation

```
npm test            # unit
npm run lint
npm run build
npm run test:rbac   # live integration; spawns its own mongod + server
```

## Risks

- **A school whose only admin is lost and has no other login needs the platform.** That is the
  accepted cost of "mint no". It is bounded by the self-deletion guard, which refuses the deletion
  in the first place.
- **The invite/provision refusal needs a clear message.** A school_admin attempting it should be told
  to promote an existing account instead, or the two paths will look like a bug.
- **The last-admin guard adds one `countDocuments`**, only on the branch that removes
  `school_admin`, so the common path is untouched.
- **Principals gain account creation** as a side effect of reaching `/staff`. Their `creatable_roles`
  is `[exam_coordinator, teacher]` — capability their hierarchy already authorized but which had no
  screen. Intended, and now explicit in the matrix rather than incidental.
- **Pre-existing, out of scope:** `CommandPalette`'s `navItems` (`CommandPalette.jsx:102`) is a
  static list with no role filter, so every role is already offered `/billing` and friends and gets
  bounced by `RoleGuard`. Widening `/staff` reduces this by one entry; the defect is untouched.

## Out of scope

- An explicit primary-role picker (already visible in the UI).
- Self-editing your own role row.
- Any screen for managing student/parent portal logins (they stay on Students/Parents).
- `CommandPalette` role filtering.
