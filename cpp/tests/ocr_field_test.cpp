#include <gtest/gtest.h>
#include "ocr/ocr_field_extractor.hpp"
#include "yolo/field_classes.hpp"

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

using namespace dlscan;

static std::string sval(const std::optional<std::string>& opt) {
    return opt.has_value() ? opt.value() : "";
}

// Test helper: builds a vector<FieldCandidate> from the legacy
// FieldsMap-style init list. Empty values skipped (matches legacy
// FieldsMap-overload semantics). "_strict"-suffix keys map to
// FieldSource::StrictTextPool, all others to BboxIoU. Unknown class
// names silently dropped. v2 Sequence G - task #54.
static std::vector<FieldCandidate> make_candidates(
    std::initializer_list<std::pair<std::string, std::string>> fields) {
    static const std::string kStrict = "_strict";
    std::vector<FieldCandidate> out;
    out.reserve(fields.size());
    for (const auto& kv : fields) {
        if (kv.second.empty()) continue;
        std::string base = kv.first;
        FieldSource src = FieldSource::BboxIoU;
        if (base.size() > kStrict.size() &&
            base.compare(base.size() - kStrict.size(), kStrict.size(), kStrict) == 0) {
            src = FieldSource::StrictTextPool;
            base.resize(base.size() - kStrict.size());
        }
        FieldId id = yolo::class_name_to_field_id(base);
        if (id == FieldId::Unknown) continue;
        FieldCandidate c;
        c.id = id;
        c.source = src;
        c.text = kv.second;
        out.push_back(std::move(c));
    }
    return out;
}

// ============================================================================
// OCR Named Field Tests
// ============================================================================

TEST(OCRFieldExtractor, LabeledNameFields) {
    const std::vector<std::string> lines = {
        "DRIVER LICENSE",
        "LN JOHNSON",
        "FN SARAH",
        "MN ANN",
        "DL D1234567",
        "DOB 03/15/1988",
        "EXP 06/30/2027",
    };
    auto r = extract_ocr_fields(lines);
    ASSERT_TRUE(r.has_value()) << "Parses OCR text with labeled name fields";
    EXPECT_EQ(sval(r->lastName), "JOHNSON");
    EXPECT_EQ(sval(r->firstName), "SARAH");
    EXPECT_EQ(sval(r->middleName), "ANN");
    EXPECT_EQ(sval(r->licenseNumber), "D1234567");
}

// ============================================================================
// OCR Date Assignment Tests
// ============================================================================

TEST(OCRFieldExtractor, AssignsDatesEarliestToDOB) {
    const std::vector<std::string> lines = {
        "FN TESTNAME",
        "LN TESTLAST",
        "DATE 03/15/1988",
        "DATE 01/01/2020",
        "DATE 12/31/2028",
    };
    auto r = extract_ocr_fields(lines);
    ASSERT_TRUE(r.has_value());
    EXPECT_TRUE(r->dateOfBirth.has_value()) << "Assigns earliest date as DOB";
    EXPECT_TRUE(r->expirationDate.has_value()) << "Assigns latest date as expiration";
    // Earliest date: 1988-03-15
    EXPECT_EQ(sval(r->dateOfBirth), "1988-03-15");
    // Latest date: 2028-12-31
    EXPECT_EQ(sval(r->expirationDate), "2028-12-31");
}

// ============================================================================
// OCR Address Tests
// ============================================================================

TEST(OCRFieldExtractor, AddressExtraction) {
    const std::vector<std::string> lines = {
        "FN BOB",
        "LN SMITH",
        "456 OAK AVENUE",
        "Springfield, IL 62704",
    };
    auto r = extract_ocr_fields(lines);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city), "Springfield");
    EXPECT_EQ(sval(r->state), "IL");
    EXPECT_EQ(sval(r->postalCode), "62704");
    EXPECT_EQ(sval(r->street), "456 OAK AVENUE");
}

// ============================================================================
// OCR Sex Tests
// ============================================================================

TEST(OCRFieldExtractor, SexMale) {
    const std::vector<std::string> lines = {"FN TEST", "LN USER", "SEX M", "DL Z9876543"};
    auto r = extract_ocr_fields(lines);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->sex), "M");
}

// ============================================================================
// OCR Nil When Insufficient Data
// ============================================================================

TEST(OCRFieldExtractor, ReturnsNilForInsufficientData) {
    const std::vector<std::string> lines = {"RANDOM TEXT", "NO USEFUL INFO"};
    auto r = extract_ocr_fields(lines);
    EXPECT_FALSE(r.has_value()) << "Returns nullopt for insufficient data";
}

// ============================================================================
// Fix 6: License number extraction returns the captured ID, not the label
// ============================================================================

TEST(OCRFieldExtractor, LicenseNoLabelReturnsID) {
    // "LICENSE NO A123456" — the regex captures "A123456" in group 1.
    // Previously a re-scan of m[0] returned "LICENSE" (the label word).
    const std::vector<std::string> lines = {
        "LICENSE NO A123456",
        "FN JOHN",
        "LN DOE",
    };
    auto r = extract_ocr_fields(lines);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "A123456")
        << "Must return captured ID group, not the label word";
}

TEST(OCRFieldExtractor, DLPrefixLabelReturnsID) {
    // "DL D1234567" — captured group is "D1234567"
    const std::vector<std::string> lines = {
        "FN JANE",
        "LN SMITH",
        "DL D1234567",
    };
    auto r = extract_ocr_fields(lines);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "D1234567");
}

// ============================================================================
// Structured extractor (extract_fields_structured) — consumes YOLO-keyed map
// produced by Swift / Kotlin after running the field detector + IoU-matching
// OCR observations. See cpp/ocr/ocr_field_extractor.hpp for the contract.
// ============================================================================

