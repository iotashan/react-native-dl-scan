#include <gtest/gtest.h>
#include "mrz/mrz_parser.hpp"

using namespace dlscan;

// =============================================================================
// All MRZ specimens below have been verified mathematically.
//
// ICAO 9303 check digit formula:
//   value: 0-9→self, A-Z→10-35, '<'→0; weights [7,3,1] cyclically; sum mod 10.
//
// TD3 (2 lines × 44 chars) field layout (0-based indices in line 2):
//   [0-8]  document number (9)  [9]  CD
//   [10-12] nationality (3)
//   [13-18] DOB YYMMDD (6)     [19] CD
//   [20]   sex (1)
//   [21-26] expiry YYMMDD (6)  [27] CD
//   [28-42] optional data (15) [43] composite CD
//   Composite covers: l2[0:10]+l2[13:20]+l2[21:28]+l2[28:43] (39 chars)
//
// TD2 (2 lines × 36 chars): same as TD3 except optional[28-34] (7), CD at [35]
//   Composite covers: l2[0:10]+l2[13:20]+l2[21:28]+l2[28:35] (31 chars)
//
// TD1 (3 lines × 30 chars):
//   L1: [0-1] doccode, [2-4] state, [5-13] docnum, [14] CD, [15-29] opt1
//   L2: [0-5] DOB, [6] CD, [7] sex, [8-13] expiry, [14] CD, [15-17] nat,
//       [18-28] opt2, [29] composite CD
//   L3: [0-29] name
//   Composite covers: L1[0:30]+L2[0:7]+L2[8:15] (44 chars)
// =============================================================================

// ---------------------------------------------------------------------------
// TD3 — Passports (2 lines × 44 chars)
//
// Specimen 1 (UTO/ERIKSSON) — computed from first principles:
//   L1: P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<   (44)
//   L2: L898902C36UTO6908061F9406236ZE184226B<<<<<<7   (44)
//       doc='L898902C3' CD=6, nat='UTO', dob='690806' CD=1,
//       sex='F', exp='940623' CD=6, opt='ZE184226B<<<<<<', compCD=7
//
// Specimen 2 (D/MUSTERMANN) — from BSI German test passport:
//   L1: P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<   (44)
//   L2: C01X00T478D<<6408125F2702283<<<<<<<<<<<<<<<4   (44)
// ---------------------------------------------------------------------------

static const char* kTD3_L1_Eriksson = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
static const char* kTD3_L2_Eriksson = "L898902C36UTO6908061F9406236ZE184226B<<<<<<7";
static const char* kTD3_L1_Mustermann = "P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<";
static const char* kTD3_L2_Mustermann = "C01X00T478D<<6408125F2702283<<<<<<<<<<<<<<<4";

TEST(MRZParserTD3, ValidPassportICAOSpecimenEriksson) {
    const std::vector<std::string> input = {kTD3_L1_Eriksson, kTD3_L2_Eriksson};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should parse ICAO TD3 specimen (ERIKSSON/UTO)";
    EXPECT_EQ(r->mrzType, MRZType::TD3);
    EXPECT_EQ(r->documentCode, "P");
    EXPECT_EQ(r->issuingState, "UTO");
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON");
    EXPECT_EQ(r->secondaryIdentifier, "ANNA MARIA");
    EXPECT_EQ(r->documentNumber, "L898902C3");
    EXPECT_EQ(r->nationality, "UTO");
    EXPECT_EQ(r->dateOfBirth, "1969-08-06");
    EXPECT_EQ(r->sex, "F");
    EXPECT_TRUE(r->checkDigitsValid) << "All check digits should pass";
}

