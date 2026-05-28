# Architecture Decisions

This file records significant architectural decisions made during the
development of `react-native-dl-scan`. Each entry follows a lightweight ADR
(Architecture Decision Record) format: status, context, decision, alternatives
considered, and consequences. Future decisions should be appended as new ADR
entries.

---

## ADR 001: Drop YOLOv8n-OBB doc detector; use vendor APIs

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
- **Android runtime**: use Google's
  [ML Kit Document Scanner](https://developers.google.com/ml-kit/vision/doc-scanner)
  (`com.google.mlkit.vision.documentscanner`, Play Services-backed,
  ANE-friendly).

**Alternatives considered**:

| Option | Why rejected |
|---|---|
| (a) Train OBB on CPU (`--device cpu`) | ~7–10 days wall time locking up the M3 Ultra. Rejected: too slow to be practical for a one-machine setup. |
| (b) Pay for cloud CUDA H100 (~$30, ~12 hrs) | User committed to local-only training; no cloud compute budget. Rejected. |
| (c) Switch to axis-aligned + rotation augmentation | More implementation work in the Swift/Kotlin consumer wrappers (manual angle recovery); vendor APIs are simpler and better-supported. Rejected. |

**Consequences**:

Positive:
- **Bundle size**: ~2 MB smaller — no `DlScanDocDetector.mlmodelc` or
  `dl_scan_doc_detector.tflite` shipped with the package.
- **Training time**: ~25 hrs total (was ~50 hrs) — one full training job saved.
- **Carbon footprint**: roughly halved (~3 kg CO₂ vs ~5.7 kg CO₂).
- **Accuracy**: both vendor APIs are ANE-accelerated and generally better than
  what a small bundled OBB model would achieve on real-world camera frames.
- **Maintenance**: Apple and Google maintain and improve these APIs
  independently; no retraining required when new document designs appear.
- **No OBB NMS required**: eliminates the Swift/Kotlin rotated NMS
  implementation that would have been needed in the consumer wrappers.

Negative:
- **Runtime accuracy depends on vendor APIs**: we no longer control this layer.
  Accuracy varies by lighting, viewing angle, and document contrast against the
  background (see [LIMITATIONS.md](LIMITATIONS.md)).
- **New Android dependency**: consumer apps must add
  `com.google.android.gms:play-services-mlkit-document-scanner:16.x` to their
  Android Gradle dependencies. Document this in installation instructions.
- **Minimum SDK unchanged**: ML Kit Document Scanner requires
  `minSdkVersion 24`, already set in the project's `build.gradle`.
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
