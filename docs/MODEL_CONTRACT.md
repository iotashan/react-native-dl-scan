# DlScanFieldDetector — Runtime Contract

This document is the source of truth for **what the bundled field-detector
model expects as input and what it produces as output**, on both iOS and
Android. Anyone integrating the model into a new platform layer should read
this before writing inference code.

The model file is shipped in the package:

| Platform | Path inside package | Format | Size |
|---|---|---|---|
| iOS | `Resources/DlScanFieldDetector.mlmodelc/` (inside the `DlScan` resource bundle) | Compiled Core ML | ~4.1 MB |
| Android | `assets/dl_scan_field_detector.tflite` | Full-integer-quantized TFLite | ~3.3 MB |

The trained `.pt` source weights live at
`model-training/runs/field_detector/run_mps_patched/weights/best.pt`
(gitignored under `runs/`); they are not bundled with the npm package.

## Architecture

YOLOv8n (axis-aligned, not OBB), trained on the
[IDNet](https://huggingface.co/datasets/cactuslab/IDNet-2025) synthetic
identity-document dataset. 30 output classes — see
`cpp/yolo/field_classes.cpp` for the canonical class-index ordering.

Both exports were produced from the same `.pt` weights via Ultralytics
`model.export(format=…, nms=False, …)` — meaning **NMS is NOT in the model
graph**. The platform layer is responsible for running NMS on the raw output
tensor; the shared C++ implementation at `cpp/yolo/yolo_postprocess.cpp`
provides `decode_and_nms()` for both platforms.

## Input

| Property | Value |
|---|---|
| Spatial size | **640 × 640** (square) |
| Color space | RGB (NOT BGR) |
| Channel order | NCHW (1, 3, 640, 640) for Core ML; NHWC (1, 640, 640, 3) for TFLite |
| Pixel range | `[0.0, 1.0]` float32 for Core ML; INT8 with model-recorded scale/zero-point for full-int8 TFLite |
| Resize semantics | **Anisotropic scale-fill** (NOT letterbox). The detector was trained on `cv2.warpPerspective(src=IDNet image corners, dst=640×640 square)` — a direct anisotropic stretch from the source aspect to 1:1, no padding. See `model-training/idnet/prepare_yolo_fields.py::rectify_document`. The runtime must do the same: stretch the rectified ID-1-aspect canvas (1280×807) anisotropically to 640×640. iOS uses `VNImageCropAndScaleOption.scaleFill`; Android uses `Bitmap.createScaledBitmap(target, target, true)`. |

The platform layer is responsible for the anisotropic stretch and the
inverse projection on the output side. `decode_and_nms()` returns coordinates
in 640×640 pixel space; the consumer must reverse the per-axis stretch
(`x_out = x_640 / (640/srcW)`, `y_out = y_640 / (640/srcH)`) to map detections
back to the original camera-frame coordinate system. There is NO padding
math to reverse — see `ios/HybridDlScanIOS.swift::runYOLO` and
`android/.../HybridDlScanAndroid.kt::ocrPipelineForEval` for reference.

### Training-vs-runtime aspect drift (task #45 — wontfix)

The training source aspect is `720/450 = 1.6000` (IDNet US California
sample size); the runtime intermediate is ID-1's `1.5858`. The 0.87%
drift composes through both pipelines harmlessly — the YOLO model is
operating well within its training distribution. A compile-time
`static_assert` in `cpp/constants.hpp` pins this drift at < 1%; if
future changes widen the gap the assertion catches it before landing.
Empirical evidence (iter-13 eval, 200 images, 10 states) shows YOLO
detection is not the accuracy bottleneck — OCR is. A "true" fix would
require retraining; not warranted for the current scope.

## Output

Raw output tensor produced by the model (before any NMS):

| Property | Value |
|---|---|
| Logical shape | `(1, 4 + num_classes, num_anchors)` = `(1, 34, 8400)` |
| Dtype | float32 |
| Layout (Core ML) | Channel-major — `tensor[ch * num_anchors + a]` |
| Layout (TFLite) | Channel-major — same as Core ML for this export pipeline |

The 34 channels are:
- Channels **0..3**: bounding box coordinates `(cx, cy, w, h)` in **640×640 pixel space**, already decoded from anchor offsets by the YOLOv8 head
- Channels **4..33**: per-class scores in `[0, 1]`, sigmoid-applied at export time

The 8400 anchors come from three feature pyramid scales:
80×80 (6400) + 40×40 (1600) + 20×20 (400) = 8400. The anchors are interleaved
internally; the platform layer never has to know the breakdown.

If a future TFLite export ever produces anchor-major layout
(`tensor[a * (4 + num_classes) + ch]`), pass
`NmsConfig{ .layout = TensorLayout::AnchorMajor }` to `decode_and_nms()`.

## Confidence semantics

There is **no separate objectness channel** in YOLOv8 axis-aligned. The
maximum class score per anchor is the confidence directly. Defaults:

| Knob | Default | Notes |
|---|---|---|
| `conf_threshold` | 0.25 | Anchors below this are dropped before NMS |
| `iou_threshold` | 0.45 | Class-wise IoU pruning |
| `max_detections` | 100 | Top-K cap by confidence after NMS |

Per-class NMS (not class-agnostic) — different field classes legitimately
produce overlapping bboxes (e.g., a city/state/zip line shares pixels with
its parent address bbox).

## Quantization

| Platform | Method | Validated mAP@0.5 | Validated mAP@0.5:0.95 |
|---|---|---|---|
| Core ML | weight-only int8, asymmetric (`mode=linear`), per-channel, `weight_threshold=65536` (head convs stay FP16) | 0.9950 | 0.9942 |
| TFLite | full-integer int8 (weights + activations), 600-image calibration | 0.9554 | 0.7338 |
| FP32 .pt baseline | n/a | 0.9950 | 0.9950 |

Test split: 12,035 held-out IDNet images, never seen during training.
See `models/version.json` for the full export metadata.

## Platform-layer responsibilities

The shared C++ `decode_and_nms()` handles tensor decode and per-class NMS.
Everything else is platform-specific:

1. **Rectify** the camera frame to ID-1 aspect (`OCR_RECTIFY_W × OCR_RECTIFY_H`
   = 1280×807) using a 4-point perspective transform from DocAligner corners,
   then **anisotropically scale** that buffer to 640×640 (no padding). The
   anisotropic stretch matches the training contract — see the "Resize
   semantics" row in the Input table above.
2. **Run inference**: `VNCoreMLRequest` on iOS, `Interpreter.run` on Android.
3. **Pass the raw output tensor** to `decode_and_nms()`.
4. **Reverse the per-axis stretch** on returned bbox coordinates to land back
   in the rectified-image (1280×807) coordinate system; then apply the
   inverse perspective transform from DocAligner if you need camera-frame
   pixel space.
5. **Vendor OCR** the rectified card image (one call, not per crop).
6. **IoU-match** OCR observations to YOLO bboxes — for each YOLO bbox, the
   OCR observation(s) with highest IoU; concatenate top-to-bottom for the
   multi-line classes `list_5`, `list_8f`, `list_8s`; max-IoU single
   winner for everything else (per Q3 in the Phase 1 design review).
7. **Build a `std::map<std::string, std::string>`** keyed by YOLO class
   name (via `class_name_or_empty`).
8. **Call `extract_fields_structured(map)`** to produce a `LicenseData`.

## Versioning

This contract is tied to the bundled model files. If you re-train the
field detector and bundle a new model, you must:

1. Verify the class-index ordering still matches `cpp/yolo/field_classes.cpp`.
   The class-name table is hard-coded; a re-trained model with a different
   FIELD_CLASSES ordering will silently corrupt every detection.
2. Verify the input size is still 640×640. If you change `imgsz` in
   `train_field_detector_mps_patched.py`, every platform layer's
   anisotropic-stretch code (and `YOLO_INPUT_W/H` in `cpp/constants.hpp`)
   needs updating.
3. Verify the output tensor shape is still `(1, 34, 8400)`. If you change
   the number of classes, update both `cpp/yolo/field_classes.cpp` and
   `kNumClasses` in `cpp/yolo/field_classes.hpp` together.
4. Re-run the parity smoke test (Phase 5) before shipping.

## See also

- `cpp/yolo/yolo_postprocess.hpp` — the C++ API used by both platforms
- `cpp/yolo/field_classes.hpp` — the 30-class index ordering
- `cpp/ocr/ocr_field_extractor.hpp` — the structured-field extractor that
  consumes the platform layer's IoU-matched output
- `model-training/idnet/prepare_yolo_fields.py` — the dataset pipeline that
  defines `FIELD_CLASSES` (the source of truth for class ordering)
- `models/version.json` — measured mAP and quantization parameters per export
- `docs/EVALUATION.md` — full evaluation methodology and held-out test setup
