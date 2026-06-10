// AAMVA visible-field lexer parity tests — v2 Sequence E (task #53).
//
// round-5/6 invariants are the bar this suite must defend against
// regression. Each numbered TEST below corresponds to an invariant from
// cpp/aamva/aamva_lexer.hpp. If you change the lexer and any test here
// fails, do not adjust the test — the change broke an invariant that
// prior review rounds locked in for OCR robustness.

#include <gtest/gtest.h>
#include "aamva/aamva_lexer.hpp"

#include <string>
#include <vector>

using dlscan::AamvaToken;
using dlscan::aamva_canonicalize_index;
using dlscan::clean_value_to_domain;
using dlscan::find_aamva_token;
using dlscan::find_all_aamva_tokens;
using dlscan::is_compatible_label;
using dlscan::value_matches_domain;

// ============================================================================
// Invariant 1 — is_index_char is digits only.  Letter-substitution at scan
// time would intra-word-match valid OCR ("DOEFORD", "ASHWOOD").
// ============================================================================

TEST(AamvaLexerInvariants, NoLetterSubstitution_S_AsFiveDoesNotMatch) {
    // "S EYES BLU" — Swift round-5 reproducer. 'S' must NOT canonicalize
    // to '5' and produce a fake "5 EYES BLU" token.
    auto tokens = find_all_aamva_tokens("S EYES BLU");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerInvariants, NoLetterSubstitution_I_AsOneDoesNotIntraWordMatch) {
    // 'I' in "I DOEFORD" must not become a "1" token sliced into DOEFORD.
    auto tokens = find_all_aamva_tokens("I DOEFORD");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerInvariants, NoLetterSubstitution_O_AsZeroDoesNotMatch) {
    // 'O' / 'l' / 'B' letter→digit was removed; verify none of them match.
    auto tokens = find_all_aamva_tokens("O ASHWOOD  l SPRINGFIELD B BURBANK");
    EXPECT_TRUE(tokens.empty());
}

// ============================================================================
// Invariant 2 — alphanumeric boundary precondition.  Letter-preceded
// positions are rejected (R2D2 case).
// ============================================================================

TEST(AamvaLexerInvariants, LetterPrecededDigitIsNotAToken_R2D2) {
    // "R2D2" — the '2' after 'R' must not start a "2" token.
    auto tokens = find_all_aamva_tokens("R2D2 DOB 01/01/2000");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerInvariants, DigitPrecededDigitIsNotAToken) {
    // "7350" — digit-preceded digits never start an index.
    auto tokens = find_all_aamva_tokens("7350 DOB");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerInvariants, BoundaryAtPositionZeroIsValid) {
    auto tok = find_aamva_token("9 D");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "9");
}

TEST(AamvaLexerInvariants, BoundaryAfterNonAlnumIsValid) {
    auto tok = find_aamva_token("ADDRESS: 9 D");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "9");
}

// ============================================================================
// Invariant 3 — trailing-char rule.  Index immediately followed by another
// digit is rejected ("2" inside "2074", "18" inside "180").
// ============================================================================

TEST(AamvaLexerInvariants, TrailingDigitRejects_2InsideZipLikeNumber) {
    auto tokens = find_all_aamva_tokens("ZIP 21193");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerInvariants, TrailingDigitRejects_18InsideHeightValue) {
    // "180 EYES BLU" must NOT produce an "18" token at the start.
    auto tokens = find_all_aamva_tokens("180 EYES BLU");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerInvariants, TrailingNonDigitIsAccepted) {
    auto tok = find_aamva_token("18 BLU");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "18");
}

// ============================================================================
// Invariant 4 — value-boundary scan requires a label-peek on splits.
// Prevents "5'-09\"" from being false-split at the leading '5'.
// ============================================================================

