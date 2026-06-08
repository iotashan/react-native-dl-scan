#include "detect/detect_c.hpp"

#include <algorithm>
#include <cstring>
#include <limits>

#include "detect/doc_aligner.hpp"
#include "detect/nanodet_decode.hpp"
#include "detect/preprocess.hpp"

namespace {

bool has_rgb_capacity(size_t rgb_len, int w, int h) {
    if (w <= 0 || h <= 0) return false;
    const size_t width = static_cast<size_t>(w);
    const size_t height = static_cast<size_t>(h);
    if (width > std::numeric_limits<size_t>::max() / height) return false;
    const size_t pixels = width * height;
    if (pixels > std::numeric_limits<size_t>::max() / 3u) return false;
    return rgb_len >= pixels * 3u;
}

}  // namespace

extern "C" {

size_t dlscan_preprocess_field(const uint8_t* rgb, size_t rgb_len, int w, int h, int size,
                               float* out, size_t out_capacity,
                               float* out_scale_x, float* out_scale_y) {
    if (!rgb || !out || w <= 0 || h <= 0 || size <= 0) return 0;
    if (!has_rgb_capacity(rgb_len, w, h)) return 0;
    const size_t need = static_cast<size_t>(3) * size * size;
    if (out_capacity < need) return 0;
    auto t = dlscan::detect::preprocess(rgb, w, h, size, dlscan::detect::Layout::NHWC);
    if (t.data.size() != need) return 0;
    std::copy(t.data.begin(), t.data.end(), out);
    if (out_scale_x) *out_scale_x = t.scale_x;
    if (out_scale_y) *out_scale_y = t.scale_y;
    return need;
}

size_t dlscan_decode_field(const float* output, size_t out_floats,
                           float scale_x, float scale_y,
                           int* outClassIds, float* outConf,
                           float* outX1, float* outY1, float* outX2, float* outY2,
                           size_t capacity) {
    if (!output || out_floats == 0) return 0;
    dlscan::detect::NanoDetConfig cfg;
    const size_t cw =
        static_cast<size_t>(cfg.num_classes) + 4u * (static_cast<size_t>(cfg.reg_max) + 1u);
    if (cw == 0 || out_floats % cw != 0) return 0;
    const size_t num_anchors = out_floats / cw;

    auto dets = dlscan::detect::nanodet_decode(output, num_anchors, cfg);

    // Map model-input pixel space back to SOURCE pixel space (inverse of the
    // preprocess stretch-resize). Guard degenerate scales.
    if (scale_x > 0.0f) {
        for (auto& d : dets) { d.x1 /= scale_x; d.x2 /= scale_x; }
    }
    if (scale_y > 0.0f) {
        for (auto& d : dets) { d.y1 /= scale_y; d.y2 /= scale_y; }
    }

    const size_t n = dets.size();
    const size_t w = std::min(n, capacity);
    for (size_t i = 0; i < w; ++i) {
        if (outClassIds) outClassIds[i] = dets[i].class_id;
        if (outConf) outConf[i] = dets[i].confidence;
        if (outX1) outX1[i] = dets[i].x1;
        if (outY1) outY1[i] = dets[i].y1;
        if (outX2) outX2[i] = dets[i].x2;
        if (outY2) outY2[i] = dets[i].y2;
    }
    return n;  // real count; caller reallocs + retries if n > capacity
}

size_t dlscan_preprocess_docaligner(const uint8_t* rgb, size_t rgb_len, int w, int h, int size,
                                    float* out, size_t out_capacity) {
    if (!rgb || !out || w <= 0 || h <= 0 || size <= 0) return 0;
    if (!has_rgb_capacity(rgb_len, w, h)) return 0;
    const size_t need = static_cast<size_t>(3) * size * size;
    if (out_capacity < need) return 0;
    auto t = dlscan::detect::preprocess_docaligner(rgb, w, h, size);
    if (t.data.size() != need) return 0;
    std::copy(t.data.begin(), t.data.end(), out);
    return need;
}

int dlscan_decode_corners(const float* heatmap, size_t hm_floats, float* outX, float* outY) {
    if (!heatmap || !outX || !outY) return 0;
    dlscan::detect::DocAlignerConfig cfg;
    const size_t need =
        static_cast<size_t>(cfg.heatmap_h) * cfg.heatmap_w * cfg.num_channels;
    if (hm_floats != need) return 0;
    auto corners = dlscan::detect::decode_corners(heatmap, cfg);
    for (int k = 0; k < 4; ++k) {
        outX[k] = corners[k].x;
        outY[k] = corners[k].y;
    }
    return 1;
}

size_t dlscan_augment_rgb(const uint8_t* rgb, size_t rgb_len, int w, int h,
                          int mode, uint8_t* out, size_t out_capacity) {
    if (!rgb || !out || w <= 0 || h <= 0) return 0;
    if (!has_rgb_capacity(rgb_len, w, h)) return 0;
    if (!has_rgb_capacity(out_capacity, w, h)) return 0;
    const size_t pixels = static_cast<size_t>(w) * static_cast<size_t>(h);
    const size_t n = pixels * 3u;

    if (mode == DLSCAN_AUG_IDENTITY) {
        // Unfiltered passthrough: copy rgb -> out byte for byte. Re-parses the
        // clean retained crop itself, the baseline that recovers vote-dropped
        // fields without the degradation risk of the color/contrast filters.
        std::memcpy(out, rgb, n);
        return n;
    }

    if (mode == DLSCAN_AUG_BLUE_GRAY) {
        // Replicate the blue channel into all three. On blue document stock the
        // dark ink has maximal separation in blue; this is a grayscale built
        // from the highest-contrast channel.
        for (size_t i = 0; i < pixels; ++i) {
            const uint8_t b = rgb[i * 3u + 2u];
            out[i * 3u + 0u] = b;
            out[i * 3u + 1u] = b;
            out[i * 3u + 2u] = b;
        }
        return n;
    }

    if (mode == DLSCAN_AUG_CONTRAST_STRETCH) {
        // Per-channel 2%/98% percentile linear stretch to [0,255]. Each channel
        // is remapped independently so a flat/low-contrast capture gains
        // legibility without a global color cast.
        const size_t loCount = static_cast<size_t>(0.02 * static_cast<double>(pixels));
        const size_t hiCount = static_cast<size_t>(0.98 * static_cast<double>(pixels));
        for (size_t c = 0; c < 3u; ++c) {
            size_t hist[256] = {0};
            for (size_t i = 0; i < pixels; ++i) hist[rgb[i * 3u + c]]++;
            int lo = 0, hi = 255;
            size_t cum = 0;
            for (int v = 0; v < 256; ++v) {
                cum += hist[v];
                if (cum > loCount) { lo = v; break; }
            }
            cum = 0;
            for (int v = 0; v < 256; ++v) {
                cum += hist[v];
                if (cum >= hiCount) { hi = v; break; }
            }
            if (hi <= lo) {  // degenerate (flat channel): pass through
                for (size_t i = 0; i < pixels; ++i) out[i * 3u + c] = rgb[i * 3u + c];
                continue;
            }
            const float scale = 255.0f / static_cast<float>(hi - lo);
            for (size_t i = 0; i < pixels; ++i) {
                float remapped = static_cast<float>(static_cast<int>(rgb[i * 3u + c]) - lo) * scale;
                if (remapped < 0.0f) remapped = 0.0f;
                if (remapped > 255.0f) remapped = 255.0f;
                out[i * 3u + c] = static_cast<uint8_t>(remapped + 0.5f);
            }
        }
        return n;
    }

    return 0;  // unknown mode
}

}  // extern "C"
