#include "detect/preprocess.hpp"

#include <algorithm>
#include <cmath>

namespace dlscan {
namespace detect {

namespace {

// Bilinear sample of one channel at fractional source coords (fx, fy), with
// edge replication (out-of-range neighbors clamp to the border pixel). dx/dy
// are computed from the UN-clamped floor so that fractional positions just
// outside [0, dim) still resolve to the border value, not an interior blend.
inline float sample(const uint8_t* rgb, int w, int h, int c, float fx, float fy) {
    const int x0i = static_cast<int>(std::floor(fx));
    const int y0i = static_cast<int>(std::floor(fy));
    const float dx = fx - static_cast<float>(x0i);
    const float dy = fy - static_cast<float>(y0i);

    const int x0 = std::clamp(x0i, 0, w - 1);
    const int x1 = std::clamp(x0i + 1, 0, w - 1);
    const int y0 = std::clamp(y0i, 0, h - 1);
    const int y1 = std::clamp(y0i + 1, 0, h - 1);

    auto px = [&](int x, int y) -> float {
        return static_cast<float>(rgb[(y * w + x) * 3 + c]);
    };
    const float top = px(x0, y0) * (1.0f - dx) + px(x1, y0) * dx;
    const float bot = px(x0, y1) * (1.0f - dx) + px(x1, y1) * dx;
    return top * (1.0f - dy) + bot * dy;
}

}  // namespace

InputTensor preprocess(const uint8_t* rgb, int src_w, int src_h, int target, Layout layout) {
    InputTensor t;
    t.size = target;
    t.scale_x = static_cast<float>(target) / static_cast<float>(src_w);
    t.scale_y = static_cast<float>(target) / static_cast<float>(src_h);

    const int hw = target * target;
    t.data.resize(static_cast<size_t>(3) * hw);
    const bool nhwc = (layout == Layout::NHWC);

    // Source coords for a half-pixel-center (align_corners = false) resampler:
    // src = (dst + 0.5) * (src_dim / dst_dim) - 0.5.
    const float ratio_x = static_cast<float>(src_w) / static_cast<float>(target);
    const float ratio_y = static_cast<float>(src_h) / static_cast<float>(target);

    for (int ty = 0; ty < target; ++ty) {
        const float fy = (static_cast<float>(ty) + 0.5f) * ratio_y - 0.5f;
        for (int tx = 0; tx < target; ++tx) {
            const float fx = (static_cast<float>(tx) + 0.5f) * ratio_x - 0.5f;
            const float r = sample(rgb, src_w, src_h, 0, fx, fy);
            const float g = sample(rgb, src_w, src_h, 1, fx, fy);
            const float b = sample(rgb, src_w, src_h, 2, fx, fy);
            const int idx = ty * target + tx;
            // BGR channel order, each normalized by its BGR mean/std.
            const float bn = (b - kMeanBGR[0]) / kStdBGR[0];
            const float gn = (g - kMeanBGR[1]) / kStdBGR[1];
            const float rn = (r - kMeanBGR[2]) / kStdBGR[2];
            if (nhwc) {
                t.data[idx * 3 + 0] = bn;
                t.data[idx * 3 + 1] = gn;
                t.data[idx * 3 + 2] = rn;
            } else {
                t.data[0 * hw + idx] = bn;
                t.data[1 * hw + idx] = gn;
                t.data[2 * hw + idx] = rn;
            }
        }
    }
    return t;
}

InputTensor preprocess_docaligner(const uint8_t* rgb, int src_w, int src_h, int target) {
    InputTensor t;
    t.size = target;
    t.scale_x = static_cast<float>(target) / static_cast<float>(src_w);
    t.scale_y = static_cast<float>(target) / static_cast<float>(src_h);
    t.data.resize(static_cast<size_t>(3) * target * target);

    const float ratio_x = static_cast<float>(src_w) / static_cast<float>(target);
    const float ratio_y = static_cast<float>(src_h) / static_cast<float>(target);

    for (int ty = 0; ty < target; ++ty) {
        const float fy = (static_cast<float>(ty) + 0.5f) * ratio_y - 0.5f;
        for (int tx = 0; tx < target; ++tx) {
            const float fx = (static_cast<float>(tx) + 0.5f) * ratio_x - 0.5f;
            const int base = (ty * target + tx) * 3;  // NHWC, channel-last
            t.data[base + 0] = sample(rgb, src_w, src_h, 0, fx, fy) / 255.0f;  // R
            t.data[base + 1] = sample(rgb, src_w, src_h, 1, fx, fy) / 255.0f;  // G
            t.data[base + 2] = sample(rgb, src_w, src_h, 2, fx, fy) / 255.0f;  // B
        }
    }
    return t;
}

}  // namespace detect
}  // namespace dlscan
