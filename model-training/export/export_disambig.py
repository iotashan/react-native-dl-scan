"""
export_disambig.py — Export Keras disambig model to Core ML + TFLite.

Loads the trained Keras model from:
    runs/disambig/best.keras

Exports to:
    1. Core ML → MODELS_OUTPUT/DlScanFieldDisambig.mlpackage
       (compiled to .mlmodelc via xcrun coremlcompiler)
    2. TFLite  → MODELS_OUTPUT/dl_scan_field_disambig.tflite

Also updates MODELS_OUTPUT/version.json.

Notes:
  - Core ML conversion uses coremltools.convert() with source='tensorflow'.
  - TFLite conversion uses tf.lite.TFLiteConverter.from_keras_model().
  - Both converters are applied to the same loaded Keras model.
  - The TFLite model is dynamically-ranged quantized (float16 weights) by
    default; full int8 is skipped here because the disambig model is small
    and the Neural Engine runs float16 efficiently.  Enable int8 if
    on-device latency benchmarks show it is worth the accuracy trade-off.

Usage:
    python model-training/export/export_disambig.py
    python model-training/export/export_disambig.py --dry-run
    python model-training/export/export_disambig.py --tflite-int8
"""

import argparse
import json
import logging
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import RUNS_ROOT, MODELS_OUTPUT

KERAS_MODEL_PATH = RUNS_ROOT / "disambig" / "best.keras"
COREML_PACKAGE = MODELS_OUTPUT / "DlScanFieldDisambig.mlpackage"
COREML_COMPILED = MODELS_OUTPUT / "DlScanFieldDisambig.mlmodelc"
TFLITE_PATH = MODELS_OUTPUT / "dl_scan_field_disambig.tflite"
VERSION_JSON = MODELS_OUTPUT / "version.json"


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "export_disambig.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


def export_coreml(keras_model: "keras.Model", dry_run: bool, logger: logging.Logger) -> Path | None:
    """Convert Keras disambig model to Core ML."""
    import coremltools as ct

    logger.info("Converting Keras model to Core ML...")

    if dry_run:
        logger.info("[dry-run] Would export to %s", COREML_PACKAGE)
        return COREML_PACKAGE

    MODELS_OUTPUT.mkdir(parents=True, exist_ok=True)

    # coremltools.convert() with source='tensorflow' works for Keras models
    # backed by TensorFlow (tensorflow-macos backend).
    try:
        ct_model = ct.convert(
            keras_model,
            source="tensorflow",
            convert_to="mlprogram",  # Core ML 5+ program format
            inputs=[
                ct.TensorType(name="ocr_input", shape=(1, 24), dtype=int),
                ct.TensorType(name="field_input", shape=(1,), dtype=int),
            ],
        )
    except Exception as e:
        logger.error("Core ML conversion failed: %s", e)
        return None

    if COREML_PACKAGE.exists():
        shutil.rmtree(COREML_PACKAGE)
    ct_model.save(str(COREML_PACKAGE))
    logger.info("Core ML model saved: %s", COREML_PACKAGE)

    # Compile
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
        logger.warning("xcrun coremlcompiler failed (non-fatal):\n%s", result.stderr)
    else:
        logger.info("Compiled: %s", COREML_COMPILED)

    return COREML_PACKAGE


