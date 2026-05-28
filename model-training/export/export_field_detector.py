"""
export_field_detector.py — Export trained field detector to Core ML + TFLite.

Loads the Ultralytics YOLOv8n (axis-aligned) weights from:
    runs/field_detector/run/weights/best.pt

Exports to:
    1. Core ML int8 (weight-only, via coremltools.optimize.coreml.linear_quantize_weights)
       → MODELS_OUTPUT/DlScanFieldDetector.mlpackage  (compiled to .mlmodelc via xcrun)
    2. TFLite int8 (calibrated, via Ultralytics export + representative_dataset)
       → MODELS_OUTPUT/dl_scan_field_detector.tflite

Also updates MODELS_OUTPUT/version.json with training metadata.

Notes:
  - imgsz=640 at export (matches training resolution).
  - Axis-aligned model — no OBB-specific export concerns.
  - The field class list is defined in prepare_yolo_fields.py:FIELD_CLASSES.

Usage:
    python model-training/export/export_field_detector.py
    python model-training/export/export_field_detector.py --dry-run
    python model-training/export/export_field_detector.py --skip-tflite
"""

import argparse
import json
import logging
import random
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import YOLO_FIELDS_ROOT, RUNS_ROOT, MODELS_OUTPUT

WEIGHTS_PATH = RUNS_ROOT / "field_detector" / "run" / "weights" / "best.pt"
COREML_PACKAGE = MODELS_OUTPUT / "DlScanFieldDetector.mlpackage"
COREML_COMPILED = MODELS_OUTPUT / "DlScanFieldDetector.mlmodelc"
TFLITE_PATH = MODELS_OUTPUT / "dl_scan_field_detector.tflite"
VERSION_JSON = MODELS_OUTPUT / "version.json"

N_CALIBRATION_SAMPLES = 500
RANDOM_SEED = 42


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "export_field_detector.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def get_calibration_images(n: int, seed: int) -> list[Path]:
    """Return N stratified sample images from YOLO_FIELDS_ROOT/images/val."""
    rng = random.Random(seed)
    val_dir = YOLO_FIELDS_ROOT / "images" / "val"
    if not val_dir.exists():
        val_dir = YOLO_FIELDS_ROOT / "images" / "train"
    all_imgs = sorted(val_dir.glob("*.jpg"))
    if not all_imgs:
        return []
    return rng.sample(all_imgs, min(n, len(all_imgs)))


