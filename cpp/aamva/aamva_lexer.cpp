#include "aamva/aamva_lexer.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstring>
#include <regex>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace dlscan {
namespace {

// ---------------------------------------------------------------------------
// ASCII classifiers — DO NOT use std::isdigit / std::isalpha on a signed
// `char`: any UTF-8 continuation byte (> 127) becomes a negative int and
// produces UB on most libc implementations. Explicit comparisons only.
// ---------------------------------------------------------------------------

constexpr bool is_ascii_digit(char c) noexcept {
    return c >= '0' && c <= '9';
}
constexpr bool is_ascii_letter(char c) noexcept {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
constexpr bool is_ascii_alnum(char c) noexcept {
    return is_ascii_digit(c) || is_ascii_letter(c);
}

// ASCII upper-case for label comparisons.
constexpr char ascii_to_upper(char c) noexcept {
    return (c >= 'a' && c <= 'z') ? static_cast<char>(c - ('a' - 'A')) : c;
}
constexpr char ascii_to_lower(char c) noexcept {
    return (c >= 'A' && c <= 'Z') ? static_cast<char>(c + ('a' - 'A')) : c;
}

inline std::string to_lower_ascii(std::string_view in) {
    std::string out;
    out.reserve(in.size());
    for (char c : in) out.push_back(ascii_to_lower(c));
    return out;
}
inline std::string to_upper_ascii(std::string_view in) {
    std::string out;
    out.reserve(in.size());
    for (char c : in) out.push_back(ascii_to_upper(c));
    return out;
}

// round-5 invariant 4: separator characters consumed between an
// index and its label, and between a label and its value. Named constant
// to keep findAamvaToken and any future label-aware consumer in sync.
constexpr std::string_view SEPARATORS = " \t:|";

inline bool is_separator(char c) noexcept {
    for (char s : SEPARATORS) if (s == c) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Static tables — built once at program start, then immutable.
// ---------------------------------------------------------------------------

const std::unordered_set<std::string>& known_indices() {
    // round-4 lock: KNOWN_INDICES (AAMVA D-20 / DL-AID-005-3).
    static const std::unordered_set<std::string> set = {
        "1", "2", "3", "4a", "4b", "4d", "5", "8", "9", "9a",
        "12", "15", "16", "17", "18", "19",
    };
    return set;
}

} // close anonymous namespace

// eye_color_codes() and hair_color_codes() are declared in
// aamva_lexer.hpp and consumed by cpp/ocr/ocr_field_extractor.cpp's
// task-#44 allowlist tier upgrade. They live OUTSIDE the anonymous
// namespace so the linker can resolve them cross-translation-unit;
// callers inside this file find them via unqualified name lookup
// through the enclosing `dlscan` namespace.
const std::unordered_set<std::string>& eye_color_codes() {
    static const std::unordered_set<std::string> set = {
        "BLK", "BLU", "BRO", "GRY", "GRN", "HAZ", "MAR", "PNK", "DIC", "UNK",
    };
    return set;
}

const std::unordered_set<std::string>& hair_color_codes() {
    static const std::unordered_set<std::string> set = {
        "BAL", "BLK", "BLN", "BRO", "GRY", "RED", "SDY", "WHI", "UNK",
    };
    return set;
}

namespace { // reopen anonymous namespace for the rest of the file-local helpers

const std::unordered_map<std::string, std::unordered_set<std::string>>& compatible_labels() {
    // Gate (b) — index↔label compatibility used by the demographic parser.
    // round-6 (task #82 follow-on): added 3 (DOB), 4a (issue),
    // 4b (expire), 12 (restrictions) so the text-pool fallback can
    // recover them when YOLO doesn't bbox the corresponding region.
    // OCR-noise tolerant aliases: WI prints "REST", "RESTR", some other
    // states "RESTRICTIONS". Date labels: "DOB", "ISS"/"ISSUE"/"ISSUED",
    // "EXP"/"EXPIRES".
    static const std::unordered_map<std::string, std::unordered_set<std::string>> map = {
        {"3",  {"DOB", "DOB.", "BIRTH"}},
        {"4a", {"ISS", "ISSUE", "ISSUED", "ISSUE DATE"}},
        {"4b", {"EXP", "EXPIRES", "EXP DATE", "EXPIRATION"}},
        {"9",  {"CLASS"}},
        {"12", {"REST", "RESTR", "RESTR.", "RESTRICTIONS", "RSTR"}},
        {"15", {"SEX"}},
        {"16", {"HGT", "HEIGHT", "HT"}},
        {"17", {"WGT", "WEIGHT", "WT"}},
        {"18", {"EYES", "EYE"}},
        {"19", {"HAIR"}},
    };
    return map;
}

// Sorted-by-length-desc label list. Sort happens ONCE here; matchLabelAt
// must NOT re-sort per call (Kotlin's sortedByDescending was inefficient).
const std::vector<std::string>& sorted_all_labels() {
    static const std::vector<std::string> list = [] {
        std::vector<std::string> v = {
            // Canonical AAMVA D-20 visible-field labels (US/CA DLs).
            "CLASS", "CLS", "SEX",
            "HGT", "HEIGHT", "HT",
            "WGT", "WEIGHT", "WT",
            "EYES", "EYE",
            "HAIR",
            "END", "ENDORSEMENTS", "REST", "RESTR", "RESTRICTIONS", "RSTR",
            "DOB", "BIRTH",
            "ISS", "ISSUE", "ISSUED",
            "EXP", "EXPIRES", "EXPIRATION",

            // ─── OCR-misread aliases (round-6 + ultrathink pass) ────────
            //
            // These give the lexer a known label to boundary-on so the
            // VALUE after the label gets extracted cleanly. The
            // demographic parser already downgrades a label mismatch
            // (per-index `compatible_labels`) from reject → signal, so
            // these aliases never produce false positives — they only
            // help the lexer FIND where the value starts. Coverage
            // derived from Vision + MLKit at 4-6" working distance.
            //
            // HGT — H↔{M,N,K,U,R}, G↔{6,C,Q,O,0,8}, T↔{I,1,J,L,Y}
            "HOT", "H6T", "HCT", "HQT", "H0T", "H8T",
            "HGI", "HG1", "HGJ", "HGL", "HGY",
            "MGT", "NGT", "KGT", "UGT", "RGT",
            // WGT — W↔{V,M,N,VV}, G↔{6,C,Q,O,8}, T↔{I,1,J,L}
            "VWGT", "VGT", "MGT", "NGT", "WVGT",
            "W6T", "WCT", "WQT", "W0T", "W8T",
            "WGI", "WG1", "WGJ", "WGL",
            "W4T",  // some fonts misread G→4
            // EYES — E↔{F,B,3,8}, Y↔{V,X,4}, S↔{5,$}
            "FYES", "BYES", "3YES", "8YES",
            "EVES", "EXES", "E4ES",
            "EYE5", "EYE$",
            "FYE5", "EYFS", "FYFS", "EVES",  // double-noise common
            // HAIR — H↔{M,N}, A↔{4,R}, I↔{1,L,J}, R↔{B,K,P,8}
            "HA1R", "HALR", "HAJR",
            "HAIB", "HAIK", "HAIP", "HAI8",
            "HAR", "HAIA", "HAIE",
            "MAIR", "NAIR", "MAJR",
            "H4IR", "HRIR",
            // CLASS — C↔{G,O,Q}, L↔{I,1,J}, A↔4, S↔5
            "GLASS", "OLASS", "QLASS",
            "CIASS", "C1ASS", "CJASS",
            "CL4SS",
            "CLAS5", "CLA55", "CLAS$",
            "GLS", "GLS",
            // SEX — S↔{5,$}, E↔{F,B}, X↔{K,Y}
            "5EX", "$EX", "SFX", "SBX", "SEK", "SEY", "5FX",
            // DOB — D↔{0,O,Q}, O↔{0,Q,U}, B↔{8,6,R,P}
            "D0B", "DOO", "DQB", "0OB", "0DB",
            "DO8", "DO6", "DOR", "DOP",
            "BOB",  // first letter mis-OCR'd
            // ISS / ISSUE / ISSUED — I↔{1,l,L}, S↔5
            "1SS", "LSS", "15S", "1S5", "ISS5", "15SUE", "ISSUFD",
            // EXP / EXPIRES — E↔F, X↔{K,Y}, P↔R
            "EXR", "FXP", "EKP", "EYP", "FXR",
            "EXPIRFS", "EXPIRE5", "EKPIRES",
            // REST / RESTR / RESTRICTIONS — R↔{B,K,P}, E↔F, S↔5, T↔I
            "BEST", "REST.", "RFST", "RE5T", "REST5", "RESI",
            "BESTR", "RFSTR", "RE5TR",
            "BESTRICTIONS", "RFSTRICTIONS",
        };
        std::sort(v.begin(), v.end(),
                  [](const std::string& a, const std::string& b) {
                      return a.size() > b.size();
                  });
        return v;
    }();
    return list;
}

// Build the eye/hair color regex string from the whitelist. Done once.
std::string join_alternation(const std::unordered_set<std::string>& set) {
    // Use deterministic order so the regex string is stable across runs;
    // unordered_set iteration is implementation-defined.
    std::vector<std::string> sorted(set.begin(), set.end());
    std::sort(sorted.begin(), sorted.end());
    std::string out;
    for (size_t i = 0; i < sorted.size(); ++i) {
        if (i > 0) out.push_back('|');
        out += sorted[i];
    }
    return out;
}

struct DomainRegex {
    std::regex re;
    bool valid;
};

const std::unordered_map<std::string, DomainRegex>& expected_domain() {
    // round-2 lock: use std::regex_search throughout for parity with
    // Kotlin's regex.find. All patterns here are anchored (^...$) so
    // search and match coincide TODAY — but if a future pattern lands
    // unanchored, we want find-semantics. Static-storage compilation.
    static const std::unordered_map<std::string, DomainRegex> map = [] {
        std::unordered_map<std::string, DomainRegex> m;
        auto add = [&](const std::string& key,
                       const std::string& pattern,
                       std::regex::flag_type flags) {
            try {
                m.emplace(key, DomainRegex{std::regex(pattern, flags), true});
            } catch (const std::regex_error&) {
                m.emplace(key, DomainRegex{std::regex(), false});
            }
        };
        // Name rows. AAMVA indices 1 and 2 carry family name and given names
        // with no printed label, so the strict parser needs a value-domain
        // gate here before it can route them into List1/List2 candidates.
        add("1", R"(^[A-Za-z][A-Za-z .'\-]{0,59}$)",
            std::regex::ECMAScript);
        add("2", R"(^[A-Za-z][A-Za-z .'\-]{0,59}$)",
            std::regex::ECMAScript);
        // Driver license number. Keep this compact: spaces are handled by the
        // extractor's value gate, while the lexer domain only accepts values
        // that already look like the printed 4d payload.
        add("4d", R"(^[A-Za-z0-9][A-Za-z0-9-]{3,31}$)",
            std::regex::ECMAScript);
        // Vehicle class
        add("9",  R"(^[A-Z]{1,3}-?\d?$)",
            std::regex::ECMAScript);
        // Sex
        add("15", R"(^[MFXmfx]$)",
            std::regex::ECMAScript);
        // Height — WI 5'-04", 5'04", 5-10, bare 510, and `075 in` (round-6).
        add("16", R"(^(?:\d{1,2}'-?\s*\d{1,2}["]?|\d{1,2}-\d{1,2}|\d{3}|\d{2,3}\s*in)$)",
            std::regex::ECMAScript);
        // Weight — case-insensitive lbs?
        add("17", R"(^\d{2,3}\s*(?:lbs?)?$)",
            std::regex::ECMAScript | std::regex::icase);
        // Eye / hair color whitelists. The optional trailing letter/digit
        // tolerates the common WI/IL OCR pattern where Vision/MLKit append
        // a stray char to the 3-letter code (live Pixel logcat: "BLKO" for
        // "BLK", "BR0" already handled by the normalizer's digit-confusion
        // recovery). The C++ normalizer trims the trailing char back off
        // before recording the canonical value, so consumers see "BLK"
        // not "BLKO". Task #82 follow-on.
        const std::string eyeAlt  = join_alternation(eye_color_codes());
        const std::string hairAlt = join_alternation(hair_color_codes());
        add("18", "^(" + eyeAlt  + ")[A-Z0-9]?$",
            std::regex::ECMAScript | std::regex::icase);
        add("19", "^(" + hairAlt + ")[A-Z0-9]?$",
            std::regex::ECMAScript | std::regex::icase);
        // Dates — MM/DD/YYYY (typical print form), MM-DD-YYYY, or
        // 8/10-digit OCR-noise variants. The C++ extractor's
        // normalize_date_field already accepts these forms; here we
        // just need a permissive shape gate so the text-pool parser
        // emits the candidate.
        const std::string datePattern = R"(^(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{8}|\d{10})$)";
        add("3",  datePattern, std::regex::ECMAScript);
        add("4a", datePattern, std::regex::ECMAScript);
        add("4b", datePattern, std::regex::ECMAScript);
        // Restrictions — AAMVA D-20 codes are single letters (A,B,C,…)
        // or "NONE" / "N/A" when there are none. Allow combinations.
        add("12", R"(^(?:NONE|N\/A|[A-Z][A-Z0-9]?(?:[,\s][A-Z][A-Z0-9]?)*)$)",
            std::regex::ECMAScript | std::regex::icase);
        return m;
    }();
    return map;
}

