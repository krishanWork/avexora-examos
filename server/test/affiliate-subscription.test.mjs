import test from "node:test";
import assert from "node:assert/strict";

// Subscription renewal arithmetic and reminder rendering, tested with no database and
// no HTTP.
//
// server/affiliate-subscription.js is a pure module for the same reason
// server/affiliate-commission.js is: a date rule that is only reachable through a route
// handler against a live MongoDB is a rule nobody tests, and "what date is this
// institution due on" is exactly the kind of rule that is trivially wrong and
// expensive to discover late — an institution told it owes nothing for two extra months.
//
// The invariants worth stating, in order of how much damage getting them wrong would do:
//
//   1. Month arithmetic CLAMPS to the end of the month. A subscription sold on the 31st
//      must not drift a month every cycle, and must not skip February.
//   2. Lead-day matching counts whole UTC calendar days, so the 7-day reminder fires on
//      one specific day rather than never, or twice.
//   3. The commission decision is a super-admin policy, snapshotted per subscription.
//   4. An unknown placeholder is left visible rather than silently blanked.

import {
  addMonths,
  normalizeInterval,
  computePeriod,
  periodKeyFor,
  daysBetween,
  daysUntilDue,
  isOverdue,
  matchingLeadDays,
  normalizeChannels,
  normalizeLeadDays,
  hasAnyChannel,
  normalizeCommissionMode,
  isCommissionMode,
  shouldCreateCommission,
  renderTemplate,
  templateVariables,
  renderReminder,
  DEFAULT_LEAD_DAYS,
  REMINDER_CHANNELS,
  COMMISSION_MODES,
  MAX_LEAD_DAY,
  deriveSubscriptionFromSale,
} from "../affiliate-subscription.js";

test("adding a calendar month clamps to the end of a shorter month", () => {
  // The regression this whole helper exists for. A naive setUTCMonth on the 31st
  // overflows past February entirely: 31 Jan + 1 month would become 3 March, so a
  // school sold on the 31st would be told it owes nothing for a month and then, on the
  // next cycle, a month and a bit.
  assert.equal(addMonths("2026-01-31T00:00:00.000Z", 1), "2026-02-28T00:00:00.000Z");
  // Leap year: the 29th, not the 28th.
  assert.equal(addMonths("2028-01-31T00:00:00.000Z", 1), "2028-02-29T00:00:00.000Z");
  // A 30-day month.
  assert.equal(addMonths("2026-04-30T00:00:00.000Z", 1), "2026-05-30T00:00:00.000Z");
  // Nothing to clamp.
  assert.equal(addMonths("2026-06-15T00:00:00.000Z", 1), "2026-07-15T00:00:00.000Z");
});

test("the clamped anchor returns to the end of the month instead of sticking", () => {
  // 31 Jan -> 28 Feb -> 31 Mar. If the clamp were applied to the RESULT rather than
  // keeping the original day-of-month as the intent, this chain would read
  // 31 Jan -> 28 Feb -> 28 Mar and silently shorten every month thereafter.
  const first = addMonths("2026-01-31T00:00:00.000Z", 1);
  const second = addMonths(first, 1);
  assert.equal(first, "2026-02-28T00:00:00.000Z");
  assert.equal(second, "2026-03-28T00:00:00.000Z", "the anchor is the clamped date, and is reported as such");
  // A year crossing the leap day still works.
  assert.equal(addMonths("2028-01-31T00:00:00.000Z", 12), "2029-01-31T00:00:00.000Z");
});

test("month arithmetic preserves the time of day", () => {
  // The due date is an instant the cron compares against a real clock, so dropping the
  // time of day would move every due date to midnight UTC.
  assert.equal(addMonths("2026-03-10T14:35:12.500Z", 1), "2026-04-10T14:35:12.500Z");
});

test("an unusable date adds nothing rather than producing Invalid Date", () => {
  for (const bad of [undefined, null, "", "not-a-date", NaN, {}]) {
    assert.equal(addMonths(bad, 1), null, `${String(bad)} must not yield a date`);
  }
});

