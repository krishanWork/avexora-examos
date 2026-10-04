import "dotenv/config";
import { db } from "./db.js";

// Idempotent, non-destructive index creation for the ExamOS multi-tenant data model.
//
// This script is intentionally NOT executed at server startup. Run it manually:
//   node server/ensure-indexes.js
//
// Identity is scoped per tenant, so indexes are compound (tenant_id, email field).
// The partial filter keeps an index limited to records that actually carry the
// indexed email field, so documents without (or with a non-string) email are
// excluded from the uniqueness guarantee.
//
// IMPORTANT: tenantless records WITH a string email are NOT exempt. A tenantless
// platform user simply has tenant_id null/absent in the compound key, so all
// tenantless users sharing one email collide on (null, email). This means
// tenantless platform users are still covered by the partial filter and remain
// globally unique by email amongst themselves; only truly email-less documents
// fall outside the index.
//
// The script NEVER modifies existing records. If a proposed unique index would
// conflict with existing data, creation fails and the conflict is reported
// here without altering any data.

// --- Preflight: Scan for duplicate (tenant_id, admission_number) before creating unique index ---
async function preflightDuplicateScan(database) {
  console.log("Running preflight duplicate scan on Student.admission_number ...");
  const duplicates = await database.collection("Student").aggregate([
    { $match: { admission_number: { $exists: true, $type: "string", $gt: "" } } },
    { $group: { _id: { tenant_id: "$tenant_id", admission_number: "$admission_number" }, count: { $sum: 1 }, docs: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  if (duplicates.length > 0) {
    console.error(`\n  PREFLIGHT_ABORT: Found ${duplicates.length} duplicate (tenant_id, admission_number) group(s):`);
    for (const dup of duplicates.slice(0, 10)) {
      console.error(`    tenant=${dup._id.tenant_id}  admission_number="${dup._id.admission_number}"  count=${dup.count}  ids=${dup.docs.join(", ")}`);
    }
    if (duplicates.length > 10) console.error(`    ... and ${duplicates.length - 10} more`);
    console.error("\n  No indexes were modified. Resolve the duplicates, then re-run this script.\n");
    return false;
  }
  console.log("  No duplicates found. Proceeding with index creation.\n");
  return true;
}

// The portal subdomain is a globally unique public tenant identifier, not a
// per-tenant field: it is what resolves a tenant in publicSite/branding and in a
// *.avexora.in portal URL, so two tenants sharing one is not merely untidy — the
// regex-based branding lookup can return the wrong institution. Backs the
// application guard assertSubdomainAvailable().
async function preflightDuplicateSubdomainScan(database) {
  console.log("Running preflight duplicate scan on Tenant.subdomain ...");
  const duplicates = await database.collection("Tenant").aggregate([
    { $match: { subdomain: { $exists: true, $type: "string", $gt: "" } } },
    { $group: { _id: "$subdomain", count: { $sum: 1 }, docs: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  if (duplicates.length > 0) {
    console.error(`\n  PREFLIGHT_ABORT: Found ${duplicates.length} duplicate Tenant.subdomain value(s):`);
    for (const dup of duplicates.slice(0, 10)) {
      console.error(`    subdomain="${dup._id}"  count=${dup.count}  tenant_ids=${dup.docs.join(", ")}`);
    }
    if (duplicates.length > 10) console.error(`    ... and ${duplicates.length - 10} more`);
    console.error("\n  No indexes were modified. Rename or merge the duplicate tenants, then re-run this script.\n");
    return false;
  }
  console.log("  No duplicates found. Proceeding with index creation.\n");
  return true;
}

const INDEX_SPECS = [
  {
    name: "ux_tenant_subdomain",
    collection: "Tenant",
    key: { subdomain: 1 },
    unique: true,
    partialFilterExpression: { subdomain: { $exists: true, $type: "string", $gt: "" } },
    purpose: "One institution per portal subdomain. The subdomain is a global public identifier used to resolve a tenant for branding and portal URLs, so it must not repeat across tenants.",
  },
  {
    name: "ux_user_tenant_email",
    collection: "User",
    key: { tenant_id: 1, email: 1 },
    unique: true,
    partialFilterExpression: { email: { $exists: true, $type: "string" } },
    purpose: "One User account per normalized email within a tenant. Tenantless users (tenant_id null/absent) are covered by the same partial filter and stay email-unique amongst themselves via the (null, email) key.",
  },
  {
    name: "ux_teacher_tenant_email",
    collection: "Teacher",
    key: { tenant_id: 1, email: 1 },
    unique: true,
    partialFilterExpression: { email: { $exists: true, $type: "string" } },
    purpose: "One Teacher profile per normalized email within a tenant.",
  },
  {
    name: "ux_student_tenant_student_email",
    collection: "Student",
    key: { tenant_id: 1, student_email: 1 },
    unique: true,
    partialFilterExpression: { student_email: { $exists: true, $type: "string" } },
    purpose: "One Student role-identity email per normalized student email within a tenant.",
  },
  {
    name: "ix_student_tenant_parent_email",
    collection: "Student",
    key: { tenant_id: 1, parent_email: 1 },
    unique: false,
    partialFilterExpression: { parent_email: { $exists: true, $type: "string" } },
    purpose: "Supporting index for tenant-scoped parent account linking (non-unique; parent emails may repeat).",
  },
  {
    name: "ix_student_tenant_email",
    collection: "Student",
    key: { tenant_id: 1, email: 1 },
    unique: false,
    partialFilterExpression: { email: { $exists: true, $type: "string" } },
    purpose: "Supporting index for the legacy Student.email account-linking field (non-unique).",
  },
  {
    name: "ix_rate_limit_lookup",
    collection: "RateLimit",
    key: { scope: 1, key: 1 },
    unique: false,
    purpose: "SEC-05: lookup edge for windowed auth-abuse counters and lockout markers.",
  },
  {
    name: "ttl_rate_limit_window",
    collection: "RateLimit",
    key: { window_end: 1 },
    unique: false,
    expireAfterSeconds: 0,
    purpose: "SEC-05: bounded storage for windowed counters; expired buckets are reaped by the TTL monitor.",
  },
  {
    name: "ttl_rate_limit_lock",
    collection: "RateLimit",
    key: { lock_until: 1 },
    unique: false,
    expireAfterSeconds: 0,
    purpose: "SEC-05: bounded storage for lockout markers; expired locks are reaped by the TTL monitor.",
  },
  {
    name: "ux_academic_year_tenant_name",
    collection: "AcademicYear",
    key: { tenant_id: 1, name: 1 },
    unique: true,
    purpose: "One AcademicYear per name within a tenant.",
  },
  {
    name: "ix_academic_year_tenant_current",
    collection: "AcademicYear",
    key: { tenant_id: 1, is_current: 1 },
    unique: false,
    purpose: "Fast lookup for current active academic year in a tenant.",
  },
  {
    name: "ux_school_class_tenant_name",
    collection: "SchoolClass",
    key: { tenant_id: 1, name: 1 },
    unique: true,
    purpose: "One SchoolClass per name within a tenant.",
  },
  {
    name: "ux_section_tenant_class_name",
    collection: "Section",
    key: { tenant_id: 1, school_class_id: 1, name: 1 },
    unique: true,
    purpose: "Unique section name per class within a tenant.",
  },
  {
    name: "ix_subject_tenant_name",
    collection: "Subject",
    key: { tenant_id: 1, name: 1 },
    unique: false,
    purpose: "Fast subject lookup by tenant and name.",
  },
  {
    name: "ux_enrollment_tenant_year_student",
    collection: "Enrollment",
    key: { tenant_id: 1, academic_year_id: 1, student_id: 1 },
    unique: true,
    purpose: "One active enrollment per student per academic year.",
  },
  {
    name: "ix_enrollment_tenant_year_class_section",
    collection: "Enrollment",
    key: { tenant_id: 1, academic_year_id: 1, school_class_id: 1, section_id: 1 },
    unique: false,
    purpose: "Class and section roster queries by academic year.",
  },
  {
    name: "ux_parent_tenant_email",
    collection: "Parent",
    key: { tenant_id: 1, email: 1 },
    unique: true,
    partialFilterExpression: { email: { $exists: true, $type: "string" } },
    purpose: "One Parent profile per email within a tenant when email is provided.",
  },
  {
    name: "ux_parent_student_link",
    collection: "ParentStudent",
    key: { tenant_id: 1, parent_id: 1, student_id: 1 },
    unique: true,
    purpose: "Unique link between a parent and student within a tenant.",
  },
  {
    name: "ix_parent_student_tenant_student",
    collection: "ParentStudent",
    key: { tenant_id: 1, student_id: 1 },
    unique: false,
    purpose: "Lookup all parents linked to a student.",
  },
  {
    name: "ix_teacher_assignment_lookup",
    collection: "TeacherAssignment",
    key: { tenant_id: 1, teacher_id: 1, academic_year_id: 1, school_class_id: 1, section_id: 1, subject_id: 1 },
    unique: false,
    purpose: "Teacher assignment lookup across year, class, section, and subject.",
  },
  {
    name: "ux_attendance_tenant_student_date",
    collection: "Attendance",
    key: { tenant_id: 1, student_id: 1, date: 1 },
    unique: true,
    purpose: "Prevents duplicate attendance records for a student on a specific date within a tenant.",
  },
  {
    name: "ix_attendance_roster_lookup",
    collection: "Attendance",
    key: { tenant_id: 1, school_class_id: 1, section_id: 1, date: 1 },
    unique: false,
    purpose: "Fast retrieval of class/section roster attendance on a specific date.",
  },
  {
    name: "ix_attendance_year_lookup",
    collection: "Attendance",
    key: { tenant_id: 1, academic_year_id: 1, student_id: 1 },
    unique: false,
    purpose: "Lookup historical attendance for a student across an academic year.",
  },
  {
    name: "ix_attendance_history_query",
    collection: "Attendance",
    key: { tenant_id: 1, academic_year_id: 1, school_class_id: 1, section_id: 1, date: 1 },
    unique: false,
    purpose: "Fast date-range and session history aggregation of attendance for class/section.",
  },
  {
    name: "ux_bell_schedule_stage",
    collection: "BellSchedule",
    key: { tenant_id: 1, academic_year_id: 1, stage: 1 },
    unique: true,
    partialFilterExpression: { scope_type: { $eq: "stage" } },
    purpose: "Legacy weekly bell schedule — no longer maintained; index left in place for existing data.",
  },
  {
    name: "ux_bell_schedule_class",
    collection: "BellSchedule",
    key: { tenant_id: 1, academic_year_id: 1, school_class_id: 1 },
    unique: true,
    partialFilterExpression: { scope_type: { $eq: "class" } },
    purpose: "Legacy weekly bell schedule — no longer maintained; index left in place for existing data.",
  },
  {
    name: "ix_assignment_class_subject_due",
    collection: "Assignment",
    key: { tenant_id: 1, school_class_id: 1, subject_id: 1, due_date: 1 },
    unique: false,
    purpose: "Fast querying of assignments by class, subject, and deadline.",
  },
  {
    name: "ix_assignment_teacher",
    collection: "Assignment",
    key: { tenant_id: 1, teacher_id: 1 },
    unique: false,
    purpose: "Lookup assignments created by a teacher.",
  },
  {
    name: "ux_submission_assignment_student",
    collection: "AssignmentSubmission",
    key: { tenant_id: 1, assignment_id: 1, student_id: 1 },
    unique: true,
    purpose: "Enforces single authoritative submission per student per assignment.",
  },
  {
    name: "ix_submission_student",
    collection: "AssignmentSubmission",
    key: { tenant_id: 1, student_id: 1 },
    unique: false,
    purpose: "Lookup all submissions by a student.",
  },
  {
    name: "ux_student_tenant_admission_number",
    collection: "Student",
    key: { tenant_id: 1, admission_number: 1 },
    unique: true,
    partialFilterExpression: { admission_number: { $exists: true, $type: "string", $gt: "" } },
    purpose: "Ensures unique non-empty admission numbers within each tenant. Multi-tenant safe.",
  },
  {
    name: "ux_attendance_tenant_exam_student",
    collection: "Attendance",
    key: { tenant_id: 1, examination_id: 1, student_id: 1 },
    unique: true,
    partialFilterExpression: { examination_id: { $exists: true }, student_id: { $exists: true } },
    purpose: "Guarantees idempotent exam attendance. Scanning the same sheet twice never creates duplicate records.",
  },
  {
    name: "ux_result_tenant_exam_student",
    collection: "Result",
    key: { tenant_id: 1, examination_id: 1, student_id: 1 },
    unique: true,
    partialFilterExpression: { examination_id: { $exists: true }, student_id: { $exists: true } },
    purpose: "Guarantees exactly one Result document per student per exam under concurrent evaluations.",
  },
  {
    name: "ux_exam_roster_tenant_exam_student",
    collection: "ExamRoster",
    key: { tenant_id: 1, examination_id: 1, student_id: 1 },
    unique: true,
    purpose: "Exactly one authoritative roster membership per student per exam within a tenant.",
  },
  {
    name: "ix_exam_roster_student_year",
    collection: "ExamRoster",
    key: { tenant_id: 1, student_id: 1, academic_year_id: 1 },
    unique: false,
    purpose: "Find all examinations a student is rostered for across an academic year (enrollment-change sync).",
  },
  {
    name: "ux_lead_settings_key",
    collection: "LeadSettings",
    key: { key: 1 },
    unique: true,
    purpose: "Singleton document key for the global Lead notification settings.",
  },
  {
    name: "ux_integration_settings_key",
    collection: "IntegrationSettings",
    key: { key: 1 },
    unique: true,
    purpose: "Singleton document key for encrypted email/WhatsApp connection settings.",
  },
  {
    name: "ix_examination_tenant_classes",
    collection: "Examination",
    key: { tenant_id: 1, school_class_ids: 1 },
    unique: false,
    purpose: "Teacher-scoped exam reads and answer-key scope checks both query Examination by (tenant_id, school_class_ids). Without this every teacher-scoped read is a collection scan.",
  },
  {
    name: "ux_answer_key_tenant_exam_paper_set",
    collection: "AnswerKey",
    key: { tenant_id: 1, examination_id: 1, paper_set: 1 },
    unique: true,
    purpose: "Exactly one answer key per examination paper set. The UI resolves a key with filter(...) then takes the first hit and evaluation resolves it with findOne, so a duplicate would be picked arbitrarily.",
  },
  {
    name: "ix_lead_created_date",
    collection: "Lead",
    key: { created_date: -1 },
    unique: false,
    purpose: "Newest-first listing for the Lead Management page.",
  },
  {
    name: "ix_lead_comm_lead_date",
    collection: "LeadCommunication",
    key: { lead_id: 1, created_date: 1 },
    unique: false,
    purpose: "Conversation history queries for a lead, oldest-first.",
  },
  {
    name: "ux_lead_comm_external_id",
    collection: "LeadCommunication",
    key: { external_message_id: 1 },
    unique: true,
    partialFilterExpression: { external_message_id: { $exists: true, $type: "string", $gt: "" } },
    purpose: "Deduplicates WhatsApp webhook deliveries (wamid) so a provider retry can never duplicate an inbound message.",
  },
  {
    name: "ux_affiliate_user_id",
    collection: "Affiliate",
    key: { user_id: 1 },
    unique: true,
    purpose: "One commission profile per login. Every affiliate-scoped query resolves the caller's profile by this key, so a second profile for the same account would give that account two ledgers and two balances.",
  },
  {
    name: "ux_affiliate_code",
    collection: "Affiliate",
    key: { code: 1 },
    unique: true,
    partialFilterExpression: { code: { $exists: true, $type: "string", $gt: "" } },
    purpose: "A referral code is the public identifier a reseller hands out, so it must be unique across the programme. Partial so the majority of affiliates with no code do not collide on the missing field.",
  },
  {
    name: "ix_affiliatesale_affiliate_created",
    collection: "AffiliateSale",
    key: { affiliate_id: 1, created_date: -1 },
    unique: false,
    purpose: "The per-affiliate sales list (newest first) and the balance aggregation both group and filter by affiliate_id; without the compound key every ledger read is a collection scan.",
  },
  {
    name: "ix_affiliatesale_status",
    collection: "AffiliateSale",
    key: { status: 1 },
    unique: false,
    purpose: "Counts and filters of commissions awaiting approval or payment, which is the super admin's payout queue.",
  },
  {
    name: "ux_subscription_tenant",
    collection: "Subscription",
    key: { tenant_id: 1 },
    unique: true,
    purpose: "One subscription per institution. The renewal flow advances a period in place, so a second Subscription for the same tenant would be a second, independently-advanced due date that nothing reconciles.",
  },
  {
    name: "ix_subscription_due",
    collection: "Subscription",
    key: { status: 1, next_due_at: 1 },
    unique: false,
    purpose: "The renewal-reminder cron's only query: active subscriptions due within the reminder horizon. This is a range scan over next_due_at, and without the compound key it is a collection scan of every subscription on every daily run.",
  },
  {
    name: "ix_subscription_affiliate",
    collection: "Subscription",
    key: { affiliate_id: 1, next_due_at: 1 },
    unique: false,
    purpose: "The per-affiliate subscription list on both the admin page and the reseller portal, sorted by due date.",
  },
  {
    // The duplicate-send guard. A cron retry, an overlapping invocation, and a
    // "Send now" pressed at the same moment all race for the same reminder; the one
    // that loses this index never sends.
    name: "ux_reminder_once_per_period",
    collection: "AffiliateReminderDelivery",
    key: { subscription_id: 1, period_key: 1, lead_days: 1, channel: 1 },
    unique: true,
    purpose: "Makes a renewal reminder impossible to send twice for the same subscription, billing period, lead day and channel. This is what stops a retried cron from mailing a customer the same renewal notice three times.",
  },
  {
    name: "ix_reminder_delivery_history",
    collection: "AffiliateReminderDelivery",
    key: { subscription_id: 1, created_date: -1 },
    unique: false,
    purpose: "The delivery history panel: what was sent to one subscription, newest first, with the provider message id or the failure reason.",
  },
  {
    // One live request per school. Partial on status so only PENDING rows are
    // constrained — the index is the real guarantee behind the planUpgrade
    // duplicate check, which otherwise has a window between reading for an
    // existing request and inserting a new one.
    name: "ux_planchange_pending_per_tenant",
    collection: "PlanChangeRequest",
    key: { tenant_id: 1 },
    unique: true,
    partialFilterExpression: { status: "pending" },
    purpose: "Makes two concurrent plan-change requests from the same institution impossible, so the approver queue cannot hold two competing claims on one account.",
  },
  {
    name: "ix_planchange_queue",
    collection: "PlanChangeRequest",
    key: { status: 1, created_date: -1 },
    unique: false,
    purpose: "The approver queue on /plan-requests: pending requests oldest first, which is also the order an operator works through them in.",
  },
  {
    name: "ix_planchange_tenant",
    collection: "PlanChangeRequest",
    key: { tenant_id: 1, created_date: -1 },
    unique: false,
    purpose: "The institution's own request history on /billing. readScope pins this read to the caller's tenant, so the compound key is both the filter and the sort.",
  },
];

async function main() {
  const database = await db();
  const results = [];
  let hadConflict = false;

  // Preflight: abort if duplicate admission numbers exist (must resolve before creating unique index)
  const clean = await preflightDuplicateScan(database);
  if (!clean) {
    process.exit(1);
  }

  // Preflight: the subdomain is globally unique, so an existing duplicate is a
  // real data-integrity problem (two institutions on one portal address) and must
  // be resolved by a human before the index can be created.
  const subdomainsClean = await preflightDuplicateSubdomainScan(database);
  if (!subdomainsClean) {
    process.exit(1);
  }

  for (const spec of INDEX_SPECS) {
    const coll = database.collection(spec.collection);
    const { name, collection, key, purpose } = spec;
    const options = { name };
    if (spec.unique) options.unique = true;
    if (spec.partialFilterExpression) options.partialFilterExpression = spec.partialFilterExpression;
    if (spec.expireAfterSeconds !== undefined) options.expireAfterSeconds = spec.expireAfterSeconds;
    try {
      const createdName = await coll.createIndex(key, options);
      results.push({ collection, name, status: "ok", createdName });
    } catch (error) {
      hadConflict = true;
      results.push({
        collection,
        name,
        status: "ERROR",
        code: error.code,
        message: error.message,
        purpose,
      });
    }
  }

  for (const r of results) {
    if (r.status === "ok") {
      console.log(`OK    ${r.collection}.${r.name} -> ${r.createdName}`);
    } else {
      console.log(`FAIL  ${r.collection}.${r.name} (code ${r.code}): ${r.message}`);
      console.log(`      Index purpose: ${r.purpose}`);
      console.log("      No records were modified. Resolve the conflict, then re-run this script.");
    }
  }

  console.log("");
  if (hadConflict) {
    console.log("One or more indexes could NOT be created due to existing data. Existing records were left untouched.");
    process.exit(1);
  }
  console.log("All indexes are present. No existing records were modified.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Index script failed:", err);
  process.exit(1);
});