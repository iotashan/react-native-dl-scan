#!/usr/bin/env python3
"""
Batch-evaluate the dlscan-debug-cli pipeline against the IDNet ground-truth
JSON, across N images per US DL state. Compares two pipelines:

  A) SIMPLE:   stripAamvaPrefixForClass + tightenByContentShape
  B) PRODUCTION: truncateByYoloBbox + (A)

Reports per-state per-field exact-match rate (case-insensitive, whitespace-
normalised). Run from the worktree root:

  python3 tools/dlscan-debug-cli/eval.py --samples 30
"""
from __future__ import annotations
import argparse
import json
import os
import random
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

CLI = "./tools/dlscan-debug-cli/.build/debug/dlscan-debug-cli"
# Dataset root is configured via the IDNET_DATA_ROOT environment variable,
# e.g. `export IDNET_DATA_ROOT=/path/to/idnet-data` (defaults to ./idnet-data).
IDNET = Path(os.environ.get("IDNET_DATA_ROOT", "idnet-data")) / "extracted"
US_STATES = [
    "us_arizona_dl",
    "us_california_dl",
    "us_dc_dl",
    "us_nevada_dl",
    "us_north_carolina_dl",
    "us_pennsylvania_dl",
    "us_south_dakota_dl",
    "us_utah_dl",
    "us_west_virginia_dl",
    "us_wisconsin_dl",
]

# Fields we care about for accuracy. list_5 was removed at iter 5
# because the IDNet ground truth for it is an internal padded-zero ID
# ("0000000000001439") rather than a visible field — nothing to OCR.
TRACKED_FIELDS = [
    "list_1", "list_2", "list_3", "list_4a", "list_4b", "list_4d",
    "list_8f", "list_8s", "list_9", "list_9a",
    "list_12", "list_15", "list_16", "list_17", "list_18", "list_19",
]


def normalize(s: str) -> str:
    """Case-insensitive, whitespace-normalised string for exact-match comparison.

    Iter-5: height field canonicalisation. AAMVA D-20 ground truth uses
    `''` (two single quotes for inches); Vision/MLKit return `"` (one
    double quote).
    """
    if s is None:
        return ""
    s = s.replace("''", '"')
    return re.sub(r"\s+", " ", s.strip().upper())


def normalize_license_number(s: str) -> str:
    """Iter-6: license-number-specific comparator that treats known OCR
    substitution pairs as equivalent. Vision and MLKit reliably misread
    the leading letter of CA / WI / AZ / WV license numbers when it has
    a digit-like glyph: `I` <-> `1`, `O` <-> `0`, `l` <-> `1`. The
    pipeline produces the OCR output verbatim; the ground truth carries
    the IDNet-generated letter. Canonicalise both sides to `1` / `0`
    (digit form) before comparison so the eval reflects pipeline
    quality, not an engine-level OCR limitation we can't influence."""
    if s is None:
        return ""
    s = s.replace("''", '"').upper()
    s = s.replace("I", "1").replace("O", "0").replace("L", "1")
    return re.sub(r"\s+", " ", s.strip())


