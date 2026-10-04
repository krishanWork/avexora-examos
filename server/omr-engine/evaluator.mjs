import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { getCV } from "./opencv-loader.mjs";
import { writePng } from "./png-writer.mjs";

const ENGINE_VERSION = "1.3.0-js-wasm";

const logErr = (msg) => {
  process.stderr.write(`[OMR-CV] ${msg}\n`);
};

// ---------------------------------------------------------------------------
// ROI & classification constants (deterministic, documented in README)
// ---------------------------------------------------------------------------
const DEFAULT_ROI_INNER_FRACTION = 0.4;
const DEFAULT_ROI_OUTER_FRACTION = 0.88;

const CONF_CONFIDENT_BASE = 0.55;
const CONF_CONFIDENT_FILL_W = 0.3;
const CONF_CONFIDENT_MARGIN_W = 0.1;
const CONF_CONFIDENT_QUALITY_W = 0.05;
const CONF_CONFIDENT_CAP = 0.99;
const CONF_BLANK_BASE = 0.6;
const CONF_BLANK_FILL_W = 0.35;
const CONF_BLANK_CAP = 0.95;
const CONF_REVIEW_BASE = 0.3;
const CONF_REVIEW_MARGIN_W = 0.35;
const CONF_REVIEW_CAP = 0.6;
const CONF_MULTIPLE = 0.25;

const QUALITY_LAP_MIN = 15.0;
const QUALITY_LAP_MAX = 300.0;

const clipf = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Mirrors Python's round(x, ndigits) far away from exact decimal ties.
const pyRound = (x, nd = 0) => {
  if (!Number.isFinite(x)) return x;
  const factor = 10 ** nd;
  const scaled = x * factor;
  const fl = Math.floor(scaled);
  const frac = scaled - fl;
  let r;
  if (frac > 0.5) r = fl + 1;
  else if (frac < 0.5) r = fl;
  else r = fl % 2 === 0 ? fl : fl + 1;
  return r / factor;
};

function failBg(code, message, extra) {
  return {
    status: "failed",
    engine: "opencv",
    engine_impl: "js-wasm",
    engine_version: ENGINE_VERSION,
    error_code: code,
    error_message: message,
    ...extra,
  };
}

const dispose = (...mats) => {
  for (const m of mats) {
    if (m && !m.isDeleted && !m.isDeleted()) {
      try {
        m.delete();
      } catch {
        /* double free */
      }
    }
  }
};

const qualityCheck = (cv, first) => {
  const h = first.rows;
  const w = first.cols;
  if (h < 600 || w < 400) {
    return { error_code: "IMAGE_TOO_SMALL", error_message: `Resolution too low (${w}x${h}, minimum 400x600 required)` };
  }

  const gray = new cv.Mat();
  try {
    cv.cvtColor(first, gray, cv.COLOR_BGR2GRAY);

    const lap = new cv.Mat();
    const meanOut = new cv.Mat(1, 4, cv.CV_64F);
    const stdOut = new cv.Mat(1, 4, cv.CV_64F);
    try {
      cv.Laplacian(gray, lap, cv.CV_64F, 1, 1, 0, cv.BORDER_DEFAULT);
      cv.meanStdDev(lap, meanOut, stdOut);
      const lapVar = stdOut.data64F[0] ** 2;
      if (lapVar < 15.0) logErr(`Warning: Low image sharpness detected (Laplacian var: ${lapVar.toFixed(1)})`);
    } finally {
      dispose(lap, meanOut, stdOut);
    }

    const n = w * h;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += gray.data[i];
    const meanVal = sum / n;
    if (meanVal < 25) return { error_code: "IMAGE_TOO_DARK", error_message: `Image is severely underexposed (mean brightness: ${meanVal.toFixed(1)})` };
    if (meanVal > 254.5) return { error_code: "IMAGE_OVEREXPOSED", error_message: `Image is completely blank white (mean brightness: ${meanVal.toFixed(1)})` };
    return { error_code: null, error_message: null };
  } finally {
    dispose(gray);
  }
};

const setupPdfGlobals = async () => {
  const canvasMod = await import("@napi-rs/canvas");
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = canvasMod.DOMMatrix;
  if (!globalThis.Path2D) globalThis.Path2D = canvasMod.Path2D;
  if (!globalThis.ImageData) globalThis.ImageData = canvasMod.ImageData;
  if (!globalThis.CanvasGradient) globalThis.CanvasGradient = canvasMod.CanvasGradient;
  if (!globalThis.CanvasPattern) globalThis.CanvasPattern = canvasMod.CanvasPattern;
  return canvasMod;
};

