#include <gtest/gtest.h>

#include "voter.hpp"
#include "ocr/ocr_field_extractor.hpp"  // extract_fields_from_candidates

#include <algorithm>
#include <string>
#include <vector>

using namespace dlscan;

namespace {

// Tiny helper — build a FieldCandidate with text/id/source set; rest are
// nullopt. The test matrix doesn't exercise the diagnostic metadata since
// they're not voting inputs.
FieldCandidate cand(FieldId id, const std::string& text, FieldSource src) {
    FieldCandidate c;
    c.id = id;
    c.text = text;
    c.source = src;
    return c;
}

// Find one consensus result by (id, source). Returns nullptr if absent.
const FieldCandidate* find(const std::vector<FieldCandidate>& v,
                            FieldId id, FieldSource src) {
    for (const auto& c : v) {
        if (c.id == id && c.source == src) return &c;
    }
    return nullptr;
}

}  // namespace

// ============================================================================
// round-2 required test matrix for v2 Sequence D (task #52)
// ============================================================================

TEST(FieldVoter, SingleVoteBelowDefaultFloorIsNotEmitted) {
    FieldVoter v;
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    auto c = v.consensus();
    EXPECT_EQ(c.size(), 0u);
    EXPECT_EQ(find(c, FieldId::List1, FieldSource::BboxIoU), nullptr);
}

TEST(FieldVoter, TwoVotesReachDefaultFloor) {
    FieldVoter v;
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 1u);
    EXPECT_EQ(c[0].text, "DOE");
    EXPECT_EQ(c[0].id, FieldId::List1);
    EXPECT_EQ(c[0].source, FieldSource::BboxIoU);
}

TEST(FieldVoter, ConstructorMinVotesCanRaiseFloor) {
    FieldVoter v(FieldVoter::DEFAULT_MAX_VOTES, 3);
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    EXPECT_EQ(v.consensus().size(), 0u);

    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 1u);
    EXPECT_EQ(c[0].text, "DOE");
}

TEST(FieldVoter, MajorityWins) {
    FieldVoter v;
    for (int i = 0; i < 3; ++i)
        v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    for (int i = 0; i < 2; ++i)
        v.accept({cand(FieldId::List1, "DEO", FieldSource::BboxIoU)});
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 1u);
    EXPECT_EQ(c[0].text, "DOE") << "majority value (3 > 2) must win";
}

TEST(FieldVoter, TieBrokenByRecency) {
    FieldVoter v;
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1, "DEO", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1, "DEO", FieldSource::BboxIoU)});  // most recent
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 1u);
    EXPECT_EQ(c[0].text, "DEO") << "tied (2:2) — most-recent wins";
}

TEST(FieldVoter, EmptyTextSkipped) {
    FieldVoter v;
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1, "",    FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1, "DOE", FieldSource::BboxIoU)});
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 1u);
    EXPECT_EQ(c[0].text, "DOE");
}

TEST(FieldVoter, UnknownIdSkipped) {
    FieldVoter v;
    v.accept({cand(FieldId::Unknown, "junk", FieldSource::BboxIoU)});
    EXPECT_EQ(v.consensus().size(), 0u);
    EXPECT_EQ(v.bucketCount(), 0u);
}

TEST(FieldVoter, FifoEvictsBeyondMax) {
    constexpr std::size_t MAX = 5;
    FieldVoter v(MAX);
    // 6 votes — first should be evicted from the FIFO.
    v.accept({cand(FieldId::List1, "OLD", FieldSource::BboxIoU)});
    for (int i = 0; i < MAX; ++i)
        v.accept({cand(FieldId::List1, "NEW", FieldSource::BboxIoU)});
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 1u);
    EXPECT_EQ(c[0].text, "NEW") << "OLD must be evicted, leaving 5x NEW";
}

TEST(FieldVoter, ResetClearsAllBuckets) {
    FieldVoter v;
    v.accept({cand(FieldId::List1,  "DOE", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List15, "M",   FieldSource::StrictTextPool)});
    EXPECT_EQ(v.bucketCount(), 2u);
    v.reset();
    EXPECT_EQ(v.bucketCount(), 0u);
    EXPECT_EQ(v.consensus().size(), 0u);
}

