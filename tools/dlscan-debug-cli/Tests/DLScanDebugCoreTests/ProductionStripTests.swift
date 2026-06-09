// XCTest parity for the Kotlin TightenersTest suite (task #68).
//
// One-to-one mirror of `android/src/test/java/com/margelo/nitro/dlscan/
// TightenersTest.kt`. Tests the Swift regex tighteners in
// ProductionStrip.swift (which is a hand-kept copy of the production
// iOS HybridDLScanIOS.swift tighteners — see header of that file).
//
// Where the two platforms have intentional behavior drift (the iOS
// stripAamvaPrefixForClass uses VisionKit-misread aliases rather than
// Android's bare-digit aliases), the tests reflect each platform's
// actual behavior — they aren't required to produce identical outputs
// for inputs that exercise platform-specific OCR-correction paths.
// The pure-regex paths (date extract, sex regex, color allowlist,
// weight/height regex, state DL patterns) ARE byte-for-byte parity.

import XCTest
@testable import DLScanDebugCore

final class ProductionStripTests: XCTestCase {

    // MARK: - Date extraction (list_3 / 4a / 4b)

    func test_extractDate_cleanDate_returnsCanonical() {
        XCTAssertEqual("08/05/2002", extractDate(from: "08/05/2002"))
    }

    func test_extractDate_ocrZeroSubstitution_canonicalizes() {
        XCTAssertEqual("08/05/2002", extractDate(from: "O8/O5/2OO2"))
    }

    func test_extractDate_ocrOneSubstitution_canonicalizes() {
        XCTAssertEqual("11/03/2011", extractDate(from: "I1/03/20l1"))
    }

    func test_extractDate_ocrSeparatorMisread_canonicalizes() {
        XCTAssertEqual("11/03/2011", extractDate(from: "11I03I2011"))
    }

    func test_extractDate_invalidMonth_returnsNil() {
        XCTAssertNil(extractDate(from: "13/03/2011"))
    }

    func test_extractDate_yearOutOfRange_returnsNil() {
        XCTAssertNil(extractDate(from: "01/03/1899"))
    }

    func test_extractDate_preferLast_picksLastMatch() {
        // The Kotlin equivalent uses `tightenByContentShape("...","list_4b")`
        // which calls extractDate(preferLast: true). Test the helper directly.
        XCTAssertEqual("05/12/2028",
                       extractDate(from: "DOB 11/09/2000 4b EXP 05/12/2028",
                                   preferLast: true))
    }

    func test_extractDate_preferFirst_picksFirstMatch() {
        XCTAssertEqual("11/09/2000",
                       extractDate(from: "11/09/2000 EXP 05/12/2028"))
    }

    func test_extractDate_dobWithLeadingLabel_strippedAndCanonicalized() {
        XCTAssertEqual("11/03/1995",
                       extractDate(from: "DOB1 1/03/1995"))
    }

    // MARK: - Single-letter value (list_9 / 9a / 12)

    func test_singleLetter_cleanValue_returnsLetter() {
        XCTAssertEqual("D", extractSingleLetterValue(in: "D"))
    }

    func test_singleLetter_labelPrefix_stripped() {
        XCTAssertEqual("D", extractSingleLetterValue(in: "CLASS D"))
    }

    func test_singleLetter_labelWithColon_stripped() {
        XCTAssertEqual("B", extractSingleLetterValue(in: "CLASS: B"))
    }

    func test_singleLetter_classWithNoneInRow_dropsNoneAndPicksClass() {
        // The Kotlin tightenByContentShape("DNONE", "list_9") returns "D"
        // because list_9 passes dropTokens=["NONE"]. We test the helper
        // directly here with the same dropTokens argument.
        XCTAssertEqual("D", extractSingleLetterValue(in: "DNONE", dropTokens: ["NONE"]))
    }

    // MARK: - Color allowlist (list_18 / 19)

    func test_eye_canonicalCode_returns() {
        XCTAssertEqual("BRO", firstColorCodeMatch(in: "BRO", allowlist: kEyeColorCodes))
    }

    func test_eye_withLabel_extractsCode() {
        XCTAssertEqual("BLU", firstColorCodeMatch(in: "EYES BLU", allowlist: kEyeColorCodes))
    }

