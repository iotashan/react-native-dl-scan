# Architecture Decisions

This file records significant architectural decisions made during the
development of `react-native-dl-scan`. Each entry follows a lightweight ADR
(Architecture Decision Record) format: status, context, decision, alternatives
considered, and consequences. Future decisions should be appended as new ADR
entries.

---

## ADR 001: Drop YOLOv8n-OBB doc detector; use Apple Vision (iOS) + bundled DocAligner (Android)

**Status**: Accepted (2026-05-06)

**Context**:

The original plan was to bundle a trained YOLOv8n-OBB document detector for
runtime corner detection on real-world (non-IDNet) license images. This third
model would:

- Accept a 320×320 camera frame as input.
- Output a 20-class oriented bounding box + 4 corner points.
- Feed its corner predictions into a perspective rectification step before the
  field detector.

Training would happen on an Apple Mac Studio M3 Ultra via PyTorch MPS backend
with Ultralytics 8.4.47. The pipeline included a mandatory "Stage 2" smoke
test (`smoke_test_obb.py`) that compared a 2-epoch MPS-vs-CPU training run on
a 10K image subset before committing to the full 80-epoch OBB training job.

**Smoke test results**:

| Check | Threshold | Result |
|---|---|---|
| Loss check (relative diff MPS vs CPU) | ≤ 5% | **PASS** |
| KL divergence on predicted angle distribution | < 0.10 | **FAIL (> 0.10)** |

Loss converges on MPS, but the predicted rotation (angle) distribution diverges
significantly from the CPU reference. This is the documented MPS-OBB
silent-correctness bug described in:

- Ultralytics issue [#10181](https://github.com/ultralytics/ultralytics/issues/10181)
- Ultralytics issue [#13081](https://github.com/ultralytics/ultralytics/issues/13081)

The bug causes the model to appear to train (loss goes down) while the OBB
angle predictions do not converge correctly. The result would be a model that
detects documents but produces unreliable corner orientations, silently
corrupting the downstream rectification step.

**Decision**:

Drop the YOLOv8n-OBB doc detector training stage entirely.

- **iOS runtime**: use Apple's
  [`VNDetectDocumentSegmentationRequest`](https://developer.apple.com/documentation/vision/vndetectdocumentsegmentationrequest)
  (introduced iOS 15, ANE-accelerated, part of `Vision.framework` which is
  already required by the package).
- **Android runtime**: bundle and run the
  [DocAligner](https://github.com/DocsaidLab/DocAligner) `lcnet100` corner
  detector (Apache-2.0, by DocsaidLab) as an FP16 TFLite model
  (`android/src/main/assets/docaligner_lcnet100.tflite`, ~2.4 MB), loaded at
  runtime via the same TFLite `Interpreter` path as the field detector. It
  is a lightweight heatmap regression model that predicts the document's four
  corners per camera frame, feeding the same perspective-rectification step
  the OBB detector would have. Unlike Google's ML Kit Document Scanner (a
  full-screen Activity, not a per-frame API), this runs inline in the
  frame-processing pipeline with no Play Services dependency.

**Alternatives considered**:

| Option | Why rejected |
|---|---|
| (a) Train OBB on CPU (`--device cpu`) | ~7–10 days wall time locking up the M3 Ultra. Rejected: too slow to be practical for a one-machine setup. |
| (b) Pay for cloud CUDA H100 (~$30, ~12 hrs) | User committed to local-only training; no cloud compute budget. Rejected. |
| (c) Switch to axis-aligned + rotation augmentation | More implementation work in the Swift/Kotlin consumer wrappers (manual angle recovery); vendor APIs are simpler and better-supported. Rejected. |

**Consequences**:

Positive:
- **Bundle size**: no self-trained `DlScanDocDetector.mlmodelc` or
  `dl_scan_doc_detector.tflite` shipped with the package. iOS adds nothing
  (Apple Vision is part of the OS); Android bundles the pre-trained
  DocAligner `lcnet100` TFLite model (~2.4 MB) instead of a much larger
  self-trained OBB model.
- **Training time**: ~25 hrs total (was ~50 hrs) — one full training job saved.
- **Carbon footprint**: roughly halved (~3 kg CO₂ vs ~5.7 kg CO₂).
- **Accuracy**: Apple Vision is ANE-accelerated, and DocAligner `lcnet100` is
  a purpose-built corner detector — both are generally better than what a
  small self-trained OBB model would achieve on real-world camera frames.
- **Maintenance**: Apple maintains its Vision API independently, and
  DocAligner is an established open-source model; no self-retraining required
  when new document designs appear.
- **No OBB NMS required**: eliminates the Swift/Kotlin rotated NMS
  implementation that would have been needed in the consumer wrappers.

Negative:
- **iOS runtime accuracy depends on Apple's Vision API**: we no longer control
  the iOS segmentation layer. Accuracy varies by lighting, viewing angle, and
  document contrast against the background (see [LIMITATIONS.md](LIMITATIONS.md)).
- **Android ships an extra bundled asset**: the DocAligner `lcnet100` TFLite
  model (~2.4 MB) is packaged under `android/src/main/assets/`. No additional
  consumer Gradle dependency is required — it loads via the TFLite runtime the
  field detector already uses.
- **Android third-party model provenance**: the DocAligner weights are
  third-party (DocsaidLab, Apache-2.0); see [DATA_CARD.md](DATA_CARD.md) for
  provenance and license.
- **iOS 15+ minimum unchanged**: `VNDetectDocumentSegmentationRequest` was
  introduced in iOS 15, which is already the package floor.

**Reversibility**:

Easy. The OBB training scaffolding is preserved in `model-training/`:

- `model-training/idnet/prepare_yolo_obb.py` — OBB dataset generator (OBB
  labels already generated; can be used without re-running this script)
- `model-training/smoke_test_obb.py` — MPS smoke test (confirms CUDA is
  required for OBB training on Apple Silicon)
- `model-training/train_doc_detector.py` — 80-epoch YOLOv8n-OBB trainer
- `model-training/export/export_doc_detector.py` — Core ML int8 + TFLite int8
  exporter

To resume OBB training, launch a CUDA cloud instance, install `requirements.txt`
with `tensorflow` (not `tensorflow-macos`), and run `train_doc_detector.py`
with `--device cuda`. The smoke test can be skipped on CUDA.

---
