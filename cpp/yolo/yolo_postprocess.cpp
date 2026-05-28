#include "yolo_postprocess.hpp"

#include <algorithm>
#include <cstddef>

namespace dlscan {
namespace yolo {

float iou(const Detection& a, const Detection& b) {
    // Reject pathological inputs explicitly before any arithmetic — a
    // zero-area or negative-extent box has no meaningful overlap, and
    // dividing by a zero-or-negative union below would either return
    // NaN or feed Soft-NMS-like behavior into a hard NMS path.
    const float area_a = std::max(0.f, a.x2 - a.x1) * std::max(0.f, a.y2 - a.y1);
    const float area_b = std::max(0.f, b.x2 - b.x1) * std::max(0.f, b.y2 - b.y1);
    if (area_a <= 0.f || area_b <= 0.f) return 0.f;

    const float xL = std::max(a.x1, b.x1);
    const float yT = std::max(a.y1, b.y1);
    const float xR = std::min(a.x2, b.x2);
    const float yB = std::min(a.y2, b.y2);
    const float inter_w = std::max(0.f, xR - xL);
    const float inter_h = std::max(0.f, yB - yT);
    const float inter_area = inter_w * inter_h;
    if (inter_area <= 0.f) return 0.f;

    const float u = area_a + area_b - inter_area;
    return u > 0.f ? inter_area / u : 0.f;
}

std::vector<Detection> decode_and_nms(
    const float* tensor,
    std::size_t  num_classes,
    std::size_t  num_anchors,
    const NmsConfig& config) {

    if (tensor == nullptr || num_classes == 0 || num_anchors == 0) {
        return {};
    }

    // Layout-aware indexing — the lambda hides the storage convention so the
    // rest of the algorithm doesn't have to branch.
    const std::size_t row_stride = 4 + num_classes;
    auto at = [&](std::size_t ch, std::size_t a) -> float {
        if (config.layout == TensorLayout::ChannelMajor) {
            return tensor[ch * num_anchors + a];
        }
        // AnchorMajor: each anchor is a contiguous row of (4 + num_classes).
        return tensor[a * row_stride + ch];
    };

    // ----- Phase 1: confidence threshold + decode --------------------------
    // For each anchor, find argmax over class scores. If above conf threshold,
    // keep it as a candidate Detection (with cx,cy,w,h decoded to corners).
    std::vector<Detection> candidates;
    candidates.reserve(num_anchors / 8);  // optimistic; few anchors usually survive

    for (std::size_t a = 0; a < num_anchors; ++a) {
        float best_score = -1.0f;
        int   best_class = -1;
        for (std::size_t c = 0; c < num_classes; ++c) {
            const float s = at(4 + c, a);
            if (s > best_score) {
                best_score = s;
                best_class = static_cast<int>(c);
            }
        }
        if (best_class < 0) continue;
        if (best_score < config.conf_threshold) continue;

        const float cx = at(0, a);
        const float cy = at(1, a);
        const float w  = at(2, a);
        const float h  = at(3, a);

        Detection d;
        d.class_id   = best_class;
        d.confidence = best_score;
        d.x1 = cx - w * 0.5f;
        d.y1 = cy - h * 0.5f;
        d.x2 = cx + w * 0.5f;
        d.y2 = cy + h * 0.5f;
        candidates.push_back(d);
    }

    if (candidates.empty()) return {};

    // ----- Phase 2: per-class greedy NMS -----------------------------------
    // Bucket by class so we only suppress within the same class. Different
    // classes can legitimately produce overlapping boxes (a city/state/zip
    // address line covers same pixels as the parent address bbox).
    std::vector<std::vector<Detection>> by_class(num_classes);
    // Pre-reserve a sane average so the inner pushes don't realloc each frame.
    const std::size_t avg_per_class =
        std::max<std::size_t>(1, candidates.size() / num_classes);
    for (auto& bucket : by_class) bucket.reserve(avg_per_class);
    for (const auto& d : candidates) {
        by_class[static_cast<std::size_t>(d.class_id)].push_back(d);
    }

    std::vector<Detection> kept;
    kept.reserve(std::min<std::size_t>(candidates.size(), config.max_detections));

    for (std::size_t c = 0; c < num_classes; ++c) {
        auto& bucket = by_class[c];
        if (bucket.empty()) continue;
        std::sort(bucket.begin(), bucket.end(),
                  [](const Detection& x, const Detection& y) {
                      return x.confidence > y.confidence;
                  });
        std::vector<bool> suppressed(bucket.size(), false);
        for (std::size_t i = 0; i < bucket.size(); ++i) {
            if (suppressed[i]) continue;
            kept.push_back(bucket[i]);
            for (std::size_t j = i + 1; j < bucket.size(); ++j) {
                if (suppressed[j]) continue;
                if (iou(bucket[i], bucket[j]) > config.iou_threshold) {
                    suppressed[j] = true;
                }
            }
        }
    }

    // ----- Phase 3: global sort + max-detections cap -----------------------
    std::sort(kept.begin(), kept.end(),
              [](const Detection& x, const Detection& y) {
                  return x.confidence > y.confidence;
              });
    if (kept.size() > config.max_detections) {
        kept.resize(config.max_detections);
    }

    return kept;
}

} // namespace yolo
} // namespace dlscan