test("the billing-cycle label is normalized, and unknown labels mean monthly", () => {
  // The label is free text and is not even self-consistent in this codebase: the seed
  // data writes "month" while the plan editor's default is "monthly". Both must mean
  // the same interval, or half the catalogue renews on the wrong schedule.
  assert.equal(normalizeInterval("month"), 1);
  assert.equal(normalizeInterval("monthly"), 1);
  assert.equal(normalizeInterval("Month"), 1);
  assert.equal(normalizeInterval("  MONTHLY "), 1);
  assert.equal(normalizeInterval("/month"), 1);
  // Recognisable longer cycles that map onto whole months.
  assert.equal(normalizeInterval("year"), 12);
  assert.equal(normalizeInterval("annually"), 12);
  assert.equal(normalizeInterval("quarterly"), 3);
  // Everything else — including blank, which is what most profiles will have — is a
  // month. Being wrong in this direction only sends an extra reminder early; being
  // wrong the other way silently skips a whole billing cycle.
  for (const label of [undefined, null, "", "lifetime", "weekly", "weird"]) {
    assert.equal(normalizeInterval(label), 1, `${String(label)} must fall back to monthly`);
  }
});

test("the next due date is derived from the one stored fact", () => {
  const period = computePeriod({ paid_through: "2026-01-15T10:00:00.000Z", interval_months: 1 });
  assert.equal(period.nextDueAt, "2026-02-15T10:00:00.000Z");
  assert.equal(period.periodKey, "2026-02-15");
  // The interval on the document wins over the free-text label when both are present.
  assert.equal(
    computePeriod({ paid_through: "2026-01-15T00:00:00.000Z", interval_months: 3 }).nextDueAt,
    "2026-04-15T00:00:00.000Z"
  );
});

test("a subscription with nothing paid has no due date", () => {
  // Inventing a due date from "now" would put a school on the renewal schedule the
  // moment it was created rather than the month after it was paid for.
  assert.equal(computePeriod({}), null);
  assert.equal(computePeriod({ paid_through: "" }), null);
  assert.equal(computePeriod({ paid_through: null }), null);
  assert.equal(computePeriod({ paid_through: "nonsense" }), null);
});

test("the period key is the due date, so two reminders for one month collide and two months do not", () => {
  assert.equal(periodKeyFor("2026-02-15T10:00:00.000Z"), "2026-02-15");
  assert.equal(periodKeyFor("2026-03-15T10:00:00.000Z"), "2026-03-15");
  assert.notEqual(periodKeyFor("2026-02-15T00:00:00.000Z"), periodKeyFor("2026-03-15T00:00:00.000Z"));
  assert.equal(periodKeyFor("bad"), null);
});

test("days are counted between UTC calendar dates, not raw instants", () => {
  // Truncating to midnight is what makes the 7-day reminder land on one specific day.
  // Comparing raw timestamps would make "7 days before" fire at a slightly different
  // moment on every run, because the clock has moved since the due date was written.
  assert.equal(daysBetween("2026-02-15T00:00:00.000Z", "2026-02-15T23:59:59.999Z"), 0);
  assert.equal(daysBetween("2026-02-15T23:59:00.000Z", "2026-02-16T00:01:00.000Z"), 1);
  assert.equal(daysBetween("2026-02-15T00:00:00.000Z", "2026-02-22T00:00:00.000Z"), 7);
  assert.equal(daysBetween("2026-02-22T00:00:00.000Z", "2026-02-15T00:00:00.000Z"), -7);
  assert.equal(daysBetween("garbage", "2026-02-15T00:00:00.000Z"), null);
});

test("the countdown and the overdue flag agree on which side of today a date is", () => {
  const now = "2026-02-15T09:00:00.000Z";
  assert.equal(daysUntilDue("2026-02-22T00:00:00.000Z", now), 7);
  assert.equal(daysUntilDue("2026-02-16T00:00:00.000Z", now), 1);
  assert.equal(daysUntilDue("2026-02-15T23:00:00.000Z", now), 0);
  assert.equal(daysUntilDue("2026-02-14T23:00:00.000Z", now), -1);
  assert.equal(isOverdue("2026-02-14T23:00:00.000Z", now), true);
  assert.equal(isOverdue("2026-02-15T23:00:00.000Z", now), false, "due today is not yet overdue");
  assert.equal(isOverdue("2026-02-22T00:00:00.000Z", now), false);
});