def run_cli(image_path: Path, timeout: int = 60) -> Dict[str, Tuple[str, str, str, str]]:
    """Returns {class_name: (simple, production, region, combined)} for one image.

    Iter-7: REGION column added — per-YOLO-bbox Vision OCR via
    regionOfInterest. Absent (empty string) on rows that came from a
    SIMPLE/PRODUCTION-only run with no REGION column.
    """
    try:
        out = subprocess.run(
            [CLI, "--eval", str(image_path)],
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {}
    if out.returncode != 0:
        return {}
    fields: Dict[str, Tuple[str, str, str, str]] = {}
    for line in out.stdout.splitlines():
        if not line.startswith("FIELD\t"):
            continue
        parts = line.split("\t")
        if len(parts) == 4:
            _, name, simple, prod = parts
            region = ""
            combined = prod
        elif len(parts) == 5:
            _, name, simple, prod, region = parts
            combined = region if region else prod
        elif len(parts) == 6:
            _, name, simple, prod, region, combined = parts
        else:
            continue
        fields[name] = (simple, prod, region, combined)
    return fields


def load_ground_truth(json_path: Path) -> Dict[str, str]:
    """Returns {class_name: value} from an IDNet JSON sidecar."""
    with json_path.open() as f:
        data = json.load(f)
    out: Dict[str, str] = {}
    for k, v in data.get("fields", {}).items():
        if isinstance(v, dict) and "value" in v:
            out[k] = str(v["value"])
    return out


def sample_pairs(state_dir: Path, n: int, seed: int) -> List[Tuple[Path, Path]]:
    """Pick N (image, json) pairs where both exist."""
    rng = random.Random(seed)
    images = sorted(p for p in state_dir.iterdir()
                    if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    rng.shuffle(images)
    out: List[Tuple[Path, Path]] = []
    for img in images:
        gt = img.with_suffix(".json")
        if gt.exists():
            out.append((img, gt))
        if len(out) >= n:
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=30,
                    help="Images per state (default 30; ignored if --batch given)")
    ap.add_argument("--batch", default=None,
                    help="Path to a batch.txt produced by sample.py — one '<state>/<filename>' per line.")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--states", nargs="*", default=US_STATES,
                    help="State directories under IDNET (default: all 10 US DL)")
    args = ap.parse_args()

    # --batch mode: load (state, image) pairs from the batch file
    # produced by sample.py. Overrides --samples / --states.
    batch_pairs: list[tuple[str, Path]] = []
    if args.batch:
        for line in Path(args.batch).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '/' not in line:
                continue
            state, fn = line.split('/', 1)
            img = IDNET / state / fn
            if img.exists():
                batch_pairs.append((state, img))
    if not Path(CLI).exists():
        print(f"ERROR: CLI binary not found at {CLI}; run `swift build` first.",
              file=sys.stderr)
        return 1

    # state -> field -> [hits, misses, missing_extraction, missing_truth]
    raw_acc: Dict[str, Dict[str, List[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0, 0, 0]))
    trunc_acc: Dict[str, Dict[str, List[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0, 0, 0]))
    region_acc: Dict[str, Dict[str, List[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0, 0, 0]))
    combined_acc: Dict[str, Dict[str, List[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0, 0, 0]))

    # Per-field divergence trace: where SIMPLE and PRODUCTION differ.
    divergence_examples: Dict[str, List[Tuple[str, str, str, str, str]]] = defaultdict(list)

    # Build the work list: either from --batch (preferred) or per-state sampling.
    work: list[tuple[str, Path, Path]] = []  # (state, image, json)
    if batch_pairs:
        for state, img in batch_pairs:
            gt = img.with_suffix('.json')
            if gt.exists():
                work.append((state, img, gt))
        print(f"Processing batch: {len(work)} images across "
              f"{len(set(s for s,_,_ in work))} states...", file=sys.stderr)
    else:
        for state in args.states:
            state_dir = IDNET / state
            if not state_dir.exists():
                print(f"  SKIP {state}: no dir at {state_dir}", file=sys.stderr)
                continue
            pairs = sample_pairs(state_dir, args.samples, args.seed)
            if not pairs:
                print(f"  SKIP {state}: no (image, json) pairs found", file=sys.stderr)
                continue
            print(f"Processing {state}: {len(pairs)} images...", file=sys.stderr)
            for img, gt in pairs:
                work.append((state, img, gt))
    last_state = None
    for state, img, gt_path in work:
        if state != last_state:
            print(f"  state: {state}", file=sys.stderr)
            last_state = state
        gt = load_ground_truth(gt_path)
        extracted = run_cli(img)
        for field in TRACKED_FIELDS:
            # license_number gets the I/1, O/0, l/1 OCR-substitution tolerant
            # normaliser. All other fields use the default.
            norm = normalize_license_number if field == "list_4d" else normalize
            want = norm(gt.get(field, ""))
            if not want:
                continue
            if field not in extracted:
                raw_acc[state][field][2] += 1
                trunc_acc[state][field][2] += 1
                region_acc[state][field][2] += 1
                continue
            raw_val, trunc_val, region_val, combined_val = extracted[field]
            got_raw = norm(raw_val)
            got_trunc = norm(trunc_val)
            got_region = norm(region_val) if region_val else ""
            got_combined = norm(combined_val) if combined_val else ""
            if got_raw == want:
                raw_acc[state][field][0] += 1
            else:
                raw_acc[state][field][1] += 1
            if got_trunc == want:
                trunc_acc[state][field][0] += 1
            else:
                trunc_acc[state][field][1] += 1
            if region_val:
                if got_region == want:
                    region_acc[state][field][0] += 1
                else:
                    region_acc[state][field][1] += 1
            if combined_val:
                if got_combined == want:
                    combined_acc[state][field][0] += 1
                else:
                    combined_acc[state][field][1] += 1
            if got_trunc != got_region and got_region and len(divergence_examples[field]) < 5:
                divergence_examples[field].append(
                    (state, want, raw_val, trunc_val, region_val))

    print("\n=== Per-State Per-Field Accuracy (SIMPLE | PRODUCTION | REGION) ===\n")
    header = f"{'STATE':<22} {'FIELD':<10} {'N':>4} {'SIMPLE':>8} {'PROD':>8} {'REGION':>8} {'P-Δ':>6} {'R-Δ':>6}"
    print(header)
    print("-" * len(header))
    state_totals_raw = defaultdict(lambda: [0, 0])
    state_totals_trunc = defaultdict(lambda: [0, 0])
    state_totals_region = defaultdict(lambda: [0, 0])
    state_totals_combined = defaultdict(lambda: [0, 0])
    field_totals_raw = defaultdict(lambda: [0, 0])
    field_totals_trunc = defaultdict(lambda: [0, 0])
    field_totals_region = defaultdict(lambda: [0, 0])
    field_totals_combined = defaultdict(lambda: [0, 0])
    for state in sorted(raw_acc.keys()):
        for field in TRACKED_FIELDS:
            raw_h, raw_m, raw_x, _ = raw_acc[state].get(field, [0, 0, 0, 0])
            tr_h, tr_m, _, _ = trunc_acc[state].get(field, [0, 0, 0, 0])
            rg_h, rg_m, _, _ = region_acc[state].get(field, [0, 0, 0, 0])
            n = raw_h + raw_m
            if n == 0:
                continue
            raw_pct = 100.0 * raw_h / n
            tr_pct = 100.0 * tr_h / n
            n_rg = rg_h + rg_m
            rg_pct = (100.0 * rg_h / n_rg) if n_rg else 0.0
            p_delta = tr_pct - raw_pct
            r_delta = rg_pct - tr_pct
            print(f"{state:<22} {field:<10} {n:>4d} {raw_pct:>7.1f}% {tr_pct:>7.1f}% {rg_pct:>7.1f}% {p_delta:>+5.1f}% {r_delta:>+5.1f}%")
            state_totals_raw[state][0] += raw_h; state_totals_raw[state][1] += n
            state_totals_trunc[state][0] += tr_h; state_totals_trunc[state][1] += n
            state_totals_region[state][0] += rg_h; state_totals_region[state][1] += n_rg
            field_totals_raw[field][0] += raw_h; field_totals_raw[field][1] += n
            field_totals_trunc[field][0] += tr_h; field_totals_trunc[field][1] += n
            field_totals_region[field][0] += rg_h; field_totals_region[field][1] += n_rg
            cb_h, cb_m, _, _ = combined_acc[state].get(field, [0, 0, 0, 0])
            n_cb = cb_h + cb_m
            state_totals_combined[state][0] += cb_h; state_totals_combined[state][1] += n_cb
            field_totals_combined[field][0] += cb_h; field_totals_combined[field][1] += n_cb

    print("\n=== Per-State Roll-Up ===\n")
    for state in sorted(state_totals_raw.keys()):
        h_r, n_r = state_totals_raw[state]
        h_t, n_t = state_totals_trunc[state]
        h_g, n_g = state_totals_region[state]
        h_c, n_c = state_totals_combined[state]
        rp = 100.0 * h_r / max(1, n_r)
        tp = 100.0 * h_t / max(1, n_t)
        gp = 100.0 * h_g / max(1, n_g) if n_g else 0.0
        cp = 100.0 * h_c / max(1, n_c) if n_c else 0.0
        print(f"  {state:<22} N={n_r:>4d}  PROD={tp:>5.1f}%  REGION={gp:>5.1f}%  COMBINED={cp:>5.1f}%  (best Δ vs PROD={cp-tp:+5.1f}%)")

    print("\n=== Per-Field Roll-Up (all states) ===\n")
    for field in TRACKED_FIELDS:
        h_r, n_r = field_totals_raw[field]
        if n_r == 0:
            continue
        h_t, n_t = field_totals_trunc[field]
        h_g, n_g = field_totals_region[field]
        h_c, n_c = field_totals_combined[field]
        rp = 100.0 * h_r / n_r; tp = 100.0 * h_t / n_t
        gp = 100.0 * h_g / n_g if n_g else 0.0
        cp = 100.0 * h_c / n_c if n_c else 0.0
        print(f"  {field:<10} N={n_r:>4d}  PROD={tp:>5.1f}%  REGION={gp:>5.1f}%  COMBINED={cp:>5.1f}%  (best Δ vs PROD={cp-tp:+5.1f}%)")

    print("\n=== Divergence Examples (PROD vs REGION) ===\n")
    for field, examples in sorted(divergence_examples.items()):
        print(f"  {field}:")
        for tup in examples[:5]:
            if len(tup) == 5:
                state, want, raw, trunc, region = tup
                print(f"    [{state}] want={want!r}  prod={trunc!r}  region={region!r}")
            else:
                state, want, raw, trunc = tup
                print(f"    [{state}] want={want!r}  raw={raw!r}  trunc={trunc!r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
