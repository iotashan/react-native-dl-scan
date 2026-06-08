// Tests for the DocAligner corner-heatmap decode (cpp/detect/doc_aligner).
//
// Heatmaps are planted in-test with known peaks so expected corners are
// hand-computable; this pins the NHWC indexing, the TL/TR/BR/BL channel order,
// and both the hard-argmax and local soft-argmax (sub-pixel) paths without
// needing the model or a fixture file.
#include <array>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "detect/doc_aligner.hpp"
#include "gtest/gtest.h"

namespace {
constexpr int W = 128, H = 128, C = 4;

// NHWC channel-last index.
inline std::size_t idx(int r, int c, int k) {
    return (static_cast<std::size_t>(r) * W + c) * C + k;
}
}  // namespace

// Soft-argmax (default refine_radius=2): single-cell channels reduce to the
// cell center; multi-cell channels give the weighted centroid. Also pins the
// TL,TR,BR,BL channel ordering.
TEST(DocAligner, SoftArgmaxCentroidsAndChannelOrder) {
    std::vector<float> hm(static_cast<size_t>(W) * H * C, 0.0f);
    // ch0 TL: single hot at (r=12,c=10).
    hm[idx(12, 10, 0)] = 1.0f;
    // ch1 TR: two equal cells (r=8,c=100),(r=8,c=101) -> col centroid 100.5.
    hm[idx(8, 100, 1)] = 1.0f;
    hm[idx(8, 101, 1)] = 1.0f;
    // ch2 BR: weighted (r=120,c=118)=3,(r=120,c=119)=1 -> col centroid 118.25.
    hm[idx(120, 118, 2)] = 3.0f;
    hm[idx(120, 119, 2)] = 1.0f;
    // ch3 BL: single hot at (r=119,c=6).
    hm[idx(119, 6, 3)] = 0.5f;

    auto k = dlscan::detect::decode_corners(hm.data());  // refine_radius=2

    EXPECT_NEAR(k[0].x, (10.0f + 0.5f) / 128.0f, 1e-4f);   // TL
    EXPECT_NEAR(k[0].y, (12.0f + 0.5f) / 128.0f, 1e-4f);
    EXPECT_NEAR(k[1].x, (100.5f + 0.5f) / 128.0f, 1e-4f);  // TR (centroid)
    EXPECT_NEAR(k[1].y, (8.0f + 0.5f) / 128.0f, 1e-4f);
    EXPECT_NEAR(k[2].x, (118.25f + 0.5f) / 128.0f, 1e-4f); // BR (weighted)
    EXPECT_NEAR(k[2].y, (120.0f + 0.5f) / 128.0f, 1e-4f);
    EXPECT_NEAR(k[3].x, (6.0f + 0.5f) / 128.0f, 1e-4f);    // BL
    EXPECT_NEAR(k[3].y, (119.0f + 0.5f) / 128.0f, 1e-4f);
}

// refine_radius=0 -> hard argmax: tied cells resolve to the first in row-major
// then column-major scan order (c=100 before c=101), no centroid blending.
TEST(DocAligner, HardArgmaxNoRefine) {
    std::vector<float> hm(static_cast<size_t>(W) * H * C, 0.0f);
    hm[idx(8, 100, 1)] = 1.0f;
    hm[idx(8, 101, 1)] = 1.0f;

    dlscan::detect::DocAlignerConfig cfg;
    cfg.refine_radius = 0;
    auto k = dlscan::detect::decode_corners(hm.data(), cfg);

    EXPECT_NEAR(k[1].x, (100.0f + 0.5f) / 128.0f, 1e-4f);  // first tie wins
    EXPECT_NEAR(k[1].y, (8.0f + 0.5f) / 128.0f, 1e-4f);
}

