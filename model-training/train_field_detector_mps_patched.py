"""
train_field_detector_mps_patched.py — train YOLOv8n field detector with an
MPS workaround for the TaskAlignedAssigner boolean-indexing bug.

Monkey-patches TaskAlignedAssigner.get_box_metrics to run on CPU when the
inputs are on MPS, then moves results back. Ultralytics issues #10181, #13081
have multiple variants of the MPS boolean-indexing overflow; v8.4.46 fixed
tal.py:175 but tal.py:199 remained — this patch covers both.

RESUMABLE: if last.pt exists in the run dir, training auto-resumes from it.
SAVE PER EPOCH: save_period=1 so worst-case crash loses 1 epoch.
"""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from utils.paths import YOLO_FIELDS_ROOT, RUNS_ROOT

import torch
from ultralytics import YOLO
from ultralytics.utils.tal import TaskAlignedAssigner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
logger = logging.getLogger(__name__)


# === MPS workaround monkey-patch ===
_original_get_box_metrics = TaskAlignedAssigner.get_box_metrics

def patched_get_box_metrics(self, pd_scores, pd_bboxes, gt_labels, gt_bboxes, mask_gt):
    target_device = pd_bboxes.device
    if target_device.type != "mps":
        return _original_get_box_metrics(self, pd_scores, pd_bboxes, gt_labels, gt_bboxes, mask_gt)
    am, ov = _original_get_box_metrics(
        self,
        pd_scores.to("cpu"),
        pd_bboxes.to("cpu"),
        gt_labels.to("cpu"),
        gt_bboxes.to("cpu"),
        mask_gt.to("cpu"),
    )
    return am.to(target_device), ov.to(target_device)

TaskAlignedAssigner.get_box_metrics = patched_get_box_metrics
logger.info("Applied MPS workaround monkey-patch on TaskAlignedAssigner.get_box_metrics")


def main():
    logger.info("Hardware: M3 Ultra MPS (with TAL CPU workaround)")
    logger.info("PyTorch: %s, MPS available: %s", torch.__version__, torch.backends.mps.is_available())

    data_yaml = YOLO_FIELDS_ROOT / "data.yaml"
    if not data_yaml.exists():
        logger.error("data.yaml missing at %s", data_yaml)
        sys.exit(2)

    run_dir = RUNS_ROOT / "field_detector" / "run_mps_patched"
    last_pt = run_dir / "weights" / "last.pt"

    train_kwargs = dict(
        data=str(data_yaml),
        epochs=60,
        imgsz=640,
        batch=64,
        device="mps",
        amp=True,
        workers=8,
        cache=False,
        optimizer="AdamW",
        lr0=1e-3,
        lrf=0.01,
        cos_lr=True,
        patience=10,
        save_period=1,             # save every epoch for resumability
        project=str(RUNS_ROOT / "field_detector"),
        name="run_mps_patched",
        exist_ok=True,
        verbose=True,
        plots=True,
        save=True,
        # Conservative augmentation
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
        degrees=0.0, translate=0.05, scale=0.3,
        flipud=0.0, fliplr=0.0,
        mosaic=0.5, mixup=0.0,
    )

    if last_pt.exists():
        logger.info("Resuming from existing checkpoint: %s", last_pt)
        model = YOLO(str(last_pt))
        train_kwargs["resume"] = True
    else:
        logger.info("Starting fresh training from yolov8n.pt base weights")
        model = YOLO("yolov8n.pt")

    results = model.train(**train_kwargs)
    logger.info("Training complete: %s", results)


if __name__ == "__main__":
    main()