// ---------------------------------------------------------------------------
// Internal scanning primitives.
// ---------------------------------------------------------------------------

/// invariant 2: pos==0 OR preceding byte is non-alphanumeric.
inline bool is_valid_boundary(std::string_view text, std::size_t pos) noexcept {
    if (pos == 0) return true;
    char prev = text[pos - 1];
    // Non-ASCII bytes (high bit set) are treated as non-alphanumeric →
    // boundary OK. This is the documented ASCII-input contract; the
    // OCR layer is responsible for filtering non-ASCII into innocuous
    // bytes before the lexer ever sees them.
    return !is_ascii_alnum(prev);
}

/// Greedy-match a single AAMVA index at `pos`. Returns canonical-index +
/// length consumed (raw substring length), or nullopt if no valid index
/// starts here. Validates against KNOWN_INDICES.
struct IndexMatch {
    std::string canonical;
    std::size_t length;
};
std::optional<IndexMatch> match_index_at(std::string_view text,
                                         std::size_t pos) {
    if (pos >= text.size()) return std::nullopt;
    if (!is_ascii_digit(text[pos])) return std::nullopt;
    if (!is_valid_boundary(text, pos)) return std::nullopt;

    const std::size_t max_len = std::min<std::size_t>(3, text.size() - pos);
    const auto& kSet = known_indices();

    // invariant 9: longest-first, shape-check before canonicalize.
    //   3 chars: digit+digit+letter  (no 3-digit indices exist)
    //   2 chars: digit+(digit|letter)
    //   1 char : digit
    for (std::size_t len = max_len; len >= 1; --len) {
        char c0 = text[pos];
        bool shape_ok = false;
        switch (len) {
            case 3: {
                char c1 = text[pos + 1];
                char c2 = text[pos + 2];
                shape_ok = is_ascii_digit(c0) && is_ascii_digit(c1) && is_ascii_letter(c2);
                break;
            }
            case 2: {
                char c1 = text[pos + 1];
                shape_ok = is_ascii_digit(c0) && (is_ascii_digit(c1) || is_ascii_letter(c1));
                break;
            }
            case 1: {
                shape_ok = is_ascii_digit(c0);
                break;
            }
            default: break;
        }
        if (!shape_ok) continue;

        std::string canon = aamva_canonicalize_index(text.substr(pos, len));
        if (kSet.find(canon) == kSet.end()) continue;

        // invariant 3: trailing-char rule. The next byte after the
        // index must NOT be an ASCII digit, else this "index" is the
        // leading digits of a longer number.
        const std::size_t next_pos = pos + len;
        if (next_pos < text.size() && is_ascii_digit(text[next_pos])) continue;

        return IndexMatch{std::move(canon), len};
    }
    return std::nullopt;
}

