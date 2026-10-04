import "dotenv/config";
import { db } from "./db.js";

// =========================================================================
// Backfill: email_verified = true for accounts predating the field
// (NON-DESTRUCTIVE, DRY RUN BY DEFAULT)
//
// Purpose: the global verification gate refuses any account whose
// `email_verified` is explicitly false. Every account created before the
// feature shipped has no such field at all, and the gate deliberately treats
// absence as verified, so nothing is locked out on deploy day.
//
// This script makes that rollout state explicit rather than implicit, so the
// field means what it says and a later migration does not have to reason about
// documents whose meaning depends on a field being missing.
//
// Rules:
//   1. Only documents where `email_verified` does NOT exist are touched.
//   2. An existing value is NEVER overwritten. An explicit `false` is a real
//      pending account mid-verification; flipping it would activate an account
//      nobody has proved owns its mailbox.
//   3. Token fields are left exactly as they are. They are only ever written by
//      the verification endpoints.
//   4. Dry run unless `--apply` is passed. A migration that silently mutates
//      every account in a collection should require a deliberate flag.
//
// Usage:
//   node server/backfill-email-verified.js            # report only
//   node server/backfill-email-verified.js --apply    # write
// =========================================================================

const apply = process.argv.includes("--apply");

async function main() {
  const database = await db();
  const users = database.collection("User");

  const total = await users.countDocuments({});
  const alreadyPresent = await users.countDocuments({ email_verified: { $exists: true } });
  const explicitFalse = await users.countDocuments({ email_verified: false });
  const missing = await users.countDocuments({ email_verified: { $exists: false } });

  console.log("email_verified backfill");
  console.log(`  mode:                  ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log(`  total accounts:        ${total}`);
  console.log(`  field already present: ${alreadyPresent}`);
  console.log(`    of which false:      ${explicitFalse}  (left untouched)`);
  console.log(`  missing the field:     ${missing}  (candidates)`);

  const candidates = await users
    .find({ email_verified: { $exists: false } }, { projection: { email: 1, app_role: 1, tenant_id: 1 } })
    .toArray();

  if (!candidates.length) {
    console.log("\nNothing to backfill.");
    process.exit(0);
  }

  const byRole = {};
  for (const u of candidates) {
    const key = u.app_role || "(no role)";
    byRole[key] = (byRole[key] || 0) + 1;
  }
  console.log("\nCandidates by app_role:");
  for (const [role, count] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${role}: ${count}`);
  }

  console.log("\nFirst 20 candidates:");
  for (const u of candidates.slice(0, 20)) {
    console.log(`  ${u.email || "(no email)"}  [${u.app_role || "no role"}]`);
  }
  if (candidates.length > 20) console.log(`  ... and ${candidates.length - 20} more`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to set email_verified: true on these accounts.");
    process.exit(0);
  }

  const result = await users.updateMany(
    { email_verified: { $exists: false } },
    { $set: { email_verified: true } }
  );
  console.log(`\nApplied. Modified: ${result.modifiedCount}, matched: ${result.matchedCount}`);
  console.log("Any account that was explicitly false was left pending and must verify by mail.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
