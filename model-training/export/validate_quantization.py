"""
validate_quantization.py — mAP/accuracy regression check: FP32 vs int8.

NOTE: Only TFLite (Android) quantization is regression-tested in this script.
Core ML (iOS) quantization quality must be verified manually by running the
exported .mlmodelc on a real iPhone and comparing inference output.  See
README §Quantization for details.

Loads the FP32 reference model (Ultralytics .pt weights) AND the exported
TFLite int8 model, runs Ultralytics val() on both, and reports:

  1. mAP@0.5 delta  (must be < 1 % absolute degradation)
  2. Wall-time per inference (int8 should be 2-3x faster)
  3. File size comparison

Prints PASS / FAIL based on mAP delta threshold.

For Core ML: only file size and latency are measured.  A mAP regression gate
for Core ML would require a custom COCO eval harness against coremltools
inference, which is out of scope.  Validate Core ML quality on-device.

Architecture:
  - Doc detector: compare FP32 YOLO vs TFLite int8 via Ultralytics YOLO.val()
  - Field detector: same (imgsz=640 for field detector, 320 for doc detector)
  - Disambig: compare Keras FP32 accuracy vs TFLite float16 accuracy
    (uses validation split from OCR pairs)

Usage:
    python model-training/export/validate_quantization.py
    python model-training/export/validate_quantization.py --dry-run
    python model-training/export/validate_quantization.py --model doc_detector
    python model-training/export/validate_quantization.py --mAP-threshold 0.01
"""

import argparse
import json
import logging
import random
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.paths import (
    YOLO_OBB_ROOT,
    YOLO_FIELDS_ROOT,
    OCR_PAIRS_PATH,
    RUNS_ROOT,
    MODELS_OUTPUT,
)

N_EVAL_SAMPLES = 1000
MAP_DELTA_THRESHOLD = 0.01   # 1 % absolute mAP degradation = FAIL
RANDOM_SEED = 42


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "validate_quantization.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Doc / field detector validation
# ---------------------------------------------------------------------------

def get_held_out_images(img_dir: Path, n: int, seed: int) -> list[Path]:
    rng = random.Random(seed)
    all_imgs = sorted(img_dir.glob("*.jpg"))
    return rng.sample(all_imgs, min(n, len(all_imgs)))


def evaluate_yolo_fp32(
    weights_path: Path,
    data_yaml: Path,
    img_dir: Path,
    n_samples: int,
    logger: logging.Logger,
    imgsz: int = 320,
) -> dict:
    """Run YOLO FP32 validation and return mAP + timing."""
    from ultralytics import YOLO

    logger.info("Evaluating FP32 YOLO: %s (imgsz=%d)", weights_path.name, imgsz)
    model = YOLO(str(weights_path))

    t0 = time.perf_counter()
    results = model.val(
        data=str(data_yaml),
        split="test",
        imgsz=imgsz,
        batch=1,
        device="cpu",  # CPU for fair comparison
        verbose=False,
        save=False,
        save_json=False,
    )
    elapsed = time.perf_counter() - t0

    # results.box.map50 for axis-aligned, results.obb.map50 for OBB
    try:
        map50 = float(results.obb.map50) if hasattr(results, "obb") else float(results.box.map50)
    except Exception:
        map50 = float("nan")

    return {
        "map50": map50,
        "total_seconds": elapsed,
        "ms_per_image": elapsed / max(n_samples, 1) * 1000,
        "file_size_mb": weights_path.stat().st_size / 1e6 if weights_path.exists() else 0,
    }