namespace {
// Replays a fixed heatmap, recording the input size so the orchestrator test
// can confirm DocAligner preprocessed to the 256x256x3 model resolution.
class FakeInterpreter : public dlscan::detect::ModelInterpreter {
   public:
    explicit FakeInterpreter(std::vector<float> hm) : hm_(std::move(hm)) {}
    std::pair<const float*, std::size_t> invoke(const float* input,
                                                std::size_t input_floats) override {
        last_input_floats = input_floats;
        EXPECT_NE(input, nullptr);
        return {hm_.data(), hm_.size()};
    }
    std::size_t last_input_floats = 0;

   private:
    std::vector<float> hm_;
};
}  // namespace

// The DocAligner orchestrator preprocesses to 256x256x3, invokes, and returns
// decode_corners() of the model output — verified against the standalone decode.
TEST(DocAligner, OrchestratorPreprocessesInvokesDecodes) {
    std::vector<float> hm(static_cast<size_t>(W) * H * C, 0.0f);
    hm[idx(12, 10, 0)] = 1.0f;    // TL
    hm[idx(8, 100, 1)] = 1.0f;    // TR
    hm[idx(120, 118, 2)] = 2.0f;  // BR
    hm[idx(119, 6, 3)] = 0.5f;    // BL
    auto expected = dlscan::detect::decode_corners(hm.data());

    auto fake = std::make_unique<FakeInterpreter>(hm);
    FakeInterpreter* raw = fake.get();
    dlscan::detect::DocAligner aligner(std::move(fake));

    std::vector<uint8_t> img(static_cast<size_t>(300) * 200 * 3, 0);  // arbitrary frame
    auto got = aligner.run(img.data(), 300, 200);

    EXPECT_EQ(raw->last_input_floats, static_cast<size_t>(3) * 256 * 256);
    for (int k = 0; k < 4; ++k) {
        EXPECT_NEAR(got[k].x, expected[k].x, 1e-6f) << "corner " << k;
        EXPECT_NEAR(got[k].y, expected[k].y, 1e-6f) << "corner " << k;
    }
}

#ifdef DOCALIGNER_FIXTURE_DIR
namespace {
std::string da_fixture(const std::string& n) { return std::string(DOCALIGNER_FIXTURE_DIR) + "/" + n; }

std::vector<float> read_floats(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    EXPECT_TRUE(f.good()) << "missing fixture: " << path;
    std::vector<float> v;
    float x;
    while (f.read(reinterpret_cast<char*>(&x), sizeof(float))) v.push_back(x);
    return v;
}

std::array<dlscan::detect::Corner, 4> read_corners(const std::string& path) {
    std::ifstream f(path);
    EXPECT_TRUE(f.good()) << "missing fixture: " << path;
    std::array<dlscan::detect::Corner, 4> c{};
    for (int i = 0; i < 4; ++i) f >> c[i].x >> c[i].y;
    return c;
}

// Decode a REAL DocAligner output heatmap (generated from
// docaligner_lcnet100.tflite on an IDNet card) and confirm it matches the
// reference decode. This closes the gap between planted goldens and the model:
// it proves decode_corners is correct on actual model output, not just
// synthetic peaks. The reference (corners_N.txt) uses the identical argmax +
// soft-argmax(radius=2) algorithm.
void check_real(int n) {
    auto hm = read_floats(da_fixture("heatmap_" + std::to_string(n) + ".bin"));
    ASSERT_EQ(hm.size(), static_cast<size_t>(128) * 128 * 4) << "fixture " << n;
    auto got = dlscan::detect::decode_corners(hm.data());  // 128x128x4, radius 2
    auto exp = read_corners(da_fixture("corners_" + std::to_string(n) + ".txt"));
    for (int k = 0; k < 4; ++k) {
        EXPECT_NEAR(got[k].x, exp[k].x, 1e-4f) << "fixture " << n << " corner " << k;
        EXPECT_NEAR(got[k].y, exp[k].y, 1e-4f) << "fixture " << n << " corner " << k;
    }
}
}  // namespace

TEST(DocAligner, DecodesRealModelHeatmap0) { check_real(0); }
TEST(DocAligner, DecodesRealModelHeatmap1) { check_real(1); }
#endif  // DOCALIGNER_FIXTURE_DIR
