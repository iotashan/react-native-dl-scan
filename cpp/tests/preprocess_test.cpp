// Tests for the NanoDet field-detector preprocessing (cpp/detect/preprocess).
//
// Expected values are hand-computed literals (not re-derived from the function
// under test) so the test independently pins the contract: BGR channel order,
// per-channel ImageNet-BGR mean/std normalization, NCHW plane layout, and the
// half-pixel-center bilinear resize. See preprocess_contract.json.
#include <array>
#include <cstdint>
#include <initializer_list>
#include <vector>

#include "detect/preprocess.hpp"
#include "gtest/gtest.h"

namespace {

// Pack an interleaved RGB8 image from {R,G,B} triples in row-major order.
std::vector<uint8_t> pack(std::initializer_list<std::array<int, 3>> px) {
    std::vector<uint8_t> v;
    for (const auto& p : px) {
        v.push_back(static_cast<uint8_t>(p[0]));
        v.push_back(static_cast<uint8_t>(p[1]));
        v.push_back(static_cast<uint8_t>(p[2]));
    }
    return v;
}

}  // namespace

// When target == source, each output pixel maps to exactly one source pixel
// (half-pixel sampling lands on integer coords), so there is no interpolation:
// this isolates and pins the BGR-swap + normalize + NCHW-layout contract.
TEST(Preprocess, IdentityNormalizesBGRPlanes) {
    // 2x2, row-major: (0,0)(1,0) / (0,1)(1,1), values as {R,G,B}.
    auto img = pack({{100, 150, 200}, {10, 20, 30}, {40, 50, 60}, {70, 80, 90}});
    auto t = dlscan::detect::preprocess(img.data(), 2, 2, 2, dlscan::detect::Layout::NCHW);

    ASSERT_EQ(t.size, 2);
    ASSERT_EQ(t.data.size(), 3u * 2 * 2);
    EXPECT_FLOAT_EQ(t.scale_x, 1.0f);
    EXPECT_FLOAT_EQ(t.scale_y, 1.0f);

    const int hw = 4;
    // Pixel (ty=0,tx=0) = src(0,0) R=100 G=150 B=200, idx 0.
    EXPECT_NEAR(t.data[0 * hw + 0], (200.f - 103.53f) / 57.375f, 1e-3f);   // B
    EXPECT_NEAR(t.data[1 * hw + 0], (150.f - 116.28f) / 57.12f, 1e-3f);    // G
    EXPECT_NEAR(t.data[2 * hw + 0], (100.f - 123.675f) / 58.395f, 1e-3f);  // R
    // Pixel (ty=1,tx=1) = src(1,1) R=70 G=80 B=90, idx 3.
    EXPECT_NEAR(t.data[0 * hw + 3], (90.f - 103.53f) / 57.375f, 1e-3f);   // B
    EXPECT_NEAR(t.data[1 * hw + 3], (80.f - 116.28f) / 57.12f, 1e-3f);    // G
    EXPECT_NEAR(t.data[2 * hw + 3], (70.f - 123.675f) / 58.395f, 1e-3f);  // R
}

