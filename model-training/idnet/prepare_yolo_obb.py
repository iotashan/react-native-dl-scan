"""
prepare_yolo_obb.py — IDNet metadata → Ultralytics YOLO OBB format.

Reads every sample in EXTRACTED_ROOT, treats the full image as the document
(IDNet synthetic IDs have no background — the entire raster IS the document),
derives a tight upright bounding rectangle representing the document OBB, and
writes Ultralytics OBB label files:

    YOLO_OBB_ROOT/images/<sample_id>.jpg   (symlink or copy)
    YOLO_OBB_ROOT/labels/<sample_id>.txt   (class x1 y1 x2 y2 x3 y3 x4 y4)

Then generates the Ultralytics data.yaml with the 20-class doc-type mapping.

OBB format note:
  Ultralytics OBB format uses 4 corner points in CLOCKWISE order, normalized
  0–1 relative to image width/height.  For IDNet (full-image documents),
  this is simply the image corners:  TL → TR → BR → BL.

Usage:
    python model-training/idnet/prepare_yolo_obb.py
    python model-training/idnet/prepare_yolo_obb.py --dry-run
    python model-training/idnet/prepare_yolo_obb.py --split 0.8 0.1 0.1
"""

import argparse
import json
import logging
import random
import shutil
import sys
from pathlib import Path

import yaml
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import EXTRACTED_ROOT, YOLO_OBB_ROOT
from idnet.extract_subsets import DOCTYPE_MAP, DOCTYPES_SORTED


RANDOM_SEED = 42

# Default train/val/test split ratios
DEFAULT_SPLITS = (0.8, 0.1, 0.1)


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "prepare_yolo_obb.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def get_image_size_from_jpeg(jpg_path: Path) -> tuple[int, int]:
    """
    Return (width, height) by reading JPEG SOF markers without PIL.

    Walks JFIF markers until it finds SOF0/SOF2 (0xFFC0 / 0xFFC2).
    Raises ValueError if the file is not a recognisable JPEG.
    """
    with open(jpg_path, "rb") as f:
        data = f.read(65536)  # first 64 KB is always enough for JPEG headers

    if data[:2] != b"\xff\xd8":
        raise ValueError(f"Not a JPEG: {jpg_path}")

    i = 2
    while i < len(data) - 1:
        if data[i] != 0xFF:
            raise ValueError(f"Invalid JPEG marker at offset {i} in {jpg_path}")
        marker = data[i + 1]
        i += 2
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):  # SOF markers
            # SOF: length(2) + precision(1) + height(2) + width(2) + ...
            height = int.from_bytes(data[i + 3: i + 5], "big")
            width = int.from_bytes(data[i + 5: i + 7], "big")
            return width, height
        # Skip over this marker's payload
        if i + 1 < len(data):
            length = int.from_bytes(data[i: i + 2], "big")
            i += length
        else:
            break
    raise ValueError(f"Could not find SOF marker in {jpg_path}")


def image_corners_obb_normalized(width: int, height: int) -> list[float]:
    """
    Return the 4 corners of the full image as a flat CLOCKWISE list
    of normalized (x, y) coordinates:  TL → TR → BR → BL.

    All values are 0.0 or 1.0 for a full-image document.
    """
    # TL(0,0)  TR(1,0)  BR(1,1)  BL(0,1)
    return [0.0, 0.0,  1.0, 0.0,  1.0, 1.0,  0.0, 1.0]


def write_obb_label(label_path: Path, class_id: int, corners: list[float]) -> None:
    """Write a single-row Ultralytics OBB label file."""
    row = " ".join([str(class_id)] + [f"{v:.6f}" for v in corners])
    label_path.write_text(row + "\n")


