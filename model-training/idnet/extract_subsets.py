"""
extract_subsets.py — IDNet zips → stratified 525K JPEG directory.

For each of the 20 doc types (one .zip per type), extract up to 25 000 samples
(from positive/, fraud5_inpaint_and_rewrite/, and fraud6_crop_and_replace/
subdirectories) into:

    EXTRACTED_ROOT/<doc_type>/<sample_id>.jpg
    EXTRACTED_ROOT/<doc_type>/<sample_id>.json   (field metadata)

By default, fraud variants are included (--include-fraud is True).  Fraud
images have identical geometric layout to positives (same corners, same field
bboxes) — only textual content differs.  Including them gives ~700K additional
training samples at no cost to geometric accuracy.  Fraud detection is a
separate, out-of-scope workstream.

Resume-friendly: if the output .jpg already exists, the sample is skipped.

Validation at the end: each doc type should have up to 25 000 samples.
With 20 zips × ~31K available samples (positive + 2 fraud sets), the
25K target per type is achievable.  At 21 doc types × 25K = 525K total.

Usage:
    python model-training/idnet/extract_subsets.py
    python model-training/idnet/extract_subsets.py --dry-run
    python model-training/idnet/extract_subsets.py --doc-types CA EST ALB
    python model-training/idnet/extract_subsets.py --target-per-type 1000  # for dev
    python model-training/idnet/extract_subsets.py --no-include-fraud       # positive-only
"""

import argparse
import json
import logging
import random
import shutil
import sys
import zipfile
from pathlib import Path

from tqdm import tqdm

# ---------------------------------------------------------------------------
# Add repo root to path so we can import utils.paths
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import IDNET_ZIPS, IDNET_MANIFEST, EXTRACTED_ROOT

# ---------------------------------------------------------------------------
# Doc-type mapping: zip stem → canonical doc_type label
#
# US states follow AAMVA DL naming conventions.
# International IDs use ISO 3166-1 alpha-3 or alpha-2 codes.
# This mapping also drives class IDs in prepare_yolo_obb.py — keep in sync.
# ---------------------------------------------------------------------------
DOCTYPE_MAP: dict[str, str] = {
    # US state driver's licenses / IDs
    "AZ": "us_arizona_dl",
    "CA": "us_california_dl",
    "DC": "us_dc_dl",
    "NC": "us_north_carolina_dl",
    "NV": "us_nevada_dl",
    "PA": "us_pennsylvania_dl",
    "SD": "us_south_dakota_dl",
    "UT": "us_utah_dl",
    "WI": "us_wisconsin_dl",
    "WV": "us_west_virginia_dl",
    # European / international IDs
    "ALB": "albania_id",
    "AZE": "azerbaijan_id",
    "ESP": "spain_id",
    "EST": "estonia_id",
    "FIN": "finland_id",
    "GRC": "greece_id",
    "LVA": "latvia_id",
    "RUS": "russia_id",
    "SRB": "serbia_id",
    "SVK": "slovakia_id",
}

# Sorted list used to assign stable integer class IDs (index == class_id).
DOCTYPES_SORTED: list[str] = sorted(DOCTYPE_MAP.values())

TARGET_PER_TYPE = 25_000
RANDOM_SEED = 42


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "extract_subsets.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def load_manifest() -> dict[str, str]:
    """Return {filename: record_id} from the IDNet manifest TSV."""
    mapping: dict[str, str] = {}
    with open(IDNET_MANIFEST) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 2:
                record_id, filename = parts[0], parts[1]
                mapping[filename] = record_id
    return mapping


def get_annotation_json_name(zip_stem: str, positive_img_name: str) -> str:
    """
    Given a positive image filename (e.g. 'generated.photos_v3_0574057.png'),
    return the key used inside EST_original_annotation.json (which is the
    bare filename without directory prefix).
    """
    return Path(positive_img_name).name


