#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>

#include "detect/model_interpreter.hpp"  // dlscan::detect::ModelInterpreter

namespace dlscan {
namespace detect {

/// A rectification corner in normalized [0,1] image coordinates (x = column
/// fraction, y = row fraction). The platform layer scales these to the source
/// camera frame and feeds them to a perspective transform (setPolyToPoly /
/// getPerspectiveTransform) to rectify the card.
struct Corner {
    float x = 0.0f;
    float y = 0.0f;
};

/// DocAligner corner-heatmap decode parameters.
///
/// Contract verified empirically against android/src/main/assets/
/// docaligner_lcnet100.tflite (DocsaidLab DocAligner, lcnet100):
///   * INPUT  : [1, 256, 256, 3] NHWC, RGB, normalized to [0,1] (pixel / 255).
///   * OUTPUT : [1, 128, 128, 4] NHWC — one corner heatmap per channel.
///   * CHANNEL ORDER: 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left
///     (clockwise). Confirmed on a full-frame IDNet card: the four channel
///     peaks land at the four image corners in exactly this order.
///   * Peak MAGNITUDES are small (~0.02-0.17) but the argmax POSITION is
///     accurate — decode must not threshold on magnitude.
struct DocAlignerConfig {
    int heatmap_w = 128;
    int heatmap_h = 128;
    int num_channels = 4;   // NHWC channel count (corner heatmaps)
    int refine_radius = 2;  // local soft-argmax window radius; 0 = hard argmax
};

/// Decode a DocAligner heatmap tensor (NHWC, channel-last: element (r,c,k) is at
/// heatmap[(r*W + c)*C + k]) into the 4 card corners in normalized [0,1] coords,
/// returned in channel order TL, TR, BR, BL.
///
/// Each corner is the per-channel argmax cell, optionally refined to sub-pixel
/// precision by a local soft-argmax: the weighted centroid (weights = the
/// non-negative heatmap values) over a (2*refine_radius+1)^2 window around the
/// argmax. Sub-pixel refinement improves rectification accuracy at negligible
/// cost — the "accuracy over speed" lever for the doc-segmentation stage.
std::array<Corner, 4> decode_corners(const float* heatmap_nhwc,
                                     const DocAlignerConfig& cfg = DocAlignerConfig{});

/// The unified C++ doc-segmentation entry point. Mirrors FieldDetector: owns the
/// (injected) inference backend and orchestrates preprocess -> invoke -> decode.
/// Both platforms hand it a tightly-packed RGB8 camera frame; it returns the 4
/// card corners in normalized [0,1] coords (which are stretch-resize-invariant,
/// so no source mapping is needed — the platform scales them to the frame and
/// rectifies).
class DocAligner {
   public:
    DocAligner(std::unique_ptr<ModelInterpreter> interpreter,
               DocAlignerConfig config = DocAlignerConfig{});

    /// rgb: row-major, 3 bytes/pixel, width w, height h. Returns {} (all-zero
    /// corners) if the interpreter yields no output.
    std::array<Corner, 4> run(const uint8_t* rgb, int w, int h);

    const DocAlignerConfig& config() const { return config_; }

   private:
    std::unique_ptr<ModelInterpreter> interpreter_;
    DocAlignerConfig config_;
    int input_size_ = 256;  // model input edge (verified contract)
};

}  // namespace detect
}  // namespace dlscan