/// Find a known visible label at `pos`. Returns (UPPER label, length).
struct LabelMatch {
    std::string label;
    std::size_t length;
};
std::optional<LabelMatch> match_label_at(std::string_view text,
                                         std::size_t pos) {
    if (pos >= text.size()) return std::nullopt;

    const std::size_t max_len = std::min<std::size_t>(12, text.size() - pos);
    // invariant 10: longest-first, reject when followed by another
    // letter (so EYEBROW doesn't match EYE). Upper-case the region once.
    std::string upper_region = to_upper_ascii(text.substr(pos, max_len));

    for (const std::string& label : sorted_all_labels()) {
        if (label.size() > upper_region.size()) continue;
        if (std::memcmp(upper_region.data(), label.data(), label.size()) != 0) continue;
        const std::size_t end_pos = pos + label.size();
        if (end_pos == text.size() || !is_ascii_letter(text[end_pos])) {
            return LabelMatch{label, label.size()};
        }
    }
    return std::nullopt;
}

inline std::string trim_ascii_whitespace(std::string_view in) {
    std::size_t start = 0;
    while (start < in.size()
           && (in[start] == ' ' || in[start] == '\t'
               || in[start] == '\r' || in[start] == '\n')) {
        ++start;
    }
    std::size_t end = in.size();
    while (end > start
           && (in[end - 1] == ' ' || in[end - 1] == '\t'
               || in[end - 1] == '\r' || in[end - 1] == '\n')) {
        --end;
    }
    return std::string(in.substr(start, end - start));
}

} // namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

