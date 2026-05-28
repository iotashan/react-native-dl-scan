#pragma once

// Shared compile-time geometry + pipeline constants. Single source of truth
// for cross-platform code paths (C++ extract, iOS Swift via Cxx interop,
// Android JNI). Day-1 architectural invariant per v2 retrospective: the
// card's aspect ratio is THE foundational constraint of this pipeline;
// every rectify path must consume it from here, never hardcode an
// integer pair.

namespace dlscan {

// ISO/IEC 7810 ID-1 card dimensions. Every US driver licence (and most
// Canadian + international IDs) is printed at this size. The aspect ratio
// drives every rectify canvas in the pipeline.
constexpr double ID1_WIDTH_MM  = 85.60;
constexpr double ID1_HEIGHT_MM = 53.98;
constexpr double ID1_ASPECT    = ID1_WIDTH_MM / ID1_HEIGHT_MM;  // ~1.5858

// Rectify-canvas dimensions. Width chosen for OCR glyph density (MLKit /
// VisionKit pick up ~12px AAMVA index digits cleanly at this scale).
// Height is derived from the ID-1 aspect ratio — never hardcode the second
// integer. A 0.1-0.2% drift at integer rounding is acceptable; a
// hardcoded number that drifts from the aspect ratio is not.
constexpr int OCR_RECTIFY_W = 1280;
constexpr int OCR_RECTIFY_H = static_cast<int>(OCR_RECTIFY_W / ID1_ASPECT + 0.5);

// Compile-time invariant guard (per round-2 retrospective): if a
// future tweak to OCR_RECTIFY_W ever changes the rounded height in a way
// that breaks the downstream bbox math, this fires at build time before
// landing.
static_assert(OCR_RECTIFY_H == 807,
              "ID-1 geometry constant mismatch — recompute OCR_RECTIFY_H");

// YOLO field-detector input is square per the model contract
// (see model-training/idnet/prepare_yolo_fields.py).
//
// Task #45 — training-vs-runtime aspect ratio: analysis & disposition.
//
// Training pipeline (one step):
//   IDNet source image (~720×450, native aspect ~1.600:1, the document
//   already fills the frame) → cv2.warpPerspective with src=image
//   corners, dst=640×640 square → anisotropic resample 1.600:1 → 1:1.
//
// Runtime pipeline (two step):
//   Camera frame → DocAligner finds 4 corners → cv2-equivalent perspective
//   transform to OCR_RECTIFY_W × OCR_RECTIFY_H (1280×807, ID-1 aspect
//   1.5858:1) → anisotropic resample 1.5858:1 → 1:1 to produce 640×640
//   model input.
//
// Composed mapping in both pipelines: source corners (whatever quadrilateral)
// → 640×640 destination. The composition `perspective_to_R → anisotropic_to_S`
// is mathematically equivalent to `perspective_to_S` directly: a perspective
// transform followed by an axis-aligned anisotropic scale is itself a
// perspective transform with merged coefficients.
//
// MEASURABLE residual drift:
//   1. Aspect: IDNet 1.6000 vs ID-1 1.5858 = +0.87% horizontal stretch
//      relative to truth. The model trained on slightly-stretched cards
//      and at inference sees slightly-less-stretched cards. Negligible
//      at 640px scale; YOLO detection accuracy on iter-13 PROD eval is
//      not detection-limited (failures are downstream OCR).
//   2. Resampling quality: training does ONE bilinear via warpPerspective;
//      runtime does TWO (perspective → 1280×807, then Vision/Android
//      scaleFill → 640×640). The double-resample adds a small amount of
//      additional blur in the runtime path, which if anything REDUCES
//      texture detail and makes the input slightly easier for the
//      detector — same direction as augmentation, not adversarial.
//
// Disposition: wontfix for US DL scope. A "true" fix would require
// either (a) retraining with a synthetic 1280×807 intermediate stage in
// the dataset prep, or (b) skipping the OCR canvas and rectifying
// directly camera→640×640 (large regression — OCR needs the 1280-wide
// canvas for AAMVA index digit density). Neither is justified by the
// observed accuracy bottleneck (OCR, not detection).
//
// The compile-time guard below pins the aspect drift at < 1%; if a
// future change to OCR_RECTIFY_W ever widens that gap the static_assert
// catches it before landing.
constexpr int YOLO_INPUT_W = 640;
constexpr int YOLO_INPUT_H = 640;

// Training source aspect ratio (IDNet US California samples are 720×450).
// Pinned for the task-#45 drift-tolerance compile-time check.
constexpr double IDNET_TRAINING_ASPECT = 720.0 / 450.0;  // 1.6000

// Aspect drift between training input and runtime intermediate. Must
// stay small enough that the YOLO detector is operating well within
// its training distribution. 1% is a generous bound; current drift is
// (1.6000 - 1.5858) / 1.5858 ≈ 0.87%, well inside.
constexpr double YOLO_ASPECT_DRIFT_FRAC =
    (IDNET_TRAINING_ASPECT - ID1_ASPECT) / ID1_ASPECT;
static_assert(YOLO_ASPECT_DRIFT_FRAC < 0.01 && YOLO_ASPECT_DRIFT_FRAC > -0.01,
              "Task #45: runtime aspect drift from training contract exceeds 1%."
              " Either pin OCR_RECTIFY_W to match IDNET_TRAINING_ASPECT exactly,"
              " or retrain YOLO with the new runtime intermediate aspect.");

}  // namespace dlscan
