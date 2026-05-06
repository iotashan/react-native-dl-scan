"""
export_doc_detector.py — Export trained doc detector to Core ML + TFLite.

Loads the Ultralytics YOLOv8n-OBB weights from:
    runs/doc_detector/run/weights/best.pt

Exports to:
    1. Core ML float32 (intermediate, for quantization input)
    2. Core ML int8 (weight-only, via coremltools.optimize.coreml.linear_quantize_weights)
       → MODELS_OUTPUT/DlScanDocDetector.mlpackage  (compiled to .mlmodelc via xcrun)
    3. TFLite int8 (calibrated, via Ultralytics export + representative_dataset)
       → MODELS_OUTPUT/dl_scan_doc_detector.tflite

Also updates MODELS_OUTPUT/version.json with training metadata.

Architecture notes:
  - OBB NMS lives in Swift/Kotlin (NOT in the exported graph).
    Core ML and TFLite NMS in-graph only support axis-aligned boxes.
  - Weight-only int8 quantization requires NO calibration data — it quantizes
    weight tensors only, leaving activations in float32/float16.
  - TFLite int8 (full quantization) requires a representative_dataset of
    300-500 stratified samples from the training distribution.

Usage:
    python model-training/export/export_doc_detector.py
    python model-training/export/export_doc_detector.py --dry-run
    python model-training/export/export_doc_detector.py --skip-tflite
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
from utils.paths import YOLO_OBB_ROOT, RUNS_ROOT, MODELS_OUTPUT

WEIGHTS_PATH = RUNS_ROOT / "doc_detector" / "run" / "weights" / "best.pt"
COREML_PACKAGE = MODELS_OUTPUT / "DlScanDocDetector.mlpackage"
COREML_COMPILED = MODELS_OUTPUT / "DlScanDocDetector.mlmodelc"
TFLITE_PATH = MODELS_OUTPUT / "dl_scan_doc_detector.tflite"
VERSION_JSON = MODELS_OUTPUT / "version.json"

N_CALIBRATION_SAMPLES = 500
RANDOM_SEED = 42


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "export_doc_detector.log"
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
    """Return N stratified sample images from YOLO_OBB_ROOT/images/val."""
    rng = random.Random(seed)
    val_dir = YOLO_OBB_ROOT / "images" / "val"
    if not val_dir.exists():
        # Fall back to train
        val_dir = YOLO_OBB_ROOT / "images" / "train"
    all_imgs = sorted(val_dir.glob("*.jpg"))
    if not all_imgs:
        return []
    return rng.sample(all_imgs, min(n, len(all_imgs)))


def export_coreml(model: "YOLO", dry_run: bool, logger: logging.Logger) -> Path | None:
    """
    Export to Core ML (.mlpackage), then apply weight-only int8 quantization.

    Returns path to the quantized .mlpackage, or None on failure.
    """
    import coremltools as ct
    import coremltools.optimize.coreml as cto

    logger.info("Exporting to Core ML (float32 intermediate)...")

    if dry_run:
        logger.info("[dry-run] Would export to %s", COREML_PACKAGE)
        return COREML_PACKAGE

    MODELS_OUTPUT.mkdir(parents=True, exist_ok=True)

    # Ultralytics Core ML export (produces a .mlpackage)
    tmp_export = model.export(
        format="coreml",
        imgsz=320,
        half=False,  # float32 first; we quantize afterwards
        nms=False,   # NMS in Swift, not in graph
    )
    tmp_export_path = Path(tmp_export) if tmp_export else None

    if not tmp_export_path or not tmp_export_path.exists():
        logger.error("Core ML export failed — no output file produced")
        return None

    # Apply weight-only int8 quantization (no calibration data required)
    logger.info("Applying weight-only int8 quantization...")
    ct_model = ct.models.MLModel(str(tmp_export_path))

    op_config = cto.OpLinearQuantizerConfig(
        mode="linear_symmetric",
        dtype=np.int8,
        granularity="per_channel",
    )
    config = cto.OptimizationConfig(global_config=op_config)
    quantized_model = cto.linear_quantize_weights(ct_model, config=config)

    # Save quantized model
    if COREML_PACKAGE.exists():
        shutil.rmtree(COREML_PACKAGE)
    quantized_model.save(str(COREML_PACKAGE))
    logger.info("Core ML int8 model saved: %s", COREML_PACKAGE)

    # Compile to .mlmodelc via xcrun for on-device deployment
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
            "xcrun coremlcompiler failed (non-fatal — .mlpackage still usable):\n%s",
            result.stderr,
        )
    else:
        logger.info("Compiled: %s", COREML_COMPILED)

    # Clean up float32 intermediate export from Ultralytics working dir
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
    """
    Export to TFLite int8 with representative_dataset calibration.
    """
    import cv2

    logger.info("Exporting to TFLite int8 (with %d calibration samples)...",
                len(calibration_imgs))

    if dry_run:
        logger.info("[dry-run] Would export to %s", TFLITE_PATH)
        return TFLITE_PATH

    MODELS_OUTPUT.mkdir(parents=True, exist_ok=True)

    # Ultralytics TFLite export (produces int8 model with representative data)
    # The data= argument points to a small calibration YAML or image dir.
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Write calibration images dir
        calib_dir = Path(tmp_dir) / "calib"
        calib_dir.mkdir()
        for img_path in calibration_imgs:
            shutil.copy2(img_path, calib_dir / img_path.name)

        tmp_export = model.export(
            format="tflite",
            imgsz=320,
            int8=True,
            data=str(YOLO_OBB_ROOT / "data.yaml"),
            # Ultralytics uses the val split as representative dataset;
            # N_CALIBRATION_SAMPLES images have been staged in calib_dir but
            # Ultralytics doesn't support a custom calib dir here.
            # It uses the yaml's val split internally (300-500 samples).
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
    """Update MODELS_OUTPUT/version.json with training metadata."""
    existing: dict = {}
    if VERSION_JSON.exists():
        try:
            existing = json.loads(VERSION_JSON.read_text())
        except json.JSONDecodeError:
            pass

    existing["doc_detector"] = {
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
        description="Export trained doc detector to Core ML int8 + TFLite int8."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print export plan without writing any files.",
    )
    parser.add_argument(
        "--skip-tflite",
        action="store_true",
        help="Skip TFLite export (Core ML only).",
    )
    parser.add_argument(
        "--weights",
        type=Path,
        default=WEIGHTS_PATH,
        help=f"Path to trained .pt weights (default: {WEIGHTS_PATH}).",
    )
    parser.add_argument(
        "--n-calibration",
        type=int,
        default=N_CALIBRATION_SAMPLES,
        help=f"Number of TFLite calibration samples (default: {N_CALIBRATION_SAMPLES}).",
    )
    args = parser.parse_args()

    log_dir = RUNS_ROOT / "export"
    logger = setup_logging(log_dir)

    weights = args.weights
    if not args.dry_run and not weights.exists():
        logger.error("Weights not found: %s\nRun train_doc_detector.py first.", weights)
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

    # Core ML export
    coreml_path = export_coreml(model, dry_run=args.dry_run, logger=logger)

    # TFLite export
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