def export_tflite(
    keras_model: "keras.Model",
    use_int8: bool,
    dry_run: bool,
    logger: logging.Logger,
) -> Path | None:
    """Convert Keras disambig model to TFLite."""
    import tensorflow as tf

    logger.info(
        "Converting Keras model to TFLite (%s)...",
        "int8" if use_int8 else "float16 dynamic-range",
    )

    if dry_run:
        logger.info("[dry-run] Would export to %s", TFLITE_PATH)
        return TFLITE_PATH

    MODELS_OUTPUT.mkdir(parents=True, exist_ok=True)

    converter = tf.lite.TFLiteConverter.from_keras_model(keras_model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]

    if use_int8:
        converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
        converter.inference_input_type = tf.int8
        converter.inference_output_type = tf.int8
        # A small representative dataset for full int8 calibration
        from utils.paths import OCR_PAIRS_PATH
        import json as _json
        import numpy as _np

        def representative_data_gen():
            import random
            rng = random.Random(42)
            lines: list[str] = []
            try:
                with open(OCR_PAIRS_PATH) as f:
                    lines = [l for l in f if l.strip()]
            except FileNotFoundError:
                pass
            sample = rng.sample(lines, min(500, len(lines))) if lines else []
            for line in sample:
                try:
                    pair = _json.loads(line)
                except Exception:
                    continue
                ocr = pair.get("ocr_string", "")
                from disambig.train_disambig import encode_string, MAX_FIELD_LEN, FIELD_CLASSES
                field_id_map = {f: i for i, f in enumerate(FIELD_CLASSES)}
                ocr_enc = _np.array([encode_string(ocr, MAX_FIELD_LEN)], dtype=_np.int32)
                field_idx = _np.array([field_id_map.get(pair.get("field_id", ""), 0)], dtype=_np.int32)
                yield [ocr_enc, field_idx]

        converter.representative_dataset = representative_data_gen
    else:
        converter.target_spec.supported_types = [tf.float16]

    try:
        tflite_model = converter.convert()
    except Exception as e:
        logger.error("TFLite conversion failed: %s", e)
        return None

    TFLITE_PATH.write_bytes(tflite_model)
    logger.info("TFLite model saved: %s  (%d bytes)", TFLITE_PATH, len(tflite_model))
    return TFLITE_PATH


def update_version_json(extra: dict) -> None:
    existing: dict = {}
    if VERSION_JSON.exists():
        try:
            existing = json.loads(VERSION_JSON.read_text())
        except json.JSONDecodeError:
            pass
    existing["disambig"] = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "keras_model": str(KERAS_MODEL_PATH),
        "coreml": str(COREML_PACKAGE),
        "tflite": str(TFLITE_PATH),
        **extra,
    }
    VERSION_JSON.parent.mkdir(parents=True, exist_ok=True)
    VERSION_JSON.write_text(json.dumps(existing, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export trained Keras disambig model to Core ML + TFLite."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Print export plan without writing files.")
    parser.add_argument("--tflite-int8", action="store_true",
                        help=(
                            "Use full int8 TFLite quantization (requires OCR pairs for "
                            "calibration). Default: float16 dynamic-range."
                        ))
    parser.add_argument("--model", type=Path, default=KERAS_MODEL_PATH,
                        help=f"Keras model path (default: {KERAS_MODEL_PATH}).")
    args = parser.parse_args()

    log_dir = RUNS_ROOT / "export"
    logger = setup_logging(log_dir)

    keras_model_path = args.model
    if not args.dry_run and not keras_model_path.exists():
        logger.error("Keras model not found: %s\nRun train_disambig.py first.", keras_model_path)
        sys.exit(1)

    try:
        import keras
        import tensorflow as tf
    except ImportError as e:
        logger.error("Import error: %s\nRun: pip install -r requirements.txt", e)
        sys.exit(1)

    if not args.dry_run:
        logger.info("Loading Keras model from %s ...", keras_model_path)
        keras_model = keras.models.load_model(str(keras_model_path))
        keras_model.summary(print_fn=logger.info)
    else:
        keras_model = None
        logger.info("[dry-run] Would load Keras model from %s", keras_model_path)

    coreml_path = export_coreml(keras_model, dry_run=args.dry_run, logger=logger)
    tflite_path = export_tflite(
        keras_model, use_int8=args.tflite_int8, dry_run=args.dry_run, logger=logger
    )

    if not args.dry_run:
        update_version_json({
            "coreml_ok": coreml_path is not None,
            "tflite_ok": tflite_path is not None,
            "tflite_int8": args.tflite_int8,
        })
        logger.info("version.json updated: %s", VERSION_JSON)

    logger.info("Export complete.")
    logger.info("Next step: python model-training/export/validate_quantization.py")


if __name__ == "__main__":
    main()
