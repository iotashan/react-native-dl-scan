#pragma once

// AAMVA D-20 / DL-AID-005-3 visible-field lexer (shared C++).
//
// Single source of truth for AAMVA-token recognition. Replaces the iOS
// Swift AamvaLexer (ios/AamvaLexer.swift) and Android Kotlin AamvaLexer
// (android/src/main/java/com/margelo/nitro/dlscan/AamvaLexer.kt). Both
// platforms call through a thin bridge into this implementation so the
// JS layer sees identical recognition regardless of platform.
//
// round-5/6 invariants preserved verbatim:
//
//  1. is_index_char = ASCII digit only. NO letter→digit substitution at
//     scan time (would false-match inside words like DOEFORD / ASHWOOD).
//  2. is_valid_boundary = pos == 0 OR preceding char is non-alphanumeric.
//     Letter-preceded positions are rejected (covers R2D2 case).
//  3. Trailing-char rule: matched index must NOT be immediately followed
//     by another digit. Rejects "2" inside "2074", "18" inside "180".
//  4. Value-boundary scan requires a label-peek on candidate splits —
//     prevents "5'-04\"" being split at the leading '5'.
//  5. WI 46→4d canonicalize alias is the only canonicalize rewrite.
//  6. Height regex includes the `075 in` 3-digit-inches branch.
//  7. Weight regex matches lbs?, case-insensitive (std::regex::icase).
//  8. Eye/hair color whitelists are AAMVA D-20 3-letter codes.
//  9. Greedy match longest-first with shape check before canonicalize.
// 10. matchLabelAt rejects when followed by another letter (so EYEBROW
//     doesn't match EYE); label list is sorted longest-first ONCE at
//     static init, not per call.
//
// ASCII assumption: this lexer treats input as ASCII bytes. Indices into
// the string are byte offsets, and `range_begin`/`range_end` returned to
// callers are byte offsets safe for std::string substr / Swift utf8 /
// Kotlin String when the input is ASCII. The OCR backend filters to ASCII
// before tokens reach this layer; this is a precondition on callers.
//
// v2 Sequence E — task #53.

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace dlscan {

struct AamvaToken {
    /// Canonicalized AAMVA index, e.g. "1", "4d", "16".
    std::string index;
    /// Exactly what OCR produced for the index, pre-canonicalize.
    std::string raw_index;
    /// Visible label found between index and value (UPPERCASE), e.g. "HGT".
    /// Empty if no label was matched.
    std::string label;
    /// Trimmed value text after index (and label, if present).
    std::string value;
    /// Byte offset (inclusive) of the full token's start in the source.
    std::size_t range_begin = 0;
    /// Byte offset (EXCLUSIVE) of the full token's end in the source.
    std::size_t range_end = 0;
    /// True iff a known visible label was matched between index and value.
    bool has_label = false;
};

/// Find the first AAMVA token at-or-after `start_index` in `text`.
/// Byte offset, ASCII assumption.
std::optional<AamvaToken> find_aamva_token(
    std::string_view text,
    std::size_t start_index = 0);

/// Find all AAMVA tokens in `text`, in textual order.
std::vector<AamvaToken> find_all_aamva_tokens(std::string_view text);

/// Canonicalize an OCR-recognized index substring (lower + WI 46→4d alias).
std::string aamva_canonicalize_index(std::string_view raw);

/// Gate (b) of demographic parser: is `label` compatible with `index`?
/// Case-insensitive. Empty label → false.
bool is_compatible_label(std::string_view canonical_index, std::string_view label);

/// Gate (c) of demographic parser: does `value` match the expected-domain
/// regex for `canonical_index`? Unknown index → false.
///
/// Returns the matched substring on success (Kotlin parity: callers use
/// the extracted match as the cleaned value). The whole-string anchored
/// regexes used here return `value` itself on a hit. Returns nullopt on
/// miss or unknown index. Use as both a predicate (.has_value()) and an
/// extractor — single regex evaluation, single API.
std::optional<std::string> clean_value_to_domain(
    std::string_view value,
    std::string_view canonical_index);

/// Thin convenience predicate over clean_value_to_domain.
inline bool value_matches_domain(std::string_view value,
                                 std::string_view canonical_index) {
    return clean_value_to_domain(value, canonical_index).has_value();
}

/// Canonical AAMVA D-20 3-letter eye-color codes (uppercase).
/// Used by gate (c) of the demographic parser and by the structured
/// extractor's allowlist-tier-upgrade (task #44).
const std::unordered_set<std::string>& eye_color_codes();

/// Canonical AAMVA D-20 3-letter hair-color codes (uppercase).
const std::unordered_set<std::string>& hair_color_codes();

} // namespace dlscan
