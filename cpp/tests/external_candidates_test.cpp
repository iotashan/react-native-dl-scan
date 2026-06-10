// External DataDetector candidate-merge tests (issue #124).
//
// iOS 26+ runs Vision's RecognizeDocumentsRequest on the retained best crop
// during the finalization pass and feeds the DataDetector hits into
// extract_fields_from_candidates as FieldSource::DataDetector candidates.
// These tests pin the merge contract end-to-end through the public resolver:
//
//   FILL-ONLY     — empty fields fill at ShapeMatched (0.85);
//   AGREEMENT     — exact agreement with a populated field upgrades its
//                   confidence to CrossValidated (1.00), value untouched;
//   DISAGREEMENT  — populated fields are never overwritten or deleted;
//   AMBIGUITY     — the date set is assigned only when EXACTLY three
//                   distinct dates survive dedupe ({DOB, ISS, EXP} rule);
//                   address sub-fields with >1 distinct value are skipped;
//   PARTIALS      — a partial address fills only the sub-fields present;
//   NO-OP         — with zero DataDetector candidates the resolver output
//                   is unchanged (the Android / iOS<26 path).
//
// All fixture values are SYNTHETIC (the repo's J415 / GARCIA / SPRINGFIELD
// identities) — never real-looking PII.

#include <gtest/gtest.h>

#include "ocr/ocr_field_extractor.hpp"

using dlscan::FieldCandidate;
using dlscan::FieldCandidateVector;
using dlscan::FieldId;
using dlscan::FieldSource;
using dlscan::LicenseData;
using dlscan::extract_fields_from_candidates;

namespace {

FieldCandidate cand(FieldId id, const std::string& text,
                    FieldSource src = FieldSource::BboxIoU) {
    FieldCandidate c;
    c.id = id;
    c.source = src;
    c.text = text;
    return c;
}

FieldCandidate dd(FieldId id, const std::string& text) {
    return cand(id, text, FieldSource::DataDetector);
}

/// Per-field confidence lookup; -1 when the field has no recorded entry.
float conf(const LicenseData& ld, const std::string& key) {
    auto it = ld.fieldConfidence.find(key);
    return it == ld.fieldConfidence.end() ? -1.0f : it->second;
}

std::string sval(const std::optional<std::string>& v) {
    return v.value_or("<null>");
}

} // namespace

// ─── no-op property (Android / iOS<26 path) ────────────────────────────────

TEST(ExternalCandidates, NoExternalCandidates_BaselineUnchanged) {
    // A representative pre-#124 candidate set must resolve exactly as it
    // always did — same values, same tiers. (The bit-identical guardrail is
    // parser_eval / parser_eval_vision; this is the in-tree spot check.)
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        cand(FieldId::List3, "04/15/1990", FieldSource::StrictTextPool),
        cand(FieldId::List4d, "J415-2208-5573-28",
             FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "GARCIA");
    EXPECT_EQ(sval(r->dateOfBirth), "1990-04-15");
    EXPECT_EQ(sval(r->licenseNumber), "J415-2208-5573-28");
    EXPECT_FLOAT_EQ(conf(*r, "dateOfBirth"), 0.95f);
    EXPECT_FALSE(r->issueDate.has_value());
    EXPECT_FALSE(r->expirationDate.has_value());
}

// ─── date assignment: the {DOB, ISS, EXP} ordering rule ────────────────────

TEST(ExternalCandidates, ThreeDistinctDates_FillByOrderingRule) {
    // Deduped set is exactly three distinct dates → DOB = oldest,
    // EXP = latest (EXP > ISS by sort order), ISS = the remaining one.
    // Deliberately fed unsorted.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::DetectedDate, "2030-08-01"),
        dd(FieldId::DetectedDate, "1990-04-15"),
        dd(FieldId::DetectedDate, "2022-08-01"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1990-04-15");
    EXPECT_EQ(sval(r->issueDate), "2022-08-01");
    EXPECT_EQ(sval(r->expirationDate), "2030-08-01");
    // Single-source fills enter at ShapeMatched (0.85).
    EXPECT_FLOAT_EQ(conf(*r, "dateOfBirth"), 0.85f);
    EXPECT_FLOAT_EQ(conf(*r, "issueDate"), 0.85f);
    EXPECT_FLOAT_EQ(conf(*r, "expirationDate"), 0.85f);
}

TEST(ExternalCandidates, TwoDistinctDates_SkippedAsAmbiguous) {
    // The CA-style miss: DOB renders fused so DataDetector only finds
    // ISS + EXP. No way to know which two of three slots — skip all.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::DetectedDate, "2022-08-01"),
        dd(FieldId::DetectedDate, "2030-08-01"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->dateOfBirth.has_value());
    EXPECT_FALSE(r->issueDate.has_value());
    EXPECT_FALSE(r->expirationDate.has_value());
    EXPECT_FLOAT_EQ(conf(*r, "dateOfBirth"), -1.0f);
}

TEST(ExternalCandidates, FourDistinctDates_SkippedAsAmbiguous) {
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::DetectedDate, "1990-04-15"),
        dd(FieldId::DetectedDate, "2022-08-01"),
        dd(FieldId::DetectedDate, "2030-08-01"),
        dd(FieldId::DetectedDate, "2015-01-02"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->dateOfBirth.has_value());
    EXPECT_FALSE(r->issueDate.has_value());
    EXPECT_FALSE(r->expirationDate.has_value());
}

