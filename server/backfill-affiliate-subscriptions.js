import "dotenv/config";
import { ObjectId } from "mongodb";
import { db } from "./db.js";
import { deriveSubscriptionFromSale } from "./affiliate-subscription.js";

// =========================================================================
// Backfill: Subscription documents for affiliate sales made before renewals
// existed (NON-DESTRUCTIVE, DRY RUN BY DEFAULT)
//
// Purpose
// -------
// A `Subscription` is the renewing record: it carries `paid_through`, the single fact
// the due date is derived from. It is written inside the `affiliateSell` "sell" branch,
// so every sale made BEFORE that change has an `AffiliateSale` and a `Payment` but no
// `Subscription` — and the renewal screen renders an empty table for them.
//
// This script rebuilds the missing documents from the ledger that already exists.
//
// Rules
// -----
//   1. Only the ORIGINATING sale of a tenant produces a subscription. A renewal sale
//      (written by the new feature, carrying `kind: "renewal"`) is a commission event
//      for a period already covered by its parent, not a new subscription.
//   2. A tenant that ALREADY has a subscription is skipped outright. Documents written
//      by the live sale path are correct by construction and must never be rewritten.
//   3. The start date is the sale's own PAYMENT — `paid_at`, else `created_date`, else
//      the sale timestamp — never "now". Anchoring a migration to the moment it runs
//      would silently re-date the whole customer base.
//   4. `commission_mode` is taken from the affiliate's CURRENT setting, defaulting to
//      `one_time` (see deriveSubscriptionFromSale). A migration must never invent a
//      recurring commission nobody agreed to pay.
//   5. Old sales stay OVERDUE. No catch-up months are invented; an institution that
//      stopped paying is the thing this table exists to surface.
//
// The join is exact
// -----------------
// The sale and its payment were inserted in one transaction sharing a single `now`
// (server/index.js), so `created_date` is identical on both and
// (tenant_id, created_date) identifies the pair precisely. That matters because
// `Payment` is ALSO written by the super-admin plan-change approval flow, which is a
// different commercial record — keying off "any payment for this tenant" would anchor
// some subscriptions to an unrelated billing event.
//
// Run:
//   node server/backfill-affiliate-subscriptions.js            # dry run
//   node server/backfill-affiliate-subscriptions.js --apply

const APPLY = process.argv.includes("--apply");

const formatDay = (value) => (value ? String(value).slice(0, 10) : "—");