test("only the configured lead days fire, and exactly once each", () => {
  const due = "2026-03-01T00:00:00.000Z";
  // Seven days out.
  assert.deepEqual(matchingLeadDays(due, DEFAULT_LEAD_DAYS, "2026-02-22T09:00:00.000Z"), [7]);
  // One day out.
  assert.deepEqual(matchingLeadDays(due, DEFAULT_LEAD_DAYS, "2026-02-28T09:00:00.000Z"), [1]);
  // The day itself.
  assert.deepEqual(matchingLeadDays(due, DEFAULT_LEAD_DAYS, "2026-03-01T02:00:00.000Z"), [0]);
  // Any other day sends nothing at all, which is what keeps a daily cron from
  // reminding a customer every single day of the month.
  assert.deepEqual(matchingLeadDays(due, DEFAULT_LEAD_DAYS, "2026-02-25T09:00:00.000Z"), []);
  // Past the due date: the configured lead days are all in the future, so nothing
  // fires. A school that has let it lapse is handled by the operator, not by an
  // automatic daily nag that was never agreed to.
  assert.deepEqual(matchingLeadDays(due, DEFAULT_LEAD_DAYS, "2026-03-05T09:00:00.000Z"), []);
  // A custom schedule is honoured.
  assert.deepEqual(matchingLeadDays(due, [14, 3], "2026-02-15T09:00:00.000Z"), [14]);
  assert.deepEqual(matchingLeadDays(due, [14, 3], "2026-02-22T09:00:00.000Z"), []);
});

test("an unusable date matches no lead day instead of throwing", () => {
  // A malformed due date must not throw inside the cron and take the rest of the run
  // down with it.
  assert.deepEqual(matchingLeadDays("garbage", DEFAULT_LEAD_DAYS, "2026-02-22T00:00:00.000Z"), []);
  assert.deepEqual(matchingLeadDays("2026-03-01T00:00:00.000Z", DEFAULT_LEAD_DAYS, "garbage"), []);
  assert.deepEqual(matchingLeadDays(null, null, null), []);
});

test("channels are a validated subset of what the platform supports", () => {
  assert.deepEqual(normalizeChannels(["email"]), ["email"]);
  assert.deepEqual(normalizeChannels(["whatsapp"]), ["whatsapp"]);
  // Order follows the platform's own channel order, not the caller's, so two profiles
  // with the same channels configured in a different order render identically.
  assert.deepEqual(normalizeChannels(["whatsapp", "email"]), ["email", "whatsapp"]);
  assert.deepEqual(normalizeChannels(["email", "whatsapp"]), ["email", "whatsapp"]);
  // Anything unrecognised is dropped rather than stored.
  assert.deepEqual(normalizeChannels(["email", "carrier-pigeon"]), ["email"]);
  assert.deepEqual(normalizeChannels([]), []);
  assert.deepEqual(normalizeChannels("email"), [], "a bare string is not a list");
  assert.deepEqual(normalizeChannels(null), []);
  assert.equal(hasAnyChannel(["email"]), true);
  assert.equal(hasAnyChannel([]), false);
  assert.deepEqual(REMINDER_CHANNELS, ["email", "whatsapp"]);
});

test("lead days are clamped, de-duplicated and ordered longest-first", () => {
  assert.deepEqual(normalizeLeadDays([0, 7, 1]), [7, 1, 0]);
  assert.deepEqual(normalizeLeadDays([7, 7, 7]), [7], "a duplicate day is one reminder, not three");
  assert.deepEqual(normalizeLeadDays([]), []);
  // A mistyped lead time is clamped rather than refused, because rejecting the whole
  // configuration over one bad field would be worse than storing the nearest value.
  assert.deepEqual(normalizeLeadDays([9999]), [MAX_LEAD_DAY]);
  // "Three days after it is due" is not a schedule, so negatives are dropped.
  assert.deepEqual(normalizeLeadDays([-3, 5]), [5]);
  for (const bad of [1.5, "seven", null, {}, NaN]) {
    assert.deepEqual(normalizeLeadDays([bad, 3]), [3], `${String(bad)} must be dropped`);
  }
  assert.deepEqual(normalizeLeadDays("7"), []);
});

test("commission mode is a super-admin policy with a one-time default", () => {
  assert.deepEqual(COMMISSION_MODES, ["one_time", "recurring"]);
  assert.equal(isCommissionMode("recurring"), true);
  assert.equal(isCommissionMode("one_time"), true);
  assert.equal(isCommissionMode("forever"), false);
  assert.equal(isCommissionMode(undefined), false);
  // Anything unrecognised — including a profile that predates the field — behaves as
  // one_time, which is the programme exactly as it exists today.
  assert.equal(normalizeCommissionMode("nonsense"), "one_time");
  assert.equal(normalizeCommissionMode(undefined), "one_time");
  assert.equal(normalizeCommissionMode("recurring"), "recurring");
  assert.equal(shouldCreateCommission("one_time"), false, "a one-time affiliate earns nothing on renewal");
  assert.equal(shouldCreateCommission("recurring"), true);
  assert.equal(shouldCreateCommission(undefined), false);
  assert.equal(shouldCreateCommission("nonsense"), false);
});

