#pragma once
#include <cstddef>
#include <utility>

namespace dlscan {
namespace detect {

/// Abstract inference backend shared by the field detector and the doc-aligner.
///
/// Deliberately runtime-agnostic: a single contiguous float input tensor maps to
/// a single contiguous float output tensor. The shipping implementation
/// (a LiteRT / TFLite interpreter wrapper, in the platform builds where that
/// library links) and the Phase-3 execution-provider variants (XNNPACK / Core
/// ML delegate / NNAPI) are all just different ModelInterpreters — the
/// orchestrators (FieldDetector, DocAligner) never change. Tests substitute a
/// fake that replays a golden tensor, so the orchestration is verifiable on the
/// host with no inference library present.
class ModelInterpreter {
   public:
    virtual ~ModelInterpreter() = default;

    /// Run the model. `input` points to `input_floats` contiguous floats in the
    /// layout the model expects (NCHW for NanoDet, NHWC for DocAligner). Returns
    /// {pointer, float_count} of the raw output tensor. The returned buffer is
    /// owned by the interpreter and valid until the next invoke()/destruction.
    virtual std::pair<const float*, std::size_t> invoke(const float* input,
                                                        std::size_t input_floats) = 0;
};

}  // namespace detect
}  // namespace dlscan