    func test_eye_withTrailingNoise_extractsFirstAllowlistedToken() {
        XCTAssertEqual("BRO", firstColorCodeMatch(in: "EYES BRO RACE W", allowlist: kEyeColorCodes))
    }

    func test_eye_noAllowlistedToken_returnsNil() {
        // The Kotlin tightenByContentShape("BROWN", "list_18") returns
        // "BROWN" (the original) because firstColorCodeMatch hits no
        // 3-letter allowlist token. Test the helper directly here: it
        // returns nil; the wrapper applies the ?: text fallback.
        XCTAssertNil(firstColorCodeMatch(in: "BROWN", allowlist: kEyeColorCodes))
    }

    func test_hair_canonicalCode_returns() {
        XCTAssertEqual("BLK", firstColorCodeMatch(in: "BLK", allowlist: kHairColorCodes))
    }

    func test_hair_withLabel_extractsCode() {
        XCTAssertEqual("RED", firstColorCodeMatch(in: "HAIR RED", allowlist: kHairColorCodes))
    }

    // MARK: - tightenByContentShape — end-to-end through the public API

    func test_tighten_list_3_cleanDate() {
        XCTAssertEqual("08/05/2002",
                       prodTightenByContentShape(text: "08/05/2002", yoloClass: "list_3"))
    }

    func test_tighten_list_4b_preferLastIsApplied() {
        XCTAssertEqual("05/12/2028",
                       prodTightenByContentShape(
                            text: "DOB 11/09/2000 4b EXP 05/12/2028",
                            yoloClass: "list_4b"))
    }

    func test_tighten_list_4a_preferFirstIsApplied() {
        XCTAssertEqual("11/09/2000",
                       prodTightenByContentShape(
                            text: "11/09/2000 EXP 05/12/2028",
                            yoloClass: "list_4a"))
    }

    func test_tighten_list_18_extractsAllowlistedCode() {
        XCTAssertEqual("BRO",
                       prodTightenByContentShape(text: "EYES BRO RACE W",
                                                 yoloClass: "list_18"))
    }

    func test_tighten_list_19_extractsAllowlistedCode() {
        XCTAssertEqual("RED",
                       prodTightenByContentShape(text: "HAIR RED",
                                                 yoloClass: "list_19"))
    }

    func test_tighten_list_18_nonAllowlistFallsThrough() {
        // "BROWN" is not in kEyeColorCodes → tightener returns original.
        XCTAssertEqual("BROWN",
                       prodTightenByContentShape(text: "BROWN",
                                                 yoloClass: "list_18"))
    }

    func test_tighten_list_9_singleLetter() {
        XCTAssertEqual("D",
                       prodTightenByContentShape(text: "CLASS D",
                                                 yoloClass: "list_9"))
    }

    func test_tighten_list_9a_NONEPreserved() {
        XCTAssertEqual("NONE",
                       prodTightenByContentShape(text: "NONE",
                                                 yoloClass: "list_9a"))
    }

    func test_tighten_list_12_NONEPreserved() {
        XCTAssertEqual("NONE",
                       prodTightenByContentShape(text: "NONE",
                                                 yoloClass: "list_12"))
    }

    // MARK: - State-aware DL number (list_4d)

    func test_tighten_list_4d_arizona() {
        XCTAssertEqual("D38222471",
                       prodTightenByContentShape(text: "D38222471",
                                                 yoloClass: "list_4d",
                                                 detectedState: "AZ"))
    }

    func test_tighten_list_4d_arizona_ocrSubstitution() {
        XCTAssertEqual("D38000471",
                       prodTightenByContentShape(text: "D38OOO471",
                                                 yoloClass: "list_4d",
                                                 detectedState: "AZ"))
    }

    func test_tighten_list_4d_california() {
        XCTAssertEqual("B1234567",
                       prodTightenByContentShape(text: "B1234567",
                                                 yoloClass: "list_4d",
                                                 detectedState: "CA"))
    }

    func test_tighten_list_4d_wisconsin_hyphenated() {
        XCTAssertEqual("D440-1234-5678-99",
                       prodTightenByContentShape(text: "D440-1234-5678-99",
                                                 yoloClass: "list_4d",
                                                 detectedState: "WI"))
    }

