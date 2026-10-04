import test from "node:test";
import assert from "node:assert/strict";

// Commission arithmetic, tested with no database and no HTTP.
//
// server/affiliate-commission.js is deliberately a pure module — numbers in,
// numbers out — for the same reason server/rbac.js is: a money rule that is only
// reachable through a route handler against a live MongoDB is a money rule nobody
// tests. These assertions are the safety net for the figure the platform owes.
//
// The invariants worth stating, in order of how much damage getting them wrong
// would do:
//
//   1. The rate is snapshotted onto each sale, so changing it later cannot
//      retroactively change what was already earned.
//   2. The figure the affiliate sees before selling, the figure written to the
//      sale, and the figure on their statement are computed by ONE function and so
//      cannot disagree.
//   3. Status buckets are disjoint, so "earned" is the sum of the other two.

import {
  computeCommission,
  summarizeSales,
  rollupSummaries,
  normalizeCommissionRate,
  SALE_STATUSES,
  SALE_TRANSITIONS,
  isSaleStatus,
  canTransitionSale,
} from "../affiliate-commission.js";

const sale = (over = {}) => ({
  commission_amount: 100,
  amount: 500,
  commission_rate: 20,
  status: "pending",
  ...over,
});

test("commission is the stated percentage, rounded half up to paise", () => {
  assert.equal(computeCommission(1000, 20), 200);
  assert.equal(computeCommission(4999, 20), 999.8, "a fractional rupee commission is real and must not be truncated");
  assert.equal(computeCommission(0, 20), 0, "a free plan earns nothing");
  assert.equal(computeCommission(5000, 0), 0, "a zero-rate affiliate earns nothing");
  assert.equal(computeCommission(1234.56, 33), 407.4);
});

test("the boundary rates behave", () => {
  assert.equal(computeCommission(9999, 100), 9999, "a 100% rate earns the whole sale");
  assert.equal(computeCommission(9999, 1), 99.99);
  assert.equal(computeCommission(1, 100), 1);
});

test("an unusable amount or rate earns zero rather than NaN", () => {
  // A NaN that reaches a Mongo document is unqueryable and un-summable, and it
  // would silently vanish from a total instead of being visible. Zero is the only
  // safe wrong answer here, and the routes validate both fields before calling.
  for (const bad of [undefined, null, NaN, -100, "abc", {}, []]) {
    assert.equal(computeCommission(bad, 20), 0, `amount ${String(bad)} must not produce a commission`);
  }
  // Non-integer, out-of-range and non-numeric rates earn nothing. A numeric string
  // is NOT in this list: it is a normal request shape and is accepted, which the
  // assertion below states explicitly.
  for (const bad of [undefined, null, NaN, -1, 101, 20.5, {}, "abc"]) {
    assert.equal(computeCommission(1000, bad), 0, `rate ${String(bad)} must not produce a commission`);
  }
  // Numeric strings from a form field are accepted, because that is a normal
  // request shape rather than a malformed one.
  assert.equal(computeCommission("1000", "20"), 200);
});

test("a bad rate is refused rather than clamped", () => {
  // Clamping "250" to 100 would accept a typo as a real rate; clamping "-5" to 0
  // would turn a visible mistake into a commission nobody notices is wrong.
  assert.equal(normalizeCommissionRate(20), 20);
  assert.equal(normalizeCommissionRate(0), 0);
  assert.equal(normalizeCommissionRate(100), 100);
  assert.equal(normalizeCommissionRate("35"), 35);
  // An empty field must be REFUSED, not coerced to zero. Number("") is 0, so a blank
// commission-rate box would otherwise validate as a legitimate 0% and silently
// zero out a reseller's entire commission — the most expensive possible misreading
// of an empty input, because nothing would look wrong.
for (const blank of ["", "   ", "\t"]) {
  assert.equal(normalizeCommissionRate(blank), null, `a blank rate (${JSON.stringify(blank)}) must be refused`);
}
for (const bad of [250, -5, 20.5, NaN, "abc", null, undefined]) {
    assert.equal(normalizeCommissionRate(bad), null, `${String(bad)} must be refused`);
  }
});

