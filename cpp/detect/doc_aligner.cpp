#include "detect/doc_aligner.hpp"

#include <algorithm>
#include <cstddef>
#include <limits>
#include <utility>

#include "detect/preprocess.hpp"  // preprocess_docaligner

namespace dlscan {
namespace detect {

namespace {
inline float at(const float* hm, int r, int c, int k, int w, int channels) {
    return hm[(static_cast<std::size_t>(r) * w + c) * channels + k];
}
}  // namespace

std::array<Corner, 4> decode_corners(const float* hm, const DocAlignerConfig& cfg) {
    const int H = cfg.heatmap_h;
    const int W = cfg.heatmap_w;
    const int C = cfg.num_channels;
    std::array<Corner, 4> corners{};
    const int n = std::min(4, C);

    for (int k = 0; k < n; ++k) {
        // Hard argmax over the full heatmap (first max wins ties, scan order
        // row-major then column-major).
        int rmax = 0, cmax = 0;
        float vmax = -std::numeric_limits<float>::infinity();
        for (int r = 0; r < H; ++r) {
            for (int c = 0; c < W; ++c) {
                const float v = at(hm, r, c, k, W, C);
                if (v > vmax) {
                    vmax = v;
                    rmax = r;
                    cmax = c;
                }
            }
        }

        float fr = static_cast<float>(rmax);
        float fc = static_cast<float>(cmax);

        // Local soft-argmax: weighted centroid over a window about the peak,
        // weighting by non-negative heatmap values. Falls back to the hard
        // peak if the window has no positive mass.
        if (cfg.refine_radius > 0) {
            float sw = 0.0f, swr = 0.0f, swc = 0.0f;
            for (int dr = -cfg.refine_radius; dr <= cfg.refine_radius; ++dr) {
                for (int dc = -cfg.refine_radius; dc <= cfg.refine_radius; ++dc) {
                    const int r = rmax + dr;
                    const int c = cmax + dc;
                    if (r < 0 || r >= H || c < 0 || c >= W) continue;
                    const float v = at(hm, r, c, k, W, C);
                    if (v <= 0.0f) continue;
                    sw += v;
                    swr += v * static_cast<float>(r);
                    swc += v * static_cast<float>(c);
                }
            }
            if (sw > 0.0f) {
                fr = swr / sw;
                fc = swc / sw;
            }
        }

        // Pixel-center normalized coordinate.
        corners[k].x = (fc + 0.5f) / static_cast<float>(W);
        corners[k].y = (fr + 0.5f) / static_cast<float>(H);
    }
    return corners;
}

DocAligner::DocAligner(std::unique_ptr<ModelInterpreter> interpreter, DocAlignerConfig config)
    : interpreter_(std::move(interpreter)), config_(config) {}

std::array<Corner, 4> DocAligner::run(const uint8_t* rgb, int w, int h) {
    // 1. Preprocess to the model's NHWC RGB/255 input (256x256x3).
    InputTensor in = preprocess_docaligner(rgb, w, h, input_size_);

    // 2. Inference (backend-agnostic).
    auto [out, out_floats] = interpreter_->invoke(in.data.data(), in.data.size());
    if (out == nullptr || out_floats == 0) return {};

    // 3. Decode the corner heatmap. Normalized [0,1] corners are stretch-resize
    //    invariant, so they apply directly to the source frame.
    return decode_corners(out, config_);
}

}  // namespace detect
}  // namespace dlscan
