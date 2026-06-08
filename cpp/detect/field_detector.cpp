#include "detect/field_detector.hpp"

namespace dlscan {
namespace detect {

FieldDetector::FieldDetector(std::unique_ptr<ModelInterpreter> interpreter,
                             FieldDetectorOptions options)
    : interpreter_(std::move(interpreter)), options_(options) {}

std::vector<yolo::Detection> FieldDetector::run(const uint8_t* rgb, int w, int h) {
    const NanoDetConfig& cfg = options_.config;

    // 1. Preprocess to NCHW BGR-normalized input at the model resolution.
    InputTensor in = preprocess(rgb, w, h, cfg.input_size);

    // 2. Inference (backend-agnostic).
    auto [out, out_floats] = interpreter_->invoke(in.data.data(), in.data.size());
    if (out == nullptr || out_floats == 0) return {};

    // 3. Decode raw (A, channel_width) -> detections in model-input space.
    const std::size_t channel_width =
        static_cast<std::size_t>(cfg.num_classes) + 4u * (static_cast<std::size_t>(cfg.reg_max) + 1u);
    if (channel_width == 0 || out_floats % channel_width != 0) return {};
    const std::size_t num_anchors = out_floats / channel_width;

    std::vector<yolo::Detection> dets = nanodet_decode(out, num_anchors, cfg);

    // 4. Map model-input pixel space back to SOURCE pixel space. preprocess
    //    stretch-resized source -> input by scale_{x,y} = input/source, so the
    //    inverse is a divide. Guard against degenerate scales.
    if (in.scale_x > 0.0f && in.scale_y > 0.0f) {
        for (auto& d : dets) {
            d.x1 /= in.scale_x;
            d.x2 /= in.scale_x;
            d.y1 /= in.scale_y;
            d.y2 /= in.scale_y;
        }
    }
    return dets;
}

}  // namespace detect
}  // namespace dlscan