def extract_zip(
    zip_path: Path,
    doc_type: str,
    target_count: int,
    rng: random.Random,
    dry_run: bool,
    logger: logging.Logger,
    include_fraud: bool = True,
) -> int:
    """
    Extract up to `target_count` samples from `zip_path` into
    EXTRACTED_ROOT/<doc_type>/.

    When include_fraud=True (default), samples are drawn from:
      - <ZIP_STEM>/positive/
      - <ZIP_STEM>/fraud5_inpaint_and_rewrite/
      - <ZIP_STEM>/fraud6_crop_and_replace/
    Fraud images have identical geometry to positives; only textual content
    differs.  Including them expands available samples to ~31K per zip.

    Returns the number of samples newly written (0 if all already existed).
    """
    out_dir = EXTRACTED_ROOT / doc_type
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    zip_stem = zip_path.stem  # e.g. "CA", "EST"

    # Subdirectories to collect images from
    candidate_subdirs = [f"{zip_stem}/positive/"]
    if include_fraud:
        candidate_subdirs += [
            f"{zip_stem}/fraud5_inpaint_and_rewrite/",
            f"{zip_stem}/fraud6_crop_and_replace/",
        ]

    with zipfile.ZipFile(zip_path, "r") as zf:
        all_names = zf.namelist()

        # Collect candidate images from all applicable subdirectories
        candidate_imgs: list[str] = []
        for subdir in candidate_subdirs:
            imgs = [
                n for n in all_names
                if n.startswith(subdir) and n.endswith((".jpg", ".jpeg", ".png"))
            ]
            candidate_imgs.extend(imgs)

        if not candidate_imgs:
            logger.warning(
                "%s: no candidate images found in zip (checked %d total entries, subdirs=%s)",
                zip_path.name,
                len(all_names),
                candidate_subdirs,
            )
            return 0

        logger.info(
            "%s: %d candidate images available (subdirs: %s), targeting %d",
            zip_path.name,
            len(candidate_imgs),
            ", ".join(s.rstrip("/").split("/")[-1] for s in candidate_subdirs),
            target_count,
        )

        # Deterministic stratified sample
        if len(candidate_imgs) > target_count:
            selected = rng.sample(candidate_imgs, target_count)
        else:
            selected = list(candidate_imgs)
            logger.warning(
                "%s: only %d images available (< %d target); using all",
                zip_path.name,
                len(selected),
                target_count,
            )

        # Load annotation JSON for this zip (original, non-fraud annotations)
        annot_path = f"{zip_stem}/meta/detailed_with_fraud_info/{zip_stem}_original_annotation.json"
        annotation_data: dict = {}
        try:
            annotation_data = json.loads(zf.read(annot_path))
        except KeyError:
            logger.warning("%s: annotation file not found at %s", zip_path.name, annot_path)

        newly_written = 0
        for img_path_in_zip in tqdm(selected, desc=zip_path.name, unit="img", leave=False):
            img_filename = Path(img_path_in_zip).name
            # Normalise to .jpg extension for consistency
            sample_stem = Path(img_filename).stem
            out_jpg = out_dir / f"{sample_stem}.jpg"
            out_json = out_dir / f"{sample_stem}.json"

            # Resume-friendly skip
            if out_jpg.exists():
                continue

            if dry_run:
                logger.info("  [dry-run] would extract %s → %s", img_path_in_zip, out_jpg)
                newly_written += 1
                continue

            # Write image
            img_data = zf.read(img_path_in_zip)
            out_jpg.write_bytes(img_data)

            # Write metadata JSON (subset of annotation for this image)
            annot_key = get_annotation_json_name(zip_stem, img_filename)
            metadata: dict = {
                "doc_type": doc_type,
                "zip_stem": zip_stem,
                "source_path": img_path_in_zip,
                "image_file": img_filename,
            }
            if annot_key in annotation_data:
                metadata["fields"] = annotation_data[annot_key]
            out_json.write_text(json.dumps(metadata, ensure_ascii=False, indent=2))

            newly_written += 1

    return newly_written


def validate_extraction(doc_types: list[str], target: int, logger: logging.Logger) -> bool:
    """Assert each doc_type directory has >= min(target, available) samples."""
    all_ok = True
    for doc_type in doc_types:
        out_dir = EXTRACTED_ROOT / doc_type
        if not out_dir.exists():
            logger.error("MISSING directory: %s", out_dir)
            all_ok = False
            continue
        count = len(list(out_dir.glob("*.jpg")))
        if count < target:
            logger.warning(
                "%s: only %d samples (target %d) — zip may have had fewer positives",
                doc_type,
                count,
                target,
            )
            # Not a hard failure if the zip simply had fewer samples
        else:
            logger.info("%s: %d samples OK", doc_type, count)
    return all_ok


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract stratified IDNet subsets into EXTRACTED_ROOT."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without writing any files.",
    )
    parser.add_argument(
        "--doc-types",
        nargs="+",
        metavar="ZIP_STEM",
        default=None,
        help=(
            "Process only these zip stems (e.g. CA EST ALB). "
            "Default: all 20 zips in manifest."
        ),
    )
    parser.add_argument(
        "--target-per-type",
        type=int,
        default=TARGET_PER_TYPE,
        help=f"Samples to extract per doc type (default: {TARGET_PER_TYPE}).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=RANDOM_SEED,
        help=f"Random seed for deterministic sampling (default: {RANDOM_SEED}).",
    )
    parser.add_argument(
        "--include-fraud",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "Include fraud variant subdirectories (fraud5_inpaint_and_rewrite/, "
            "fraud6_crop_and_replace/) in addition to positive/ images. "
            "Default: True.  Pass --no-include-fraud for positive-only extraction."
        ),
    )
    args = parser.parse_args()

    log_dir = EXTRACTED_ROOT.parent / "logs"
    logger = setup_logging(log_dir)

    if args.dry_run:
        logger.info("DRY-RUN mode — no files will be written.")

    rng = random.Random(args.seed)

    # Determine which zips to process
    if args.doc_types:
        requested = [s.upper() for s in args.doc_types]
        unknown = set(requested) - set(DOCTYPE_MAP.keys())
        if unknown:
            logger.error("Unknown zip stems: %s. Valid: %s", unknown, list(DOCTYPE_MAP.keys()))
            sys.exit(1)
        zip_stems = requested
    else:
        zip_stems = list(DOCTYPE_MAP.keys())

    total_new = 0
    processed_doc_types: list[str] = []

    for stem in zip_stems:
        zip_path = IDNET_ZIPS / f"{stem}.zip"
        if not zip_path.exists():
            logger.error("Missing zip: %s", zip_path)
            continue

        doc_type = DOCTYPE_MAP[stem]
        processed_doc_types.append(doc_type)

        newly_written = extract_zip(
            zip_path=zip_path,
            doc_type=doc_type,
            target_count=args.target_per_type,
            rng=rng,
            dry_run=args.dry_run,
            logger=logger,
            include_fraud=args.include_fraud,
        )
        total_new += newly_written
        logger.info("%s: %d newly written", doc_type, newly_written)

    if not args.dry_run:
        logger.info("Validation pass...")
        validate_extraction(processed_doc_types, args.target_per_type, logger)

    logger.info(
        "Done. Total newly extracted: %d across %d doc types.",
        total_new,
        len(zip_stems),
    )


if __name__ == "__main__":
    main()