def prepare_yolo_obb(
    split_ratios: tuple[float, float, float],
    dry_run: bool,
    logger: logging.Logger,
    seed: int = RANDOM_SEED,
) -> None:
    """Walk EXTRACTED_ROOT and produce YOLO_OBB_ROOT dataset."""

    rng = random.Random(seed)

    splits = ("train", "val", "test")
    assert abs(sum(split_ratios) - 1.0) < 1e-6, "Split ratios must sum to 1.0"

    if not dry_run:
        for split in splits:
            (YOLO_OBB_ROOT / "images" / split).mkdir(parents=True, exist_ok=True)
            (YOLO_OBB_ROOT / "labels" / split).mkdir(parents=True, exist_ok=True)

    # Build per-doc-type class_id lookup
    class_id_map = {doc_type: idx for idx, doc_type in enumerate(DOCTYPES_SORTED)}

    total_written = 0
    total_skipped = 0

    for doc_type in tqdm(DOCTYPES_SORTED, desc="doc types"):
        src_dir = EXTRACTED_ROOT / doc_type
        if not src_dir.exists():
            logger.warning("Missing extracted dir: %s — skipping", src_dir)
            continue

        jpg_files = sorted(src_dir.glob("*.jpg"))
        if not jpg_files:
            logger.warning("No JPEGs in %s — skipping", src_dir)
            continue

        class_id = class_id_map[doc_type]

        # Deterministic split
        rng.shuffle(jpg_files)
        n = len(jpg_files)
        n_train = int(n * split_ratios[0])
        n_val = int(n * split_ratios[1])
        split_assignment: list[tuple[Path, str]] = (
            [(f, "train") for f in jpg_files[:n_train]]
            + [(f, "val") for f in jpg_files[n_train: n_train + n_val]]
            + [(f, "test") for f in jpg_files[n_train + n_val:]]
        )

        for jpg_path, split in tqdm(split_assignment, desc=doc_type, unit="img", leave=False):
            sample_id = jpg_path.stem
            out_img = YOLO_OBB_ROOT / "images" / split / f"{sample_id}.jpg"
            out_lbl = YOLO_OBB_ROOT / "labels" / split / f"{sample_id}.txt"

            if out_lbl.exists():
                total_skipped += 1
                continue

            if dry_run:
                logger.debug(
                    "[dry-run] %s (class %d) → %s", jpg_path.name, class_id, split
                )
                total_written += 1
                continue

            # Get image dimensions to validate (corners are always 0/1, but
            # we still check that the file is a valid JPEG)
            try:
                width, height = get_image_size_from_jpeg(jpg_path)
            except (ValueError, Exception) as exc:
                logger.warning("Skipping %s: %s", jpg_path, exc)
                total_skipped += 1
                continue

            # Symlink image (avoids duplicating 388 GB of data)
            if not out_img.exists():
                out_img.symlink_to(jpg_path.resolve())

            # Write OBB label
            corners = image_corners_obb_normalized(width, height)
            write_obb_label(out_lbl, class_id, corners)
            total_written += 1

    logger.info(
        "OBB labels: %d written, %d skipped (already existed)", total_written, total_skipped
    )

    if not dry_run:
        write_data_yaml(split_ratios)
        logger.info("data.yaml written to %s", YOLO_OBB_ROOT / "data.yaml")


def write_data_yaml(split_ratios: tuple[float, float, float]) -> None:
    """Write Ultralytics-format data.yaml for the OBB dataset."""
    yaml_content = {
        "path": str(YOLO_OBB_ROOT),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "nc": len(DOCTYPES_SORTED),
        "names": DOCTYPES_SORTED,
        # Ultralytics OBB task flag
        "task": "obb",
    }
    yaml_path = YOLO_OBB_ROOT / "data.yaml"
    with open(yaml_path, "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False, sort_keys=False)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert IDNet extracted samples to Ultralytics YOLO OBB format."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without writing any files.",
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
        "--seed",
        type=int,
        default=RANDOM_SEED,
        help=f"Random seed (default: {RANDOM_SEED}).",
    )
    args = parser.parse_args()

    log_dir = YOLO_OBB_ROOT.parent / "logs"
    logger = setup_logging(log_dir)

    if not EXTRACTED_ROOT.exists():
        logger.error(
            "EXTRACTED_ROOT does not exist: %s\nRun extract_subsets.py first.", EXTRACTED_ROOT
        )
        sys.exit(1)

    split_ratios = tuple(args.split)  # type: ignore[assignment]
    if abs(sum(split_ratios) - 1.0) > 1e-6:
        logger.error("Split ratios must sum to 1.0; got %s", split_ratios)
        sys.exit(1)

    prepare_yolo_obb(
        split_ratios=split_ratios,
        dry_run=args.dry_run,
        logger=logger,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
