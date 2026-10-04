#!/usr/bin/env python3
"""
generate-golden.py - Phase 0 baseline accuracy gate.

Regenerates the committed golden fixtures used as the parity contract for the
JS engine (scripts/omr-parity-check.mjs). It drives the ORIGINAL Python
generator + evaluator over a deterministic manifest and persists:

  server/omr-engine/golden/omr-golden-<name>.png   exact generated sheet
  server/omr-engine/golden/omr-golden-<name>.json  full evaluator result
  server/omr-engine/golden/manifest.json           reproducibility record

Every case is deterministic (no noise). PNG + JSON are required inputs for the
Phase-5 parity gate, which asserts the JS evaluator reproduces these results
on the exact golden pixels.

Usage:
  .venv/bin/python server/omr-engine/golden/generate-golden.py
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.dirname(HERE)
TEMPLATES = os.path.join(ENGINE_DIR, "templates")
GENERATOR = os.path.join(ENGINE_DIR, "generate_sample_omr.py")
EVALUATOR = os.path.join(ENGINE_DIR, "evaluator.py")

T20 = os.path.join(TEMPLATES, "a4_20q_4opt_v1.json")
T50 = os.path.join(TEMPLATES, "a4_50q_4opt_v1.json")

KNOWN_50 = {"1": "A", "2": "B", "3": "C", "4": "D", "5": "A", "10": "C", "25": "B", "50": "D"}

MANIFEST = [
    {"name": "perfect", "template": T50, "answers": KNOWN_50, "admission": "004521"},
    {"name": "rotated", "template": T50, "answers": KNOWN_50, "admission": "004521", "rotation": -1.5},
    {"name": "perspective", "template": T50, "answers": KNOWN_50, "admission": "004521", "perspective": True},
    {"name": "blur_brightness", "template": T50, "answers": KNOWN_50, "admission": "004521", "blur": 3, "brightness": 1.05},
    {"name": "blank_only", "template": T20, "answers": {}, "questions": 20},
    {"name": "multi_mark", "template": T20, "answers": {"1": "A", "2": "C", "3": ["A", "B"]}, "questions": 20},
    {"name": "mark_styles", "template": T20, "questions": 20,
     "answers": {
         "1": {"option": "A", "style": "light", "color": 130},
         "2": {"option": "B", "style": "partial"},
         "12": {"option": "A", "style": "full", "color": 15},
         "13": {"option": "B", "style": "light", "color": 110},
         "14": {"option": "C", "style": "full", "color": 50},
     }},
    {"name": "close_margin", "template": T20, "questions": 20,
     "answers": {"10": [{"option": "A", "style": "partial"}, {"option": "B", "style": "partial"}]}},
    {"name": "erasure", "template": T20, "questions": 20,
     "answers": {"7": [{"option": "A", "style": "ghost"}, {"option": "B", "style": "full"}]}},
    {"name": "identity", "template": T20, "admission": "004521", "questions": 30,
     "answers": {"1": "A", "15": "D", "20": "C"}},
]


def run_gen(spec, png_path):
    args = [sys.executable, GENERATOR, "--template", spec["template"],
            "--output", png_path, "--answers", json.dumps(spec["answers"])]
    if spec.get("questions"):
        args += ["--questions", str(spec["questions"])]
    if spec.get("admission"):
        args += ["--admission-number", str(spec["admission"])]
    if spec.get("rotation"):
        args += ["--rotation", str(spec["rotation"])]
    if spec.get("perspective"):
        args += ["--perspective"]
    if spec.get("blur"):
        args += ["--blur", str(spec["blur"])]
    if spec.get("brightness"):
        args += ["--brightness", str(spec["brightness"])]
    subprocess.run(args, check=True)


def run_eval(spec, png_path):
    args = [sys.executable, EVALUATOR, "--image", png_path, "--template", spec["template"]]
    if spec.get("questions"):
        args += ["--questions", str(spec["questions"])]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"evaluator failed for {spec['name']}: {proc.stderr[-4000:]}")
    return json.loads(proc.stdout)


def main():
    manifest_records = []
    for spec in MANIFEST:
        name = spec["name"]
        png_path = os.path.join(HERE, f"omr-golden-{name}.png")
        json_path = os.path.join(HERE, f"omr-golden-{name}.json")
        run_gen(spec, png_path)
        result = run_eval(spec, png_path)
        with open(json_path, "w") as f:
            json.dump(result, f, indent=2)
        manifest_records.append({k: v for k, v in spec.items() if k != "answers"})
        print(f"  {name}: status={result['status']} flagged={result['flagged_count']} "
              f"adm={result.get('admission_number_detection', {}).get('canonical')}")
    with open(os.path.join(HERE, "manifest.json"), "w") as f:
        json.dump({"engine_version": "1.2.0", "generator": "generate_sample_omr.py",
                   "evaluator": "evaluator.py", "cases": manifest_records}, f, indent=2)
    print("golden fixtures written to", HERE)


if __name__ == "__main__":
    main()