TEST(ExternalCandidates, DuplicateDates_DedupeToThree_Assigned) {
    // The same date reported under both the doc container and the owning
    // paragraph (the spike's observed duplication) dedupes back to three.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::DetectedDate, "1990-04-15"),
        dd(FieldId::DetectedDate, "1990-04-15"),
        dd(FieldId::DetectedDate, "2022-08-01"),
        dd(FieldId::DetectedDate, "2030-08-01"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1990-04-15");
    EXPECT_EQ(sval(r->issueDate), "2022-08-01");
    EXPECT_EQ(sval(r->expirationDate), "2030-08-01");
}

TEST(ExternalCandidates, UnparseableDateDropped_RemainderStillAssigns) {
    // Garbage never participates; the surviving three distinct dates
    // still satisfy the exactly-three rule.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::DetectedDate, "NOT-A-DATE"),
        dd(FieldId::DetectedDate, "1990-04-15"),
        dd(FieldId::DetectedDate, "2022-08-01"),
        dd(FieldId::DetectedDate, "2030-08-01"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1990-04-15");
    EXPECT_EQ(sval(r->issueDate), "2022-08-01");
    EXPECT_EQ(sval(r->expirationDate), "2030-08-01");
}

// ─── agreement upgrade → CrossValidated ────────────────────────────────────

TEST(ExternalCandidates, DateAgreement_UpgradesToCrossValidated) {
    // Strict parse already populated all three dates (AllGatesPassed,
    // 0.95). DataDetector independently finds the SAME three → each
    // upgrades to CrossValidated (1.00); values untouched.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        cand(FieldId::List3, "04/15/1990", FieldSource::StrictTextPool),
        cand(FieldId::List4a, "08/01/2022", FieldSource::StrictTextPool),
        cand(FieldId::List4b, "08/01/2030", FieldSource::StrictTextPool),
        dd(FieldId::DetectedDate, "1990-04-15"),
        dd(FieldId::DetectedDate, "2022-08-01"),
        dd(FieldId::DetectedDate, "2030-08-01"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1990-04-15");
    EXPECT_EQ(sval(r->issueDate), "2022-08-01");
    EXPECT_EQ(sval(r->expirationDate), "2030-08-01");
    EXPECT_FLOAT_EQ(conf(*r, "dateOfBirth"), 1.0f);
    EXPECT_FLOAT_EQ(conf(*r, "issueDate"), 1.0f);
    EXPECT_FLOAT_EQ(conf(*r, "expirationDate"), 1.0f);
}

TEST(ExternalCandidates, DateDisagreement_NoOp) {
    // Strict DOB populated; DataDetector's oldest date DISAGREES. The
    // deterministic parse stays authoritative: value AND confidence are
    // untouched (no overwrite, no upgrade, no downgrade). The agreeing
    // ISS/EXP slots still upgrade independently.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        cand(FieldId::List3, "04/15/1990", FieldSource::StrictTextPool),
        dd(FieldId::DetectedDate, "1991-05-16"),
        dd(FieldId::DetectedDate, "2022-08-01"),
        dd(FieldId::DetectedDate, "2030-08-01"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1990-04-15");
    EXPECT_FLOAT_EQ(conf(*r, "dateOfBirth"), 0.95f);
    // Empty ISS/EXP slots still fill from the assigned set.
    EXPECT_EQ(sval(r->issueDate), "2022-08-01");
    EXPECT_EQ(sval(r->expirationDate), "2030-08-01");
    EXPECT_FLOAT_EQ(conf(*r, "issueDate"), 0.85f);
}

// ─── address: pre-split sub-fields ─────────────────────────────────────────

TEST(ExternalCandidates, FullAddress_FillsAllSubfields) {
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::List8f, "742 EVERGREEN TER"),
        dd(FieldId::City, "SPRINGFIELD"),
        dd(FieldId::State, "WI"),
        dd(FieldId::PostalCode, "53703"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->street), "742 EVERGREEN TER");
    EXPECT_EQ(sval(r->city), "SPRINGFIELD");
    EXPECT_EQ(sval(r->state), "WI");
    EXPECT_EQ(sval(r->postalCode), "53703");
    EXPECT_FLOAT_EQ(conf(*r, "street"), 0.85f);
    EXPECT_FLOAT_EQ(conf(*r, "city"), 0.85f);
    EXPECT_FLOAT_EQ(conf(*r, "state"), 0.85f);
    EXPECT_FLOAT_EQ(conf(*r, "postalCode"), 0.85f);
}

TEST(ExternalCandidates, PartialAddress_FillsOnlySubfieldsPresent) {
    // .postalAddress payloads are frequently partial — fill exactly what
    // arrived, never fabricate the rest.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::City, "SPRINGFIELD"),
        dd(FieldId::State, "WI"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city), "SPRINGFIELD");
    EXPECT_EQ(sval(r->state), "WI");
    EXPECT_FALSE(r->postalCode.has_value());
    EXPECT_FALSE(r->street.has_value());
}

TEST(ExternalCandidates, AddressAgreement_UpgradesToCrossValidated) {
    // The strict CSZ scanner populated city at ShapeMatched (0.85);
    // DataDetector's pre-split city agrees (case-insensitively) →
    // CrossValidated. The populated spelling wins, not the DD casing.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        cand(FieldId::List8s, "SPRINGFIELD, WI 53703",
             FieldSource::StrictTextPool),
        dd(FieldId::City, "Springfield"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city), "SPRINGFIELD");
    EXPECT_FLOAT_EQ(conf(*r, "city"), 1.0f);
}