TEST(AamvaLexerInvariants, ValueBoundaryRequiresLabelPeek_HeightFiveFootFour) {
    // "4d HEIGHT 5'-09" 8 EYES BLU" — the '5' inside the height value
    // must NOT be split out as a "5" token. The '8' DOES have a label
    // (EYES) so that's the legitimate next token.
    auto tokens = find_all_aamva_tokens("4d HEIGHT 5'-09\" 8 EYES BLU");
    ASSERT_EQ(tokens.size(), 2u);
    EXPECT_EQ(tokens[0].index, "4d");
    EXPECT_EQ(tokens[0].label, "HEIGHT");
    EXPECT_EQ(tokens[0].value, "5'-09\"");
    EXPECT_EQ(tokens[1].index, "8");
    EXPECT_EQ(tokens[1].label, "EYES");
    EXPECT_EQ(tokens[1].value, "BLU");
}

TEST(AamvaLexerInvariants, ValueBoundary_NoLabelMeansValueRunsToEnd) {
    // "1 SMITH" — no second index, value is just "SMITH".
    auto tokens = find_all_aamva_tokens("1 SMITH");
    ASSERT_EQ(tokens.size(), 1u);
    EXPECT_EQ(tokens[0].index, "1");
    EXPECT_FALSE(tokens[0].has_label);
    EXPECT_EQ(tokens[0].value, "SMITH");
}

// ============================================================================
// Invariant 5 — WI 46→4d is the ONLY canonicalize alias.
// ============================================================================

TEST(AamvaLexerInvariants, Canonicalize_46_To_4d_WI) {
    auto tok = find_aamva_token("46 X1234567");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "4d");
    EXPECT_EQ(tok->raw_index, "46");
}

TEST(AamvaLexerInvariants, Canonicalize_48_DoesNotAlias) {
    // 48 is not a known index and is not aliased — must produce no token.
    auto tokens = find_all_aamva_tokens("48 X1234567");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerHelpers, CanonicalizeFunctionDirect) {
    EXPECT_EQ(aamva_canonicalize_index("46"), "4d");
    EXPECT_EQ(aamva_canonicalize_index("4D"), "4d");
    EXPECT_EQ(aamva_canonicalize_index("4d"), "4d");
    EXPECT_EQ(aamva_canonicalize_index("16"), "16");
    EXPECT_EQ(aamva_canonicalize_index("9A"), "9a");
}

// ============================================================================
// Invariant 6 — height regex covers WI "5'-09\"", "5'09\"", "5-10", "510",
// and `075 in` 3-digit-inches (round-6).
// ============================================================================

TEST(AamvaLexerDomain, Height_WI_QuoteHyphenForm) {
    EXPECT_TRUE(value_matches_domain("5'-09\"", "16"));
    EXPECT_TRUE(value_matches_domain("5'09\"", "16"));
}

TEST(AamvaLexerDomain, Height_HyphenForm) {
    EXPECT_TRUE(value_matches_domain("5-10", "16"));
}

TEST(AamvaLexerDomain, Height_BareThreeDigits) {
    EXPECT_TRUE(value_matches_domain("510", "16"));
}

TEST(AamvaLexerDomain, Height_ThreeDigitInches_Round6) {
    EXPECT_TRUE(value_matches_domain("075 in", "16"));
    EXPECT_TRUE(value_matches_domain("70 in", "16"));
}

TEST(AamvaLexerDomain, Height_RejectsRandomString) {
    EXPECT_FALSE(value_matches_domain("HGT", "16"));
    EXPECT_FALSE(value_matches_domain("5 FEET", "16"));
}

// ============================================================================
// Invariant 7 — weight is case-insensitive lbs?.
// ============================================================================

TEST(AamvaLexerDomain, Weight_BareDigits) {
    EXPECT_TRUE(value_matches_domain("160", "17"));
}

TEST(AamvaLexerDomain, Weight_LbCaseInsensitive) {
    EXPECT_TRUE(value_matches_domain("160 LB", "17"));
    EXPECT_TRUE(value_matches_domain("185 lb", "17"));
    EXPECT_TRUE(value_matches_domain("160 LBS", "17"));
    EXPECT_TRUE(value_matches_domain("185 lbs", "17"));
}