const rgbaToBgr = (cv, width, height, rgba) => {
  const src = cv.matFromImageData({ width, height, data: rgba });
  const bgr = new cv.Mat();
  try {
    cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
  } finally {
    src.delete();
  }
  return bgr;
};

const loadPages = async (cv, imagePath) => {
  if (!fs.existsSync(imagePath)) {
    return { pages: null, error_code: "IMAGE_NOT_FOUND", error_message: `File does not exist: ${imagePath}` };
  }
  if (fs.statSync(imagePath).size < 1000) {
    return { pages: null, error_code: "IMAGE_TOO_SMALL", error_message: "File size too small (< 1KB)" };
  }

  let pages = null;
  if (imagePath.toLowerCase().endsWith(".pdf")) {
    try {
      const canvasMod = await setupPdfGlobals();
      // pdf.js loads its worker through a runtime `import(this.workerSrc)`, which node-file-trace
      // cannot resolve, so pdf.worker.mjs never reaches the serverless function bundle. Importing
      // it here with a literal specifier makes it traceable, and publishing globalThis.pdfjsWorker
      // makes pdf.js short-circuit its own dynamic import (PDFWorker._setupFakeWorkerGlobal).
      const { WorkerMessageHandler } = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      globalThis.pdfjsWorker = { WorkerMessageHandler };
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(fs.readFileSync(imagePath)),
      }).promise;
      try {
        const { createCanvas } = canvasMod;
        pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 200 / 72 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx, viewport }).promise;
          const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          pages.push(rgbaToBgr(cv, canvas.width, canvas.height, rgba));
        }
      } finally {
        await pdf.destroy();
      }
    } catch (e) {
      dispose(...(pages || []));
      return { pages: null, error_code: "IMAGE_DECODE_FAILED", error_message: `PDF conversion failed: ${e.message}` };
    }
  } else {
    try {
      const { Jimp } = await import("jimp");
      const img = await Jimp.read(imagePath);
      try {
        pages = [rgbaToBgr(cv, img.bitmap.width, img.bitmap.height, img.bitmap.data)];
      } finally {
        img.bitmap.data = null;
      }
    } catch (e) {
      return { pages: null, error_code: "IMAGE_DECODE_FAILED", error_message: `Failed to decode image: ${e.message}` };
    }
  }

  if (!pages || !pages.length) {
    return { pages: null, error_code: "IMAGE_DECODE_FAILED", error_message: "Failed to decode image" };
  }

  const { error_code, error_message } = qualityCheck(cv, pages[0]);
  if (error_code) {
    dispose(...pages);
    return { pages: null, error_code, error_message };
  }

  return { pages, error_code: null, error_message: null };
};

const findAlignmentMarkers = (cv, grayImg) => {
  const h = grayImg.rows;
  const w = grayImg.cols;

  const blurred = new cv.Mat();
  const thresh = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.GaussianBlur(grayImg, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 3);
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const expectedDimX = w * (5.0 / 210.0);
    const minDim = expectedDimX * 0.45;
    const maxDim = expectedDimX * 2.8;
    const minArea = minDim ** 2 * 0.6;
    const maxArea = maxDim ** 2 * 1.5;

    const candidateMarkers = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < minArea || area > maxArea) {
        continue;
      }
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      try {
        cv.approxPolyDP(cnt, approx, 0.04 * peri, true);
        const verts = approx.rows;
        if (verts >= 4 && verts <= 8) {
          const rect = cv.boundingRect(approx);
          const bw = rect.width;
          const bh = rect.height;
          if (bw <= 0 || bh <= 0) continue;
          const aspect = bw / bh;
          if (aspect >= 0.65 && aspect <= 1.55) {
            const solidity = area / (bw * bh);
            if (solidity > 0.7) {
              candidateMarkers.push({ cx: rect.x + bw / 2.0, cy: rect.y + bh / 2.0 });
            }
          }
        }
      } finally {
        approx.delete();
      }
    }

    logErr(`Marker candidates found: ${candidateMarkers.length}`);
    if (candidateMarkers.length < 4) {
      return { srcPts: null, markerError: `ALIGNMENT_MARKERS_NOT_FOUND (Found ${candidateMarkers.length} of 4)` };
    }

    const midX = w / 2.0;
    const midY = h / 2.0;
    const quadrants = { TL: [], TR: [], BL: [], BR: [] };
    for (const cand of candidateMarkers) {
      if (cand.cx < midX && cand.cy < midY) quadrants.TL.push(cand);
      else if (cand.cx >= midX && cand.cy < midY) quadrants.TR.push(cand);
      else if (cand.cx < midX && cand.cy >= midY) quadrants.BL.push(cand);
      else quadrants.BR.push(cand);
    }

    const cornerTargetsPts = { TL: [0, 0], TR: [w, 0], BL: [0, h], BR: [w, h] };
    const selectedCorners = {};
    for (const qKey of Object.keys(cornerTargetsPts)) {
      const cands = quadrants[qKey];
      if (!cands.length) return { srcPts: null, markerError: `MISSING_${qKey}_ALIGNMENT_MARKER` };
      cands.sort(
        (c1, c2) =>
          (c1.cx - cornerTargetsPts[qKey][0]) ** 2 + (c1.cy - cornerTargetsPts[qKey][1]) ** 2 -
          ((c2.cx - cornerTargetsPts[qKey][0]) ** 2 + (c2.cy - cornerTargetsPts[qKey][1]) ** 2)
      );
      selectedCorners[qKey] = [cands[0].cx, cands[0].cy];
    }

    return {
      srcPts: [[...selectedCorners.TL], [...selectedCorners.TR], [...selectedCorners.BR], [...selectedCorners.BL]],
      markerError: null,
    };
  } finally {
    dispose(blurred, thresh, hierarchy);
    contours.delete();
  }
};

