"""
prepare_yolo_fields.py — IDNet metadata → axis-aligned YOLO field detector format.

For each sample in EXTRACTED_ROOT:
  1. Read metadata JSON to get each field's bounding box.
  2. Rectify the document to a canonical 640×640 crop (using cv2 perspective
     transform — with 50 % probability add ±5 px corner jitter to simulate
     imperfect doc-detector output at inference time).
  3. Project each field bbox into the rectified 640×640 space.
  4. Write YOLO axis-aligned label:  class_id x_center y_center width height
     (all values normalized 0–1 relative to 640×640).
  5. Copy the rectified image to YOLO_FIELDS_ROOT/images/<split>/<sample_id>.jpg.

IDNet geometry note:
  IDNet images ARE the document (no background padding in positive/ images).
  The "document corners" are therefore the image corners:
      TL(0,0)  TR(W,0)  BR(W,H)  BL(0,H)
  Perspective transform maps these to the 640×640 canonical space, which
  means the rectification is essentially a resize (plus jitter on 50 % of
  samples to train robustness against imperfect detection).

Field class IDs are drawn from the union of all field keys across all doc types.
Unknown/rare fields not in FIELD_CLASSES are silently skipped.

Usage:
    python model-training/idnet/prepare_yolo_fields.py
    python model-training/idnet/prepare_yolo_fields.py --dry-run
    python model-training/idnet/prepare_yolo_fields.py --jitter-px 5 --jitter-prob 0.5
"""

import argparse
import json
import logging
import random
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import EXTRACTED_ROOT, YOLO_FIELDS_ROOT

# ---------------------------------------------------------------------------
# Field class mapping
#
# Sources:
#   - IDNet Estonian/international: surname, given_name, birthday, gender,
#     expire_date, personal_num, country, card_num1, card_num2, face
#   - IDNet California (AAMVA): list_1 (last_name), list_2 (first_name),
#     list_3 (dob), list_3c, list_4a (issue_date), list_4b (exp_date),
#     list_4d (dl_number), list_5, list_8f (address_street),
#     list_8s (address_city_state), list_9 (class), list_9a,
#     list_12, list_15 (sex), list_16 (height), list_17 (weight),
#     list_18 (eye_color), list_19 (hair_color), donor, face, ghostimg
#
# All unique field keys are listed below with stable integer class IDs.
# ---------------------------------------------------------------------------
FIELD_CLASSES: list[str] = sorted([
    # International / European ID fields
    "surname",
    "given_name",
    "birthday",
    "gender",
    "expire_date",
    "personal_num",
    "country",
    "card_num1",
    "card_num2",
    "face",
    # AAMVA DL fields (list_N keys from IDNet)
    "list_1",    # last name
    "list_2",    # first name
    "list_3",    # date of birth
    "list_3c",   # dob companion / restriction
    "list_4a",   # issue date
    "list_4b",   # expiry date
    "list_4d",   # DL number
    "list_5",    # address line 1 (some states)
    "list_8f",   # address street
    "list_8s",   # address city/state/zip
    "list_9",    # vehicle class
    "list_9a",   # restriction codes
    "list_12",   # organ donor indicator
    "list_15",   # sex
    "list_16",   # height
    "list_17",   # weight
    "list_18",   # eye color
    "list_19",   # hair color
    "donor",     # organ donor flag
    "ghostimg",  # ghost/duplicate photo on some licenses
])

FIELD_CLASS_ID: dict[str, int] = {f: i for i, f in enumerate(FIELD_CLASSES)}

CANONICAL_SIZE = 640       # pixels — canonical rectified document size
JITTER_PX = 5              # max corner perturbation in pixels
JITTER_PROB = 0.5          # fraction of samples that receive jitter
RANDOM_SEED = 42
DEFAULT_SPLITS = (0.8, 0.1, 0.1)


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "prepare_yolo_fields.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def jitter_corners(
    corners: np.ndarray,
    max_px: int,
    rng: random.Random,
    img_w: int,
    img_h: int,
) -> np.ndarray:
    """
    Perturb each of the 4 document corners by ±max_px pixels.

    corners: (4, 2) float32 array  [TL, TR, BR, BL]
    Returns a new (4, 2) float32 array clamped to image bounds.
    """
    noise = np.array(
        [[rng.uniform(-max_px, max_px), rng.uniform(-max_px, max_px)] for _ in range(4)],
        dtype=np.float32,
    )
    jittered = corners + noise
    jittered[:, 0] = np.clip(jittered[:, 0], 0, img_w - 1)
    jittered[:, 1] = np.clip(jittered[:, 1], 0, img_h - 1)
    return jittered


