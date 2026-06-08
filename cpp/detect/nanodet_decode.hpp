#pragma once
#include <cstddef>
#include <vector>

#include "yolo/yolo_postprocess.hpp"  // reuse dlscan::yolo::Detection + iou

namespace dlscan {
namespace detect {

/// Decode parameters for the NanoDet-Plus field detector.
///
/// The model is exported (NanoDetPlusHead::_forward_onnx) to a single tensor of
/// shape (1, num_anchors, num_classes + 4*(reg_max+1)). For the DL field
/// detector: num_classes=30, reg_max=7 -> channel width 30 + 32 = 62.
///
/// IMPORTANT export contract (verified against the exported ONNX):
///   * The first `num_classes` channels are ALREADY sigmoid-activated
///     probabilities (the head applies .sigmoid() before concat in the onnx
///     path) — do NOT apply sigmoid again here.
///   * The remaining 4*(reg_max+1) channels are RAW DFL distribution logits
///     (left, top, right, bottom), softmaxed + integral-projected here.
struct NanoDetConfig {
    int input_size = 416;                       // square input edge
    std::vector<int> strides = {8, 16, 32, 64}; // NanoDet-Plus-m: 4 FPN levels
    int num_classes = 30;
    int reg_max = 7;                            // -> reg_max+1 = 8 bins per side
    float score_thr = 0.05f;                    // NanoDet multiclass_nms default
    float nms_iou = 0.6f;                        // NanoDet multiclass_nms default
    std::size_t max_det = 100;                   // NanoDet max_num
};

/// A center prior: the (cx, cy) grid-cell center for an anchor and its stride.
/// NanoDet convention (get_single_level_center_priors): cx = col*stride,
/// cy = row*stride (NO +stride/2 offset), row-major per level, levels
/// concatenated in `strides` order.
struct Prior {
    float cx;
    float cy;
    float stride;
};

/// Generate center priors for the given input size + strides, matching
/// NanoDet's get_single_level_center_priors exactly. Total count equals the
/// model's num_anchors. featmap edge per level = ceil(input_size / stride).
std::vector<Prior> generate_center_priors(int input_size,
                                          const std::vector<int>& strides);

/// Decode a NanoDet-Plus raw output tensor into per-field detections.
///
/// `output` points to `num_anchors * (num_classes + 4*(reg_max+1))` floats in
/// the exported (1, A, C) row-major layout, i.e. anchor a, channel c is at
/// output[a * channel_width + c].
///
/// Coordinates are returned in input-image pixel space (the platform layer
/// un-letterboxes / maps back to the rectified card, same as the YOLO path).
/// Returns detections sorted by confidence descending, truncated to max_det.
std::vector<yolo::Detection> nanodet_decode(const float* output,
                                            std::size_t num_anchors,
                                            const NanoDetConfig& config = NanoDetConfig{});

}  // namespace detect
}  // namespace dlscan