test("placeholders are substituted", () => {
  const vars = {
    school_name: "Greenfield Public School",
    due_date: "2026-03-01",
    amount: "4999",
  };
  assert.equal(
    renderTemplate("Hello {{school_name}}, due {{due_date}} for ₹{{amount}}", vars),
    "Hello Greenfield Public School, due 2026-03-01 for ₹4999"
  );
  // Whitespace inside the braces is tolerated, because these get typed by hand.
  assert.equal(renderTemplate("{{ school_name }}", vars), "Greenfield Public School");
  // A repeated placeholder is substituted everywhere, not just the first time.
  assert.equal(renderTemplate("{{due_date}} / {{due_date}}", vars), "2026-03-01 / 2026-03-01");
  // Text with no tokens passes through untouched.
  assert.equal(renderTemplate("Plain message", vars), "Plain message");
  assert.equal(renderTemplate("", vars), "");
  assert.equal(renderTemplate(null, vars), "");
});

test("an unknown placeholder stays visible instead of being silently blanked", () => {
  // A draft still reading {{due_data}} tells the person editing it that they mistyped a
  // name. Blanking it would send a confident, hole-punched reminder to a paying
  // customer instead.
  assert.equal(
    renderTemplate("Due {{due_date}} but also {{due_data}}", { due_date: "2026-03-01" }),
    "Due 2026-03-01 but also {{due_data}}"
  );
  // A placeholder with no substitution map at all is likewise left alone.
  assert.equal(renderTemplate("{{school_name}}", {}), "{{school_name}}");
});

test("the variables read as phrases a customer can be sent", () => {
  const subscription = {
    tenant_name: "Greenfield Public School",
    plan_name: "School Pro",
    plan_price: 4999,
    paid_through: "2026-02-01T00:00:00.000Z",
    next_due_at: "2026-03-01T00:00:00.000Z",
    contact: { name: "Asha Rao", email: "asha@greenfield.edu" },
  };
  const affiliate = { full_name: "Rohan Kumar", reminder_pay_link: "https://pay.example/invite/greenfield" };

  const vars = templateVariables({ subscription, affiliate, now: "2026-02-22T00:00:00.000Z" });
  assert.equal(vars.school_name, "Greenfield Public School");
  assert.equal(vars.contact_name, "Asha Rao");
  assert.equal(vars.plan_name, "School Pro");
  assert.equal(vars.amount, "4999");
  assert.equal(vars.due_date, "2026-03-01", "dates render as a plain day, not an ISO instant");
  assert.equal(vars.paid_through, "2026-02-01");
  assert.equal(vars.days_until_due, "due in 7 days");
  assert.equal(vars.affiliate_name, "Rohan Kumar");
  assert.equal(vars.pay_link, "https://pay.example/invite/greenfield");
});

test("the countdown phrase handles the awkward days instead of showing a negative number", () => {
  const subscription = { next_due_at: "2026-03-01T00:00:00.000Z" };
  const phrase = (now) => templateVariables({ subscription, now }).days_until_due;
  assert.equal(phrase("2026-02-22T00:00:00.000Z"), "due in 7 days");
  assert.equal(phrase("2026-02-28T00:00:00.000Z"), "due tomorrow");
  assert.equal(phrase("2026-03-01T00:00:00.000Z"), "due today");
  assert.equal(phrase("2026-03-02T00:00:00.000Z"), "1 day(s) overdue");
  // "due in -3 days" is worse than useless in a customer-facing message.
  assert.equal(phrase("2026-03-04T00:00:00.000Z"), "3 day(s) overdue");
  assert.equal(phrase("2026-03-11T00:00:00.000Z"), "10 day(s) overdue");
  // No due date means no phrase at all, rather than a confident wrong one.
  assert.equal(templateVariables({ subscription: {}, now: "2026-03-01T00:00:00.000Z" }).days_until_due, "");
});

