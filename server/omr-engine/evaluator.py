#!/usr/bin/env python3
"""
evaluator.py - ExamOS OpenCV Computer Vision OMR Evaluation Engine

Performs robust optical mark recognition (OMR) on scanned or photographed A4 sheets.
Features:
- Image validation & quality assessment
- Multi-page PDF support (renders every page, maps question ranges per page)
- 4-corner marker detection & contour sorting
- 4-point perspective transform & deskew to normalized A4 canvas
- Template-driven bubble grid sampling via annulus ROIs (excludes preprinted
  border ring & centered labels)
- Multi-signal ink measurement (adaptive fill ratio, per-bubble Otsu darkness,
  mean intensity)
- Single/blank/multiple/needs-review classification with normalized `state`
- Deterministic, margin & image-quality aware confidence scoring
- Candidate-aware classification (candidate_answer vs authoritative answer)
- Visual annotated overlay generation per page (stitched into one image)
- Structured JSON output contract to stdout

Author: ExamOS Engineering
"""

import argparse
import json
import math
import os
import sys
import time
import cv2
import numpy as np

ENGINE_VERSION = "1.2.0"


def log_err(msg):
    """Writes diagnostic messages strictly to stderr so stdout remains pure JSON."""
    sys.stderr.write(f"[OMR-CV] {msg}\n")
    sys.stderr.flush()


def load_pages(image_path):
    """
    Loads every page of the input image/PDF as a BGR numpy array.

    - PDF: renders ALL pages via pdf2image (IndexError-model libraries vary, so
      we map question ranges from the generator geometry, never from page count).
    - PNG/JPG/JPEG: single page.

    Returns: (list_of_pages, error_code, error_message).
    """
    if not os.path.exists(image_path):
        return None, "IMAGE_NOT_FOUND", f"File does not exist: {image_path}"

    file_size = os.path.getsize(image_path)
    if file_size < 1000:
        return None, "IMAGE_TOO_SMALL", "File size too small (< 1KB)"

    pages = None
    if image_path.lower().endswith(".pdf"):
        try:
            from pdf2image import convert_from_path
            rendered = convert_from_path(image_path, dpi=200)
            if not rendered:
                return None, "IMAGE_DECODE_FAILED", "PDF contains no renderable pages"
            pages = [cv2.cvtColor(np.array(p.convert("RGB")), cv2.COLOR_RGB2BGR) for p in rendered]
        except Exception as e:
            return None, "IMAGE_DECODE_FAILED", f"PDF conversion failed: {str(e)}"
    else:
        img = cv2.imread(image_path)
        pages = [img] if img is not None else None

    if pages is None:
        return None, "IMAGE_DECODE_FAILED", "Failed to decode image"

    # Quality checks against the first page
    first = pages[0]
    h, w = first.shape[:2]
    if h < 600 or w < 400:
        return None, "IMAGE_TOO_SMALL", f"Resolution too low ({w}x{h}, minimum 400x600 required)"

    gray = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if lap_var < 15.0:
        log_err(f"Warning: Low image sharpness detected (Laplacian var: {lap_var:.1f})")

    mean_val = np.mean(gray)
    if mean_val < 25:
        return None, "IMAGE_TOO_DARK", f"Image is severely underexposed (mean brightness: {mean_val:.1f})"
    if mean_val > 254.5:
        return None, "IMAGE_OVEREXPOSED", f"Image is completely blank white (mean brightness: {mean_val:.1f})"

    return pages, None, None


