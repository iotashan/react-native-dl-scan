package com.margelo.nitro.dlscan

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for the platform-layer regex tighteners that live in
 * `HybridDLScanAndroid.kt`'s companion object (task #41).
 *
 * Scope: tests `tightenByContentShape` (the public dispatch) and
 * `stripAamvaPrefixForClass` (also public) because together they cover
 * the private helpers `extractDate`, `extractSingleLetterValue`,
 * `firstColorCodeMatch`, and the state-aware DL-number application of
 * `kStateLicensePatterns`. No need to widen private visibility.
 *
 * Companion to `cpp/tests/ocr_field_test.cpp` (the structured-extractor
 * C++ tests): these test the platform-side tighteners that run BEFORE
 * candidates reach C++, while the C++ tests cover what happens AFTER.
 *
 * If a regex here drifts from the iOS Swift equivalent in
 * `HybridDLScanIOS.swift`, the iter-evaluation will catch it
 * empirically — but a unit-level mismatch is much cheaper to surface.
 * iOS XCTest port is a documented follow-up; see task #41 closure note.
 */
class TightenersTest {

    // -------------------------------------------------------------------------
    // Date extraction — list_3 (DOB), list_4a (issue), list_4b (expiry)
    //
    // Exercises `extractDate(text, preferLast)`. Tolerates OCR digit-for-
    // letter substitutions (`O`→`0`, `I`/`l`→`1`) and `I` as a separator
    // misread of `/`. Returns canonical zero-padded MM/DD/YYYY.
    // -------------------------------------------------------------------------

    @Test
    fun extractDate_cleanDate_returnsCanonical() {
        assertEquals("08/05/2002",
            HybridDLScanAndroid.tightenByContentShape("08/05/2002", "list_3"))
    }

    @Test
    fun extractDate_ocrZeroSubstitution_canonicalizes() {
        assertEquals("08/05/2002",
            HybridDLScanAndroid.tightenByContentShape("O8/O5/2OO2", "list_3"))
    }

    @Test
    fun extractDate_ocrOneSubstitution_canonicalizes() {
        // "1" misread as "I" in month and "l" in year.
        assertEquals("11/03/2011",
            HybridDLScanAndroid.tightenByContentShape("I1/03/20l1", "list_3"))
    }

    @Test
    fun extractDate_ocrSeparatorMisread_canonicalizes() {
        // MLKit sometimes reads `/` as `I`. Our regex accepts both.
        assertEquals("11/03/2011",
            HybridDLScanAndroid.tightenByContentShape("11I03I2011", "list_3"))
    }

    @Test
    fun extractDate_invalidMonth_returnsOriginal() {
        // Month 13 fails validation (1..12). Falls through to original text.
        assertEquals("13/03/2011",
            HybridDLScanAndroid.tightenByContentShape("13/03/2011", "list_3"))
    }

    @Test
    fun extractDate_yearOutOfRange_returnsOriginal() {
        // Year 1899 fails validation (1900..2100).
        assertEquals("01/03/1899",
            HybridDLScanAndroid.tightenByContentShape("01/03/1899", "list_3"))
    }

    @Test
    fun extractDate_list_4b_preferLast_picksExpirationFromFusedString() {
        // The list_4b tightener uses preferLast=true so that fused OCR
        // observations like "DOB 11/09/2000 4b EXP 05/12/2028" yield the
        // EXP date, not the DOB. Critical for templates where MLKit
        // doesn't separate the two rows.
        assertEquals("05/12/2028",
            HybridDLScanAndroid.tightenByContentShape(
                "DOB 11/09/2000 4b EXP 05/12/2028", "list_4b"))
    }

    @Test
    fun extractDate_list_4a_preferFirst_picksIssueFromFusedString() {
        assertEquals("11/09/2000",
            HybridDLScanAndroid.tightenByContentShape(
                "11/09/2000 EXP 05/12/2028", "list_4a"))
    }

