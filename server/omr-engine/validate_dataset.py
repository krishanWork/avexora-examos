#!/usr/bin/env python3
"""
validate_dataset.py — Manifest-driven OMR CV validation runner.

Generates sample sheets from a manifest, runs the evaluator, and reports
accuracy / precision / review-rate against ground truth expectations.

Manifest format (JSON):
{
  "generate": "generate_sample_omr.py",          # optional, defaults next to this file
  "evaluate": "evaluator.py",                    # optional, defaults next to this file
  "template": "templates/a4_50q_4opt_v1.json",
  "out_dir": "/tmp/omr_validate",
  "sheets": [
    {
      "name": "perfect",
      "admission": "004521",
      "questions": 50,
      "answers": {"1": "A", "2": "B"},           # generator answer map (mark styles OK)
      "expected": {"1": "A", "2": "B", "3": "BLANK"}  # "BLANK" or "REVIEW" or an option letter
    }
  ]
}

Expected labels:
  "BLANK"  -> candidate must be null, state "blank"
  "REVIEW" -> state must be "needs_review" or "multiple" (deferred, never fabricated)
  <option> -> state must be "confident" with that exact answer

Metrics:
  accuracy     = accountable matches / accountable questions
  precision    = confident-correct / questions emitted as confident
                 (deferred-to-review items do not count against precision)
  review_rate  = deferred-to-review / accountable questions

Usage:
  python3 validate_dataset.py manifest.json
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REVIEW_STATES = {"needs_review", "multiple"}


def run(cmd):
    subprocess.run(cmd, check=True)


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def evaluate(manifest, name):
    generate = os.path.join(HERE, manifest.get("generate", "generate_sample_omr.py"))
    evaluate = os.path.join(HERE, manifest.get("evaluate", "evaluator.py"))
    template = manifest["template"]
    if not os.path.isabs(template):
        template = os.path.normpath(os.path.join(HERE, template))
    out_dir = manifest.get("out_dir") or os.path.join(tempfile.gettempdir(), "omr_validate")
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix=f"omr_val_{name}_", dir=os.path.join(tempfile.gettempdir()))
    image = os.path.join(tmp, "sheet.png")

    sheet = next((s for s in manifest["sheets"] if s["name"] == name), None)
    if sheet is None:
        sys.exit(f"sheet not found in manifest: {name}")
    print(f"  generating {name} -> {image}")
    gen_args = [
        sys.executable, generate,
        "--template", template,
        "--output", image,
        "--questions", str(sheet.get("questions", 50)),
        "--answers", json.dumps(sheet.get("answers", {})),
    ]
    if sheet.get("admission"):
        gen_args += ["--admission-number", str(sheet["admission"])]
    run(gen_args)

    ev_args = [
        sys.executable, evaluate,
        "--image", image,
        "--template", template,
    ]
    if sheet.get("questions"):
        ev_args += ["--questions", str(sheet["questions"])]
    started = time.time()
    proc = subprocess.run(ev_args, capture_output=True, text=True)
    elapsed = (time.time() - started) * 1000
    if proc.returncode != 0:
        print("  evaluator failed:", proc.stderr[-4000:])
        return None
    result = json.loads(proc.stdout)
    result["_elapsed_ms"] = round(elapsed, 1)
    return result


def summarize_eval(result, expected):
    rows = []
    for q in sorted(expected, key=int):
        want = expected[q]
        got = result.get("question_results", {}).get(str(q), {})
        state = got.get("state")
        answer = got.get("answer")
        candidate = got.get("candidate_answer")
        if want == "BLANK":
            rows.append({"q": q, "want": "BLANK", "state": state, "answer": candidate,
                         "ok": state == "blank" and candidate is None})
        elif want == "REVIEW":
            rows.append({"q": q, "want": "REVIEW", "state": state, "answer": answer,
                         "ok": state in REVIEW_STATES})
        else:
            rows.append({"q": q, "want": want, "state": state, "answer": answer,
                         "ok": state == "confident" and answer == want})
    return rows


def main():
    ap = argparse.ArgumentParser(description="Run OMR CV manifest-driven validation")
    ap.add_argument("manifest")
    ap.add_argument("--show", action="store_true", help="print per-question detail rows")
    args = ap.parse_args()

    manifest = load_manifest(args.manifest)
    total = correct = confident_emitted = confident_correct = review_deferred = 0
    print(f"[validate_dataset] manifest={args.manifest} sheets={len(manifest['sheets'])}")

    all_failed = False
    for sheet in manifest["sheets"]:
        t0 = time.time()
        result = evaluate(manifest, sheet["name"])
        if result is None:
            all_failed = True
            continue
        rows = summarize_eval(result, sheet.get("expected", {}))
        n = len(rows)
        ok = sum(1 for r in rows if r["ok"])
        total += n
        correct += ok
        for r in rows:
            if r["state"] == "confident":
                confident_emitted += 1
                if r["ok"]:
                    confident_correct += 1
            elif r["state"] in REVIEW_STATES:
                review_deferred += 1
        ms = result.get("_elapsed_ms")
        print(
            f"  {sheet['name']}: "
            f"{ok}/{n} | conf_emitted={confident_emitted} "
            f"review={review_deferred} | {ms}ms"
        )
        if args.show and rows:
            for r in rows:
                mark = "ok  " if r["ok"] else "FAIL"
                print(f"    {mark} Q{r['q']} want={r['want']} got={r['state']}/{r['answer']}")
        for r in rows:
            if not r["ok"]:
                all_failed = True

    accuracy = correct / total if total else 0.0
    precision = confident_correct / confident_emitted if confident_emitted else 0.0
    review_rate = review_deferred / total if total else 0.0
    print("=" * 60)
    print(
        f"accountable={total} correct={correct} "
        f"accuracy={accuracy:.3f} precision={precision:.3f} review_rate={review_rate:.3f}"
    )

    budget = manifest.get("budget", {})
    min_accuracy = budget.get("min_accuracy", 0.95)
    min_precision = budget.get("min_precision", 0.95)
    max_review = budget.get("max_review_rate", 0.35)
    passed = (not all_failed and total >= 1
              and accuracy >= min_accuracy
              and precision >= min_precision
              and review_rate <= max_review)
    print(f"budget: accuracy>={min_accuracy} precision>={min_precision} review<={max_review}")
    print("RESULT: PASS" if passed else "RESULT: FAIL")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()