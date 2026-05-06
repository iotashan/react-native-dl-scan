"""
measure_error_types.py — Analyze OCR pairs to determine disambig architecture.

Reads OCR_PAIRS_PATH (written by render_ocr_pairs.py), computes per-error-type
statistics, and prints an architecture recommendation:

    ARCHITECTURE: per-char-classification
        — if substitution + date_format errors >= 80 % of error pairs

    ARCHITECTURE: seq2seq
        — if insertion + deletion errors >= 20 % of error pairs

Decision gate (from upstream Codex pairing):
  - Keras per-character classification is the default architecture.
    It is TFLite-friendly, quantization-trivial, and works well when
    OCR errors are mostly substitutions (wrong character, same position).
  - Reformulate to seq2seq ONLY if insertion/deletion >= 20 %.
    Seq2seq uses a fixed max-output-length encoder-decoder to remain
    TFLite-exportable.

The "date_format" error is a special substitution class where the field is
a date and the OCR output has the correct digits but wrong separators
(e.g. "01/15/1990" vs "01-15-1990"). These are counted with substitutions
for architecture selection purposes.

Usage:
    python model-training/disambig/measure_error_types.py
    python model-training/disambig/measure_error_types.py --dry-run
    python model-training/disambig/measure_error_types.py --breakdown-by-doctype
"""

import argparse
import json
import logging
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import OCR_PAIRS_PATH


DATE_FIELD_IDS = frozenset(["birthday", "expire_date", "list_3", "list_4a", "list_4b"])
DATE_PATTERN = re.compile(r"\d{2}[/\-\.]\d{2}[/\-\.]\d{4}|\d{4}[/\-\.]\d{2}[/\-\.]\d{2}")


def setup_logging() -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    return logging.getLogger(__name__)


