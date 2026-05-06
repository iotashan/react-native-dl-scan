"""
render_ocr_pairs.py — IDNet images → VisionKit OCR → ground-truth diff → pairs.jsonl

Stratified-samples 50 000 images from EXTRACTED_ROOT (~2 381 per doc type for
21 types, or ~2 500 for 20 types), applies realistic augmentations (perspective
distortion, blur, glare), runs each through Apple VisionKit text recognition
via PyObjC, diffs the OCR output against ground-truth field values from the
metadata JSON, and writes structured records to OCR_PAIRS_PATH (JSONL).

Each JSONL record:
    {
      "sample_id": "<stem>",
      "doc_type": "us_california_dl",
      "field_id": "list_1",
      "gt_string": "WANG",
      "ocr_string": "WAMG",
      "error_type": "substitution",
      "gt_len": 4,
      "ocr_len": 4,
      "edit_distance": 1
    }

Error type classification:
  - substitution: same length, some chars different
  - insertion:    len(gt) > len(ocr)  — chars missing from OCR output
  - deletion:     len(ocr) > len(gt)  — extra chars in OCR output
  - mixed:        both length mismatch AND substitutions

VisionKit accuracy note:
  VisionKit's VNRecognizeTextRequest with revision VNRequestTextRecognitionRevision3
  and recognitionLevel=accurate performs at near-human accuracy on high-quality
  text.  Augmentations stress-test the OCR pipeline to generate realistic error
  distributions.

This script runs on the Neural Engine (VisionKit uses ANE internally) and can
run CONCURRENTLY with GPU training stages.

Usage:
    python model-training/disambig/render_ocr_pairs.py
    python model-training/disambig/render_ocr_pairs.py --dry-run
    python model-training/disambig/render_ocr_pairs.py --n-samples 5000
"""

import argparse
import json
import logging
import os
import random
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import EXTRACTED_ROOT, OCR_PAIRS_PATH

# ---------------------------------------------------------------------------
# VisionKit imports via PyObjC
# ---------------------------------------------------------------------------
# These imports will fail if pyobjc is not installed or we are not on macOS.
# The script will detect this and exit with a clear error message.
try:
    from Cocoa import NSURL
    from Vision import (
        VNImageRequestHandler,
        VNRecognizeTextRequest,
    )
    import objc
    VISIONKIT_AVAILABLE = True
except ImportError:
    VISIONKIT_AVAILABLE = False

TOTAL_SAMPLES = 50_000
RANDOM_SEED = 42
AUG_PROB = 0.6       # fraction of images that receive augmentation
WORKERS = 1          # VisionKit is not thread-safe; keep at 1 unless testing


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "render_ocr_pairs.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Augmentation
# ---------------------------------------------------------------------------