    @Test
    fun extractDate_dobWithLeadingLabel_strippedAndCanonicalized() {
        // Real-world OCR: "DOB1 1/03/1995" — space inside the date,
        // stripped by the regex's `replace(" ", "")` first.
        assertEquals("11/03/1995",
            HybridDLScanAndroid.tightenByContentShape("DOB1 1/03/1995", "list_3"))
    }

    // -------------------------------------------------------------------------
    // Single-letter value — list_9 (class), list_9a (endorsements),
    //                       list_12 (restrictions)
    //
    // Exercises `extractSingleLetterValue(text, dropTokens)`. Strips
    // label tokens (CLASS, REST, END, etc.) and drops `NONE` (for class
    // and restrictions only — endorsements legitimately can be "NONE").
    // -------------------------------------------------------------------------

    @Test
    fun singleLetter_cleanValue_returnsLetter() {
        assertEquals("D",
            HybridDLScanAndroid.tightenByContentShape("D", "list_9"))
    }

    @Test
    fun singleLetter_labelPrefix_stripped() {
        assertEquals("D",
            HybridDLScanAndroid.tightenByContentShape("CLASS D", "list_9"))
    }

    @Test
    fun singleLetter_labelWithColon_stripped() {
        assertEquals("B",
            HybridDLScanAndroid.tightenByContentShape("CLASS: B", "list_9"))
    }

    @Test
    fun singleLetter_classWithNoneInRow_dropsNoneAndPicksClass() {
        // Real-world OCR: "DNONE" fuses class D with restrictions NONE
        // because MLKit doesn't separate. The dropTokens=["NONE"] for
        // list_9 strips NONE before scanning for the single letter.
        assertEquals("D",
            HybridDLScanAndroid.tightenByContentShape("DNONE", "list_9"))
    }

    @Test
    fun list_9a_emptyValue_returnsNoneVerbatim() {
        // For endorsements, "NONE" is a legitimate value, not a dropToken.
        assertEquals("NONE",
            HybridDLScanAndroid.tightenByContentShape("NONE", "list_9a"))
    }

    @Test
    fun list_12_emptyValue_returnsNoneVerbatim() {
        // For restrictions, "NONE" is a legitimate value too.
        assertEquals("NONE",
            HybridDLScanAndroid.tightenByContentShape("NONE", "list_12"))
    }

    // -------------------------------------------------------------------------
    // Sex — list_15
    //
    // Direct lookbehind/lookahead regex: `(?<![A-Z])[MFX](?![A-Z])`. The
    // negative lookarounds prevent matching the "M" inside "BLM" or
    // "MAR". Tests pin those edge cases.
    // -------------------------------------------------------------------------

    @Test
    fun sex_cleanM_returnsM() {
        assertEquals("M",
            HybridDLScanAndroid.tightenByContentShape("M", "list_15"))
    }

    @Test
    fun sex_sandwichedM_returnsOriginal() {
        // Lookbehind prevents matching the M inside a 3-letter token.
        // No isolated [MFX] = no match = return original.
        assertEquals("BLM",
            HybridDLScanAndroid.tightenByContentShape("BLM", "list_15"))
    }

    @Test
    fun sex_withSurroundingNoise_extractsLetter() {
        assertEquals("F",
            HybridDLScanAndroid.tightenByContentShape("SEX F", "list_15"))
    }

    // -------------------------------------------------------------------------
    // Eye / hair color — list_18 / list_19
    //
    // Exercises `firstColorCodeMatch(text, kEyeColorCodes | kHairColorCodes)`.
    // Walks 3+ alpha tokens, returns the first that's in the allowlist.
    // -------------------------------------------------------------------------

    @Test
    fun eye_canonicalCode_returns() {
        assertEquals("BRO",
            HybridDLScanAndroid.tightenByContentShape("BRO", "list_18"))
    }

    @Test
    fun eye_withLabel_extractsCode() {
        assertEquals("BLU",
            HybridDLScanAndroid.tightenByContentShape("EYES BLU", "list_18"))
    }

