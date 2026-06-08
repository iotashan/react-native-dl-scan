#include "detect/nanodet_decode.hpp"

#include <algorithm>
#include <cmath>

namespace dlscan {
namespace detect {

std::vector<Prior> generate_center_priors(int input_size,
                                          const std::vector<int>& strides) {
    std::vector<Prior> priors;
    for (int stride : strides) {
        // featmap edge = ceil(input / stride), matching NanoDet's
        // (math.ceil(input_height / stride), ...).
        const int n = (input_size + stride - 1) / stride;
        priors.reserve(priors.size() + static_cast<std::size_t>(n) * n);
        for (int row = 0; row < n; ++row) {
            for (int col = 0; col < n; ++col) {
                priors.push_back(Prior{static_cast<float>(col * stride),
                                       static_cast<float>(row * stride),
                                       static_cast<float>(stride)});
            }
        }
    }
    return priors;
}

namespace {

// Greedy per-class NMS by descending confidence, using the shared yolo::iou.
// Mirrors NanoDet's multiclass_nms (per-class, iou_threshold).
std::vector<yolo::Detection> greedy_nms(std::vector<yolo::Detection> dets,
                                        float iou_thr) {
    std::sort(dets.begin(), dets.end(),
              [](const yolo::Detection& a, const yolo::Detection& b) {
                  return a.confidence > b.confidence;
              });
    std::vector<yolo::Detection> kept;
    std::vector<bool> removed(dets.size(), false);
    for (std::size_t i = 0; i < dets.size(); ++i) {
        if (removed[i]) continue;
        kept.push_back(dets[i]);
        for (std::size_t j = i + 1; j < dets.size(); ++j) {
            if (removed[j]) continue;
            if (yolo::iou(dets[i], dets[j]) > iou_thr) removed[j] = true;
        }
    }
    return kept;
}

}  // namespace

std::vector<yolo::Detection> nanodet_decode(const float* output,
                                            std::size_t num_anchors,
                                            const NanoDetConfig& config) {
    const int nc = config.num_classes;
    const int nb = config.reg_max + 1;            // DFL bins per side
    const int channel_width = nc + 4 * nb;        // e.g. 30 + 32 = 62

    const std::vector<Prior> priors =
        generate_center_priors(config.input_size, config.strides);
    // The prior count must equal the anchor count the model emitted.
    const std::size_t n = std::min(num_anchors, priors.size());

    // Group surviving (above-threshold) detections per class for per-class NMS.
    std::vector<std::vector<yolo::Detection>> per_class(
        static_cast<std::size_t>(nc));

    for (std::size_t a = 0; a < n; ++a) {
        const float* row = output + a * channel_width;
        const Prior& p = priors[a];

        // --- DFL integral: softmax over each side's nb bins, then E[bin]. ---
        // distance (left, top, right, bottom) in cell units, then * stride.
        float dist[4];
        const float* reg = row + nc;
        for (int side = 0; side < 4; ++side) {
            const float* bins = reg + side * nb;
            float maxv = bins[0];
            for (int k = 1; k < nb; ++k) maxv = std::max(maxv, bins[k]);
            float sum = 0.0f;
            float acc = 0.0f;
            for (int k = 0; k < nb; ++k) {
                const float e = std::exp(bins[k] - maxv);
                sum += e;
                acc += e * static_cast<float>(k);
            }
            dist[side] = (acc / sum) * p.stride;
        }
        // distance2bbox: x1=cx-l, y1=cy-t, x2=cx+r, y2=cy+b.
        const float x1 = p.cx - dist[0];
        const float y1 = p.cy - dist[1];
        const float x2 = p.cx + dist[2];
        const float y2 = p.cy + dist[3];

        // --- classification: scores are ALREADY sigmoid'd in the export. ---
        for (int c = 0; c < nc; ++c) {
            const float score = row[c];
            if (score > config.score_thr) {
                yolo::Detection d;
                d.class_id = c;
                d.confidence = score;
                d.x1 = x1;
                d.y1 = y1;
                d.x2 = x2;
                d.y2 = y2;
                per_class[static_cast<std::size_t>(c)].push_back(d);
            }
        }
    }

    // Per-class NMS, then merge.
    std::vector<yolo::Detection> all;
    for (int c = 0; c < nc; ++c) {
        auto kept = greedy_nms(std::move(per_class[static_cast<std::size_t>(c)]),
                               config.nms_iou);
        all.insert(all.end(), kept.begin(), kept.end());
    }

    // Sort by confidence desc (tie-break class asc to match the Python golden's
    // secondary key); truncate to max_det.
    std::sort(all.begin(), all.end(),
              [](const yolo::Detection& a, const yolo::Detection& b) {
                  if (a.confidence != b.confidence) return a.confidence > b.confidence;
                  return a.class_id < b.class_id;
              });
    if (all.size() > config.max_det) all.resize(config.max_det);
    return all;
}

}  // namespace detect
}  // namespace dlscan