TEST(AamvaLexerDomain, Weight_RejectsTrailingJunk) {
    EXPECT_FALSE(value_matches_domain("160 ls", "17"));
    EXPECT_FALSE(value_matches_domain("160 pounds", "17"));
}

// ============================================================================
// Invariant 8 — eye/hair color whitelists.
// ============================================================================

TEST(AamvaLexerDomain, EyeColor_AcceptsWhitelist) {
    for (const char* c : {"BLK","BLU","BRO","GRY","GRN","HAZ","MAR","PNK","DIC","UNK"}) {
        EXPECT_TRUE(value_matches_domain(c, "18")) << c;
    }
}

TEST(AamvaLexerDomain, EyeColor_RejectsOffWhitelist) {
    EXPECT_FALSE(value_matches_domain("BLE", "18"));
    EXPECT_FALSE(value_matches_domain("AMB", "18"));
}

TEST(AamvaLexerDomain, HairColor_AcceptsWhitelist) {
    for (const char* c : {"BAL","BLK","BLN","BRO","GRY","RED","SDY","WHI","UNK"}) {
        EXPECT_TRUE(value_matches_domain(c, "19")) << c;
    }
}

TEST(AamvaLexerDomain, HairColor_CaseInsensitive) {
    EXPECT_TRUE(value_matches_domain("blk", "19"));
    EXPECT_TRUE(value_matches_domain("Bro", "19"));
}

TEST(AamvaLexerDomain, Sex_AcceptsM_F_X_CaseInsensitive) {
    EXPECT_TRUE(value_matches_domain("M", "15"));
    EXPECT_TRUE(value_matches_domain("F", "15"));
    EXPECT_TRUE(value_matches_domain("X", "15"));
    EXPECT_TRUE(value_matches_domain("m", "15"));
    EXPECT_FALSE(value_matches_domain("MM", "15"));
}

TEST(AamvaLexerDomain, VehicleClass_AcceptsCommonForms) {
    EXPECT_TRUE(value_matches_domain("D", "9"));
    EXPECT_TRUE(value_matches_domain("CDL", "9"));
    EXPECT_TRUE(value_matches_domain("C-1", "9"));
    EXPECT_FALSE(value_matches_domain("0123", "9"));
}

TEST(AamvaLexerDomain, NameIndicesAcceptAlphaSpaceValues) {
    EXPECT_TRUE(value_matches_domain("DELGADO", "1"));
    EXPECT_TRUE(value_matches_domain("MARCUS ANTOINE", "2"));
    EXPECT_FALSE(value_matches_domain("2 MARCUS ANTOINE", "2"));
    EXPECT_FALSE(value_matches_domain("J415-2208-5573-28", "1"));
}

TEST(AamvaLexerDomain, LicenseIndexAcceptsCompactAlnumHyphenOnly) {
    EXPECT_TRUE(value_matches_domain("J415-2208-5573-28", "4d"));
    EXPECT_TRUE(value_matches_domain("26798765", "4d"));
    EXPECT_FALSE(value_matches_domain("2 MARCUS ANTOINE", "4d"));
    EXPECT_FALSE(value_matches_domain("MARCUS ANTOINE", "4d"));
}

TEST(AamvaLexerDomain, UnknownIndexReturnsFalse) {
    EXPECT_FALSE(value_matches_domain("ANY", "999"));
    EXPECT_FALSE(clean_value_to_domain("ANY", "999").has_value());
}

TEST(AamvaLexerDomain, CleanValueReturnsMatchedSubstring) {
    auto cleaned = clean_value_to_domain("185 lb", "17");
    ASSERT_TRUE(cleaned.has_value());
    EXPECT_EQ(*cleaned, "185 lb");
}

// ============================================================================
// Invariant 9 — greedy longest-first with shape check.
// ============================================================================

