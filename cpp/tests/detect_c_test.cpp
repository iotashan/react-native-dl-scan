// Tests for the C-ABI detector bridge (cpp/detect/detect_c). Verifies the
// extern "C" surface the native Nitro layer calls: preprocess fills the input
// tensor + scale, decode parses the output tensor (reusing the planted NanoDet
// golden), corner decode maps a heatmap, and the capacity/count contract holds.
#include <array>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "detect/detect_c.hpp"
#include "gtest/gtest.h"

namespace {

std::string fixture(const std::string& n) { return std::string(NANODET_FIXTURE_DIR) + "/" + n; }

std::vector<float> read_floats(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    EXPECT_TRUE(f.good()) << "missing fixture: " << path;
    std::vector<float> v;
    float x;
    while (f.read(reinterpret_cast<char*>(&x), sizeof(float))) v.push_back(x);
    return v;
}

struct ExpDet {
    int cls;
    float score, x1, y1, x2, y2;
};

std::vector<ExpDet> read_expected(const std::string& path) {
    std::ifstream f(path);
    EXPECT_TRUE(f.good()) << "missing fixture: " << path;
    std::vector<ExpDet> out;
    std::string line;
    while (std::getline(f, line)) {
        if (line.empty()) continue;
        std::istringstream ss(line);
        ExpDet d;
        ss >> d.cls >> d.score >> d.x1 >> d.y1 >> d.x2 >> d.y2;
        out.push_back(d);
    }
    return out;
}

}  // namespace

// preprocess_field: identity 2x2 -> 12 floats, NHWC BGR-normalized, scale 1.
TEST(DetectC, PreprocessFieldFillsTensorAndScale) {
    // 2x2 RGB, pixel (0,0) = R100 G150 B200.
    std::vector<uint8_t> img = {100, 150, 200, 10, 20, 30, 40, 50, 60, 70, 80, 90};
    std::vector<float> out(3 * 2 * 2, -999.0f);
    float sx = 0, sy = 0;
    size_t n = dlscan_preprocess_field(img.data(), img.size(), 2, 2, 2, out.data(), out.size(), &sx, &sy);
    EXPECT_EQ(n, 12u);
    EXPECT_FLOAT_EQ(sx, 1.0f);
    EXPECT_FLOAT_EQ(sy, 1.0f);
    // NHWC: pixel 0 base 0, channels B,G,R normalized.
    EXPECT_NEAR(out[0], (200.f - 103.53f) / 57.375f, 1e-3f);
    EXPECT_NEAR(out[1], (150.f - 116.28f) / 57.12f, 1e-3f);
    EXPECT_NEAR(out[2], (100.f - 123.675f) / 58.395f, 1e-3f);
}

// preprocess_field rejects too-small output buffers (no overflow).
TEST(DetectC, PreprocessFieldRejectsSmallBuffer) {
    std::vector<uint8_t> img(2 * 2 * 3, 0);
    std::vector<float> out(5, 0.0f);  // < 12
    EXPECT_EQ(dlscan_preprocess_field(img.data(), img.size(), 2, 2, 2, out.data(), out.size(), nullptr, nullptr), 0u);
    EXPECT_EQ(dlscan_preprocess_field(nullptr, 0, 2, 2, 2, out.data(), 12, nullptr, nullptr), 0u);
}

// preprocess_field rejects RGB inputs shorter than width*height*3 before sampling.
TEST(DetectC, PreprocessFieldRejectsShortRgbInput) {
    std::vector<uint8_t> img(2 * 2 * 3, 0);
    std::vector<float> out(3 * 2 * 2, 0.0f);
    EXPECT_EQ(dlscan_preprocess_field(img.data(), img.size() - 1, 2, 2, 2,
                                      out.data(), out.size(), nullptr, nullptr), 0u);
}

// preprocess_docaligner rejects RGB inputs shorter than width*height*3 before sampling.
TEST(DetectC, PreprocessDocAlignerRejectsShortRgbInput) {
    std::vector<uint8_t> img(2 * 2 * 3, 0);
    std::vector<float> out(3 * 2 * 2, 0.0f);
    EXPECT_EQ(dlscan_preprocess_docaligner(img.data(), img.size() - 1, 2, 2, 2,
                                           out.data(), out.size()), 0u);
}