test("a complete draft renders into a sendable message", () => {
  const subscription = {
    tenant_name: "Greenfield Public School",
    plan_name: "School Pro",
    plan_price: 4999,
    paid_through: "2026-02-01T00:00:00.000Z",
    next_due_at: "2026-03-01T00:00:00.000Z",
    contact: { name: "Asha Rao" },
  };
  const affiliate = { full_name: "Rohan Kumar", reminder_pay_link: "https://pay.example/x" };
  const now = "2026-02-22T00:00:00.000Z";

  assert.equal(
    renderReminder("{{school_name}} renews on {{due_date}}", { subscription, affiliate, now }),
    "Greenfield Public School renews on 2026-03-01"
  );
  assert.equal(
    renderReminder("Hi {{contact_name}}, {{plan_name}} for {{affiliate_name}} is {{days_until_due}}.", {
      subscription,
      affiliate,
      now,
    }),
    "Hi Asha Rao, School Pro for Rohan Kumar is due in 7 days."
  );
});

test("a draft for a subscription missing fields renders blanks, not the tokens", () => {
  // Every field is substituted unconditionally so a half-populated subscription still
  // produces a sendable message; an unrendered {{token}} in a customer's inbox is the
  // failure mode this avoids.
  const rendered = renderReminder("Hi {{contact_name}}, {{plan_name}} due {{due_date}}", {
    subscription: {},
    affiliate: {},
    now: "2026-02-22T00:00:00.000Z",
  });
  assert.equal(rendered, "Hi ,  due ");
  assert.equal(rendered.includes("{{"), false);
});
// ---------------------------------------------------------------------------
// The migration: rebuilding a Subscription for a sale made before the feature
// ---------------------------------------------------------------------------
//
// The invariants that matter here are that the migration cannot INVENT money and
// cannot LOSE the real start date:
//
//   1. `commission_mode` resolves to one_time for any affiliate predating the field,
//      so a backfilled row can never start a recurring commission nobody agreed to.
//   2. `paid_at` beats `created_date` beats the sale timestamp — and a null paid_at
//      must not become the 1970 epoch, which is what `new Date(null)` gives you.
//   3. An old sale stays OVERDUE. No catch-up months are invented for an institution
//      that stopped paying.

const preFeatureSale = (over = {}) => ({
  _id: "sale-object-id",
  affiliate_id: "aff-1",
  affiliate_user_id: "user-1",
  tenant_id: "tenant-1",
  tenant_name: "Greenfield Public School",
  tenant_subdomain: "greenfield",
  plan_id: "plan-1",
  plan_name: "School Pro",
  plan_price: 4999,
  billing_cycle: "month",
  school_contact_name: "Asha Rao",
  school_contact_email: "asha@greenfield.edu",
  school_contact_phone: "+91 98765 43210",
  amount: 4999,
  commission_rate: 20,
  created_date: "2025-06-10T09:30:00.000Z",
  ...over,
});

test("a pre-existing sale becomes a subscription one month deep from its payment", () => {
  const doc = deriveSubscriptionFromSale({
    sale: preFeatureSale(),
    payment: { created_date: "2025-06-10T09:30:00.000Z", paid_at: "2025-06-10T09:30:00.000Z" },
    affiliate: {},
    now: "2026-10-03T00:00:00.000Z",
  });
  assert.equal(doc.subscription_started_at, "2025-06-10T09:30:00.000Z");
  assert.equal(doc.paid_through, "2025-06-10T09:30:00.000Z");
  assert.equal(doc.next_due_at, "2025-07-10T09:30:00.000Z");
  assert.equal(doc.interval_months, 1);
  assert.equal(doc.status, "active");
  assert.equal(doc.sale_id, "sale-object-id");
  // The contact snapshot is what a renewal reminder is addressed to, and the sale
  // already carries the address the institution gave when it paid.
  assert.deepEqual(doc.contact, { name: "Asha Rao", email: "asha@greenfield.edu", phone: "+91 98765 43210" });
  // The document's own creation time is the migration, not the commercial event.
  assert.equal(doc.created_date, "2026-10-03T00:00:00.000Z");
});

test("the migration defaults an unknown commission mode to one-time, never recurring", () => {
  // Every affiliate predates this field. one_time is exactly how the programme behaved
  // before, so a backfilled row cannot invent a recurring payout the platform never
  // agreed to pay.
  for (const affiliate of [{}, { commission_mode: undefined }, { commission_mode: null }, { commission_mode: "forever" }]) {
    const doc = deriveSubscriptionFromSale({ sale: preFeatureSale(), payment: null, affiliate });
    assert.equal(doc.commission_mode, "one_time", `${JSON.stringify(affiliate)} must migrate as one_time`);
  }
  // An affiliate that HAS opted into recurring keeps it — the migration must not
  // flatten a real policy decision either.
  assert.equal(
    deriveSubscriptionFromSale({ sale: preFeatureSale(), payment: null, affiliate: { commission_mode: "recurring" } }).commission_mode,
    "recurring"
  );
});

