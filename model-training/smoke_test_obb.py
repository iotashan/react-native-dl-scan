"""
smoke_test_obb.py — 2-epoch MPS-vs-CPU OBB correctness check.

Trains YOLOv8n-OBB for 2 epochs on a 10 K-sample subset, once on MPS and
once on CPU, then compares:
  1. Train box loss after epoch 2 (must track within 5 % relative).
  2. KL divergence of predicted angle distributions (must be < 0.1).
  3. Batch preview images logged to runs/smoke_mps/ and runs/smoke_cpu/.

Prints a clear PASS / FAIL verdict.

If FAIL, prints remediation options:
  A) Train doc detector on CPU (~7–10 days; slow but correct)
  B) Switch to axis-aligned doc detector + rotation augmentation (lower
     accuracy, but no OBB ops needed — MPS never triggers the buggy path)

Background:
  Ultralytics issues #10181 and #13081 document silent MPS correctness bugs
  in rotated bounding-box operations on some PyTorch + macOS combinations.
  This smoke test validates that YOUR specific environment is not affected
  before you commit to an 80-epoch, 20+ hour training run.

Usage:
    python model-training/smoke_test_obb.py
    python model-training/smoke_test_obb.py --dry-run
    python model-training/smoke_test_obb.py --subset-size 2000 --seed 99
"""

import argparse
import logging
import random
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from utils.paths import YOLO_OBB_ROOT, RUNS_ROOT


SUBSET_SIZE = 10_000
RANDOM_SEED = 42
LOSS_TOLERANCE = 0.05    # 5 % relative tolerance on box loss
KL_THRESHOLD = 0.1       # KL divergence threshold for angle histograms


def setup_logging(run_dir: Path) -> logging.Logger:
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "smoke_test.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def build_subset_yaml(subset_dir: Path, parent_yaml: Path, subset_size: int, seed: int) -> Path:
    """
    Create a temporary YOLO data.yaml pointing to a random subset of the
    training images. Validation set is taken verbatim from the parent yaml's
    val split (capped at 1000 images for speed).

    Returns the path to the new subset data.yaml.
    """
    import yaml

    with open(parent_yaml) as f:
        cfg = yaml.safe_load(f)

    parent_root = Path(cfg["path"])
    train_img_dir = parent_root / cfg["train"]

    all_imgs = sorted(train_img_dir.glob("*.jpg"))
    if not all_imgs:
        raise FileNotFoundError(f"No images found in {train_img_dir}")

    rng = random.Random(seed)
    subset = rng.sample(all_imgs, min(subset_size, len(all_imgs)))

    # Symlink subset images + copy labels to subset_dir
    (subset_dir / "images" / "train").mkdir(parents=True, exist_ok=True)
    (subset_dir / "labels" / "train").mkdir(parents=True, exist_ok=True)

    for img_path in subset:
        dst_img = subset_dir / "images" / "train" / img_path.name
        if not dst_img.exists():
            dst_img.symlink_to(img_path.resolve())
        # Copy label
        lbl_path = parent_root / "labels" / "train" / img_path.with_suffix(".txt").name
        dst_lbl = subset_dir / "labels" / "train" / lbl_path.name
        if lbl_path.exists() and not dst_lbl.exists():
            shutil.copy2(lbl_path, dst_lbl)

    # Reuse val split from parent (symlink directory)
    val_link = subset_dir / "images" / "val"
    if not val_link.exists():
        val_link.symlink_to((parent_root / cfg["val"]).resolve())
    val_lbl_link = subset_dir / "labels" / "val"
    if not val_lbl_link.exists():
        val_lbl_link.symlink_to((parent_root / "labels" / "val").resolve())

    subset_cfg = {
        "path": str(subset_dir),
        "train": "images/train",
        "val": "images/val",
        "nc": cfg["nc"],
        "names": cfg["names"],
        "task": "obb",
    }
    subset_yaml = subset_dir / "data.yaml"
    with open(subset_yaml, "w") as f:
        yaml.dump(subset_cfg, f, default_flow_style=False, sort_keys=False)

    return subset_yaml