// decode_field on the planted golden (scale 1) matches the decode golden.
TEST(DetectC, DecodeFieldMatchesGolden) {
    auto raw = read_floats(fixture("raw_0.bin"));
    auto exp = read_expected(fixture("expected_0.txt"));
    const size_t cap = 64;
    std::vector<int> cls(cap);
    std::vector<float> conf(cap), x1(cap), y1(cap), x2(cap), y2(cap);
    size_t n = dlscan_decode_field(raw.data(), raw.size(), 1.0f, 1.0f, cls.data(), conf.data(),
                                   x1.data(), y1.data(), x2.data(), y2.data(), cap);
    ASSERT_EQ(n, exp.size());
    for (size_t i = 0; i < exp.size(); ++i) {
        EXPECT_EQ(cls[i], exp[i].cls) << "det " << i;
        EXPECT_NEAR(conf[i], exp[i].score, 1e-4f) << "det " << i;
        EXPECT_NEAR(x1[i], exp[i].x1, 0.05f) << "det " << i;
        EXPECT_NEAR(y2[i], exp[i].y2, 0.05f) << "det " << i;
    }
}

// decode_field at scale 2 halves the source-space coordinates.
TEST(DetectC, DecodeFieldAppliesScale) {
    auto raw = read_floats(fixture("raw_0.bin"));
    auto exp = read_expected(fixture("expected_0.txt"));
    const size_t cap = 64;
    std::vector<int> cls(cap);
    std::vector<float> conf(cap), x1(cap), y1(cap), x2(cap), y2(cap);
    size_t n = dlscan_decode_field(raw.data(), raw.size(), 2.0f, 2.0f, cls.data(), conf.data(),
                                   x1.data(), y1.data(), x2.data(), y2.data(), cap);
    ASSERT_EQ(n, exp.size());
    for (size_t i = 0; i < exp.size(); ++i) {
        EXPECT_NEAR(x1[i], exp[i].x1 / 2.0f, 0.05f) << "det " << i;
        EXPECT_NEAR(y2[i], exp[i].y2 / 2.0f, 0.05f) << "det " << i;
    }
}

// Capacity contract: returns the real count even when it exceeds capacity,
// writing only [capacity] entries (no overflow).
TEST(DetectC, DecodeFieldCapacityContract) {
    auto raw = read_floats(fixture("raw_0.bin"));
    auto exp = read_expected(fixture("expected_0.txt"));
    ASSERT_GE(exp.size(), 2u);
    std::vector<int> cls(1, -7);
    std::vector<float> conf(1), x1(1), y1(1), x2(1), y2(1);
    size_t n = dlscan_decode_field(raw.data(), raw.size(), 1.0f, 1.0f, cls.data(), conf.data(),
                                   x1.data(), y1.data(), x2.data(), y2.data(), 1);
    EXPECT_EQ(n, exp.size());      // real count returned
    EXPECT_EQ(cls[0], exp[0].cls); // only first entry written
}

// decode_field rejects malformed output sizes.
TEST(DetectC, DecodeFieldRejectsBadSize) {
    std::vector<float> bad(61, 0.0f);  // not a multiple of 62
    std::vector<int> cls(4);
    std::vector<float> conf(4), x1(4), y1(4), x2(4), y2(4);
    EXPECT_EQ(dlscan_decode_field(bad.data(), bad.size(), 1, 1, cls.data(), conf.data(),
                                  x1.data(), y1.data(), x2.data(), y2.data(), 4), 0u);
}

// decode_corners on a planted heatmap returns the 4 normalized corners.
TEST(DetectC, DecodeCornersMapsHeatmap) {
    const int W = 128, H = 128, C = 4;
    std::vector<float> hm(static_cast<size_t>(W) * H * C, 0.0f);
    auto idx = [&](int r, int c, int k) { return (static_cast<size_t>(r) * W + c) * C + k; };
    hm[idx(12, 10, 0)] = 1.0f;   // TL
    hm[idx(8, 100, 1)] = 1.0f;   // TR
    hm[idx(120, 118, 2)] = 1.0f; // BR
    hm[idx(119, 6, 3)] = 1.0f;   // BL
    float xs[4] = {0}, ys[4] = {0};
    ASSERT_EQ(dlscan_decode_corners(hm.data(), hm.size(), xs, ys), 1);
    EXPECT_NEAR(xs[0], (10.f + 0.5f) / 128.f, 1e-4f);
    EXPECT_NEAR(ys[0], (12.f + 0.5f) / 128.f, 1e-4f);
    EXPECT_NEAR(xs[2], (118.f + 0.5f) / 128.f, 1e-4f);
    EXPECT_NEAR(ys[3], (119.f + 0.5f) / 128.f, 1e-4f);
    // wrong size rejected
    EXPECT_EQ(dlscan_decode_corners(hm.data(), 100u, xs, ys), 0);
}

