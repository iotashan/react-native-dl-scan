#!/usr/bin/env python3
"""
Compute per-state per-field accuracy from android-results.tsv against
IDNet ground-truth JSON sidecars. Mirrors the iOS eval-2026-05-11.txt
report format so the two pipelines can be compared apples-to-apples.

Iter-7 D-lite probe: when `--region-tsv` is provided (or
`android-results-region.tsv` exists alongside the PROD TSV), the report
also loads the per-YOLO-bbox MLKit pipeline output and renders a
side-by-side PROD-vs-REGION comparison with deltas — matching the
SIMPLE|PRODUCTION|REGION table the iOS eval.py emits.

Usage:
    python3 tools/dlscan-debug-cli/android-eval-report.py \\
        [--tsv tools/dlscan-debug-cli/android-results.tsv] \\
        [--region-tsv tools/dlscan-debug-cli/android-results-region.tsv]

Input TSV columns: STATE \\t IMAGE \\t YOLO_CLASS \\t TEXT
Special YOLO_CLASS values: "EMPTY" (pipeline returned no fields),
                          "ERROR" (pipeline threw or decode failed).
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, Tuple

IDNET = Path("/Volumes/Work4TB/dev/iotashan/idnet-data/extracted")

TRACKED_FIELDS = [
    "list_1", "list_2", "list_3", "list_4a", "list_4b", "list_4d",
    "list_8f", "list_8s", "list_9", "list_9a",
    "list_12", "list_15", "list_16", "list_17", "list_18", "list_19",
]


def normalize(s: str) -> str:
    if s is None:
        return ""
    s = s.replace("''", '"')
    return re.sub(r"\s+", " ", s.strip().upper())


def normalize_license_number(s: str) -> str:
    """OCR-substitution-tolerant for list_4d (I/1, O/0, l/1)."""
    if s is None:
        return ""
    s = s.replace("''", '"').upper()
    s = s.replace("I", "1").replace("O", "0").replace("L", "1")
    return re.sub(r"\s+", " ", s.strip())


def load_ground_truth(state: str, image: str) -> Dict[str, str]:
    state_dir = IDNET / state
    base = Path(image).stem
    j = state_dir / f"{base}.json"
    if not j.exists():
        return {}
    with j.open() as f:
        data = json.load(f)
    out: Dict[str, str] = {}
    for k, v in data.get("fields", {}).items():
        if isinstance(v, dict) and "value" in v:
            out[k] = str(v["value"])
    return out


def load_tsv(path: Path) -> Tuple[Dict[Tuple[str, str], Dict[str, str]], int, int, int]:
    """Parse a results TSV into (state, image) -> {yolo_class: text}.

    Returns (extracted, total_rows, n_empty, n_error). Missing/empty file
    returns an empty extraction with all zero counters.
    """
    extracted: Dict[Tuple[str, str], Dict[str, str]] = defaultdict(dict)
    n_total_rows = 0
    n_empty = n_error = 0
    if not path.exists():
        return extracted, 0, 0, 0
    with path.open() as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            state, image, cls = parts[0], parts[1], parts[2]
            text = parts[3] if len(parts) > 3 else ""
            n_total_rows += 1
            if cls == "EMPTY":
                n_empty += 1
                extracted[(state, image)]  # ensure key exists
                continue
            if cls == "ERROR":
                n_error += 1
                continue
            t = (text.replace("\\\\", "\x00")
                     .replace("\\n", "\n")
                     .replace("\\t", "\t")
                     .replace("\x00", "\\"))
            extracted[(state, image)][cls] = t
    return extracted, n_total_rows, n_empty, n_error


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv", default="tools/dlscan-debug-cli/android-results.tsv")
    ap.add_argument("--region-tsv",
                    default="tools/dlscan-debug-cli/android-results-region.tsv")
    args = ap.parse_args()

    prod_tsv = Path(args.tsv)
    region_tsv = Path(args.region_tsv)
    prod, prod_rows, prod_empty, prod_error = load_tsv(prod_tsv)
    region, region_rows, region_empty, region_error = load_tsv(region_tsv)
    have_region = region_rows > 0

    # Per-state per-field accuracy — PROD pipeline.
    prod_acc: Dict[str, Dict[str, list]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    region_acc: Dict[str, Dict[str, list]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    field_totals_prod: Dict[str, list] = defaultdict(lambda: [0, 0])
    field_totals_region: Dict[str, list] = defaultdict(lambda: [0, 0])
    state_totals_prod: Dict[str, list] = defaultdict(lambda: [0, 0])
    state_totals_region: Dict[str, list] = defaultdict(lambda: [0, 0])
    images_per_state: Dict[str, int] = defaultdict(int)
    divergence_examples: Dict[str, list] = defaultdict(list)

    seen_images = set()
    all_keys = set(prod.keys()) | set(region.keys())
    for (state, image) in sorted(all_keys):
        if (state, image) in seen_images:
            continue
        seen_images.add((state, image))
        images_per_state[state] += 1
        gt = load_ground_truth(state, image)
        prod_fields = prod.get((state, image), {})
        region_fields = region.get((state, image), {})
        for field in TRACKED_FIELDS:
            norm = normalize_license_number if field == "list_4d" else normalize
            want = norm(gt.get(field, ""))
            if not want:
                continue
            got_prod = norm(prod_fields.get(field, ""))
            got_region = norm(region_fields.get(field, "")) if have_region else ""

            # PROD accumulator (only counts images that PROD attempted)
            if (state, image) in prod:
                prod_acc[state][field][1] += 1
                field_totals_prod[field][1] += 1
                state_totals_prod[state][1] += 1
                if got_prod == want:
                    prod_acc[state][field][0] += 1
                    field_totals_prod[field][0] += 1
                    state_totals_prod[state][0] += 1

            # REGION accumulator (only counts images that REGION attempted)
            if have_region and (state, image) in region:
                region_acc[state][field][1] += 1
                field_totals_region[field][1] += 1
                state_totals_region[state][1] += 1
                if got_region == want:
                    region_acc[state][field][0] += 1
                    field_totals_region[field][0] += 1
                    state_totals_region[state][0] += 1

            if have_region and got_prod != got_region and got_region and \
                    len(divergence_examples[field]) < 5:
                divergence_examples[field].append(
                    (state, want, prod_fields.get(field, ""),
                     region_fields.get(field, "")))

    print(f"=== Android Batch Eval — IDNet ground truth ===\n")
    print(f"  PROD   TSV: {prod_tsv}")
    print(f"           rows: {prod_rows}   EMPTY: {prod_empty}   ERROR: {prod_error}")
    if have_region:
        print(f"  REGION TSV: {region_tsv}")
        print(f"           rows: {region_rows}   EMPTY: {region_empty}   ERROR: {region_error}")
    else:
        print(f"  REGION TSV: (not found at {region_tsv}) — single-pipeline report")
    print(f"  Images covered: {sum(images_per_state.values())} across {len(images_per_state)} states")
    print()

    if have_region:
        print("=== Per-State Per-Field Accuracy (PROD | REGION) ===\n")
        header = f"{'STATE':<22} {'FIELD':<10} {'N':>4} {'PROD':>8} {'REGION':>8} {'R-Δ':>7}"
        print(header)
        print("-" * len(header))
        for state in sorted(set(prod_acc.keys()) | set(region_acc.keys())):
            for field in TRACKED_FIELDS:
                p_h, p_n = prod_acc[state].get(field, [0, 0])
                r_h, r_n = region_acc[state].get(field, [0, 0])
                n_show = max(p_n, r_n)
                if n_show == 0:
                    continue
                p_pct = 100.0 * p_h / max(1, p_n) if p_n else 0.0
                r_pct = 100.0 * r_h / max(1, r_n) if r_n else 0.0
                delta = r_pct - p_pct if (p_n and r_n) else 0.0
                print(f"{state:<22} {field:<10} {n_show:>4d} "
                      f"{p_pct:>7.1f}% {r_pct:>7.1f}% {delta:>+6.1f}%")
    else:
        print(f"{'STATE':<22} {'FIELD':<10} {'N':>4} {'ACC':>6}")
        print("-" * 50)
        for state in sorted(prod_acc.keys()):
            for field in TRACKED_FIELDS:
                h, n = prod_acc[state].get(field, [0, 0])
                if n == 0:
                    continue
                pct = 100.0 * h / n
                print(f"{state:<22} {field:<10} {n:>4d} {pct:>5.1f}%")

    print("\n=== Per-State Roll-Up ===\n")
    for state in sorted(set(state_totals_prod.keys()) | set(state_totals_region.keys())):
        p_h, p_n = state_totals_prod[state]
        p_pct = 100.0 * p_h / max(1, p_n) if p_n else 0.0
        if have_region:
            r_h, r_n = state_totals_region[state]
            r_pct = 100.0 * r_h / max(1, r_n) if r_n else 0.0
            d = r_pct - p_pct if (p_n and r_n) else 0.0
            print(f"  {state:<22} N={max(p_n, r_n):>4d}  "
                  f"PROD={p_pct:>5.1f}%  REGION={r_pct:>5.1f}%  (R-P Δ={d:+5.1f}%)  "
                  f"({images_per_state[state]} imgs)")
        else:
            print(f"  {state:<22} N={p_n:>4d}  acc={p_pct:>5.1f}%  ({images_per_state[state]} imgs)")

    print("\n=== Per-Field Roll-Up (all states) ===\n")
    for field in TRACKED_FIELDS:
        p_h, p_n = field_totals_prod[field]
        if p_n == 0 and (not have_region or field_totals_region[field][1] == 0):
            continue
        p_pct = 100.0 * p_h / max(1, p_n) if p_n else 0.0
        if have_region:
            r_h, r_n = field_totals_region[field]
            r_pct = 100.0 * r_h / max(1, r_n) if r_n else 0.0
            d = r_pct - p_pct if (p_n and r_n) else 0.0
            print(f"  {field:<10} N={max(p_n, r_n):>4d}  "
                  f"PROD={p_pct:>5.1f}%  REGION={r_pct:>5.1f}%  (R-P Δ={d:+5.1f}%)")
        else:
            print(f"  {field:<10} N={p_n:>4d}  acc={p_pct:>5.1f}%")

    if have_region and divergence_examples:
        print("\n=== Divergence Examples (PROD vs REGION) ===\n")
        for field in TRACKED_FIELDS:
            if field not in divergence_examples:
                continue
            print(f"  --- {field} ---")
            for state, want, p_val, r_val in divergence_examples[field]:
                print(f"    [{state}] want=\"{want}\"")
                print(f"      PROD:   \"{p_val}\"")
                print(f"      REGION: \"{r_val}\"")

    return 0


if __name__ == "__main__":
    sys.exit(main())