TEST(MRZParserTD3, ValidPassportBSISpecimenMustermann) {
    const std::vector<std::string> input = {kTD3_L1_Mustermann, kTD3_L2_Mustermann};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should parse BSI TD3 specimen (MUSTERMANN/DEU)";
    EXPECT_EQ(r->mrzType, MRZType::TD3);
    EXPECT_EQ(r->documentCode, "P");
    EXPECT_EQ(r->issuingState, "D");
    EXPECT_EQ(r->primaryIdentifier, "MUSTERMANN");
    EXPECT_EQ(r->secondaryIdentifier, "ERIKA");
    EXPECT_EQ(r->documentNumber, "C01X00T47");
    EXPECT_EQ(r->dateOfBirth, "1964-08-12");
    EXPECT_EQ(r->sex, "F");
    EXPECT_TRUE(r->checkDigitsValid) << "All check digits should pass";
}

TEST(MRZParserTD3, CheckDigitDocNumberFail) {
    // Corrupt the document number check digit (pos 9): '6' → '7'
    // This also invalidates the composite CD (which covers doc+cd positions).
    std::string l2_bad = kTD3_L2_Eriksson;
    l2_bad[9] = '7';  // corrupt doc num CD from '6' to '7'
    const std::vector<std::string> input = {kTD3_L1_Eriksson, l2_bad};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should still return partial result with bad CD";
    EXPECT_EQ(r->mrzType, MRZType::TD3);
    EXPECT_FALSE(r->checkDigitsValid) << "checkDigitsValid must be false with bad doc number CD";
    EXPECT_EQ(r->documentNumber, "L898902C3") << "Document number still parsed";
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON") << "Name still parsed";
}

TEST(MRZParserTD3, InterleavedNonMRZLines) {
    // MRZ lines surrounded by non-MRZ garbage text (typical OCR output)
    const std::vector<std::string> input = {
        "REPUBLIC OF UTOPIA",
        "PASSPORT",
        kTD3_L1_Eriksson,
        kTD3_L2_Eriksson,
        "Issued by: Authority"
    };
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should detect MRZ among non-MRZ lines";
    EXPECT_EQ(r->mrzType, MRZType::TD3);
    EXPECT_TRUE(r->checkDigitsValid);
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON");
}

// ---------------------------------------------------------------------------
// TD2 — 2 lines × 36 chars (older passport-style national IDs)
//
// ICAO 9303 Part 2 published specimen:
//   L1: I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<   (36)
//   L2: D231458907UTO7408122F1204159<<<<<<<6   (36)
//       doc='D23145890' CD=7, nat='UTO', dob='740812' CD=2,
//       sex='F', exp='120415' CD=9, opt='<<<<<<<', compCD=6
// ---------------------------------------------------------------------------

TEST(MRZParserTD2, ValidNationalID) {
    const std::vector<std::string> input = {
        "I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<",
        "D231458907UTO7408122F1204159<<<<<<<6"
    };
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should parse ICAO TD2 published specimen";
    EXPECT_EQ(r->mrzType, MRZType::TD2);
    EXPECT_EQ(r->documentCode, "I");
    EXPECT_EQ(r->issuingState, "UTO");
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON");
    EXPECT_EQ(r->secondaryIdentifier, "ANNA MARIA");
    EXPECT_EQ(r->documentNumber, "D23145890");
    EXPECT_EQ(r->nationality, "UTO");
    EXPECT_EQ(r->dateOfBirth, "1974-08-12");
    EXPECT_EQ(r->sex, "F");
    EXPECT_TRUE(r->checkDigitsValid) << "All check digits should pass";
}

// ---------------------------------------------------------------------------
// TD1 — 3 lines × 30 chars (credit-card-sized IDs, residence permits)
//
// Computed specimen:
//   L1: I<UTOD231458907<<<<<<<<<<<<<<<  (30)
//   L2: 7408122F1204159UTO<<<<<<<<<<<5  (30)  composite CD=5
//   L3: ERIKSSON<<ANNA<MARIA<<<<<<<<<<  (30)
// ---------------------------------------------------------------------------

