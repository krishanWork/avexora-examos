#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getCV } from "./opencv-loader.mjs";
import { writePng } from "./png-writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clipU8 = (v) => Math.trunc(Math.max(0, Math.min(255, v)));

const parseMarks = (qAns) => {
  const marks = [];
  if (qAns === null || qAns === undefined) return marks;
  let items;
  if (Array.isArray(qAns)) items = qAns;
  else if (typeof qAns === "object") items = [qAns];
  else if (typeof qAns === "string" && qAns.trim()) items = qAns.split(",").map((x) => x.trim()).filter(Boolean);
  else items = [];

  for (const item of items) {
    if (item && typeof item === "object") {
      const opt = String(item.option ?? "").trim().toUpperCase();
      if (!opt) continue;
      let style = String(item.style ?? "full").toLowerCase();
      if (!["full", "light", "partial", "ghost"].includes(style)) style = "full";
      marks.push({
        option: opt,
        style,
        color: Number.isFinite(item.color) ? Math.trunc(item.color) : 25,
        radius_frac: Number.isFinite(item.radius_frac) ? item.radius_frac : 1.0,
        erased: Boolean(item.erased),
      });
    } else {
      const opt = String(item).trim().toUpperCase();
      if (opt) marks.push({ option: opt, style: "full", color: 25, radius_frac: 1.0, erased: false });
    }
  }
  return marks;
};