def export_coreml(model: "YOLO", dry_run: bool, logger: logging.Logger) -> Path | None:
    """Export to Core ML (.mlpackage) with weight-only int8 quantization."""
    import coremltools as ct
    import coremltools.optimize.coreml as cto

    logger.info("Exporting field detector to Core ML (float32 intermediate)...")

    if dry_run:
        logger.info("[dry-run] Would export to %s", COREML_PACKAGE)
        return COREML_PACKAGE

    MODELS_OUTPUT.mkdir(parents=True, exist_ok=True)

    tmp_export = model.export(
        format="coreml",
        imgsz=640,
        half=False,
        nms=False,  # NMS in Swift host: required for mlprogram-typed model so coremltools int8 quantization can run
    )
    tmp_export_path = Path(tmp_export) if tmp_export else None

    if not tmp_export_path or not tmp_export_path.exists():
        logger.error("Core ML export failed — no output file produced")
        return None

    logger.info("Applying weight-only int8 quantization...")
    ct_model = ct.models.MLModel(str(tmp_export_path))

    op_config = cto.OpLinearQuantizerConfig(
        mode="linear",
        dtype=np.int8,
        granularity="per_channel",
        weight_threshold=65536,
    )
    config = cto.OptimizationConfig(global_config=op_config)
    quantized_model = cto.linear_quantize_weights(ct_model, config=config)

    if COREML_PACKAGE.exists():
        shutil.rmtree(COREML_PACKAGE)
    quantized_model.save(str(COREML_PACKAGE))
    logger.info("Core ML int8 model saved: %s", COREML_PACKAGE)

    logger.info("Compiling to .mlmodelc via xcrun coremlcompiler...")
    if COREML_COMPILED.exists():
        shutil.rmtree(COREML_COMPILED)
    result = subprocess.run(
        [
            "xcrun", "coremlcompiler", "compile",
            str(COREML_PACKAGE),
            str(MODELS_OUTPUT),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        logger.warning(
            "xcrun coremlcompiler failed (non-fatal):\n%s", result.stderr
        )
    else:
        logger.info("Compiled: %s", COREML_COMPILED)

    try:
        if tmp_export_path != COREML_PACKAGE:
            if tmp_export_path.is_dir():
                shutil.rmtree(tmp_export_path)
            else:
                tmp_export_path.unlink()
    except Exception:
        pass

    return COREML_PACKAGE


def export_tflite(model: "YOLO", calibration_imgs: list[Path],
                  dry_run: bool, logger: logging.Logger) -> Path | None:
    """Export to TFLite int8 with representative_dataset calibration."""
    logger.info("Exporting field detector to TFLite int8 (%d calibration samples)...",
                len(calibration_imgs))

    if dry_run:
        logger.info("[dry-run] Would export to %s", TFLITE_PATH)
        return TFLITE_PATH

    MODELS_OUTPUT.mkdir(parents=True, exist_ok=True)

    tmp_export = model.export(
        format="tflite",
        imgsz=640,
        int8=True,
        data=str(YOLO_FIELDS_ROOT / "data.yaml"),
        nms=False,
        fraction=0.05,
    )
    tmp_export_path = Path(tmp_export) if tmp_export else None

    if not tmp_export_path or not tmp_export_path.exists():
        logger.error("TFLite export failed — no output file produced")
        return None

    TFLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(tmp_export_path), str(TFLITE_PATH))
    logger.info("TFLite int8 model saved: %s", TFLITE_PATH)
    return TFLITE_PATH


def update_version_json(extra: dict) -> None:
    existing: dict = {}
    if VERSION_JSON.exists():
        try:
            existing = json.loads(VERSION_JSON.read_text())
        except json.JSONDecodeError:
            pass
    existing["field_detector"] = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "weights": str(WEIGHTS_PATH),
        "coreml_int8": str(COREML_PACKAGE),
        "tflite_int8": str(TFLITE_PATH),
        **extra,
    }
    VERSION_JSON.parent.mkdir(parents=True, exist_ok=True)
    VERSION_JSON.write_text(json.dumps(existing, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export trained field detector to Core ML int8 + TFLite int8."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Print export plan without writing files.")
    parser.add_argument("--skip-tflite", action="store_true",
                        help="Skip TFLite export (Core ML only).")
    parser.add_argument("--skip-coreml", action="store_true",
                        help="Skip Core ML export (TFLite only).")
    parser.add_argument("--weights", type=Path, default=WEIGHTS_PATH,
                        help=f"Path to trained .pt weights (default: {WEIGHTS_PATH}).")
    parser.add_argument("--n-calibration", type=int, default=N_CALIBRATION_SAMPLES,
                        help=f"TFLite calibration samples (default: {N_CALIBRATION_SAMPLES}).")
    args = parser.parse_args()

    log_dir = RUNS_ROOT / "export"
    logger = setup_logging(log_dir)

    weights = args.weights
    if not args.dry_run and not weights.exists():
        logger.error("Weights not found: %s\nRun train_field_detector.py first.", weights)
        sys.exit(1)

    try:
        from ultralytics import YOLO
    except ImportError as e:
        logger.error("Import error: %s\nRun: pip install -r requirements.txt", e)
        sys.exit(1)

    logger.info("Loading weights: %s", weights)
    if not args.dry_run:
        model = YOLO(str(weights))
    else:
        model = None

    calibration_imgs = get_calibration_images(args.n_calibration, RANDOM_SEED)
    logger.info("Calibration images: %d", len(calibration_imgs))

    coreml_path = None
    if not args.skip_coreml:
        coreml_path = export_coreml(model, dry_run=args.dry_run, logger=logger)

    tflite_path = None
    if not args.skip_tflite:
        tflite_path = export_tflite(
            model, calibration_imgs, dry_run=args.dry_run, logger=logger
        )

    if not args.dry_run:
        update_version_json({
            "coreml_ok": coreml_path is not None,
            "tflite_ok": tflite_path is not None,
        })
        logger.info("version.json updated: %s", VERSION_JSON)

    logger.info("Export complete.")
    logger.info("Next step: python model-training/export/validate_quantization.py")


if __name__ == "__main__":
    main()
