#!/usr/bin/env bash
# Full training pipeline runner.
#
# Architecture: platform-vendor doc segmentation (VisionKit / ML Kit Document
# Scanner) + a single trained field detector (YOLOv8n axis-aligned). The
# OBB doc detector was dropped after MPS smoke test failure (see
# docs/ARCHITECTURE_DECISIONS.md). A Keras OCR-disambiguation model was
# attempted and removed after diagnostic failure (see
# idnet/DISAMBIG_POSTMORTEM.md).
#
# Each stage runs in its own uv-managed env via the launchers in scripts/.
# Each launcher sets YOLO_AUTOINSTALL=False before any Ultralytics import.

set -uo pipefail

TRAINING_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/Volumes/Work4TB/dev/iotashan/idnet-data/training-$(date '+%Y%m%d-%H%M%S').log"

cd "$TRAINING_ROOT"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
banner() {
  echo ""
  echo "================================================================"
  echo "  $(ts)   STAGE: $*"
  echo "================================================================"
  echo ""
}

exec > >(tee -a "$LOG_FILE") 2>&1

banner "Starting training pipeline. Log: $LOG_FILE"
echo "Hardware: M3 Ultra, 256 GB unified. Local-only training."

banner "Stage 1.1 — IDNet extraction (resume; should be a no-op if already done)"
uv run --project envs/train python idnet/extract_subsets.py \
  || { echo "FAIL: extract_subsets"; exit 1; }

banner "Stage 1.3 — YOLO field-detection dataset (resume; should be a no-op if already done)"
uv run --project envs/train python idnet/prepare_yolo_fields.py \
  || { echo "FAIL: prepare_yolo_fields"; exit 1; }

banner "Stage 4 — YOLOv8n field detector training (MPS, imgsz=640, ~15-25 hrs)"
bash scripts/train_field.sh \
  || { echo "FAIL: train_field"; exit 1; }

# train_field_detector_mps_patched.py writes its checkpoints to
# runs/field_detector/run_mps_patched/, but the export script's default
# weights path is runs/field_detector/run/weights/best.pt. Create a symlink
# so a fresh pipeline run can find best.pt without passing --weights.
banner "Stage 4.5 — Symlink runs/field_detector/run → run_mps_patched"
( cd runs/field_detector && ln -sfn run_mps_patched run ) \
  || { echo "FAIL: symlink"; exit 1; }

banner "Stage 5 — Export field detector → Core ML int8 (~5 min)"
bash scripts/export_ios.sh \
  || { echo "FAIL: export_ios"; exit 1; }

banner "Stage 6 — Export field detector → TFLite int8 (~25-35 min)"
bash scripts/export_android.sh \
  || { echo "FAIL: export_android"; exit 1; }

banner "Stage 7 — Quantization regression check"
uv run --project envs/export-android python export/validate_quantization.py --model field_detector \
  || { echo "FAIL: validate_quantization"; exit 1; }

banner "ALL STAGES COMPLETE. Models at $(cd .. && pwd)/models/"
ls -la "$(cd .. && pwd)/models/" 2>&1 || echo "(models dir empty)"
