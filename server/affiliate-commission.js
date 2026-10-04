// Affiliate commission arithmetic.
//
// Deliberately pure: it takes numbers and sale documents and returns numbers,
// and never touches the database, the request or the response. That is the same
// property that makes server/rbac.js testable under `node --test` with no live
// MongoDB, and it is why the money maths lives here rather than inline in a
// route handler — a rounding rule that is only reachable through an HTTP call
// against a real database is a rounding rule nobody tests.
//
// Every figure the affiliate programme shows is DERIVED from the sale ledger by
// these functions. No running total is ever stored on the Affiliate profile: a
// stored counter drifts the instant a sale is voided, a rate is corrected or a
// document is back-filled, and then the displayed balance disagrees with the
// ledger that is supposed to be the source of truth.

// Money is held in minor units internally and formatted at the edge. The plan
// prices in this system are whole rupees (SubscriptionPlan.price: 4999), and a
// commission on 4999 at 20% is 999.8 — a real amount that no currency can pay
// out. Rounding HALF UP to paise is the rule a reseller would expect from a
// commission statement, and it is applied identically everywhere so the preview
// the affiliate sees before selling, the figure written to the sale, and the
// figure on their statement can never disagree.

// Rounding to paise. `Math.round` is not this: it is half-up toward +Infinity, so
// it rounds -0.005 up to -0.00 rather than away from zero. Amounts here are
// validated non-negative at the route boundary, but the helper is exported and
// must be correct on its own terms rather than correct only for its callers.
const roundPaise = (value) => {
  const scaled = value * 100;
  // The epsilon absorbs the binary representation error that makes 1.005 * 100
  // evaluate to 100.49999999999999, which Math.round would send down to 100.
  const rounded = Math.round(scaled + (scaled >= 0 ? 1e-9 : -1e-9));
  return rounded / 100;
};

// The commission owed on one sale.
//
//   amount  what was collected for the subscription, in rupees
//   rate    the affiliate's percentage, an integer 0..100
//
// Returns 0 for any input that is not a finite, non-negative amount or a rate
// outside 0..100, rather than NaN. A NaN that reaches a Mongo document is
// unqueryable and un-summable, so a bad input is refused at the boundary and
// defended against again here; the route also validates both fields before it
// calls this.
export const computeCommission = (amount, rate) => {
  const value = Number(amount);
  const percent = Number(rate);
  if (!Number.isFinite(value) || value < 0) return 0;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return 0;
  return roundPaise((value * percent) / 100);
};

// The lifecycle of a commission, as a sale moves through it.
//
//   pending    the affiliate sold; the money was collected offline and the
//              commission is counted but not yet payable
//   approved   a super admin has confirmed it; payable
//   paid       a super admin has marked the money sent
//
// There is deliberately no `void`/`refunded` state. A sale is an immutable
// record of what happened; if a sale was not real the fix is a deletion through
// an audited super-admin action, not a status that silently makes the commission
// disappear from the ledger while the tenant it created still exists.
export const SALE_STATUSES = ["pending", "approved", "paid"];

// The legal status transitions, as a map. A route asserts a transition against
// this rather than checking `status !== "paid"` ad hoc, so "approved cannot go
// back to pending" is stated once.
export const SALE_TRANSITIONS = {
  pending: ["approved"],
  approved: ["paid"],
  paid: [],
};

export const isSaleStatus = (value) => SALE_STATUSES.includes(value);
export const canTransitionSale = (from, to) => (SALE_TRANSITIONS[from] || []).includes(to);

// Sum one affiliate's ledger into the four figures both pages display.
//
// `sales` is an array of AffiliateSale documents. Each is expected to carry
// `commission_amount` — the value SNAPSHOTTED onto the sale at the moment it was
// made — and never a recomputation from the affiliate's current rate. That is
// what makes a rate change non-retroactive: raising an affiliate from 10% to 25%
// must not inflate what they earned on sales already settled at 10%.
//
// `status` buckets are disjoint by construction — every sale is in exactly one —
// so `earned` is the sum of all three and `approved`/`paid` are each a strict
// subset of it.
//
// `payable` is approved and NOT yet sent. A paid commission is settled money, so
// counting it here would make the platform's outstanding figure grow every time it
// pays out instead of shrinking — the number would move the wrong way on exactly
// the action that reduces the debt.
export const summarizeSales = (sales) => {
  const summary = { sales_count: 0, earned: 0, approved: 0, paid: 0, payable: 0 };
  for (const sale of sales || []) {
    const amount = Number(sale?.commission_amount);
    const commission = Number.isFinite(amount) && amount >= 0 ? amount : 0;
    summary.sales_count += 1;
    summary.earned += commission;
    if (sale?.status === "approved") summary.approved += commission;
    if (sale?.status === "paid") summary.paid += commission;
    if (sale?.status === "approved") summary.payable += commission;
  }
  for (const key of ["earned", "approved", "paid", "payable"]) {
    summary[key] = roundPaise(summary[key]);
  }
  return summary;
};

// Roll the per-affiliate summaries above into the platform-wide figures the
// super admin's stat row shows. Takes `[{ affiliate_id, ...summary }]` so one
// codebase path produces both the table's per-row totals and the header's.
export const rollupSummaries = (summaries) => {
  const totals = { affiliates: 0, sales_count: 0, earned: 0, approved: 0, paid: 0, payable: 0 };
  for (const summary of summaries || []) {
    totals.affiliates += 1;
    totals.sales_count += Number(summary?.sales_count) || 0;
    for (const key of ["earned", "approved", "paid", "payable"]) {
      totals[key] += Number(summary?.[key]) || 0;
    }
  }
  for (const key of ["earned", "approved", "paid", "payable"]) {
    totals[key] = roundPaise(totals[key]);
  }
  return totals;
};

// Coerce a client-supplied commission rate into the 0..100 integer the policy
// requires, or return null so the caller can answer 400 with a real message.
//
// Rejects rather than clamps. Clamping "250" to 100 would silently accept a
// mistyped rate as a real one, and clamping "-5" to 0 would turn an obvious
// mistake into a commission nobody notices is wrong. A rate is a number a human
// typed; if it is not exactly a percentage it is a typo, and the answer is to
// say so.
//
// The string cases are handled BEFORE coercion because Number("") and Number("  ")
// are both 0. An empty form field would otherwise pass validation as a legitimate
// 0% and silently zero out a reseller's entire commission — the single most
// expensive possible misreading of a blank box. Numeric strings that carry digits
// are still accepted, since that is a normal request shape.
export const normalizeCommissionRate = (value) => {
  // Guarded before coercion, not after. Number(null), Number("") and Number([]) are
  // all 0, so without this an absent or blank rate reads as a legitimate 0% —
  // and a missing commission rate silently zeroing a reseller's income is the most
  // expensive possible misreading of an empty field. Anything that is not
  // actually a number is refused; only a real numeric value is interpreted.
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const rate = Number(value);
  if (!Number.isInteger(rate) || rate < 0 || rate > 100) return null;
  return rate;
};