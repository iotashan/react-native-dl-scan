#pragma once
#include <cstdint>
#include <vector>

namespace dlscan {
namespace detect {

/// Preprocessed model input + the mapping back to source-image pixels.
///
/// Per the NanoDet field-detector preprocessing contract
/// (model-training/nanodet/preprocess_contract.json):
///   * keep_ratio = false -> STRETCH resize to target x target (no letterbox;
///     the rectified card is already ~square). scale_x/scale_y let the decode
///     map model-space boxes back to source pixels: src_x = model_x / scale_x.
///   * channel order = BGR (NanoDet's cv2-loaded, ImageNet-BGR mean/std).
///   * normalize: (channel - mean) / std, mean/std in BGR order.
///   * layout = NCHW float32, plane order B, G, R.
struct InputTensor {
    std::vector<float> data;  // NCHW: [B-plane, G-plane, R-plane], size 3*t*t
    int size = 0;             // target edge t (square)
    float scale_x = 1.0f;     // t / src_w
    float scale_y = 1.0f;     // t / src_h
};

/// BGR mean/std from the NanoDet config (ImageNet-BGR), exposed for tests.
constexpr float kMeanBGR[3] = {103.53f, 116.28f, 123.675f};
constexpr float kStdBGR[3] = {57.375f, 57.12f, 58.395f};

/// Channel layout of the produced tensor.
///   * NHWC — data[(y*W + x)*3 + c]; the layout LiteRT / TFLite expects
///     (onnx2tf converts NanoDet's NCHW ONNX to NHWC). This is the SHIP path
///     (the field detector runs through react-native-fast-tflite).
///   * NCHW — data[c*W*H + y*W + x]; the ONNX-native layout, kept for parity /
///     ONNX-Runtime checks.
enum class Layout { NHWC, NCHW };

/// Preprocess a tightly-packed RGB8 image (row-major, 3 bytes/pixel) of size
/// src_w x src_h into a `target` x `target` BGR-normalized float tensor in the
/// requested `layout`. Resize is a half-pixel-center bilinear
/// (align_corners = false) — a standard, fully-specified resampler so the C++
/// and Python-golden results match exactly (independent of any cv2 build).
/// Defaults to NHWC, the layout the shipped .tflite expects.
InputTensor preprocess(const uint8_t* rgb, int src_w, int src_h, int target = 416,
                       Layout layout = Layout::NHWC);

/// Preprocess for the DocAligner doc-segmentation model. Per its verified
/// contract (model-training/docaligner/CONTRACT.md): half-pixel bilinear
/// stretch-resize to `target` x `target`, RGB order preserved, normalized
/// pixel/255 -> [0,1], NHWC layout (data[(y*target + x)*3 + c], c: R,G,B).
InputTensor preprocess_docaligner(const uint8_t* rgb, int src_w, int src_h, int target = 256);

}  // namespace detect
}  // namespace dlscan