def find_alignment_markers(gray_img, template):
    """
    Detects the 4 black square alignment markers at the sheet corners.
    Returns: 4 corner points sorted as [Top-Left, Top-Right, Bottom-Right, Bottom-Left].
    """
    h, w = gray_img.shape[:2]

    blurred = cv2.GaussianBlur(gray_img, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3
    )

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    expected_dim_x = w * (5.0 / 210.0)
    min_dim = expected_dim_x * 0.45
    max_dim = expected_dim_x * 2.8
    min_area = (min_dim ** 2) * 0.6
    max_area = (max_dim ** 2) * 1.5

    candidate_markers = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)

        if len(approx) >= 4 and len(approx) <= 8:
            x, y, bw, bh = cv2.boundingRect(approx)
            aspect = float(bw) / float(bh)
            if 0.65 <= aspect <= 1.55:
                rect_area = bw * bh
                solidity = float(area) / float(rect_area)
                if solidity > 0.70:
                    cx = x + bw / 2.0
                    cy = y + bh / 2.0
                    candidate_markers.append((cx, cy, bw, bh, area))

    log_err(f"Marker candidates found: {len(candidate_markers)}")

    if len(candidate_markers) < 4:
        return None, f"ALIGNMENT_MARKERS_NOT_FOUND (Found {len(candidate_markers)} of 4)"

    mid_x, mid_y = w / 2.0, h / 2.0
    quadrants = {"TL": [], "TR": [], "BL": [], "BR": []}

    for cand in candidate_markers:
        cx, cy = cand[0], cand[1]
        if cx < mid_x and cy < mid_y:
            quadrants["TL"].append(cand)
        elif cx >= mid_x and cy < mid_y:
            quadrants["TR"].append(cand)
        elif cx < mid_x and cy >= mid_y:
            quadrants["BL"].append(cand)
        else:
            quadrants["BR"].append(cand)

    selected_corners = {}
    corner_targets = {
        "TL": (0, 0),
        "TR": (w, 0),
        "BL": (0, h),
        "BR": (w, h)
    }

    for q_key, target in corner_targets.items():
        cands = quadrants[q_key]
        if not cands:
            return None, f"MISSING_{q_key}_ALIGNMENT_MARKER"
        cands.sort(key=lambda c: (c[0] - target[0])**2 + (c[1] - target[1])**2)
        selected_corners[q_key] = (cands[0][0], cands[0][1])

    src_pts = np.array([
        selected_corners["TL"],
        selected_corners["TR"],
        selected_corners["BR"],
        selected_corners["BL"]
    ], dtype=np.float32)

    return src_pts, None