def run_2epoch_training(
    device: str,
    data_yaml: Path,
    run_name: str,
    dry_run: bool,
    logger: logging.Logger,
) -> dict:
    """
    Train YOLOv8n-OBB for 2 epochs on `device`.

    Returns a dict with keys:
        epoch2_box_loss  (float)
        angle_histogram  (list[float], 36 bins covering 0–180°)
        run_dir          (Path)
    """
    import torch

    logger.info("Starting 2-epoch OBB training on device=%s", device)

    if dry_run:
        logger.info("[dry-run] would train on %s — skipping", device)
        return {
            "epoch2_box_loss": 0.0,
            "angle_histogram": [1.0 / 36] * 36,
            "run_dir": RUNS_ROOT / "smoke" / run_name,
        }

    import traceback

    from ultralytics import YOLO

    run_dir = RUNS_ROOT / "smoke"
    model = YOLO("yolov8n-obb.pt")

    try:
        results = model.train(
            data=str(data_yaml),
            epochs=2,
            imgsz=320,
            batch=32,
            device=device,
            amp=(device == "mps"),   # FP16 on MPS; CPU always FP32
            workers=4,
            cache=False,
            optimizer="AdamW",
            lr0=0.001,
            cos_lr=False,
            patience=0,
            save_period=1,
            project=str(run_dir),
            name=run_name,
            exist_ok=True,
            verbose=False,
        )
    except Exception:
        logger.error(
            "model.train() failed on device=%s:\n%s", device, traceback.format_exc()
        )
        return {
            "epoch2_box_loss": float("nan"),
            "angle_histogram": [1.0 / 36] * 36,
            "run_dir": run_dir / run_name,
        }

    # Extract epoch-2 box loss from results CSV
    import csv

    results_csv = run_dir / run_name / "results.csv"
    epoch2_box_loss = float("nan")
    if results_csv.exists():
        with open(results_csv) as f:
            rows = list(csv.DictReader(f))
        if len(rows) >= 2:
            # Column name varies; try common variations
            for col_key in ("train/box_loss", "box_loss", "train_box_loss"):
                if col_key in rows[-1]:
                    epoch2_box_loss = float(rows[-1][col_key])
                    break

    # Run validation to produce per-image prediction label files with angles.
    # model.val() with save_txt=True writes Ultralytics OBB label files:
    #   class x1 y1 x2 y2 x3 y3 x4 y4 conf
    # into <project>/<name>/val/labels/ which _extract_angle_histogram() reads.
    trained_weights = run_dir / run_name / "weights" / "best.pt"
    if not trained_weights.exists():
        trained_weights = run_dir / run_name / "weights" / "last.pt"
    try:
        val_model = YOLO(str(trained_weights)) if trained_weights.exists() else model
        val_model.val(
            data=str(data_yaml),
            split="val",
            imgsz=320,
            batch=32,
            device=device,
            save_txt=True,
            save_conf=True,
            save=False,
            project=str(run_dir / run_name),
            name="val",
            exist_ok=True,
            verbose=False,
        )
    except Exception:
        logger.warning(
            "model.val() failed on device=%s (angle check will use uniform fallback):\n%s",
            device,
            traceback.format_exc(),
        )

    # Extract predicted angle distribution from val/labels/ prediction files
    val_labels_dir = run_dir / run_name / "val" / "labels"
    angle_histogram = _extract_angle_histogram(val_labels_dir, n_bins=36)

    return {
        "epoch2_box_loss": epoch2_box_loss,
        "angle_histogram": angle_histogram,
        "run_dir": run_dir / run_name,
    }


def _extract_angle_histogram(pred_labels_dir: Path, n_bins: int = 36) -> list[float]:
    """
    Parse Ultralytics OBB save_txt prediction files to build an angle distribution.

    Ultralytics OBB save_txt format (one detection per line):
        class x1 y1 x2 y2 x3 y3 x4 y4 [conf]
    where x1,y1 → x2,y2 is the first edge (defines rotation angle).
    We derive the angle from the first two corner points.
    Returns a normalized histogram over [0, 180) degrees.

    pred_labels_dir should be the val/labels/ directory written by model.val()
    with save_txt=True.
    """
    import math

    angles: list[float] = []
    if not pred_labels_dir.exists():
        return [1.0 / n_bins] * n_bins  # uniform fallback — no predictions available

    for txt_file in pred_labels_dir.glob("*.txt"):
        try:
            for line in txt_file.read_text().splitlines():
                parts = line.strip().split()
                if len(parts) < 9:
                    continue
                # Format: class x1 y1 x2 y2 x3 y3 x4 y4 [conf]
                x1, y1, x2, y2 = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
                angle_deg = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180
                angles.append(angle_deg)
        except (ValueError, IOError):
            continue

    if not angles:
        return [1.0 / n_bins] * n_bins  # uniform fallback

    hist = [0.0] * n_bins
    bin_width = 180.0 / n_bins
    for a in angles:
        idx = min(int(a / bin_width), n_bins - 1)
        hist[idx] += 1.0

    total = sum(hist)
    return [c / total for c in hist] if total > 0 else [1.0 / n_bins] * n_bins


def kl_divergence(p: list[float], q: list[float], epsilon: float = 1e-8) -> float:
    """Symmetric KL divergence KL(P||Q) + KL(Q||P)."""
    import math

    kl = 0.0
    for pi, qi in zip(p, q):
        pi = max(pi, epsilon)
        qi = max(qi, epsilon)
        kl += pi * math.log(pi / qi) + qi * math.log(qi / pi)
    return kl


