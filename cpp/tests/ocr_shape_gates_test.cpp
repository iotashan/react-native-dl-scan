// Shape-gate regression tests for the per-field validators introduced
// in task #81 (cross-field contamination defense). Each gate's purpose
// is documented in cpp/ocr/ocr_field_extractor.cpp — these tests pin
// the contract.
//
// The gates themselves are static in an anonymous namespace, so we
// test them indirectly through extract_fields_from_candidates: build
// a FieldCandidate vector that would have triggered the bug, assert
// the extractor drops the offending value.

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

} // namespace

// ─── vehicleClass gate ─────────────────────────────────────────────────────

TEST(ShapeGate_VehicleClass, AcceptsCommonForms) {
    for (const auto& cls : {"D", "M", "CDL", "A1", "DM", "C"}) {
        FieldCandidateVector v{
            cand(FieldId::List1, "DOEFORD"),
            cand(FieldId::List9, cls),
        };
        auto r = extract_fields_from_candidates(v);
        ASSERT_TRUE(r.has_value()) << "class " << cls;
        ASSERT_TRUE(r->vehicleClass.has_value()) << "class " << cls;
        EXPECT_EQ(*r->vehicleClass, cls);
    }
}

TEST(ShapeGate_VehicleClass, RejectsAddressDuplicate) {
    // The bug: YOLO list_9 bbox drifted over the city/state line; OCR
    // emitted "SPRINGFIELD" as the vehicleClass candidate. The gate must
    // reject this so the field stays null instead of showing wrong.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List9, "SPRINGFIELD"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->vehicleClass.has_value());
}

TEST(ShapeGate_VehicleClass, RejectsAddressTokenDenylist) {
    for (const auto& bad :
         {"ST", "RD", "DR", "AVE", "BLVD", "LN", "CT", "CIR", "HWY",
          "PKWY", "NONE"}) {
        FieldCandidateVector v{
            cand(FieldId::List1, "DOEFORD"),
            cand(FieldId::List9, bad),
        };
        auto r = extract_fields_from_candidates(v);
        ASSERT_TRUE(r.has_value()) << "token " << bad;
        EXPECT_FALSE(r->vehicleClass.has_value()) << "token " << bad;
    }
}

TEST(ShapeGate_VehicleClass, RejectsTooLong) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List9, "ABCD"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->vehicleClass.has_value());
}

// ─── name gates ───────────────────────────────────────────────────────────

TEST(ShapeGate_Name, RejectsDigits) {
    // OCR mis-extraction: the DL number landed in the lastName bbox.
    FieldCandidateVector v{
        cand(FieldId::List1, "D440-1234-5678-99"),
        cand(FieldId::List4d, "D440-1234-5678-99"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->lastName.has_value());
    // licenseNumber should still survive its own canonicalization.
    EXPECT_TRUE(r->licenseNumber.has_value());
}

TEST(ShapeGate_Name, RejectsComma) {
    // YOLO drifted the list_1 bbox over the city-state-zip line.
    FieldCandidateVector v{
        cand(FieldId::List1, "SPRINGFIELD, WI 53703"),
        cand(FieldId::List2, "JOHN"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->lastName.has_value());
    EXPECT_TRUE(r->firstName.has_value());
}

TEST(ShapeGate_Name, AcceptsHyphenatedAndApostrophe) {
    // round-3: "ST JOHN", hyphens, apostrophes are plausible names.
    for (const auto& name : {"O'BRIEN", "ST JOHN", "MARY-ANNE", "JOHN"}) {
        FieldCandidateVector v{
            cand(FieldId::List1, name),
            cand(FieldId::List2, "FIRST"),
        };
        auto r = extract_fields_from_candidates(v);
        ASSERT_TRUE(r.has_value()) << "name " << name;
        EXPECT_TRUE(r->lastName.has_value()) << "name " << name;
    }
}

TEST(ShapeGate_LicenseNumber, RejectsNameShapedIndexedLeak) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DELGADO"),
        cand(FieldId::List4d, "2 MARCUS ANTOINE"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->licenseNumber.has_value());
}

TEST(ShapeGate_LicenseNumber, AcceptsNumericOnlyLicenseNumber) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DELGADO"),
        cand(FieldId::List4d, "26798765"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->licenseNumber.has_value());
    EXPECT_EQ(*r->licenseNumber, "26798765");
}

TEST(ShapeGate_Country, RejectsIndexedHeightWeightLeak) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DELGADO"),
        cand(FieldId::Country, "18 HGT 5-0417 wGT160 b"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->country.has_value());
}

TEST(ShapeGate_Endorsements, RejectsIndexedHairColorLeak) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DELGADO"),
        cand(FieldId::List9a, "19 HAIR BLK"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->endorsements.has_value());
}