def augment_image(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """
    Apply a random combination of realistic augmentations:
      - Perspective distortion (simulate non-perpendicular camera angle)
      - Gaussian blur (out-of-focus or motion blur)
      - Glare simulation (bright overexposed region)
    """
    h, w = img.shape[:2]
    result = img.copy()

    # Perspective distortion: perturb corners by up to 5 % of image dimension
    if rng.random() < 0.5:
        max_shift = int(min(w, h) * 0.05)
        pts_src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        pts_dst = np.float32([
            [rng.randint(0, max_shift), rng.randint(0, max_shift)],
            [w - rng.randint(0, max_shift), rng.randint(0, max_shift)],
            [w - rng.randint(0, max_shift), h - rng.randint(0, max_shift)],
            [rng.randint(0, max_shift), h - rng.randint(0, max_shift)],
        ])
        M = cv2.getPerspectiveTransform(pts_src, pts_dst)
        result = cv2.warpPerspective(result, M, (w, h))

    # Gaussian blur
    if rng.random() < 0.4:
        ksize = rng.choice([3, 5, 7])
        sigma = rng.uniform(0.5, 2.0)
        result = cv2.GaussianBlur(result, (ksize, ksize), sigma)

    # Glare: bright ellipse in a random corner
    if rng.random() < 0.3:
        cx = rng.choice([0, w]) + rng.randint(-w // 4, w // 4)
        cy = rng.choice([0, h]) + rng.randint(-h // 4, h // 4)
        axes = (rng.randint(w // 6, w // 3), rng.randint(h // 6, h // 3))
        overlay = result.copy()
        cv2.ellipse(overlay, (cx, cy), axes, 0, 0, 360, (255, 255, 255), -1)
        alpha = rng.uniform(0.2, 0.5)
        result = cv2.addWeighted(result, 1 - alpha, overlay, alpha, 0)

    return result


# ---------------------------------------------------------------------------
# VisionKit OCR
# ---------------------------------------------------------------------------

def run_visionkit_ocr(image_path: Path) -> list[str]:
    """
    Run VisionKit VNRecognizeTextRequest on an image file.

    Returns a list of recognized text strings (one per observation).
    Uses VNRequestTextRecognitionRevision3 (most accurate; requires macOS 14+).
    """
    if not VISIONKIT_AVAILABLE:
        raise RuntimeError("pyobjc not available — cannot run VisionKit OCR")

    url = NSURL.fileURLWithPath_(str(image_path))
    handler = VNImageRequestHandler.alloc().initWithURL_options_(url, {})
    request = VNRecognizeTextRequest.alloc().init()

    # recognitionLevel: 1 = accurate (uses more compute; slower)
    request.setRecognitionLevel_(1)

    # Use revision 3 for best accuracy (macOS 14+, iOS 17+)
    # Fallback to default if unavailable
    try:
        request.setRevision_(3)  # VNRequestTextRecognitionRevision3
    except AttributeError:
        pass  # older macOS — revision is implicit

    # Wrap Objective-C calls in an autorelease pool to prevent accumulation of
    # VNImageRequestHandler and VNRecognizeTextRequest autoreleased objects.
    # At 50K samples × augmentation, unbounded autorelease growth can reach
    # several GB before the pool is drained at thread exit.
    with objc.autorelease_pool():
        success = handler.performRequests_error_([request], None)
        results = request.results()
        if not results:
            return []

        texts = []
        for obs in results:
            candidates = obs.topCandidates_(1)
            if candidates:
                texts.append(candidates[0].string())
    return texts


# ---------------------------------------------------------------------------
# Edit distance + error classification
# ---------------------------------------------------------------------------

def levenshtein(s1: str, s2: str) -> int:
    """Standard dynamic programming Levenshtein distance."""
    m, n = len(s1), len(s2)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, n + 1):
            old = dp[j]
            if s1[i - 1] == s2[j - 1]:
                dp[j] = prev
            else:
                dp[j] = 1 + min(prev, dp[j], dp[j - 1])
            prev = old
    return dp[n]


def classify_error(gt: str, ocr: str) -> str:
    """
    Classify the error type between ground truth and OCR string.

    Returns one of: 'substitution', 'insertion', 'deletion', 'mixed', 'correct'
    """
    if gt == ocr:
        return "correct"
    len_diff = len(ocr) - len(gt)
    if len_diff == 0:
        return "substitution"
    elif len_diff < 0:
        return "insertion"   # OCR missed characters (shorter output)
    else:
        return "deletion"    # OCR hallucinated characters (longer output)


def normalize_field_value(raw_value: str | None) -> str:
    """Strip whitespace and normalize to uppercase for comparison."""
    if not raw_value:
        return ""
    return str(raw_value).strip().upper()


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def process_sample(
    jpg_path: Path,
    meta_path: Path,
    rng: random.Random,
    aug_prob: float,
    dry_run: bool,
) -> list[dict]:
    """
    Process one IDNet sample. Returns a list of OCR pair records (one per field).
    """
    if not meta_path.exists():
        return []

    try:
        meta = json.loads(meta_path.read_text())
    except (json.JSONDecodeError, IOError):
        return []

    doc_type = meta.get("doc_type", "unknown")
    fields = meta.get("fields", {})
    if not fields:
        return []

    if dry_run:
        # In dry-run, return one synthetic pair per field
        pairs = []
        for field_id, field_data in fields.items():
            if field_id == "fraud" or not isinstance(field_data, dict):
                continue
            gt = normalize_field_value(field_data.get("value", ""))
            if not gt:
                continue
            pairs.append({
                "sample_id": jpg_path.stem,
                "doc_type": doc_type,
                "field_id": field_id,
                "gt_string": gt,
                "ocr_string": "[dry-run]",
                "error_type": "substitution",
                "gt_len": len(gt),
                "ocr_len": len(gt),
                "edit_distance": 0,
            })
        return pairs

    # Load and optionally augment image
    img = cv2.imread(str(jpg_path))
    if img is None:
        return []

    if rng.random() < aug_prob:
        img = augment_image(img, rng)

    # Write augmented image to temp file for VisionKit
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    cv2.imwrite(str(tmp_path), img, [cv2.IMWRITE_JPEG_QUALITY, 90])

    try:
        ocr_texts = run_visionkit_ocr(tmp_path)
    except Exception:
        ocr_texts = []
    finally:
        tmp_path.unlink(missing_ok=True)

    # Join all OCR observations into one string for per-field matching
    ocr_blob = " ".join(ocr_texts).upper()

    pairs = []
    for field_id, field_data in fields.items():
        if field_id == "fraud" or not isinstance(field_data, dict):
            continue
        gt = normalize_field_value(field_data.get("value", ""))
        if not gt or len(gt) < 2:
            continue

        # Find the best matching substring in the OCR blob.
        # VisionKit returns full-image text (not per-field text), so we match
        # ground-truth field values against the OCR blob by string proximity.
        # This is a simplification: it introduces noise when the OCR blob
        # contains multiple fields with similar values (e.g., "SMITH" appearing
        # in both surname and address).  A more accurate approach would use
        # VNRecognizedTextObservation.boundingBox to spatially correlate each
        # OCR observation with the field bbox from metadata.  This spatial-
        # correlation path is a worthwhile future improvement but acceptable
        # noise at 50K scale (Codex review, 2026-05-05).
        if gt in ocr_blob:
            ocr_match = gt  # perfect match
        else:
            # Find closest-length token in OCR blob
            tokens = ocr_blob.split()
            best_token = min(tokens, key=lambda t: levenshtein(gt, t), default="") if tokens else ""
            ocr_match = best_token

        if not ocr_match:
            continue

        edit_dist = levenshtein(gt, ocr_match)
        error_type = classify_error(gt, ocr_match)

        # Only record pairs with actual errors (or a sample of correct ones)
        if error_type == "correct" and rng.random() > 0.1:
            continue  # keep only 10 % of correct pairs to balance dataset

        pairs.append({
            "sample_id": jpg_path.stem,
            "doc_type": doc_type,
            "field_id": field_id,
            "gt_string": gt,
            "ocr_string": ocr_match,
            "error_type": error_type,
            "gt_len": len(gt),
            "ocr_len": len(ocr_match),
            "edit_distance": edit_dist,
        })

    return pairs


def collect_samples(n_total: int, rng: random.Random) -> list[tuple[Path, Path]]:
    """Stratified sample of n_total images from EXTRACTED_ROOT."""
    doc_dirs = sorted(
        d for d in EXTRACTED_ROOT.iterdir() if d.is_dir()
    )
    if not doc_dirs:
        return []

    n_per_type = max(1, n_total // len(doc_dirs))
    samples: list[tuple[Path, Path]] = []

    for doc_dir in doc_dirs:
        jpgs = sorted(doc_dir.glob("*.jpg"))
        if not jpgs:
            continue
        chosen = rng.sample(jpgs, min(n_per_type, len(jpgs)))
        for jpg in chosen:
            meta = jpg.with_suffix(".json")
            samples.append((jpg, meta))

    rng.shuffle(samples)
    return samples[:n_total]


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Generate VisionKit OCR pairs for disambig model training. "
            "Runs on Neural Engine — safe to run while GPU trains doc/field detectors."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count samples and print pair structure without running OCR.",
    )
    parser.add_argument(
        "--n-samples",
        type=int,
        default=TOTAL_SAMPLES,
        help=f"Total images to process (default: {TOTAL_SAMPLES}).",
    )
    parser.add_argument(
        "--aug-prob",
        type=float,
        default=AUG_PROB,
        help=f"Augmentation probability per image (default: {AUG_PROB}).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=RANDOM_SEED,
        help=f"Random seed (default: {RANDOM_SEED}).",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append to existing OCR_PAIRS_PATH instead of overwriting.",
    )
    # NOTE: --workers is intentionally absent.  VisionKit (VNRecognizeTextRequest)
    # is not thread-safe; all OCR calls must remain sequential on the main thread.
    # A thread-pool approach would require per-thread NSRunLoop management and
    # is reserved for a future refactor.
    args = parser.parse_args()

    log_dir = OCR_PAIRS_PATH.parent / "logs"
    logger = setup_logging(log_dir)

    if not VISIONKIT_AVAILABLE and not args.dry_run:
        logger.error(
            "VisionKit / PyObjC not available.\n"
            "Install: pip install pyobjc>=10.0\n"
            "Requires macOS 14+ (Sonoma) and Python 3.11/3.12."
        )
        sys.exit(1)

    if not EXTRACTED_ROOT.exists():
        logger.error(
            "EXTRACTED_ROOT not found: %s\nRun extract_subsets.py first.", EXTRACTED_ROOT
        )
        sys.exit(1)

    rng = random.Random(args.seed)
    samples = collect_samples(args.n_samples, rng)

    logger.info(
        "Processing %d images (aug_prob=%.2f, dry_run=%s)",
        len(samples),
        args.aug_prob,
        args.dry_run,
    )

    if args.dry_run:
        logger.info("[dry-run] Would process %d samples → %s", len(samples), OCR_PAIRS_PATH)
        for jpg_path, meta_path in samples[:3]:
            pairs = process_sample(jpg_path, meta_path, rng, args.aug_prob, dry_run=True)
            for p in pairs[:2]:
                logger.info("  [dry-run] %s", json.dumps(p))
        sys.exit(0)

    write_mode = "a" if args.append else "w"
    total_pairs = 0

    OCR_PAIRS_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(OCR_PAIRS_PATH, write_mode) as out_f:
        for jpg_path, meta_path in tqdm(samples, desc="OCR pairs", unit="img"):
            pairs = process_sample(
                jpg_path=jpg_path,
                meta_path=meta_path,
                rng=rng,
                aug_prob=args.aug_prob,
                dry_run=False,
            )
            for pair in pairs:
                out_f.write(json.dumps(pair, ensure_ascii=False) + "\n")
                total_pairs += 1

    logger.info(
        "Done. Wrote %d OCR pairs to %s", total_pairs, OCR_PAIRS_PATH
    )
    logger.info(
        "Next step: python model-training/disambig/measure_error_types.py"
    )


if __name__ == "__main__":
    main()