static const char* kTD1_L1 = "I<UTOD231458907<<<<<<<<<<<<<<<";
static const char* kTD1_L2 = "7408122F1204159UTO<<<<<<<<<<<5";
static const char* kTD1_L3 = "ERIKSSON<<ANNA<MARIA<<<<<<<<<<";

TEST(MRZParserTD1, ValidThreeLineID) {
    const std::vector<std::string> input = {kTD1_L1, kTD1_L2, kTD1_L3};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should parse TD1 specimen";
    EXPECT_EQ(r->mrzType, MRZType::TD1);
    EXPECT_EQ(r->documentCode, "I");
    EXPECT_EQ(r->issuingState, "UTO");
    EXPECT_EQ(r->documentNumber, "D23145890");
    EXPECT_EQ(r->dateOfBirth, "1974-08-12");
    EXPECT_EQ(r->sex, "F");
    EXPECT_EQ(r->nationality, "UTO");
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON");
    EXPECT_EQ(r->secondaryIdentifier, "ANNA MARIA");
    EXPECT_TRUE(r->checkDigitsValid) << "All check digits should pass";
}

TEST(MRZParserTD1, BadCompositeCheckDigit) {
    // Corrupt composite CD (L2[29]): '5' → '0'
    std::string l2_bad = kTD1_L2;
    l2_bad[29] = '0';
    const std::vector<std::string> input = {kTD1_L1, l2_bad, kTD1_L3};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should still return partial result";
    EXPECT_EQ(r->mrzType, MRZType::TD1);
    EXPECT_FALSE(r->checkDigitsValid) << "Must detect bad composite check digit";
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON") << "Name still parsed";
}

// =============================================================================
// Non-MRZ / edge cases
// =============================================================================

TEST(MRZParserEdgeCases, EmptyInput) {
    auto r = parse_mrz({});
    EXPECT_FALSE(r.has_value()) << "Empty input must return nullopt";
}

TEST(MRZParserEdgeCases, NonMRZText) {
    const std::vector<std::string> input = {
        "California Driver License",
        "JOHN DOE",
        "1234 Main Street",
        "DOB: 01/15/1985",
        "EXP: 06/30/2029",
    };
    auto r = parse_mrz(input);
    EXPECT_FALSE(r.has_value()) << "Driver license OCR text must not match MRZ";
}

TEST(MRZParserEdgeCases, WrongLengthLines) {
    // Lines that are 43 chars (one short of TD3's required 44)
    const std::vector<std::string> input = {
        std::string(kTD3_L1_Eriksson).substr(0, 43),
        std::string(kTD3_L2_Eriksson).substr(0, 43)
    };
    auto r = parse_mrz(input);
    EXPECT_FALSE(r.has_value()) << "43-char lines must not match TD3";
}

TEST(MRZParserEdgeCases, AllFillerLines) {
    // Lines consisting entirely of '<' fillers must be rejected
    const std::vector<std::string> input = {
        std::string(44, '<'),
        std::string(44, '<')
    };
    auto r = parse_mrz(input);
    EXPECT_FALSE(r.has_value()) << "All-filler lines must be rejected";
}

TEST(MRZParserEdgeCases, LowercaseCharsRejected) {
    // MRZ must contain only uppercase letters, digits, '<'
    std::string l1_lower = kTD3_L1_Eriksson;
    l1_lower[0] = 'p';  // lowercase 'p' instead of 'P'
    const std::vector<std::string> input = {l1_lower, kTD3_L2_Eriksson};
    auto r = parse_mrz(input);
    EXPECT_FALSE(r.has_value()) << "Lowercase MRZ characters must be rejected";
}

TEST(MRZParserEdgeCases, TwoChar28LineShouldNotMatch) {
    // A 28-char line that is otherwise MRZ-like should not produce a result
    const std::vector<std::string> input = {
        std::string(28, 'A'),
        std::string(28, 'A')
    };
    auto r = parse_mrz(input);
    EXPECT_FALSE(r.has_value()) << "28-char lines must not match any MRZ format";
}