const createBaseCanvas = (cv, template) => {
  const { width, height, scale_px_per_mm: scale } = template.canvas;
  const img = new cv.Mat(height, width, cv.CV_8UC3, new cv.Scalar(255, 255, 255));

  const markers = template.alignment_markers.expected_bounding_box_px;
  for (const key of ["top_left", "top_right", "bottom_left", "bottom_right"]) {
    const [bx, by, bw, bh] = markers[key];
    cv.rectangle(img, new cv.Point(bx, by), new cv.Point(bx + bw, by + bh), new cv.Scalar(0, 0, 0), -1);
  }

  const yDiv = Math.trunc(35.0 * scale);
  cv.line(img, new cv.Point(Math.trunc(18 * scale), yDiv), new cv.Point(Math.trunc(192 * scale), yDiv), new cv.Scalar(59, 130, 246), Math.trunc(1.0 * scale));

  const yInfo = Math.trunc(39.0 * scale);
  const hInfo = Math.trunc(10.0 * scale);
  cv.rectangle(img, new cv.Point(Math.trunc(18 * scale), yInfo), new cv.Point(Math.trunc(192 * scale), yInfo + hInfo), new cv.Scalar(245, 246, 250), -1);
  cv.rectangle(img, new cv.Point(Math.trunc(18 * scale), yInfo), new cv.Point(Math.trunc(192 * scale), yInfo + hInfo), new cv.Scalar(180, 180, 180), 2);
  cv.putText(img, "Exam: Term Examination - Mathematics", new cv.Point(Math.trunc(21 * scale), yInfo + Math.trunc(6.5 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.7, new cv.Scalar(40, 40, 40), 2);

  const yCand = Math.trunc(51.0 * scale);
  const hCand = Math.trunc(48.0 * scale);

  cv.rectangle(img, new cv.Point(Math.trunc(18 * scale), yCand), new cv.Point(Math.trunc(122 * scale), yCand + Math.trunc(14 * scale)), new cv.Scalar(160, 160, 160), 2);
  cv.putText(img, "CANDIDATE NAME", new cv.Point(Math.trunc(20.5 * scale), yCand + Math.trunc(4.2 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(120, 120, 120), 1);

  cv.rectangle(img, new cv.Point(Math.trunc(18 * scale), yCand + Math.trunc(16.5 * scale)), new cv.Point(Math.trunc(68 * scale), yCand + Math.trunc(30.5 * scale)), new cv.Scalar(160, 160, 160), 2);
  cv.putText(img, "CLASS / SECTION", new cv.Point(Math.trunc(20.5 * scale), yCand + Math.trunc(20.7 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(120, 120, 120), 1);

  cv.rectangle(img, new cv.Point(Math.trunc(72 * scale), yCand + Math.trunc(16.5 * scale)), new cv.Point(Math.trunc(122 * scale), yCand + Math.trunc(30.5 * scale)), new cv.Scalar(160, 160, 160), 2);
  cv.putText(img, "ROLL NUMBER", new cv.Point(Math.trunc(74.5 * scale), yCand + Math.trunc(20.7 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(120, 120, 120), 1);

  cv.rectangle(img, new cv.Point(Math.trunc(18 * scale), yCand + Math.trunc(33.0 * scale)), new cv.Point(Math.trunc(68 * scale), yCand + hCand), new cv.Scalar(160, 160, 160), 2);
  cv.putText(img, "DATE", new cv.Point(Math.trunc(20.5 * scale), yCand + Math.trunc(37.2 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(120, 120, 120), 1);

  cv.rectangle(img, new cv.Point(Math.trunc(72 * scale), yCand + Math.trunc(33.0 * scale)), new cv.Point(Math.trunc(122 * scale), yCand + hCand), new cv.Scalar(160, 160, 160), 2);
  cv.putText(img, "SUBJECT", new cv.Point(Math.trunc(74.5 * scale), yCand + Math.trunc(37.2 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(120, 120, 120), 1);

  cv.rectangle(img, new cv.Point(Math.trunc(126 * scale), yCand), new cv.Point(Math.trunc(192 * scale), yCand + hCand), new cv.Scalar(150, 150, 150), 2);
  cv.rectangle(img, new cv.Point(Math.trunc(126 * scale), yCand), new cv.Point(Math.trunc(192 * scale), yCand + Math.trunc(6.0 * scale)), new cv.Scalar(245, 246, 250), -1);
  cv.putText(img, "ADMISSION NUMBER", new cv.Point(Math.trunc(142 * scale), yCand + Math.trunc(4.3 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(60, 60, 60), 1);

  cv.putText(img, "INSTRUCTIONS: Darken the circle completely with blue/black pen. Do not fold corner markers.", new cv.Point(Math.trunc(18 * scale), Math.trunc(102.5 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(100, 100, 100), 1);

  return img;
};

const drawMark = (cv, img, cx, cy, bubbleRPx, mark) => {
  const color = clipU8(mark.color);
  const fill = new cv.Scalar(color, color, color);
  const edgeV = Math.min(60, color + 8);
  const edge = new cv.Scalar(edgeV, edgeV, edgeV);
  if (mark.style === "light") {
    const r = Math.max(2, Math.trunc(bubbleRPx * Math.min(mark.radius_frac, 0.98)));
    cv.circle(img, new cv.Point(cx, cy), r, fill, -1);
    cv.circle(img, new cv.Point(cx, cy), r, edge, 1);
  } else if (mark.style === "partial") {
    const r = Math.max(2, Math.trunc(bubbleRPx * Math.min(mark.radius_frac, 0.6)));
    cv.circle(img, new cv.Point(cx, cy), r, fill, -1);
    cv.circle(img, new cv.Point(cx, cy), r, edge, 1);
  } else if (mark.style === "ghost") {
    const r = Math.max(2, Math.trunc(bubbleRPx * 0.6));
    cv.circle(img, new cv.Point(cx, cy), r, fill, -1);
    const er = Math.max(1, Math.trunc(bubbleRPx * 0.35));
    cv.circle(img, new cv.Point(cx + 2, cy + 1), er, new cv.Scalar(255, 255, 255), -1);
  } else {
    const r = Math.max(2, Math.trunc(bubbleRPx * mark.radius_frac) - 1);
    cv.circle(img, new cv.Point(cx, cy), r, fill, -1);
    cv.circle(img, new cv.Point(cx, cy), r + 1, edge, 2);
  }
  if (mark.erased) {
    const er = Math.max(1, Math.trunc(bubbleRPx * 0.5));
    cv.circle(img, new cv.Point(cx + 3, cy + 1), er, new cv.Scalar(255, 255, 255), -1);
  }
};

const drawGridAndBubbles = (cv, img, template, answers, numQuestions, admissionNumber) => {
  const grid = template.grid;
  const scale = template.canvas.scale_px_per_mm;

  const totalQ = numQuestions || grid.num_questions;
  const numCols = grid.num_cols;
  const rowsPerCol = grid.rows_per_col;
  const colWpx = Math.trunc(grid.col_width_mm * scale);
  const colXStart = grid.col_x_start_mm;
  const gridTop = grid.grid_top_mm;
  const headerH = grid.header_height_mm;
  const headerOffset = grid.header_offset_mm;
  const rowH = grid.row_height_mm;
  const bubbleOffsetX = grid.bubble_offset_x_mm;
  const bubbleGap = grid.bubble_gap_mm;
  const bubbleRPx = Math.trunc(grid.bubble_radius_mm * scale);
  const optionLabels = grid.option_labels;

  const bubbleCenters = {};

  for (let c = 0; c < numCols; c++) {
    const colStartQ = c * rowsPerCol;
    if (colStartQ >= totalQ) break;
    const count = Math.min(rowsPerCol, totalQ - colStartQ);
    const colXmm = colXStart + c * grid.col_width_mm;
    const colXpx = Math.trunc(colXmm * scale);
    const topYpx = Math.trunc(gridTop * scale);

    const headerHpx = Math.trunc(headerH * scale);
    cv.rectangle(img, new cv.Point(colXpx, topYpx), new cv.Point(colXpx + colWpx - Math.trunc(3 * scale), topYpx + Math.trunc(5.4 * scale)), new cv.Scalar(59, 130, 246), -1);
    cv.putText(img, "Q", new cv.Point(colXpx + Math.trunc(2.5 * scale), topYpx + Math.trunc(4.0 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(255, 255, 255), 2);
    for (let i = 0; i < optionLabels.length; i++) {
      const ox = Math.trunc((colXmm + bubbleOffsetX + i * bubbleGap) * scale);
      cv.putText(img, optionLabels[i], new cv.Point(ox - 7, topYpx + Math.trunc(4.0 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(255, 255, 255), 2);
    }

    const boxHpx = Math.trunc((headerH - 1.6 + count * rowH + 2) * scale);
    cv.rectangle(img, new cv.Point(colXpx, topYpx), new cv.Point(colXpx + colWpx - Math.trunc(3 * scale), topYpx + boxHpx), new cv.Scalar(220, 220, 220), 1);

    for (let r = 0; r < count; r++) {
      const qNum = colStartQ + r + 1;
      if (qNum > totalQ) break;
      const qYmm = gridTop + headerH + headerOffset + r * rowH;
      const qYpx = Math.trunc(qYmm * scale);

      cv.putText(img, String(qNum), new cv.Point(colXpx + Math.trunc(2.0 * scale), qYpx + Math.trunc(1.4 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(40, 40, 40), 1);

      bubbleCenters[String(qNum)] = {};
      const qAns = answers ? answers[String(qNum)] : undefined;
      const qMarks = parseMarks(qAns);
      const markedOptions = new Set(qMarks.map((m) => m.option));

      for (let i = 0; i < optionLabels.length; i++) {
        const opt = optionLabels[i];
        const cx = Math.trunc((colXmm + bubbleOffsetX + i * bubbleGap) * scale);
        const cy = qYpx;
        bubbleCenters[String(qNum)][opt] = [cx, cy];

        if (markedOptions.has(opt)) {
          for (const m of qMarks) {
            if (m.option === opt) drawMark(cv, img, cx, cy, bubbleRPx, m);
}

        } else {
          cv.circle(img, new cv.Point(cx, cy), bubbleRPx, new cv.Scalar(100, 100, 100), 2);
          cv.putText(img, opt, new cv.Point(cx - 6, cy + 5), cv.FONT_HERSHEY_SIMPLEX, 0.35, new cv.Scalar(150, 150, 150), 1);
        }
      }
    }
  }

  const idCfg = template.identity_grid;
  if (idCfg) {
    const idXStart = idCfg.x_start_mm ?? 139.0;
    const idYStart = idCfg.y_start_mm ?? 66.5;
    const idColGap = idCfg.col_gap_mm ?? 8.0;
    const idRowGap = idCfg.row_gap_mm ?? 3.2;
    const idBubbleRPx = Math.trunc((idCfg.bubble_radius_mm ?? 1.3) * scale);
    const numDigits = idCfg.num_digits ?? 6;
    const digits = idCfg.digits ?? ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

    let admStr = String(admissionNumber ?? "").trim();
    if (admStr && /^\d+$/.test(admStr)) {
      admStr = admStr.padStart(numDigits, "0").slice(-numDigits);
    }

    const digitBoxW = Math.trunc(6.0 * scale);
    const digitBoxH = Math.trunc(5.0 * scale);
    const digitBoxY = Math.trunc(58.5 * scale);

    for (let c = 0; c < numDigits; c++) {
      const cx = Math.trunc((idXStart + c * idColGap) * scale);
      const bx = cx - Math.trunc(digitBoxW / 2);
      cv.rectangle(img, new cv.Point(bx, digitBoxY), new cv.Point(bx + digitBoxW, digitBoxY + digitBoxH), new cv.Scalar(120, 120, 120), 1);
      const ch = c < admStr.length ? admStr[c] : "";
      if (ch) {
        cv.putText(img, ch, new cv.Point(cx - 5, digitBoxY + Math.trunc(3.8 * scale)), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(20, 20, 20), 1);
      }
    }

    for (let dIdx = 0; dIdx < digits.length; dIdx++) {
      const dLabel = digits[dIdx];
      const ry = Math.trunc((idYStart + dIdx * idRowGap) * scale);
      cv.putText(img, dLabel, new cv.Point(Math.trunc((idXStart - 7.0) * scale), ry + 4), cv.FONT_HERSHEY_SIMPLEX, 0.35, new cv.Scalar(100, 100, 100), 1);
      for (let c = 0; c < numDigits; c++) {
        const cx = Math.trunc((idXStart + c * idColGap) * scale);
        const isMarked = c < admStr.length && admStr[c] === dLabel;
        if (isMarked) {
          cv.circle(img, new cv.Point(cx, ry), idBubbleRPx - 1, new cv.Scalar(25, 25, 25), -1);
          cv.circle(img, new cv.Point(cx, ry), idBubbleRPx, new cv.Scalar(30, 30, 30), 2);
        } else {
          cv.circle(img, new cv.Point(cx, ry), idBubbleRPx, new cv.Scalar(100, 100, 100), 1);
          cv.putText(img, dLabel, new cv.Point(cx - 3, ry + 3), cv.FONT_HERSHEY_SIMPLEX, 0.25, new cv.Scalar(140, 140, 140), 1);
        }
      }
    }
  }

  return bubbleCenters;
};

const gaussianNoise = (cv, mat, sigma) => {
  const out = mat.clone();
  const { width, height } = { width: mat.cols, height: mat.rows };
  const total = width * height * 3;
  const data = out.data;
  for (let i = 0; i < total; i += 3) {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const dv = Math.trunc(z * sigma);
    data[i] = clipU8(data[i] + dv);
    data[i + 1] = clipU8(data[i + 1] + dv);
    data[i + 2] = clipU8(data[i + 2] + dv);
  }
  return out;
};

const applyDistortions = (cv, img, { rotation = 0.0, perspective = false, blur = 0, brightness = 1.0, noise = false } = {}) => {
  const h = img.rows;
  const w = img.cols;

  let cur = img;
  if (brightness !== 1.0) {
    const next = new cv.Mat(h, w, cv.CV_8UC3, new cv.Scalar(0, 0, 0));
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const idx = (r * w + c) * 3;
        next.data[idx] = clipU8(cur.data[idx] * brightness);
        next.data[idx + 1] = clipU8(cur.data[idx + 1] * brightness);
        next.data[idx + 2] = clipU8(cur.data[idx + 2] * brightness);
      }
    }
    if (cur !== img) cur.delete();
    cur = next;
  }

  if (Math.abs(rotation) > 0.01) {
    const M = cv.getRotationMatrix2D(new cv.Point(w / 2, h / 2), rotation, 1.0);
    const next = new cv.Mat();
    try {
      cv.warpAffine(cur, next, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255));
    } finally {
      M.delete();
    }
    if (cur !== img) cur.delete();
    cur = next;
  }

  if (perspective) {
    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [35, 25, w - 20, 45, w - 45, h - 30, 20, h - 20]);
    const M = cv.getPerspectiveTransform(srcMat, dstMat);
    const next = new cv.Mat();
    try {
      cv.warpPerspective(cur, next, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255));
    } finally {
      M.delete();
      srcMat.delete();
      dstMat.delete();
    }
    if (cur !== img) cur.delete();
    cur = next;
  }

  if (blur > 1) {
    const k = blur % 2 === 1 ? blur : blur + 1;
    const next = new cv.Mat();
    cv.GaussianBlur(cur, next, new cv.Size(k, k), 0);
    if (cur !== img) cur.delete();
    cur = next;
  }

  if (noise) {
    const next = gaussianNoise(cv, cur, 8);
    if (cur !== img) cur.delete();
    cur = next;
  }

  return cur;
};

export const generateOMR = async ({
  templatePath,
  outputPath,
  answers,
  numQuestions,
  admissionNumber,
  rotation = 0.0,
  perspective = false,
  blur = 0,
  brightness = 1.0,
  noise = false,
}) => {
  const cv = await getCV();
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const img = createBaseCanvas(cv, template);
  try {
    drawGridAndBubbles(cv, img, template, answers || null, numQuestions, admissionNumber);
    const final = applyDistortions(cv, img, { rotation, perspective, blur, brightness, noise });
    try {
      await writePng(cv, final, outputPath);
    } finally {
      if (final !== img) final.delete();
    }
    return outputPath;
  } finally {
    img.delete();
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const argv = process.argv.slice(2);
  const get = (flag, def) => {
    const i = argv.indexOf(flag);
    return i === -1 || i + 1 >= argv.length ? def : argv[i + 1];
  };
  const has = (flag) => argv.includes(flag);
  const output = get("--output", null);
  if (!output) {
    console.error("--output is required");
    process.exit(1);
  }
  const answersRaw = get("--answers", "{}");
  let answers = {};
  try {
    if (fs.existsSync(answersRaw)) answers = JSON.parse(fs.readFileSync(answersRaw, "utf8"));
    else answers = JSON.parse(answersRaw);
  } catch (e) {
    console.error("Invalid --answers:", e.message);
    process.exit(1);
  }
  const numQ = get("--questions", null);
  const templatePath = get("--template", path.join(__dirname, "templates", "a4_50q_4opt_v1.json"));
  const admissionNumber = get("--admission-number", "001002");
  const rotation = parseFloat(get("--rotation", "0") || "0");
  const blur = parseInt(get("--blur", "0") || "0", 10);
  const brightness = parseFloat(get("--brightness", "1") || "1");
  const perspective = has("--perspective");
  const noise = has("--noise");
  generateOMR({
    templatePath,
    outputPath: output,
    answers,
    numQuestions: numQ ? parseInt(numQ, 10) : undefined,
    admissionNumber,
    rotation,
    perspective,
    blur,
    brightness,
    noise,
  })
    .then((out) => console.log(JSON.stringify({ success: true, output_path: out, answers, admission_number: admissionNumber })))
    .catch((e) => {
      console.error(e.message || e);
      process.exit(1);
    });
}