    @Test
    fun eye_withTrailingNoise_extractsFirstAllowlistedToken() {
        assertEquals("BRO",
            HybridDLScanAndroid.tightenByContentShape("EYES BRO RACE W", "list_18"))
    }

    @Test
    fun eye_noAllowlistedToken_returnsOriginal() {
        assertEquals("BROWN",
            HybridDLScanAndroid.tightenByContentShape("BROWN", "list_18"))
    }

    @Test
    fun hair_canonicalCode_returns() {
        assertEquals("BLK",
            HybridDLScanAndroid.tightenByContentShape("BLK", "list_19"))
    }

    @Test
    fun hair_withLabel_extractsCode() {
        assertEquals("RED",
            HybridDLScanAndroid.tightenByContentShape("HAIR RED", "list_19"))
    }

    // -------------------------------------------------------------------------
    // Weight — list_17
    //
    // Regex captures `(\d{2,4})\s*(LBS?|KGS?)`. Tolerates "IB"/"|B" as
    // "LB" MLKit misreads.
    // -------------------------------------------------------------------------

    @Test
    fun weight_cleanLB_returnsCanonical() {
        assertEquals("165 LB",
            HybridDLScanAndroid.tightenByContentShape("165 LB", "list_17"))
    }

    @Test
    fun weight_lbsPlural_returnsCanonical() {
        assertEquals("180 LBS",
            HybridDLScanAndroid.tightenByContentShape("180 LBS", "list_17"))
    }

    @Test
    fun weight_kg_returnsCanonical() {
        assertEquals("75 KG",
            HybridDLScanAndroid.tightenByContentShape("75 KG", "list_17"))
    }

    @Test
    fun weight_ibMisread_canonicalizesToLB() {
        // MLKit OCR misreads "LB" as "IB" — the tightener swaps IB→LB
        // before applying the weight regex.
        assertEquals("220 LB",
            HybridDLScanAndroid.tightenByContentShape("220 IB", "list_17"))
    }

    // -------------------------------------------------------------------------
    // Height — list_16
    //
    // Regex `(\d+)'-(\d+)(?:"|'')` matches "5'-10\"" or "5'-10''".
    // -------------------------------------------------------------------------

    @Test
    fun height_quotedInches_returnsCanonical() {
        assertEquals("5'-10''",
            HybridDLScanAndroid.tightenByContentShape("5'-10\"", "list_16"))
    }

    @Test
    fun height_doubleSingleQuotedInches_returnsCanonical() {
        // OCR may emit two single quotes instead of one double quote
        // ('' vs "). Regex accepts both.
        assertEquals("6'-02''",
            HybridDLScanAndroid.tightenByContentShape("6'-02''", "list_16"))
    }

    // -------------------------------------------------------------------------
    // State-aware DL number — list_4d
    //
    // Exercises `kStateLicensePatterns` + state-aware OCR substitution
    // (`O`→`0`, `I`/`L`→`1` after the state-specific prefix length).
    // -------------------------------------------------------------------------

    @Test
    fun list_4d_arizona_appliesStatePattern() {
        // AZ pattern: D + 8 digits. OCR substitutions inside the digit
        // portion are canonicalized.
        assertEquals("D38222471",
            HybridDLScanAndroid.tightenByContentShape("D38222471", "list_4d", "AZ"))
    }

    @Test
    fun list_4d_arizona_ocrSubstitution_canonicalizes() {
        // AZ: prefix='D' kept, then O→0 in the digits.
        assertEquals("D38000471",
            HybridDLScanAndroid.tightenByContentShape("D38OOO471", "list_4d", "AZ"))
    }

    @Test
    fun list_4d_california_appliesStatePattern() {
        // CA pattern: 1 letter + 7 digits.
        assertEquals("B1234567",
            HybridDLScanAndroid.tightenByContentShape("B1234567", "list_4d", "CA"))
    }

