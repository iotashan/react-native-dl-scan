// Marker-anchored demographic parser regression tests.
//
// Authoritative regression for the shared C++ visible-field AAMVA parse
// (dlscan::parse_aamva_demographic_fields) that replaces the duplicated
// Swift / Kotlin parseAamvaDemographicFields orchestration. The headline
// case replays the EXACT VisionKit whole-card OCR observations captured
// from a real Wisconsin driver license on-device (see
// /Users/shan/nanodet-rescue/ground-truth/scan_iter1_card.jpg), which the
// previous per-platform parse mis-read as firstName=DELGADO,
// licenseNumber=null, sex=null.
//
// The three device-observed defects this pins:
//   1. licence number (marker 4d) — marker "4d" and value
//      "J415-2208-5573-28" arrive as SEPARATE OCR observations; the parse
//      must one-step look-ahead to link them.
//   2. sex (marker 15) — fused multi-marker row
//      "15 SEX M 18 HOT 5 - 04 17 WOT 160 0"; the parse must pull the lone
//      [MFX] out.
//   3. firstName (marker 2) — "MARCUS ANTOINE ON PA"; the trailing OCR
//      endorsement-line junk ("ON PA") must be stripped, the strict
//      marker-anchored candidate must win over a per-region bbox candidate,
//      and the resolver must split into firstName=MARCUS / middleName=ANTOINE.

#include <gtest/gtest.h>

#include "ocr/ocr_field_extractor.hpp"

#include <optional>
#include <string>
#include <vector>

using namespace dlscan;

namespace {

std::string sval(const std::optional<std::string>& opt) {
    return opt.has_value() ? opt.value() : std::string("<null>");
}

// The exact VisionKit whole-card OCR observations (reading order) from the
// real WI DL scan. Markers and values arrive on separate lines exactly as
// the device produced them.
const std::vector<std::string>& wi_real_observations() {
    static const std::vector<std::string> obs = {
        "DRIVER LICENSE",
        "REGULAR",
        "WISCONSIN",
        "4d",
        "J415-2208-5573-28",
        "9 QLASS",
        "1 DELGADO",
        "2 MARCUS ANTOINE ON PA",
        "8 4827 LAKERIDGE DR",
        "FAIRBROOK, WI 54016",
        "15 SEX M 18 HOT 5 - 04 17 WOT 160 0",
        "18 EYES BRO 19 HAIRBLK",
        "3 DOB 03/27/1976",
        "05/15/2024",
        "S DD OT10D2024051528840173 4b EXP 03/27/2034",
    };
    return obs;
}

// Find the StrictTextPool candidate text for a FieldId, or "" if none.
std::string strict_text(const std::vector<FieldCandidate>& cands, FieldId id) {
    for (const auto& c : cands) {
        if (c.id == id && c.source == FieldSource::StrictTextPool) return c.text;
    }
    return "";
}

}  // namespace

// ---------------------------------------------------------------------------
// Headline end-to-end: real WI observations -> strict parse -> resolver.
// ---------------------------------------------------------------------------

TEST(AamvaDemographic, RealWisconsinScanFullParse) {
    auto strict = parse_aamva_demographic_fields(wi_real_observations());

    // The three previously-broken fields must now appear as strict
    // marker-anchored candidates.
    EXPECT_EQ(strict_text(strict, FieldId::List4d), "J415-2208-5573-28")
        << "marker-4d look-ahead must link the separate value observation";
    EXPECT_EQ(strict_text(strict, FieldId::List15), "M")
        << "fused-row marker-15 must extract the lone sex letter";
    EXPECT_EQ(strict_text(strict, FieldId::List2), "MARCUS ANTOINE")
        << "marker-2 must strip the trailing 'ON PA' endorsement junk";

    // Run the strict candidates through the shared resolver and assert the
    // final parsed LicenseData matches ground truth.
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());

    EXPECT_EQ(sval(ld->lastName), "DELGADO");
    EXPECT_EQ(sval(ld->firstName), "MARCUS");
    EXPECT_EQ(sval(ld->middleName), "ANTOINE");
    EXPECT_EQ(sval(ld->licenseNumber), "J415-2208-5573-28");
    EXPECT_EQ(sval(ld->sex), "M");
    EXPECT_EQ(sval(ld->dateOfBirth), "1976-03-27");
}

// ---------------------------------------------------------------------------
// The architecture defense for #3: a strict (marker-anchored) given-name
// candidate must WIN over a bbox-IoU candidate that OCR'd the surname into
// the first-name region. This reproduces the live failure mode where the
// per-region bbox outvoted the marker parse and firstName came back DELGADO.
// ---------------------------------------------------------------------------

TEST(AamvaDemographic, StrictNameWinsOverBboxForFirstName) {
    auto strict = parse_aamva_demographic_fields(wi_real_observations());

    // Simulate the device: a per-region bbox candidate that mis-OCR'd the
    // surname into the given-name (List2) slot, alongside the strict pool.
    std::vector<FieldCandidate> mixed = strict;
    FieldCandidate bbox_wrong;
    bbox_wrong.id = FieldId::List2;
    bbox_wrong.source = FieldSource::BboxIoU;
    bbox_wrong.text = "DELGADO";  // wrong: surname landed in the first-name bbox
    bbox_wrong.iou = 0.42f;
    mixed.push_back(bbox_wrong);

    FieldCandidate bbox_last;
    bbox_last.id = FieldId::List1;
    bbox_last.source = FieldSource::BboxIoU;
    bbox_last.text = "MARCUS";  // wrong: given name landed in surname bbox
    mixed.push_back(bbox_last);

    auto ld = extract_fields_from_candidates(mixed);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->firstName), "MARCUS")
        << "strict marker-2 candidate must outrank the bbox first-name crop";
    EXPECT_EQ(sval(ld->lastName), "DELGADO")
        << "strict marker-1 candidate must outrank the bbox surname crop";
}