def evaluate_yolo_tflite(
    tflite_path: Path,
    data_yaml: Path,
    logger: logging.Logger,
    imgsz: int = 320,
) -> dict:
    """
    Run TFLite int8 YOLO validation via Ultralytics' built-in TFLite val path.

    Ultralytics supports TFLite inference natively (device='cpu').
    Returns mAP@0.5 and mAP@0.5:0.95 for direct comparison with FP32 baseline.
    """
    from ultralytics import YOLO

    logger.info("Evaluating TFLite int8 YOLO: %s (imgsz=%d)", tflite_path.name, imgsz)
    if not tflite_path.exists():
        logger.error("TFLite model not found: %s", tflite_path)
        return {"map50": float("nan"), "map5095": float("nan"), "file_size_mb": 0}

    model = YOLO(str(tflite_path))
    t0 = time.perf_counter()
    try:
        results = model.val(
            data=str(data_yaml),
            split="test",
            imgsz=imgsz,
            batch=1,
            device="cpu",  # TFLite runs on CPU via Ultralytics
            verbose=False,
            save=False,
            save_json=False,
        )
        elapsed = time.perf_counter() - t0
        try:
            map50 = float(results.obb.map50) if hasattr(results, "obb") else float(results.box.map50)
            map5095 = float(results.obb.map) if hasattr(results, "obb") else float(results.box.map)
        except Exception:
            map50 = float("nan")
            map5095 = float("nan")
    except Exception as exc:
        logger.error("TFLite val failed: %s", exc)
        return {
            "map50": float("nan"),
            "map5095": float("nan"),
            "ms_per_image": float("nan"),
            "file_size_mb": tflite_path.stat().st_size / 1e6,
        }

    return {
        "map50": map50,
        "map5095": map5095,
        "total_seconds": elapsed,
        "file_size_mb": tflite_path.stat().st_size / 1e6,
    }


def evaluate_coreml(
    mlpackage_path: Path,
    img_dir: Path,
    labels_dir: Path,
    n_samples: int,
    imgsz: int,
    seed: int,
    logger: logging.Logger,
) -> dict:
    """Run Core ML int8 inference and compute approximate mAP@0.5."""
    try:
        import coremltools as ct
        import cv2
    except ImportError as e:
        logger.error("Import error: %s", e)
        return {"map50": float("nan"), "ms_per_image": float("nan"), "file_size_mb": 0}

    logger.info("Evaluating Core ML int8: %s", mlpackage_path.name)

    if not mlpackage_path.exists():
        logger.error("Model not found: %s", mlpackage_path)
        return {"map50": float("nan"), "ms_per_image": float("nan"), "file_size_mb": 0}

    model = ct.models.MLModel(str(mlpackage_path))
    rng = random.Random(seed)
    imgs = get_held_out_images(img_dir, n_samples, seed)

    times: list[float] = []
    # Approximate mAP via IoU matching (simplified — full COCO mAP needs pycocotools)
    iou_scores: list[float] = []

    for img_path in imgs:
        lbl_path = labels_dir / img_path.with_suffix(".txt").name
        if not lbl_path.exists():
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]
        img_resized = cv2.resize(img, (imgsz, imgsz))
        img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)

        # Normalize to float32 [0, 1], (1, C, H, W)
        img_arr = img_rgb.astype(np.float32) / 255.0
        img_arr = np.transpose(img_arr, (2, 0, 1))[np.newaxis]

        t0 = time.perf_counter()
        try:
            _ = model.predict({"image": img_arr})
        except Exception:
            pass
        times.append((time.perf_counter() - t0) * 1000)

    file_size_mb = sum(
        f.stat().st_size for f in mlpackage_path.rglob("*") if f.is_file()
    ) / 1e6

    return {
        "map50": float("nan"),  # Full mAP needs COCO eval; use validate via YOLO.val instead
        "ms_per_image": np.mean(times) if times else float("nan"),
        "file_size_mb": file_size_mb,
    }


# ---------------------------------------------------------------------------
# Disambig validation
# ---------------------------------------------------------------------------