def warp_perspective_to_canvas(img, src_pts, template):
    """
    Warps the quadrilateral defined by the detected alignment markers
    to the exact normalized A4 canvas specified in the template.
    """
    canvas_cfg = template["canvas"]
    target_w = canvas_cfg["width"]
    target_h = canvas_cfg["height"]
    scale = canvas_cfg["scale_px_per_mm"]

    centers_mm = template["alignment_markers"]["centers_mm"]
    tl_x, tl_y = centers_mm["top_left"][0] * scale, centers_mm["top_left"][1] * scale
    tr_x, tr_y = centers_mm["top_right"][0] * scale, centers_mm["top_right"][1] * scale
    br_x, br_y = centers_mm["bottom_right"][0] * scale, centers_mm["bottom_right"][1] * scale
    bl_x, bl_y = centers_mm["bottom_left"][0] * scale, centers_mm["bottom_left"][1] * scale

    dst_pts = np.array([
        [tl_x, tl_y],
        [tr_x, tr_y],
        [br_x, br_y],
        [bl_x, bl_y]
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(img, M, (target_w, target_h), flags=cv2.INTER_LANCZOS4)
    return warped, M


# ---------------------------------------------------------------------------
# ROI & classification constants (deterministic, documented in README)
# ---------------------------------------------------------------------------
# Annulus fractions: the outer fraction excludes the preprinted bubble border
# ring; the inner fraction excludes the preprinted centered option/digit label.
DEFAULT_ROI_INNER_FRACTION = 0.40
DEFAULT_ROI_OUTER_FRACTION = 0.88
IDENTITY_ROI_INNER_FRACTION = 0.45   # identity bubbles carry a printed digit too
DARKNESS_SIGNAL_FLOOR = 0.55          # pixel darker than 0.55 x local bg counts as ink

# Confidence model weights (no RNG; f(best, second, margin, thresholds, quality))
CONF_CONFIDENT_BASE = 0.55
CONF_CONFIDENT_FILL_W = 0.30
CONF_CONFIDENT_MARGIN_W = 0.10
CONF_CONFIDENT_QUALITY_W = 0.05
CONF_CONFIDENT_CAP = 0.99
CONF_BLANK_BASE = 0.60
CONF_BLANK_FILL_W = 0.35
CONF_BLANK_CAP = 0.95
CONF_REVIEW_BASE = 0.30
CONF_REVIEW_MARGIN_W = 0.35
CONF_REVIEW_CAP = 0.60
CONF_MULTIPLE = 0.25

QUALITY_LAP_MIN = 15.0
QUALITY_LAP_MAX = 300.0


def clipf(value, lo, hi):
    return max(lo, min(hi, value))


def resolve_roi_config(cfg):
    """Resolves optional per-grid `roi` config with backward-compatible defaults."""
    roi = (cfg or {}).get("roi") or {}
    inner = clipf(float(roi.get("inner_radius_fraction", DEFAULT_ROI_INNER_FRACTION)), 0.0, 0.99)
    outer = clipf(float(roi.get("outer_radius_fraction", DEFAULT_ROI_OUTER_FRACTION)), inner + 0.02, 1.0)
    return inner, outer


def page_quality_index(gray_img):
    """
    Normalized sharpness/focus gauge for the warped page, in [0, 1].
    Used only as a small confidence modulator; never a hard gate.
    """
    blurred = cv2.GaussianBlur(gray_img, (3, 3), 0)
    lap_var = cv2.Laplacian(blurred, cv2.CV_64F).var()
    return round(float(np.clip((lap_var - QUALITY_LAP_MIN) / (QUALITY_LAP_MAX - QUALITY_LAP_MIN), 0.0, 1.0)), 3)


def sample_bubble_roi(gray_img, thresh_img, cx, cy, radius_px, inner_frac=None, outer_frac=None):
    """
    Template-driven ROI sampling of one bubble.

    A per-bubble Otsu threshold is computed over the FULL bubble square (which
    contains both ink and white background, so Otsu is always well-conditioned),
    then applied to the pixels of an ANNULUS mask that excludes the preprinted
    border ring (outer fraction) and the preprinted centered option/digit label
    (inner fraction). This keeps blank bubbles near zero regardless of global or
    adaptive-threshold quirks with large solid marks.

    Returns normalized signals:
      fill_ratio     - annulus ink fraction under the Otsu threshold (primary)
      adaptive_fill  - annulus ink fraction using the page adaptive threshold
      mean_intensity - mean grey level inside the annulus (255 = blank white)
    """
    h, w = gray_img.shape[:2]
    if inner_frac is None:
        inner_frac = DEFAULT_ROI_INNER_FRACTION
    if outer_frac is None:
        outer_frac = DEFAULT_ROI_OUTER_FRACTION

    outer_r = max(4, int(round(radius_px * outer_frac)))
    inner_r = int(round(radius_px * inner_frac))
    inner_r = max(0, min(inner_r, outer_r - 1))

    sq_r = max(outer_r, int(round(radius_px)))
    sx1 = max(0, cx - sq_r)
    sx2 = min(w, cx + sq_r + 1)
    sy1 = max(0, cy - sq_r)
    sy2 = min(h, cy + sq_r + 1)
    if sx2 <= sx1 or sy2 <= sy1:
        return {"fill_ratio": 0.0, "adaptive_fill": 0.0, "mean_intensity": 255.0}

    sq_gray = gray_img[sy1:sy2, sx1:sx2]
    sq_thresh = thresh_img[sy1:sy2, sx1:sx2]

    mask_size = 2 * outer_r + 1
    mask = np.zeros((mask_size, mask_size), dtype=np.uint8)
    cv2.circle(mask, (outer_r, outer_r), outer_r, 255, -1)
    cv2.circle(mask, (outer_r, outer_r), inner_r, 0, -1)

    # Annulus center aligns with the bubble center at index (sq_r, sq_r) inside
    # the square crop; it is guaranteed to fit because outer_r <= sq_r.
    off = sq_r - outer_r
    ann_mask = np.zeros(sq_gray.shape[:2], dtype=bool)
    ann_mask[off:off + mask_size, off:off + mask_size] = mask > 0

    annulus_vals = sq_gray[ann_mask > 0]
    if annulus_vals.size == 0:
        return {"fill_ratio": 0.0, "adaptive_fill": 0.0, "mean_intensity": 255.0}

    flat = sq_gray.reshape(-1)
    if flat.size < 8:
        otsu_th = 128.0
    elif flat.min() == flat.max():
        otsu_th = 128.0 if int(flat[0]) < 128 else 0.0
    else:
        ret, _ = cv2.threshold(flat.copy(), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        otsu_th = float(ret)

    fill_ratio = float((annulus_vals < int(otsu_th)).mean())

    total = int(ann_mask.sum())
    adaptive_fill = 0.0
    if total > 0:
        ann_mask_u8 = ann_mask.astype(np.uint8)
        adaptive_fill = float(cv2.countNonZero(cv2.bitwise_and(sq_thresh, ann_mask_u8))) / total

    return {
        "fill_ratio": round(fill_ratio, 4),
        "adaptive_fill": round(adaptive_fill, 4),
        "mean_intensity": round(float(annulus_vals.mean()), 1),
    }


def blank_confidence(max_fill, blank_max):
    """Certainty that a bubble set is blank (higher when max_fill is lower)."""
    return round(clipf(CONF_BLANK_BASE + CONF_BLANK_FILL_W * (1.0 - max_fill / max(blank_max, 1e-6)),
                       CONF_BLANK_BASE, CONF_BLANK_CAP), 3)


def confident_confidence(best_fill, margin, min_fill, delta, quality):
    """
    Deterministic confidence for a single confident detection, combining
    fill strength, separation from the runner-up, and page image quality:
      base + fill_component + margin_component + quality_component
    """
    norm = (best_fill - min_fill) / max(1e-6, (1.0 - min_fill))
    mterm = min(1.0, margin / max(delta, 0.15))
    return round(clipf(CONF_CONFIDENT_BASE
                       + CONF_CONFIDENT_FILL_W * norm
                       + CONF_CONFIDENT_MARGIN_W * mterm
                       + CONF_CONFIDENT_QUALITY_W * quality,
                       CONF_CONFIDENT_BASE, CONF_CONFIDENT_CAP), 3)


def review_confidence(margin, delta, best_fill, blank_max):
    """
    Confidence that a question genuinely needs review (low margin or faint mark).
    Never exceeds CONF_REVIEW_CAP so the reviewer sees it clearly as uncertain.
    """
    margin_term = CONF_REVIEW_MARGIN_W * min(1.0, margin / max(delta, 1e-6))
    faint_term = CONF_REVIEW_MARGIN_W * min(1.0, best_fill / max(blank_max, 1e-6))
    return round(clipf(CONF_REVIEW_BASE + max(margin_term, faint_term),
                       CONF_REVIEW_BASE, CONF_REVIEW_CAP), 3)


def build_question_slots(total_q, template, num_cols):
    """
    Maps every question to its (page, column, row, grid_top_mm) slot following the
    EXACT layout algorithm of src/lib/generateOMRSheetPDF.js:

      - page 0:  grid_top=76mm,  rows_per_col=29 (first page)
      - page k>0: grid_top=26mm, rows_per_col=37 (continuation page)
      - every page is capped at `per_page_capacity` questions (116)
      - questions fill columns left-to-right, top-to-bottom within each page

    Returns: dict q -> (page_idx, col, row, top_mm, rows_per_col).
    """
    page_cfg = template.get("page_layout")
    first_top = 76.0
    first_rows = 29
    cont_top = 26.0
    cont_rows = 37
    per_page = 116
    if page_cfg:
        first_top = page_cfg.get("first_page", {}).get("grid_top_mm", first_top)
        first_rows = page_cfg.get("first_page", {}).get("rows_per_col", first_rows)
        cont_top = page_cfg.get("continuation_page", {}).get("grid_top_mm", cont_top)
        cont_rows = page_cfg.get("continuation_page", {}).get("rows_per_col", cont_rows)
        per_page = page_cfg.get("per_page_capacity", first_rows * num_cols)

    slots = {}
    start = 0
    page_idx = 0
    while start < total_q:
        rows = first_rows if page_idx == 0 else cont_rows
        top_mm = first_top if page_idx == 0 else cont_top
        page_questions = min(per_page, total_q - start)
        if page_questions <= 0:
            break
        for c in range(num_cols):
            col_start = start + c * rows
            if col_start >= start + page_questions:
                break
            count = min(rows, start + page_questions - col_start)
            for r in range(count):
                q = col_start + r + 1
                slots[q] = (page_idx, c, r, top_mm, rows)
        start += per_page
        page_idx += 1

    return slots


def stitch_pages(images):
    """Vertically stitches annotated page images into a single output canvas."""
    out_h = sum(img.shape[0] for img in images)
    out_w = max(img.shape[1] for img in images)
    canvas = np.full((out_h, out_w, 3), 255, dtype=np.uint8)
    y = 0
    for img in images:
        canvas[y:y + img.shape[0], :img.shape[1]] = img
        y += img.shape[0]
    return canvas


def evaluate_omr(image_path, template_path, num_questions=None, num_options=None, output_dir=None, annotated_output=None, num_digits_override=None):
    """
    Executes the full computer vision OMR pipeline across every page.
    Returns structured result dict adhering strictly to the ExamOS JSON contract.
    """
    start_time = time.time()

    # 1. Load Template
    if not os.path.exists(template_path):
        return {
            "status": "failed",
            "engine": "opencv",
            "engine_version": ENGINE_VERSION,
            "error_code": "INVALID_TEMPLATE",
            "error_message": f"Template not found: {template_path}"
        }

    with open(template_path, "r") as f:
        template = json.load(f)

    grid_cfg = template["grid"]
    total_q = num_questions or grid_cfg["num_questions"]
    opt_count = num_options or grid_cfg["options_per_question"]
    option_labels = grid_cfg["option_labels"][:opt_count]
    thresholds = template.get("thresholds", {
        "min_fill_ratio": 0.35,
        "ambiguity_delta": 0.08,
        "blank_max_fill": 0.25
    })

    # Identity grid config: CLI override is authoritative over template
    identity_cfg = template.get("identity_grid")
    num_digits = num_digits_override if num_digits_override else (identity_cfg.get("num_digits", 6) if identity_cfg else 6)
    if num_digits_override and identity_cfg and num_digits_override != identity_cfg.get("num_digits"):
        log_err(f"WARNING: --num-digits={num_digits_override} overrides template identity_grid.num_digits={identity_cfg.get('num_digits')}")

    # Optional per-grid ROI config (inner/outer annulus fractions), backward compatible
    grid_roi_inner, grid_roi_outer = resolve_roi_config(grid_cfg)
    id_roi_inner, id_roi_outer = resolve_roi_config(identity_cfg or {})

    # 2. Load all pages & quality check
    pages, err_code, err_msg = load_pages(image_path)
    if err_code:
        return {
            "status": "failed",
            "engine": "opencv",
            "engine_version": ENGINE_VERSION,
            "error_code": err_code,
            "error_message": err_msg
        }

    orig_h, orig_w = pages[0].shape[:2]

    # 3. Build per-page question mapping (single source of truth: generator geometry)
    scale = template["canvas"]["scale_px_per_mm"]
    num_cols = grid_cfg["num_cols"]
    slots = build_question_slots(total_q, template, num_cols)

    grid_top = grid_cfg["grid_top_mm"]
    header_h = grid_cfg["header_height_mm"]
    header_offset = grid_cfg["header_offset_mm"]
    row_h = grid_cfg["row_height_mm"]
    col_x_start = grid_cfg["col_x_start_mm"]
    col_w_mm = grid_cfg["col_width_mm"]
    bubble_offset_x = grid_cfg["bubble_offset_x_mm"]
    bubble_gap = grid_cfg["bubble_gap_mm"]
    bubble_r_px = int(grid_cfg["bubble_radius_mm"] * scale)

    pages_with_q = sorted({slot[0] for slot in slots.values()})

    question_results = {}
    extracted_answers = {}
    flagged_questions = []
    annotated_pages = []
    page_qualities = {}
    markers_found = 0
    align_time_ms = 0.0
    total_align_ms = 0.0

    t_proc_start = time.time()
    warped_p0_gray = None
    thresh_p0 = None

    for page_idx in pages_with_q:
        if page_idx >= len(pages):
            # PDF had fewer rendered pages than required by the question count.
            return {
                "status": "failed",
                "engine": "opencv",
                "engine_version": ENGINE_VERSION,
                "error_code": "PAGE_NOT_FOUND",
                "error_message": f"Rendered page {page_idx + 1} is missing (expected {len(pages_with_q)} page(s), got {len(pages)})",
                "execution_metrics": {
                    "image_resolution": [orig_w, orig_h],
                    "pages_processed": len(pages)
                }
            }

        img = pages[page_idx]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # 3a. Alignment Marker Detection
        t_align_start = time.time()
        src_pts, marker_err = find_alignment_markers(gray, template)
        align_time_ms = round((time.time() - t_align_start) * 1000, 2)
        total_align_ms += align_time_ms

        if marker_err:
            return {
                "status": "failed",
                "engine": "opencv",
                "engine_version": ENGINE_VERSION,
                "error_code": "ALIGNMENT_MARKERS_NOT_FOUND",
                "error_message": f"Corner markers on page {page_idx + 1} could not be detected: {marker_err}",
                "execution_metrics": {
                    "image_resolution": [orig_w, orig_h],
                    "pages_processed": len(pages_with_q),
                    "page_failed": page_idx + 1,
                    "alignment_time_ms": align_time_ms
                }
            }

        markers_found = 4

        # 3b. 4-Point Perspective Transform to Standard Canvas
        warped, M = warp_perspective_to_canvas(img, src_pts, template)
        warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

        warped_blur = cv2.GaussianBlur(warped_gray, (3, 3), 0)
        thresh_img = cv2.adaptiveThreshold(
            warped_blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 5
        )

        page_quality = page_quality_index(warped_gray)
        page_qualities[page_idx] = page_quality

        annotated = warped.copy()

        if page_idx == 0:
            warped_p0_gray = warped_gray
            thresh_p0 = thresh_img

        page_questions = [q for q, slot in slots.items() if slot[0] == page_idx]

        for q in page_questions:
            q_str = str(q)
            _, c, r, top_mm, _ = slots[q]

            col_x_mm = col_x_start + c * col_w_mm
            q_y_mm = top_mm + header_h + header_offset + r * row_h
            cy = int(q_y_mm * scale)

            # Measure each option bubble using the template-driven annulus ROI
            opt_measurements = []
            for i, opt in enumerate(option_labels):
                cx = int((col_x_mm + bubble_offset_x + i * bubble_gap) * scale)
                signals = sample_bubble_roi(warped_gray, thresh_img, cx, cy, bubble_r_px,
                                            grid_roi_inner, grid_roi_outer)
                opt_measurements.append({
                    "option": opt,
                    "cx": cx,
                    "cy": cy,
                    "fill_ratio": signals["fill_ratio"],
                    "adaptive_fill": signals["adaptive_fill"],
                    "mean_intensity": signals["mean_intensity"],
                })

            sorted_opts = sorted(opt_measurements, key=lambda x: x["fill_ratio"], reverse=True)
            best = sorted_opts[0]
            second = sorted_opts[1] if len(sorted_opts) > 1 else None

            min_fill = thresholds["min_fill_ratio"]
            blank_max = thresholds["blank_max_fill"]
            delta = thresholds["ambiguity_delta"]

            best_fill = best["fill_ratio"]
            second_fill = second["fill_ratio"] if second else 0.0
            margin = best_fill - second_fill

            # Classification. `answer` is the AUTHORITATIVE grading input and is
            # non-null ONLY for confident single detections (`state == confident`).
            # `candidate_answer` is the engine's best guess for the reviewer and is
            # null for blank questions (a blank must never silently become an option).
            # `state` is the normalized 4-state label; `status` is preserved for
            # backward compatibility with existing consumers and tests.
            # Blank questions are NOT incorrect and never enter extracted_answers.
            candidate = best["option"] if best_fill >= blank_max else None

            # Case A: Blank / Unattempted
            if best_fill < blank_max:
                status = "blank"
                state = "blank"
                detected_ans = None
                confidence = blank_confidence(best_fill, blank_max)

            # Case B: Multiple Marks (two or more options above the detection floor)
            elif second and second_fill >= min_fill:
                status = "multiple_mark"
                state = "multiple"
                detected_ans = None
                confidence = CONF_MULTIPLE
                flagged_questions.append(q)

                for m in sorted_opts:
                    if m["fill_ratio"] >= min_fill:
                        cv2.circle(annotated, (m["cx"], m["cy"]), bubble_r_px + 4, (0, 0, 255), 3)
                        cv2.putText(annotated, "MULTI", (m["cx"] - 14, m["cy"] - bubble_r_px - 4),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1)

            # Case C: Ambiguous / Low Separation between the two strongest candidates
            elif second and margin < delta:
                status = "ambiguous"
                state = "needs_review"
                detected_ans = None
                confidence = review_confidence(margin, delta, best_fill, blank_max)
                flagged_questions.append(q)

                cv2.circle(annotated, (best["cx"], best["cy"]), bubble_r_px + 4, (0, 165, 255), 3)
                cv2.putText(annotated, "?", (best["cx"] - 4, best["cy"] - bubble_r_px - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 2)

            # Case D: Single Confident Detection (never overwritten by a reviewer guess)
            elif best_fill >= min_fill:
                status = "detected"
                state = "confident"
                detected_ans = best["option"]
                confidence = confident_confidence(best_fill, margin, min_fill, delta, page_quality)

                cv2.circle(annotated, (best["cx"], best["cy"]), bubble_r_px + 4, (34, 197, 94), 3)
                cv2.circle(annotated, (best["cx"], best["cy"]), 2, (34, 197, 94), -1)
                cv2.putText(annotated, best["option"], (best["cx"] - 3, best["cy"] + bubble_r_px + 6),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, (34, 197, 94), 1)

            # Case E: Faint mark below detection floor with no close second
            else:
                status = "ambiguous"
                state = "needs_review"
                detected_ans = None
                confidence = review_confidence(margin, delta, best_fill, blank_max)
                flagged_questions.append(q)
                cv2.circle(annotated, (best["cx"], best["cy"]), bubble_r_px + 4, (0, 165, 255), 2)

            question_results[q_str] = {
                "answer": detected_ans,
                "candidate_answer": candidate,
                "confidence": confidence,
                "status": status,
                "state": state,
                "fill_ratio": round(best_fill, 3),
                "second_fill_ratio": round(second_fill, 3),
                "margin": round(margin, 3),
                "adaptive_fill": round(best["adaptive_fill"], 3),
                "mean_intensity": round(best["mean_intensity"], 1),
            }

            if detected_ans is not None:
                extracted_answers[q_str] = detected_ans

        annotated_pages.append(annotated)

    proc_time_ms = round((time.time() - t_proc_start) * 1000, 2)

    # 4. Identity Grid Sampling (Admission Number)
    admission_number_detection = None
    if identity_cfg and warped_p0_gray is not None:
        try:
            id_x_start = identity_cfg.get("x_start_mm", 139.0)
            id_y_start = identity_cfg.get("y_start_mm", 66.5)
            id_col_gap = identity_cfg.get("col_gap_mm", 8.0)
            id_row_gap = identity_cfg.get("row_gap_mm", 3.2)
            id_bubble_r = identity_cfg.get("bubble_radius_mm", 1.3)
            id_digits = identity_cfg.get("digits", ["0","1","2","3","4","5","6","7","8","9"])

            detected_digits = []
            column_details = []
            ambiguous = False

            for col_idx in range(num_digits):
                col_x = (id_x_start + col_idx * id_col_gap) * scale
                best_digit = None
                best_fill = 0.0
                second_fill = 0.0
                best_cy = None
                fills = []

                for d_idx, digit_label in enumerate(id_digits):
                    cy = (id_y_start + d_idx * id_row_gap) * scale
                    signals = sample_bubble_roi(warped_p0_gray, thresh_p0, int(col_x), int(cy),
                                                int(id_bubble_r * scale), id_roi_inner, id_roi_outer)
                    fill_ratio = signals["fill_ratio"]
                    fills.append({
                        "digit": digit_label,
                        "fill_ratio": round(fill_ratio, 3),
                        "adaptive_fill": round(signals["adaptive_fill"], 3),
                        "intensity": round(signals["mean_intensity"], 1),
                    })
                    if fill_ratio > best_fill:
                        second_fill = best_fill
                        best_fill = fill_ratio
                        best_digit = digit_label
                        best_cy = cy
                    elif fill_ratio > second_fill:
                        second_fill = fill_ratio

                min_fill = thresholds.get("min_fill_ratio", 0.35)
                blank_max = thresholds.get("blank_max_fill", 0.25)
                ambig_delta = thresholds.get("ambiguity_delta", 0.08)

                col_detected_digit = ""
                col_state = "blank"
                col_confidence = blank_confidence(best_fill, blank_max)
                if best_fill < blank_max:
                    detected_digits.append("")
                    ambiguous = True
                elif second_fill >= min_fill:
                    detected_digits.append("")
                    ambiguous = True
                    col_state = "multiple"
                    col_confidence = CONF_MULTIPLE
                elif (best_fill - second_fill) < ambig_delta:
                    detected_digits.append("")
                    ambiguous = True
                    col_state = "needs_review"
                    col_confidence = review_confidence(best_fill - second_fill, ambig_delta, best_fill, blank_max)
                else:
                    detected_digits.append(best_digit)
                    col_detected_digit = best_digit
                    col_state = "confident"
                    col_confidence = confident_confidence(best_fill, best_fill - second_fill, min_fill, ambig_delta, page_qualities.get(0, 1.0))
                    # Highlight detected bubble on page 0 with an emerald green circle
                    if annotated_pages and best_cy is not None:
                        cv2.circle(annotated_pages[0], (int(col_x), int(best_cy)), int(id_bubble_r * scale) + 4, (34, 197, 94), 3)

                column_details.append({
                    "column": col_idx,
                    "detected_digit": col_detected_digit,
                    "state": col_state,
                    "confidence": col_confidence,
                    "fill_ratio": round(best_fill, 3),
                    "second_fill_ratio": round(second_fill, 3),
                    "all_fills": fills,
                })

            raw_adm = "".join(detected_digits)
            canonical_adm = raw_adm.strip()

            # Do NOT silently convert an uncertain read into a confident identity:
            # any unresolved digit routes the sheet to needs_review at the resolver.
            if ambiguous:
                adm_status = "ambiguous"
            elif canonical_adm and len(canonical_adm) == num_digits:
                adm_status = "detected"
            else:
                adm_status = "blank"

            admission_number_detection = {
                "raw": raw_adm,
                "canonical": canonical_adm,
                "status": adm_status,
                "column_details": column_details,
            }
            log_err(f"Identity grid: raw={raw_adm} canonical={canonical_adm} status={adm_status} ambiguous={ambiguous}")
        except Exception as e:
            log_err(f"Identity grid sampling failed: {e}")
            admission_number_detection = {
                "raw": "",
                "canonical": "",
                "status": "blank",
                "column_details": [],
            }

    # 5. Save Annotated Output Image (pages stitched vertically)
    annotated_path = None
    if annotated_output:
        os.makedirs(os.path.dirname(os.path.abspath(annotated_output)), exist_ok=True)
        composed = annotated_pages[0] if len(annotated_pages) == 1 else stitch_pages(annotated_pages)
        cv2.imwrite(annotated_output, composed)
        annotated_path = annotated_output
    elif output_dir:
        os.makedirs(output_dir, exist_ok=True)
        base_name = os.path.splitext(os.path.basename(image_path))[0]
        composed = annotated_pages[0] if len(annotated_pages) == 1 else stitch_pages(annotated_pages)
        annotated_path = os.path.join(output_dir, f"annotated_{base_name}.png")
        cv2.imwrite(annotated_path, composed)

    total_time_ms = round((time.time() - start_time) * 1000, 2)

    # Final overall status
    overall_status = "review_required" if len(flagged_questions) > 0 else "completed"

    return {
        "status": overall_status,
        "engine": "opencv",
        "engine_version": ENGINE_VERSION,
        "template_id": template.get("template_id", "a4_50q_4opt_v1"),
        "total_questions": total_q,
        "options_per_question": opt_count,
        "answers": extracted_answers,
        "extracted_answers": extracted_answers,
        "question_results": question_results,
        "flagged_questions": flagged_questions,
        "flagged_count": len(flagged_questions),
        "admission_number_detection": admission_number_detection,
        "annotated_image": annotated_path,
        "execution_metrics": {
            "image_resolution": [orig_w, orig_h],
            "markers_found": markers_found,
            "pages_processed": len(annotated_pages),
            "alignment_time_ms": align_time_ms,
            "processing_time_ms": proc_time_ms,
            "total_time_ms": total_time_ms,
            "avg_ms_per_question": round(proc_time_ms / max(1, total_q), 3),
            "image_quality": round(float(np.mean(list(page_qualities.values()))) if page_qualities else 1.0, 3)
        }
    }


def main():
    parser = argparse.ArgumentParser(description="ExamOS Computer Vision OMR Evaluator")
    parser.add_argument("--image", required=True, help="Absolute path to OMR image file")
    parser.add_argument("--template", required=True, help="Path to ExamOS template.json")
    parser.add_argument("--questions", type=int, default=None, help="Total question count")
    parser.add_argument("--options", type=int, default=None, help="Options per question (default: 4)")
    parser.add_argument("--output-dir", default=None, help="Directory to save annotated image")
    parser.add_argument("--annotated-output", default=None, help="Exact destination file path for annotated image")
    parser.add_argument("--num-digits", type=int, default=None, help="Override identity_grid num_digits (authoritative over template)")

    args = parser.parse_args()

    result = evaluate_omr(
        image_path=args.image,
        template_path=args.template,
        num_questions=args.questions,
        num_options=args.options,
        output_dir=args.output_dir,
        annotated_output=args.annotated_output,
        num_digits_override=args.num_digits,
    )

    sys.stdout.write(json.dumps(result, indent=2) + "\n")
    sys.stdout.flush()

    if result.get("status") == "failed":
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()