const warpPerspectiveToCanvas = (cv, img, srcPts, template) => {
  const canvasCfg = template.canvas;
  const targetW = canvasCfg.width;
  const targetH = canvasCfg.height;
  const scale = canvasCfg.scale_px_per_mm;
  const centers = template.alignment_markers.centers_mm;

  const dstPts = [
    [centers.top_left[0] * scale, centers.top_left[1] * scale],
    [centers.top_right[0] * scale, centers.top_right[1] * scale],
    [centers.bottom_right[0] * scale, centers.bottom_right[1] * scale],
    [centers.bottom_left[0] * scale, centers.bottom_left[1] * scale],
  ];

  const srcMat = new cv.Mat(4, 1, cv.CV_32FC2);
  const dstMat = new cv.Mat(4, 1, cv.CV_32FC2);
  for (let i = 0; i < 4; i++) {
    srcMat.data32F[i * 2] = srcPts[i][0];
    srcMat.data32F[i * 2 + 1] = srcPts[i][1];
    dstMat.data32F[i * 2] = dstPts[i][0];
    dstMat.data32F[i * 2 + 1] = dstPts[i][1];
  }
  const M = cv.getPerspectiveTransform(srcMat, dstMat);
  dispose(srcMat, dstMat);

  const warped = new cv.Mat();
  try {
    cv.warpPerspective(img, warped, M, new cv.Size(targetW, targetH), cv.INTER_LANCZOS4, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0));
    return { warped, M };
  } catch (e) {
    dispose(warped, M);
    throw e;
  }
};

const resolveROIConfig = (cfg) => {
  const roi = (cfg || {}).roi || {};
  const inner = clipf(roi.inner_radius_fraction === undefined ? DEFAULT_ROI_INNER_FRACTION : Number(roi.inner_radius_fraction), 0.0, 0.99);
  const outerDefault = roi.outer_radius_fraction === undefined ? DEFAULT_ROI_OUTER_FRACTION : Number(roi.outer_radius_fraction);
  const outer = clipf(outerDefault, inner + 0.02, 1.0);
  return { inner, outer };
};