// Upscaling 2x2 -> 4x4 forces fractional sampling. With a pure horizontal R
// gradient (col0 R=0, col1 R=100; G=B=0), the half-pixel map gives interior
// columns tx=1 -> fx=0.25 (R=25) and tx=2 -> fx=0.75 (R=75). This pins the
// bilinear weights and the scale_x/scale_y reporting.
TEST(Preprocess, BilinearUpscaleWeights) {
    auto img = pack({{0, 0, 0}, {100, 0, 0}, {0, 0, 0}, {100, 0, 0}});
    auto t = dlscan::detect::preprocess(img.data(), 2, 2, 4, dlscan::detect::Layout::NCHW);

    ASSERT_EQ(t.size, 4);
    EXPECT_FLOAT_EQ(t.scale_x, 2.0f);
    EXPECT_FLOAT_EQ(t.scale_y, 2.0f);

    const int hw = 16;
    const int rplane = 2 * hw;
    // Row ty=0 (fy clamps to source row 0). tx=1 -> R=25, tx=2 -> R=75.
    EXPECT_NEAR(t.data[rplane + 0 * 4 + 1], (25.f - 123.675f) / 58.395f, 1e-3f);
    EXPECT_NEAR(t.data[rplane + 0 * 4 + 2], (75.f - 123.675f) / 58.395f, 1e-3f);
    // Edge columns replicate: tx=0 -> R=0, tx=3 -> R=100.
    EXPECT_NEAR(t.data[rplane + 0 * 4 + 0], (0.f - 123.675f) / 58.395f, 1e-3f);
    EXPECT_NEAR(t.data[rplane + 0 * 4 + 3], (100.f - 123.675f) / 58.395f, 1e-3f);
    // G/B planes are the normalized zero everywhere.
    EXPECT_NEAR(t.data[0 * hw + 5], (0.f - 103.53f) / 57.375f, 1e-3f);  // B
    EXPECT_NEAR(t.data[1 * hw + 5], (0.f - 116.28f) / 57.12f, 1e-3f);   // G
}

// NHWC (the ship/.tflite path): same BGR normalization as NCHW but interleaved
// per pixel — data[(y*W+x)*3 + c], c: B,G,R. Default layout.
TEST(Preprocess, NHWCInterleavesBGRChannels) {
    auto img = pack({{100, 150, 200}, {10, 20, 30}, {40, 50, 60}, {70, 80, 90}});
    auto t = dlscan::detect::preprocess(img.data(), 2, 2, 2);  // default NHWC

    ASSERT_EQ(t.data.size(), 3u * 2 * 2);
    // pixel (ty=0,tx=0)=src(0,0) R=100 G=150 B=200 at base idx*3 = 0.
    EXPECT_NEAR(t.data[0 + 0], (200.f - 103.53f) / 57.375f, 1e-3f);   // B
    EXPECT_NEAR(t.data[0 + 1], (150.f - 116.28f) / 57.12f, 1e-3f);    // G
    EXPECT_NEAR(t.data[0 + 2], (100.f - 123.675f) / 58.395f, 1e-3f);  // R
    // pixel (ty=1,tx=1)=src(1,1) R=70 G=80 B=90 at base (1*2+1)*3 = 9.
    EXPECT_NEAR(t.data[9 + 0], (90.f - 103.53f) / 57.375f, 1e-3f);  // B
    EXPECT_NEAR(t.data[9 + 1], (80.f - 116.28f) / 57.12f, 1e-3f);   // G
    EXPECT_NEAR(t.data[9 + 2], (70.f - 123.675f) / 58.395f, 1e-3f); // R
}

// DocAligner preprocess: identity (target == src) isolates the NHWC layout,
// RGB channel order, and /255 normalization contract.
TEST(Preprocess, DocAlignerIdentityNHWCRgbDiv255) {
    auto img = pack({{100, 150, 200}, {10, 20, 30}, {40, 50, 60}, {70, 80, 90}});
    auto t = dlscan::detect::preprocess_docaligner(img.data(), 2, 2, 2);

    ASSERT_EQ(t.size, 2);
    ASSERT_EQ(t.data.size(), 3u * 2 * 2);
    // NHWC: pixel (ty=0,tx=0) = src(0,0) R=100 G=150 B=200 at base (0*2+0)*3.
    EXPECT_NEAR(t.data[0 * 3 + 0], 100.f / 255.f, 1e-4f);  // R
    EXPECT_NEAR(t.data[0 * 3 + 1], 150.f / 255.f, 1e-4f);  // G
    EXPECT_NEAR(t.data[0 * 3 + 2], 200.f / 255.f, 1e-4f);  // B
    // pixel (ty=1,tx=1) = src(1,1) R=70 G=80 B=90 at base (1*2+1)*3 = 9.
    EXPECT_NEAR(t.data[9 + 0], 70.f / 255.f, 1e-4f);  // R
    EXPECT_NEAR(t.data[9 + 1], 80.f / 255.f, 1e-4f);  // G
    EXPECT_NEAR(t.data[9 + 2], 90.f / 255.f, 1e-4f);  // B
}
