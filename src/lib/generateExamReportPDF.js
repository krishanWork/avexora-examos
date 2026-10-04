import { jsPDF } from "jspdf";

// Generates a question-wise detailed report PDF for a single exam result.
export function generateExamReportPDF({ tenant, exam, result, rows, previousResult, studentName }) {
  const doc = new jsPDF();
  let y = 18;

  if (tenant?.name) {
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text(tenant.name, 14, y);
    y += 5;
    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    if (tenant.address) { doc.text(tenant.address, 14, y); y += 4; }
    doc.line(14, y, 196, y);
    y += 8;
  }

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text(`${exam.name} — Detailed Report`, 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  if (studentName) { doc.text(`Student: ${studentName}`, 14, y); y += 6; }
  doc.text(`Subject: ${exam.subject || "-"}   Date: ${exam.exam_date || "-"}   Max Marks: ${exam.max_marks}`, 14, y);
  y += 6;
  const correctCount = result.correct_count ?? result.correct_answers ?? (rows?.length ? rows.filter((r) => r.status === "correct").length : "-");
  const wrongCount = result.wrong_count ?? result.incorrect_answers ?? (rows?.length ? rows.filter((r) => r.status === "wrong").length : "-");
  const skippedCount = result.skipped_count ?? result.unattempted ?? (rows?.length ? rows.filter((r) => r.status === "skipped").length : "-");
  doc.text(`Score: ${result.total_marks} / ${exam.max_marks} (${result.percentage?.toFixed(1)}%)   Grade: ${result.grade || "-"}   Rank: ${result.rank != null ? `#${result.rank}` : "-"}`, 14, y);
  y += 6;
  doc.text(`Correct: ${correctCount}   Wrong: ${wrongCount}   Not Answered: ${skippedCount}`, 14, y);
  y += 6;

  if (previousResult?.percentage != null && result.percentage != null) {
    const delta = +(result.percentage - previousResult.percentage).toFixed(1);
    doc.text(`Improvement vs last exam (${previousResult.examName || "previous"}): ${delta >= 0 ? "+" : ""}${delta}%`, 14, y);
    y += 6;
  }

  y += 4;
  doc.setFont(undefined, "bold");
  doc.text("Q", 14, y);
  doc.text("Your Answer", 30, y);
  doc.text("Correct Answer", 70, y);
  doc.text("Status", 115, y);
  doc.text("Marks", 165, y);
  y += 2;
  doc.line(14, y, 196, y);
  y += 5;
  doc.setFont(undefined, "normal");

  const statusLabel = { correct: "Correct", wrong: "Wrong", skipped: "Not Answered" };
  for (const r of rows) {
    if (y > 280) { doc.addPage(); y = 18; }
    doc.text(String(r.q), 14, y);
    doc.text(r.given || "-", 30, y);
    doc.text(r.correct || "-", 70, y);
    doc.text(statusLabel[r.status] + (r.isFlagged ? " (unclear marking)" : ""), 115, y);
    doc.text(`${r.marks > 0 ? "+" : ""}${+r.marks.toFixed(2)}`, 165, y);
    y += 6;
  }

  if (tenant?.powered_by_avexora !== false) {
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text("Powered by Avexora ExamOS", 196, 290, { align: "right" });
  }

  const blob = doc.output("blob");
  return URL.createObjectURL(blob);
}