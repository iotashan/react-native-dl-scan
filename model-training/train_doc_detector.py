"""
train_doc_detector.py — YOLOv8n-OBB document detector training.

Hardware: M3 Ultra (256 GB unified memory, 80-core GPU, 32-core Neural Engine)
Expected wall time: ~20-30 hours for 80 epochs on 525K images at imgsz=320
Estimated GPU memory: ~8-12 GB peak at batch=128

PRE-FLIGHT CHECKLIST:
  1. smoke_test_obb.py returned PASS.  If not, see its FAIL remediation.
  2. prepare_yolo_obb.py has produced data.yaml + 525K labeled images under
     YOLO_OBB_ROOT (verify with: ls $YOLO_OBB_ROOT/images/train | wc -l).
  3. At least 500 GB free disk space for Ultralytics cache + checkpoints.
  4. Monitor thermals during training:
         sudo powermetrics --samplers smc,gpu_power,thermal -i 1000
     If first epoch is significantly faster than subsequent ones, suspect
     thermal throttling. Allow 30 min warmup before drawing conclusions.

NOTES:
  - amp=True uses FP16 mixed precision on MPS.  This is the Ultralytics
    `amp` parameter which triggers torch.autocast internally.  If you
    encounter BF16-related errors, set amp=False and file a bug against
    Ultralytics — MPS should use FP16, not BF16.
  - cache=False: 'ram' cache would require ~257 GB for 525K images; use
    disk caching only after confirming I/O is the bottleneck.
  - patience=10: early stopping after 10 epochs without val improvement.
    If your dataset is small (dev subset), consider patience=0 to disable.

Usage:
    python model-training/train_doc_detector.py
    python model-training/train_doc_detector.py --dry-run
    python model-training/train_doc_detector.py --device cpu   (fallback)
    python model-training/train_doc_detector.py --epochs 10 --batch 32  (dev)
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from utils.paths import YOLO_OBB_ROOT, RUNS_ROOT


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
            "Train YOLOv8n-OBB document detector on M3 Ultra (MPS, FP16)."
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
        default=80,
        help="Number of training epochs (default: 80).",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=128,
        help="Batch size (default: 128; reduce if GPU OOM).",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=320,
        help="Training image size (default: 320).",
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

    run_dir = RUNS_ROOT / "doc_detector"
    logger = setup_logging(run_dir)

    # ---------------------------------------------------------------------------
    # Pre-flight checks
    # ---------------------------------------------------------------------------
    data_yaml = YOLO_OBB_ROOT / "data.yaml"
    if not data_yaml.exists():
        logger.error(
            "data.yaml not found: %s\nRun prepare_yolo_obb.py first.", data_yaml
        )
        sys.exit(1)

    train_img_dir = YOLO_OBB_ROOT / "images" / "train"
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
        # FP16 mixed precision — MPS amp uses FP16 in Ultralytics >= 8.3.
        # If MPS amp triggers BF16 issues, set amp=False here.
        amp=(args.device == "mps"),
        workers=args.workers,
        # cache=False: RAM caching of 525K images would need ~257 GB.
        # Enable disk caching only if I/O is confirmed bottleneck:
        #   cache='disk'
        cache=False,
        optimizer="AdamW",
        lr0=0.001,
        lrf=0.01,        # final lr = lr0 * lrf
        cos_lr=True,
        patience=10,
        save_period=10,  # checkpoint every 10 epochs
        project=str(RUNS_ROOT / "doc_detector"),
        name="run",
        exist_ok=True,
        # Augmentation (Ultralytics defaults + OBB-friendly settings)
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.4,
        degrees=0.0,     # no rotation aug — OBB handles orientation
        translate=0.1,
        scale=0.5,
        flipud=0.0,
        fliplr=0.5,
        mosaic=1.0,
        mixup=0.0,
    )

    logger.info("Training configuration:")
    for k, v in train_cfg.items():
        logger.info("  %-20s = %s", k, v)

    if args.dry_run:
        logger.info("[dry-run] Training configuration printed above. No training started.")
        logger.info("Estimated wall time: ~20-30 hrs on M3 Ultra (80 epochs, 525K images)")
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
        logger.info("Loading YOLOv8n-OBB base weights...")
        model = YOLO("yolov8n-obb.pt")

    logger.info("Starting training...")
    logger.info(
        "Estimated wall time: ~20-30 hrs (80 epochs, M3 Ultra MPS). "
        "Monitor thermals: sudo powermetrics --samplers smc,gpu_power,thermal -i 1000"
    )

    results = model.train(**train_cfg)

    logger.info("Training complete.")
    logger.info("Best weights: %s", RUNS_ROOT / "doc_detector" / "run" / "weights" / "best.pt")
    logger.info(
        "Next step: python model-training/export/export_doc_detector.py"
    )


if __name__ == "__main__":
    main()
