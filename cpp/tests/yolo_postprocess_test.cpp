#include <gtest/gtest.h>

#include <cmath>
#include <cstring>
#include <vector>

#include "yolo/yolo_postprocess.hpp"
#include "yolo/field_classes.hpp"

using dlscan::yolo::Detection;
using dlscan::yolo::NmsConfig;
using dlscan::yolo::decode_and_nms;
using dlscan::yolo::iou;

// ---------------------------------------------------------------------------
// Synthetic-tensor builder for tests.
//
// The model output layout is channel-major: tensor[ch * num_anchors + a].
// Channels 0..3: cx, cy, w, h. Channels 4..(4+num_classes-1): class scores.
// This helper builds a fully-zeroed tensor and lets the test populate
// individual anchors by index.
// ---------------------------------------------------------------------------

namespace {

constexpr std::size_t kClasses = 30;

struct Tensor {
    std::vector<float> data;
    std::size_t num_classes;
    std::size_t num_anchors;

    Tensor(std::size_t nc, std::size_t na)
        : data((4 + nc) * na, 0.0f), num_classes(nc), num_anchors(na) {}

    void set_anchor(std::size_t a, float cx, float cy, float w, float h) {
        data[0 * num_anchors + a] = cx;
        data[1 * num_anchors + a] = cy;
        data[2 * num_anchors + a] = w;
        data[3 * num_anchors + a] = h;
    }

    void set_class_score(std::size_t a, std::size_t c, float score) {
        data[(4 + c) * num_anchors + a] = score;
    }
};

} // namespace

// ---------------------------------------------------------------------------
// IoU sanity (used both inside NMS and exposed for the platform layer).
// ---------------------------------------------------------------------------

TEST(YoloIoU, NoOverlapIsZero) {
    Detection a; a.x1 = 0;  a.y1 = 0;  a.x2 = 10; a.y2 = 10;
    Detection b; b.x1 = 20; b.y1 = 20; b.x2 = 30; b.y2 = 30;
    EXPECT_FLOAT_EQ(iou(a, b), 0.0f);
}

TEST(YoloIoU, IdenticalBoxIsOne) {
    Detection a; a.x1 = 5; a.y1 = 5; a.x2 = 15; a.y2 = 15;
    EXPECT_FLOAT_EQ(iou(a, a), 1.0f);
}

TEST(YoloIoU, KnownPartialOverlap) {
    // Two 10x10 boxes offset by (5,5) → intersection 5x5=25, union 175.
    Detection a; a.x1 = 0; a.y1 = 0;  a.x2 = 10; a.y2 = 10;
    Detection b; b.x1 = 5; b.y1 = 5;  b.x2 = 15; b.y2 = 15;
    EXPECT_NEAR(iou(a, b), 25.0f / 175.0f, 1e-5f);
}

TEST(YoloIoU, EmptyBoxesReturnZero) {
    Detection a; a.x1 = 0; a.y1 = 0; a.x2 = 0;  a.y2 = 0;
    Detection b; b.x1 = 0; b.y1 = 0; b.x2 = 10; b.y2 = 10;
    EXPECT_FLOAT_EQ(iou(a, b), 0.0f);
}

// ---------------------------------------------------------------------------
// Field-class table — must match Python sorted() and have 30 entries.
// ---------------------------------------------------------------------------

TEST(FieldClasses, HasExactly30Classes) {
    EXPECT_EQ(dlscan::yolo::kNumClasses, 30u);
    EXPECT_EQ(dlscan::yolo::kFieldClassNames.size(), 30u);
}

TEST(FieldClasses, ClassZeroIsBirthday) {
    // First in sorted order is "birthday".
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(0), "birthday");
}

TEST(FieldClasses, ClassTwentyNineIsSurname) {
    // Last in sorted order is "surname".
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(29), "surname");
}

TEST(FieldClasses, OutOfRangeReturnsEmpty) {
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(-1), "");
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(30), "");
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(9999), "");
}

TEST(FieldClasses, KnownPositionsMatchPythonSort) {
    // Spot-check key indices that human eyes confuse most:
    // - "list_12" precedes "list_15" (lexicographic, "1" < "1" then "2" < "5")
    // - "list_19" precedes "list_2"  ("list_1*" < "list_2")
    // - "donor" follows alphabetic letters c,e,f,g but precedes m
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(11), "list_12");
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(12), "list_15");
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(16), "list_19");
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(17), "list_2");
    EXPECT_STREQ(dlscan::yolo::class_name_or_empty(4),  "donor");
}

// ---------------------------------------------------------------------------
// Decode + NMS — synthetic single-anchor cases.
// ---------------------------------------------------------------------------