// ---------------------------------------------------------------------------
// Focused unit: look-ahead linkage. A bare marker followed by its value on
// the next observation links; a marker followed by a DIFFERENT marker does
// NOT borrow that marker's value.
// ---------------------------------------------------------------------------

TEST(AamvaDemographic, LookAheadLinksSeparateValueObservation) {
    std::vector<std::string> obs = {"4d", "J415-2208-5573-28"};
    auto strict = parse_aamva_demographic_fields(obs);
    EXPECT_EQ(strict_text(strict, FieldId::List4d), "J415-2208-5573-28");
}

TEST(AamvaDemographic, LookAheadDoesNotBorrowAcrossAnotherMarker) {
    // "4d" then "1 DELGADO": the next observation carries its own AAMVA token,
    // so 4d must NOT adopt it. No licence candidate; lastName still parses.
    std::vector<std::string> obs = {"4d", "1 DELGADO"};
    auto strict = parse_aamva_demographic_fields(obs);
    EXPECT_EQ(strict_text(strict, FieldId::List4d), "");
    EXPECT_EQ(strict_text(strict, FieldId::List1), "DELGADO");
}

// ---------------------------------------------------------------------------
// Focused unit: fused-row sex extraction in isolation.
//
// The real WI row "15 SEX M 18 HOT ..." is already split by the lexer's
// value-boundary scan: index 18 (followed by the HGT-alias "HOT") closes the
// 15-value at "M", so the lexer alone yields a clean sex. We keep that case as
// a real-scan regression, but it does NOT exercise extract_field_shape("15")
// because the lexer pre-isolated "M".
// ---------------------------------------------------------------------------

TEST(AamvaDemographic, FusedRowSexExtraction) {
    std::vector<std::string> obs = {"15 SEX M 18 HOT 5 - 04 17 WOT 160 0"};
    auto strict = parse_aamva_demographic_fields(obs);
    EXPECT_EQ(strict_text(strict, FieldId::List15), "M");
}

// extract_field_shape("15") is load-bearing only when the lexer CANNOT close
// the 15-value at the sex letter. That happens when the trailing tokens carry
// a label with no preceding AAMVA index (the boundary scan stops only at an
// index that is followed by a known label). Here the lexer hands the extractor
// a fused "M HGT 5-04" that fails the ^[MFX]$ domain; only the shape pull
// rescues the lone "M". This case FAILS if extract_field_shape("15") is
// removed (verified by neutralization), so it pins the fix the real-scan row
// could not.
TEST(AamvaDemographic, FusedRowSexShapePullWhenLexerCannotSplit) {
    std::vector<std::string> obs = {"15 SEX M HGT 5-04"};
    auto strict = parse_aamva_demographic_fields(obs);
    EXPECT_EQ(strict_text(strict, FieldId::List15), "M")
        << "extract_field_shape must pull the lone [MFX] from a fused row the "
           "lexer left as 'M HGT 5-04'";
}

// ---------------------------------------------------------------------------
// Focused unit: marker-2 trailing-junk strip preserves the real given names.
// ---------------------------------------------------------------------------

TEST(AamvaDemographic, NameMarkerTwoStripsTrailingEndorsementJunk) {
    std::vector<std::string> obs = {"2 MARCUS ANTOINE ON PA"};
    auto strict = parse_aamva_demographic_fields(obs);
    EXPECT_EQ(strict_text(strict, FieldId::List2), "MARCUS ANTOINE");
}

TEST(AamvaDemographic, NameMarkerTwoKeepsCleanTwoTokenName) {
    // A clean "first middle" must NOT be truncated by the junk strip.
    std::vector<std::string> obs = {"2 MARIA ELENA"};
    auto strict = parse_aamva_demographic_fields(obs);
    EXPECT_EQ(strict_text(strict, FieldId::List2), "MARIA ELENA");
}

// ---------------------------------------------------------------------------
// THREE real on-device VisionKit whole-card OCR samples of the SAME Wisconsin
// DL. iOS now feeds the parser RAW whole-card observations (like Android), so
// the same fields fuse/separate differently across scans and different fields
// drop each time. The parser must yield the SAME ground-truth value for every
// REQUIRED field on all three (see /Users/shan/nanodet-rescue/ground-truth/).
//
// The parser is now PRINCIPLED, not WI-overfit: it no longer fabricates a
// vehicleClass "D" when OCR dropped the class glyph entirely, and no longer
// strips a single trailing OCR letter glued onto a middle name. Both of those
// are NON-REQUIRED fields, so their honest output legitimately varies across
// these three scans:
//   • iter1 — the class glyph "D" never appears in OCR ("9 QLASS" label-only),
//             so vehicleClass is empty (NOT a fabricated "D").
//   • iter2 — OCR glued the donor-line "O" onto the middle name
//             ("MARCUS ANTOINEO"), so middleName is "ANTOINEO" (NOT "ANTOINE").
// The shared helper asserts the full REQUIRED field set identically for all
// three; the two non-required fields (middleName, vehicleClass) are passed per
// case so each test asserts its OWN honest principled value.
// ---------------------------------------------------------------------------

namespace {

void expect_wi_ground_truth(const std::vector<std::string>& obs,
                            const std::string& expect_middle,
                            const std::string& expect_class) {
    auto strict = parse_aamva_demographic_fields(obs);
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());

    // REQUIRED fields — identical ground truth across all three scans. These
    // must never regress.
    EXPECT_EQ(sval(ld->firstName), "MARCUS");
    EXPECT_EQ(sval(ld->lastName), "DELGADO");
    EXPECT_EQ(sval(ld->licenseNumber), "J415-2208-5573-28");
    EXPECT_EQ(sval(ld->street), "4827 LAKERIDGE DR");
    EXPECT_EQ(sval(ld->city), "FAIRBROOK");
    EXPECT_EQ(sval(ld->state), "WI");
    EXPECT_EQ(sval(ld->postalCode), "54016");
    EXPECT_EQ(sval(ld->dateOfBirth), "1976-03-27");
    EXPECT_EQ(sval(ld->sex), "M");
    EXPECT_EQ(sval(ld->eyeColor), "BRO");
    EXPECT_EQ(sval(ld->hairColor), "BLK");
    EXPECT_EQ(sval(ld->endorsements), "NONE");

