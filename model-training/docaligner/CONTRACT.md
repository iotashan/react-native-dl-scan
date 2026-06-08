# DocAligner doc-segmentation I/O contract (empirically verified)

Recovered 2026-05-30 by running the bundled
`android/src/main/assets/docaligner_lcnet100.tflite` (DocsaidLab DocAligner,
lcnet100 backbone, 2.4 MB FP16) through the LiteRT Python runtime and probing
real IDNet card images. This is the ground-truth contract the unified C++
runtime (`cpp/detect/doc_aligner.*`) and the Phase-0 ONNX export must match.

## Tensors

| | shape | layout | dtype | notes |
|---|---|---|---|---|
| input  | `[1, 256, 256, 3]` | NHWC | float32 | RGB, normalized `pixel / 255` -> [0,1] |
| output | `[1, 128, 128, 4]` | NHWC | float32 | one corner heatmap per channel |

## Input normalization — `/255` (confirmed by ablation)

Ran one full-frame IDNet card under three candidate normalizations:

| normalization | result |
|---|---|
| **`/255`** (→[0,1]) | **4 peaks land cleanly at the 4 image corners** ✓ |
| raw (0–255) | high peak magnitudes but peaks NOT at corners (wrong) |
| ImageNet mean/std | peaks scrambled, low magnitude (wrong) |

So the DocAligner preprocess is: resize to 256×256 (bilinear), keep RGB order,
divide by 255. (Contrast the NanoDet field detector, which is BGR + ImageNet-BGR
mean/std + NCHW — see `../nanodet/preprocess_contract.json`.)

## Channel → corner order: TL, TR, BR, BL (clockwise)

On a full-frame card the four channel argmax positions (normalized x,y):

```
ch0 -> (0.02, 0.02)  top-left
ch1 -> (0.97, 0.02)  top-right
ch2 -> (0.95, 0.93)  bottom-right
ch3 -> (0.02, 0.89)  bottom-left
```

## Decode notes

- Peak **magnitudes are small** (~0.02–0.17) even when spatially correct — the
  decode must rely on argmax POSITION, never threshold on magnitude.
- Sub-pixel refinement: local soft-argmax (weighted centroid over a small window
  around the argmax, weights = non-negative heatmap values) improves corner
  precision for the perspective rectification. This is the doc-seg
  "accuracy over speed" lever. Implemented in `decode_corners`
  (`refine_radius`, default 2 → 5×5 window).
- Corners are returned normalized [0,1]; the platform scales to the source frame
  and feeds `setPolyToPoly` / `getPerspectiveTransform`.

## Phase-0 export

When exporting DocAligner → ONNX (Task 0.6), preserve this exact I/O
(256×256×3 NHWC in `/255`, 128×128×4 NHWC out) so the C++ decode and its golden
tests remain valid. If the ONNX exporter emits NCHW, transpose at the graph
boundary or update `DocAlignerConfig`/`decode_corners` indexing accordingly.