TEST(FieldVoter, MultipleFieldsInOneFrame) {
    FieldVoter v;
    v.accept({
        cand(FieldId::List1, "DOE",  FieldSource::BboxIoU),
        cand(FieldId::List2, "JANE", FieldSource::BboxIoU),
    });
    v.accept({
        cand(FieldId::List1, "DOE",  FieldSource::BboxIoU),
        cand(FieldId::List2, "JANE", FieldSource::BboxIoU),
    });
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 2u);
    EXPECT_NE(find(c, FieldId::List1, FieldSource::BboxIoU), nullptr);
    EXPECT_NE(find(c, FieldId::List2, FieldSource::BboxIoU), nullptr);
}

// ============================================================================
// round-2 critical correctness gate (task #52):
// (FieldId, FieldSource) must be the bucket key, NOT FieldId alone.
// Collapsing list_15 + list_15_strict into one bucket would lose the
// signal that two independent paths agreed — destroying the
// CrossValidated (1.00) tier upgrade.
// ============================================================================

TEST(FieldVoter, RegularAndStrictSameFieldSameFrameKeepSeparateBuckets) {
    FieldVoter v;
    // One frame, same FieldId, different sources — must produce TWO
    // consensus candidates downstream (not collapse into one).
    v.accept({
        cand(FieldId::List15, "M",  FieldSource::BboxIoU),
        cand(FieldId::List15, "M",  FieldSource::StrictTextPool),
    });
    v.accept({
        cand(FieldId::List15, "M",  FieldSource::BboxIoU),
        cand(FieldId::List15, "M",  FieldSource::StrictTextPool),
    });
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 2u)
        << "(FieldId, FieldSource) keying must keep these separate";
    EXPECT_NE(find(c, FieldId::List15, FieldSource::BboxIoU), nullptr);
    EXPECT_NE(find(c, FieldId::List15, FieldSource::StrictTextPool), nullptr);
}

TEST(FieldVoter, RegularAndStrictDisagreeBothEmitted) {
    FieldVoter v;
    // bbox says "F" repeatedly, strict says "M".
    for (int i = 0; i < 5; ++i)
        v.accept({cand(FieldId::List15, "F", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List15, "M", FieldSource::StrictTextPool)});
    v.accept({cand(FieldId::List15, "M", FieldSource::StrictTextPool)});
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 2u);
    auto* bbox = find(c, FieldId::List15, FieldSource::BboxIoU);
    auto* strict = find(c, FieldId::List15, FieldSource::StrictTextPool);
    ASSERT_NE(bbox, nullptr);
    ASSERT_NE(strict, nullptr);
    EXPECT_EQ(bbox->text, "F");
    EXPECT_EQ(strict->text, "M");
}

TEST(FieldVoter, ConsensusFeedsResolverForCrossValidatedUpgrade) {
    // End-to-end: voter consensus → extract_fields_from_candidates →
    // resolver detects strict+bbox agreement → stamps CrossValidated.
    // This is the integration that proves (FieldId, FieldSource) keying
    // preserves the v1 #43 StrictAgrees behavior.
    FieldVoter v;
    v.accept({cand(FieldId::List1,  "DOE", FieldSource::BboxIoU)});
    v.accept({cand(FieldId::List1,  "DOE", FieldSource::BboxIoU)});
    v.accept({
        cand(FieldId::List15, "M", FieldSource::BboxIoU),
        cand(FieldId::List15, "M", FieldSource::StrictTextPool),
    });
    v.accept({
        cand(FieldId::List15, "M", FieldSource::BboxIoU),
        cand(FieldId::List15, "M", FieldSource::StrictTextPool),
    });
    auto consensus = v.consensus();
    auto parsed = extract_fields_from_candidates(consensus);
    ASSERT_TRUE(parsed.has_value());
    auto it = parsed->fieldConfidence.find("sex");
    ASSERT_NE(it, parsed->fieldConfidence.end());
    EXPECT_FLOAT_EQ(it->second, 1.00f)
        << "StrictAgrees → CrossValidated upgrade must survive the voter path";
}

TEST(FieldVoter, DiagnosticMetadataFromMostRecentMatchingVote) {
    FieldVoter v;
    FieldCandidate a;
    a.id = FieldId::List1;
    a.text = "DOE";
    a.source = FieldSource::BboxIoU;
    a.iou = 0.55f;
    a.frameIndex = 1;
    FieldCandidate b = a;
    b.iou = 0.92f;
    b.frameIndex = 2;
    v.accept({a});
    v.accept({b});
    auto c = v.consensus();
    ASSERT_EQ(c.size(), 1u);
    ASSERT_TRUE(c[0].iou.has_value());
    EXPECT_FLOAT_EQ(*c[0].iou, 0.92f) << "metadata from last matching vote";
    EXPECT_EQ(*c[0].frameIndex, 2);
}