    // NON-REQUIRED fields — honest principled output, per-scan.
    EXPECT_EQ(sval(ld->middleName), expect_middle);
    EXPECT_EQ(sval(ld->vehicleClass), expect_class);
}

}  // namespace

TEST(AamvaDemographic, RealWisconsinRawScanIter1) {
    // "9 QLASS" is label-only and the class glyph "D" never appears anywhere in
    // this scan, so vehicleClass is honestly empty (not a fabricated "D").
    expect_wi_ground_truth({
        "DRIVER LICENSE", "REGULAR", "WISCONSIN",
        "4d", "J415-2208-5573-28",
        "9 QLASS", "1 DELGADO", "2 MARCUS ANTOINE ON PA",
        "8 4827 LAKERIDGE DR", "FAIRBROOK, WI 54016",
        "AUG", "80",
        "15 SEX M 18 HOT 5 - 04 17 WOT 160 0",
        "18 EYES BRO 19 HAIRBLK",
        "3 DOB 03/27/1976",
        "ga", "END NONE", "/L", "05/15/2024",
        "S DD OT10D2024051528840173 4b EXP 03/27/2034",
        "DONOR",
    }, /*middle=*/"ANTOINE", /*class=*/"<null>");
}

TEST(AamvaDemographic, RealWisconsinRawScanIter2) {
    // OCR glued the donor-line "O" onto the middle name ("MARCUS ANTOINEO");
    // middleName is non-required so we keep the honest "ANTOINEO" rather than a
    // corroboration-gated trailing-letter strip. A lone "D" observation IS
    // present here, so vehicleClass is the real "D".
    expect_wi_ground_truth({
        "DRIVER LICENSE", "REGULAR", "WISCONSIN",
        "48J415-2208-5573-28",
        "g CLASS", "1 DELGADO", "OND", "2 MARCUS ANTOINEO",
        "8 4827 LAKERIDGE DR", "FAIRBROOK, WI 54016",
        "D", "AUG", "80",
        "15 SEX M 16 HGT 5'-04\" |17 WGT 160 (b",
        "18 EYES BRO 19 HAIRBLK",
        "3 DOB 03/27/1976",
        "9a", "END NONE", "05/15/2024",
        "5 DO OT10D2024051528840173 4b EXP 03/27/2034",
        "DONOR",
    }, /*middle=*/"ANTOINEO", /*class=*/"D");
}

TEST(AamvaDemographic, RealWisconsinRawScanIter3) {
    // Clean "2 MARCUS ANTOINE" and a lone "D" both present — both non-required
    // fields come through as the real ground-truth values.
    expect_wi_ground_truth({
        "DRIVER LICENSE", "REGULAR", "WISCONSIN",
        "4d", "J415-2208-5573-28",
        "1 DELGADO", "2 MARCUS ANTOINE",
        "8 4827 LAKERIDGE DR", "FAIRBROOK, WI 54016",
        "9 CLASS", "D", "AUG", "80",
        "15 SEX M 16 HOT 5'-04% /17 WCT 160 (b",
        "18 EYES BRO 19 HAIRBLK",
        "INTEL'",
        "3 DOB 03/27/1976 sa END NONE",
        "05/15/2024",
        "5 DD OT10D2024051528840173 45 EXP 03/27/2034",
        "DONOR",
    }, /*middle=*/"ANTOINE", /*class=*/"D");
}

// ===========================================================================
// California — ALPHABETIC-LABEL FALLBACK regression.
//
// CA prints visible fields with ALPHABETIC labels (LN/FN/DL/DOB/EXP/ISS/SEX/
// HGT/WGT/EYES/HAIR/CLASS) instead of the numeric AAMVA markers the strict
// 4-gate lexer anchors on. Before the alphabetic fallback the numeric path
// found NO tokens on a CA card, the resolver returned a null LicenseData (no
// name / no DLN), and every field scored 0 (97.5% null in the cross-
// jurisdiction guardrail; CA OVERALL 0.0).
//
// These three sets are copied VERBATIM from the pre-generated Vision OCR
// samples in /Users/shan/nanodet-rescue/ground-truth/vision-harness/
// ocr_observations.jsonl, and the assertions are the IDNet ground truth for
// those exact samples (ocr_pairs.jsonl). They FAIL before the fallback (null
// LicenseData) and PASS after.
//
// The numeric WI cases above are the non-regression anchor: they must keep
// passing unchanged because the alphabetic path skips numeric-led rows
// (gate b) and only fills fields the numeric path left empty (gate a).
// ===========================================================================

