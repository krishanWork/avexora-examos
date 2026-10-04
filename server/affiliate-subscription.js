// Affiliate subscription renewal arithmetic and reminder rendering.
//
// Deliberately pure, for the same reason server/affiliate-commission.js is: it takes
// dates, numbers and strings and returns dates, numbers and strings, and never touches
// the database, the request or the response. A month-length rule that is only reachable
// through a route handler against a live MongoDB is a rule nobody tests, and "what date
// is this institution due on" is exactly the kind of rule that is trivially wrong.
//
// Every timestamp here is an ISO STRING, not a BSON date. That is the schema
// convention across this codebase (see the month-to-date bucketing comment in
// server/index.js, which notes created_date is an ISO string precisely because
// $dateFromString would otherwise be required to filter it in the database), and a
// Date object that leaks into a Mongo document is unqueryable alongside the rest.
//
// The whole renewal model rests on ONE stored fact — `paid_through`, the last instant
// that has been paid for — and derives the rest. `next_due_at` is written alongside it
// as a denormalised copy purely so the cron can find "everything due within the next
// seven days" with one indexed range query; `computePeriod()` is the single function
// that produces it, so the denormalised field cannot drift from the source of truth.

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

// The business rule is monthly: a subscription renews every month. `billing_cycle`
// is a free-text label on SubscriptionPlan that is never interpreted anywhere else in
// the application, and it is not even consistent with itself — the seed data writes
// "month" (server/seed.js) while the plan editor's default is "monthly"
// (src/components/plans/PlanFormDialog.jsx). So the label is NORMALISED here rather
// than trusted, and anything unrecognised falls back to one month: an institution
// that reads as monthly and gets billed yearly is a much worse failure than one that
// reads as yearly and is reminded monthly.
export const DEFAULT_INTERVAL_MONTHS = 1;

export const normalizeInterval = (billingCycle) => {
  const label = String(billingCycle || "").trim().toLowerCase();
  if (!label) return DEFAULT_INTERVAL_MONTHS;
  // Year and quarter are the two labels a real plan catalogue might carry; both map
  // cleanly onto whole months. Everything else is treated as monthly.
  if (/(year|annual)/.test(label)) return 12;
  if (/quarter/.test(label)) return 3;
  return DEFAULT_INTERVAL_MONTHS;
};

// Add whole calendar months, clamping the day to the last day of the target month.
//
// The clamping is the whole point. Without it, addMonths("2026-01-31", 1) overflows to
// 2026-03-03 — because a naive `setUTCMonth` on the 31st walks straight through
// February — and a subscription sold on the 31st would then be due on the 3rd of the
// month after next, appearing to owe an extra month every cycle. Clamped, it falls to
// the 28th (or the 29th in a leap year), which is the date a human means by "one
// month later". Once clamped, the anchor STAYS at the end of the month rather than
// drifting: 31 Jan -> 28 Feb -> 31 Mar, not 31 Jan -> 28 Feb -> 28 Mar.
export const addMonths = (iso, months) => {
  // Guarded for null/undefined/"" BEFORE the Date constructor, because
  // `new Date(null)` is the Unix EPOCH and `new Date(undefined)` is Invalid — so a
  // missing subscription date would otherwise advance to 1970 and put a due date of
  // "1970-02-01" on an institution. Anything that is not a usable instant is refused.
  if (iso === null || iso === undefined || iso === "") return null;
  const from = new Date(iso);
  if (Number.isNaN(from.getTime())) return null;
  const day = from.getUTCDate();
  const time = {
    hours: from.getUTCHours(),
    minutes: from.getUTCMinutes(),
    seconds: from.getUTCSeconds(),
    ms: from.getUTCMilliseconds(),
  };
  // Built on day 1 on purpose: `new Date(Date.UTC(y, m + months, day))` normalises
  // the overflow itself, so asking for the 31st of February would silently hand back
  // the 3rd of March. Constructing the 1st and setting a clamped day afterwards keeps
  // the month arithmetic and the day choice separate and each obvious.
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1, time.hours, time.minutes, time.seconds, time.ms));
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return target.toISOString();
};