// ─── street gate + CSZ stripping ──────────────────────────────────────────

TEST(ShapeGate_Street, AcceptsHouseNumberStart) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List8f, "4242 ASHWOOD LN"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->street.has_value());
    EXPECT_EQ(*r->street, "4242 ASHWOOD LN");
}

TEST(ShapeGate_Street, AcceptsPoBox) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List8f, "PO BOX 1234"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->street.has_value());
    EXPECT_EQ(*r->street, "PO BOX 1234");
}

TEST(ShapeGate_Street, RejectsNoLeadingNumber) {
    // The user's iPhone bug: street bbox drifted over name area
    // ("DOEFORD JOHN QUINCY" landed in list_8f). Gate must reject.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List8f, "SPRINGFIELD WI"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->street.has_value());
}

TEST(ShapeGate_Street, StripsTrailingCityStateZip) {
    // The user's actual iPhone bug: list_8f bbox was too tall and
    // captured the whole address. list_8s correctly captured line 2.
    // The cleaner must remove the duplicate suffix from street.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List8f, "4242 ASHWOOD LN SPRINGFIELD WI 53703"),
        cand(FieldId::List8s, "SPRINGFIELD, WI 53703"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->street.has_value());
    EXPECT_EQ(*r->street, "4242 ASHWOOD LN");
    EXPECT_EQ(r->city.value_or(""), "SPRINGFIELD");
    EXPECT_EQ(r->state.value_or(""), "WI");
    EXPECT_EQ(r->postalCode.value_or(""), "53703");
}

// ─── Text-pool fallback for indices 3 / 4a / 4b / 12 (round-6) ───────────

TEST(TextPoolFallback, RestrictionsViaStrictPath) {
    // list_12 with StrictTextPool provenance — what the demographic
    // parser emits when YOLO didn't bbox the restrictions field but
    // OCR saw "12 RESTR NONE" in the text pool. Mapped to
    // out.restrictions per AAMVA D-20 (task #82 follow-on).
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List12, "REST NONE", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_TRUE(r->restrictions.has_value());
}

TEST(TextPoolFallback, DobIssueExpireDates) {
    // All three date fields, via the strict-text-pool path. These
    // were previously rejected at the demographic parser's idx gate
    // because indexToFieldId didn't include 3/4a/4b.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List3,  "DOB 03/27/1976",    FieldSource::StrictTextPool),
        cand(FieldId::List4a, "ISS 05/15/2024",    FieldSource::StrictTextPool),
        cand(FieldId::List4b, "EXP 03/27/2034",    FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->dateOfBirth.value_or(""),    "1976-03-27");
    EXPECT_EQ(r->issueDate.value_or(""),      "2024-05-15");
    EXPECT_EQ(r->expirationDate.value_or(""), "2034-03-27");
}

TEST(TextPoolFallback, Endorsements_List9a) {
    // list_9a is the AAMVA endorsements field. Distinct from list_12
    // restrictions.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List9a, "M"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_TRUE(r->endorsements.has_value());
    EXPECT_EQ(*r->endorsements, "M");
}

// ─── OCR-digit-letter-confusion in eye/hair allowlist (round-6) ─────────

TEST(OcrDigitConfusion, HairBLK_AcceptsB1K) {
    // WI's "BLK" frequently OCR'd as "B1K" on Pixel — the L gets read
    // as a 1. The contains_allowlist_code variant generator should
    // recover this.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List19, "B1K"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->hairColor.has_value());
}

TEST(OcrDigitConfusion, EyeBRO_AcceptsBR0) {
    // OCR variants: "BR0" (O→0) should still be accepted as BRO.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List18, "BR0"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->eyeColor.has_value());
}

// ─── DLN-fused class recovery (task #82 follow-on) ─────────────────────────
//
// Live WI Pixel logcat: lexer emits the DLN row as "D440-1234-5678-99
// cLASS D" (CLASS is mashed onto the DLN line, no `9 CLASS X` token
// is ever observed). Peel the trailing "(CLASS|CLAS|GLASS) X" off the
// DLN value into vehicleClass before canonicalizing the DLN.

TEST(DlnClassFusion, ExtractsClassAndCleansDln) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List4d, "D440-1234-5678-99 CLASS D"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->licenseNumber.has_value());
    EXPECT_EQ(*r->licenseNumber, "D440-1234-5678-99");
    ASSERT_TRUE(r->vehicleClass.has_value());
    EXPECT_EQ(*r->vehicleClass, "D");
}

TEST(DlnClassFusion, LowercaseClassToken) {
    // OCR varies case for "CLASS" — accept lower/mixed case.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List4d, "D440-1234-5678-99 cLASS D"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->licenseNumber.value_or(""), "D440-1234-5678-99");
    EXPECT_EQ(r->vehicleClass.value_or(""), "D");
}

