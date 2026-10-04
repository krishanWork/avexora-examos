// "Class 10" + "A" -> "Class 10A"
export const classLabel = (className, section) =>
  `${(className || "").trim()}${(section || "").trim()}`;

const norm = (v) => String(v || "").replace(/\s+/g, "").toLowerCase();

// Matches a student against exam class selections like "Class 10A" or plain "Class 10"
export const studentMatchesClasses = (student, classes) => {
  if (!classes?.length) return true;
  const combos = [student.class_name, classLabel(student.class_name, student.section)]
    .filter(Boolean)
    .map(norm);
  return classes.some((c) => combos.includes(norm(c)));
};