// =============================================================================
// Date disambiguation tests
// =============================================================================

TEST(MRZDateDisambiguation, BirthYearInPast) {
    // DOB '690806' from the UTO/ERIKSSON specimen → should be 1969, not 2069
    // (69 > current_year_2d(26)+20=46 when we compute: 69 > 46 → 1969)
    const std::vector<std::string> input = {kTD3_L1_Eriksson, kTD3_L2_Eriksson};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->dateOfBirth, "1969-08-06")
        << "Birth year 69 must resolve to 1969, not 2069";
}

TEST(MRZDateDisambiguation, ExpiryYearDisambiguation) {
    // Build a TD3 where expiry is '500101' — with current year 2026, threshold=46,
    // year 50 > 46 → 1950.  (A 1950 expiry is in the past; the spec doesn't
    // distinguish past/future, just applies the math.)
    // Verify the date is parsed (non-empty) and is one of the two valid resolutions.
    //
    // Specimen: ERIKSSON but with expiry='500101' CD=3, composite recomputed
    //   L2: L898902C36UTO6908061F5001013ZE184226B<<<<<<7
    const std::vector<std::string> input = {
        kTD3_L1_Eriksson,
        "L898902C36UTO6908061F5001013ZE184226B<<<<<<7"
    };
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value()) << "Should parse even with historical expiry";
    EXPECT_FALSE(r->dateOfExpiry.empty()) << "Expiry date should not be empty";
    // Current year 2026: threshold = (26+20)%100 = 46; yy=50 > 46 → 1900+50 = 1950
    EXPECT_EQ(r->dateOfExpiry, "1950-01-01")
        << "Expiry year '50' with 2026 base should resolve to 1950";
}

// =============================================================================
// Name parsing edge cases
// =============================================================================

TEST(MRZNameParsing, SingleNameNoSecondary) {
    // Name field: "SMITH" with all-filler secondary identifier
    // L1: "P<GBR" + "SMITH" + "<<" + "<...fillers..." = 44 chars total
    // primary=SMITH, secondary=""
    std::string l1 = "P<GBRSMITH" + std::string(34, '<');  // 5+5+34=44
    const std::vector<std::string> input = {l1, kTD3_L2_Mustermann};
    ASSERT_EQ(l1.size(), 44u);
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->primaryIdentifier, "SMITH");
    EXPECT_EQ(r->secondaryIdentifier, "");
}

TEST(MRZNameParsing, MultiWordSecondaryIdentifier) {
    // "ERIKSSON<<ANNA<MARIA" → primary="ERIKSSON", secondary="ANNA MARIA"
    const std::vector<std::string> input = {kTD3_L1_Eriksson, kTD3_L2_Eriksson};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON");
    EXPECT_EQ(r->secondaryIdentifier, "ANNA MARIA");
}

TEST(MRZNameParsing, OptionalDataWithFillers) {
    // ERIKSSON L2 optional data = "ZE184226B<<<<<<" (9 real chars + 6 fillers)
    // strip_fillers should give "ZE184226B"
    const std::vector<std::string> input = {kTD3_L1_Eriksson, kTD3_L2_Eriksson};
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value());
    // Non-filler optional data should be present
    EXPECT_EQ(r->optionalData, "ZE184226B")
        << "Trailing fillers in optional data should be stripped";
}

// =============================================================================
// TD3 format preference over TD1/TD2
// =============================================================================

TEST(MRZParserPriority, TD3SelectedWhenValidMatch) {
    // Input has valid TD3 lines among other text — parser should select TD3
    const std::vector<std::string> input = {
        "SOME TEXT LINE HERE",
        kTD3_L1_Eriksson,
        kTD3_L2_Eriksson,
        "ANOTHER LINE"
    };
    auto r = parse_mrz(input);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->mrzType, MRZType::TD3) << "TD3 should be selected for passport lines";
    EXPECT_EQ(r->primaryIdentifier, "ERIKSSON");
}