// Sample generated.photos_v3_0033676. GT:
//   list_1=AGUILAR, list_3=04/08/1992, list_4a=07/26/2023, list_4b=07/26/2028,
//   list_4d=I6777023, list_8s=RIVERSIDE, CA 92501, list_8f=9835 UNIVERSITY AVENUE,
//   list_16=5'-03'', list_17=155 LB, list_18=BRO, list_19=BRO, list_9a=NONE.
TEST(AamvaDemographic, CaliforniaAlphabeticLabelsSample1) {
    auto strict = parse_aamva_demographic_fields({
        "California", "DRIVER LICENSE", "DL I6777023", "EXP 07/26/2028",
        "LN AGUILAR", "FABIGAIL", "9835 UNIVERSITY AVENUE",
        "RIVERSIDE, CA 92501", "DOB04/08/1992", "RSTRB", "CLASS C", "END NONE",
        "DONOR", "04081992", "Laagui", "SEX F", "HAIR BRO",
        "HGT 5-03 GT 155lb", "DD 000000000000000001024", "EYES BRO", "ISS",
        "07/26/2023",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value())
        << "alphabetic LN/DL must make a CA card non-null";

    EXPECT_EQ(sval(ld->lastName), "AGUILAR");
    EXPECT_EQ(sval(ld->licenseNumber), "I6777023");
    EXPECT_EQ(sval(ld->dateOfBirth), "1992-04-08");   // DOB04/08/1992 (glued)
    EXPECT_EQ(sval(ld->issueDate), "2023-07-26");      // bare "ISS" + next row
    EXPECT_EQ(sval(ld->expirationDate), "2028-07-26");
    EXPECT_EQ(sval(ld->sex), "F");
    EXPECT_EQ(sval(ld->eyeColor), "BRO");
    EXPECT_EQ(sval(ld->hairColor), "BRO");
    EXPECT_EQ(sval(ld->city), "RIVERSIDE");
    EXPECT_EQ(sval(ld->state), "CA");
    EXPECT_EQ(sval(ld->postalCode), "92501");
    EXPECT_EQ(sval(ld->street), "9835 UNIVERSITY AVENUE");
    // Height: "5-03" -> canonical "5'03\"" (digits 503 == GT 5'-03'' digits).
    ASSERT_TRUE(ld->height.has_value());
    EXPECT_NE(ld->height->find("5"), std::string::npos);
    EXPECT_NE(ld->height->find("03"), std::string::npos);
    // Weight: "155lb" glued onto the HGT row -> 155.
    ASSERT_TRUE(ld->weight.has_value());
    EXPECT_NE(ld->weight->find("155"), std::string::npos);
}

// Sample generated.photos_v3_0518328. GT:
//   list_2=YINGYING (FN split form), list_3=06/24/2000, list_4a=04/01/2021,
//   list_4b=04/01/2026, list_4d=I9972261, list_8f=401 PORTOLA PARKWAY,
//   list_8s=IRVINE, CA 92602, list_16=5'-02'', list_17=147 LB, list_19=BRO.
// NOTE: OCR dropped the leading "I" of the DLN ("DL 9972261"), so the strict
// DLN is "9972261" — honest, not GT's "I9972261". We assert the FN-split
// recovery, the dates, the address, and weight; the DLN is intentionally not
// asserted equal to GT (OCR-loss, non-fabrication).
TEST(AamvaDemographic, CaliforniaAlphabeticLabelsSample2) {
    auto strict = parse_aamva_demographic_fields({
        "California*", "DRIVER LICENSE", "DL 9972261", "EXP 04/01/2026",
        "LNISHIKAWA", "FN YINGYING", "401 PORTOLA PARKWAY", "IRVINE, CA 92602",
        "DOB06/24/2000", "RSTRB", "CLASS B", "END NONE", "DONOR", "06242000",
        "SEX F", "HAIR BRO", "HGT 5-02\" WGT 147 lb",
        "DD 000000000000000001513", "EYES BRO", "ISS", "04/01/2021",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());

    // "LNISHIKAWA" — LN fused onto the surname value.
    EXPECT_EQ(sval(ld->lastName), "ISHIKAWA");
    EXPECT_EQ(sval(ld->firstName), "YINGYING");   // "FN YINGYING"
    EXPECT_EQ(sval(ld->dateOfBirth), "2000-06-24");
    EXPECT_EQ(sval(ld->issueDate), "2021-04-01");
    EXPECT_EQ(sval(ld->expirationDate), "2026-04-01");
    EXPECT_EQ(sval(ld->city), "IRVINE");
    EXPECT_EQ(sval(ld->state), "CA");
    EXPECT_EQ(sval(ld->postalCode), "92602");
    EXPECT_EQ(sval(ld->street), "401 PORTOLA PARKWAY");
    ASSERT_TRUE(ld->weight.has_value());
    EXPECT_NE(ld->weight->find("147"), std::string::npos);  // "WGT 147 lb"
    EXPECT_EQ(sval(ld->hairColor), "BRO");
}

// Sample generated.photos_v3_0342681. GT:
//   list_2=DAE (FN fused "FNDAE"), list_3=02/10/2000, list_4a=04/08/2023,
//   list_4b=04/08/2028, list_4d=I2341118, list_8s=ESCONDIDO, CA 92025,
//   list_16=5'-05'', list_17=213 LB. DLN label is "DL." (trailing dot).
TEST(AamvaDemographic, CaliforniaAlphabeticLabelsSample3) {
    auto strict = parse_aamva_demographic_fields({
        "California s", "DRIVER LICENSE", "DL. I2341118", "EXP 04/08/2028",
        "LNZHENG", "FNDAE", "24 BROADWAY", "ESCONDIDO, CA 92025",
        "DOB02/10/2000", "RSTRB", "CLASS C", "END NONE", "02102000", "lezen",
        "SEX M", "HAIR BLK", "HGT 5-05 WGT 213 lb",
        "DD 000000000000000000958", "EYES BRO", "ISS", "04/08/2023",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());

    EXPECT_EQ(sval(ld->lastName), "ZHENG");       // "LNZHENG" fused
    EXPECT_EQ(sval(ld->firstName), "DAE");        // "FNDAE" fused
    EXPECT_EQ(sval(ld->licenseNumber), "I2341118");  // "DL. I2341118"
    EXPECT_EQ(sval(ld->dateOfBirth), "2000-02-10");
    EXPECT_EQ(sval(ld->issueDate), "2023-04-08");
    EXPECT_EQ(sval(ld->expirationDate), "2028-04-08");
    EXPECT_EQ(sval(ld->sex), "M");
    EXPECT_EQ(sval(ld->hairColor), "BLK");
    EXPECT_EQ(sval(ld->eyeColor), "BRO");
    EXPECT_EQ(sval(ld->city), "ESCONDIDO");
    EXPECT_EQ(sval(ld->state), "CA");
    EXPECT_EQ(sval(ld->postalCode), "92025");
    ASSERT_TRUE(ld->weight.has_value());
    EXPECT_NE(ld->weight->find("213"), std::string::npos);
}

// ---------------------------------------------------------------------------
// Bare-number / space-grouped / alpha-prefixed list_4d recovery + the
// year-collision guard. Each test below replays a VERBATIM macOS-Vision OCR
// observation array (the SAME engine the iOS scanner runs) captured by
// model-training/idnet's run_ocr.py for a real IDNet sample, asserting the
// HONEST licenseNumber — the value the OCR actually produced, never a
// fabricated/dropped character. GT (idnet-data/ocr_pairs.jsonl, field_id
// list_4d) is noted per case. These pin the recovery the single-token 4d
// value-domain regex (^[A-Za-z0-9][A-Za-z0-9-]{3,31}$) rejects, plus the
// honest-empty year-gate. They fail on HEAD 608a455 (which had zero tests for
// this path) and pass on the finalized change.

// Sample us_pennsylvania_dl generated.photos_v3_0117284. GT list_4d="48 604 659"
// (the OCR'd value, space-grouped). The marker label "4dDLN:" and the value
// "48 604 659" land on SEPARATE OCR observations; the 4d look-ahead must adopt
// the next row and collapse the internal spaces -> "48604659" (== GT digits).
TEST(AamvaDemographic, PennsylvaniaSpaceGroupedLicenseLookAhead) {
    auto strict = parse_aamva_demographic_fields({
        "Реникуванія", "visitPA.com", "4dDLN:", "48 604 659",
        "3 дов: 03/30/1994", "+ WILLIAMS", "2 JOSE", "8 83 FRUIT AVENUE",
        "SHARON, PA 16146", "4bEXP: 07/23/2026", "4aISS: 07/23/2021",
        "15 SEX: M 18 EYES: BRO", "16 HGT: 5'-04\"", "9 CLASS: A",
        "9a END: NONE", "12 RESTR: B", "faill", "5 DD:0000000002173",
        "000000002173", "DRIVER'S LICENSE", "DUPS: 00", "DL",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    // "4dDLN:" + next-row "48 604 659" -> spaces collapsed, no fabrication.
    EXPECT_EQ(sval(ld->licenseNumber), "48604659");
}

// Sample us_nevada_dl generated.photos_v3_0687895. GT list_4d="3364620541".
// The "4d ID NO." label and the bare 10-digit run "3364620541" arrive on
// SEPARATE observations; the 4d look-ahead adopts the digit run verbatim.
TEST(AamvaDemographic, NevadaBareDigitRunLookAhead) {
    auto strict = parse_aamva_demographic_fields({
        "NEVADA", "IDENTIFICATION CARD", "4d ID NO.", "3364620541",
        "3 DOB 12/01/2001", "1 ABE", "2 WEI", "84909 THISTLE STREET",
        "MESQUITE, NV 89027", "4a ISS", "07/31/2022", "4b EXP", "07/31/2027",
        "15 SEX M", "Inak", "16 HGT 5'-09\"", "17 WGT 213lb", "12/01/01",
        "18 EYES BRO", "~ 19 HAIR BRO", "5DD 000000000000000004219",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->licenseNumber), "3364620541");  // verbatim bare run
}

// Sample us_dc_dl generated.photos_v3_0556838. GT list_4d="8138430".
// DC prints "4d.DLN" as its own observation with the bare 7-digit run on the
// next row; the 4d look-ahead links them.
TEST(AamvaDemographic, DcBareDigitRunLookAhead) {
    auto strict = parse_aamva_demographic_fields({
        "WASHINGTON, DC", "DRIVER LICENSE", "USA", "DL", "Tonguy", "5.DD",
        "0000000005640", "4d.DLN", "8138430", "1. FAMILY NAME", "NGUYEN",
        "2.GIVEN NAMES", "ANJALI", "4b.EPX", "05/18/2028", "8.ADDRESS",
        "569 15TH STREET NW", "WASHINGTON, D.C. 20001", "15.SEX", "F",
        "9.CLASS", "16.HGT 17.WGT 18.EYES", "7-01\" 101 Ib BRO",
        "9a. ENDORSEMENTS", "NONE", "12.RESTRICTIONS", "B", "3.DOB",
        "07/23/1996", "4a.ISS", "05/18/2023", "VY DONOR",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->licenseNumber), "8138430");  // verbatim bare run
}

// Sample us_west_virginia_dl generated.photos_v3_0941682. GT list_4d="W909785"
// (alpha-prefixed). The marker, the "DL No." label, and the value all OCR onto
// a SINGLE row "4d DL No. W909785"; the 4d same-row recovery pulls the
// alpha-prefixed run out from behind the residual label.
TEST(AamvaDemographic, WestVirginiaAlphaPrefixedSameRow) {
    auto strict = parse_aamva_demographic_fields({
        "WEST VIRGINIA USA", "DRIVER'S LICENSE",
        "GOVERNOR: JAMES C. JUSTICE. II", "4d DL No. W909785",
        "3 DOB 01/08/2000", "1 CHUNG", "2 PENG", "8 126 16TH STREET",
        "WHEELING, WV 26003", "9 Class C", "9a End NONE", "12 Restr B",
        "15 Sex", "M", "16 Hgt 7-02\"", "18 Eyes BRO 17 Wgt 189 lb",
        "5 DD 0000000000005716", "4b Exp 12/13/2027", "4alss 12/13/2022",
        "01/08/00",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->licenseNumber), "W909785");  // alpha-prefixed, verbatim
}

// Sample us_south_dakota_dl generated.photos_v3_0176775. GT list_4d="99245585".
// SD's DLN label OCRs to a non-Latin glyph ("Рис по 99245585") that never
// lexes a "4d" marker, so the real DLN is unrecoverable here. Meanwhile the
// expiry row "46 EXP 01/23/2025" lexes as a 4d token via the pinned 46->4d
// alias; before the year-collision gate the look-ahead / shape pull surfaced
// the bare year "2025" as the licence number. The gate must REJECT that bare
// 19xx/20xx year — honest-empty over a wrong year. Asserted at the candidate
// level (List4d) because this garbled card yields no LicenseData at all, so a
// year leaking into the 4d candidate is the precise regression to pin.
TEST(AamvaDemographic, SouthDakotaYearCollisionRejected) {
    auto strict = parse_aamva_demographic_fields({
        "Sathe", "lodge", "DRIVER LICENSE", "Рис по 99245585", "Aa ISS",
        "01/23/2020", "м.", "-DOB", "04/25/1987", "46 EXP 01/23/2025", "DOE",
        "Dauaard, Governor", "BROOKLYN", "9009 BROADWAY AVENUE",
        "YANKTON, SD 57078", "9 CLASS A", "9a END NONE", "F",
        "12 RESTRICTIONS B", "16 GT 5-03\"", "17 WGT 119 Ib", "18 EVES", "GRA",
        "5 DD 0000000000000000000004109",
    });
    // No 4d candidate may be a bare 19xx/20xx year (would be "2025" pre-gate).
    std::string dln = strict_text(strict, FieldId::List4d);
    EXPECT_NE(dln, "2025");
    EXPECT_NE(dln, "2026");
    // And the year must never surface as the resolved licenceNumber.
    auto ld = extract_fields_from_candidates(strict);
    if (ld.has_value() && ld->licenseNumber.has_value()) {
        EXPECT_NE(*ld->licenseNumber, "2025");
        EXPECT_NE(*ld->licenseNumber, "2026");
    }
}

// Validity-gate regression: a card with no parseable name and an honestly-empty
// license number, but a valid DOB + address, must still return a result (a
// useful PARTIAL parse) rather than being discarded. This is the gate fix that
// recovered South Dakota's null cliff (80% -> 0%); the gate is the last step,
// so loosening it only surfaces already-computed fields, never changes a value.
TEST(AamvaDemographic, PartialParseDobAddressNoNameIsValid) {
    auto strict = parse_aamva_demographic_fields({
        "DRIVER LICENSE", "3 DOB 03/27/1976", "8 123 MAIN STREET",
        "ANYTOWN, WI 54016", "15 SEX M",
    });
    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());  // not discarded despite no name / no license#
    EXPECT_EQ(sval(ld->dateOfBirth), "1976-03-27");
    EXPECT_EQ(sval(ld->state), "WI");
    EXPECT_EQ(sval(ld->postalCode), "54016");
    EXPECT_FALSE(ld->licenseNumber.has_value());  // no 4d marker in the input
}

// ===========================================================================
// LABEL-AWARE LOOK-AHEAD — Washington DC marker+LABEL-PHRASE+next-line layout.
//
// DC prints each visible field as a numeric AAMVA marker GLUED to its LABEL
// PHRASE on one OCR row, with the actual VALUE on the NEXT row:
//   "1.FAMILY NAME" -> "GARCIA"   "2.GIVEN NAMES" -> "EMMA"
//   "4d.DLN" -> "5929885"         "8.ADDRESS" -> "11 W STREET NW"
//   "4b.EPX" -> a date            "4a.ISS" -> a date
// The label phrase "FAMILY NAME" passes the index-1 name domain regex, so the
// PRE-FIX parser bound the LABEL as lastName (DC list_1/list_2 scored strict
// 0% in the cross-jurisdiction guardrail). same_row_value_is_marker_label now
// recognises the per-marker label phrase, resets the same-row value to empty,
// and the existing one-step look-ahead pulls the value from the next line.
//
// Each test below replays the VERBATIM macOS-Vision OCR observation array (the
// SAME engine the iOS scanner runs) captured by run_ocr.py for a real IDNet
// us_dc_dl sample; GT (idnet-data/ocr_pairs.jsonl) is noted per case. They FAIL
// on the pre-fix parser (firstName/lastName = ".FAMILY NAME"/".GIVEN") and PASS
// after. list_4d / list_8f already passed (4d look-ahead + street scanner) and
// are asserted here as non-regression anchors.
//
// SCOPE NOTE — the DATE fields (list_3 DOB especially) are intentionally NOT
// asserted on every sample. DC's printed dates frequently embed a substring the
// lexer reads as an AAMVA index ("04/15/1996" carries "15"=SEX, "12/09/1997"
// carries "12"=RESTRICTIONS), which blocks the DOB look-ahead via the
// "next row carries no AAMVA token" guard. That is a SEPARATE, pre-existing
// lexer quirk (DC list_3 was already only 62.5% strict on HEAD) outside this
// change's marker+label+next-line scope; these tests therefore assert dates
// only where the sample's printed date has no embedded index.
// ===========================================================================

// Sample us_dc_dl generated.photos_v3_0866308_0549105_0386198. GT: list_1=MURPHY,
// list_2=DONTE, list_4d=8559533, list_8f=9961 12TH STREET NW,
// list_4a=08/03/2020, list_4b=08/03/2025.
TEST(AamvaDemographic, DCMarkerLabelNextLineNamesSample1) {
    auto strict = parse_aamva_demographic_fields({
        "WASHINGTON, DC", "DRIVER LICENSE", "USA", "DL", "Ldmurp", "5.DD",
        "0000000001414", "4d.DLN", "8559533", "1.FAMILY NAME", "MURPHY",
        "2.GIVEN NAMES", "DONTE", "4b.EPX", "08/03/2025", "8.ADDRESS",
        "9961 12TH STREET NW", "WASHINGTON, D.C. 20001", "15.SEX", "16.HGT",
        "17.WGT 18.EYES", "M", "7-02\" 224 Ib BRO", "9.CLASS", "C",
        "9a.ENDORSEMENTS", "NONE", "12. RESTRICTIONS", "B", "3.DOB",
        "07/17/1987", "4a.ISS", "08/03/2020",
    });

    // The label-aware look-ahead must bind the NEXT-line value, not the label
    // phrase, as the strict name candidate.
    EXPECT_EQ(strict_text(strict, FieldId::List1), "MURPHY")
        << "marker-1 '1.FAMILY NAME' must bind next-line 'MURPHY', not the label";
    EXPECT_EQ(strict_text(strict, FieldId::List2), "DONTE")
        << "marker-2 '2.GIVEN NAMES' must bind next-line 'DONTE'";

    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->lastName), "MURPHY");
    EXPECT_EQ(sval(ld->firstName), "DONTE");
    EXPECT_EQ(sval(ld->licenseNumber), "8559533");  // 4d look-ahead (anchor)
    EXPECT_EQ(sval(ld->street), "9961 12TH STREET NW");  // street scanner (anchor)
    EXPECT_EQ(sval(ld->issueDate), "2020-08-03");        // 4a.ISS -> next line
    EXPECT_EQ(sval(ld->expirationDate), "2025-08-03");   // 4b.EPX -> next line
}

// Sample us_dc_dl generated.photos_v3_0721481. GT: list_1=PADILLA,
// list_2=EMILY, list_4d=3769678, list_8f=416 27TH STREET NW,
// list_4a=08/30/2020, list_4b=08/30/2025.
TEST(AamvaDemographic, DCMarkerLabelNextLineNamesSample2) {
    auto strict = parse_aamva_demographic_fields({
        "WASHINGTON, DC", "DRIVER LICENSE", "USA", "DL",
        "\xd0\xaf\xd1\x81\xd0\xba\xd0\xb8\xd0\xb1\xd1\x96",
        "5.DD", "0000000005021", "4d.DLN", "3769678", "1.FAMILY NAME",
        "PADILLA", "2.GIVEN NAMES", "EMILY", "4b.EPX", "08/30/2025",
        "8.ADDRESS", "416 27TH STREET NW", "WASHINGTON, D.C. 20001", "15.SEX",
        "F", "9.CLASS", "16.HGT 17.WGT 18.EYES", "5'-05\" 179 Ib BRO",
        "9a. ENDORSEMENTS", "NONE", "12.RESTRICTIONS", "B", "3.DOB",
        "12/09/1997", "4a.ISS", "08/30/2020",
    });
    EXPECT_EQ(strict_text(strict, FieldId::List1), "PADILLA");
    EXPECT_EQ(strict_text(strict, FieldId::List2), "EMILY");

    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->lastName), "PADILLA");
    EXPECT_EQ(sval(ld->firstName), "EMILY");
    EXPECT_EQ(sval(ld->licenseNumber), "3769678");
    EXPECT_EQ(sval(ld->street), "416 27TH STREET NW");
    EXPECT_EQ(sval(ld->issueDate), "2020-08-30");
    EXPECT_EQ(sval(ld->expirationDate), "2025-08-30");
}

