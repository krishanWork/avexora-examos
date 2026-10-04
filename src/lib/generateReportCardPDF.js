import { jsPDF } from "jspdf";

const hexToRgb = (hex, fallback = [59, 130, 246]) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : fallback;
};

async function loadImageDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateReportCardPDF({ tenant, student, results }) {
  const doc = new jsPDF();
  const [pr, pg, pb] = hexToRgb(tenant?.primary_color);

  // ---------- Branded header ----------
  const logoData = tenant?.logo_url ? await loadImageDataUrl(tenant.logo_url) : null;
  let textX = 105;
  let align = "center";
  if (logoData) {
    try {
      const fmt = logoData.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(logoData, fmt, 14, 12, 18, 18);
      textX = 38;
      align = "left";
    } catch { /* keep centered */ }
  }

  doc.setTextColor(pr, pg, pb);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(tenant?.name || "Institution", textX, 19, { align });
  doc.setTextColor(100, 100, 100);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  if (tenant?.address) doc.text(tenant.address, textX, 24.5, { align });
  const contact = [tenant?.contact_phone, tenant?.contact_email].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, textX, 29, { align });

  doc.setDrawColor(pr, pg, pb);
  doc.setLineWidth(0.8);
  doc.line(14, 34, 196, 34);

  // ---------- Title ----------
  doc.setTextColor(40, 40, 40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("REPORT CARD", 105, 43, { align: "center" });

  // ---------- Student details ----------
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.setFillColor(246, 247, 250);
  doc.rect(14, 48, 182, 16, "FD");
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.text(`Name: ${student.full_name}`, 18, 54.5);
  doc.text(`Class: ${student.class_name || "-"} ${student.section || ""}`, 18, 60.5);
  doc.text(`Admission No: ${student.admission_number || "-"}`, 120, 54.5);
  doc.text(`Roll No: ${student.roll_number || "-"}`, 120, 60.5);

  // ---------- Results table ----------
  let y = 74;
  doc.setFillColor(pr, pg, pb);
  doc.rect(14, y - 5, 182, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Exam", 18, y);
  doc.text("Marks", 74, y);
  doc.text("%", 90, y);
  doc.text("Change", 103, y);
  doc.text("Grade", 122, y);
  doc.text("Correct", 138, y);
  doc.text("Wrong", 154, y);
  doc.text("Skipped", 169, y);
  doc.text("Rank", 186, y);
  y += 9;

  doc.setTextColor(40, 40, 40);
  doc.setFont("helvetica", "normal");
  // results are newest-first: previous exam of row i is row i+1
  results.forEach((r, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(246, 247, 250);
      doc.rect(14, y - 5, 182, 7.5, "F");
    }
    const prev = results[i + 1];
    const pctDelta = prev?.percentage != null && r.percentage != null ? +(r.percentage - prev.percentage).toFixed(1) : null;
    doc.text(String(r.examName || "-").slice(0, 28), 18, y);
    doc.text(String(r.total_marks ?? "-"), 74, y);
    doc.text(r.percentage != null ? `${r.percentage.toFixed(1)}%` : "-", 90, y);
    if (pctDelta != null) {
      if (pctDelta >= 0) doc.setTextColor(5, 150, 105);
      else doc.setTextColor(220, 38, 38);
      doc.text(`${pctDelta >= 0 ? "+" : ""}${pctDelta}%`, 103, y);
      doc.setTextColor(40, 40, 40);
    } else {
      doc.text("-", 103, y);
    }
    doc.text(String(r.grade || "-"), 122, y);
    doc.text(String(r.correct_count ?? "-"), 138, y);
    doc.text(String(r.wrong_count ?? "-"), 154, y);
    doc.text(String(r.skipped_count ?? "-"), 169, y);
    doc.text(r.rank != null ? `#${r.rank}` : "-", 186, y);
    y += 7.5;
  });

  // ---------- Growth summary: latest vs previous exam ----------
  if (results.length >= 2 && results[0].percentage != null && results[1].percentage != null) {
    const latest = results[0];
    const prev = results[1];
    const pctDelta = +(latest.percentage - prev.percentage).toFixed(1);
    const marksDelta = latest.total_marks != null && prev.total_marks != null ? +(latest.total_marks - prev.total_marks).toFixed(1) : null;
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text("Growth Summary", 18, y);
    y += 6;
    doc.setFontSize(9);
    if (pctDelta >= 0) doc.setTextColor(5, 150, 105);
    else doc.setTextColor(220, 38, 38);
    const marksPart = marksDelta != null ? `${marksDelta >= 0 ? "+" : ""}${marksDelta} marks, ` : "";
    doc.text(`Latest (${String(latest.examName || "-").slice(0, 30)}) vs previous (${String(prev.examName || "-").slice(0, 30)}): ${marksPart}${pctDelta >= 0 ? "+" : ""}${pctDelta}%`, 18, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(pctDelta >= 0 ? "The student has improved compared to the previous exam. Keep it up!" : "Performance dipped compared to the previous exam. Extra practice recommended.", 18, y);
  }

  // ---------- Footer ----------
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated on ${new Date().toLocaleDateString("en-IN")}`, 14, 290);
  if (tenant?.powered_by_avexora !== false) {
    doc.text("Powered by Avexora ExamOS", 196, 290, { align: "right" });
  }

  return doc.output("bloburl");
}