def is_date_format_error(pair: dict) -> bool:
    """
    Return True if this pair looks like a date-separator substitution
    (e.g. '01/15/1990' → '01-15-1990') rather than a true character error.
    """
    if pair.get("field_id") not in DATE_FIELD_IDS:
        return False
    gt = pair.get("gt_string", "")
    ocr = pair.get("ocr_string", "")
    if not DATE_PATTERN.match(gt) or not DATE_PATTERN.match(ocr):
        return False
    # Strip separators and compare digits
    gt_digits = re.sub(r"[^0-9]", "", gt)
    ocr_digits = re.sub(r"[^0-9]", "", ocr)
    return gt_digits == ocr_digits and gt != ocr


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze OCR pairs to select disambig architecture."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print a synthetic analysis without reading OCR_PAIRS_PATH.",
    )
    parser.add_argument(
        "--breakdown-by-doctype",
        action="store_true",
        help="Print error type breakdown per doc type.",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=20.0,
        help=(
            "Insertion+deletion percentage threshold for seq2seq recommendation "
            "(default: 20.0)."
        ),
    )
    args = parser.parse_args()

    logger = setup_logging()

    if args.dry_run:
        logger.info("[dry-run] Would read %s and compute error statistics.", OCR_PAIRS_PATH)
        logger.info("ARCHITECTURE: per-char-classification  (dry-run — no real data read)")
        print("ARCHITECTURE: per-char-classification")
        sys.exit(0)

    if not OCR_PAIRS_PATH.exists():
        logger.error(
            "OCR pairs file not found: %s\nRun render_ocr_pairs.py first.", OCR_PAIRS_PATH
        )
        sys.exit(1)

    # ---------------------------------------------------------------------------
    # Read and tally pairs
    # ---------------------------------------------------------------------------
    counts: dict[str, int] = defaultdict(int)
    doctype_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    total_pairs = 0
    total_errors = 0

    with open(OCR_PAIRS_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                pair = json.loads(line)
            except json.JSONDecodeError:
                continue

            total_pairs += 1
            error_type = pair.get("error_type", "unknown")
            doc_type = pair.get("doc_type", "unknown")

            if error_type == "correct":
                counts["correct"] += 1
                doctype_counts[doc_type]["correct"] += 1
                continue

            total_errors += 1

            # Reclassify date format errors
            if error_type == "substitution" and is_date_format_error(pair):
                effective_type = "date_format"
            else:
                effective_type = error_type

            counts[effective_type] += 1
            doctype_counts[doc_type][effective_type] += 1

    if total_errors == 0:
        logger.warning(
            "No error pairs found in %s. Is the file empty or all 'correct'?",
            OCR_PAIRS_PATH,
        )
        print("ARCHITECTURE: per-char-classification")
        sys.exit(0)

    # ---------------------------------------------------------------------------
    # Print summary
    # ---------------------------------------------------------------------------
    logger.info("=" * 60)
    logger.info("OCR Error Analysis")
    logger.info("=" * 60)
    logger.info("Total pairs:           %8d", total_pairs)
    logger.info("Correct pairs:         %8d  (%5.1f%%)", counts["correct"],
                100.0 * counts["correct"] / max(total_pairs, 1))
    logger.info("Error pairs:           %8d  (%5.1f%%)", total_errors,
                100.0 * total_errors / max(total_pairs, 1))
    logger.info("")
    logger.info("Error type breakdown (as %% of error pairs):")

    error_types = ["substitution", "date_format", "insertion", "deletion", "mixed", "unknown"]
    for et in error_types:
        cnt = counts.get(et, 0)
        pct = 100.0 * cnt / max(total_errors, 1)
        logger.info("  %-20s %8d  (%5.1f%%)", et, cnt, pct)

    # ---------------------------------------------------------------------------
    # Architecture decision
    # ---------------------------------------------------------------------------
    substitution_pct = (
        100.0 * (counts.get("substitution", 0) + counts.get("date_format", 0)) / max(total_errors, 1)
    )
    indel_pct = (
        100.0 * (counts.get("insertion", 0) + counts.get("deletion", 0)) / max(total_errors, 1)
    )

    logger.info("")
    logger.info("Substitution + date_format:  %.1f%%", substitution_pct)
    logger.info("Insertion + deletion:        %.1f%%", indel_pct)
    logger.info("")

    if indel_pct >= args.threshold:
        architecture = "seq2seq"
        logger.warning(
            "ARCHITECTURE: seq2seq\n"
            "  Reason: insertion+deletion errors (%.1f%%) >= threshold (%.1f%%)\n"
            "  Action: train_disambig.py will use encoder-decoder LSTM with attention.\n"
            "  Note:   seq2seq uses fixed max-output-length to remain TFLite-exportable.",
            indel_pct,
            args.threshold,
        )
    else:
        architecture = "per-char-classification"
        logger.info(
            "ARCHITECTURE: per-char-classification\n"
            "  Reason: substitution errors dominate (%.1f%%).\n"
            "  Action: train_disambig.py will use 1D-conv + biLSTM per-position classifier.",
            substitution_pct,
        )

    # ---------------------------------------------------------------------------
    # Optional per-doc-type breakdown
    # ---------------------------------------------------------------------------
    if args.breakdown_by_doctype:
        logger.info("")
        logger.info("Per-doc-type error breakdown:")
        for doc_type in sorted(doctype_counts.keys()):
            dt_counts = doctype_counts[doc_type]
            dt_total = sum(v for k, v in dt_counts.items() if k != "correct")
            if dt_total == 0:
                continue
            subst = dt_counts.get("substitution", 0) + dt_counts.get("date_format", 0)
            indel = dt_counts.get("insertion", 0) + dt_counts.get("deletion", 0)
            logger.info(
                "  %-35s  total=%5d  subst=%.0f%%  indel=%.0f%%",
                doc_type,
                dt_total,
                100.0 * subst / dt_total,
                100.0 * indel / dt_total,
            )

    # Print the machine-readable verdict on stdout for use by train_disambig.py
    print(f"ARCHITECTURE: {architecture}")


if __name__ == "__main__":
    main()
