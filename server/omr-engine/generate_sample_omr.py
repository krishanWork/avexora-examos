#!/usr/bin/env python3
"""
generate_sample_omr.py - ExamOS Synthetic OMR Sheet Generator

Generates high-fidelity synthetic OMR sheet images conforming strictly to the
ExamOS A4 PDF geometry specified in src/lib/generateOMRSheetPDF.js.

Used for Level 1 & Level 2 automated computer-vision verification.
"""

import argparse
import json
import math
import os
import sys
import cv2
import numpy as np


def create_base_canvas(template):
    """Creates a white A4 canvas and draws ExamOS layout conforming to template geometry."""
    canvas_cfg = template["canvas"]
    w = canvas_cfg["width"]
    h = canvas_cfg["height"]
    scale = canvas_cfg["scale_px_per_mm"]

    # White A4 canvas (BGR)
    img = np.full((h, w, 3), 255, dtype=np.uint8)

    # 1. Draw 4 Corner Alignment Markers
    markers = template["alignment_markers"]["expected_bounding_box_px"]
    for key in ["top_left", "top_right", "bottom_left", "bottom_right"]:
        bx, by, bw, bh = markers[key]
        # Fill solid black rectangle
        cv2.rectangle(img, (bx, by), (bx + bw, by + bh), (0, 0, 0), -1)

    # 2. Draw Header Branding, Exam Info, Candidate Boxes
    # Divider line at y = 35mm
    y_div = int(35.0 * scale)
    cv2.line(img, (int(18 * scale), y_div), (int(192 * scale), y_div), (59, 130, 246), int(1.0 * scale))

    # Exam Info box: y = 39mm, h = 10mm
    y_info = int(39.0 * scale)
    h_info = int(10.0 * scale)
    cv2.rectangle(img, (int(18 * scale), y_info), (int(192 * scale), y_info + h_info), (245, 246, 250), -1)
    cv2.rectangle(img, (int(18 * scale), y_info), (int(192 * scale), y_info + h_info), (180, 180, 180), 2)
    cv2.putText(img, "Exam: Term Examination - Mathematics", (int(21 * scale), y_info + int(6.5 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (40, 40, 40), 2)

    # Candidate details & Admission Number blocks: y = 51mm, h = 48mm
    y_cand = int(51.0 * scale)
    h_cand = int(48.0 * scale)

    # Left: Candidate Details (x: 18mm to 122mm, w: 104mm)
    cv2.rectangle(img, (int(18 * scale), y_cand), (int(122 * scale), y_cand + int(14 * scale)), (160, 160, 160), 2)
    cv2.putText(img, "CANDIDATE NAME", (int(20.5 * scale), y_cand + int(4.2 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1)

    cv2.rectangle(img, (int(18 * scale), y_cand + int(16.5 * scale)), (int(68 * scale), y_cand + int(30.5 * scale)), (160, 160, 160), 2)
    cv2.putText(img, "CLASS / SECTION", (int(20.5 * scale), y_cand + int(20.7 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1)

    cv2.rectangle(img, (int(72 * scale), y_cand + int(16.5 * scale)), (int(122 * scale), y_cand + int(30.5 * scale)), (160, 160, 160), 2)
    cv2.putText(img, "ROLL NUMBER", (int(74.5 * scale), y_cand + int(20.7 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1)

    cv2.rectangle(img, (int(18 * scale), y_cand + int(33.0 * scale)), (int(68 * scale), y_cand + h_cand), (160, 160, 160), 2)
    cv2.putText(img, "DATE", (int(20.5 * scale), y_cand + int(37.2 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1)

    cv2.rectangle(img, (int(72 * scale), y_cand + int(33.0 * scale)), (int(122 * scale), y_cand + h_cand), (160, 160, 160), 2)
    cv2.putText(img, "SUBJECT", (int(74.5 * scale), y_cand + int(37.2 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1)

    # Right: Admission Number Box (x: 126mm to 192mm, w: 66mm, h: 48mm)
    cv2.rectangle(img, (int(126 * scale), y_cand), (int(192 * scale), y_cand + h_cand), (150, 150, 150), 2)
    cv2.rectangle(img, (int(126 * scale), y_cand), (int(192 * scale), y_cand + int(6.0 * scale)), (245, 246, 250), -1)
    cv2.putText(img, "ADMISSION NUMBER", (int(142 * scale), y_cand + int(4.3 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (60, 60, 60), 1)

    # Instructions at y = 102.5mm
    cv2.putText(img, "INSTRUCTIONS: Darken the circle completely with blue/black pen. Do not fold corner markers.",
                (int(18 * scale), int(102.5 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 100, 100), 1)

    return img


def parse_marks(q_ans):
    """
    Normalizes an `answers` value into a list of mark dicts.

    Accepted forms (backward compatible with plain strings / lists):
      "A"                      -> full mark on A
      "A,B" | ["A","B"]        -> full marks on A and B
      {"option":"A","style":"light","color":120,"radius_frac":0.6,"erased":false}
      [{"option":"B","style":"partial"}, ...]

    Styles: full (default), light (pale pencil), partial (smaller dark mark),
    ghost (faint mark with an erasure overlay) — used to simulate realistic
    student marks / erasures for CV validation; blanks are always just printed.
    """
    marks = []
    if q_ans is None:
        return marks
    if isinstance(q_ans, dict):
        items = [q_ans]
    elif isinstance(q_ans, list):
        items = q_ans
    elif isinstance(q_ans, str) and q_ans.strip():
        items = [x.strip() for x in q_ans.split(",") if x.strip()]
    else:
        items = []

    for item in items:
        if isinstance(item, dict):
            opt = str(item.get("option", "")).strip().upper()
            if not opt:
                continue
            style = str(item.get("style", "full")).lower()
            if style not in ("full", "light", "partial", "ghost"):
                style = "full"
            marks.append({
                "option": opt,
                "style": style,
                "color": int(item.get("color", 25)),
                "radius_frac": float(item.get("radius_frac", 1.0)),
                "erased": bool(item.get("erased", False)),
            })
        else:
            opt = str(item).strip().upper()
            if opt:
                marks.append({"option": opt, "style": "full", "color": 25, "radius_frac": 1.0, "erased": False})
    return marks


def draw_mark(img, cx, cy, bubble_r_px, mark):
    """Draws one student mark on a bubble according to its style."""
    color = max(0, min(255, mark["color"]))
    fill = (color, color, color)
    edge = (min(60, color + 8),) * 3
    if mark["style"] == "light":
        r = max(2, int(bubble_r_px * min(mark["radius_frac"], 0.98)))
        cv2.circle(img, (cx, cy), r, fill, -1)
        cv2.circle(img, (cx, cy), r, edge, 1)
    elif mark["style"] == "partial":
        r = max(2, int(bubble_r_px * min(mark["radius_frac"], 0.6)))
        cv2.circle(img, (cx, cy), r, fill, -1)
        cv2.circle(img, (cx, cy), r, edge, 1)
    elif mark["style"] == "ghost":
        r = max(2, int(bubble_r_px * 0.6))
        cv2.circle(img, (cx, cy), r, fill, -1)
        er = max(1, int(bubble_r_px * 0.35))
        cv2.circle(img, (int(cx + 2), int(cy + 1)), er, (255, 255, 255), -1)
    else:  # full
        r = max(2, int(bubble_r_px * mark["radius_frac"]) - 1)
        cv2.circle(img, (cx, cy), r, fill, -1)
        cv2.circle(img, (cx, cy), r + 1, edge, 2)
    if mark["erased"]:
        er = max(1, int(bubble_r_px * 0.5))
        cv2.circle(img, (cx + 3, cy + 1), er, (255, 255, 255), -1)


def draw_grid_and_bubbles(img, template, answers=None, num_questions=None, admission_number=None):
    """Draws column headers, question numbers, bubble outlines, and marks specified answers."""
    grid = template["grid"]
    scale = template["canvas"]["scale_px_per_mm"]

    total_q = num_questions or grid["num_questions"]
    num_cols = grid["num_cols"]
    rows_per_col = grid["rows_per_col"]
    col_w_px = int(grid["col_width_mm"] * scale)
    col_x_start = grid["col_x_start_mm"]
    grid_top = grid["grid_top_mm"]
    header_h = grid["header_height_mm"]
    header_offset = grid["header_offset_mm"]
    row_h = grid["row_height_mm"]
    bubble_offset_x = grid["bubble_offset_x_mm"]
    bubble_gap = grid["bubble_gap_mm"]
    bubble_r_px = int(grid["bubble_radius_mm"] * scale)
    option_labels = grid["option_labels"]

    answers = answers or {}

    # Coordinate mapping dict to return ground truth bubble centers
    bubble_centers = {}

    for c in range(num_cols):
        col_start_q = c * rows_per_col
        if col_start_q >= total_q:
            break

        count = min(rows_per_col, total_q - col_start_q)
        col_x_mm = col_x_start + c * grid["col_width_mm"]
        col_x_px = int(col_x_mm * scale)
        top_y_px = int(grid_top * scale)

        # Draw Column Header
        header_h_px = int(header_h * scale)
        cv2.rectangle(img, (col_x_px, top_y_px), (col_x_px + col_w_px - int(3 * scale), top_y_px + int(5.4 * scale)),
                      (59, 130, 246), -1)
        cv2.putText(img, "Q", (col_x_px + int(2.5 * scale), top_y_px + int(4.0 * scale)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        for i, opt in enumerate(option_labels):
            ox = int((col_x_mm + bubble_offset_x + i * bubble_gap) * scale)
            cv2.putText(img, opt, (ox - 7, top_y_px + int(4.0 * scale)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

        # Draw Column Box Outline
        box_h_px = int((header_h - 1.6 + count * row_h + 2) * scale)
        cv2.rectangle(img, (col_x_px, top_y_px), (col_x_px + col_w_px - int(3 * scale), top_y_px + box_h_px),
                      (220, 220, 220), 1)

        # Draw Questions in Column
        for r in range(count):
            q_num = col_start_q + r + 1
            if q_num > total_q:
                break

            q_y_mm = grid_top + header_h + header_offset + r * row_h
            q_y_px = int(q_y_mm * scale)

            # Question Number
            cv2.putText(img, str(q_num), (col_x_px + int(2.0 * scale), q_y_px + int(1.4 * scale)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (40, 40, 40), 1)

            bubble_centers[str(q_num)] = {}

            # Option Bubbles
            q_ans = answers.get(str(q_num))
            q_marks = parse_marks(q_ans)
            marked_options = {m["option"] for m in q_marks}

            for i, opt in enumerate(option_labels):
                cx = int((col_x_mm + bubble_offset_x + i * bubble_gap) * scale)
                cy = q_y_px
                bubble_centers[str(q_num)][opt] = (cx, cy)

                if opt in marked_options:
                    for m in q_marks:
                        if m["option"] == opt:
                            draw_mark(img, cx, cy, bubble_r_px, m)
                else:
                    # Empty bubble: thin gray outline and small inner letter
                    cv2.circle(img, (cx, cy), bubble_r_px, (100, 100, 100), 2)
                    cv2.putText(img, opt, (cx - 6, cy + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (150, 150, 150), 1)

    # Draw Admission Number Grid & Bubbles if identity_grid is present
    id_cfg = template.get("identity_grid")
    if id_cfg:
        id_x_start = id_cfg.get("x_start_mm", 139.0)
        id_y_start = id_cfg.get("y_start_mm", 66.5)
        id_col_gap = id_cfg.get("col_gap_mm", 8.0)
        id_row_gap = id_cfg.get("row_gap_mm", 3.2)
        id_bubble_r_px = int(id_cfg.get("bubble_radius_mm", 1.3) * scale)
        num_digits = id_cfg.get("num_digits", 6)
        digits = id_cfg.get("digits", ["0","1","2","3","4","5","6","7","8","9"])

        adm_str = str(admission_number or "").strip()
        if adm_str and adm_str.isdigit():
            adm_str = adm_str.zfill(num_digits)[-num_digits:]

        digit_box_w = int(6.0 * scale)
        digit_box_h = int(5.0 * scale)
        digit_box_y = int(58.5 * scale)

        for c in range(num_digits):
            cx = int((id_x_start + c * id_col_gap) * scale)
            bx = cx - digit_box_w // 2
            cv2.rectangle(img, (bx, digit_box_y), (bx + digit_box_w, digit_box_y + digit_box_h), (120, 120, 120), 1)
            char = adm_str[c] if c < len(adm_str) else ""
            if char:
                cv2.putText(img, char, (cx - 5, digit_box_y + int(3.8 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (20, 20, 20), 1)

        for d_idx, d_label in enumerate(digits):
            ry = int((id_y_start + d_idx * id_row_gap) * scale)
            cv2.putText(img, d_label, (int((id_x_start - 7.0) * scale), ry + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (100, 100, 100), 1)
            for c in range(num_digits):
                cx = int((id_x_start + c * id_col_gap) * scale)
                is_marked = (c < len(adm_str) and adm_str[c] == d_label)
                if is_marked:
                    cv2.circle(img, (cx, ry), id_bubble_r_px - 1, (25, 25, 25), -1)
                    cv2.circle(img, (cx, ry), id_bubble_r_px, (30, 30, 30), 2)
                else:
                    cv2.circle(img, (cx, ry), id_bubble_r_px, (100, 100, 100), 1)
                    cv2.putText(img, d_label, (cx - 3, ry + 3), cv2.FONT_HERSHEY_SIMPLEX, 0.25, (140, 140, 140), 1)

    return img, bubble_centers


def apply_distortions(img, rotation=0.0, perspective=False, blur=0, brightness=1.0, noise=False):
    """Applies realistic scanner / smartphone image perturbations."""
    h, w = img.shape[:2]

    # 1. Brightness & Contrast
    if brightness != 1.0:
        img = np.clip(img.astype(np.float32) * brightness, 0, 255).astype(np.uint8)

    # 2. Rotation
    if abs(rotation) > 0.01:
        M = cv2.getRotationMatrix2D((w / 2, h / 2), rotation, 1.0)
        img = cv2.warpAffine(img, M, (w, h), borderValue=(255, 255, 255), flags=cv2.INTER_LINEAR)

    # 3. Perspective Warp (simulating handheld smartphone photograph)
    if perspective:
        src_pts = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        # Displace corners slightly (e.g. 20-35px keystone)
        dst_pts = np.float32([
            [35, 25],
            [w - 20, 45],
            [w - 45, h - 30],
            [20, h - 20]
        ])
        M_p = cv2.getPerspectiveTransform(src_pts, dst_pts)
        img = cv2.warpPerspective(img, M_p, (w, h), borderValue=(255, 255, 255), flags=cv2.INTER_LINEAR)

    # 4. Blur
    if blur > 1:
        k = blur if blur % 2 == 1 else blur + 1
        img = cv2.GaussianBlur(img, (k, k), 0)

    # 5. Gaussian Noise
    if noise:
        gauss = np.random.normal(0, 8, img.shape).astype(np.int16)
        noisy = np.clip(img.astype(np.int16) + gauss, 0, 255).astype(np.uint8)
        img = noisy

    return img


def generate_omr(template_path, output_path, answers=None, num_questions=None, admission_number=None,
                 rotation=0.0, perspective=False, blur=0, brightness=1.0, noise=False):
    """Generates complete synthetic sheet and saves to disk."""
    with open(template_path, "r") as f:
        template = json.load(f)

    img = create_base_canvas(template)
    img, bubble_centers = draw_grid_and_bubbles(img, template, answers=answers, num_questions=num_questions, admission_number=admission_number)
    img = apply_distortions(img, rotation=rotation, perspective=perspective, blur=blur,
                            brightness=brightness, noise=noise)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    cv2.imwrite(output_path, img)
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic ExamOS OMR sheets")
    parser.add_argument("--template", default=os.path.join(os.path.dirname(__file__), "templates", "a4_50q_4opt_v1.json"))
    parser.add_argument("--output", required=True, help="Destination PNG/JPG path")
    parser.add_argument("--answers", default="{}", help="JSON string or path to answers dict e.g. '{\"1\":\"A\",\"2\":\"C\"}'")
    parser.add_argument("--admission-number", default="001002", help="Admission number to bubble (e.g. 001002)")
    parser.add_argument("--questions", type=int, default=None, help="Override number of questions")
    parser.add_argument("--rotation", type=float, default=0.0, help="Rotation in degrees (e.g. -2.5)")
    parser.add_argument("--perspective", action="store_true", help="Apply perspective tilt")
    parser.add_argument("--blur", type=int, default=0, help="Gaussian blur kernel size (e.g. 3)")
    parser.add_argument("--brightness", type=float, default=1.0, help="Brightness multiplier (0.8 - 1.2)")
    parser.add_argument("--noise", action="store_true", help="Add gaussian camera noise")

    args = parser.parse_args()

    answers = {}
    if args.answers:
        if os.path.exists(args.answers):
            with open(args.answers, "r") as f:
                answers = json.load(f)
        else:
            answers = json.loads(args.answers)

    out = generate_omr(
        template_path=args.template,
        output_path=args.output,
        answers=answers,
        num_questions=args.questions,
        admission_number=args.admission_number,
        rotation=args.rotation,
        perspective=args.perspective,
        blur=args.blur,
        brightness=args.brightness,
        noise=args.noise,
    )
    print(json.dumps({"success": True, "output_path": out, "answers": answers, "admission_number": args.admission_number}))


if __name__ == "__main__":
    main()
