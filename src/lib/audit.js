import { appClient } from "@/api/appClient";

// Entities that are already authoritatively audited by the server on mutation (SEC-02).
// Client-side calls for these entities are skipped to avoid redundant network requests
// and "Audit event not permitted" errors.
//
// "User" is here because every account mutation is server-audited at its single
// source: provisioning (USER_PROVISIONED), role assignment (assign_role,
// assignUserRole) and self-deletion (delete_own_account). The client-side
// `invite:User` / `assign_role:User` calls this replaces were never in the
// server's CLIENT_AUDIT_EVENTS allowlist, so they only ever produced a 400 that
// was swallowed — a false impression of an audit trail.
const SERVER_AUDITED_ENTITIES = new Set([
  "AcademicYear", "AnswerKey", "Assignment", "AssignmentSubmission", "Attendance",
  "Enrollment", "Examination", "OMRSheet", "Parent",
  "ParentStudent", "Result", "Section", "Student", "TeacherAssignment", "Tenant",
  "User",
]);

export async function logAudit({ user, tenant_id, action, entity_type, entity_id, details }) {
  if (!entity_type || SERVER_AUDITED_ENTITIES.has(entity_type)) {
    return;
  }
  try {
    await appClient.functions.invoke("logAudit", {
      action,
      entity_type,
      entity_id: entity_id || "",
      details: details || "",
    });
  } catch (e) {
    // Audit logging should never block the primary action
    console.error("Audit log failed", e);
  }
}