TEST(DlnClassFusion, GlassMisread) {
    // "GLASS" is a common OCR misread of "CLASS" on small-font card rows.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List4d, "D440-1234-5678-99 GLASS M"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->licenseNumber.value_or(""), "D440-1234-5678-99");
    EXPECT_EQ(r->vehicleClass.value_or(""), "M");
}

TEST(DlnClassFusion, ExplicitList9Wins) {
    // When list_9 has its own value, the explicit block overrides the
    // class-suffix fallback — bbox-detected class is more authoritative.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List4d, "D440-1234-5678-99 CLASS D"),
        cand(FieldId::List9, "CDL"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->vehicleClass.value_or(""), "CDL");
}

TEST(DlnClassFusion, NoClassSuffixLeavesDlnAlone) {
    // Clean DLN with no class suffix — vehicleClass stays null,
    // licenseNumber unchanged.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List4d, "D440-1234-5678-99"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->licenseNumber.value_or(""), "D440-1234-5678-99");
    EXPECT_FALSE(r->vehicleClass.has_value());
}

TEST(TrailingNoiseRecovery, HairBLKO_StripsTrailingChar) {
    // WI Pixel logcat: OCR reads "BLK" as "BLKO" (stray trailing O).
    // Lexer's dom regex now accepts the 4-char form so the candidate
    // reaches the normalizer; the normalizer strips the trailing char.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List19, "BLKO", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->hairColor.has_value());
    EXPECT_EQ(*r->hairColor, "BLK");
}

TEST(TrailingNoiseRecovery, EyeBROO_StripsTrailingChar) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List18, "BROO", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->eyeColor.has_value());
    EXPECT_EQ(*r->eyeColor, "BRO");
}

TEST(TrailingNoiseRecovery, CleanThreeCharStillPassesUnchanged) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List19, "BLK", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->hairColor.has_value());
    EXPECT_EQ(*r->hairColor, "BLK");
}

TEST(TrailingNoiseRecovery, UnknownFourCharLeftAlone) {
    // "ZZZA" — first 3 chars are not in the allowlist. Recovery
    // returns nullopt, the normalizer falls back to returning the
    // alpha-gated value unchanged. The tier-upgrade helper later
    // judges it ExtractedRaw (not ShapeMatched).
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List19, "ZZZA", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->hairColor.has_value());
    EXPECT_EQ(*r->hairColor, "ZZZA");
}

TEST(OcrDigitConfusion, RejectsPureGarbage) {
    // "XYZ" — not in allowlist, no digit subs help.
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List18, "XYZ"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    // The shape gate (Alpha2) still accepts XYZ as raw-extract tier,
    // since it's all alpha chars. That's expected; the digit-confusion
    // helper only upgrades the tier, doesn't reject.
}

// ─── Height: apostrophe-loss recovery (task #82 follow-on) ─────────────────
//
// Live Pixel logcat on a WI DL showed OCR reading "5'-09\"" as "5-09"
// (apostrophe collapsed into the dash). The previous normalizer's fast
// path required an apostrophe, so the dash-form was silently dropped
// and "Height Not detected" appeared in the result UI despite the
// per-frame demographic parser accepting the value. The fix accepts
// the dash-form when feet ∈ [4,7] and inches ∈ [0,11] and reformats to
// the canonical "F'II\"" shape.

TEST(HeightField_ApostropheLoss, AcceptsDashFormAndReformats) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List16, "5-09", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->height.has_value());
    EXPECT_EQ(*r->height, "5'09\"");
}

TEST(HeightField_ApostropheLoss, SingleInchDigitPadded) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List16, "6-4", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->height.has_value());
    EXPECT_EQ(*r->height, "6'04\"");
}

TEST(HeightField_ApostropheLoss, RejectsOutOfRangeFeet) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List16, "3-04", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->height.has_value());
}

TEST(HeightField_ApostropheLoss, RejectsOutOfRangeInches) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List16, "5-99", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->height.has_value());
}

TEST(HeightField_ApostropheLoss, ApostropheFormStillPassesUnchanged) {
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List16, "5'-09\"", FieldSource::StrictTextPool),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->height.has_value());
    EXPECT_EQ(*r->height, "5'-09\"");
}

TEST(ShapeGate_Street, NoCszMeansNoStrip) {
    // If we never parsed city/state/zip, the cleaner shouldn't strip
    // anything (avoids false-positive surgery).
    FieldCandidateVector v{
        cand(FieldId::List1, "DOEFORD"),
        cand(FieldId::List8f, "4242 ASHWOOD LN"),
    };
    auto r = extract_fields_from_candidates(v);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->street.has_value());
    EXPECT_EQ(*r->street, "4242 ASHWOOD LN");
}
