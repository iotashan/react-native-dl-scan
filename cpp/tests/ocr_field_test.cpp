#include <gtest/gtest.h>
#include "ocr/ocr_field_extractor.hpp"

using namespace dlscan;

static std::string sval(const std::optional<std::string>& opt) {
    return opt.has_value() ? opt.value() : "";
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