TEST(ExternalCandidates, AddressDisagreement_NoOp) {
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        cand(FieldId::List8s, "MADISON, WI 53703",
             FieldSource::StrictTextPool),
        dd(FieldId::City, "SPRINGFIELD"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city), "MADISON");
    EXPECT_FLOAT_EQ(conf(*r, "city"), 0.85f);
}

TEST(ExternalCandidates, AmbiguousSubfield_TwoDistinctCities_Skipped) {
    // Two DISTINCT postal-address matches with different cities — no way
    // to know which belongs to the cardholder block. Skip the sub-field.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::City, "SPRINGFIELD"),
        dd(FieldId::City, "MADISON"),
        dd(FieldId::State, "WI"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->city.has_value());
    // The unambiguous sub-field still fills.
    EXPECT_EQ(sval(r->state), "WI");
}

TEST(ExternalCandidates, StateFullName_CanonicalizedViaLookup) {
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::State, "Wisconsin"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->state), "WI");
}

TEST(ExternalCandidates, InvalidShapes_AllRejected) {
    // Each sub-field is independently format-gated; none of these fill.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::List8f, "EVERGREEN TERRACE"),  // no leading number/PO BOX
        dd(FieldId::City, "SPR1NGFIELD"),          // digit in city
        dd(FieldId::State, "ZZ"),                  // unknown state code
        dd(FieldId::PostalCode, "1234"),           // not a ZIP shape
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->street.has_value());
    EXPECT_FALSE(r->city.has_value());
    EXPECT_FALSE(r->state.has_value());
    EXPECT_FALSE(r->postalCode.has_value());
}

// ─── fail-closed plumbing ──────────────────────────────────────────────────

TEST(ExternalCandidates, UnsupportedExternalId_Ignored) {
    // DataDetector candidates participate ONLY via the date set and the
    // four address sub-fields. A DataDetector candidate aimed at any other
    // field (e.g. the licence number) is ignored — it must not reach the
    // FieldsMap where a bare-key write could shadow a bbox value.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::List4d, "J415-2208-5573-28"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->licenseNumber.has_value());
}

TEST(ExternalCandidates, NewIdsUnderNonDataDetectorSource_Dropped) {
    // The DataDetector-only ids have no legacy FieldsMap key; a buggy
    // caller emitting them under another source gets a silent drop, same
    // as an unknown YOLO class.
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        cand(FieldId::City, "SPRINGFIELD", FieldSource::BboxIoU),
        cand(FieldId::DetectedDate, "1990-04-15", FieldSource::Manual),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->city.has_value());
    EXPECT_FALSE(r->dateOfBirth.has_value());
}

TEST(ExternalCandidates, ExternalOnly_NeverCreatesResult) {
    // FILL-ONLY is also ENRICH-ONLY: even maximal DataDetector evidence
    // (three assignable dates + a full address) must not resurrect a
    // deterministic parse that failed its validity gate. An auxiliary
    // single-shot source can never create a scan result by itself.
    FieldCandidateVector v{
        dd(FieldId::DetectedDate, "1990-04-15"),
        dd(FieldId::DetectedDate, "2022-08-01"),
        dd(FieldId::DetectedDate, "2030-08-01"),
        dd(FieldId::List8f, "742 EVERGREEN TER"),
        dd(FieldId::City, "SPRINGFIELD"),
        dd(FieldId::State, "WI"),
        dd(FieldId::PostalCode, "53703"),
    };
    auto r = extract_fields_from_candidates(v);
    EXPECT_FALSE(r.has_value());
}

TEST(ExternalCandidates, ExternalOnly_PartialEvidence_NoResultEither) {
    FieldCandidateVector v{
        dd(FieldId::City, "SPRINGFIELD"),
        dd(FieldId::State, "WI"),
    };
    auto r = extract_fields_from_candidates(v);
    EXPECT_FALSE(r.has_value());
}

TEST(ExternalCandidates, EmptyTextDataDetector_Ignored) {
    FieldCandidateVector v{
        cand(FieldId::List1, "GARCIA", FieldSource::StrictTextPool),
        dd(FieldId::City, ""),
        dd(FieldId::City, "   "),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->city.has_value());
}