std::string aamva_canonicalize_index(std::string_view raw) {
    std::string lower = to_lower_ascii(raw);
    // invariant 5: WI 46→4d is the ONLY canonicalize alias.
    if (lower == "46") return "4d";
    return lower;
}

bool is_compatible_label(std::string_view canonical_index,
                         std::string_view label) {
    if (label.empty()) return false;
    const auto& map = compatible_labels();
    auto it = map.find(std::string(canonical_index));
    if (it == map.end()) return false;
    return it->second.find(to_upper_ascii(label)) != it->second.end();
}

std::optional<std::string> clean_value_to_domain(
    std::string_view value,
    std::string_view canonical_index) {
    const auto& map = expected_domain();
    auto it = map.find(std::string(canonical_index));
    if (it == map.end() || !it->second.valid) return std::nullopt;

    // round-2 lock: search-semantics, not match-semantics. Patterns
    // are anchored so the cleaned value is the whole value on hit.
    std::cmatch m;
    if (std::regex_search(value.data(), value.data() + value.size(),
                          m, it->second.re)) {
        return m.str();
    }
    return std::nullopt;
}

std::optional<AamvaToken> find_aamva_token(std::string_view text,
                                           std::size_t start_index) {
    std::size_t p = start_index;
    while (p < text.size()) {
        auto idx = match_index_at(text, p);
        if (!idx) { ++p; continue; }

        AamvaToken tok;
        tok.index = idx->canonical;
        tok.raw_index = std::string(text.substr(p, idx->length));
        tok.range_begin = p;

        std::size_t cursor = p + idx->length;
        // Consume separator between index and label.
        while (cursor < text.size() && is_separator(text[cursor])) ++cursor;

        if (auto lbl = match_label_at(text, cursor)) {
            tok.label = lbl->label;
            tok.has_label = true;
            cursor += lbl->length;
            while (cursor < text.size() && is_separator(text[cursor])) ++cursor;
        }

        const std::size_t value_start = cursor;
        std::size_t value_end = text.size();

        // invariant 4: value-boundary scan with label-peek.
        // Search forward for the next valid AAMVA index that is FOLLOWED
        // BY a known visible label (optionally separated). Bare-digit
        // boundaries don't count.
        std::size_t q = cursor;
        while (q < text.size()) {
            if (is_valid_boundary(text, q)) {
                if (auto candidate = match_index_at(text, q)) {
                    std::size_t after_index = q + candidate->length;
                    while (after_index < text.size()
                           && is_separator(text[after_index])) {
                        ++after_index;
                    }
                    if (match_label_at(text, after_index)) {
                        value_end = q;
                        break;
                    }
                }
            }
            ++q;
        }

        tok.value = trim_ascii_whitespace(text.substr(value_start,
                                                     value_end - value_start));
        tok.range_end = value_end;
        return tok;
    }
    return std::nullopt;
}

std::vector<AamvaToken> find_all_aamva_tokens(std::string_view text) {
    std::vector<AamvaToken> out;
    std::size_t cursor = 0;
    while (cursor < text.size()) {
        auto tok = find_aamva_token(text, cursor);
        if (!tok) break;
        // Precision: range_end is exclusive; guard against any
        // degenerate zero-length token by also bumping cursor+1.
        std::size_t next = std::max(tok->range_end, cursor + 1);
        out.push_back(std::move(*tok));
        cursor = next;
    }
    return out;
}

} // namespace dlscan
