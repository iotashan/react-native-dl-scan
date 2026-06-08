// Orchestration tests for dlscan::detect::FieldDetector.
//
// A FakeInterpreter replays the planted golden raw tensor (raw_0.bin) and
// asserts FieldDetector fed it a correctly-sized preprocessed input. This pins
// the full preprocess -> invoke -> decode -> coordinate-map pipeline on the
// host with no inference library linked. The LiteRT-backed interpreter is
// exercised in the platform builds; here we verify the glue is correct.
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "detect/field_detector.hpp"
#include "gtest/gtest.h"

namespace {

std::string fixture(const std::string& name) {
    return std::string(NANODET_FIXTURE_DIR) + "/" + name;
}

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

// Replays a fixed raw output, ignoring the input — but records the input size
// so the test can confirm FieldDetector preprocessed to the model resolution.
class FakeInterpreter : public dlscan::detect::ModelInterpreter {
   public:
    explicit FakeInterpreter(std::vector<float> raw) : raw_(std::move(raw)) {}
    std::pair<const float*, std::size_t> invoke(const float* input,
                                                std::size_t input_floats) override {
        last_input_floats = input_floats;
        EXPECT_NE(input, nullptr);
        return {raw_.data(), raw_.size()};
    }
    std::size_t last_input_floats = 0;

   private:
    std::vector<float> raw_;
};

dlscan::detect::FieldDetector make_detector(FakeInterpreter** out_fake) {
    auto fake = std::make_unique<FakeInterpreter>(read_floats(fixture("raw_0.bin")));
    *out_fake = fake.get();
    dlscan::detect::FieldDetectorOptions opts;  // default 416 / 30 cls / reg_max 7
    return dlscan::detect::FieldDetector(std::move(fake), opts);
}

}  // namespace

// Source already at model resolution (416x416): scale = 1, so detections must
// match the decode golden exactly, and preprocess must have produced
// 3*416*416 floats.
TEST(FieldDetector, RunMatchesGoldenAtNativeResolution) {
    FakeInterpreter* fake = nullptr;
    auto det = make_detector(&fake);

    std::vector<uint8_t> img(static_cast<size_t>(416) * 416 * 3, 0);
    auto got = det.run(img.data(), 416, 416);
    auto exp = read_expected(fixture("expected_0.txt"));

    EXPECT_EQ(fake->last_input_floats, static_cast<size_t>(3) * 416 * 416);
    ASSERT_EQ(got.size(), exp.size());
    for (size_t i = 0; i < exp.size(); ++i) {
        EXPECT_EQ(got[i].class_id, exp[i].cls) << "det " << i;
        EXPECT_NEAR(got[i].confidence, exp[i].score, 1e-4f) << "det " << i;
        EXPECT_NEAR(got[i].x1, exp[i].x1, 0.05f) << "det " << i;
        EXPECT_NEAR(got[i].y1, exp[i].y1, 0.05f) << "det " << i;
        EXPECT_NEAR(got[i].x2, exp[i].x2, 0.05f) << "det " << i;
        EXPECT_NEAR(got[i].y2, exp[i].y2, 0.05f) << "det " << i;
    }
}

// Half-resolution source (208x208): preprocess stretches up by 2x (scale=2),
// so model-space boxes must be divided by 2 to land back in source space.
// This pins the coordinate-mapping step independently of decode.
TEST(FieldDetector, RunMapsBoxesBackToSourceSpace) {
    FakeInterpreter* fake = nullptr;
    auto det = make_detector(&fake);

    std::vector<uint8_t> img(static_cast<size_t>(208) * 208 * 3, 0);
    auto got = det.run(img.data(), 208, 208);
    auto exp = read_expected(fixture("expected_0.txt"));

    // preprocess still outputs the model resolution regardless of source size.
    EXPECT_EQ(fake->last_input_floats, static_cast<size_t>(3) * 416 * 416);
    ASSERT_EQ(got.size(), exp.size());
    for (size_t i = 0; i < exp.size(); ++i) {
        EXPECT_EQ(got[i].class_id, exp[i].cls) << "det " << i;
        EXPECT_NEAR(got[i].x1, exp[i].x1 / 2.0f, 0.05f) << "det " << i;
        EXPECT_NEAR(got[i].y1, exp[i].y1 / 2.0f, 0.05f) << "det " << i;
        EXPECT_NEAR(got[i].x2, exp[i].x2 / 2.0f, 0.05f) << "det " << i;
        EXPECT_NEAR(got[i].y2, exp[i].y2 / 2.0f, 0.05f) << "det " << i;
    }
}
