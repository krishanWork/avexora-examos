// Phase 0 CRM relationship authorization.  This module deliberately knows
// only stable IDs; display names are never used to grant access.
//
// The privileged set is the shared EXAM_WORKFLOW_ROLES membership: a role that
// can see every student in the institution can administer a relationship. It is
// re-exported from rbac.js rather than restated, because this copy is exactly
// what silently drifted from the write matrix during the original audit.
import { APP_ROLES, EXAM_WORKFLOW_ROLES, appRolesOf, primaryAppRole } from "./rbac.js";
export const PRIVILEGED_TENANT_ROLES = EXAM_WORKFLOW_ROLES;
// teacher/student/parent: everyone whose relationship access is limited to their
// own records. Built from the shared role constants so a new role cannot be added
// to one copy of the list and missed by the other.
export const CRM_SCOPED_ROLES = new Set([
  APP_ROLES.TEACHER,
  APP_ROLES.STUDENT,
  APP_ROLES.PARENT,
]);

const uniqueStrings = (value) => [...new Set((Array.isArray(value) ? value : []).filter((v) => typeof v === "string" && v))];

export const studentIdsForUser = (user) => {
  // Union over held family roles: a parent who is also a student is linked to
  // both, and `ownStudentIds` is the set of records this account legitimately
  // owns. Only ever the caller's own household — this is not a widening.
  const roles = appRolesOf(user);
  const ids = [];
  if (roles.includes(APP_ROLES.STUDENT)) {
    const id = user?.linked_student_id || (Array.isArray(user?.linked_student_ids) ? user.linked_student_ids[0] : null);
    if (id) ids.push(id);
  }
  if (roles.includes(APP_ROLES.PARENT)) {
    if (Array.isArray(user?.linked_student_ids)) ids.push(...user.linked_student_ids);
    else if (user?.linked_student_id) ids.push(user.linked_student_id);
  }
  return uniqueStrings(ids);
};

export const teacherAssignmentIsValid = (teacher, user, assignments = []) =>
  Boolean(
    teacher &&
      user &&
      (teacher.user_id === String(user._id) ||
        (teacher.email && user.email && teacher.email.toLowerCase().trim() === user.email.toLowerCase().trim())) &&
      teacher.tenant_id === user.tenant_id &&
      ((Array.isArray(teacher.assigned_class_ids) && teacher.assigned_class_ids.length > 0) ||
        (Array.isArray(assignments) && assignments.length > 0))
  );

export const idsCriterion = (field, ids) => ({ [field]: { $in: uniqueStrings(ids).length ? uniqueStrings(ids) : ["__none__"] } });

