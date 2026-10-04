import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { deriveEnrolledStudents, matchesQuery } from "../examRosterService.js";

const TENANT = "507f1f77bcf86cd799439011";
const YEAR = "507f1f77bcf86cd7994390aa";

// In-memory stand-in for the Mongo client: implements the exact query
// shapes deriveEnrolledStudents issues, via the exported matcher.
const makeDb = ({ schoolClasses = [], sections = [], enrollments = [], students = [] }) => ({
  collection(name) {
    if (name === "SchoolClass") {
      return { find: (q) => ({ toArray: async () => schoolClasses.filter((d) => matchesQuery(d, q)) }) };
    }
    if (name === "Section") {
      return { find: (q) => ({ toArray: async () => sections.filter((d) => matchesQuery(d, q)) }) };
    }
    if (name === "Enrollment") {
      return { find: (q) => ({ toArray: async () => enrollments.filter((d) => matchesQuery(d, q)) }) };
    }
    if (name === "Student") {
      return {
        find: (q) => ({ toArray: async () => students.filter((d) => matchesQuery(d, q)) }),
        countDocuments: async (q) => students.filter((d) => matchesQuery(d, q)).length,
      };
    }
    return { find: () => ({ toArray: async () => [] }), findOne: async () => null, countDocuments: async () => 0 };
  },
});

const exam = (school_class_ids, section_ids = []) => ({
  tenant_id: TENANT,
  academic_year_id: YEAR,
  school_class_ids,
  section_ids,
});

const student = (overrides = {}) => ({
  _id: new ObjectId(),
  tenant_id: TENANT,
  full_name: "Aarav Patel",
  admission_number: "ADM-1",
  status: "active",
  ...overrides,
});

test("a legacy student with only class_name is rostered via the name fallback", async () => {
  const classId = new ObjectId().toString();
  const legacy = student({ class_name: "Class 10" }); // no school_class_id
  const database = makeDb({
    schoolClasses: [{ _id: new ObjectId(classId), tenant_id: TENANT, name: "Class 10" }],
    students: [legacy],
  });

  const { students, stats } = await deriveEnrolledStudents({ db: database, exam: exam([classId]) });

  assert.equal(students.length, 1);
  assert.equal(students[0].student_id, legacy._id.toString());
  assert.equal(students[0].school_class_id, classId);
  assert.equal(stats.placement, 1);
  assert.equal(stats.enrollment, 0);
  assert.equal(stats.unlinked, 1);
});

test("a student with only a section name is rostered when that section is selected", async () => {
  const classId = new ObjectId().toString();
  const sectionId = new ObjectId().toString();
  const legacy = student({ school_class_id: classId, class_name: "Class 10", section: "A" }); // no section_id
  const database = makeDb({
    schoolClasses: [{ _id: new ObjectId(classId), tenant_id: TENANT, name: "Class 10" }],
    sections: [{ _id: new ObjectId(sectionId), tenant_id: TENANT, school_class_id: classId, name: "A" }],
    students: [legacy],
  });

  const { students, stats } = await deriveEnrolledStudents({ db: database, exam: exam([classId], [sectionId]) });

  assert.equal(students.length, 1);
  assert.equal(students[0].section_id, sectionId);
  assert.equal(stats.placement, 1);
});

test("archived students are excluded and students with no status are kept", async () => {
  const classId = new ObjectId().toString();
  const archived = student({ school_class_id: classId, full_name: "Archived", status: "archived" });
  const noStatus = student({ school_class_id: classId, full_name: "No Status" });
  const active = student({ school_class_id: classId, full_name: "Active" });
  const database = makeDb({
    schoolClasses: [{ _id: new ObjectId(classId), tenant_id: TENANT, name: "Class 10" }],
    students: [archived, noStatus, active],
  });

  const { students } = await deriveEnrolledStudents({ db: database, exam: exam([classId]) });

  assert.deepEqual(
    students.map((s) => s.full_name).sort(),
    ["Active", "No Status"]
  );
});

test("an enrolled student placed in another in-scope class is counted once, with enrollment precedence", async () => {
  const classA = new ObjectId().toString();
  const classB = new ObjectId().toString();
  const enrolled = student({ school_class_id: classB });
  const database = makeDb({
    schoolClasses: [
      { _id: new ObjectId(classA), tenant_id: TENANT, name: "Class A" },
      { _id: new ObjectId(classB), tenant_id: TENANT, name: "Class B" },
    ],
    enrollments: [{ tenant_id: TENANT, student_id: enrolled._id.toString(), academic_year_id: YEAR, school_class_id: classA, section_id: null, status: "enrolled" }],
    students: [enrolled],
  });

  const { students, stats } = await deriveEnrolledStudents({ db: database, exam: exam([classA, classB]) });

  assert.equal(students.length, 1);
  assert.equal(students[0].source, "enrollment");
  assert.equal(students[0].school_class_id, classA);
  assert.equal(stats.enrollment, 1);
  assert.equal(stats.placement, 0);
});

test("enrollment wins for a covered class: a name-only student in that class is unlinked, not rostered", async () => {
  const classId = new ObjectId().toString();
  const enrolled = student({ school_class_id: classId });
  const legacy = student({ class_name: "Class 10" }); // no school_class_id
  const database = makeDb({
    schoolClasses: [{ _id: new ObjectId(classId), tenant_id: TENANT, name: "Class 10" }],
    enrollments: [{ tenant_id: TENANT, student_id: enrolled._id.toString(), academic_year_id: YEAR, school_class_id: classId, section_id: null, status: "enrolled" }],
    students: [enrolled, legacy],
  });

  const { students, stats } = await deriveEnrolledStudents({ db: database, exam: exam([classId]) });

  assert.equal(students.length, 1);
  assert.equal(students[0].student_id, enrolled._id.toString());
  assert.equal(stats.unlinked, 1);
});

test("an exam with no classes or year derives an empty roster", async () => {
  const database = makeDb({});
  const { students, stats } = await deriveEnrolledStudents({
    db: database,
    exam: { tenant_id: TENANT, academic_year_id: null, school_class_ids: [], section_ids: [] },
  });
  assert.deepEqual(students, []);
  assert.deepEqual(stats, { enrollment: 0, placement: 0, unlinked: 0 });
});

test("a withdrawn enrollment does not cover its class, so placement applies", async () => {
  const classId = new ObjectId().toString();
  const placed = student({ school_class_id: classId });
  const database = makeDb({
    schoolClasses: [{ _id: new ObjectId(classId), tenant_id: TENANT, name: "Class 10" }],
    enrollments: [{ tenant_id: TENANT, student_id: new ObjectId().toString(), academic_year_id: YEAR, school_class_id: classId, section_id: null, status: "withdrawn" }],
    students: [placed],
  });

  const { students, stats } = await deriveEnrolledStudents({ db: database, exam: exam([classId]) });

  assert.equal(students.length, 1);
  assert.equal(students[0].source, "placement");
  assert.equal(stats.placement, 1);
});