// Whole UTC calendar days from `a` to `b`.
//
// Truncating BOTH ends to UTC midnight before subtracting is what makes the lead-day
// match stable. Comparing raw timestamps would make "7 days before" fire at a slightly
// different moment on every run, because the clock has moved since the due date was
// written; on a daily cron that is the difference between a reminder landing on the
// right day and the 7-day reminder never firing at all.
const DAY_MS = 24 * 60 * 60 * 1000;
const utcMidnight = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export const daysBetween = (from, to) => {
  const a = utcMidnight(from);
  const b = utcMidnight(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
};

// ---------------------------------------------------------------------------
// The billing period
// ---------------------------------------------------------------------------

// Derive the next due date from the one stored fact.
//
// Returns null when there is nothing to derive from — a subscription with no
// `paid_through` has no period, and inventing a due date from "now" would put a school
// on the renewal schedule the moment it was created rather than the month after it
// was paid for.
export const computePeriod = (subscription) => {
  const paidThrough = subscription?.paid_through;
  if (!paidThrough) return null;
  const months = Number(subscription?.interval_months) || normalizeInterval(subscription?.billing_cycle);
  const nextDueAt = addMonths(paidThrough, months);
  if (!nextDueAt) return null;
  return { nextDueAt, periodKey: nextDueAt.slice(0, 10) };
};

// The dedupe key for one reminder within one billing period.
//
// This is the `period_key` half of the unique index that makes a reminder impossible to
// send twice: it is derived from the DUE DATE, not from the day the reminder was sent,
// so a 7-day-ahead reminder and an on-the-day reminder for the same month are
// different rows (they carry different lead_days) while two runs of the SAME reminder
// are the same row and collide.
export const periodKeyFor = (nextDueAt) => {
  const stamp = new Date(nextDueAt);
  if (Number.isNaN(stamp.getTime())) return null;
  return stamp.toISOString().slice(0, 10);
};

export const isOverdue = (nextDueAt, now) => {
  const remaining = daysBetween(now, nextDueAt);
  return remaining !== null && remaining < 0;
};

export const daysUntilDue = (nextDueAt, now) => {
  const remaining = daysBetween(now, nextDueAt);
  return remaining === null ? null : remaining;
};

// ---------------------------------------------------------------------------
// Reminder configuration
// ---------------------------------------------------------------------------

export const REMINDER_CHANNELS = ["email", "whatsapp"];

// 7 days before, 1 day before, and on the day itself. Three sends rather than one
// because a single reminder is a reminder that gets ignored: a school that does not
// act on the 7-day note has no second chance before the subscription lapses.
export const DEFAULT_LEAD_DAYS = [7, 1, 0];

export const MAX_LEAD_DAY = 365;

// Channels are a subset of the supported set, and an empty list is REFUSED rather
// than stored: an affiliate with no channel enabled would silently receive no reminders
// at all, and the page would read as if reminders were on.
export const normalizeChannels = (value) => {
  const list = Array.isArray(value) ? value : [];
  const picked = REMINDER_CHANNELS.filter((channel) => list.includes(channel));
  return picked;
};

export const hasAnyChannel = (value) => normalizeChannels(value).length > 0;

// Lead days are a de-duplicated, ascending list of whole days 0..365.
//
// Clamped rather than rejected: a lead time of 400 days is not a security problem and
// refusing to save the whole reminder configuration over one mistyped field would be
// worse than storing the nearest sensible value. Negative values are dropped instead,
// since "remind me 3 days after it is due" is not a thing the scheduler can honour.
export const normalizeLeadDays = (value) => {
  const list = Array.isArray(value) ? value : [];
  const days = new Set();
  for (const entry of list) {
    // Type-checked BEFORE coercion, for the same reason normalizeCommissionRate does
    // it: Number(null), Number("") and Number([]) are all 0, so an absent or blank
    // field would otherwise become a legitimate "0" — a reminder sent on the due date
    // itself, by a schedule that never asked for one.
    if (typeof entry !== "number" && typeof entry !== "string") continue;
    if (typeof entry === "string" && !entry.trim()) continue;
    const day = Number(entry);
    if (!Number.isInteger(day)) continue;
    // Negative dropped: "remind me 3 days after it is due" is not a thing the
    // scheduler can honour, and silently reinterpreting it as "today" would send a
    // reminder the affiliate never asked for.
    if (day < 0) continue;
    // Too large is CLAMPED rather than dropped or refused. A mistyped 9999 is one
    // field; refusing to save the whole reminder configuration over it would leave
    // the affiliate with no reminders at all, which is a worse outcome than a
    // one-year lead time.
    days.add(Math.min(day, MAX_LEAD_DAY));
  }
  return [...days].sort((a, b) => b - a);
};

// Which configured lead days are due on the day `now` falls on.
//
// Returns [] rather than a value that matches nothing when the inputs are unusable, so
// a malformed date simply sends no reminder instead of throwing inside the cron and
// taking the rest of the run down with it.
export const matchingLeadDays = (nextDueAt, leadDays, now) => {
  const remaining = daysUntilDue(nextDueAt, now);
  if (remaining === null) return [];
  return normalizeLeadDays(leadDays).filter((day) => day === remaining);
};

// ---------------------------------------------------------------------------
// Commission mode
// ---------------------------------------------------------------------------

// Whether a renewal books a new commission.
//
// "one_time" is the default and preserves the programme as it exists: an affiliate is
// paid for the subscription they sold, not for every month it subsequently runs.
// "recurring" is a super-admin policy choice on the profile — this is money, so the
// caller decides it, never the affiliate who would receive it.
export const COMMISSION_MODES = ["one_time", "recurring"];

export const isCommissionMode = (value) => COMMISSION_MODES.includes(value);

export const normalizeCommissionMode = (value) => (isCommissionMode(value) ? value : "one_time");

export const shouldCreateCommission = (mode) => normalizeCommissionMode(mode) === "recurring";

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

export const TEMPLATE_PLACEHOLDERS = [
  "school_name",
  "contact_name",
  "plan_name",
  "amount",
  "paid_through",
  "due_date",
  "days_until_due",
  "affiliate_name",
  "pay_link",
];

// Build the substitution map for one subscription.
//
// `days_until_due` renders the phrase rather than a bare number, because a reminder
// that says "Your subscription is due in -3 days" is worse than useless, and the
// wording belongs here where the sign can be handled once.
export const templateVariables = ({ subscription = {}, affiliate = {}, now } = {}) => {
  const remaining = subscription.next_due_at ? daysUntilDue(subscription.next_due_at, now) : null;
  let whenPhrase = "";
  if (remaining !== null) {
    if (remaining < 0) whenPhrase = `${Math.abs(remaining)} day(s) overdue`;
    else if (remaining === 0) whenPhrase = "due today";
    else if (remaining === 1) whenPhrase = "due tomorrow";
    else whenPhrase = `due in ${remaining} days`;
  }
  return {
    school_name: String(subscription.tenant_name || ""),
    contact_name: String(subscription.contact?.name || ""),
    plan_name: String(subscription.plan_name || ""),
    amount: String(subscription.plan_price ?? ""),
    paid_through: formatDay(subscription.paid_through),
    due_date: formatDay(subscription.next_due_at),
    days_until_due: whenPhrase,
    affiliate_name: String(affiliate.full_name || ""),
    pay_link: String(affiliate.reminder_pay_link || ""),
  };
};

const formatDay = (iso) => {
  if (!iso) return "";
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return "";
  return stamp.toISOString().slice(0, 10);
};

// Substitute `{{placeholder}}` tokens.
//
// Unknown placeholders are LEFT INTACT rather than blanked. A draft that still reads
// `{{due_data}}` tells the person editing it that they mistyped a name; silently
// deleting it sends a confident, hole-punched reminder to a paying customer instead.
// Unknown keys are also the reason this cannot be a `replace` on a fixed list — the
// set of known keys lives in TEMPLATE_PLACEHOLDERS and is enforced by the route when
// it validates a saved draft, not by pretending here.
export const renderTemplate = (text, vars) => {
  const source = String(text || "");
  if (!source.includes("{{")) return source;
  return source.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
    const value = vars?.[key];
    if (value === undefined) return match;
    return String(value);
  });
};