static int sint_or_zero(const std::optional<int>& v) {
    return v.has_value() ? v.value() : 0;
}

TEST(StructuredExtractor, HappyPathAamvaUsLicense) {
    // AAMVA D-20: list_12 = restrictions, list_9a = endorsements.
    // Prior version of this test mapped list_9a → restrictions, which
    // was the bug round-6 flagged.
    const auto __cands = make_candidates({
        {"list_1",  "JOHNSON"},
        {"list_2",  "SARAH"},
        {"list_3",  "03/15/1988"},
        {"list_4a", "06/30/2023"},
        {"list_4b", "06/30/2027"},
        {"list_4d", "D1234567"},
        {"list_8f", "123 MAIN ST"},
        {"list_8s", "SPRINGFIELD, IL 62701"},
        {"list_15", "F"},
        {"list_16", "5'-06\""},
        {"list_18", "BRO"},
        {"list_9",  "D"},
        {"list_9a", "NONE"},  // endorsements
        {"list_12", "B"},     // restrictions (e.g., "B" = corrective lenses)
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value()) << "happy path AAMVA must parse";
    EXPECT_EQ(sval(r->lastName),       "JOHNSON");
    EXPECT_EQ(sval(r->firstName),      "SARAH");
    EXPECT_EQ(sval(r->dateOfBirth),    "1988-03-15");
    EXPECT_EQ(sval(r->issueDate),      "2023-06-30");
    EXPECT_EQ(sval(r->expirationDate), "2027-06-30");
    EXPECT_EQ(sval(r->licenseNumber),  "D1234567");
    EXPECT_EQ(sval(r->street),         "123 MAIN ST");
    EXPECT_EQ(sval(r->city),           "SPRINGFIELD");
    EXPECT_EQ(sval(r->state),          "IL");
    EXPECT_EQ(sval(r->postalCode),     "62701");
    EXPECT_EQ(sval(r->sex),            "F");
    EXPECT_EQ(sval(r->vehicleClass),   "D");
    EXPECT_EQ(sval(r->restrictions),   "B");
    EXPECT_EQ(sval(r->endorsements),   "NONE");
}

TEST(StructuredExtractor, List2SplitsFirstAndMiddleNames) {
    const auto __cands = make_candidates({
        {"list_1",  "DELGADO"},
        {"list_2",  "MARCUS ANTOINE"},
        {"list_4d", "J415-2208-5573-28"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName),      "DELGADO");
    EXPECT_EQ(sval(r->firstName),     "MARCUS");
    EXPECT_EQ(sval(r->middleName),    "ANTOINE");
    EXPECT_EQ(sval(r->licenseNumber), "J415-2208-5573-28");
}

TEST(StructuredExtractor, InternationalIdFields) {
    const auto __cands = make_candidates({
        {"surname",      "GARCIA"},
        {"given_name",   "MARIA"},
        {"birthday",     "1990-12-01"},  // already ISO
        {"expire_date",  "2030-11-30"},
        {"personal_num", "X9999999A"},
        {"country",      "ESP"},
        {"gender",       "F"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName),       "GARCIA");
    EXPECT_EQ(sval(r->firstName),      "MARIA");
    EXPECT_EQ(sval(r->dateOfBirth),    "1990-12-01");
    EXPECT_EQ(sval(r->expirationDate), "2030-11-30");
    EXPECT_EQ(sval(r->licenseNumber),  "X9999999A");
    EXPECT_EQ(sval(r->country),        "ESP");
    EXPECT_EQ(sval(r->sex),            "F");
}

TEST(StructuredExtractor, InternationalKeysWinOverAamvaList) {
    // When BOTH international (surname/given_name) AND AAMVA (list_1/list_2)
    // are present, the international keys take priority (more reliable).
    const auto __cands = make_candidates({
        {"surname",    "AGUILAR"},
        {"list_1",     "WRONG_LAST"},
        {"given_name", "DIEGO"},
        {"list_2",     "WRONG_FIRST"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName),  "AGUILAR");
    EXPECT_EQ(sval(r->firstName), "DIEGO");
}

TEST(StructuredExtractor, EmptyMapReturnsNullopt) {
    auto r = extract_fields_from_candidates({});
    EXPECT_FALSE(r.has_value()) << "empty map should return nullopt";
}

TEST(StructuredExtractor, OnlyLicenseNumberPasses) {
    const auto __cands = make_candidates({
        {"list_4d", "X123456"},  // 7-char core — the min-length floor
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value()) << "license number alone is enough to parse";
    EXPECT_EQ(sval(r->licenseNumber), "X123456");
}

TEST(StructuredExtractor, OnlyMiscFieldsReturnsNullopt) {
    // Has height + eye color but no name and no license number — should fail
    // the validity gate, same as the legacy extract_ocr_fields heuristic.
    const auto __cands = make_candidates({
        {"list_16", "5'-10\""},
        {"list_18", "BLU"},
    });
    auto r = extract_fields_from_candidates(__cands);
    EXPECT_FALSE(r.has_value());
}

TEST(StructuredExtractor, DateFormatMmDashDdDashYyyy) {
    const auto __cands = make_candidates({
        {"list_2", "PAT"},
        {"list_3", "03-15-1988"},  // dashes, not slashes
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1988-03-15");
}

TEST(StructuredExtractor, DateAlreadyIsoPassesThroughValidated) {
    const auto __cands = make_candidates({
        {"list_2", "PAT"},
        {"list_3", "1988-03-15"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->dateOfBirth), "1988-03-15");
}

TEST(StructuredExtractor, SexNormalizationVariants) {
    auto check = [](const std::string& input, const std::string& expected) {
        auto __cands = make_candidates({{"list_2", "PAT"}, {"list_15", input}});
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value()) << "input=" << input;
        EXPECT_EQ(sval(r->sex), expected) << "input=" << input;
    };
    check("M",      "M");
    check("male",   "M");
    check("MALE",   "M");
    check("F",      "F");
    check("Female", "F");
    check("X",      "X");
}

TEST(StructuredExtractor, UnmappedYoloKeysIgnoredSilently) {
    const auto __cands = make_candidates({
        {"list_1",   "DOE"},
        {"list_2",   "JOHN"},
        // These YOLO classes have no LicenseData mapping — must not crash.
        {"face",     "<photo>"},
        {"ghostimg", "<photo>"},
        {"list_17",  "180 LBS"},   // weight — no field
        {"list_19",  "BLK"},        // hair color — no field
        {"donor",    "Y"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->firstName), "JOHN");
    EXPECT_EQ(sval(r->lastName),  "DOE");
}

TEST(StructuredExtractor, EmptyValuesTreatedAsMissing) {
    const auto __cands = make_candidates({
        {"list_1",   "DOE"},
        {"list_2",   ""},          // empty
        {"given_name", "   "},     // whitespace-only
        {"list_3",   ""},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName),  "DOE");
    EXPECT_FALSE(r->firstName.has_value())
        << "empty/whitespace string should not populate firstName";
    EXPECT_FALSE(r->dateOfBirth.has_value());
}

TEST(StructuredExtractor, LicenseNumberInternalWhitespaceStripped) {
    const auto __cands = make_candidates({
        {"list_2",  "JOHN"},
        {"list_4d", "D 123 4567"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->licenseNumber), "D1234567");
}

TEST(StructuredExtractor, CityStateZipParsedFromList8s) {
    const auto __cands = make_candidates({
        {"list_2", "JOHN"},
        {"list_8s", "PHOENIX AZ 85001-1234"},  // no comma
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city),       "PHOENIX");
    EXPECT_EQ(sval(r->state),      "AZ");
    EXPECT_EQ(sval(r->postalCode), "85001-1234");
}

TEST(StructuredExtractor, CityStateZipPrefersList8sStrictOverBbox) {
    // Strict-first read mirrors the names path (list_1_strict over the
    // bbox class). The platform city/state/ZIP scanner emits its reading
    // as a StrictTextPool candidate (-> "list_8s_strict"); a drifted
    // bbox-IoU crop under "list_8s" must lose to it. Here the strict
    // value parses to the WI ground truth while the bbox value would
    // resolve to a different state — proving the strict key is read first.
    const auto __cands = make_candidates({
        {"list_2",         "JOHN"},
        {"list_8s",        "PHOENIX AZ 85001"},          // drifted bbox crop
        {"list_8s_strict", "FAIRBROOK WI 54016"},       // 4-gate scanner
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city),       "FAIRBROOK");
    EXPECT_EQ(sval(r->state),      "WI");
    EXPECT_EQ(sval(r->postalCode), "54016");
}

TEST(StructuredExtractor, CityStateZipFallsBackToList8sBbox) {
    // When only the bbox-IoU crop is present (no strict scanner hit),
    // the fallback path still resolves city/state/postal — the strict
    // change is additive and must not regress the bbox-only flow.
    const auto __cands = make_candidates({
        {"list_2",  "JOHN"},
        {"list_8s", "FAIRBROOK WI 54016"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city),       "FAIRBROOK");
    EXPECT_EQ(sval(r->state),      "WI");
    EXPECT_EQ(sval(r->postalCode), "54016");
}

TEST(StructuredExtractor, UnparseableList8sLeavesCityEmpty) {
    // If the city/state/zip pattern can't be parsed, NONE of city / state /
    // postalCode is populated. The previous behavior dumped the whole unsplit
    // string into city as a "best effort" — but that fabricated a wrong field
    // (city="NO STRUCTURED DATA HERE"), which is worse than an honest empty.
    const auto __cands = make_candidates({
        {"list_2",  "JOHN"},
        {"list_8s", "NO STRUCTURED DATA HERE"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->city.has_value());
    EXPECT_FALSE(r->state.has_value());
    EXPECT_FALSE(r->postalCode.has_value());
}

TEST(StructuredExtractor, StreetPrefersList8fOverList5) {
    const auto __cands = make_candidates({
        {"list_2",  "JOHN"},
        {"list_5",  "OLD ADDR"},
        {"list_8f", "123 MAIN ST"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->street), "123 MAIN ST");
}

// ============================================================================
// Phase 1 review fixes — regression tests for code review findings.
// (1) Hyphenated city silent corruption (was: SALEM, expected: WINSTON-SALEM)
// (2) Date passthrough returning garbage on unrecognized format
// (3) Surname-only validity gate
// ============================================================================

TEST(StructuredExtractor, HyphenatedCityParsedCorrectly) {
    // Pre-fix: regex_search picked up after the hyphen and reported city="SALEM".
    // Post-fix: anchored regex_match + broadened char class preserves the hyphen.
    const auto __cands = make_candidates({
        {"list_2",  "JOHN"},
        {"list_8s", "WINSTON-SALEM NC 27101"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city),       "WINSTON-SALEM");
    EXPECT_EQ(sval(r->state),      "NC");
    EXPECT_EQ(sval(r->postalCode), "27101");
}

TEST(StructuredExtractor, PeriodInCityParsedCorrectly) {
    const auto __cands = make_candidates({
        {"list_2",  "JOHN"},
        {"list_8s", "ST. PAUL MN 55101"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->city),       "ST. PAUL");
    EXPECT_EQ(sval(r->state),      "MN");
    EXPECT_EQ(sval(r->postalCode), "55101");
}

TEST(StructuredExtractor, ApostropheInCityParsedCorrectly) {
    const auto __cands = make_candidates({
        {"list_2",  "JOHN"},
        {"list_8s", "ST. JOHN'S NL A1B 2C3"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    // Task #36 added Canadian province + postal code support. ST. JOHN'S
    // (Newfoundland) now parses cleanly via the kCaCodeRe variant: city
    // keeps the apostrophe, state normalises to the canonical 2-letter
    // code "NL", postalCode preserves spacing.
    EXPECT_EQ(sval(r->city), "ST. JOHN'S");
    EXPECT_EQ(sval(r->state), "NL");
    EXPECT_EQ(sval(r->postalCode), "A1B 2C3");
}

TEST(StructuredExtractor, UnrecognizableDateReturnsNullopt) {
    // Pre-fix: passed through "NOT-A-DATE" as the dateOfBirth value.
    // Post-fix: returns nullopt so callers see absent rather than garbage.
    const auto __cands = make_candidates({
        {"list_2", "JOHN"},
        {"list_3", "NOT-A-DATE"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->dateOfBirth.has_value())
        << "unrecognized date format must surface as absent, not raw OCR";
}

TEST(StructuredExtractor, InvalidIsoDateReturnsNullopt) {
    // ISO-shaped but invalid month/day — must not pass through as a real date.
    const auto __cands = make_candidates({
        {"list_2", "JOHN"},
        {"list_3", "2024-99-99"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_FALSE(r->dateOfBirth.has_value());
}

TEST(StructuredExtractor, SurnameOnlyPassesValidityGate) {
    // International IDs frequently produce a single name field via the
    // "surname" YOLO class, with no licenseNumber detected. This must parse.
    const auto __cands = make_candidates({
        {"surname", "NAKAMURA"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value()) << "surname-only must satisfy validity gate";
    EXPECT_EQ(sval(r->lastName), "NAKAMURA");
    EXPECT_FALSE(r->firstName.has_value());
    EXPECT_FALSE(r->licenseNumber.has_value());
}

// ============================================================================
// Strict-provenance demographic confidence (task #42)
// ============================================================================

static float conf(const LicenseData& ld, const std::string& key) {
    auto it = ld.fieldConfidence.find(key);
    return it == ld.fieldConfidence.end() ? 0.0f : it->second;
}

TEST(StructuredExtractor, DemographicStrictPathStampsAllGatesPassed) {
    // The platform-layer 4-gate parser writes its outputs under a `_strict`
    // suffix. C++ must prefer the strict value AND stamp 0.95.
    const auto __cands = make_candidates({
        {"list_1",        "DOE"},
        {"list_15_strict", "M"},
        {"list_16_strict", "HGT 5'-10\""},
        {"list_17_strict", "WGT 180 lb"},
        {"list_18_strict", "EYES BRO"},
        {"list_19_strict", "HAIR BLK"},
        {"list_9_strict",  "D"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->sex),          "M");
    EXPECT_EQ(sval(r->height),       "5'-10\"");
    EXPECT_EQ(sval(r->weight),       "180 lb");
    EXPECT_EQ(sval(r->eyeColor),     "BRO");
    EXPECT_EQ(sval(r->hairColor),    "BLK");
    EXPECT_EQ(sval(r->vehicleClass), "D");
    EXPECT_FLOAT_EQ(conf(*r, "sex"),          0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "height"),       0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "weight"),       0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "eyeColor"),     0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "hairColor"),    0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "vehicleClass"), 0.95f);
}

TEST(StructuredExtractor, DemographicRegularPathTiers) {
    // No `_strict` suffix — values came from bbox-IoU match. The baseline
    // regular path uses ExtractedRaw (0.50) except:
    //   - sex normalizer accepts only M/F/X → ShapeMatched (0.85)
    //   - eye/hair color values matching the AAMVA D-20 canonical 3-letter
    //     allowlist → ShapeMatched (0.85) [task #44]
    // Non-allowlist color values like "BROWN" or "8RO" stay at 0.50.
    const auto __cands = make_candidates({
        {"list_1",  "DOE"},
        {"list_15", "M"},
        {"list_16", "HGT 5'-10\""},
        {"list_18", "BRO"},
        {"list_9",  "D"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_FLOAT_EQ(conf(*r, "sex"),          0.85f);
    EXPECT_FLOAT_EQ(conf(*r, "height"),       0.50f);
    EXPECT_FLOAT_EQ(conf(*r, "eyeColor"),     0.85f);  // task #44 — BRO in allowlist
    EXPECT_FLOAT_EQ(conf(*r, "vehicleClass"), 0.50f);
}

TEST(StructuredExtractor, ColorAllowlistOnlyUpgradesCanonicalCodes) {
    // Task #44 — allowlist tier upgrade.
    //
    // Canonical 3-letter AAMVA codes (BRO/BLU/GRY/...) earn ShapeMatched
    // (0.85). Non-allowlist values that pass the soft alpha-2 gate
    // ("BROWN", "8RO") stay at ExtractedRaw (0.50). This separates
    // verified-canonical from accepted-but-unverified for downstream
    // consumers that care about confidence.
    auto run = [](const std::string& eye, const std::string& hair) {
        return extract_fields_from_candidates(make_candidates({
            {"list_1",  "DOE"},
            {"list_18", eye},
            {"list_19", hair},
        }));
    };
    // Canonical → ShapeMatched
    {
        auto r = run("BRO", "BLK");
        ASSERT_TRUE(r.has_value());
        EXPECT_EQ(*r->eyeColor,  "BRO");
        EXPECT_EQ(*r->hairColor, "BLK");
        EXPECT_FLOAT_EQ(conf(*r, "eyeColor"),  0.85f);
        EXPECT_FLOAT_EQ(conf(*r, "hairColor"), 0.85f);
    }
    // Label-prefixed canonical (label stripped, code matches) → ShapeMatched
    {
        auto r = run("EYES BLU", "HAIR RED");
        ASSERT_TRUE(r.has_value());
        EXPECT_EQ(*r->eyeColor,  "BLU");
        EXPECT_EQ(*r->hairColor, "RED");
        EXPECT_FLOAT_EQ(conf(*r, "eyeColor"),  0.85f);
        EXPECT_FLOAT_EQ(conf(*r, "hairColor"), 0.85f);
    }
    // Non-canonical (full word, not 3-letter code) → ExtractedRaw
    {
        auto r = run("BROWN", "BLACK");
        ASSERT_TRUE(r.has_value());
        EXPECT_FLOAT_EQ(conf(*r, "eyeColor"),  0.50f);
        EXPECT_FLOAT_EQ(conf(*r, "hairColor"), 0.50f);
    }
    // round-6 OCR-digit-confusion: 8↔B is a known OCR misread on
    // small DL font, so "8RO" (→ "BRO") and "8LK" (→ "BLK") now get
    // upgraded to ShapeMatched (0.85) via the variant generator. This
    // restores HAIR/EYES recovery on the user's WI DL where MLKit
    // mis-reads B as 8 about a third of the time.
    {
        auto r = run("8RO", "8LK");
        ASSERT_TRUE(r.has_value());
        EXPECT_FLOAT_EQ(conf(*r, "eyeColor"),  0.85f);
        EXPECT_FLOAT_EQ(conf(*r, "hairColor"), 0.85f);
    }
    // True-garbage 3-char that maps to nothing in the allowlist even
    // after digit-letter substitution → ExtractedRaw (raw alpha gate).
    {
        auto r = run("ZQX", "QQX");
        ASSERT_TRUE(r.has_value());
        EXPECT_FLOAT_EQ(conf(*r, "eyeColor"),  0.50f);
        EXPECT_FLOAT_EQ(conf(*r, "hairColor"), 0.50f);
    }
}

TEST(StructuredExtractor, WeightStripsHyphenSeparator) {
    // Task #44 — WGT-/HGT-/etc. separators. Real-world OCR pattern from
    // some state templates that render the label with a trailing dash:
    // "WGT- 165 LB", "WGT-185 lb". strip_leading_label now consumes `-`
    // (and `;`) along with the existing whitespace+`:,.` separators.
    auto weight_of = [](const std::string& v) {
        auto r = extract_fields_from_candidates(
            make_candidates({{"list_1", "DOE"}, {"list_17", v}}));
        return r.has_value() ? r->weight : std::nullopt;
    };
    EXPECT_EQ(weight_of("WGT- 165 LB"), "165 LB");   // hyphen + space
    EXPECT_EQ(weight_of("WGT-185 lb"),  "185 lb");   // hyphen no space
    EXPECT_EQ(weight_of("WGT; 180 LB"), "180 LB");   // semicolon
    EXPECT_EQ(weight_of("WT-200 lb"),   "200 lb");   // shorter label
    EXPECT_EQ(weight_of("WGT 175 LB"),  "175 LB");   // baseline unchanged
}

TEST(StructuredExtractor, HeightStripsHyphenSeparator) {
    // Same separator extension applied to all label-bearing fields via
    // strip_leading_label. Smoke-check height to confirm the change is
    // truly shared, not regex-duplicated.
    auto height_of = [](const std::string& v) {
        auto r = extract_fields_from_candidates(
            make_candidates({{"list_1", "DOE"}, {"list_16", v}}));
        return r.has_value() ? r->height : std::nullopt;
    };
    EXPECT_EQ(height_of("HGT- 5'-10\""), "5'-10\"");
    EXPECT_EQ(height_of("HT;5'-08\""),   "5'-08\"");
    EXPECT_EQ(height_of("HGT 5'-09\""),  "5'-09\"");  // baseline unchanged
}

TEST(StructuredExtractor, StrictKeyWinsOverBboxKey) {
    // When BOTH `list_N_strict` and `list_N` are present (the realistic
    // case — bbox matcher and strict parser both fire), strict wins and
    // the tier is 0.95.
    const auto __cands = make_candidates({
        {"list_1",         "DOE"},
        {"list_15",        "F"},       // bbox match (wrong)
        {"list_15_strict", "M"},       // strict match (right)
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->sex), "M") << "strict key must win";
    EXPECT_FLOAT_EQ(conf(*r, "sex"), 0.95f);
}

// ============================================================================
// Free-text provenance-aware confidence (firstName/middleName/lastName/street)
//
// Free-text fields can't be content-shape-verified, but a value located by its
// authoritative AAMVA marker (the strict text-pool / "<key>_strict" path) earns
// MarkerLocated (0.88), agreement with a regular path earns AllGatesPassed
// (0.95), and an unanchored fallback crop stays ExtractedRaw (0.50). The old
// behavior stamped a bare 0.50 even for a marker-anchored name.
// ============================================================================

TEST(StructuredExtractor, FreeTextStrictMarkerStampsMarkerLocated) {
    // Names + street arriving ONLY via their strict AAMVA-marker keys
    // (list_1_strict / list_2_strict / list_8f_strict) — no regular/bbox
    // candidate present. Each must be MarkerLocated (0.88), NOT 0.50.
    const auto __cands = make_candidates({
        {"list_1_strict",  "DELGADO"},
        {"list_2_strict",  "MARCUS ANTOINE"},  // splits first + middle
        {"list_8f_strict", "4827 LAKERIDGE DR"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName),   "DELGADO");
    EXPECT_EQ(sval(r->firstName),  "MARCUS");
    EXPECT_EQ(sval(r->middleName), "ANTOINE");
    EXPECT_EQ(sval(r->street),     "4827 LAKERIDGE DR");
    EXPECT_FLOAT_EQ(conf(*r, "lastName"),   0.88f);
    EXPECT_FLOAT_EQ(conf(*r, "firstName"),  0.88f);
    EXPECT_FLOAT_EQ(conf(*r, "middleName"), 0.88f) << "middle shares the given-name marker tier";
    EXPECT_FLOAT_EQ(conf(*r, "street"),     0.88f);
}

TEST(StructuredExtractor, FreeTextUnanchoredFallbackStaysExtractedRaw) {
    // Names + street arriving ONLY via regular/bbox keys (no strict marker):
    //   - lastName via bbox list_1
    //   - firstName/middleName via international given_name key
    //   - street via bbox list_8f
    // None are anchored to their authoritative marker → ExtractedRaw (0.50).
    const auto __cands = make_candidates({
        {"list_1",     "DOE"},
        {"given_name", "JANE SUE"},
        {"list_8f",    "12 OAK ST"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName),   "DOE");
    EXPECT_EQ(sval(r->firstName),  "JANE");
    EXPECT_EQ(sval(r->middleName), "SUE");
    EXPECT_EQ(sval(r->street),     "12 OAK ST");
    EXPECT_FLOAT_EQ(conf(*r, "lastName"),   0.50f);
    EXPECT_FLOAT_EQ(conf(*r, "firstName"),  0.50f);
    EXPECT_FLOAT_EQ(conf(*r, "middleName"), 0.50f);
    EXPECT_FLOAT_EQ(conf(*r, "street"),     0.50f);
}

TEST(StructuredExtractor, FreeTextStrictAndRegularAgreeUpgradesToAllGatesPassed) {
    // The strict marker value AND a regular path converged on the same free-text
    // value → AllGatesPassed (0.95). Capped below the 1.00 CrossValidated tier:
    // for free-text the strict and regular paths can share input (Android bbox
    // reads the same whole-card OCR) and the content is unverifiable.
    const auto __cands = make_candidates({
        {"list_1",         "DELGADO"},
        {"list_1_strict",  "DELGADO"},
        {"list_2",         "MARCUS ANTOINE"},
        {"list_2_strict",  "MARCUS ANTOINE"},
        {"list_8f",        "4827 LAKERIDGE DR"},
        {"list_8f_strict", "4827 LAKERIDGE DR"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_FLOAT_EQ(conf(*r, "lastName"),   0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "firstName"),  0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "middleName"), 0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "street"),     0.95f);
}

TEST(StructuredExtractor, FreeTextStrictWinsValueButMarkerLocatedOnDisagreement) {
    // Strict marker present AND a regular candidate present but DISAGREEING:
    // read_first_field still returns the STRICT value (priority order), and the
    // provenance verdict is StrictOnly → MarkerLocated (0.88) — NOT
    // CrossValidated (the two paths didn't converge).
    const auto __cands = make_candidates({
        {"list_1",        "SMYTHE"},     // bbox crop (drifted)
        {"list_1_strict", "SMITH"},      // authoritative marker
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "SMITH") << "strict marker wins the value";
    EXPECT_FLOAT_EQ(conf(*r, "lastName"), 0.88f) << "disagreement → MarkerLocated, not CrossValidated";
}

// ============================================================================
// Shape-gating on demographic normalizers (task #27)
// ============================================================================

TEST(StructuredExtractor, HeightGateAcceptsFeetInchVariants) {
    // Any value containing a `'` (prime mark) is accepted as height-shaped.
    auto check = [](const std::string& v, const std::string& want_height) {
        auto __cands = make_candidates({{"list_1", "DOE"}, {"list_16", v}});
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value()) << "input=" << v;
        if (want_height.empty()) {
            EXPECT_FALSE(r->height.has_value()) << "input=" << v;
        } else {
            ASSERT_TRUE(r->height.has_value()) << "input=" << v;
            EXPECT_EQ(*r->height, want_height) << "input=" << v;
        }
    };
    check("5'-09''", "5'-09''");      // clean AAMVA
    check("5'_04':", "5'_04':");      // WI OCR noise (underscore + colon)
    check("S'-02\"", "S'-02\"");      // CA OCR (S for 5)
    check("HGT 5'-10\"", "5'-10\"");  // label stripped
    check("175", "175");              // cm path
    check("175 cm", "175 cm");        // cm with unit
    // Rejects: ZIP codes, garbage, weights, etc.
    check("95101", "");               // ZIP — REJECT
    check("9202", "");                // 4-digit numeric, not cm range
    check("-", "");                   // single char
    check("POW0", "");                // garbage
    check("139", "");                 // below cm range
    check("231", "");                 // above cm range
    // round-17 — digit-adjacency closes the apostrophe-name leak.
    check("O'NEIL", "");              // last-name-shaped, no digits
    check("D'ARCY", "");              // ditto
}

TEST(StructuredExtractor, WeightGateAcceptsLeadingDigitInRange) {
    auto check = [](const std::string& v, const std::string& want_weight) {
        auto __cands = make_candidates({{"list_1", "DOE"}, {"list_17", v}});
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value()) << "input=" << v;
        if (want_weight.empty()) {
            EXPECT_FALSE(r->weight.has_value()) << "input=" << v;
        } else {
            ASSERT_TRUE(r->weight.has_value()) << "input=" << v;
            EXPECT_EQ(*r->weight, want_weight) << "input=" << v;
        }
    };
    check("175 LB", "175 LB");         // clean
    check("175LBS", "175LBS");         // no separator
    check("242LB", "242LB");           // no separator
    check("221.LB", "221.LB");         // OCR noise (period)
    check("107", "107");               // just digits
    check("WGT 180 lb", "180 lb");     // label stripped
    // Rejects:
    check("17&B", "");                 // 17 < 50
    check("1234", "");                 // 4 digits, no boundary
    check("49", "");                   // below 50
    check("401", "");                  // above 400
    check("ABC", "");                  // no digits
    check("5'-10\"", "");              // height-shaped, rejected for weight
}

TEST(StructuredExtractor, EyeColorAcceptsAlpha2Plus) {
    auto check = [](const std::string& v, const std::string& want) {
        auto __cands = make_candidates({{"list_1", "DOE"}, {"list_18", v}});
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value()) << "input=" << v;
        if (want.empty()) {
            EXPECT_FALSE(r->eyeColor.has_value()) << "input=" << v;
        } else {
            ASSERT_TRUE(r->eyeColor.has_value()) << "input=" << v;
            EXPECT_EQ(*r->eyeColor, want) << "input=" << v;
        }
    };
    check("BRO", "BRO");
    check("8RO", "8RO");        // AZ OCR digit-for-letter, has 2-alpha
    check("BROWN", "BROWN");
    check("EYES BLU", "BLU");   // label stripped
    // Rejects:
    check("12345", "");         // pure digits (e.g. ZIP)
    check("8", "");
    check("B", "");             // single alpha char
    check("•", "");
}

TEST(StructuredExtractor, StrictAndBboxAgreeUpgradesToCrossValidated) {
    // When BOTH `list_N_strict` and `list_N` are present AND their trimmed
    // values match, both paths independently converged — stamp 1.00.
    // Task #43 — round-16 design.
    const auto __cands = make_candidates({
        {"list_1",         "DOE"},
        {"list_15",        "M"},
        {"list_15_strict", "M"},
        {"list_16",        "HGT 5'-10\""},
        {"list_16_strict", "HGT 5'-10\""},
        {"list_9",         "D"},
        {"list_9_strict",  "D"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_FLOAT_EQ(conf(*r, "sex"),          1.00f);
    EXPECT_FLOAT_EQ(conf(*r, "height"),       1.00f);
    EXPECT_FLOAT_EQ(conf(*r, "vehicleClass"), 1.00f);
}

TEST(StructuredExtractor, LicenseNumberShapeUpgradesToShapeMatched) {
    // Task #43 — license number that passes the `[A-Z0-9]+(?:-[A-Z0-9]+)*`
    // shape after whitespace stripping gets ShapeMatched (0.85) instead of
    // the legacy ExtractedRaw (0.50).
    {
        const auto __cands = make_candidates({
            {"list_1",  "DOE"},
            {"list_4d", "D 123 4567"},  // strips to D1234567 — pure alnum
        });
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value());
        EXPECT_EQ(sval(r->licenseNumber), "D1234567");
        EXPECT_FLOAT_EQ(conf(*r, "licenseNumber"), 0.85f);
    }
    {
        const auto __cands = make_candidates({
            {"list_1",  "DOE"},
            {"list_4d", "D440-1234-5678-99"},  // hyphenated, alnum groups
        });
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value());
        EXPECT_FLOAT_EQ(conf(*r, "licenseNumber"), 0.85f);
    }
    {
        const auto __cands = make_candidates({
            {"list_1",  "DOE"},
            {"list_4d", "D12$34567"},  // contains $ — fails shape
        });
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value());
        EXPECT_FLOAT_EQ(conf(*r, "licenseNumber"), 0.50f);
    }
    {
        // round-18 — lowercase OCR is canonicalised to uppercase
        // before storage, so the shape match fires and we get 0.85.
        const auto __cands = make_candidates({
            {"list_1",  "DOE"},
            {"list_4d", "d1234567"},
        });
        auto r = extract_fields_from_candidates(__cands);
        ASSERT_TRUE(r.has_value());
        EXPECT_EQ(sval(r->licenseNumber), "D1234567") << "must canonicalise to uppercase";
        EXPECT_FLOAT_EQ(conf(*r, "licenseNumber"), 0.85f);
    }
}

TEST(StructuredExtractor, EmptyStrictValueFallsBackToBbox) {
    // If the strict key is present but empty, fall back to the bare key
    // and tier accordingly. Guards against the platform layer accidentally
    // emitting empty strict entries.
    const auto __cands = make_candidates({
        {"list_1",         "DOE"},
        {"list_15",        "F"},
        {"list_15_strict", "  "},      // empty after trim
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->sex), "F");
    EXPECT_FLOAT_EQ(conf(*r, "sex"), 0.85f) << "empty strict must fall through to ShapeMatched";
}

// ============================================================================
// v2 candidate-evidence path tests. The shim-parity test
// (StructuredExtractorCandidates.BboxOnlyMatchesLegacy) was deleted in
// Sequence G commit 4 along with the FieldsMap public surface — no
// reachable code can still call extract_fields_structured(FieldsMap).
// ============================================================================

TEST(StructuredExtractorCandidates, StrictTextPoolEmitsStrictKey) {
    // StrictTextPool source must route through "<key>_strict" so the
    // existing read_strict_or_regular logic stamps AllGatesPassed (0.95).
    const std::vector<FieldCandidate> candidates = {
        {FieldId::List1,  "DOE",     FieldSource::BboxIoU,        {}, {}, {}, {}},
        {FieldId::List15, "M",       FieldSource::StrictTextPool, {}, {}, {}, {}},
        {FieldId::List16, "HGT 5'-10\"", FieldSource::StrictTextPool, {}, {}, {}, {}},
    };
    auto r = extract_fields_from_candidates(candidates);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->sex),    "M");
    EXPECT_EQ(sval(r->height), "5'-10\"");
    EXPECT_FLOAT_EQ(conf(*r, "sex"),    0.95f);
    EXPECT_FLOAT_EQ(conf(*r, "height"), 0.95f);
}

TEST(StructuredExtractorCandidates, StrictAndBboxAgreeUpgrades) {
    // The candidate-evidence model preserves the StrictAgrees →
    // CrossValidated (1.00) upgrade from v1.
    const std::vector<FieldCandidate> candidates = {
        {FieldId::List1,  "DOE", FieldSource::BboxIoU,        {}, {}, {}, {}},
        {FieldId::List15, "M",   FieldSource::BboxIoU,        {}, {}, {}, {}},
        {FieldId::List15, "M",   FieldSource::StrictTextPool, {}, {}, {}, {}},
    };
    auto r = extract_fields_from_candidates(candidates);
    ASSERT_TRUE(r.has_value());
    EXPECT_FLOAT_EQ(conf(*r, "sex"), 1.00f) << "Strict+bbox agreement must upgrade to CrossValidated";
}

TEST(StructuredExtractorCandidates, UnknownFieldIdSilentlyDropped) {
    // FieldId::Unknown candidates produce no key; they must not abort
    // the whole parse.
    const std::vector<FieldCandidate> candidates = {
        {FieldId::List1,   "DOE",   FieldSource::BboxIoU, {}, {}, {}, {}},
        {FieldId::Unknown, "junk",  FieldSource::BboxIoU, {}, {}, {}, {}},
    };
    auto r = extract_fields_from_candidates(candidates);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "DOE");
}

TEST(StructuredExtractorCandidates, EmptyTextSkipped) {
    // Empty text values are filtered out so they don't last-write-win
    // over a populated earlier candidate.
    const std::vector<FieldCandidate> candidates = {
        {FieldId::List1, "DOE",  FieldSource::BboxIoU, {}, {}, {}, {}},
        {FieldId::List1, "",     FieldSource::BboxIoU, {}, {}, {}, {}},  // dropped
    };
    auto r = extract_fields_from_candidates(candidates);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(sval(r->lastName), "DOE");
}

// ============================================================================
// v2 Sequence F — confidence_json wire format (task #51)
// ============================================================================

TEST(ConfidenceJson, EmitsScoreAndTierObjects) {
    // Wire format must be {field: {score: <f>, tier: "<name>"}} per review
    // round-2 lock. Consumers branch on the tier name.
    LicenseData ld;
    ld.firstName = "JOHN";
    ld.fieldConfidence["firstName"]    = 1.00f;  // cross_validated
    ld.fieldConfidence["height"]       = 0.95f;  // all_gates_passed
    ld.fieldConfidence["middleName"]   = 0.88f;  // marker_located
    ld.fieldConfidence["dateOfBirth"]  = 0.85f;  // shape_matched
    ld.fieldConfidence["lastName"]     = 0.50f;  // extracted_raw
    auto json = confidence_json(ld);
    EXPECT_NE(json.find("\"firstName\":{\"score\":1,\"tier\":\"cross_validated\"}"),
              std::string::npos) << json;
    EXPECT_NE(json.find("\"tier\":\"all_gates_passed\""),
              std::string::npos) << json;
    // 0.88 must serialize to the new marker_located tier (band sits between
    // all_gates_passed 0.95 and shape_matched 0.85).
    EXPECT_NE(json.find("\"middleName\":{\"score\":0.88,\"tier\":\"marker_located\"}"),
              std::string::npos) << json;
    EXPECT_NE(json.find("\"tier\":\"shape_matched\""),
              std::string::npos) << json;
    EXPECT_NE(json.find("\"tier\":\"extracted_raw\""),
              std::string::npos) << json;
}

// Boundary check: tier_name_for_score's >= cascade. 0.88 → marker_located,
// 0.85 stays shape_matched, 0.95 stays all_gates_passed — inserting the new
// band must not steal the adjacent tiers' exact-boundary scores.
TEST(ConfidenceJson, MarkerLocatedBandBoundaries) {
    LicenseData ld;
    ld.fieldConfidence["a"] = to_score(ValidationTier::MarkerLocated);  // 0.88
    ld.fieldConfidence["b"] = to_score(ValidationTier::ShapeMatched);   // 0.85
    ld.fieldConfidence["c"] = to_score(ValidationTier::AllGatesPassed); // 0.95
    auto json = confidence_json(ld);
    EXPECT_NE(json.find("\"a\":{\"score\":0.88,\"tier\":\"marker_located\"}"),
              std::string::npos) << json;
    EXPECT_NE(json.find("\"b\":{\"score\":0.85,\"tier\":\"shape_matched\"}"),
              std::string::npos) << json;
    EXPECT_NE(json.find("\"c\":{\"score\":0.95,\"tier\":\"all_gates_passed\"}"),
              std::string::npos) << json;
}

TEST(ConfidenceJson, EmptyMapReturnsEmptyString) {
    LicenseData ld;
    EXPECT_EQ(confidence_json(ld), "");
}

TEST(StructuredExtractor, GenderJunkDoesNotPreemptList15Sex) {
    // Root-cause regression (sex never stabilized live): the gender YOLO
    // class has no tightener, so a junk consensus used to permanently
    // null sex even when the strict pool held a clean letter — the
    // list_15 fallback only ran when the gender KEY was absent. gender
    // must ENRICH, never PREEMPT.
    const auto __cands = make_candidates({
        {"list_1",         "DOE"},
        {"gender",         "15 SEX"},
        {"list_15_strict", "M"},
    });
    auto r = extract_fields_from_candidates(__cands);
    ASSERT_TRUE(r.has_value());
    ASSERT_TRUE(r->sex.has_value());
    EXPECT_EQ(sval(r->sex), "M");
    // Strict-pool provenance: AllGatesPassed, not the bbox tier.
    EXPECT_FLOAT_EQ(conf(*r, "sex"), 0.95f);
}
