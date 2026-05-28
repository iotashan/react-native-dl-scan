#pragma once
#include <cstddef>
#include <vector>

namespace dlscan {
namespace yolo {

/// Sentinel value used in default-constructed Detection objects to indicate
/// "no class assigned." Public-facing return values from decode_and_nms()
/// always carry a real class_id in [0, num_classes); this only appears on
/// uninitialized Detection structs created by callers.
constexpr int kInvalidClassId = -1;

/// Layout of the raw model output tensor passed to decode_and_nms.
///
///   ChannelMajor — `tensor[ch * num_anchors + a]`. This is the Ultralytics
///                  YOLOv8 export shape (1, 4 + num_classes, num_anchors)
///                  in row-major storage. Used by both Core ML and TFLite
///                  exports of this model in the current pipeline.
///
///   AnchorMajor  — `tensor[a * (4 + num_classes) + ch]`. Some TFLite export
///                  paths produce this layout (1, num_anchors, 4 + num_classes).
///                  Provided for forward compatibility; not the default.
enum class TensorLayout {
    ChannelMajor,
    AnchorMajor,
};

/// One surviving detection from YOLO post-processing.
/// Coordinates are in pixel-space of the model input image (typically
/// 640x640 letterboxed). The platform layer is responsible for un-letterboxing
/// back to the original image / camera-frame coordinate system.
struct Detection {
    int   class_id   = kInvalidClassId;
    float confidence = 0.0f;
    float x1 = 0.0f;
    float y1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;
};

/// NMS configuration knobs. Defaults match common YOLOv8 inference defaults.
struct NmsConfig {
    /// Anchors with max class score below this are discarded outright.
    float conf_threshold = 0.25f;
    /// Class-wise IoU threshold for greedy NMS suppression.
    float iou_threshold  = 0.45f;
    /// Hard cap on returned detections (top-K by confidence after NMS).
    std::size_t max_detections = 100;
    /// Tensor layout. Default matches Ultralytics YOLOv8 export.
    TensorLayout layout = TensorLayout::ChannelMajor;
};

/// Decode a YOLOv8 raw output tensor and run per-class NMS.
///
/// Input layout — channel-major (matches Ultralytics YOLOv8 export shape
/// (1, 4 + num_classes, num_anchors)):
///
///   tensor[ch * num_anchors + a]
///
/// where channels 0..3 are box coords (cx, cy, w, h) in input-image pixel
/// space and channels 4..(4+num_classes-1) are per-class scores in [0,1]
/// (sigmoid-applied at export time).
///
/// `tensor` must point to at least (4 + num_classes) * num_anchors floats.
/// The platform layer is responsible for ensuring this layout — Core ML's
/// MLMultiArray and TFLite's output buffer both default to this shape from
/// the `nms=False` Ultralytics export path.
///
/// Returns a vector of surviving detections sorted by confidence descending,
/// truncated to config.max_detections.
std::vector<Detection> decode_and_nms(
    const float* tensor,
    std::size_t  num_classes,
    std::size_t  num_anchors,
    const NmsConfig& config = NmsConfig{});

/// Compute Intersection-over-Union of two axis-aligned bboxes.
/// Exposed for testing; also useful for the platform-layer bbox-matching
/// step (matching OCR observations to YOLO field bboxes).
float iou(const Detection& a, const Detection& b);

} // namespace yolo
} // namespace dlscan
