#!/usr/bin/env python3
"""
Sample fresh IDNet images for an eval iteration, with two invariants:

  1. No image is reused across iterations (per platform).
  2. State frequency is proportional to US population — so license #
     formats that show up more in the wild get more eval coverage.

Stores state in tools/dlscan-debug-cli/used-images.txt (one image filename
per line, format `<state>/<filename>`). The same file is shared across
platforms because the user explicitly OK'd reusing the same image on
iOS + Android within a single iteration (the per-platform constraint is
about ITERATIONS, not platforms).

Usage:
    python3 tools/dlscan-debug-cli/sample.py --n 100 [--seed 42] [--out batch.txt]
    # Then drive the eval against the file with:
    #   bash tools/dlscan-debug-cli/android-eval.sh --batch batch.txt
    #   python3 tools/dlscan-debug-cli/eval.py --batch batch.txt
"""
from __future__ import annotations
import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

IDNET = Path("/Volumes/Work4TB/dev/iotashan/idnet-data/extracted")
USED_FILE = Path("tools/dlscan-debug-cli/used-images.txt")

# US Census 2023 mid-year estimates (millions). Source:
# https://www.census.gov/programs-surveys/popest/datasets.html
# Restricted to the states represented in the IDNet US DL corpus.
STATE_POP = {
    "us_california_dl":     39.0,
    "us_pennsylvania_dl":   13.0,
    "us_north_carolina_dl": 10.8,
    "us_arizona_dl":         7.4,
    "us_wisconsin_dl":       5.9,
    "us_utah_dl":            3.4,
    "us_nevada_dl":          3.2,
    "us_west_virginia_dl":   1.8,
    "us_south_dakota_dl":    0.9,
    "us_dc_dl":              0.67,
}


def load_used() -> set[str]:
    if not USED_FILE.exists():
        return set()
    return {line.strip() for line in USED_FILE.read_text().splitlines() if line.strip()}


def append_used(items: list[str]) -> None:
    USED_FILE.parent.mkdir(parents=True, exist_ok=True)
    with USED_FILE.open("a") as f:
        for x in items:
            f.write(x + "\n")


def per_state_counts(n: int) -> dict[str, int]:
    """Largest-remainder method to distribute N proportional to population."""
    total = sum(STATE_POP.values())
    raw = {s: n * (p / total) for s, p in STATE_POP.items()}
    floors = {s: int(v) for s, v in raw.items()}
    remainder = n - sum(floors.values())
    # Distribute leftover by largest fractional part.
    fracs = sorted(((raw[s] - floors[s], s) for s in raw), reverse=True)
    for i in range(remainder):
        floors[fracs[i][1]] += 1
    return floors


def pick_for_state(state: str, want: int, used: set[str], rng: random.Random) -> list[str]:
    state_dir = IDNET / state
    if not state_dir.is_dir():
        return []
    images = sorted(p.name for p in state_dir.iterdir()
                    if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
                    and (p.with_suffix(".json")).exists())
    rng.shuffle(images)
    picked: list[str] = []
    for fn in images:
        key = f"{state}/{fn}"
        if key in used:
            continue
        picked.append(key)
        if len(picked) >= want:
            break
    return picked


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100, help="Total images to draw")
    ap.add_argument("--seed", type=int, default=None,
                    help="RNG seed (default: derive from current used count for stable but advancing draws)")
    ap.add_argument("--out", default="tools/dlscan-debug-cli/batch.txt",
                    help="Where to write the chosen batch")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show plan but don't update used-images.txt")
    ap.add_argument("--reset", action="store_true",
                    help="Wipe used-images.txt before sampling (use with care)")
    args = ap.parse_args()

    if args.reset:
        if USED_FILE.exists():
            USED_FILE.unlink()
        print(f"WIPED {USED_FILE}", file=sys.stderr)

    used = load_used()
    # If no explicit seed, derive one from used count so successive runs
    # without a seed advance through the deck deterministically.
    seed = args.seed if args.seed is not None else (42 + len(used))
    rng = random.Random(seed)

    counts = per_state_counts(args.n)
    print(f"=== sample.py — n={args.n}, seed={seed}, already_used={len(used)} ===",
          file=sys.stderr)
    print(f"Per-state target counts (US Census-proportional):", file=sys.stderr)
    for state, k in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {state:<25} {k:>4d}", file=sys.stderr)

    chosen: list[str] = []
    short: dict[str, int] = {}
    for state, k in counts.items():
        got = pick_for_state(state, k, used, rng)
        chosen.extend(got)
        if len(got) < k:
            short[state] = k - len(got)

    if short:
        print(f"\nWARNING: ran out of unused images for {short}", file=sys.stderr)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(chosen) + "\n")
    print(f"\nWrote {len(chosen)} entries to {out}", file=sys.stderr)

    if not args.dry_run:
        append_used(chosen)
        print(f"Appended to {USED_FILE} (now {len(used) + len(chosen)} used)",
              file=sys.stderr)
    else:
        print("(dry-run: used-images.txt NOT updated)", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