// Sample us_dc_dl generated.photos_v3_0766730. GT: list_1=FUENTES, list_2=MARIA,
// list_4d=1419831, list_8f=8623 M STREET NW. This sample prints the marker with
// a SPACE after the dot ("1. FAMILY NAME") — the normalisation in
// same_row_value_is_marker_label collapses the whitespace so it still matches.
// (Its dates all embed "/16/" so they do not bind — see SCOPE NOTE above — and
// are not asserted.)
TEST(AamvaDemographic, DCMarkerLabelNextLineNamesSpacedSeparator) {
    auto strict = parse_aamva_demographic_fields({
        "WASHINGTON, DC", "DRIVER LICENSE", "USA", "DL", "mficent", "5.DD",
        "0000000005883", "4d.DLN", "1419831", "1. FAMILY NAME", "FUENTES",
        "2.GIVEN NAMES", "MARIA", "4b.EPX", "08/16/2027", "8.ADDRESS",
        "8623 M STREET NW", "WASHINGTON, D.C. 20001", "15.SEX", "F", "9.CLASS",
        "A", "9a. ENDORSEMENTS", "NONE", "12.RESTRICTIONS", "B",
        "16.HGT 17.WGT 18.EYES", "5'-10\" 130 lb BRO", "3.DOB", "04/15/1996",
        "4a.ISS", "08/16/2022",
    });
    EXPECT_EQ(strict_text(strict, FieldId::List1), "FUENTES")
        << "'1. FAMILY NAME' (spaced separator) must still match the label set";
    EXPECT_EQ(strict_text(strict, FieldId::List2), "MARIA");

    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->lastName), "FUENTES");
    EXPECT_EQ(sval(ld->firstName), "MARIA");
    EXPECT_EQ(sval(ld->licenseNumber), "1419831");
    EXPECT_EQ(sval(ld->street), "8623 M STREET NW");
}