TEST(AamvaLexerInvariants, GreedyMatches_4d_BeforeBare_4) {
    auto tok = find_aamva_token("4d X1234567");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "4d");
    EXPECT_EQ(tok->raw_index, "4d");
}

TEST(AamvaLexerInvariants, GreedyMatches_16_BeforeBare_1) {
    auto tok = find_aamva_token("16 HGT 5-10");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "16");
    EXPECT_EQ(tok->label, "HGT");
}

TEST(AamvaLexerInvariants, GreedyMatches_9a_BeforeBare_9) {
    // 9a is in KNOWN_INDICES; "9a SOMETHING" with no following digit
    // must produce a 9a token, not a 9.
    auto tok = find_aamva_token("9a CLASS D");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "9a");
}

// ============================================================================
// Invariant 10 — matchLabelAt rejects when followed by another letter
// (so EYEBROW doesn't match EYE).
// ============================================================================

TEST(AamvaLexerInvariants, LabelMatch_EYEBROW_DoesNotMatchEYE) {
    // "18 EYEBROW BLK" — the lexer sees a "18" index, then must NOT
    // match "EYEBROW" as the "EYE" label (would consume too few chars).
    auto tok = find_aamva_token("18 EYEBROW BLK");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "18");
    EXPECT_FALSE(tok->has_label);
    EXPECT_EQ(tok->value, "EYEBROW BLK");
}

TEST(AamvaLexerInvariants, LabelMatch_EYES_BeforeEYE) {
    // Longest-first sort means EYES wins over EYE for "18 EYES BLU".
    auto tok = find_aamva_token("18 EYES BLU");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->label, "EYES");
}

// ============================================================================
// is_compatible_label gate (b) tests.
// ============================================================================

TEST(AamvaLexerHelpers, CompatibleLabel_Map) {
    EXPECT_TRUE(is_compatible_label("9", "CLASS"));
    EXPECT_TRUE(is_compatible_label("15", "SEX"));
    EXPECT_TRUE(is_compatible_label("16", "HGT"));
    EXPECT_TRUE(is_compatible_label("16", "HEIGHT"));
    EXPECT_TRUE(is_compatible_label("16", "HT"));
    EXPECT_TRUE(is_compatible_label("17", "WGT"));
    EXPECT_TRUE(is_compatible_label("18", "EYES"));
    EXPECT_TRUE(is_compatible_label("19", "HAIR"));
}

TEST(AamvaLexerHelpers, CompatibleLabel_MismatchedReturnsFalse) {
    // The 9 SEX M reproducer: vehicle-class index with sex label → false.
    EXPECT_FALSE(is_compatible_label("9", "SEX"));
    EXPECT_FALSE(is_compatible_label("15", "HGT"));
    EXPECT_FALSE(is_compatible_label("16", "EYES"));
}

TEST(AamvaLexerHelpers, CompatibleLabel_CaseInsensitive) {
    EXPECT_TRUE(is_compatible_label("16", "hgt"));
    EXPECT_TRUE(is_compatible_label("16", "Height"));
}

TEST(AamvaLexerHelpers, CompatibleLabel_EmptyOrUnknown) {
    EXPECT_FALSE(is_compatible_label("16", ""));
    EXPECT_FALSE(is_compatible_label("999", "ANYTHING"));
}

// ============================================================================
// Integration — full multi-field demographic line (the canonical case).
// ============================================================================

TEST(AamvaLexerIntegration, FullDemographicLine) {
    auto tokens = find_all_aamva_tokens("15 SEX M 16 HGT 5'-09\" 17 WGT 185 lb");
    ASSERT_EQ(tokens.size(), 3u);

    EXPECT_EQ(tokens[0].index, "15");
    EXPECT_EQ(tokens[0].label, "SEX");
    EXPECT_EQ(tokens[0].value, "M");

    EXPECT_EQ(tokens[1].index, "16");
    EXPECT_EQ(tokens[1].label, "HGT");
    EXPECT_EQ(tokens[1].value, "5'-09\"");

    EXPECT_EQ(tokens[2].index, "17");
    EXPECT_EQ(tokens[2].label, "WGT");
    EXPECT_EQ(tokens[2].value, "185 lb");
}