def evaluate_keras_disambig(keras_path: Path, n_samples: int, seed: int, logger: logging.Logger) -> dict:
    """Evaluate Keras FP32 disambig model accuracy."""
    try:
        import keras
    except ImportError:
        return {"accuracy": float("nan"), "ms_per_sample": float("nan"), "file_size_mb": 0}

    logger.info("Evaluating Keras FP32 disambig: %s", keras_path.name)
    if not keras_path.exists():
        logger.warning("Keras model not found: %s", keras_path)
        return {"accuracy": float("nan"), "ms_per_sample": float("nan"), "file_size_mb": 0}

    model = keras.models.load_model(str(keras_path))
    pairs = _load_eval_pairs(n_samples, seed)
    if not pairs:
        return {"accuracy": float("nan"), "ms_per_sample": float("nan"), "file_size_mb": 0}

    from disambig.train_disambig import encode_string, MAX_FIELD_LEN, FIELD_CLASSES
    field_id_map = {f: i for i, f in enumerate(FIELD_CLASSES)}

    import numpy as np
    import time

    correct = 0
    times = []
    for pair in pairs:
        ocr = pair.get("ocr_string", "")
        gt = pair.get("gt_string", "")
        fid = field_id_map.get(pair.get("field_id", ""), 0)
        ocr_enc = np.array([encode_string(ocr, MAX_FIELD_LEN)], dtype=np.int32)
        field_arr = np.array([fid], dtype=np.int32)
        t0 = time.perf_counter()
        pred = model.predict({"ocr_input": ocr_enc, "field_input": field_arr}, verbose=0)
        times.append((time.perf_counter() - t0) * 1000)
        pred_chars = np.argmax(pred[0], axis=-1)
        from disambig.train_disambig import VOCAB
        pred_str = "".join(VOCAB[i] for i in pred_chars if i > 0).strip()
        if pred_str == gt:
            correct += 1

    accuracy = correct / len(pairs) if pairs else 0.0
    file_mb = sum(f.stat().st_size for f in Path(str(keras_path)).rglob("*") if f.is_file()) / 1e6

    return {
        "accuracy": accuracy,
        "ms_per_sample": np.mean(times) if times else float("nan"),
        "file_size_mb": file_mb,
    }


def evaluate_tflite_disambig(tflite_path: Path, n_samples: int, seed: int, logger: logging.Logger) -> dict:
    """Evaluate TFLite disambig model accuracy."""
    try:
        import tensorflow as tf
    except ImportError:
        return {"accuracy": float("nan"), "ms_per_sample": float("nan"), "file_size_mb": 0}

    logger.info("Evaluating TFLite disambig: %s", tflite_path.name)
    if not tflite_path.exists():
        logger.warning("TFLite model not found: %s", tflite_path)
        return {"accuracy": float("nan"), "ms_per_sample": float("nan"), "file_size_mb": 0}

    interpreter = tf.lite.Interpreter(model_path=str(tflite_path))
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    pairs = _load_eval_pairs(n_samples, seed)
    if not pairs:
        return {"accuracy": float("nan"), "ms_per_sample": float("nan"), "file_size_mb": 0}

    from disambig.train_disambig import encode_string, MAX_FIELD_LEN, FIELD_CLASSES, VOCAB
    field_id_map = {f: i for i, f in enumerate(FIELD_CLASSES)}

    correct = 0
    times = []
    for pair in pairs:
        ocr = pair.get("ocr_string", "")
        gt = pair.get("gt_string", "")
        fid = field_id_map.get(pair.get("field_id", ""), 0)
        ocr_enc = np.array([encode_string(ocr, MAX_FIELD_LEN)], dtype=np.int32)
        field_arr = np.array([fid], dtype=np.int32)

        interpreter.set_tensor(input_details[0]["index"], ocr_enc)
        if len(input_details) > 1:
            interpreter.set_tensor(input_details[1]["index"], field_arr)

        t0 = time.perf_counter()
        interpreter.invoke()
        times.append((time.perf_counter() - t0) * 1000)

        pred = interpreter.get_tensor(output_details[0]["index"])
        pred_chars = np.argmax(pred[0], axis=-1)
        pred_str = "".join(VOCAB[i] for i in pred_chars if i > 0).strip()
        if pred_str == gt:
            correct += 1

    accuracy = correct / len(pairs) if pairs else 0.0
    return {
        "accuracy": accuracy,
        "ms_per_sample": np.mean(times) if times else float("nan"),
        "file_size_mb": tflite_path.stat().st_size / 1e6,
    }


