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

const drawAlignmentMarkers = (doc) => {
  doc.setFillColor(0, 0, 0);
  const s = 5;
  doc.rect(8, 8, s, s, "F");
  doc.rect(197, 8, s, s, "F");
  doc.rect(8, 284, s, s, "F");
  doc.rect(197, 284, s, s, "F");
};

// Draws one complete OMR sheet (possibly spanning multiple pages) into doc.
// When `student` is provided, their name/roll/class are pre-printed on the sheet.
function drawSheet(doc, { examination, tenant, paperSet, student, logoData, first }) {
  if (!first) doc.addPage();
  const numQuestions = examination.num_questions || 50;
  const optionsPerQuestion = examination.options_per_question || 4;
  const optionLabels = ["A", "B", "C", "D", "E"].slice(0, optionsPerQuestion);
  const [pr, pg, pb] = hexToRgb(tenant?.primary_color);
  const showPoweredBy = tenant?.powered_by_avexora !== false;

  // ---------- Header ----------
  drawAlignmentMarkers(doc);

  let textX = 18;
  if (logoData) {
    try {
      const fmt = logoData.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(logoData, fmt, 18, 15, 16, 16);
      textX = 38;
    } catch {
      textX = 18;
    }
  }

  doc.setTextColor(pr, pg, pb);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(tenant?.name || "Institution", textX, 21);
  doc.setTextColor(90, 90, 90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  if (tenant?.address) doc.text(tenant.address, textX, 26);
  const contact = [tenant?.contact_phone, tenant?.contact_email].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, textX, 30);

  // OMR label + paper set box (right)
  doc.setTextColor(40, 40, 40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("OMR ANSWER SHEET", 192, 19, { align: "right" });
  doc.setDrawColor(pr, pg, pb);
  doc.setLineWidth(0.6);
  doc.rect(178, 22, 14, 12);
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text("SET", 185, 25.5, { align: "center" });
  doc.setFontSize(13);
  doc.setTextColor(pr, pg, pb);
  doc.text(String(paperSet), 185, 31.5, { align: "center" });

  // Divider
  doc.setDrawColor(pr, pg, pb);
  doc.setLineWidth(1);
  doc.line(18, 35, 192, 35);

  // ---------- Exam info bar ----------
  doc.setLineWidth(0.3);
  doc.setDrawColor(180, 180, 180);
  doc.setFillColor(245, 246, 250);
  doc.rect(18, 39, 174, 10, "FD");
  doc.setFontSize(8.5);
  doc.setTextColor(40, 40, 40);
  doc.setFont("helvetica", "bold");
  doc.text(`Exam: ${examination.name}`, 21, 45.2);
  doc.setFont("helvetica", "normal");
  doc.text(`Subject: ${examination.subject}`, 100, 45.2);
  doc.text(`Class: ${examination.class_name || "-"}`, 140, 45.2);
  doc.text(`Max Marks: ${examination.max_marks}`, 168, 45.2);

  // ---------- Candidate details & Admission Number Block ----------
  // Start: y = 51mm, End: y = 99mm (Height: 48mm)
  const blockTop = 51;
  const blockHeight = 48;

  // Left side: Candidate Details (x: 18mm to 122mm, w: 104mm)
  // Row 1: Candidate Name
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.3);
  doc.rect(18, blockTop, 104, 14);
  doc.setFontSize(6);
  doc.setTextColor(110, 110, 110);
  doc.setFont("helvetica", "bold");
  doc.text("CANDIDATE NAME", 20.5, blockTop + 4.2);
  if (student?.full_name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(String(student.full_name).slice(0, 40), 21, blockTop + 10.2);
  }

  // Row 2: Class / Section & Roll Number
  doc.rect(18, blockTop + 16.5, 50, 14);
  doc.setFontSize(6);
  doc.setTextColor(110, 110, 110);
  doc.setFont("helvetica", "bold");
  doc.text("CLASS / SECTION", 20.5, blockTop + 20.7);
  const classSecStr = student ? `${student.class_name || ""} ${student.section || ""}`.trim() : "";
  if (classSecStr) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(classSecStr.slice(0, 22), 21, blockTop + 26.5);
  }

  doc.rect(72, blockTop + 16.5, 50, 14);
  doc.setFontSize(6);
  doc.setTextColor(110, 110, 110);
  doc.setFont("helvetica", "bold");
  doc.text("ROLL NUMBER", 74.5, blockTop + 20.7);
  if (student?.roll_number) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(String(student.roll_number).slice(0, 20), 75, blockTop + 26.5);
  }

  // Row 3: Date & Subject
  doc.rect(18, blockTop + 33, 50, 15);
  doc.setFontSize(6);
  doc.setTextColor(110, 110, 110);
  doc.setFont("helvetica", "bold");
  doc.text("DATE", 20.5, blockTop + 37.2);
  if (examination.exam_date) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(String(examination.exam_date), 21, blockTop + 43.5);
  }

  doc.rect(72, blockTop + 33, 50, 15);
  doc.setFontSize(6);
  doc.setTextColor(110, 110, 110);
  doc.setFont("helvetica", "bold");
  doc.text("SUBJECT", 74.5, blockTop + 37.2);
  if (examination.subject) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(String(examination.subject).slice(0, 22), 75, blockTop + 43.5);
  }

  // Right side: Admission Number Framed Box & Bubble Grid (x: 126mm to 192mm, w: 66mm, h: 48mm)
  const numDigits = tenant?.admission_number_num_digits || 6;
  const admFixedPrefix = tenant?.admission_number_fixed_prefix || "";
  const gridBoxX = 126;
  const gridBoxW = 66;

  // Outer container border
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.3);
  doc.rect(gridBoxX, blockTop, gridBoxW, blockHeight);

  // Header banner
  doc.setFillColor(245, 246, 250);
  doc.rect(gridBoxX, blockTop, gridBoxW, 6, "FD");
  doc.setFontSize(6.5);
  doc.setTextColor(50, 50, 50);
  doc.setFont("helvetica", "bold");
  doc.text(
    admFixedPrefix ? `ADMISSION NUMBER (${admFixedPrefix}...)` : "ADMISSION NUMBER",
    gridBoxX + gridBoxW / 2,
    blockTop + 4.3,
    { align: "center" }
  );

  // 6 Digit boxes & bubble columns
  // Centered columns: box width 6mm, pitch 8mm -> total span 46mm, centers at 139 + col*8
  const digitBoxW = 6.0;
  const digitBoxH = 5.0;
  const digitBoxY = blockTop + 7.5; // 58.5mm
  const admColGap = 8.0;
  const colCentersStart = 139.0;
  const bubbleGridTop = 66.5;
  const admRowGap = 3.2;
  const admBubbleR = 1.3;

  // Extract canonical digits zero-padded to numDigits
  let canonicalDigits = "";
  if (student?.admission_number) {
    let raw = String(student.admission_number).trim().toUpperCase();
    if (admFixedPrefix && raw.startsWith(admFixedPrefix.toUpperCase())) {
      raw = raw.slice(admFixedPrefix.length).trim();
    }
    // Zero-pad to numDigits if numeric
    if (/^\d+$/.test(raw)) {
      canonicalDigits = raw.padStart(numDigits, "0").slice(-numDigits);
    } else {
      canonicalDigits = raw.slice(0, numDigits);
    }
  }

  // Draw digit input boxes
  for (let col = 0; col < numDigits; col++) {
    const cx = colCentersStart + col * admColGap;
    const bx = cx - digitBoxW / 2;
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.25);
    doc.rect(bx, digitBoxY, digitBoxW, digitBoxH);

    const digitChar = canonicalDigits[col] || "";
    if (digitChar) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(20, 20, 20);
      doc.text(digitChar, cx, digitBoxY + 3.8, { align: "center" });
    }
  }

  // Draw bubble grid for digits 0 to 9
  for (let digit = 0; digit < 10; digit++) {
    const rowY = bubbleGridTop + digit * admRowGap;

    // Row digit label on the left
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.setTextColor(110, 110, 110);
    doc.text(String(digit), colCentersStart - 7.0, rowY + 1.0, { align: "center" });

    for (let col = 0; col < numDigits; col++) {
      const cx = colCentersStart + col * admColGap;

      // Outer bubble circle
      doc.setDrawColor(70, 70, 70);
      doc.setLineWidth(0.2);
      doc.circle(cx, rowY, admBubbleR);

      // Light digit label inside bubble
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4.0);
      doc.setTextColor(140, 140, 140);
      doc.text(String(digit), cx, rowY + 0.8, { align: "center" });

      // If pre-filled for student, darken the corresponding circle
      const digitChar = canonicalDigits[col] || "";
      if (digitChar && String(digit) === digitChar) {
        doc.setFillColor(30, 30, 30);
        doc.circle(cx, rowY, admBubbleR - 0.05, "F");
      }
    }
  }

  // ---------- Instructions ----------
  doc.setFontSize(6.8);
  doc.setTextColor(80, 80, 80);
  doc.setFont("helvetica", "bold");
  doc.text("INSTRUCTIONS:", 18, 102.5);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Use blue/black ball point pen only.  Darken the circle completely.  Do not make stray marks.  Do not fold or damage the corner markers.",
    39, 102.5
  );

  // ---------- Bubble grid ----------
  const gridTop = 106.0;
  const gridBottom = 274.0;
  const rowH = 6.4;
  const headerH = 7.0;
  const rowsPerCol = Math.floor((gridBottom - gridTop - headerH) / rowH); // 25 rows per column
  const numCols = 4;
  const colW = 174 / numCols;
  const perPage = rowsPerCol * numCols; // 100 questions per page
  const bubbleR = 2.1;
  const bubbleGap = 7.2;

  const drawColumnHeader = (x, y) => {
    doc.setFillColor(pr, pg, pb);
    doc.rect(x, y, colW - 3, 5.4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.text("Q", x + 4.5, y + 3.7, { align: "center" });
    optionLabels.forEach((label, i) => {
      doc.text(label, x + 11 + i * bubbleGap, y + 3.7, { align: "center" });
    });
  };

  const drawQuestionRow = (q, x, y) => {
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(String(q), x + 4.5, y + 1.4, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setDrawColor(70, 70, 70);
    doc.setLineWidth(0.25);
    optionLabels.forEach((label, i) => {
      const cx = x + 11 + i * bubbleGap;
      doc.circle(cx, y, bubbleR);
      doc.setTextColor(140, 140, 140);
      doc.text(label, cx, y + 0.8, { align: "center" });
    });
  };

  let page = 0;
  for (let start = 0; start < numQuestions; start += perPage) {
    if (page > 0) {
      doc.addPage();
      drawAlignmentMarkers(doc);
      doc.setTextColor(pr, pg, pb);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const contHeader = student
        ? `${student.full_name} (Roll ${student.roll_number || "-"}) — ${examination.name} (Set ${paperSet})`
        : `${tenant?.name || "Institution"} — ${examination.name} (Set ${paperSet})`;
      doc.text(contHeader, 105, 18, { align: "center" });
    }
    const top = page === 0 ? gridTop : 26;
    const rows = Math.floor((gridBottom - top - headerH) / rowH);
    const pageQuestions = Math.min(perPage, numQuestions - start);

    for (let c = 0; c < numCols; c++) {
      const colStart = start + c * rows;
      if (colStart >= start + pageQuestions) break;
      const x = 18 + c * colW;
      drawColumnHeader(x, top);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      const count = Math.min(rows, start + pageQuestions - colStart);
      doc.rect(x, top, colW - 3, headerH - 1.6 + count * rowH + 2);
      for (let r = 0; r < count; r++) {
        const q = colStart + r + 1;
        if (q > numQuestions) break;
        drawQuestionRow(q, x, top + headerH + 2 + r * rowH);
      }
    }
    page++;
  }

  // ---------- Footer ----------
  doc.setFontSize(6.5);
  doc.setTextColor(150, 150, 150);
  const footerParts = [`Sheet ID: ${(examination.id || "").slice(-8).toUpperCase()}`, `Paper Set ${paperSet}`];
  if (student) footerParts.push(`Roll: ${student.roll_number || "-"}`, student.full_name);
  doc.text(footerParts.join("  ·  "), 18, 280);
  if (showPoweredBy) {
    doc.text("Powered by Avexora ExamOS", 192, 280, { align: "right" });
  }
}

// Single blank (or personalized) sheet
export async function generateOMRSheetPDF({ examination, tenant, paperSet = "A", student = null }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const logoData = tenant?.logo_url ? await loadImageDataUrl(tenant.logo_url) : null;
  drawSheet(doc, { examination, tenant, paperSet, student, logoData, first: true });
  return doc.output("bloburl");
}

// One personalized sheet per student, in a single printable PDF
export async function generateBulkOMRSheetsPDF({ examination, tenant, paperSet = "A", students }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const logoData = tenant?.logo_url ? await loadImageDataUrl(tenant.logo_url) : null;
  students.forEach((student, i) => {
    drawSheet(doc, { examination, tenant, paperSet, student, logoData, first: i === 0 });
  });
  return doc.output("bloburl");
}