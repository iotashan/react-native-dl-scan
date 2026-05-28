"""
harvest_telemetry.py — turn DlScanAndroid TELEMETRY logcat lines into a
hard-negative-mining signal for the YOLO field-detector retrain pipeline.

Pipeline:
    adb logcat -d | grep TELEMETRY | python harvest_telemetry.py > signal.json

Each emitted JSON record per logcat line:
    {
      "ts": "<epoch_ms>",
      "corner_cache_hits": <int>,
      "corner_cache_misses": <int>,
      "last_cache_age_ms": <int|-1>,
      "demo_gates": {
        "accepted": <int>, "fail_index": <int>, "fail_label": <int>,
        "fail_domain": <int>, "fail_ambig": <int>
      },
      "demo_seen": <int>,
      "prefix_mismatch": { "<yolo_class>": <count>, ... }
    }

Aggregation (`--summary`):
    Prints per-class prefix-mismatch totals + demographic-parser gate
    breakdowns, sorted by mismatch volume. These are the candidate
    "hard negatives" the retrain should up-weight.

Why this lives in tools and not the C++ test harness: the data source is
production device captures, not synthetic IDNet samples. The retrain loop
itself stays in model-training/train_field_detector.py — this script just
produces the JSON that gets fed to the loader's hard_negative_mining flag
(which doesn't exist yet — see task #31 in TaskList).

Per round-6 review: dozens of mismatch events per class are needed before
this signal is statistically actionable. A single device session won't
suffice — expect to accumulate across many real captures over days.
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from typing import Any

# Pattern matches Android logcat lines that DlScanAndroid emits at the 2 s
# throttle. Example:
#   05-10 17:28:43.538 31610 31920 I DlScanAndroid: TELEMETRY corner_cache=0h/0m last_cache_age_ms=-1 demo_gates=0ok/4idx/1lbl/2dom/0amb demo_seen=7 prefix_mismatch=[list_15:1,list_16:1]
TELEMETRY_RE = re.compile(
    r"(?P<ts>\d{2}-\d{2}\s+[\d:.]+)\s+\d+\s+\d+\s+I\s+DlScanAndroid:\s+TELEMETRY\s+"
    r"corner_cache=(?P<hits>\d+)h/(?P<misses>\d+)m\s+"
    r"last_cache_age_ms=(?P<age>-?\d+)\s+"
    r"demo_gates=(?P<ok>\d+)ok/(?P<idx>\d+)idx/(?P<lbl>\d+)lbl/(?P<dom>\d+)dom/(?P<amb>\d+)amb\s+"
    r"demo_seen=(?P<seen>\d+)\s+"
    r"prefix_mismatch=\[(?P<mismatch>[^\]]*)\]"
)


def parse_mismatch(s: str) -> dict[str, int]:
    """Parse `list_15:1,list_16:1` → {"list_15": 1, "list_16": 1}."""
    out: dict[str, int] = {}
    s = s.strip()
    if not s:
        return out
    for pair in s.split(","):
        pair = pair.strip()
        if not pair or ":" not in pair:
            continue
        k, v = pair.split(":", 1)
        try:
            out[k.strip()] = int(v.strip())
        except ValueError:
            pass
    return out


def parse_line(line: str) -> dict[str, Any] | None:
    m = TELEMETRY_RE.search(line)
    if not m:
        return None
    return {
        "ts": m.group("ts"),
        "corner_cache_hits": int(m.group("hits")),
        "corner_cache_misses": int(m.group("misses")),
        "last_cache_age_ms": int(m.group("age")),
        "demo_gates": {
            "accepted":   int(m.group("ok")),
            "fail_index": int(m.group("idx")),
            "fail_label": int(m.group("lbl")),
            "fail_domain": int(m.group("dom")),
            "fail_ambig": int(m.group("amb")),
        },
        "demo_seen": int(m.group("seen")),
        "prefix_mismatch": parse_mismatch(m.group("mismatch")),
    }


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate across all records — what the retrain loop wants."""
    by_class: dict[str, int] = defaultdict(int)
    gates_total = defaultdict(int)
    cache_hits = 0
    cache_misses = 0
    demo_seen = 0
    for r in records:
        for cls, n in r["prefix_mismatch"].items():
            by_class[cls] += n
        for k, v in r["demo_gates"].items():
            gates_total[k] += v
        cache_hits += r["corner_cache_hits"]
        cache_misses += r["corner_cache_misses"]
        demo_seen += r["demo_seen"]
    return {
        "frames_observed": len(records),
        "corner_cache_hits_total":  cache_hits,
        "corner_cache_misses_total": cache_misses,
        "demo_seen_total": demo_seen,
        "demo_gates_total": dict(gates_total),
        "prefix_mismatch_by_class": dict(
            sorted(by_class.items(), key=lambda kv: kv[1], reverse=True)
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse DlScanAndroid TELEMETRY logcat lines into JSON.",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Print aggregate JSON (per-class mismatch totals) instead of "
             "per-record stream.",
    )
    args = parser.parse_args()

    records: list[dict[str, Any]] = []
    for line in sys.stdin:
        rec = parse_line(line)
        if rec is None:
            continue
        records.append(rec)
        if not args.summary:
            print(json.dumps(rec))

    if args.summary:
        json.dump(summarize(records), sys.stdout, indent=2)
        sys.stdout.write("\n")

    print(
        f"# harvested {len(records)} telemetry record(s)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