test("paid_at wins over created_date, and a null paid_at is not the epoch", () => {
  const base = preFeatureSale();
  // The instant the money arrived beats the instant the row was written.
  const withPaidAt = deriveSubscriptionFromSale({
    sale: base,
    payment: { created_date: "2025-06-12T00:00:00.000Z", paid_at: "2025-06-10T09:30:00.000Z" },
    affiliate: {},
  });
  assert.equal(withPaidAt.subscription_started_at, "2025-06-10T09:30:00.000Z");

  // Older Payment rows have no paid_at. `new Date(null)` is the Unix epoch, so a naive
  // fallback would put a 1970 due date on a paying customer.
  for (const absent of [null, undefined, ""]) {
    const doc = deriveSubscriptionFromSale({ sale: base, payment: { created_date: "2025-06-12T00:00:00.000Z", paid_at: absent }, affiliate: {} });
    assert.equal(doc.subscription_started_at, "2025-06-12T00:00:00.000Z", `paid_at ${JSON.stringify(absent)} must fall through`);
    assert.notEqual(doc.next_due_at.slice(0, 4), "1970", "a missing paid_at must never become the epoch");
  }

  // No payment row at all: the sale's own timestamp is the last resort.
  const noPayment = deriveSubscriptionFromSale({ sale: base, payment: null, affiliate: {} });
  assert.equal(noPayment.subscription_started_at, "2025-06-10T09:30:00.000Z");
});

test("an old sale stays overdue rather than being caught up", () => {
  // Eight months of silence. Inventing eight months of catch-up would make an
  // institution that stopped paying look current, which is the one outcome this
  // migration must never produce.
  const doc = deriveSubscriptionFromSale({
    sale: preFeatureSale({ created_date: "2026-01-10T09:30:00.000Z" }),
    payment: null,
    affiliate: {},
  });
  assert.equal(doc.next_due_at, "2026-02-10T09:30:00.000Z");
  assert.equal(isOverdue(doc.next_due_at, "2026-10-03T00:00:00.000Z"), true);
  // And it is still a live subscription awaiting a renewal, not a cancelled one.
  assert.equal(doc.status, "active");
});

test("the migration honours the plan's own billing cycle", () => {
  const annual = deriveSubscriptionFromSale({
    sale: preFeatureSale({ billing_cycle: "year" }),
    payment: { created_date: "2025-06-10T09:30:00.000Z" },
    affiliate: {},
  });
  assert.equal(annual.interval_months, 12);
  assert.equal(annual.next_due_at, "2026-06-10T09:30:00.000Z");
  // An unrecognised label falls back to monthly, same as the live sale path.
  const odd = deriveSubscriptionFromSale({
    sale: preFeatureSale({ billing_cycle: "lifetime" }),
    payment: { created_date: "2025-06-10T09:30:00.000Z" },
    affiliate: {},
  });
  assert.equal(odd.interval_months, 1);
});

test("a sale with no tenant or no usable date yields no subscription at all", () => {
  // Returning null is what makes the backfill report the row instead of writing a
  // document with a 1970 due date.
  assert.equal(deriveSubscriptionFromSale({ sale: null, payment: null }), null);
  assert.equal(deriveSubscriptionFromSale({ sale: { tenant_id: "" }, payment: null }), null);
  assert.equal(deriveSubscriptionFromSale({}), null);
  const dateless = deriveSubscriptionFromSale({ sale: preFeatureSale({ created_date: null }), payment: null, affiliate: {} });
  assert.equal(dateless, null, "a sale with no date anywhere has nothing to bill from");
});

test("the migrated commission rate is the rate the sale was made at, not the current one", () => {
  const doc = deriveSubscriptionFromSale({
    sale: preFeatureSale({ commission_rate: 10 }),
    payment: null,
    affiliate: { commission_rate: 40, commission_mode: "recurring" },
  });
  // Same rule as the live path: an affiliate promoted from 10% to 40% must not have
  // their already-sold subscriptions repriced by the fact they later renewed.
  assert.equal(doc.commission_rate, 10);
});
