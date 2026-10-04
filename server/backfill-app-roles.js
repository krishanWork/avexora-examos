import "dotenv/config";
import { db } from "./db.js";
import { APP_ROLE_PRECEDENCE, appRolesOf, primaryAppRole, validateAppRoleSet } from "./rbac.js";

// =========================================================================
// Backfill: app_roles = [app_role] for accounts predating the field
// (NON-DESTRUCTIVE, DRY RUN BY DEFAULT)
//
// Purpose: an account may now hold SEVERAL roles, and `app_roles` is the
// canonical field. `app_role` is retained as a mirror of the primary role, not
// as an independent input, so every account needs the array to say what it
// already means.
//
// The application does NOT require this to have run: appRolesOf() in rbac.js
// falls back to the single `app_role` when the array is missing or empty, which
// is what makes the deploy order safe — a not-yet-backfilled account authorizes
// exactly as it did the day before rather than losing every role. This script
// makes the rollout state explicit instead, so a later migration does not have
// to reason about documents whose meaning depends on a field being absent, and
// so `app_role` and `app_roles` can never drift apart by construction.
//
// Rules:
//   1. Only documents whose `app_roles` is missing or empty are touched.
//   2. An existing non-empty `app_roles` is NEVER overwritten — it is the
//      canonical field, and it is what the role-assignment paths write.
//   3. An UNRECOGNIZED `app_role` is repaired to the primary role of the
//      canonical array: there is no second reading of a value the policy does not
//      define, so the array is unambiguously authoritative. A `app_role` that IS
//      a recognized role but disagrees with the array's primary is only
//      REPORTED, never rewritten -- a valid role is a plausible intent, and
//      deciding which of two well-formed answers is correct is a judgement for a
//      human, not a migration.
//   4. An account with no recognizable role is left alone and REPORTED. It is
//      already locked out by the NO_ASSIGNED_ROLE gate; inventing a role for it
//      would be handing out access nobody granted.
//   5. Dry run unless `--apply` is passed. A migration that silently rewrites
//      every account in a collection should require a deliberate flag.
//
// Usage:
//   node server/backfill-app-roles.js            # report only
//   node server/backfill-app-roles.js --apply    # write
// =========================================================================

const apply = process.argv.includes("--apply");