def rectify_document(
    img: np.ndarray,
    src_corners: np.ndarray,
    canonical_size: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Apply perspective transform mapping src_corners → canonical_size × canonical_size.

    Returns:
        rectified_img: (canonical_size, canonical_size, 3) uint8
        M:             (3, 3) perspective transform matrix
    """
    dst_corners = np.array(
        [
            [0, 0],
            [canonical_size - 1, 0],
            [canonical_size - 1, canonical_size - 1],
            [0, canonical_size - 1],
        ],
        dtype=np.float32,
    )
    M = cv2.getPerspectiveTransform(src_corners, dst_corners)
    rectified = cv2.warpPerspective(
        img, M, (canonical_size, canonical_size), flags=cv2.INTER_LINEAR
    )
    return rectified, M


def transform_bbox(
    bbox_xyxy: list[int],
    M: np.ndarray,
    canonical_size: int,
) -> tuple[float, float, float, float] | None:
    """
    Transform an axis-aligned bbox [x1, y1, x2, y2] through perspective
    matrix M, then return the axis-aligned envelope in the canonical space,
    normalized to [0, 1].

    Returns None if the resulting bbox is degenerate (< 1 px).
    """
    x1, y1, x2, y2 = bbox_xyxy
    # Transform all 4 corners of the bbox
    pts = np.array(
        [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32
    ).reshape(-1, 1, 2)
    transformed = cv2.perspectiveTransform(pts, M).reshape(-1, 2)

    tx1, ty1 = transformed.min(axis=0)
    tx2, ty2 = transformed.max(axis=0)

    # Clip to canvas
    tx1 = max(0.0, float(tx1))
    ty1 = max(0.0, float(ty1))
    tx2 = min(float(canonical_size), float(tx2))
    ty2 = min(float(canonical_size), float(ty2))

    if tx2 - tx1 < 1 or ty2 - ty1 < 1:
        return None

    # Normalize to [0, 1]
    cx = ((tx1 + tx2) / 2) / canonical_size
    cy = ((ty1 + ty2) / 2) / canonical_size
    w = (tx2 - tx1) / canonical_size
    h = (ty2 - ty1) / canonical_size
    return cx, cy, w, h


def process_sample(
    jpg_path: Path,
    meta_path: Path,
    out_img_path: Path,
    out_lbl_path: Path,
    rng: random.Random,
    jitter_px: int,
    jitter_prob: float,
    canonical_size: int,
    dry_run: bool,
) -> bool:
    """
    Process a single IDNet sample.

    Returns True on success, False on skip/error.
    """
    if out_lbl_path.exists():
        return False  # already done — skip

    if dry_run:
        return True

    # Load image
    img = cv2.imread(str(jpg_path))
    if img is None:
        return False

    h, w = img.shape[:2]

    # IDNet positive images ARE the document — corners are image corners.
    # Order: TL, TR, BR, BL
    src_corners = np.array(
        [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32
    )

    # Apply jitter on JITTER_PROB fraction of samples
    if rng.random() < jitter_prob:
        src_corners = jitter_corners(src_corners, jitter_px, rng, w, h)

    rectified, M = rectify_document(img, src_corners, canonical_size)

    # Load metadata
    try:
        meta = json.loads(meta_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return False

    fields = meta.get("fields", {})
    label_rows: list[str] = []

    for field_key, field_data in fields.items():
        if field_key == "fraud" or not isinstance(field_data, dict):
            continue
        if field_key not in FIELD_CLASS_ID:
            continue  # not a spatial field we track
        bbox = field_data.get("bbox")
        if not bbox or len(bbox) != 4:
            continue

        # IDNet bbox format: [x1, y1, x2, y2] in original image pixels
        result = transform_bbox(bbox, M, canonical_size)
        if result is None:
            continue

        cx, cy, bw, bh = result
        class_id = FIELD_CLASS_ID[field_key]
        label_rows.append(f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")

    if not label_rows:
        # No valid fields found — skip this sample
        return False

    # Write outputs
    out_img_path.parent.mkdir(parents=True, exist_ok=True)
    out_lbl_path.parent.mkdir(parents=True, exist_ok=True)

    cv2.imwrite(str(out_img_path), rectified, [cv2.IMWRITE_JPEG_QUALITY, 95])
    out_lbl_path.write_text("\n".join(label_rows) + "\n")
    return True


def write_data_yaml() -> None:
    yaml_content = {
        "path": str(YOLO_FIELDS_ROOT),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "nc": len(FIELD_CLASSES),
        "names": FIELD_CLASSES,
    }
    yaml_path = YOLO_FIELDS_ROOT / "data.yaml"
    yaml_path.parent.mkdir(parents=True, exist_ok=True)
    with open(yaml_path, "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False, sort_keys=False)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Rectify IDNet samples to 640×640 and produce axis-aligned YOLO "
            "field detector labels."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count what would be processed without writing any files.",
    )
    parser.add_argument(
        "--split",
        nargs=3,
        type=float,
        default=list(DEFAULT_SPLITS),
        metavar=("TRAIN", "VAL", "TEST"),
        help="Train/val/test split ratios (default: 0.8 0.1 0.1).",
    )
    parser.add_argument(
        "--jitter-px",
        type=int,
        default=JITTER_PX,
        help=f"Max corner jitter in pixels (default: {JITTER_PX}).",
    )
    parser.add_argument(
        "--jitter-prob",
        type=float,
        default=JITTER_PROB,
        help=f"Fraction of samples that receive jitter (default: {JITTER_PROB}).",
    )
    parser.add_argument(
        "--canonical-size",
        type=int,
        default=CANONICAL_SIZE,
        help=f"Rectified image size in pixels (default: {CANONICAL_SIZE}).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=RANDOM_SEED,
        help=f"Random seed (default: {RANDOM_SEED}).",
    )
    args = parser.parse_args()

    log_dir = YOLO_FIELDS_ROOT.parent / "logs"
    logger = setup_logging(log_dir)

    if not EXTRACTED_ROOT.exists():
        logger.error("EXTRACTED_ROOT not found: %s\nRun extract_subsets.py first.", EXTRACTED_ROOT)
        sys.exit(1)

    split_ratios = tuple(args.split)  # type: ignore[assignment]
    if abs(sum(split_ratios) - 1.0) > 1e-6:
        logger.error("Split ratios must sum to 1.0; got %s", split_ratios)
        sys.exit(1)

    rng = random.Random(args.seed)
    splits = ("train", "val", "test")

    # Collect all samples and assign splits
    all_samples: list[tuple[Path, Path]] = []
    for doc_dir in sorted(EXTRACTED_ROOT.iterdir()):
        if not doc_dir.is_dir():
            continue
        for jpg in sorted(doc_dir.glob("*.jpg")):
            meta = jpg.with_suffix(".json")
            if meta.exists():
                all_samples.append((jpg, meta))

    rng.shuffle(all_samples)
    n = len(all_samples)
    n_train = int(n * split_ratios[0])
    n_val = int(n * split_ratios[1])
    split_assignment: list[tuple[Path, Path, str]] = (
        [(j, m, "train") for j, m in all_samples[:n_train]]
        + [(j, m, "val") for j, m in all_samples[n_train: n_train + n_val]]
        + [(j, m, "test") for j, m in all_samples[n_train + n_val:]]
    )

    logger.info(
        "Total samples: %d  (train=%d val=%d test=%d)",
        n,
        n_train,
        n_val,
        n - n_train - n_val,
    )

    written = skipped = 0
    for jpg_path, meta_path, split in tqdm(split_assignment, desc="rectify+label", unit="img"):
        sample_id = jpg_path.stem
        out_img = YOLO_FIELDS_ROOT / "images" / split / f"{sample_id}.jpg"
        out_lbl = YOLO_FIELDS_ROOT / "labels" / split / f"{sample_id}.txt"

        result = process_sample(
            jpg_path=jpg_path,
            meta_path=meta_path,
            out_img_path=out_img,
            out_lbl_path=out_lbl,
            rng=rng,
            jitter_px=args.jitter_px,
            jitter_prob=args.jitter_prob,
            canonical_size=args.canonical_size,
            dry_run=args.dry_run,
        )
        if result:
            written += 1
        else:
            skipped += 1

    logger.info("Written: %d  Skipped/errors: %d", written, skipped)

    if not args.dry_run:
        write_data_yaml()
        logger.info("data.yaml written to %s", YOLO_FIELDS_ROOT / "data.yaml")
        logger.info(
            "Field classes (%d): %s", len(FIELD_CLASSES), FIELD_CLASSES
        )


if __name__ == "__main__":
    main()