def main() -> None:
    parser = argparse.ArgumentParser(
        description="2-epoch MPS-vs-CPU OBB smoke test for YOLOv8n-OBB."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without running training.",
    )
    parser.add_argument(
        "--subset-size",
        type=int,
        default=SUBSET_SIZE,
        help=f"Number of training images to use (default: {SUBSET_SIZE}).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=RANDOM_SEED,
        help=f"Random seed (default: {RANDOM_SEED}).",
    )
    args = parser.parse_args()

    run_log_dir = RUNS_ROOT / "smoke"
    logger = setup_logging(run_log_dir)

    # ---------------------------------------------------------------------------
    # Pre-flight checks
    # ---------------------------------------------------------------------------
    data_yaml = YOLO_OBB_ROOT / "data.yaml"
    if not data_yaml.exists():
        logger.error(
            "data.yaml not found at %s\nRun prepare_yolo_obb.py first.", data_yaml
        )
        sys.exit(1)

    # Check MPS availability
    try:
        import torch
        mps_available = torch.backends.mps.is_available()
    except ImportError:
        logger.error("PyTorch not installed. Run: pip install -r requirements.txt")
        sys.exit(1)

    if not mps_available:
        logger.error(
            "MPS not available on this machine. "
            "This smoke test requires an Apple Silicon Mac."
        )
        sys.exit(1)

    # Build subset dataset
    subset_dir = RUNS_ROOT / "smoke" / "subset_data"
    if not args.dry_run:
        logger.info("Building %d-sample subset in %s ...", args.subset_size, subset_dir)
        try:
            subset_yaml = build_subset_yaml(subset_dir, data_yaml, args.subset_size, args.seed)
        except FileNotFoundError as e:
            logger.error(str(e))
            sys.exit(1)
    else:
        subset_yaml = subset_dir / "data.yaml"
        logger.info("[dry-run] subset data.yaml would be at %s", subset_yaml)

    # ---------------------------------------------------------------------------
    # Train on MPS
    # ---------------------------------------------------------------------------
    logger.info("=" * 60)
    logger.info("STAGE 1: Training on MPS (FP16)")
    logger.info("=" * 60)
    mps_results = run_2epoch_training(
        device="mps",
        data_yaml=subset_yaml,
        run_name="smoke_mps",
        dry_run=args.dry_run,
        logger=logger,
    )

    # ---------------------------------------------------------------------------
    # Train on CPU
    # ---------------------------------------------------------------------------
    logger.info("=" * 60)
    logger.info("STAGE 2: Training on CPU (FP32 — reference)")
    logger.info("=" * 60)
    cpu_results = run_2epoch_training(
        device="cpu",
        data_yaml=subset_yaml,
        run_name="smoke_cpu",
        dry_run=args.dry_run,
        logger=logger,
    )

    # ---------------------------------------------------------------------------
    # Comparison
    # ---------------------------------------------------------------------------
    logger.info("=" * 60)
    logger.info("RESULTS")
    logger.info("=" * 60)

    mps_loss = mps_results["epoch2_box_loss"]
    cpu_loss = cpu_results["epoch2_box_loss"]
    logger.info("Epoch-2 box loss  MPS: %.4f  CPU: %.4f", mps_loss, cpu_loss)

    kl = kl_divergence(mps_results["angle_histogram"], cpu_results["angle_histogram"])
    logger.info("Angle distribution KL divergence (symmetric): %.4f", kl)

    # Loss check: relative difference
    if cpu_loss > 0:
        loss_rel_diff = abs(mps_loss - cpu_loss) / cpu_loss
    else:
        loss_rel_diff = 0.0 if args.dry_run else float("inf")

    logger.info("Loss relative difference: %.2f %%", loss_rel_diff * 100)

    pass_loss = loss_rel_diff <= LOSS_TOLERANCE or args.dry_run
    pass_kl = kl < KL_THRESHOLD or args.dry_run

    logger.info("  Loss check   (≤%.0f%%):  %s", LOSS_TOLERANCE * 100, "PASS" if pass_loss else "FAIL")
    logger.info("  KL check     (<%.2f):  %s", KL_THRESHOLD, "PASS" if pass_kl else "FAIL")

    logger.info("Preview images:")
    logger.info("  MPS: %s/train_batch0.jpg", mps_results["run_dir"])
    logger.info("  CPU: %s/train_batch0.jpg", cpu_results["run_dir"])

    overall_pass = pass_loss and pass_kl

    logger.info("=" * 60)
    if overall_pass:
        logger.info("VERDICT: PASS — proceed to train_doc_detector.py")
    else:
        logger.error("VERDICT: FAIL — MPS OBB correctness issue detected")
        logger.error("")
        logger.error("Remediation options:")
        logger.error(
            "  A) Train doc detector on CPU:\n"
            "       python model-training/train_doc_detector.py --device cpu\n"
            "     Expected wall time: ~7-10 days for 80 epochs on 525K images.\n"
            "     Accuracy: highest (no compromise)."
        )
        logger.error(
            "  B) Switch to axis-aligned doc detector + rotation augmentation:\n"
            "       Modify train_doc_detector.py to use yolov8n.pt (not obb)\n"
            "       and add hsflip/vsflip/degrees=30 augmentations.\n"
            "     Expected wall time: ~10-15 hrs on MPS.\n"
            "     Accuracy: slightly lower for extreme tilts (>30°)."
        )
    logger.info("=" * 60)

    sys.exit(0 if overall_pass else 1)


if __name__ == "__main__":
    main()