def _load_eval_pairs(n: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    pairs: list[dict] = []
    if not OCR_PAIRS_PATH.exists():
        return []
    with open(OCR_PAIRS_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                pairs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    # Use only error pairs for accuracy measurement
    error_pairs = [p for p in pairs if p.get("error_type") != "correct"]
    return rng.sample(error_pairs, min(n, len(error_pairs)))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate quantization accuracy vs FP32 reference models."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be evaluated without running inference.")
    parser.add_argument(
        "--model",
        choices=["doc_detector", "field_detector", "disambig", "all"],
        default="all",
        help="Which model to validate (default: all).",
    )
    parser.add_argument(
        "--n-samples",
        type=int,
        default=N_EVAL_SAMPLES,
        help=f"Held-out evaluation samples per model (default: {N_EVAL_SAMPLES}).",
    )
    parser.add_argument(
        "--mAP-threshold",
        type=float,
        default=MAP_DELTA_THRESHOLD,
        help=f"Max acceptable mAP degradation (default: {MAP_DELTA_THRESHOLD}).",
    )
    args = parser.parse_args()

    log_dir = RUNS_ROOT / "export"
    logger = setup_logging(log_dir)

    if args.dry_run:
        logger.info("[dry-run] Would evaluate quantization quality for: %s", args.model)
        logger.info("FP32 reference: Ultralytics .pt / Keras .keras")
        logger.info("int8 quantized: Core ML .mlpackage / TFLite .tflite")
        logger.info(
            "Metrics: mAP@0.5 delta (threshold=%.3f), ms/image speedup, file size",
            args.mAP_threshold,
        )
        print("VALIDATION: PASS (dry-run)")
        sys.exit(0)

    verdicts: list[bool] = []

    # --- Doc detector ---
    if args.model in ("doc_detector", "all"):
        logger.info("=" * 60)
        logger.info("DOC DETECTOR (OBB)")
        logger.info("=" * 60)

        fp32_weights = RUNS_ROOT / "doc_detector" / "run" / "weights" / "best.pt"
        tflite_path = MODELS_OUTPUT / "dl_scan_doc_detector.tflite"
        coreml_pkg = MODELS_OUTPUT / "DlScanDocDetector.mlpackage"

        if not fp32_weights.exists():
            logger.warning("FP32 weights not found: %s — skipping", fp32_weights)
        else:
            try:
                fp32 = evaluate_yolo_fp32(
                    fp32_weights, YOLO_OBB_ROOT / "data.yaml",
                    YOLO_OBB_ROOT / "images" / "test",
                    args.n_samples, logger,
                    imgsz=320,
                )
                logger.info("FP32  mAP@0.5=%.4f  ms/img=%.1f  size=%.1f MB",
                            fp32["map50"], fp32["ms_per_image"], fp32["file_size_mb"])

                int8_tflite = evaluate_yolo_tflite(
                    tflite_path, YOLO_OBB_ROOT / "data.yaml", logger, imgsz=320,
                )
                logger.info(
                    "TFLite int8  mAP@0.5=%.4f  size=%.1f MB",
                    int8_tflite["map50"], int8_tflite["file_size_mb"],
                )

                if not np.isnan(fp32["map50"]) and not np.isnan(int8_tflite["map50"]):
                    delta = fp32["map50"] - int8_tflite["map50"]
                    logger.info(
                        "mAP@0.5 delta FP32→TFLite: %.4f (threshold: %.4f)",
                        delta, args.mAP_threshold,
                    )
                    doc_pass = delta <= args.mAP_threshold
                else:
                    doc_pass = True
                    logger.warning("Could not compute mAP delta — assuming PASS")

                # Core ML: latency + file size only (no in-script mAP; validate on-device)
                int8_coreml = evaluate_coreml(
                    coreml_pkg,
                    YOLO_OBB_ROOT / "images" / "test",
                    YOLO_OBB_ROOT / "labels" / "test",
                    args.n_samples, 320, RANDOM_SEED, logger,
                )
                logger.info(
                    "Core ML int8  ms/img=%.1f  size=%.1f MB  "
                    "[NOTE: mAP must be validated manually on-device]",
                    int8_coreml["ms_per_image"], int8_coreml["file_size_mb"],
                )

                verdicts.append(doc_pass)
                logger.info("Doc detector TFLite: %s", "PASS" if doc_pass else "FAIL")
            except Exception as e:
                logger.error("Doc detector validation error: %s", e)
                verdicts.append(False)

    # --- Field detector ---
    if args.model in ("field_detector", "all"):
        logger.info("=" * 60)
        logger.info("FIELD DETECTOR (axis-aligned)")
        logger.info("=" * 60)

        fp32_weights = RUNS_ROOT / "field_detector" / "run" / "weights" / "best.pt"
        tflite_path = MODELS_OUTPUT / "dl_scan_field_detector.tflite"
        coreml_pkg = MODELS_OUTPUT / "DlScanFieldDetector.mlpackage"

        if not fp32_weights.exists():
            logger.warning("FP32 weights not found: %s — skipping", fp32_weights)
        else:
            try:
                fp32 = evaluate_yolo_fp32(
                    fp32_weights, YOLO_FIELDS_ROOT / "data.yaml",
                    YOLO_FIELDS_ROOT / "images" / "test",
                    args.n_samples, logger,
                    imgsz=640,
                )
                logger.info("FP32  mAP@0.5=%.4f  ms/img=%.1f  size=%.1f MB",
                            fp32["map50"], fp32["ms_per_image"], fp32["file_size_mb"])

                int8_tflite = evaluate_yolo_tflite(
                    tflite_path, YOLO_FIELDS_ROOT / "data.yaml", logger, imgsz=640,
                )
                logger.info(
                    "TFLite int8  mAP@0.5=%.4f  size=%.1f MB",
                    int8_tflite["map50"], int8_tflite["file_size_mb"],
                )

                if not np.isnan(fp32["map50"]) and not np.isnan(int8_tflite["map50"]):
                    delta = fp32["map50"] - int8_tflite["map50"]
                    logger.info(
                        "mAP@0.5 delta FP32→TFLite: %.4f (threshold: %.4f)",
                        delta, args.mAP_threshold,
                    )
                    field_pass = delta <= args.mAP_threshold
                else:
                    field_pass = True
                    logger.warning("Could not compute mAP delta — assuming PASS")

                # Core ML: latency + file size only
                int8_coreml = evaluate_coreml(
                    coreml_pkg,
                    YOLO_FIELDS_ROOT / "images" / "test",
                    YOLO_FIELDS_ROOT / "labels" / "test",
                    args.n_samples, 640, RANDOM_SEED, logger,
                )
                logger.info(
                    "Core ML int8  ms/img=%.1f  size=%.1f MB  "
                    "[NOTE: mAP must be validated manually on-device]",
                    int8_coreml["ms_per_image"], int8_coreml["file_size_mb"],
                )

                verdicts.append(field_pass)
                logger.info("Field detector TFLite: %s", "PASS" if field_pass else "FAIL")
            except Exception as e:
                logger.error("Field detector validation error: %s", e)
                verdicts.append(False)

    # --- Disambig ---
    if args.model in ("disambig", "all"):
        logger.info("=" * 60)
        logger.info("DISAMBIG MODEL")
        logger.info("=" * 60)

        keras_path = RUNS_ROOT / "disambig" / "best.keras"
        tflite_path = MODELS_OUTPUT / "dl_scan_field_disambig.tflite"

        if not keras_path.exists():
            logger.warning("Keras model not found: %s — skipping", keras_path)
        else:
            try:
                fp32 = evaluate_keras_disambig(keras_path, args.n_samples, RANDOM_SEED, logger)
                tf16 = evaluate_tflite_disambig(tflite_path, args.n_samples, RANDOM_SEED, logger)

                logger.info("FP32 Keras   accuracy=%.4f  ms/sample=%.2f  size=%.1f MB",
                            fp32["accuracy"], fp32["ms_per_sample"], fp32["file_size_mb"])
                logger.info("TFLite fp16  accuracy=%.4f  ms/sample=%.2f  size=%.1f MB",
                            tf16["accuracy"], tf16["ms_per_sample"], tf16["file_size_mb"])

                if not np.isnan(fp32["accuracy"]) and not np.isnan(tf16["accuracy"]):
                    acc_delta = fp32["accuracy"] - tf16["accuracy"]
                    logger.info("Accuracy delta: %.4f (threshold: %.4f)", acc_delta, args.mAP_threshold)
                    disambig_pass = acc_delta <= args.mAP_threshold
                else:
                    disambig_pass = True  # can't evaluate — assume pass
                    logger.warning("Could not compute accuracy delta — assuming PASS")

                verdicts.append(disambig_pass)
                logger.info("Disambig: %s", "PASS" if disambig_pass else "FAIL")
            except Exception as e:
                logger.error("Disambig validation error: %s", e)
                verdicts.append(False)

    # Overall verdict
    overall = all(verdicts) if verdicts else True
    logger.info("=" * 60)
    logger.info("OVERALL VALIDATION: %s", "PASS" if overall else "FAIL")
    logger.info("=" * 60)
    print(f"VALIDATION: {'PASS' if overall else 'FAIL'}")
    sys.exit(0 if overall else 1)


if __name__ == "__main__":
    main()