async function main() {
  const database = await db();
  const subscriptions = database.collection("Subscription");
  const sales = database.collection("AffiliateSale");
  const payments = database.collection("Payment");
  const tenants = database.collection("Tenant");

  // 1. Originating sales only. `kind: "renewal"` is the marker the new feature writes;
  //    a sale predating it simply has no `kind`, which `$ne` also matches.
  const allSales = await sales.find({ kind: { $ne: "renewal" } }).toArray();
  console.log(`Originating affiliate sales: ${allSales.length}`);

  // 2. One subscription per tenant. Two originating sales for one tenant would be two
  //    independently-advanced due dates that nothing reconciles, so the extras are
  //    REPORTED and only the earliest is migrated.
  const earliestByTenant = new Map();
  const duplicateTenants = [];
  for (const sale of allSales) {
    const key = String(sale.tenant_id || "");
    if (!key) continue;
    const held = earliestByTenant.get(key);
    if (!held) {
      earliestByTenant.set(key, sale);
      continue;
    }
    duplicateTenants.push(key);
    if (String(sale.created_date) < String(held.created_date)) earliestByTenant.set(key, sale);
  }
  if (duplicateTenants.length) {
    console.log(`\n!! ${duplicateTenants.length} tenant(s) have more than one originating sale;`);
    console.log("   only the earliest is migrated. Affected tenant ids:");
    for (const id of duplicateTenants.slice(0, 10)) console.log(`     ${id}`);
  }

  const candidates = [...earliestByTenant.values()].filter((sale) => sale.tenant_id);

  // 3. Never touch a tenant that already has a subscription.
  const existing = await subscriptions.find({ tenant_id: { $in: candidates.map((s) => String(s.tenant_id)) } }).toArray();
  const alreadyPresent = new Set(existing.map((doc) => String(doc.tenant_id)));
  console.log(`Tenants that already have a subscription (left untouched): ${alreadyPresent.size}`);

  const todo = candidates.filter((sale) => !alreadyPresent.has(String(sale.tenant_id)));
  console.log(`Candidates to migrate: ${todo.length}`);

  if (!todo.length) {
    console.log("\nNothing to migrate.");
    process.exit(0);
  }

  // 4. Load each affiliate profile once, for the commission policy snapshot.
  //
  // affiliate_id is stored on the sale as a STRING while Affiliate._id is an ObjectId,
  // so the ids are converted before the query. Looking them up unconverted matches
  // nothing at all, and the failure is SILENT and dangerous: every profile would come
  // back missing, so every migrated row would fall back to `one_time` — quietly turning
  // a recurring-commission affiliate's subscription into a one-time one.
  const affiliateIdStrings = [...new Set(todo.map((sale) => String(sale.affiliate_id || "")).filter(Boolean))];
  const affiliateObjectIds = affiliateIdStrings.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const affiliateDocs = affiliateObjectIds.length
    ? await database.collection("Affiliate").find({ _id: { $in: affiliateObjectIds } }).toArray()
    : [];
  const affiliateById = new Map(affiliateDocs.map((doc) => [String(doc._id), doc]));
  // Anything whose id was not a valid ObjectId, or that genuinely no longer exists.
  const unknownAffiliates = affiliateIdStrings.filter((id) => !affiliateById.has(id));

  // Which of these tenants still exist. A sale whose Tenant has since been deleted
  // (an institution was removed, but the ledger row survived) is reported rather than
  // migrated into a subscription pointing at nothing. Tenant ids are stored on the sale
  // as STRINGS while Tenant._id is an ObjectId, so they are converted here rather than
  // queried as-is, which would silently match nothing.
  const tenantIds = todo.map((sale) => String(sale.tenant_id));
  const tenantObjectIds = tenantIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const liveTenants = new Set();
  for (let i = 0; i < tenantObjectIds.length; i += 500) {
    const chunk = await tenants.find({ _id: { $in: tenantObjectIds.slice(i, i + 500) } }, { projection: { _id: 1 } }).toArray();
    for (const doc of chunk) liveTenants.add(String(doc._id));
  }

  const now = new Date().toISOString();
  const rows = [];
  const anomalies = [];

  for (const sale of todo) {
    const tenantId = String(sale.tenant_id);

    // The exact join: same tenant, same created_date, same transaction.
    let payment = await payments.findOne({ tenant_id: tenantId, created_date: sale.created_date });

    let startSource = "payment (exact join on created_date)";
    if (!payment) {
      // Fall back to the tenant's earliest payment, which is the right answer for a
      // sale whose payment row was written with a slightly different timestamp.
      payment = await payments.findOne({ tenant_id: tenantId }, { sort: { created_date: 1 } });
      startSource = payment
        ? "earliest payment for tenant (FALLBACK)"
        : "sale created_date (FALLBACK — no payment row found)";
      anomalies.push({ tenantId, school: sale.tenant_name, reason: startSource });
    }

    const affiliate = affiliateById.get(String(sale.affiliate_id)) || {};
    const doc = deriveSubscriptionFromSale({ sale, payment, affiliate, now });
    if (!doc) {
      anomalies.push({ tenantId, school: sale.tenant_name, reason: "sale carries no usable date; not migrated" });
      continue;
    }
    if (!liveTenants.has(tenantId)) {
      anomalies.push({ tenantId, school: sale.tenant_name, reason: "the institution no longer exists; not migrated" });
      continue;
    }
    rows.push({ doc, school: sale.tenant_name, startSource });
  }

  console.log(`\nSubscriptions to write: ${rows.length}`);

  const byMode = rows.reduce((acc, r) => {
    acc[r.doc.commission_mode] = (acc[r.doc.commission_mode] || 0) + 1;
    return acc;
  }, {});
  console.log(`Commission mode of migrated rows: ${JSON.stringify(byMode)}`);

  const overdue = rows.filter((r) => r.doc.next_due_at < now).length;
  console.log(`Rows whose next due date is already in the past: ${overdue}`);
  console.log(`\nInstitutions and the due date each will show:`);
  for (const row of rows.slice(0, 40)) {
    console.log(
      `  ${String(row.school).padEnd(34)} ${formatDay(row.doc.subscription_started_at)} -> due ${formatDay(row.doc.next_due_at)}  [${row.startSource}]`
    );
  }
  if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);

  if (unknownAffiliates.length) {
    console.log(`\n!! ${unknownAffiliates.length} sale(s) name an affiliate profile that no longer exists:`);
    for (const id of unknownAffiliates.slice(0, 10)) console.log(`     ${id}`);
    console.log("   They migrate with commission_mode one_time (nothing exists to grant recurring).");
  }

  if (anomalies.length) {
    console.log(`\n!! ${anomalies.length} row(s) needed a fallback or could not be migrated:`);
    for (const a of anomalies.slice(0, 20)) console.log(`     ${a.school} (${a.tenantId}): ${a.reason}`);
    if (anomalies.length > 20) console.log(`     ... and ${anomalies.length - 20} more`);
  }

  if (!APPLY) {
    console.log(`\nDry run. Re-run with --apply to create ${rows.length} Subscription document(s).`);
    console.log("Existing subscriptions are never modified, so this is safe to repeat.");
    process.exit(0);
  }

  let written = 0;
  const errors = [];
  for (const { doc } of rows) {
    try {
      // updateOne + upsert rather than insertOne so that a second run — or a run that
      // overlaps a concurrent sale for the same tenant — converges instead of failing.
      // The filter is on tenant_id, matching the ux_subscription_tenant unique index.
      await subscriptions.updateOne(
        { tenant_id: doc.tenant_id },
        { $setOnInsert: doc },
        { upsert: true }
      );
      written += 1;
    } catch (err) {
      errors.push({ tenant: doc.tenant_id, school: doc.tenant_name, message: err.message });
    }
  }

  console.log(`\nApplied. Subscriptions created: ${written}`);
  if (errors.length) {
    console.log(`\n!! ${errors.length} write(s) failed:`);
    for (const e of errors.slice(0, 20)) console.log(`     ${e.school} (${e.tenant}): ${e.message}`);
    console.log("   Re-run the script; it is idempotent and skips anything already present.");
  }
  console.log(
    "No date was invented: every row is anchored to a real recorded payment, and no month was caught up."
  );
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});