TEST(YoloPostprocess, SinglePeakAboveThresholdProducesOneDetection) {
    Tensor t(kClasses, /*num_anchors=*/100);
    // Anchor 50: a 100x80 bbox centered at (320, 240), high score for class 9
    t.set_anchor(50, 320.f, 240.f, 100.f, 80.f);
    t.set_class_score(50, 9, 0.95f);

    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    ASSERT_EQ(dets.size(), 1u);
    EXPECT_EQ(dets[0].class_id, 9);
    EXPECT_NEAR(dets[0].confidence, 0.95f, 1e-5f);
    EXPECT_NEAR(dets[0].x1, 270.f, 1e-3f);
    EXPECT_NEAR(dets[0].y1, 200.f, 1e-3f);
    EXPECT_NEAR(dets[0].x2, 370.f, 1e-3f);
    EXPECT_NEAR(dets[0].y2, 280.f, 1e-3f);
}

TEST(YoloPostprocess, AllScoresBelowThresholdYieldsEmpty) {
    Tensor t(kClasses, /*num_anchors=*/50);
    for (std::size_t a = 0; a < 50; ++a) {
        t.set_anchor(a, 100.f, 100.f, 50.f, 50.f);
        t.set_class_score(a, a % kClasses, 0.10f);  // all below default 0.25
    }
    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    EXPECT_TRUE(dets.empty());
}

TEST(YoloPostprocess, EmptyTensorEdgeCase) {
    auto dets = decode_and_nms(nullptr, kClasses, 0);
    EXPECT_TRUE(dets.empty());
}

TEST(YoloPostprocess, ArgmaxPicksHighestScoringClass) {
    Tensor t(kClasses, /*num_anchors=*/10);
    t.set_anchor(3, 100.f, 100.f, 50.f, 50.f);
    t.set_class_score(3, 5,  0.30f);
    t.set_class_score(3, 17, 0.85f);  // wins
    t.set_class_score(3, 22, 0.40f);

    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    ASSERT_EQ(dets.size(), 1u);
    EXPECT_EQ(dets[0].class_id, 17);
    EXPECT_NEAR(dets[0].confidence, 0.85f, 1e-5f);
}

// ---------------------------------------------------------------------------
// Decode + NMS — class-wise suppression behavior.
// ---------------------------------------------------------------------------

TEST(YoloPostprocess, SameClassOverlappingBboxesSuppressLower) {
    // Two anchors hit the same class with overlapping bboxes — NMS must keep
    // only the higher-confidence one.
    Tensor t(kClasses, /*num_anchors=*/10);
    // Anchor A: high conf, big box
    t.set_anchor(0, 100.f, 100.f, 100.f, 100.f);
    t.set_class_score(0, 7, 0.90f);
    // Anchor B: lower conf, almost identical box (high IoU)
    t.set_anchor(1, 102.f, 101.f, 100.f, 100.f);
    t.set_class_score(1, 7, 0.70f);

    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    ASSERT_EQ(dets.size(), 1u);
    EXPECT_EQ(dets[0].class_id, 7);
    EXPECT_NEAR(dets[0].confidence, 0.90f, 1e-5f);
}

TEST(YoloPostprocess, DifferentClassOverlapsAllKept) {
    // Two anchors, identical-ish bboxes, but DIFFERENT classes — both kept
    // (NMS is per-class).
    Tensor t(kClasses, /*num_anchors=*/10);
    t.set_anchor(0, 100.f, 100.f, 100.f, 100.f);
    t.set_class_score(0, 7, 0.90f);
    t.set_anchor(1, 100.f, 100.f, 100.f, 100.f);
    t.set_class_score(1, 23, 0.80f);   // different class

    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    ASSERT_EQ(dets.size(), 2u);
    // Output sorted by confidence descending, so class 7 comes first.
    EXPECT_EQ(dets[0].class_id, 7);
    EXPECT_EQ(dets[1].class_id, 23);
}

TEST(YoloPostprocess, SameClassNonOverlappingBboxesAllKept) {
    // Same class but boxes disjoint — both kept (no IoU, no suppression).
    Tensor t(kClasses, /*num_anchors=*/10);
    t.set_anchor(0, 100.f, 100.f, 50.f, 50.f);   // [75,75 → 125,125]
    t.set_class_score(0, 12, 0.90f);
    t.set_anchor(1, 400.f, 400.f, 50.f, 50.f);   // [375,375 → 425,425]
    t.set_class_score(1, 12, 0.85f);

    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    ASSERT_EQ(dets.size(), 2u);
    EXPECT_EQ(dets[0].class_id, 12);
    EXPECT_EQ(dets[1].class_id, 12);
}