// NON-REGRESSION GUARD: a REAL same-row name value (a surname that is not a
// label phrase) must still bind from its own row and must NOT be discarded by
// the label-aware reset. "1 GARCIA" / "2 EMMA" (numeric-marker states like
// WI/PA/NV print the value, not the label, in the value slot) are untouched.
TEST(AamvaDemographic, MarkerLabelResetDoesNotEatRealSameRowName) {
    auto strict = parse_aamva_demographic_fields({
        "DRIVER LICENSE", "4d J415-2208-5573-28", "1 GARCIA", "2 EMMA",
        "8 123 MAIN STREET", "ANYTOWN, WI 54016", "3 DOB 03/27/1976",
    });
    // The real same-row surname/given binds — the label set never equals a
    // genuine value, so the reset is inert here.
    EXPECT_EQ(strict_text(strict, FieldId::List1), "GARCIA");
    EXPECT_EQ(strict_text(strict, FieldId::List2), "EMMA");

    auto ld = extract_fields_from_candidates(strict);
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->lastName), "GARCIA");
    EXPECT_EQ(sval(ld->firstName), "EMMA");
    EXPECT_EQ(sval(ld->licenseNumber), "J415-2208-5573-28");
}

// ===========================================================================
// MARKER-9 LOOK-AHEAD VALUE GATE — the label-aware look-ahead ("9.CLASS" on
// one row, the value on the NEXT row) must only bind a PLAUSIBLE vehicle-class
// code, not any stray 1-3-letter token.
//
// The lexer's index-9 value domain (^[A-Z]{1,3}-?\d?$) is intentionally
// permissive so the same-row "9 CLASS DM" binds; but on the DC-style next-line
// look-ahead it let a stray following token (USA / GRA / SEX / DLN — banner
// words, other field labels) pass as vehicleClass. The cross-jurisdiction
// guardrail (parser_eval_vision) is BLIND to this — IDNet carries no vehicle-
// class ground truth — so these pins are the only regression coverage for the
// marker-9 look-ahead value domain.
//
// FAIL-BEFORE/PASS-AFTER: on a58c373 (pre-fix) every poison case below binds
// the stray token as vehicleClass (probe-confirmed: 9.CLASS->USA => "USA",
// ->GRA => "GRA", ->SEX => "SEX", ->DLN => "DLN"); the fix rejects them while
// keeping every real class code.
// ===========================================================================

