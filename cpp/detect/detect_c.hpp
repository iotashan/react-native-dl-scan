#pragma once

// C ABI bridge for the field-detector + doc-aligner pre/post-processing.
// Callable from:
//   - Swift via Cxx interop (Swift speaks the C ABI directly)
//   - Android JNI via a thin extern "C" wrapper (no C++ name mangling)
//
// Architecture: inference runs in the native Nitro layer via
// react-native-fast-tflite (a Nitro HybridObject). The shared C++ core owns
// only the model-specific math — preprocessing (image -> input tensor) and
// decoding (output tensor -> detections / corners). The runtime boundary sits
// BETWEEN preprocess and decode, so they are separate stateless calls:
//
//   1. dlscan_preprocess_* (C++)  -> fill the input float tensor + scale
//   2. [native] fast-tflite model.run(inputBuffer) -> outputBuffer
//   3. dlscan_decode_*    (C++)   -> detections / corners
//
// All functions are stateless and reentrancy-safe (no shared state). Pointer
// args must not be null. Caller owns all buffers. "capacity / returns count"
// follows the dlscan_voter_consensus convention: the real count is returned
// even if it exceeds capacity; only [capacity] entries are written.

#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

// ---- Field detector (NanoDet) ----------------------------------------------

/// Preprocess an RGB8 image (row-major, 3 bytes/pixel, width w, height h) into
/// the NanoDet model input: NHWC, BGR channel order, ImageNet-BGR mean/std
/// normalized, half-pixel bilinear stretch-resize to `size` x `size`.
/// `rgb_len` must be at least w*h*3 bytes.
/// Writes 3*size*size floats to `out` (caller must allocate >= that).
/// `out_scale_x`/`out_scale_y` receive size/w and size/h for the inverse map
/// applied in dlscan_decode_field. Returns floats written, or 0 on error
/// (null args, non-positive dims, short rgb_len, or out_capacity < 3*size*size).
size_t dlscan_preprocess_field(const uint8_t* rgb, size_t rgb_len, int w, int h, int size,
                               float* out, size_t out_capacity,
                               float* out_scale_x, float* out_scale_y);

/// Decode the NanoDet output tensor (anchor-major, shape [num_anchors, 62] =
/// 30 already-sigmoid classes + 4*8 raw DFL logits) into detections, mapped
/// back to SOURCE pixel space via scale_x/scale_y from preprocess.
/// `output` points to `out_floats` contiguous floats. Parallel out-arrays each
/// hold [capacity] entries; the real detection count is returned (write is
/// capped at capacity). Uses default NanoDet thresholds (score 0.05, NMS 0.6,
/// max 100). Returns 0 on error.
size_t dlscan_decode_field(const float* output, size_t out_floats,
                           float scale_x, float scale_y,
                           int* outClassIds, float* outConf,
                           float* outX1, float* outY1, float* outX2, float* outY2,
                           size_t capacity);

// ---- Doc aligner (corner heatmap) ------------------------------------------

/// Preprocess an RGB8 image into the DocAligner model input: NHWC, RGB order,
/// pixel/255 normalized, half-pixel bilinear stretch-resize to `size` x `size`.
/// `rgb_len` must be at least w*h*3 bytes. Writes 3*size*size floats to `out`.
/// Returns floats written, or 0 on error.
size_t dlscan_preprocess_docaligner(const uint8_t* rgb, size_t rgb_len, int w, int h, int size,
                                    float* out, size_t out_capacity);

/// Decode a DocAligner corner heatmap (NHWC, [H, W, 4], channel-last) into the
/// 4 card corners in normalized [0,1] coords, channel order TL, TR, BR, BL.
/// Writes exactly 4 values each to outX/outY. `hm_floats` must equal H*W*4.
/// Returns 1 on success, 0 on error (null args, or hm_floats not 4*H*W for the
/// configured H=W=128).
int dlscan_decode_corners(const float* heatmap, size_t hm_floats,
                          float* outX, float* outY);

// ---- Test-time augmentation (TTA) ------------------------------------------

// Augmentation modes for dlscan_augment_rgb. Used by the scanner's
// verification pass to synthesize extra "frames" from the best captured card
// crop and re-OCR them, recovering glyphs a single OCR pass misses.
#define DLSCAN_AUG_BLUE_GRAY        0  // grayscale from the BLUE channel only
#define DLSCAN_AUG_CONTRAST_STRETCH 1  // per-channel 2%/98% percentile stretch
#define DLSCAN_AUG_IDENTITY         2  // unfiltered copy (parse the clean crop)

/// Produce an augmented copy of an RGB8 image (row-major, 3 bytes/pixel, width
/// w, height h). Stateless; caller owns all buffers.
///   DLSCAN_AUG_BLUE_GRAY: replicate the blue channel into R=G=B. On blue
///     document stock (e.g. the Wisconsin license) dark glyphs have maximal
///     contrast in blue, which recovers small characters (vehicle class) that
///     single-pass OCR drops. Empirically the strongest single augmentation in
///     the offline TTA sweep (rescued vehicleClass on 4/4 failing captures).
///   DLSCAN_AUG_CONTRAST_STRETCH: per-channel 2%/98% percentile linear stretch
///     to [0,255]. A color-agnostic hedge for flat/low-contrast captures.
///   DLSCAN_AUG_IDENTITY: unfiltered passthrough copy (out == rgb, byte for
///     byte). This re-parses the clean retained crop itself; on an
///     already-legible card the color/contrast augmentations can DEGRADE a
///     clean read, so the identity pass is the baseline that recovers fields
///     (e.g. sex) the multi-frame vote dropped without risking degradation.
/// `rgb_len` must be >= w*h*3; `out_capacity` must be >= w*h*3. `mode` is one
/// of DLSCAN_AUG_*. Writes w*h*3 bytes to `out`. Returns bytes written, or 0
/// on error (null args, non-positive dims, short buffers, or unknown mode).
size_t dlscan_augment_rgb(const uint8_t* rgb, size_t rgb_len, int w, int h,
                          int mode, uint8_t* out, size_t out_capacity);

#ifdef __cplusplus
}  // extern "C"
#endif