// ---------------------------------------------------------------------------
// Output ordering + cap.
// ---------------------------------------------------------------------------

TEST(YoloPostprocess, OutputSortedByConfidenceDescending) {
    Tensor t(kClasses, /*num_anchors=*/10);
    // Three different-class detections with mid-low-high confidence —
    // verifying global sort across classes ends up descending.
    t.set_anchor(0, 100.f, 100.f, 50.f, 50.f);
    t.set_class_score(0, 0, 0.50f);
    t.set_anchor(1, 200.f, 100.f, 50.f, 50.f);
    t.set_class_score(1, 1, 0.80f);
    t.set_anchor(2, 300.f, 100.f, 50.f, 50.f);
    t.set_class_score(2, 2, 0.65f);

    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    ASSERT_EQ(dets.size(), 3u);
    EXPECT_GT(dets[0].confidence, dets[1].confidence);
    EXPECT_GT(dets[1].confidence, dets[2].confidence);
}

TEST(YoloPostprocess, MaxDetectionsCapTruncatesByConfidence) {
    Tensor t(kClasses, /*num_anchors=*/30);
    // 30 anchors, 30 different classes, decreasing confidence —
    // 0.99, 0.98, ..., 0.70.
    for (std::size_t a = 0; a < 30; ++a) {
        t.set_anchor(a, static_cast<float>(50 + 30 * a), 100.f, 20.f, 20.f);
        t.set_class_score(a, a, 0.99f - 0.01f * static_cast<float>(a));
    }

    NmsConfig cfg;
    cfg.max_detections = 5;
    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors, cfg);
    ASSERT_EQ(dets.size(), 5u);
    // The five kept must be the top-5 by confidence.
    EXPECT_NEAR(dets[0].confidence, 0.99f, 1e-5f);
    EXPECT_NEAR(dets[4].confidence, 0.95f, 1e-5f);
}

TEST(YoloPostprocess, ConfThresholdRespected) {
    Tensor t(kClasses, /*num_anchors=*/10);
    t.set_anchor(0, 100.f, 100.f, 50.f, 50.f);
    t.set_class_score(0, 5, 0.20f);
    t.set_anchor(1, 200.f, 200.f, 50.f, 50.f);
    t.set_class_score(1, 6, 0.30f);

    NmsConfig cfg;
    cfg.conf_threshold = 0.25f;
    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors, cfg);
    ASSERT_EQ(dets.size(), 1u);
    EXPECT_EQ(dets[0].class_id, 6);
}

// ---------------------------------------------------------------------------
// Realistic field-detector-style scenario.
// ---------------------------------------------------------------------------

TEST(YoloPostprocess, RealisticDriverLicenseFieldsAllSurvive) {
    // Simulate a clean detection of 5 typical AAMVA fields on a 640x640
    // letterboxed input. Each anchor produces a unique class with high conf;
    // all bboxes are spatially disjoint. Expect all 5 to survive NMS.
    Tensor t(kClasses, /*num_anchors=*/8400);  // matches real model anchor count

    struct Field { std::size_t a; int cls; float cx, cy, w, h; const char* name; };
    const Field fixtures[] = {
        {  100, 10, 100, 60,  120, 30, "list_1 (last name)"  },
        {  500, 17, 100, 100, 120, 30, "list_2 (first name)" },
        { 1000, 18, 100, 140,  90, 30, "list_3 (DOB)"        },
        { 2000, 22, 100, 180, 140, 30, "list_4d (DL number)" },
        { 3000, 24, 100, 260, 200, 60, "list_8f (street)"    },
    };
    for (const auto& f : fixtures) {
        t.set_anchor(f.a, f.cx, f.cy, f.w, f.h);
        t.set_class_score(f.a, static_cast<std::size_t>(f.cls), 0.92f);
    }

    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    EXPECT_EQ(dets.size(), 5u);
}

// ============================================================================
// Phase 2.5 review fixes — regression tests for code review findings.
//   - kInvalidClassId sentinel exposed and used by Detection default ctor
//   - iou() guards zero-area + negative-extent boxes
//   - TensorLayout::AnchorMajor parses correctly
//   - Defensive: num_classes=0 early-return, deterministic NMS tiebreak
// ============================================================================

TEST(YoloIoU, ZeroAreaBoxReturnsZero) {
    Detection a; a.x1 = 5; a.y1 = 5; a.x2 = 5;  a.y2 = 5;   // zero-area
    Detection b; b.x1 = 0; b.y1 = 0; b.x2 = 10; b.y2 = 10;
    EXPECT_FLOAT_EQ(iou(a, b), 0.0f);
    EXPECT_FLOAT_EQ(iou(b, a), 0.0f);
}