// The template as it would actually read for this subscription. Used by the settings
// dialog's live preview and by the send route's "what am I about to send" endpoint, so
// the person pressing Send sees the same text the provider will receive.
export const renderReminder = (text, { subscription, affiliate, now }) =>
  renderTemplate(text, templateVariables({ subscription, affiliate, now }));

// ---------------------------------------------------------------------------
// Migration: a Subscription from a pre-existing AffiliateSale
// ---------------------------------------------------------------------------

// Rebuild the subscription document for a sale that was made before this feature
// existed, so the renewal screen shows history instead of an empty table.
//
// This exists as a PURE function, and calls normalizeInterval / normalizeCommissionMode
// / computePeriod rather than re-deriving any of them, for one reason: a backfill that
// reimplements the month rule is the way a migrated row and a freshly-sold one end up
// disagreeing about when the next renewal falls due. Both paths must be the same code.
//
// `commission_mode` resolves to `one_time` for every affiliate that predates the field,
// which is deliberate. `one_time` is exactly how the programme behaved before the mode
// existed, so a backfilled row can never invent a recurring commission the platform never
// agreed to pay.
//
// `paidThrough` prefers the payment's `paid_at`, because that is the instant the money
// arrived and it is the fact the billing period actually starts from. It falls back to
// `created_date` (older Payment rows have no `paid_at`) and finally to the sale's own
// timestamp, so a sale whose payment row cannot be found still produces a usable
// document rather than being skipped — the caller reports that fallback separately,
// because a subscription dated from the sale is a guess and the operator should see it.
//
// Returns null for a sale that cannot yield a start date at all, rather than a document
// with a 1970 due date.
export const deriveSubscriptionFromSale = ({ sale, payment, affiliate = {}, now } = {}) => {
  if (!sale || !sale.tenant_id) return null;

  const startedAt =
    firstUsableDate(payment?.paid_at) ||
    firstUsableDate(payment?.created_date) ||
    firstUsableDate(sale.created_date);
  if (!startedAt) return null;

  const intervalMonths = normalizeInterval(sale.billing_cycle);
  const period = computePeriod({ paid_through: startedAt, interval_months: intervalMonths });
  if (!period) return null;

  return {
    affiliate_id: String(sale.affiliate_id || ""),
    affiliate_user_id: String(sale.affiliate_user_id || ""),
    tenant_id: String(sale.tenant_id),
    tenant_name: String(sale.tenant_name || ""),
    tenant_subdomain: String(sale.tenant_subdomain || ""),
    plan_id: String(sale.plan_id || ""),
    plan_name: String(sale.plan_name || ""),
    plan_price: Number(sale.plan_price) || Number(sale.amount) || 0,
    currency: "INR",
    billing_cycle: String(sale.billing_cycle || ""),
    interval_months: intervalMonths,
    commission_mode: normalizeCommissionMode(affiliate.commission_mode),
    commission_rate: Number(sale.commission_rate) || 0,
    sale_id: String(sale._id || ""),
    contact: {
      name: String(sale.school_contact_name || ""),
      email: String(sale.school_contact_email || ""),
      phone: sale.school_contact_phone ? String(sale.school_contact_phone) : null,
    },
    subscription_started_at: startedAt,
    // One month's payment was collected at the sale, so the first period ends one
    // interval after it. Nothing here invents catch-up months for a sale that is old —
    // an institution sold eight months ago and never renewed is genuinely overdue, and
    // showing it as current would hide a customer who has stopped paying.
    paid_through: startedAt,
    next_due_at: period.nextDueAt,
    status: "active",
    // created_date is when this DOCUMENT was written, not when the sale happened. It
    // keeps the two timestamps distinguishable: `subscription_started_at` is the
    // commercial fact, this is the migration.
    created_date: now || new Date().toISOString(),
    updated_date: now || new Date().toISOString(),
  };
};

// The first argument that is a usable ISO instant.
//
// Trimmed and empty-checked before Date parsing because `new Date(null)` is the Unix
// epoch — a naive `a || b` on a null paid_at would silently produce a 1970 due date.
const firstUsableDate = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const stamp = new Date(candidate);
    if (!Number.isNaN(stamp.getTime())) return stamp.toISOString();
  }
  return null;
};