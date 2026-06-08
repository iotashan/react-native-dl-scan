#pragma once
#include <cstddef>
#include <cstdint>
#include <memory>
#include <utility>
#include <vector>

#include "detect/model_interpreter.hpp"  // dlscan::detect::ModelInterpreter
#include "detect/nanodet_decode.hpp"
#include "detect/preprocess.hpp"
#include "yolo/yolo_postprocess.hpp"  // dlscan::yolo::Detection

namespace dlscan {
namespace detect {

struct FieldDetectorOptions {
    NanoDetConfig config;  // decode params; config.input_size drives preprocess
};

/// The unified C++ field-detector entry point. Owns the preprocessing, the
/// (injected) inference backend, and the NanoDet decode. Both platforms hand it
/// a tightly-packed RGB8 image of the rectified card; it returns detections in
/// the SOURCE image's pixel space (the model-space boxes are un-stretched here
/// via the preprocess scale factors, so callers need no further mapping).
class FieldDetector {
   public:
    FieldDetector(std::unique_ptr<ModelInterpreter> interpreter,
                  FieldDetectorOptions options);

    /// rgb: row-major, 3 bytes/pixel, width w, height h.
    std::vector<yolo::Detection> run(const uint8_t* rgb, int w, int h);

    const FieldDetectorOptions& options() const { return options_; }

   private:
    std::unique_ptr<ModelInterpreter> interpreter_;
    FieldDetectorOptions options_;
};

}  // namespace detect
}  // namespace dlscan