TEST(YoloIoU, NegativeExtentBoxReturnsZero) {
    // Defensive: x2 < x1 shouldn't happen in practice but must not produce
    // a negative-area divisor that flips the IoU sign.
    Detection a; a.x1 = 10; a.y1 = 0; a.x2 = 5;  a.y2 = 10;  // negative width
    Detection b; b.x1 = 0;  b.y1 = 0; b.x2 = 20; b.y2 = 20;
    EXPECT_FLOAT_EQ(iou(a, b), 0.0f);
}

TEST(Detection, DefaultsToInvalidClassId) {
    Detection d;
    EXPECT_EQ(d.class_id, dlscan::yolo::kInvalidClassId);
    EXPECT_EQ(d.class_id, -1);
}

TEST(YoloPostprocess, NumClassesZeroReturnsEmpty) {
    // Edge case: caller passes a malformed model output. Must not crash
    // (which would happen via 0-divide on the avg_per_class calculation).
    std::vector<float> buf(4, 0.0f);  // 4 channels, 1 anchor — but no class scores
    auto dets = decode_and_nms(buf.data(), /*num_classes=*/0, /*num_anchors=*/1);
    EXPECT_TRUE(dets.empty());
}

TEST(YoloPostprocess, AnchorMajorLayoutParsesCorrectly) {
    // Build the same single-detection scenario as the channel-major test, but
    // with the AnchorMajor storage convention. Same input must produce the
    // same Detection.
    constexpr std::size_t na = 100;
    std::vector<float> buf((4 + kClasses) * na, 0.0f);
    // Anchor 50: cx=320, cy=240, w=100, h=80, class 9 score=0.95
    const std::size_t row_stride = 4 + kClasses;
    buf[50 * row_stride + 0] = 320.f;
    buf[50 * row_stride + 1] = 240.f;
    buf[50 * row_stride + 2] = 100.f;
    buf[50 * row_stride + 3] = 80.f;
    buf[50 * row_stride + 4 + 9] = 0.95f;

    NmsConfig cfg;
    cfg.layout = dlscan::yolo::TensorLayout::AnchorMajor;
    auto dets = decode_and_nms(buf.data(), kClasses, na, cfg);
    ASSERT_EQ(dets.size(), 1u);
    EXPECT_EQ(dets[0].class_id, 9);
    EXPECT_NEAR(dets[0].confidence, 0.95f, 1e-5f);
    EXPECT_NEAR(dets[0].x1, 270.f, 1e-3f);
    EXPECT_NEAR(dets[0].x2, 370.f, 1e-3f);
}

TEST(YoloPostprocess, TiedConfidencesProduceDeterministicOutput) {
    // Two SAME-class anchors with identical confidence and overlapping bboxes:
    // greedy NMS must keep exactly one — no UB, no duplicate, no flip-flop.
    Tensor t(kClasses, /*num_anchors=*/4);
    t.set_anchor(0, 100.f, 100.f, 50.f, 50.f);
    t.set_class_score(0, 5, 0.80f);
    t.set_anchor(1, 102.f, 101.f, 50.f, 50.f);   // overlaps anchor 0
    t.set_class_score(1, 5, 0.80f);              // tied confidence
    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    EXPECT_EQ(dets.size(), 1u);
    EXPECT_EQ(dets[0].class_id, 5);
    EXPECT_NEAR(dets[0].confidence, 0.80f, 1e-5f);
}

TEST(YoloPostprocess, SuppressedNegativeExtentBoxIsIgnored) {
    // If the model ever emits a degenerate bbox (w<=0), it should not cause
    // sibling detections to be wrongly suppressed by IoU=NaN/inf math.
    Tensor t(kClasses, /*num_anchors=*/2);
    // Anchor 0: legitimate detection
    t.set_anchor(0, 100.f, 100.f, 50.f, 50.f);
    t.set_class_score(0, 7, 0.90f);
    // Anchor 1: same class, near-identical center, but w=0 (degenerate)
    t.set_anchor(1, 101.f, 100.f, 0.f, 50.f);
    t.set_class_score(1, 7, 0.85f);
    auto dets = decode_and_nms(t.data.data(), t.num_classes, t.num_anchors);
    // Both should survive — degenerate box has IoU=0 with anchor 0 by guard.
    // (In practice the platform layer would filter degenerate boxes too.)
    ASSERT_EQ(dets.size(), 2u);
    EXPECT_EQ(dets[0].class_id, 7);
    EXPECT_NEAR(dets[0].confidence, 0.90f, 1e-5f);
}