async function main() {
  const database = await db();
  const users = database.collection("User");

  const total = await users.countDocuments({});
  const alreadyPresent = await users.countDocuments({ app_roles: { $exists: true } });
  const needsBackfill = await users.countDocuments({
    $or: [{ app_roles: { $exists: false } }, { app_roles: { $size: 0 } }],
  });
  // Accounts that already carry the array but whose mirror is not a role the
  // policy defines. These are safely repairable: the array is authoritative and
  // there is no competing valid reading of the mirror.
  const drifted = await users
    .find(
      {
        app_roles: { $exists: true, $size: { $gt: 0 } },
        app_role: { $nin: APP_ROLE_PRECEDENCE },
      },
      { projection: { email: 1, app_role: 1, app_roles: 1 } }
    )
    .toArray();

  // Accounts whose mirror is a perfectly VALID role that simply is not the array's
  // primary. These are the ones a `app_role: { $nin: [...] }` query cannot see,
  // and they are the more dangerous half of the disagreement: both fields are
  // well-formed, so nothing looks broken, but a client reading the mirror and a
  // client reading the array will disagree about who this account is and what it
  // may reach. Reported only, never rewritten (see rule 3).
  //
  // This cannot be expressed as a query: the primary role is the
  // highest-precedence ELEMENT of the array, not a fixed field, so Mongo has
  // nothing to compare `app_role` against without the precedence table baked into
  // an $expr per role. The cursor is walked in projection-only batches so the
  // collection is never fully materialized, and only a sample is retained.
  const MISMATCH_SAMPLE = 20;
  const mismatched = [];
  let mismatchedCount = 0;
  const withArray = users.find(
    { app_roles: { $exists: true, $size: { $gt: 0 } } },
    { projection: { email: 1, app_role: 1, app_roles: 1 } }
  );
  for await (const user of withArray) {
    const primary = primaryAppRole(user);
    // Only a RECOGNIZED-but-different mirror is a judgement call. An unrecognized
    // one is already in `drifted` and is repaired there.
    if (!primary || user.app_role === primary) continue;
    if (!APP_ROLE_PRECEDENCE.includes(user.app_role)) continue;
    mismatchedCount += 1;
    if (mismatched.length < MISMATCH_SAMPLE) mismatched.push({ user, primary });
  }

  console.log("app_roles backfill");
  console.log(`  mode:                  ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log(`  total accounts:        ${total}`);
  console.log(`  field already present: ${alreadyPresent}`);
  console.log(`  missing the field:     ${needsBackfill}  (candidates)`);
  console.log(`  mirror unrecognized:   ${drifted.length}  (app_role is not a policy role -- repairable)`);
  console.log(`  mirror disagrees:      ${mismatchedCount}  (valid app_role != array primary -- report only)`);

  const candidates = await users
    .find(
      { $or: [{ app_roles: { $exists: false } }, { app_roles: { $size: 0 } }] },
      { projection: { email: 1, app_role: 1, app_roles: 1, tenant_id: 1 } }
    )
    .toArray();

  if (!candidates.length) {
    console.log("\nNothing to backfill.");
    process.exit(0);
  }

  // Split the candidates before reporting: an account whose `app_role` is missing
  // or unrecognized is NOT a backfill candidate, it is an account the policy
  // cannot describe. Reporting it as "backfilled" would be a lie, and writing an
  // array for it would mean inventing an entitlement.
  const writable = [];
  const unresolvable = [];
  for (const user of candidates) {
    const roles = appRolesOf(user);
    if (!roles.length) {
      unresolvable.push(user);
      continue;
    }
    const shape = validateAppRoleSet(roles);
    if (shape.error) {
      unresolvable.push(user);
      continue;
    }
    writable.push({ user, roles, primary: primaryAppRole(user) });
  }

  const byRole = {};
  for (const { user } of writable) {
    const key = user.app_role || "(no role)";
    byRole[key] = (byRole[key] || 0) + 1;
  }
  console.log("\nCandidates by app_role:");
  for (const [role, count] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${role}: ${count}`);
  }

  console.log("\nFirst 20 candidates:");
  for (const { user, roles } of writable.slice(0, 20)) {
    console.log(`  ${user.email || "(no email)"}  [${roles.join(", ")}]`);
  }
  if (writable.length > 20) console.log(`  ... and ${writable.length - 20} more`);

  if (unresolvable.length) {
    console.log(`\n!! ${unresolvable.length} account(s) have no recognizable role and will be LEFT UNTOUCHED.`);
    console.log("   They stay locked out by the NO_ASSIGNED_ROLE gate, which is the intended");
    console.log("   state for an account nobody has assigned a role to. Assign one deliberately:");
    for (const user of unresolvable.slice(0, 20)) {
      console.log(`     ${user.email || "(no email)"}  [app_role=${JSON.stringify(user.app_role)}]`);
    }
    if (unresolvable.length > 20) console.log(`     ... and ${unresolvable.length - 20} more`);
  }

  if (mismatchedCount) {
    console.log(`\n!! ${mismatchedCount} account(s) have a canonical app_roles whose app_role mirror is a VALID role`);
    console.log("   that is not the array's primary. Both fields are well-formed, so nothing looks broken,");
    console.log("   but a client reading the mirror and one reading the array will disagree about what");
    console.log("   this account may reach. NOT rewritten: which of two valid roles is intended is a human");
    console.log("   decision. Review these and correct the array or the mirror deliberately.");
    for (const { user, primary } of mismatched) {
      console.log(
        `     ${user.email || "(no email)"}  [app_role=${user.app_role} but app_roles=${JSON.stringify(user.app_roles)} -> primary ${primary}]`
      );
    }
    if (mismatchedCount > mismatched.length) {
      console.log(`     ... and ${mismatchedCount - mismatched.length} more`);
    }
  }

  if (drifted.length) {
    console.log(`\n!! ${drifted.length} account(s) have a canonical app_roles but an unrecognized app_role mirror.`);
    console.log("   The mirror is what older code and a stale client read, so it is repaired to the");
    console.log("   primary role of the array:");
    for (const user of drifted.slice(0, 20)) {
      console.log(`     ${user.email || "(no email)"}  [${JSON.stringify(user.app_roles)} -> ${primaryAppRole(user)}]`);
    }
    if (drifted.length > 20) console.log(`     ... and ${drifted.length - 20} more`);
  }

  if (!writable.length) {
    console.log("\nNo writable candidates.");
    process.exit(0);
  }

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to set app_roles on ${writable.length} account(s) and repair ${drifted.length} unrecognized mirror(s).`);
    if (mismatchedCount) {
      console.log(`${mismatchedCount} valid-but-disagreeing mirror(s) are reported above and are never written.`);
    }
    process.exit(0);
  }

  // Per-account writes rather than one updateMany: the array is derived from each
  // document's own `app_role`, so it cannot be expressed as a single $set. Batched
  // by the driver so a large collection does not open unbounded parallel writes.
  let written = 0;
  const errors = [];
  for (const { user, roles, primary } of writable) {
    try {
      await users.updateOne(
        { _id: user._id },
        { $set: { app_roles: roles, app_role: primary, updated_date: new Date().toISOString() } }
      );
      written += 1;
    } catch (err) {
      errors.push({ email: user.email, message: err.message });
    }
  }

  let repaired = 0;
  for (const user of drifted) {
    try {
      await users.updateOne(
        { _id: user._id },
        { $set: { app_role: primaryAppRole(user), updated_date: new Date().toISOString() } }
      );
      repaired += 1;
    } catch (err) {
      errors.push({ email: user.email, message: err.message });
    }
  }

  console.log(`\nApplied. app_roles written: ${written}, mirrors repaired: ${repaired}`);
  if (errors.length) {
    console.log(`\n!! ${errors.length} write(s) failed:`);
    for (const e of errors.slice(0, 20)) console.log(`     ${e.email}: ${e.message}`);
    console.log("   Re-run the script; it is idempotent and only touches what is still missing.");
  }
  console.log("No role was invented, removed, or re-ordered: every array is the document's own single role.");
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