// A non-class token on the line after "9.CLASS" must NOT bind as vehicleClass.
// vehicleClass is a non-required field, so an honest empty beats a wrong value.
TEST(AamvaDemographic, Marker9LookAheadRejectsNonClassToken) {
    for (const char* poison : {"SEX", "USA", "GRA", "DLN"}) {
        // DC marker+label+next-line layout, with the next line a non-class
        // token. The "9.CLASS" label resets to empty, the look-ahead engages,
        // and the class gate must reject the stray token.
        auto strict = parse_aamva_demographic_fields({
            "WASHINGTON, DC", "DRIVER LICENSE", "9.CLASS", poison,
            "9a.ENDORSEMENTS", "NONE", "3.DOB", "09/02/1987",
        });
        EXPECT_EQ(strict_text(strict, FieldId::List9), "")
            << "9.CLASS look-ahead must NOT bind non-class token '" << poison
            << "' as vehicleClass";

        auto ld = extract_fields_from_candidates(strict);
        ASSERT_TRUE(ld.has_value());
        EXPECT_FALSE(ld->vehicleClass.has_value() &&
                     ld->vehicleClass.value() == std::string(poison))
            << "resolved vehicleClass must not be the stray token '" << poison
            << "'";
    }
}

// A REAL class code on the line after "9.CLASS" must still bind via the
// look-ahead. Covers single letters and a two-letter combined class.
TEST(AamvaDemographic, Marker9LookAheadBindsRealClass) {
    for (const char* cls : {"A", "D", "DM"}) {
        auto strict = parse_aamva_demographic_fields({
            "WASHINGTON, DC", "DRIVER LICENSE", "9.CLASS", cls,
            "9a.ENDORSEMENTS", "NONE", "3.DOB", "09/02/1987",
        });
        EXPECT_EQ(strict_text(strict, FieldId::List9), cls)
            << "9.CLASS look-ahead must bind the real class code '" << cls
            << "'";

        auto ld = extract_fields_from_candidates(strict);
        ASSERT_TRUE(ld.has_value());
        EXPECT_EQ(sval(ld->vehicleClass), cls);
    }
}