// ---- Test-time augmentation (dlscan_augment_rgb) ---------------------------

TEST(DetectC, AugmentBlueGrayReplicatesBlueChannel) {
    // 2x1 image: px0 = (10,20,30), px1 = (200,100,50). Blue-gray copies the
    // blue byte into all three channels.
    const std::array<uint8_t, 6> rgb = {10, 20, 30, 200, 100, 50};
    std::array<uint8_t, 6> out = {0};
    const size_t n = dlscan_augment_rgb(rgb.data(), rgb.size(), 2, 1,
                                        DLSCAN_AUG_BLUE_GRAY, out.data(), out.size());
    ASSERT_EQ(n, 6u);
    EXPECT_EQ(out[0], 30);  EXPECT_EQ(out[1], 30);  EXPECT_EQ(out[2], 30);
    EXPECT_EQ(out[3], 50);  EXPECT_EQ(out[4], 50);  EXPECT_EQ(out[5], 50);
}

TEST(DetectC, AugmentIdentityCopiesUnchanged) {
    // Identity mode is a byte-for-byte passthrough: the clean crop is parsed
    // as-is. Every input byte must appear unchanged in the output (and the
    // pre-zeroed output proves the copy actually ran).
    const std::array<uint8_t, 9> rgb = {10, 20, 30, 200, 100, 50, 0, 255, 128};
    std::array<uint8_t, 9> out = {1, 1, 1, 1, 1, 1, 1, 1, 1};
    const size_t n = dlscan_augment_rgb(rgb.data(), rgb.size(), 3, 1,
                                        DLSCAN_AUG_IDENTITY, out.data(), out.size());
    ASSERT_EQ(n, 9u);
    for (size_t i = 0; i < rgb.size(); ++i) {
        EXPECT_EQ(out[i], rgb[i]) << "byte " << i << " not copied verbatim";
    }
}

TEST(DetectC, AugmentContrastStretchExpandsRange) {
    // A low-contrast green ramp (values 100..104) should stretch so the min
    // maps to 0 and the max to 255 on the green channel; red/blue are constant
    // (degenerate) and must pass through unchanged.
    const int W = 5, H = 1;
    std::array<uint8_t, 15> rgb = {
        40, 100, 200,  40, 101, 200,  40, 102, 200,  40, 103, 200,  40, 104, 200};
    std::array<uint8_t, 15> out = {0};
    const size_t n = dlscan_augment_rgb(rgb.data(), rgb.size(), W, H,
                                        DLSCAN_AUG_CONTRAST_STRETCH, out.data(), out.size());
    ASSERT_EQ(n, 15u);
    // Green channel: extremes pushed to the ends of [0,255].
    EXPECT_EQ(out[1], 0);     // 100 -> 0
    EXPECT_EQ(out[13], 255);  // 104 -> 255
    EXPECT_GT(out[7], out[1]);   // monotonic
    EXPECT_LT(out[7], out[13]);
    // Constant red/blue channels pass through (no divide-by-zero blowup).
    for (int i = 0; i < W; ++i) {
        EXPECT_EQ(out[i * 3 + 0], 40);
        EXPECT_EQ(out[i * 3 + 2], 200);
    }
}

TEST(DetectC, AugmentRejectsBadArgsAndUnknownMode) {
    const std::array<uint8_t, 3> rgb = {1, 2, 3};
    std::array<uint8_t, 3> out = {0};
    // null args
    EXPECT_EQ(dlscan_augment_rgb(nullptr, 3, 1, 1, DLSCAN_AUG_BLUE_GRAY, out.data(), 3), 0u);
    EXPECT_EQ(dlscan_augment_rgb(rgb.data(), 3, 1, 1, DLSCAN_AUG_BLUE_GRAY, nullptr, 3), 0u);
    // short input / output buffers
    EXPECT_EQ(dlscan_augment_rgb(rgb.data(), 2, 1, 1, DLSCAN_AUG_BLUE_GRAY, out.data(), 3), 0u);
    EXPECT_EQ(dlscan_augment_rgb(rgb.data(), 3, 1, 1, DLSCAN_AUG_BLUE_GRAY, out.data(), 2), 0u);
    // non-positive dims
    EXPECT_EQ(dlscan_augment_rgb(rgb.data(), 3, 0, 1, DLSCAN_AUG_BLUE_GRAY, out.data(), 3), 0u);
    // unknown mode
    EXPECT_EQ(dlscan_augment_rgb(rgb.data(), 3, 1, 1, 99, out.data(), 3), 0u);
}