    @Test
    fun list_4d_wisconsin_hyphenatedPattern() {
        // WI pattern: letter + 3 digits + - + 4 digits + - + 4 digits + - + 2 digits.
        assertEquals("D440-1234-5678-99",
            HybridDLScanAndroid.tightenByContentShape(
                "D440-1234-5678-99", "list_4d", "WI"))
    }

    @Test
    fun list_4d_dlnLabelPrefix_strippedBeforeMatch() {
        // The tightener strips "DLN", "DLN:", "DL", "DL:" prefixes
        // before applying the state regex. "DLN D38222471" → "D38222471".
        assertEquals("D38222471",
            HybridDLScanAndroid.tightenByContentShape(
                "DLN D38222471", "list_4d", "AZ"))
    }

    @Test
    fun list_4d_noStateDetected_fallbackRegex() {
        // Without a state, falls back to the generic
        // `^[A-Z0-9]+(?:-[A-Z0-9]+)*` pattern. Strips whitespace and
        // trailing noise.
        assertEquals("ABCD1234",
            HybridDLScanAndroid.tightenByContentShape("ABCD1234", "list_4d"))
    }

    // -------------------------------------------------------------------------
    // Platform prefix-strip fallbacks — `stripPlatformPrefixes` (task #69
    // follow-up to #41). The lexer-based entry point
    // `stripAamvaPrefixForClass` routes through the JNI AAMVA lexer and
    // can't run on the JVM unit-test runner; the pure-Kotlin fallback
    // paths were extracted into `stripPlatformPrefixes` so they CAN be
    // tested directly here.
    //
    // The lexer's behaviour is covered by 51 tests in
    // `cpp/tests/aamva_lexer_test.cpp`; these tests cover what happens
    // when the lexer found no match and we fall back to platform regex.
    // -------------------------------------------------------------------------

    @Test
    fun platformStrip_list_4d_bareDigitAlias_recovered() {
        // OCR drops the 'd' in "4d" → "4". The bareDigitAlias path
        // strips just the digit + whitespace, leaving the value.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "4 D38222471", "list_4d", "4d")
        assertEquals("D38222471", r?.text)
        assertEquals(null, r?.mismatchedFromIndex)
    }

