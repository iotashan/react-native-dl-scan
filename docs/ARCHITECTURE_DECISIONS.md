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
- **Bundle size**: no self-trained `DLScanDocDetector.mlmodelc` or
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

## ADR 002: Replace YOLOv8n field detector with NanoDet-Plus-m; move field inference into JS via react-native-fast-tflite

**Status**: Accepted (2026-05-30)

**Context**:

The field detector (the model that locates individual text fields on a
rectified card crop, distinct from the doc detector of ADR 001) was originally
**YOLOv8n**, trained and exported with [Ultralytics](https://github.com/ultralytics/ultralytics).
Two problems motivated replacing it:

1. **Licensing.** Ultralytics ships under **AGPL-3.0**. The AGPL arguably
   attaches to weights produced by YOLO-derived training/export tooling,
   creating a licensing ambiguity for a library intended to be MIT/Apache-2.0
   and commercially redistributable. We wanted **zero AGPL anywhere in the
   field-detection path**.
2. **Runtime architecture.** The YOLOv8n field detector ran via native
   inference — Core ML (`VNCoreMLRequest`) on iOS and a native TFLite
   `Interpreter` on Android — with each platform owning a copy of the
   detect/decode glue.

**Decision**:

Replace YOLOv8n with **NanoDet-Plus-m** and move field-detector inference into
JS, orchestrated through `react-native-fast-tflite`.

- **Model.** NanoDet-Plus-m: ShuffleNetV2 1.0x backbone + GhostPAN neck +
  GFL/DFL detection head (reg_max=7); strides 8/16/32/64; ~4.2M params; 30
  field classes (same taxonomy as before). Input **416×416** NHWC RGB8 (BGR
  ImageNet mean/std applied in preprocess; was 640×640). Output a single
  anchor-major tensor **`[1, 3598, 62]`** — per anchor, 30 sigmoid class
  scores (sigmoid baked into the cls channels at export) + 4×8 DFL logits.
- **Training.** [RangiLyu/nanodet](https://github.com/RangiLyu/nanodet)
  (Apache-2.0), trained on Apple M3 Ultra via MPS, IDNet in COCO format
  (95,490 train / 12,055 val). Val metrics: mAP@0.5:0.95 = 0.967,
  AP@0.5 = 0.9996, AP@0.75 = 0.994.
- **Export.** PyTorch → LiteRT/TFLite via
  [litert-torch](https://github.com/google-ai-edge/ai-edge-torch) (the
  ai-edge-torch successor). `onnx2tf` was a dead end for this graph; the
  working recipe lives at
  `model-training/nanodet/export_tflite/export_internal.py`. Ships at
  `models/nanodet_field_416.tflite` (4.99 MB, fp32) with `models/version.json`.
  A 3×-smaller dynamic-int8 variant exists
  (`model-training/nanodet/export_tflite/nanodet_field_416_dynint8.tflite`) but
  fp32 is the default; int8 needs on-device accuracy validation before use.
- **Runtime.** JS loads the `.tflite` and calls `runSync` via
  `react-native-fast-tflite`; the native side bridges the shared, tested C++
  preprocess + decode through the `detect_c` C-ABI (exposed on the DLScan
  hybrid object; the new `rectifyFrame` + `ocrExtractFields` Nitro methods
  orchestrate doc-seg → field detection → OCR + extract). This **replaces** the
  former native Core ML (iOS) + native TFLite (Android) field-detector
  inference. Consumers pass the model to
  `useLicenseScanner(mode, { field: require('react-native-dl-scan/models/nanodet_field_416.tflite') })`
  via the `ocrModelSources` param. See
  [docs/superpowers/plans/2026-06-02-jsorch-pipeline-refactor.md](superpowers/plans/2026-06-02-jsorch-pipeline-refactor.md)
  and [MODEL_CONTRACT.md](MODEL_CONTRACT.md) for the full I/O contract.

**Alternatives considered**:

| Option | Why rejected |
|---|---|
| Keep YOLOv8n, accept the AGPL ambiguity | The whole point was a clean, commercially redistributable license. Rejected. |
| Re-license/relicense via an Ultralytics enterprise license | Adds cost + an ongoing dependency for a model we can train ourselves on Apache tooling. Rejected. |
| Keep NanoDet but stay on native (Core ML / native TFLite) inference | Passing fast-tflite's C++-only `TfliteModel` into the native Swift/Kotlin object fails at both the C++ include and Swift-type layers (see `docs/superpowers/plans/2026-05-30-ios-build-findings.md`). JS orchestration sidesteps that and reuses 100% of the C++ core. |
| ONNX Runtime as the runtime | ORT artifacts (42.9 MB iOS / 27 MB Android) exceeded the 12 MB size gate; LiteRT is smaller and already the Android incumbent. |

**Consequences**:

Positive:
- **Licensing clarity.** The architecture, the training code, and the trained
  weights are all Apache-2.0/permissive. No AGPL-licensed dependency remains in
  the field-detection path. (DocAligner — ADR 001 — was already Apache-2.0.)
- **Smaller input + model.** 416×416 (NanoDet-native) is sufficient for region
  localization (OCR reads text separately at full res) and trains ~2.4× faster
  than 640×640. The shipped fp32 model is 4.99 MB.
- **Single inference path + single decode.** One JS-orchestrated path across
  both platforms; the C++ preprocess + decode is shared and unit-tested, rather
  than duplicated in Swift and Kotlin.

Negative / trade-offs:
- **New output contract.** Output is anchor-major `[1, 3598, 62]` with DFL
  regression (vs. YOLO's `[1, 34, 8400]` direct-bbox layout); the decode does
  center-prior + DFL integral + per-class NMS. See [MODEL_CONTRACT.md](MODEL_CONTRACT.md).
- **JS-boundary marshaling.** The rectified RGB buffer crosses to JS once (as an
  ArrayBuffer) and is reused natively for OCR via a token cache.
- **int8 not yet shipped.** The dynamic-int8 variant shows cls-head deviation on
  OOD input and must be validated on-device before it can replace the fp32 default.

**Reversibility**:

The YOLOv8n field-detector scaffolding remains in `model-training/` until
post-parity cleanup. The NanoDet training/export tooling lives under
`model-training/nanodet/` (config `configs/dlscan-nanodet-plus-m_416.yml`,
`train_nanodet.py`, `export_field_detector.sh`, `export_tflite/`).

---