const pageQualityIndex = (cv, grayImg) => {
  const blurred = new cv.Mat();
  const lap = new cv.Mat();
  const meanOut = new cv.Mat(1, 4, cv.CV_64F);
  const stdOut = new cv.Mat(1, 4, cv.CV_64F);
  try {
    cv.GaussianBlur(grayImg, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.Laplacian(blurred, lap, cv.CV_64F, 1, 1, 0, cv.BORDER_DEFAULT);
    cv.meanStdDev(lap, meanOut, stdOut);
    const lapVar = stdOut.data64F[0] ** 2;
    return pyRound(clipf((lapVar - QUALITY_LAP_MIN) / (QUALITY_LAP_MAX - QUALITY_LAP_MIN), 0.0, 1.0), 3);
  } finally {
    dispose(blurred, lap, meanOut, stdOut);
  }
};

const sampleBubbleROI = (cv, grayImg, threshImg, cx, cy, radiusPx, innerFrac, outerFrac) => {
  const h = grayImg.rows;
  const w = grayImg.cols;

  const outerR = Math.max(4, Math.round(radiusPx * outerFrac));
  const innerR = Math.max(0, Math.min(Math.round(radiusPx * innerFrac), outerR - 1));
  const sqR = Math.max(outerR, Math.round(radiusPx));
  const sx1 = Math.max(0, cx - sqR);
  const sx2 = Math.min(w, cx + sqR + 1);
  const sy1 = Math.max(0, cy - sqR);
  const sy2 = Math.min(h, cy + sqR + 1);
  if (sx2 <= sx1 || sy2 <= sy1) {
    return { fillRatio: 0.0, adaptiveFill: 0.0, meanIntensity: 255.0 };
  }

  const sqW = sx2 - sx1;
  const sqH = sy2 - sy1;
  const off = sqR - outerR;
  const maskSize = 2 * outerR + 1;

  const mask = new cv.Mat(maskSize, maskSize, cv.CV_8UC1, new cv.Scalar(0));
  const sqGray = new cv.Mat(sqH, sqW, cv.CV_8UC1, new cv.Scalar(0));
  const annMask = new cv.Mat(sqH, sqW, cv.CV_8UC1, new cv.Scalar(0));
  const dstFlat = new cv.Mat();
  try {
    cv.circle(mask, new cv.Point(outerR, outerR), outerR, new cv.Scalar(255), -1);
    cv.circle(mask, new cv.Point(outerR, outerR), innerR, new cv.Scalar(0), -1);

    // Copy square crop.
    for (let y = 0; y < sqH; y++) {
      sqGray.data.set(grayImg.data.subarray((sy1 + y) * w + sx1, (sy1 + y) * w + sx2), y * sqW);
    }
    // Embed the annulus mask at offset (off, off).
    for (let y = 0; y < maskSize; y++) {
      annMask.data.set(mask.data.subarray(y * maskSize, (y + 1) * maskSize), (y + off) * sqW + off);
    }

    // Per-bubble Otsu over the FULL bubble square (well-conditioned).
    let otsuTh;
    const pixelCount = sqW * sqH;
    if (pixelCount < 8) {
      otsuTh = 128.0;
    } else {
      const minMax = cv.minMaxLoc(sqGray);
      if (minMax.maxVal === minMax.minVal) {
        otsuTh = sqGray.data[0] < 128 ? 128.0 : 0.0;
      } else {
        otsuTh = cv.threshold(sqGray, dstFlat, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      }
    }

    let annulusCount = 0;
    let intensitySum = 0;
    for (let y = 0; y < sqH; y++) {
      const mRowOff = y * sqW;
      for (let x = 0; x < sqW; x++) {
        if (annMask.data[mRowOff + x] > 0) {
          annulusCount++;
          intensitySum += sqGray.data[mRowOff + x];
        }
      }
    }

    let fillCount = 0;
    let adaptiveCount = 0;
    for (let y = 0; y < sqH; y++) {
      const mRowOff = y * sqW;
      const tRowOff = (sy1 + y) * w + sx1;
      for (let x = 0; x < sqW; x++) {
        if (annMask.data[mRowOff + x] > 0) {
          if (sqGray.data[mRowOff + x] < otsuTh) fillCount++;
          if (threshImg.data[tRowOff + x] > 0) adaptiveCount++;
        }
      }
    }

    const fillRatio = annulusCount ? fillCount / annulusCount : 0.0;
    const meanIntensity = annulusCount ? intensitySum / annulusCount : 255.0;
    const adaptiveFill = annulusCount ? adaptiveCount / annulusCount : 0.0;

    return {
      fillRatio: pyRound(fillRatio, 4),
      adaptiveFill: pyRound(adaptiveFill, 4),
      meanIntensity: pyRound(meanIntensity, 1),
    };
  } finally {
    dispose(mask, sqGray, annMask, dstFlat);
  }
};

const blankConfidence = (maxFill, blankMax) =>
  pyRound(clipf(CONF_BLANK_BASE + CONF_BLANK_FILL_W * (1.0 - maxFill / Math.max(blankMax, 1e-6)), CONF_BLANK_BASE, CONF_BLANK_CAP), 3);

const confidentConfidence = (bestFill, margin, minFill, delta, quality) => {
  const norm = (bestFill - minFill) / Math.max(1e-6, 1.0 - minFill);
  const mterm = Math.min(1.0, margin / Math.max(delta, 0.15));
  return pyRound(
    clipf(
      CONF_CONFIDENT_BASE + CONF_CONFIDENT_FILL_W * norm + CONF_CONFIDENT_MARGIN_W * mterm + CONF_CONFIDENT_QUALITY_W * quality,
      CONF_CONFIDENT_BASE,
      CONF_CONFIDENT_CAP
    ),
    3
  );
};

const reviewConfidence = (margin, delta, bestFill, blankMax) => {
  const marginTerm = CONF_REVIEW_MARGIN_W * Math.min(1.0, margin / Math.max(delta, 1e-6));
  const faintTerm = CONF_REVIEW_MARGIN_W * Math.min(1.0, bestFill / Math.max(blankMax, 1e-6));
  return pyRound(clipf(CONF_REVIEW_BASE + Math.max(marginTerm, faintTerm), CONF_REVIEW_BASE, CONF_REVIEW_CAP), 3);
};

const buildQuestionSlots = (totalQ, template, numCols) => {
  const pageCfg = template.page_layout || {};
  let firstTop = 76.0;
  let firstRows = 29;
  let contTop = 26.0;
  let contRows = 37;
  let perPage = 116;
  if (pageCfg) {
    firstTop = pageCfg.first_page?.grid_top_mm ?? firstTop;
    firstRows = pageCfg.first_page?.rows_per_col ?? firstRows;
    contTop = pageCfg.continuation_page?.grid_top_mm ?? contTop;
    contRows = pageCfg.continuation_page?.rows_per_col ?? contRows;
    perPage = pageCfg.per_page_capacity ?? firstRows * numCols;
  }

  const slots = {};
  let start = 0;
  let pageIdx = 0;
  while (start < totalQ) {
    const rows = pageIdx === 0 ? firstRows : contRows;
    const topMm = pageIdx === 0 ? firstTop : contTop;
    const pageQuestions = Math.min(perPage, totalQ - start);
    if (pageQuestions <= 0) break;
    for (let c = 0; c < numCols; c++) {
      const colStart = start + c * rows;
      if (colStart >= start + pageQuestions) break;
      const count = Math.min(rows, start + pageQuestions - colStart);
      for (let r = 0; r < count; r++) {
        const q = colStart + r + 1;
        slots[q] = { page: pageIdx, col: c, row: r, topMm, rows };
      }
    }
    start += perPage;
    pageIdx += 1;
  }
  return slots;
};

const stitchPages = (cv, images) => {
  const outH = images.reduce((acc, img) => acc + img.rows, 0);
  const outW = images.reduce((acc, img) => Math.max(acc, img.cols), 0);
  const canvas = new cv.Mat(outH, outW, cv.CV_8UC3, new cv.Scalar(255, 255, 255));
  let y = 0;
  for (const img of images) {
    for (let r = 0; r < img.rows; r++) {
      canvas.data.set(img.data.subarray(r * img.cols * 3, (r + 1) * img.cols * 3), (y + r) * outW * 3);
    }
    y += img.rows;
  }
  return canvas;
};

const evaluateOMR = async ({ imagePath, templatePath, numQuestions, numOptions, annotatedOutput, numDigits, outputDir }) => {
  const startTime = performance.now();
  const cv = await getCV();

  if (!fs.existsSync(templatePath)) {
    return failBg("INVALID_TEMPLATE", `Template not found: ${templatePath}`);
  }

  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const gridCfg = template.grid;
  const totalQ = numQuestions || gridCfg.num_questions;
  const optCount = numOptions || gridCfg.options_per_question;
  const optionLabels = gridCfg.option_labels.slice(0, optCount);
  const thresholds = template.thresholds || { min_fill_ratio: 0.35, ambiguity_delta: 0.08, blank_max_fill: 0.25 };
  const minFill = thresholds.min_fill_ratio;
  const blankMax = thresholds.blank_max_fill;
  const delta = thresholds.ambiguity_delta;

  const identityCfg = template.identity_grid;
  const numDigitsFinal = numDigits || (identityCfg ? identityCfg.num_digits || 6 : 6);
  if (numDigits && identityCfg && numDigits !== identityCfg.num_digits) {
    logErr(`WARNING: --num-digits=${numDigits} overrides template identity_grid.num_digits=${identityCfg.num_digits}`);
  }

  const { inner: gridRoiInner, outer: gridRoiOuter } = resolveROIConfig(gridCfg);
  const { inner: idRoiInner, outer: idRoiOuter } = resolveROIConfig(identityCfg || {});

  const { pages, error_code, error_message } = await loadPages(cv, imagePath);
  if (error_code) return failBg(error_code, error_message);
  if (!pages) return failBg("IMAGE_DECODE_FAILED", "Failed to decode image");

  const origH = pages[0].rows;
  const origW = pages[0].cols;

  const scale = template.canvas.scale_px_per_mm;
  const numCols = gridCfg.num_cols;
  const slots = buildQuestionSlots(totalQ, template, numCols);

  const gridTop = gridCfg.grid_top_mm;
  const headerH = gridCfg.header_height_mm;
  const headerOffset = gridCfg.header_offset_mm;
  const rowH = gridCfg.row_height_mm;
  const colXStart = gridCfg.col_x_start_mm;
  const colWidthMm = gridCfg.col_width_mm;
  const bubbleOffsetX = gridCfg.bubble_offset_x_mm;
  const bubbleGap = gridCfg.bubble_gap_mm;
  const bubbleRPx = Math.round(gridCfg.bubble_radius_mm * scale);

  const pagesWithQ = [...new Set(Object.values(slots).map((slot) => slot.page))].sort((a, b) => a - b);

  const questionResults = {};
  const extractedAnswers = {};
  const flaggedQuestions = [];
  const annotatedPages = [];
  const pageQualities = {};
  let markersFound = 0;
  let alignTimeMs = 0.0;
  let totalAlignMs = 0.0;

  const tProcStart = performance.now();
  let warpedP0Gray = null;
  let threshP0 = null;

  let pageResults = null;
  try {
    for (const pageIdx of pagesWithQ) {
      if (pageIdx >= pages.length) {
        return failBg("PAGE_NOT_FOUND", `Rendered page ${pageIdx + 1} is missing (expected ${pagesWithQ.length} page(s), got ${pages.length})`, {
          execution_metrics: { image_resolution: [origW, origH], pages_processed: pages.length },
        });
      }

      const img = pages[pageIdx];
      const gray = new cv.Mat();
      cv.cvtColor(img, gray, cv.COLOR_BGR2GRAY);

      // 3a. Alignment Marker Detection
      const tAlignStart = performance.now();
      const { srcPts, markerError } = findAlignmentMarkers(cv, gray);
      alignTimeMs = pyRound(performance.now() - tAlignStart, 2);
      totalAlignMs += alignTimeMs;

      if (markerError) {
        dispose(gray);
        return failBg("ALIGNMENT_MARKERS_NOT_FOUND", `Corner markers on page ${pageIdx + 1} could not be detected: ${markerError}`, {
          execution_metrics: {
            image_resolution: [origW, origH],
            pages_processed: pagesWithQ.length,
            page_failed: pageIdx + 1,
            alignment_time_ms: alignTimeMs,
          },
        });
      }

      markersFound = 4;

      // 3b. 4-Point Perspective Transform to Standard Canvas
      const { warped, M } = warpPerspectiveToCanvas(cv, img, srcPts, template);
      const warpedGray = new cv.Mat();
      cv.cvtColor(warped, warpedGray, cv.COLOR_BGR2GRAY);

      const warpedBlur = new cv.Mat();
      const threshImg = new cv.Mat();
      try {
        cv.GaussianBlur(warpedGray, warpedBlur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
        cv.adaptiveThreshold(warpedBlur, threshImg, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 5);

        const pageQuality = pageQualityIndex(cv, warpedGray);
        pageQualities[pageIdx] = pageQuality;

        const annotated = warped.clone();

        if (pageIdx === 0) {
          warpedP0Gray = warpedGray.clone();
          threshP0 = threshImg.clone();
        }

        const pageQuestions = Object.entries(slots).filter(([, slot]) => slot.page === pageIdx);

        for (const [qStr, slot] of pageQuestions) {
          const q = Number(qStr);
          const colXMm = colXStart + slot.col * colWidthMm;
          const qYMm = slot.topMm + headerH + headerOffset + slot.row * rowH;
          const cy = Math.round(qYMm * scale);

          const optMeasurements = [];
          for (let i = 0; i < optionLabels.length; i++) {
            const opt = optionLabels[i];
            const cx = Math.round((colXMm + bubbleOffsetX + i * bubbleGap) * scale);
            const signals = sampleBubbleROI(cv, warpedGray, threshImg, cx, cy, bubbleRPx, gridRoiInner, gridRoiOuter);
            optMeasurements.push({
              option: opt,
              cx,
              cy,
              fill_ratio: signals.fillRatio,
              adaptive_fill: signals.adaptiveFill,
              mean_intensity: signals.meanIntensity,
            });
          }

          const sortedOpts = [...optMeasurements].sort((a, b) => b.fill_ratio - a.fill_ratio);
          const best = sortedOpts[0];
          const second = sortedOpts.length > 1 ? sortedOpts[1] : null;

          const bestFill = best.fill_ratio;
          const secondFill = second ? second.fill_ratio : 0.0;
          const margin = bestFill - secondFill;

          const candidate = bestFill >= blankMax ? best.option : null;

          let status;
          let state;
          let detectedAns = null;
          let confidence;

          // Case A: Blank / Unattempted
          if (bestFill < blankMax) {
            status = "blank";
            state = "blank";
            confidence = blankConfidence(bestFill, blankMax);
          }
          // Case B: Multiple Marks (two or more options above the detection floor)
          else if (second && secondFill >= minFill) {
            status = "multiple_mark";
            state = "multiple";
            confidence = CONF_MULTIPLE;
            flaggedQuestions.push(q);
            for (const m of sortedOpts) {
              if (m.fill_ratio >= minFill) {
                cv.circle(annotated, new cv.Point(m.cx, m.cy), bubbleRPx + 4, new cv.Scalar(0, 0, 255), 3);
                cv.putText(annotated, "MULTI", new cv.Point(m.cx - 14, m.cy - bubbleRPx - 4), cv.FONT_HERSHEY_SIMPLEX, 0.35, new cv.Scalar(0, 0, 255), 1);
              }
            }
          }
          // Case C: Ambiguous / Low Separation
          else if (second && margin < delta) {
            status = "ambiguous";
            state = "needs_review";
            confidence = reviewConfidence(margin, delta, bestFill, blankMax);
            flaggedQuestions.push(q);
            cv.circle(annotated, new cv.Point(best.cx, best.cy), bubbleRPx + 4, new cv.Scalar(0, 165, 255), 3);
            cv.putText(annotated, "?", new cv.Point(best.cx - 4, best.cy - bubbleRPx - 4), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(0, 165, 255), 2);
          }
          // Case D: Single Confident Detection
          else if (bestFill >= minFill) {
            status = "detected";
            state = "confident";
            detectedAns = best.option;
            confidence = confidentConfidence(bestFill, margin, minFill, delta, pageQuality);
            cv.circle(annotated, new cv.Point(best.cx, best.cy), bubbleRPx + 4, new cv.Scalar(34, 197, 94), 3);
            cv.circle(annotated, new cv.Point(best.cx, best.cy), 2, new cv.Scalar(34, 197, 94), -1);
            cv.putText(annotated, best.option, new cv.Point(best.cx - 3, best.cy + bubbleRPx + 6), cv.FONT_HERSHEY_SIMPLEX, 0.35, new cv.Scalar(34, 197, 94), 1);
          }
          // Case E: Faint mark below detection floor
          else {
            status = "ambiguous";
            state = "needs_review";
            confidence = reviewConfidence(margin, delta, bestFill, blankMax);
            flaggedQuestions.push(q);
            cv.circle(annotated, new cv.Point(best.cx, best.cy), bubbleRPx + 4, new cv.Scalar(0, 165, 255), 2);
          }

          questionResults[qStr] = {
            answer: detectedAns,
            candidate_answer: candidate,
            confidence,
            status,
            state,
            fill_ratio: pyRound(bestFill, 3),
            second_fill_ratio: pyRound(secondFill, 3),
            margin: pyRound(margin, 3),
            adaptive_fill: pyRound(best.adaptive_fill, 3),
            mean_intensity: pyRound(best.mean_intensity, 1),
          };

          if (detectedAns !== null) extractedAnswers[qStr] = detectedAns;
        }

        annotatedPages.push(annotated);
      } finally {
        dispose(warpedGray, warpedBlur, threshImg, M, warped);
        dispose(gray);
      }
    }

    const procTimeMs = pyRound(performance.now() - tProcStart, 2);

    // 4. Identity Grid Sampling (Admission Number)
    let admissionNumberDetection = null;
    if (identityCfg && warpedP0Gray) {
      try {
        const idXStart = identityCfg.x_start_mm ?? 139.0;
        const idYStart = identityCfg.y_start_mm ?? 66.5;
        const idColGap = identityCfg.col_gap_mm ?? 8.0;
        const idRowGap = identityCfg.row_gap_mm ?? 3.2;
        const idBubbleR = identityCfg.bubble_radius_mm ?? 1.3;
        const idDigits = identityCfg.digits || ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

        const detectedDigits = [];
        const columnDetails = [];
        let ambiguous = false;

        for (let colIdx = 0; colIdx < numDigitsFinal; colIdx++) {
          const colX = (idXStart + colIdx * idColGap) * scale;
          let bestDigit = null;
          let bestFill = 0.0;
          let secondFill = 0.0;
          let bestCy = null;
          const fills = [];

          for (let dIdx = 0; dIdx < idDigits.length; dIdx++) {
            const digitLabel = idDigits[dIdx];
            const cy = (idYStart + dIdx * idRowGap) * scale;
            const signals = sampleBubbleROI(cv, warpedP0Gray, threshP0, Math.round(colX), Math.round(cy), Math.round(idBubbleR * scale), idRoiInner, idRoiOuter);
            const fillRatio = signals.fillRatio;
            fills.push({
              digit: digitLabel,
              fill_ratio: pyRound(fillRatio, 3),
              adaptive_fill: pyRound(signals.adaptiveFill, 3),
              intensity: pyRound(signals.meanIntensity, 1),
            });
            if (fillRatio > bestFill) {
              secondFill = bestFill;
              bestFill = fillRatio;
              bestDigit = digitLabel;
              bestCy = cy;
            } else if (fillRatio > secondFill) {
              secondFill = fillRatio;
            }
          }

          let colDetectedDigit = "";
          let colState = "blank";
          let colConfidence = blankConfidence(bestFill, blankMax);
          if (bestFill < blankMax) {
            detectedDigits.push("");
            ambiguous = true;
          } else if (secondFill >= minFill) {
            detectedDigits.push("");
            ambiguous = true;
            colState = "multiple";
            colConfidence = CONF_MULTIPLE;
          } else if (bestFill - secondFill < delta) {
            detectedDigits.push("");
            ambiguous = true;
            colState = "needs_review";
            colConfidence = reviewConfidence(bestFill - secondFill, delta, bestFill, blankMax);
          } else {
            detectedDigits.push(bestDigit);
            colDetectedDigit = bestDigit;
            colState = "confident";
            colConfidence = confidentConfidence(bestFill, bestFill - secondFill, minFill, delta, pageQualities[0] ?? 1.0);
            if (annotatedPages.length && bestCy !== null) {
              cv.circle(annotatedPages[0], new cv.Point(Math.round(colX), Math.round(bestCy)), Math.round(idBubbleR * scale) + 4, new cv.Scalar(34, 197, 94), 3);
            }
          }

          columnDetails.push({
            column: colIdx,
            detected_digit: colDetectedDigit,
            state: colState,
            confidence: colConfidence,
            fill_ratio: pyRound(bestFill, 3),
            second_fill_ratio: pyRound(secondFill, 3),
            all_fills: fills,
          });
        }

        const rawAdm = detectedDigits.join("");
        const canonicalAdm = rawAdm.trim();

        let admStatus;
        if (ambiguous) admStatus = "ambiguous";
        else if (canonicalAdm && canonicalAdm.length === numDigitsFinal) admStatus = "detected";
        else admStatus = "blank";

        admissionNumberDetection = {
          raw: rawAdm,
          canonical: canonicalAdm,
          status: admStatus,
          column_details: columnDetails,
        };
        logErr(`Identity grid: raw=${rawAdm} canonical=${canonicalAdm} status=${admStatus} ambiguous=${ambiguous}`);
      } catch (e) {
        logErr(`Identity grid sampling failed: ${e.message}`);
        admissionNumberDetection = { raw: "", canonical: "", status: "blank", column_details: [] };
      }
    }

    // 5. Save Annotated Output Image (pages stitched vertically)
    let annotatedPath = null;
    if (annotatedOutput || outputDir) {
      const composed = annotatedPages.length === 1 ? annotatedPages[0] : stitchPages(cv, annotatedPages);
      const finalPath = annotatedOutput || path.join(outputDir || ".", `annotated_${path.basename(imagePath).replace(/\.[^.]+$/, "")}.png`);
      await writePng(cv, composed, finalPath);
      annotatedPath = finalPath;
      if (annotatedPages.length > 1) composed.delete();
    }

    const totalTimeMs = pyRound(performance.now() - startTime, 2);
    const overallStatus = flaggedQuestions.length > 0 ? "review_required" : "completed";
    const qualityValues = Object.values(pageQualities);

    pageResults = {
      status: overallStatus,
      engine: "opencv",
      engine_impl: "js-wasm",
      engine_version: ENGINE_VERSION,
      template_id: template.template_id || "a4_50q_4opt_v1",
      total_questions: totalQ,
      options_per_question: optCount,
      answers: extractedAnswers,
      extracted_answers: extractedAnswers,
      question_results: questionResults,
      flagged_questions: flaggedQuestions,
      flagged_count: flaggedQuestions.length,
      admission_number_detection: admissionNumberDetection,
      annotated_image: annotatedPath,
      execution_metrics: {
        image_resolution: [origW, origH],
        markers_found: markersFound,
        pages_processed: annotatedPages.length,
        alignment_time_ms: pyRound(alignTimeMs, 2),
        processing_time_ms: procTimeMs,
        total_time_ms: totalTimeMs,
        avg_ms_per_question: pyRound(procTimeMs / Math.max(1, totalQ), 3),
        image_quality: pyRound(qualityValues.length ? qualityValues.reduce((a, b) => a + b, 0) / qualityValues.length : 1.0, 3),
      },
    };
    return pageResults;
  } finally {
    dispose(...pages);
    dispose(warpedP0Gray, threshP0, ...annotatedPages);
  }
};

export { evaluateOMR, ENGINE_VERSION };