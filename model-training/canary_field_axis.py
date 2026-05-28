"""
canary_field_axis.py — quick canary to test whether Ultralytics 8.4.46
fixes the MPS axis-aligned YOLOv8 crash that 8.4.47 hit at tal.py:175.

Trains YOLOv8n axis-aligned for 1 epoch on a 10% subset, twice:
  1. device=mps (the test)
  2. device=cpu (the baseline)
Compares final box_loss; if MPS doesn't crash AND |loss_mps - loss_cpu| / loss_cpu < 5%, PASS.
(5% threshold instead of 1% because 1 epoch is noisy.)
"""
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from utils.paths import YOLO_FIELDS_ROOT, RUNS_ROOT

import torch
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
logger = logging.getLogger(__name__)


def run_one(device: str, run_name: str, epochs: int = 1, fraction: float = 0.1) -> dict:
    """Run 1 epoch of YOLOv8n axis-aligned training on the given device. Return final metrics."""
    out_dir = RUNS_ROOT / "canary" / run_name
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    logger.info("=" * 60)
    logger.info("CANARY: device=%s  fraction=%.2f  epochs=%d", device, fraction, epochs)
    logger.info("=" * 60)
    t0 = time.time()
    try:
        model = YOLO("yolov8n.pt")
        results = model.train(
            data=str(YOLO_FIELDS_ROOT / "data.yaml"),
            epochs=epochs,
            imgsz=640,
            batch=64,
            device=device,
            amp=(device == "mps"),
            workers=8,
            cache=False,
            optimizer="AdamW",
            lr0=1e-3,
            cos_lr=False,
            patience=10,
            fraction=fraction,
            project=str(RUNS_ROOT / "canary"),
            name=run_name,
            exist_ok=True,
            verbose=True,
            plots=False,
            save=False,
        )
        elapsed = time.time() - t0
        # Pull final loss from results
        # Ultralytics stores per-epoch metrics in results.results_dict
        rd = results.results_dict if results else {}
        return {
            "ok": True,
            "device": device,
            "elapsed_sec": elapsed,
            "metrics": rd,
        }
    except Exception as e:
        elapsed = time.time() - t0
        logger.exception("CANARY %s FAILED after %.1fs: %s", device, elapsed, e)
        return {
            "ok": False,
            "device": device,
            "elapsed_sec": elapsed,
            "error": str(e),
        }


def main():
    logger.info("Ultralytics canary — axis-aligned YOLOv8n field detector")
    logger.info("PyTorch: %s, MPS available: %s", torch.__version__, torch.backends.mps.is_available())

    if not (YOLO_FIELDS_ROOT / "data.yaml").exists():
        logger.error("data.yaml missing at %s", YOLO_FIELDS_ROOT / "data.yaml")
        sys.exit(2)

    mps_result = run_one("mps", "canary_mps")
    if not mps_result["ok"]:
        logger.error("=" * 60)
        logger.error("VERDICT: FAIL — MPS run crashed.")
        logger.error("Error: %s", mps_result.get("error"))
        logger.error("Recommendation: cloud H100 (Ultralytics CUDA reference path)")
        logger.error("=" * 60)
        sys.exit(1)

    cpu_result = run_one("cpu", "canary_cpu")
    if not cpu_result["ok"]:
        logger.error("CPU baseline also crashed — that's a config / data bug, not MPS")
        logger.error("Error: %s", cpu_result.get("error"))
        sys.exit(2)

    # Compare metrics
    mps_box = mps_result["metrics"].get("train/box_loss") or mps_result["metrics"].get("val/box_loss")
    cpu_box = cpu_result["metrics"].get("train/box_loss") or cpu_result["metrics"].get("val/box_loss")

    logger.info("=" * 60)
    logger.info("Results:")
    logger.info("  MPS: elapsed=%.1fs  box_loss=%s", mps_result["elapsed_sec"], mps_box)
    logger.info("  CPU: elapsed=%.1fs  box_loss=%s", cpu_result["elapsed_sec"], cpu_box)
    logger.info("  MPS metrics: %s", mps_result["metrics"])
    logger.info("  CPU metrics: %s", cpu_result["metrics"])

    if mps_box is None or cpu_box is None:
        logger.error("VERDICT: INCONCLUSIVE — couldn't extract box_loss from results")
        sys.exit(2)

    rel_diff = abs(mps_box - cpu_box) / cpu_box if cpu_box > 0 else float("inf")
    logger.info("  |loss_mps - loss_cpu| / loss_cpu = %.3f", rel_diff)

    if rel_diff < 0.05:
        logger.info("=" * 60)
        logger.info("VERDICT: PASS — MPS converges within 5%% of CPU baseline. SAFE TO TRAIN ON MPS.")
        logger.info("=" * 60)
        sys.exit(0)
    else:
        logger.warning("=" * 60)
        logger.warning("VERDICT: FAIL — MPS diverged from CPU by %.1f%% (threshold 5%%).", rel_diff * 100)
        logger.warning("Recommendation: cloud H100 to avoid MPS correctness risk.")
        logger.warning("=" * 60)
        sys.exit(1)


if __name__ == "__main__":
    main()