// Small pure policy used by the server and the regression tests.  A missing
// relationship is always false: this is the important fail-closed invariant.
//
// Accepts either a single `role` (the legacy shape, still used by the
// regression tests) or a `roles` array. The two rules are the same as everywhere
// else in the codebase: privilege and family ownership are answered by the UNION
// of held roles, while the teacher branch — which narrows to assigned classes —
// is reached only by an account whose PRIMARY role is teacher. A teacher who is
// also an exam coordinator clears the privileged branch first and is never held
// to the class ceiling of the teaching job they also do.
export const canAccess = ({ role, roles, entity, ownStudentIds = [], teacherClassIds = [], studentClassId = null, record = {} }) => {
  const held = appRolesOf(roles ?? role);
  const isFamily = held.some((heldRole) => heldRole === APP_ROLES.STUDENT || heldRole === APP_ROLES.PARENT);

  if (held.some((heldRole) => PRIVILEGED_TENANT_ROLES.has(heldRole))) return true;
  if (isFamily) {
    if (!ownStudentIds.length) return false;
    if (entity === "Student") return ownStudentIds.map(String).includes(String(record.id || record._id));
    if (entity === "Enrollment") return ownStudentIds.map(String).includes(String(record.student_id));
    if (entity === "ParentStudent") return ownStudentIds.map(String).includes(String(record.student_id));
    if (entity === "Parent") return held.includes(APP_ROLES.PARENT) && Boolean(record.id || record._id);
    if (["Result", "OMRSheet"].includes(entity)) return ownStudentIds.map(String).includes(String(record.student_id));
    if (entity === "AcademicYear" || entity === "Subject") return true;
    if (entity === "SchoolClass") {
      if (studentClassId && String(record.id || record._id) === String(studentClassId)) return true;
      if (Array.isArray(record.own_class_ids) && record.own_class_ids.map(String).includes(String(record.id || record._id))) return true;
      return false;
    }
    if (entity === "Section") {
      if (studentClassId && String(record.school_class_id) === String(studentClassId)) return true;
      if (Array.isArray(record.own_class_ids) && record.own_class_ids.map(String).includes(String(record.school_class_id))) return true;
      return false;
    }
    if (entity === "TeacherAssignment") {
      if (studentClassId && String(record.school_class_id) === String(studentClassId)) return true;
      if (Array.isArray(record.own_class_ids) && record.own_class_ids.map(String).includes(String(record.school_class_id))) return true;
      return false;
    }
    if (entity === "Examination") {
      if (record.status !== "published") return false;
      const examClasses = (Array.isArray(record.school_class_ids) ? record.school_class_ids : []).map(String);
      if (studentClassId && examClasses.includes(String(studentClassId))) return true;
      if (Array.isArray(record.own_class_ids) && examClasses.some((id) => record.own_class_ids.map(String).includes(id))) return true;
      return false;
    }
    if (entity === "Attendance") {
      return ownStudentIds.map(String).includes(String(record.student_id));
    }
    if (entity === "Assignment") {
      if (record.status && record.status !== "published") return false;
      if (studentClassId && String(record.school_class_id) === String(studentClassId)) return true;
      if (Array.isArray(record.own_class_ids) && record.own_class_ids.map(String).includes(String(record.school_class_id))) return true;
      return false;
    }
    if (entity === "AssignmentSubmission") {
      return ownStudentIds.map(String).includes(String(record.student_id));
    }
    return false;
  }
  if (primaryAppRole({ app_roles: held }) === APP_ROLES.TEACHER) {
    if (entity === "Teacher") return Boolean(record.id || record._id);
    if (!teacherClassIds.length) return false;
    if (entity === "Student") return teacherClassIds.map(String).includes(String(record.school_class_id));
    if (entity === "Enrollment") return teacherClassIds.map(String).includes(String(record.school_class_id));
    if (entity === "TeacherAssignment") {
      return (
        teacherClassIds.map(String).includes(String(record.school_class_id)) ||
        (record.teacher_id && record.own_teacher_id && String(record.teacher_id) === String(record.own_teacher_id))
      );
    }
    if (["Result", "OMRSheet"].includes(entity)) return teacherClassIds.map(String).includes(String(record.school_class_id));
    if (entity === "Examination") return Array.isArray(record.school_class_ids) && record.school_class_ids.some((id) => teacherClassIds.map(String).includes(String(id)));
    if (entity === "SchoolClass") return teacherClassIds.map(String).includes(String(record.id || record._id));
    if (entity === "Section") return teacherClassIds.map(String).includes(String(record.school_class_id));
    if (entity === "AcademicYear" || entity === "Subject") return true;
    if (entity === "Attendance") {
      return teacherClassIds.map(String).includes(String(record.school_class_id));
    }
    if (entity === "Assignment") {
      return Boolean(
        teacherClassIds.map(String).includes(String(record.school_class_id)) ||
        (record.teacher_id && record.own_teacher_id && String(record.teacher_id) === String(record.own_teacher_id))
      );
    }
    if (entity === "AssignmentSubmission") {
      return Boolean(
        teacherClassIds.map(String).includes(String(record.school_class_id)) ||
        (record.teacher_id && record.own_teacher_id && String(record.teacher_id) === String(record.own_teacher_id))
      );
    }
    return false;
  }
  return false;
};