    @Test
    fun platformStrip_list_4a_bareDigitAlias_recovered() {
        // Same alias works for list_4a (issue date) — "4 11/03/2020".
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "4 11/03/2020", "list_4a", "4a")
        assertEquals("11/03/2020", r?.text)
    }

    @Test
    fun platformStrip_list_9a_bareDigitAlias_recovered() {
        // 9a's alias drops the 'a' → just "9 NONE".
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "9 NONE", "list_9a", "9a")
        assertEquals("NONE", r?.text)
    }

    @Test
    fun platformStrip_list_4d_aliasFailsOnNoSpace() {
        // The alias requires whitespace between digit and value.
        // "4D38222471" (no space) should NOT match.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "4D38222471", "list_4d", "4d")
        assertEquals(null, r)
    }

    @Test
    fun platformStrip_list_1_noAliasForSingleDigitClass() {
        // list_1's expectedAamvaIndex is "1" (single char) — no alias.
        // bareDigitAlias only has multi-char entries.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "1 DOEFORD", "list_1", "1")
        assertEquals(null, r)
    }

    @Test
    fun platformStrip_list_8f_trustTheClass_dropsMisreadDigit() {
        // Address row trust-the-class: list_8f always starts with AAMVA
        // index "8", but MLKit sometimes misreads it as "1" / "6" etc.
        // Strip ANY single leading digit if followed by the canonical
        // "house# street" shape.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "1 4242 ASHWOOD LN", "list_8f", "8")
        assertEquals("4242 ASHWOOD LN", r?.text)
    }

    @Test
    fun platformStrip_list_8s_trustTheClass_dropsMisreadDigit() {
        // Same for list_8s (the second address row). The shape is
        // "house# street", not "city state zip", but the regex is the
        // SAME — only the YOLO class gates application.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "6 1010 OAK BLVD", "list_8s", "8")
        assertEquals("1010 OAK BLVD", r?.text)
    }

    @Test
    fun platformStrip_list_8f_requiresHouseNumberShape() {
        // The trust-the-class regex requires `\d{2,5}\s+\D` AFTER the
        // single digit. "1 MAIN ST" has no house number, so don't strip.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "1 MAIN ST", "list_8f", "8")
        assertEquals(null, r)
    }

    @Test
    fun platformStrip_list_8f_neverDropsRealLeadingDigitInValue() {
        // The regex requires the FIRST char to be a SINGLE digit
        // followed by whitespace. "4242 ASHWOOD LN" (no preceding
        // digit) → no match → returns null, preserving the value.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "4242 ASHWOOD LN", "list_8f", "8")
        assertEquals(null, r)
    }

    @Test
    fun platformStrip_list_1_trustTheClassNotApplied() {
        // list_1 (family name) is NOT in the trust-the-class allowlist.
        // Even if the text looks like an address, don't strip — names
        // can legitimately start with digits in some encodings.
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "1 4242 ASHWOOD LN", "list_1", "1")
        assertEquals(null, r)
    }

    @Test
    fun platformStrip_emptyText_returnsNull() {
        val r = HybridDLScanAndroid.stripPlatformPrefixes(
            "", "list_4d", "4d")
        assertEquals(null, r)
    }

    // ─── Chronological date fallback (round-6 — task #82) ────────────
    //
    // scanForDatesText finds MM/DD/YYYY (or MM-DD-YYYY) tokens in any
    // input text and returns them sorted oldest-first. The
    // parseAamvaDemographicFields path uses this to recover DOB / issue /
    // expire when the AAMVA-index line itself is too garbled to bind
    // index→label→value.

    // ─── CLASS text-pool fallback (task #82 follow-on) ─────────────────────
    //
    // WI Pixel OCR fuses CLASS onto the DLN row and misreads index `4d`
    // as `46`, so the lexer never emits a list_9 token and the bbox-IoU
    // path captures only the DLN. scanForClassText is the last-resort
    // recovery: scan every OCR observation for `(CLASS|CLAS|GLASS) X`.

    @Test fun scanForClass_extractsLowercaseClass() {
        // Real WI Pixel OCR-OBS string: "46 D440-1234-5678-99 cLASS D".
        val cls = HybridDLScanAndroid.scanForClassText(listOf(
            "46 D440-1234-5678-99 cLASS D",
            "1 DOEFORD",
            "2 JOHN QUINCY",
        ))
        assertEquals("D", cls)
    }

    @Test fun scanForClass_extractsGlassMisread() {
        val cls = HybridDLScanAndroid.scanForClassText(listOf(
            "D440-1234-5678-99 GLASS M",
        ))
        assertEquals("M", cls)
    }

    @Test fun scanForClass_returnsNullWhenAbsent() {
        val cls = HybridDLScanAndroid.scanForClassText(listOf(
            "1 DOEFORD",
            "2 JOHN QUINCY",
            "8 4242 ASHWOOD LN",
        ))
        assertEquals(null, cls)
    }

    @Test fun scanForClass_rejectsNoneAfterClass() {
        // "CLASS NONE" should not produce a class candidate.
        val cls = HybridDLScanAndroid.scanForClassText(listOf(
            "CLASS NONE",
        ))
        assertEquals(null, cls)
    }

    @Test fun scanForClass_acceptsMultiCharClass() {
        val cls = HybridDLScanAndroid.scanForClassText(listOf(
            "D440-1234-5678-99 CLASS CDL",
        ))
        assertEquals("CDL", cls)
    }

    @Test fun scanForDates_handlesSlashSeparator() {
        // WI canonical print form.
        val dates = HybridDLScanAndroid.scanForDatesText(listOf(
            "3 DOB 03/27/1976",
            "4a ISS 05/15/2024",
            "4b 03/27/2034",
        ))
        assertEquals(listOf("03/27/1976", "05/15/2024", "03/27/2034"), dates)
    }

    @Test fun scanForDates_handlesDashSeparator() {
        val dates = HybridDLScanAndroid.scanForDatesText(listOf("DOB 03-27-1976"))
        assertEquals(listOf("03/27/1976"), dates)
    }

    @Test fun scanForDates_sortsChronologically() {
        // Dates given in random order — output must be oldest first.
        val dates = HybridDLScanAndroid.scanForDatesText(listOf(
            "2034-03-27 EXP",  // 2031
            "1976-03-27 DOB",  // 1980 (but in this format won't parse)
            "03/27/1976",
            "05/15/2024",
            "03/27/2034",
        ))
        // Only MM/DD/YYYY-style tokens are extracted; 2034-03-27 is
        // YYYY-MM-DD which the regex doesn't match.
        assertEquals(listOf("03/27/1976", "05/15/2024", "03/27/2034"), dates)
    }

    @Test fun scanForDates_dropsImpossibleValues() {
        val dates = HybridDLScanAndroid.scanForDatesText(listOf(
            "13/45/1900",      // bad month + day
            "01/32/2024",      // bad day
            "00/00/0000",      // bad year + others
            "01/15/2024",      // valid
        ))
        assertEquals(listOf("01/15/2024"), dates)
    }

    @Test fun scanForDates_uniqueByValue() {
        // Same date appearing multiple times across different obs
        // (label-only "DOB" + value-only "03/27/1976" + the fused
        // "3 DOB 03/27/1976") should produce ONE entry.
        val dates = HybridDLScanAndroid.scanForDatesText(listOf(
            "03/27/1976",
            "DOB 03/27/1976",
            "DOB. 03/27/1976 .",
        ))
        assertEquals(listOf("03/27/1976"), dates)
    }

    // ─── extractFieldShape (round-6 follow-on) ──────────────────────

    @Test fun extractFieldShape_dateStripsTrailingJunk() {
        // "3 DOB 03/27/1976 ENB NONE" — lexer extracts everything after
        // "DOB", we need just the date.
        assertEquals("03/27/1976",
            HybridDLScanAndroid.extractFieldShape("3", "03/27/1976 ea ENb NONE"))
    }

    @Test fun extractFieldShape_heightStripsConcatenatedWeight() {
        // WI: "16 HGT 5'-04 17 WGT 160 lb" reads as one OCR line.
        // Lexer's HGT-bounded value is "5'-04 17 WGT 160 lb". Need 5'-04.
        assertEquals("5'-04",
            HybridDLScanAndroid.extractFieldShape("16", "5'-04 17 WGT 160 lb"))
    }

    @Test fun extractFieldShape_heightHyphenOnly() {
        // OCR may drop the apostrophe: "5-04 WGT 160".
        assertEquals("5-04",
            HybridDLScanAndroid.extractFieldShape("16", "5-04 WGT 160"))
    }

    @Test fun extractFieldShape_weightPrefersUnitMatch() {
        // "5-04 WGT 160 lb" — both "5-04" and "160 lb" present.
        // Weight extractor must pick the unit-suffixed one.
        assertEquals("160 lb",
            HybridDLScanAndroid.extractFieldShape("17", "5-04 WGT 160 lb"))
    }

    @Test fun extractFieldShape_weightBareDigits() {
        // No unit visible — extract bare 2-3 digit number.
        assertEquals("160",
            HybridDLScanAndroid.extractFieldShape("17", "WGT 160 b"))
    }

    @Test fun extractFieldShape_restrictionsNoneFromJunk() {
        assertEquals("NONE",
            HybridDLScanAndroid.extractFieldShape("12", "RESTR. NONE end junk"))
    }

    @Test fun scanForDates_emptyOnNoDates() {
        val dates = HybridDLScanAndroid.scanForDatesText(listOf(
            "WISCONSIN DRIVER LICENSE",
            "JOHN QUINCY DOEFORD",
        ))
        assertEquals(emptyList<String>(), dates)
    }
}
