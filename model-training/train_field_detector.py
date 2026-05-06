"""
train_field_detector.py — YOLOv8n axis-aligned field detector training.

Hardware: M3 Ultra (256 GB unified memory, 80-core GPU, 32-core Neural Engine)
Expected wall time: ~15-25 hours for 60 epochs on 525K images at imgsz=640
Estimated GPU memory: ~10-16 GB peak at batch=64

This is an axis-aligned (non-OBB) YOLO model trained on rectified 640×640
document crops produced by prepare_yolo_fields.py.

Because no OBB operations are involved, MPS correctness is not a concern —
this script does not require smoke_test_obb.py to PASS first.

PRE-FLIGHT CHECKLIST:
  1. prepare_yolo_fields.py has produced data.yaml + 525K labeled images
     under YOLO_FIELDS_ROOT (verify: ls $YOLO_FIELDS_ROOT/images/train | wc -l).
  2. At least 400 GB free disk space.
  3. You can run this concurrently with disambig/render_ocr_pairs.py because
     OCR pair generation runs on the Neural Engine, not the GPU.
  4. Do NOT run this simultaneously with train_doc_detector.py —
     sequential GPU training is the default strategy.

NOTES:
  - imgsz=640 (NOT 320): field detection needs higher resolution to distinguish
    small text fields on the rectified 640×640 document crop.
  - batch=64: halved vs doc detector because 640×640 images use 4× the GPU
    memory per image compared to 320×320.
  - The field classes are defined in prepare_yolo_fields.py:FIELD_CLASSES.
    31 classes covering AAMVA list_* fields + international ID fields.

Usage:
    python model-training/train_field_detector.py
    python model-training/train_field_detector.py --dry-run
    python model-training/train_field_detector.py --device cpu
    python model-training/train_field_detector.py --epochs 5 --batch 16  (dev)
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from utils.paths import YOLO_FIELDS_ROOT, RUNS_ROOT


def setup_logging(run_dir: Path) -> logging.Logger:
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "train.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Train YOLOv8n axis-aligned field detector on M3 Ultra (MPS, FP16)."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the training config without starting training.",
    )
    parser.add_argument(
        "--device",
        default="mps",
        choices=["mps", "cpu", "cuda"],
        help="Training device (default: mps).",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=60,
        help="Number of training epochs (default: 60).",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=64,
        help="Batch size (default: 64; reduce if GPU OOM at imgsz=640).",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Training image size (default: 640).",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="DataLoader workers (default: 8).",
    )
    parser.add_argument(
        "--resume",
        type=str,
        default=None,
        metavar="CHECKPOINT",
        help="Path to a .pt checkpoint to resume from.",
    )
    args = parser.parse_args()

    run_dir = RUNS_ROOT / "field_detector"
    logger = setup_logging(run_dir)

    # ---------------------------------------------------------------------------
    # Pre-flight checks
    # ---------------------------------------------------------------------------
    data_yaml = YOLO_FIELDS_ROOT / "data.yaml"
    if not data_yaml.exists():
        logger.error(
            "data.yaml not found: %s\nRun prepare_yolo_fields.py first.", data_yaml
        )
        sys.exit(1)

    train_img_dir = YOLO_FIELDS_ROOT / "images" / "train"
    if not args.dry_run and train_img_dir.exists():
        n_train = sum(1 for _ in train_img_dir.glob("*.jpg"))
        logger.info("Training images: %d", n_train)
        if n_train == 0:
            logger.error("No training images found in %s", train_img_dir)
            sys.exit(1)

    # ---------------------------------------------------------------------------
    # Training config
    # ---------------------------------------------------------------------------
    train_cfg = dict(
        data=str(data_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        amp=(args.device == "mps"),
        workers=args.workers,
        cache=False,
        optimizer="AdamW",
        lr0=0.001,
        lrf=0.01,
        cos_lr=True,
        patience=10,
        save_period=10,
        project=str(RUNS_ROOT / "field_detector"),
        name="run",
        exist_ok=True,
        # Field detection benefits from moderate augmentation.
        # Rotation is disabled — documents are pre-rectified to 640×640.
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.4,
        degrees=0.0,
        translate=0.05,  # conservative — fields have fixed positions
        scale=0.3,
        flipud=0.0,
        fliplr=0.0,      # flipping changes which side name/DOB appear on
        mosaic=0.5,      # moderate mosaic for field-level diversity
        mixup=0.0,
    )

    logger.info("Training configuration:")
    for k, v in train_cfg.items():
        logger.info("  %-20s = %s", k, v)

    if args.dry_run:
        logger.info("[dry-run] Training configuration printed above. No training started.")
        logger.info("Estimated wall time: ~15-25 hrs on M3 Ultra (60 epochs, 525K images, imgsz=640)")
        sys.exit(0)

    # ---------------------------------------------------------------------------
    # Train
    # ---------------------------------------------------------------------------
    try:
        import torch
        from ultralytics import YOLO
    except ImportError as e:
        logger.error("Import error: %s\nRun: pip install -r requirements.txt", e)
        sys.exit(1)

    if args.device == "mps" and not torch.backends.mps.is_available():
        logger.error(
            "MPS requested but not available. Use --device cpu or check torch installation."
        )
        sys.exit(1)

    if args.resume:
        logger.info("Resuming from checkpoint: %s", args.resume)
        model = YOLO(args.resume)
        train_cfg["resume"] = True
    else:
        logger.info("Loading YOLOv8n base weights (axis-aligned)...")
        model = YOLO("yolov8n.pt")

    logger.info("Starting training...")
    logger.info(
        "Estimated wall time: ~15-25 hrs (60 epochs, M3 Ultra MPS, imgsz=640). "
        "Monitor thermals: sudo powermetrics --samplers smc,gpu_power,thermal -i 1000"
    )

    results = model.train(**train_cfg)

    logger.info("Training complete.")
    logger.info(
        "Best weights: %s",
        RUNS_ROOT / "field_detector" / "run" / "weights" / "best.pt",
    )
    logger.info(
        "Next step: python model-training/export/export_field_detector.py"
    )


if __name__ == "__main__":
    main()