// ===========================================================================
// MARKER-8 ADDRESS FAILED-SPLIT — when the list_8s "city, ST zip" line does
// NOT match parse_city_state_zip's expected shape, the resolver must leave
// city / state / postalCode EMPTY rather than dumping the whole unsplit raw
// string into city (which produced garbage like city="FAKETOWN, XX 00000").
//
// FAIL-BEFORE/PASS-AFTER: on c5fe515 (pre-fix) the failed-split branch ran
// `out.city = csz.value();`, so ld->city held the entire raw line. The fix
// removes that dump; city stays null. The well-formed case below proves the
// SUCCESSFUL-split path is untouched.
// ===========================================================================

// A list_8s line that fails the city/state/zip shape must NOT populate any of
// city / state / postalCode with the raw unsplit string.
TEST(AamvaDemographic, Marker8FailedSplitDoesNotDumpRawIntoCity) {
    // "XX" is not a real state, so lookup_state rejects it and
    // parse_city_state_zip returns false for every form — a genuine failed
    // split. Inject it directly as the strict list_8s candidate so the test
    // targets ONLY the resolver's failed-split branch.
    FieldCandidate csz;
    csz.id = FieldId::List8s;
    csz.text = "FAKETOWN, XX 00000";
    csz.source = FieldSource::StrictTextPool;

    // Add a name candidate so the validity gate passes and we get a record.
    FieldCandidate name;
    name.id = FieldId::List1;
    name.text = "DOE";
    name.source = FieldSource::StrictTextPool;

    auto ld = extract_fields_from_candidates({name, csz});
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->lastName), "DOE");
    // The raw unsplit line must NOT land in city / state / postalCode.
    EXPECT_FALSE(ld->city.has_value())
        << "failed split dumped raw line into city: " << sval(ld->city);
    EXPECT_FALSE(ld->state.has_value());
    EXPECT_FALSE(ld->postalCode.has_value());
}

// A well-formed "MADISON, WI 53703" list_8s line must still split correctly
// into city=MADISON / state=WI / postalCode=53703. Guards that the fix only
// touches the FAILED-split branch and leaves the successful path intact.
TEST(AamvaDemographic, Marker8WellFormedSplitStillParses) {
    FieldCandidate csz;
    csz.id = FieldId::List8s;
    csz.text = "MADISON, WI 53703";
    csz.source = FieldSource::StrictTextPool;

    auto ld = extract_fields_from_candidates({csz});
    ASSERT_TRUE(ld.has_value());
    EXPECT_EQ(sval(ld->city), "MADISON");
    EXPECT_EQ(sval(ld->state), "WI");
    EXPECT_EQ(sval(ld->postalCode), "53703");
}