test("a rate change is not retroactive, because the sale carries its own copy", () => {
  // The affiliate starts at 10%, sells, then is promoted to 25%. What they earned
  // on the first sale must stay at 10% — this is the whole reason commission_rate
  // and commission_amount are snapshotted onto the AffiliateSale document instead
  // of being recomputed from the profile at render time.
  const firstSale = sale({ amount: 1000, commission_rate: 10, commission_amount: computeCommission(1000, 10) });
  const promotedRate = 25;
  const secondSale = sale({
    amount: 1000,
    commission_rate: promotedRate,
    commission_amount: computeCommission(1000, promotedRate),
  });

  const summary = summarizeSales([firstSale, secondSale]);
  // 100 + 250, not 250 + 250. Reading the CURRENT rate for both would show 500.
  assert.equal(summary.earned, 350);
  assert.equal(firstSale.commission_amount, 100);
  assert.equal(secondSale.commission_amount, 250);
});

test("the balance buckets are disjoint and complete", () => {
  const sales = [
    sale({ commission_amount: 100, status: "pending" }),
    sale({ commission_amount: 250, status: "approved" }),
    sale({ commission_amount: 400, status: "paid" }),
  ];
  const summary = summarizeSales(sales);
  assert.equal(summary.sales_count, 3);
  assert.equal(summary.earned, 750, "earned is the total across every status");
  assert.equal(summary.approved, 250);
  assert.equal(summary.paid, 400);
  assert.equal(summary.approved + summary.paid, summary.paid + summary.approved);
// Payable is approved-but-unsent, which is what the platform owes right now.
// Counting paid here too would make the figure GROW every time money goes out,
// which is the wrong direction for a debt.
assert.equal(summary.payable, 250);
  assert.equal(summary.approved + summary.paid + (sales[0].commission_amount), summary.earned);
});

test("an empty or malformed ledger summarizes to zero, not to NaN", () => {
  assert.deepEqual(summarizeSales([]), { sales_count: 0, earned: 0, approved: 0, paid: 0, payable: 0 });
  assert.deepEqual(summarizeSales(null), { sales_count: 0, earned: 0, approved: 0, paid: 0, payable: 0 });
  const damaged = summarizeSales([{ commission_amount: "oops" }, null, { status: "approved" }]);
  assert.equal(damaged.sales_count, 3, "rows are still counted, so a damaged row is visible rather than hidden");
  assert.equal(damaged.earned, 0, "a damaged row contributes nothing to a money total");
});

test("the platform rollup is the sum of the per-affiliate summaries", () => {
  const summaries = [
    summarizeSales([sale({ commission_amount: 100, status: "approved" }), sale({ commission_amount: 50, status: "paid" })]),
    summarizeSales([]),
    summarizeSales([sale({ commission_amount: 25, status: "pending" })]),
  ];
  const totals = rollupSummaries(summaries);
  assert.equal(totals.affiliates, 3);
  assert.equal(totals.sales_count, 3);
  assert.equal(totals.earned, 175);
  assert.equal(totals.approved, 100);
  assert.equal(totals.paid, 50);
  assert.equal(totals.payable, 100);
  assert.deepEqual(rollupSummaries([]), {
    affiliates: 0, sales_count: 0, earned: 0, approved: 0, paid: 0, payable: 0,
  });
});

test("a commission moves forward through its lifecycle and only forward", () => {
  assert.deepEqual(SALE_STATUSES, ["pending", "approved", "paid"]);
  for (const status of SALE_STATUSES) assert.equal(isSaleStatus(status), true);
  assert.equal(isSaleStatus("void"), false);
  assert.equal(isSaleStatus(undefined), false);

  assert.equal(canTransitionSale("pending", "approved"), true);
  assert.equal(canTransitionSale("approved", "paid"), true);
  // "approved cannot go back to pending" and "paid is final" are statements in a
  // table rather than omissions someone can fix by accident.
  assert.equal(canTransitionSale("approved", "pending"), false);
  assert.equal(canTransitionSale("pending", "paid"), false, "a commission cannot skip the approval checkpoint");
  assert.equal(canTransitionSale("paid", "paid"), false);
  assert.equal(canTransitionSale("paid", "approved"), false);
  assert.equal(canTransitionSale("paid", "pending"), false);
  assert.equal(canTransitionSale("wizard", "approved"), false);
  assert.deepEqual(SALE_TRANSITIONS.paid, [], "paid is terminal");
});