    func test_tighten_list_4d_dlnLabelPrefix_stripped() {
        XCTAssertEqual("D38222471",
                       prodTightenByContentShape(text: "DLN D38222471",
                                                 yoloClass: "list_4d",
                                                 detectedState: "AZ"))
    }

    func test_tighten_list_4d_noState_fallbackPattern() {
        XCTAssertEqual("ABCD1234",
                       prodTightenByContentShape(text: "ABCD1234",
                                                 yoloClass: "list_4d"))
    }

    // MARK: - Address row strip (list_8f) — iOS-specific trust-the-class

    func test_stripPrefix_list_8f_trustTheClass_dropsMisreadDigit() {
        // Pure regex path; the lexer doesn't recognise the leading "1"
        // as a known AAMVA index for list_8f, but the trust-the-class
        // regex fires first on iOS (different ordering than Android).
        XCTAssertEqual("4242 ASHWOOD LN",
                       prodStripAamvaPrefixForClass(text: "1 4242 ASHWOOD LN",
                                                    yoloClass: "list_8f"))
    }

    func test_stripPrefix_list_8f_requiresHouseNumberShape() {
        // Without the canonical `\d{2,5}\s+\D` continuation, no strip.
        // Falls through to the lexer; lexer finds no match either
        // (the "1 MAIN ST" leading "1" canonicalizes to AAMVA index "1"
        // which is the FAMILY NAME field, not address — so on iOS the
        // mismatch path returns "" for dropOnIndexMismatch classes
        // but list_8f is NOT in that set, so the original is returned).
        XCTAssertEqual("1 MAIN ST",
                       prodStripAamvaPrefixForClass(text: "1 MAIN ST",
                                                    yoloClass: "list_8f"))
    }

    func test_stripPrefix_list_8f_neverDropsRealLeadingDigitInValue() {
        // Pure leading-house-number value, no preceding hallucinated
        // digit. Lexer won't match (no AAMVA token), trust-the-class
        // regex requires a single-digit prefix, so neither fires. Input
        // returned unchanged.
        XCTAssertEqual("4242 ASHWOOD LN",
                       prodStripAamvaPrefixForClass(text: "4242 ASHWOOD LN",
                                                    yoloClass: "list_8f"))
    }

    // MARK: - Sex regex (list_15)

    func test_tighten_list_15_cleanM() {
        XCTAssertEqual("M",
                       prodTightenByContentShape(text: "M", yoloClass: "list_15"))
    }

    func test_tighten_list_15_sandwichedM_returnsOriginal() {
        XCTAssertEqual("BLM",
                       prodTightenByContentShape(text: "BLM", yoloClass: "list_15"))
    }

    func test_tighten_list_15_withSurroundingNoise() {
        XCTAssertEqual("F",
                       prodTightenByContentShape(text: "SEX F", yoloClass: "list_15"))
    }

    // MARK: - Weight (list_17)

    func test_tighten_list_17_cleanLB() {
        XCTAssertEqual("165 LB",
                       prodTightenByContentShape(text: "165 LB", yoloClass: "list_17"))
    }

    func test_tighten_list_17_lbsPlural() {
        XCTAssertEqual("180 LBS",
                       prodTightenByContentShape(text: "180 LBS", yoloClass: "list_17"))
    }

    func test_tighten_list_17_kg() {
        XCTAssertEqual("75 KG",
                       prodTightenByContentShape(text: "75 KG", yoloClass: "list_17"))
    }

    func test_tighten_list_17_ibMisreadCanonicalizesToLB() {
        XCTAssertEqual("220 LB",
                       prodTightenByContentShape(text: "220 IB", yoloClass: "list_17"))
    }

    // MARK: - Height (list_16)

    func test_tighten_list_16_quotedInches() {
        XCTAssertEqual("5'-10''",
                       prodTightenByContentShape(text: "5'-10\"", yoloClass: "list_16"))
    }

    func test_tighten_list_16_doubleSingleQuotedInches() {
        XCTAssertEqual("6'-02''",
                       prodTightenByContentShape(text: "6'-02''", yoloClass: "list_16"))
    }
}
