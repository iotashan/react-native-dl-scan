# DlScanFieldDetector — Runtime Contract

This document is the source of truth for **what the bundled field-detector
model expects as input and what it produces as output**, on both iOS and
Android. Anyone integrating the model into a new platform layer should read
this before writing inference code.

The model file is shipped once and loaded the same way on both platforms:

| Path inside package | Format | Size |
|---|---|---|
| `models/nanodet_field_416.tflite` | LiteRT / TFLite, fp32 | 4.99 MB |

A 3×-smaller dynamic-int8 variant exists
(`model-training/nanodet/export_tflite/nanodet_field_416_dynint8.tflite`,
~1.6 MB) but is **not shipped** — it needs on-device accuracy validation first.

The model is loaded in **JS** via `react-native-fast-tflite` (not native Core ML
or a native TFLite `Interpreter`). The trained `.pth` source weights live at
`model-training/nanodet/workspace/dlscan-nanodet-416/model_best/nanodet_model_best.pth`
(gitignored); they are not bundled with the npm package.

## Architecture

NanoDet-Plus-m — ShuffleNetV2 1.0x backbone + GhostPAN neck + GFL/DFL detection
head (`reg_max=7`), strides 8/16/32/64, ~4.2M params — trained on the
[IDNet](https://huggingface.co/datasets/cactuslab/IDNet-2025) synthetic
identity-document dataset. 30 output classes — see
`cpp/detect/` (field-class ordering) for the canonical class-index ordering.

**NMS is NOT in the model graph.** The raw output is an anchor-major tensor of
per-anchor class scores + DFL regression logits; the shared C++ decode at
`cpp/detect/nanodet_decode.{hpp,cpp}` does center-prior + DFL integral +
per-class NMS. JS loads the `.tflite` and calls `runSync`; the native side
bridges preprocess + decode through the `detect_c` C-ABI (see `src/detector.ts`
`runFieldDetection`).

## Input

| Property | Value |
|---|---|
| Spatial size | **416 × 416** (square) |
| Color space | **BGR** (NanoDet's cv2-loaded, ImageNet-BGR mean/std) |
| Channel order | **NHWC** `(1, 416, 416, 3)` — the layout the shipped `.tflite` expects |
| Pixel range | float32, normalized `(channel − mean) / std` per BGR channel: mean `[103.53, 116.28, 123.675]`, std `[57.375, 57.12, 58.395]` |
| Resize semantics | **Stretch resize** (`keep_ratio = false`, NOT letterbox), half-pixel-center bilinear, anisotropic to 416×416. |

Preprocessing is done in the shared C++ core (`cpp/detect/preprocess.cpp`,
exposed via `dlscan_preprocess_field` in `detect_c`), invoked from JS as
`_hybrid.preprocessFieldInput(rgb, width, height)`. It emits the NHWC BGR
mean/std tensor and records `scale_x = 416/srcW`, `scale_y = 416/srcH`.

On the output side, `decode_field` returns boxes in 416×416 model space; the
inverse-stretch back to SOURCE pixel space is a per-axis divide
(`x_src = x_416 / scale_x`, `y_src = y_416 / scale_y`), applied inside the C++
decode (`cpp/detect/field_detector.cpp`). There is NO padding math to reverse.
`src/detector.ts::runFieldDetection` returns detections already in source pixel
space.

## Output

Raw output tensor produced by the model (before any NMS):

| Property | Value |
|---|---|
| Logical shape | `(1, 3598, 62)` = `(1, num_anchors, num_classes + 4·(reg_max+1))` |
| Dtype | float32 |
| Layout | **Anchor-major** — `tensor[a * 62 + ch]` |

The 62 channels per anchor are:
- Channels **0..29**: per-class scores in `[0, 1]`, **sigmoid baked in at
  export** (the C++ decode reads them as probabilities directly).
- Channels **30..61**: `4 × 8` DFL (Distribution Focal Loss) regression
  **logits** — four box edges (left, top, right, bottom), each an 8-bin
  distribution (`reg_max = 7` → 8 bins). The decode applies softmax + the
  integral (expected value) × stride, then `distance2bbox` against the center
  prior, then per-class NMS.

The 3598 anchors come from four feature-pyramid strides (8/16/32/64) over the
416×416 input: 52² + 26² + 13² + 7² = 2704 + 676 + 169 + 49 = 3598. The C++
decode (`cpp/detect/nanodet_decode.cpp`) reconstructs the center priors; the
platform/JS layer never has to know the breakdown.

## Confidence semantics

There is no separate objectness channel. The (already-sigmoid) per-class score
is the confidence directly. Defaults match NanoDet's `multiclass_nms`
(`cpp/detect/nanodet_decode.hpp::NanoDetConfig`):

| Knob | Default | Notes |
|---|---|---|
| `score_thr` | 0.05 | Anchors below this score are dropped before NMS |
| `nms_iou` | 0.6 | Per-class IoU pruning |
| `max_det` | 100 | Top-K cap by confidence after NMS |

Per-class NMS (not class-agnostic) — different field classes legitimately
produce overlapping bboxes (e.g., a city/state/zip line shares pixels with
its parent address bbox).

## Accuracy

| Variant | mAP@0.5:0.95 | AP@0.5 | AP@0.75 |
|---|---|---|---|
| `nanodet_field_416.tflite` (fp32, shipped) | 0.967 | 0.9996 | 0.994 |

Validation split: 12,055 held-out IDNet images, never seen during training. A
dynamic-int8 variant exists (~1.6 MB) but is not shipped and must be validated
on-device before use. See `models/version.json` for the full export metadata.

## JS-orchestrated pipeline responsibilities

The shared C++ core handles preprocess + decode + per-class NMS. The flow is
JS-orchestrated (worklet) with native bridges:

1. **Rectify** the camera frame natively (`rectifyFrame` — doc-segmentation +
   4-point perspective correct) to an RGB8 buffer; the heavy buffer is cached
   natively under a `token` and marshaled to JS once.
2. **Preprocess** in C++ via `_hybrid.preprocessFieldInput(rgb, w, h)` — stretch
   resize to 416×416, NHWC BGR mean/std (see the Input table).
3. **Run inference** in JS: `model.runSync([input])` via react-native-fast-tflite
   (the `.tflite` is loaded in JS; delegates select ANE/GPU/NNAPI/CPU).
4. **Decode** in C++ via `_hybrid.decodeFieldOutput(output, 416/w, 416/h)` —
   center-prior + DFL integral + per-class NMS, with detections un-stretched
   back to SOURCE pixel space. `src/detector.ts::runFieldDetection` returns these.
5. **OCR + extract** natively via `ocrExtractFields(token, detections)` — fetches
   the cached buffer, runs vendor OCR (VisionKit on iOS, ML Kit on Android),
   IoU-matches OCR observations to detections (top-to-bottom concat for the
   multi-line classes `list_5`, `list_8f`, `list_8s`; max-IoU single winner
   otherwise), keys a `std::map` by class name (via `class_name_or_empty`), and
   calls the C++ structured-field extractor to produce a `LicenseData`.

## Versioning

This contract is tied to the shipped model file. If you re-train the field
detector and bundle a new model, you must:

1. Verify the class-index ordering still matches `cpp/yolo/field_classes.cpp`
   (the class-name table reused by `class_name_or_empty`). A re-trained model
   with a different class ordering will silently corrupt every detection.
2. Verify the input size is still 416×416. If you change `input_size` in
   `configs/dlscan-nanodet-plus-m_416.yml`, update the preprocess target in
   `cpp/detect/preprocess.cpp`, `FIELD_INPUT_SIZE` in `src/detector.ts`, and
   the `strides`/center-prior assumptions in `cpp/detect/nanodet_decode`.
3. Verify the output tensor shape is still `(1, 3598, 62)`. If you change the
   number of classes or `reg_max`, update `NanoDetConfig` in
   `cpp/detect/nanodet_decode.hpp` and the class-name table together.
4. Re-run the C++ decode goldens + parity check before shipping.

## See also

- `cpp/detect/nanodet_decode.hpp` — the NanoDet decode + per-class NMS API
- `cpp/detect/preprocess.hpp` — the shared preprocess (NHWC BGR mean/std)
- `cpp/detect/field_detector.hpp` — preprocess → invoke → decode → source-space map
- `cpp/detect/detect_c.hpp` — the C-ABI bridged to JS (`preprocessFieldInput` /
  `decodeFieldOutput`)
- `src/detector.ts` — JS runtime (`loadFieldModel`, `runFieldDetection`)
- `cpp/yolo/field_classes.hpp` — the 30-class index ordering
- `cpp/ocr/ocr_field_extractor.hpp` — the structured-field extractor
- `model-training/nanodet/export_tflite/export_internal.py` — the litert-torch export
- `models/version.json` — measured mAP and export metadata
- `docs/EVALUATION.md` — full evaluation methodology and held-out test setup