TEST(AamvaLexerIntegration, FourFieldsWithEyeAndHair) {
    auto tokens = find_all_aamva_tokens("16 HGT 5-10 17 WGT 180 18 EYES BLU 19 HAIR BRO");
    ASSERT_EQ(tokens.size(), 4u);
    EXPECT_EQ(tokens[0].index, "16"); EXPECT_EQ(tokens[0].value, "5-10");
    EXPECT_EQ(tokens[1].index, "17"); EXPECT_EQ(tokens[1].value, "180");
    EXPECT_EQ(tokens[2].index, "18"); EXPECT_EQ(tokens[2].value, "BLU");
    EXPECT_EQ(tokens[3].index, "19"); EXPECT_EQ(tokens[3].value, "BRO");
}

TEST(AamvaLexerIntegration, NoTokensInPlainText) {
    auto tokens = find_all_aamva_tokens("DRIVER LICENSE STATE OF WISCONSIN");
    EXPECT_TRUE(tokens.empty());
}

TEST(AamvaLexerIntegration, EmptyInput) {
    EXPECT_TRUE(find_all_aamva_tokens("").empty());
    EXPECT_FALSE(find_aamva_token("").has_value());
}

TEST(AamvaLexerIntegration, SingleTokenAtEndOfString) {
    auto tok = find_aamva_token("FOO 9 D");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "9");
    EXPECT_EQ(tok->value, "D");
}

// ============================================================================
// Range fields — exclusive end semantics.
// ============================================================================

TEST(AamvaLexerRange, RangeEndIsExclusive) {
    // "9 D" — range covers "9 D", end is text.size() == 3.
    auto tok = find_aamva_token("9 D");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->range_begin, 0u);
    EXPECT_EQ(tok->range_end, 3u);
}

TEST(AamvaLexerRange, RangeBetweenTokens) {
    // "15 SEX M 16 HGT 5-10"
    //  ^                ^
    //  0                17 (start of "5-10")
    // First token covers offsets 0..8 (exclusive: stops at the boundary
    // index "16" position; the value is "M").
    auto tokens = find_all_aamva_tokens("15 SEX M 16 HGT 5-10");
    ASSERT_EQ(tokens.size(), 2u);
    EXPECT_EQ(tokens[0].range_begin, 0u);
    // Token[0] value ends right before "16" begins, which is at offset 9.
    EXPECT_EQ(tokens[0].range_end, 9u);
    EXPECT_EQ(tokens[1].range_begin, 9u);
    EXPECT_EQ(tokens[1].range_end, 20u);
}

// ============================================================================
// Separator handling.
// ============================================================================

TEST(AamvaLexerSeparators, ColonSeparator) {
    auto tok = find_aamva_token("15:SEX:M");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "15");
    EXPECT_EQ(tok->label, "SEX");
    EXPECT_EQ(tok->value, "M");
}

TEST(AamvaLexerSeparators, PipeSeparator) {
    auto tok = find_aamva_token("16|HGT|5-10");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "16");
    EXPECT_EQ(tok->label, "HGT");
    EXPECT_EQ(tok->value, "5-10");
}

TEST(AamvaLexerSeparators, TabSeparator) {
    auto tok = find_aamva_token("17\tWGT\t180");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "17");
    EXPECT_EQ(tok->label, "WGT");
    EXPECT_EQ(tok->value, "180");
}

// ============================================================================
// Fused label (no separator between index and label).
// ============================================================================

TEST(AamvaLexerFused, IndexLabelFused) {
    // "16HGT 5-10" — no separator between "16" and "HGT".
    auto tok = find_aamva_token("16HGT 5-10");
    ASSERT_TRUE(tok.has_value());
    EXPECT_EQ(tok->index, "16");
    EXPECT_EQ(tok->label, "HGT");
    EXPECT_EQ(tok->value, "5-10");
}
