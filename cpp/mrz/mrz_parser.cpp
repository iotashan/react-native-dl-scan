#include "mrz_parser.hpp"

#include <algorithm>
#include <cstdint>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace dlscan {
namespace {

// ---------------------------------------------------------------------------
// Character validation
// ---------------------------------------------------------------------------

/// Returns true if every character in s is an MRZ-legal character: A-Z, 0-9, '<'.
static bool is_mrz_chars(const std::string& s) {
    for (unsigned char c : s) {
        if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '<')) {
            return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// ICAO 9303 check-digit algorithm
// ---------------------------------------------------------------------------

/// Compute the ICAO 9303 check digit for the string [s].
/// Values: digit → self, A-Z → 10..35, '<' → 0.
/// Weights cycle [7, 3, 1].
/// Returns single digit 0-9 as char.
static char compute_check_digit(const std::string& s) {
    static const int weights[3] = {7, 3, 1};
    int sum = 0;
    for (size_t i = 0; i < s.size(); ++i) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        int val = 0;
        if (c >= '0' && c <= '9') {
            val = c - '0';
        } else if (c >= 'A' && c <= 'Z') {
            val = c - 'A' + 10;
        }
        // '<' → 0 (default)
        sum += val * weights[i % 3];
    }
    return static_cast<char>('0' + (sum % 10));
}

/// Returns true if the check digit character at position [cd_pos] in [line]
/// matches the computed check digit over [line.substr(start, len)].
static bool check_digit_ok(const std::string& line, size_t start, size_t len,
                            size_t cd_pos) {
    if (cd_pos >= line.size() || start + len > line.size()) return false;
    char computed = compute_check_digit(line.substr(start, len));
    return computed == line[cd_pos];
}

// ---------------------------------------------------------------------------
// Date parsing: YYMMDD → ISO 8601
// ---------------------------------------------------------------------------

/// Parse a 6-char YYMMDD MRZ date to "yyyy-mm-dd".
/// Year disambiguation: yy < (current_year_2d + 20) mod 100 → 20xx, else 19xx.
/// Rejects impossible dates (Feb 30, etc.) via mktime round-trip.
/// Returns empty string on failure.
static std::string parse_mrz_date(const std::string& yymmd, bool is_expiry) {
    if (yymmd.size() != 6) return "";
    for (unsigned char c : yymmd) {
        if (c < '0' || c > '9') return "";
    }

    int yy = (yymmd[0] - '0') * 10 + (yymmd[1] - '0');
    int mm = (yymmd[2] - '0') * 10 + (yymmd[3] - '0');
    int dd = (yymmd[4] - '0') * 10 + (yymmd[5] - '0');

    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";

    // Get current year for disambiguation
    time_t now_t = time(nullptr);
    struct tm now_tm = {};
#ifdef _WIN32
    gmtime_s(&now_tm, &now_t);
#else
    gmtime_r(&now_t, &now_tm);
#endif
    int current_year_2d = now_tm.tm_year % 100;  // 0-99

    // Threshold: if yy is within 20 years of current, it's in 2000s for expiry,
    // or use the rule: yy < (current_year_2d + 20) % 100 → 2000+yy, else 1900+yy
    // This correctly handles birth dates (past) and expiry dates (future).
    int full_year;
    int threshold = (current_year_2d + 20) % 100;
    if (threshold > current_year_2d) {
        // Normal case: no century wrap in the threshold range
        full_year = (yy <= threshold) ? 2000 + yy : 1900 + yy;
    } else {
        // Wrap case: e.g. current_year_2d = 90, threshold = 10
        full_year = (yy >= current_year_2d || yy <= threshold) ? 2000 + yy : 1900 + yy;
    }

    // Validate via mktime round-trip to catch impossible dates (Feb 30, etc.)
    struct tm t = {};
    t.tm_year = full_year - 1900;
    t.tm_mon  = mm - 1;
    t.tm_mday = dd;
    t.tm_isdst = -1;
    time_t tt = mktime(&t);
    if (tt == (time_t)-1) return "";
    // mktime normalizes; check that the fields didn't change
    if (t.tm_mon != mm - 1 || t.tm_mday != dd) return "";

    std::ostringstream oss;
    oss << std::setfill('0')
        << std::setw(4) << full_year << '-'
        << std::setw(2) << mm << '-'
        << std::setw(2) << dd;
    return oss.str();
}

// ---------------------------------------------------------------------------
// Name parsing: "PRIMARY<<SECONDARY<PARTS" → (primary, secondary)
// ---------------------------------------------------------------------------

static void parse_mrz_name(const std::string& raw,
                            std::string& primary,
                            std::string& secondary) {
    // Find "<<" separator between primary and secondary identifiers
    size_t sep = raw.find("<<");
    std::string prim_raw = (sep != std::string::npos) ? raw.substr(0, sep) : raw;
    std::string sec_raw  = (sep != std::string::npos) ? raw.substr(sep + 2) : "";

    // Within each part, '<' is a word separator; leading/trailing trimmed
    auto expand = [](const std::string& part) -> std::string {
        std::string result;
        bool need_space = false;
        for (unsigned char c : part) {
            if (c == '<') {
                if (!result.empty()) need_space = true;
            } else {
                if (need_space) {
                    result += ' ';
                    need_space = false;
                }
                result += static_cast<char>(c);
            }
        }
        return result;
    };

    primary   = expand(prim_raw);
    secondary = expand(sec_raw);
}

// ---------------------------------------------------------------------------
// Strip trailing '<' fillers from field strings
// ---------------------------------------------------------------------------

static std::string strip_fillers(const std::string& s) {
    size_t last = s.find_last_not_of('<');
    if (last == std::string::npos) return "";
    return s.substr(0, last + 1);
}

// ---------------------------------------------------------------------------
// Sex field normalization
// ---------------------------------------------------------------------------

static std::string normalize_sex(char c) {
    if (c == 'M') return "M";
    if (c == 'F') return "F";
    // ICAO 9303 uses '<' for unspecified/other; some documents use 'X'
    if (c == 'X' || c == '<') return "X";
    return "X";
}

// ---------------------------------------------------------------------------
// TD3 (2 lines × 44 chars) — Passports
//
// Line 1 (L1):
//   [0-1]  Document code (e.g., "P<", "PC")
//   [2-4]  Issuing state (3 chars)
//   [5-43] Name field (39 chars)
//
// Line 2 (L2):
//   [0-8]  Document number (9 chars)
//   [9]    Check digit (doc number)
//   [10-15] Date of birth (YYMMDD)
//   [16]   Check digit (DOB)
//   [17]   Sex
//   [18-23] Date of expiry (YYMMDD)
//   [24]   Check digit (expiry)
//   [25-34] Optional data (10 chars)
//   [35-42] Optional data 2 / nationality overlay — per spec, actually:
//
// ICAO 9303-4 ed.8 Part 4 (TD3 layout):
//   L2[0-8]   Document number (9)
//   L2[9]     CD: doc number
//   L2[10-12] Nationality (3)
//   L2[13-18] DOB YYMMDD (6)
//   L2[19]    CD: DOB
//   L2[20]    Sex (1)
//   L2[21-26] Expiry YYMMDD (6)
//   L2[27]    CD: expiry
//   L2[28-35] Optional data (8)
//   L2[36-42] Personal number / optional (7)  [sometimes combined as 15-char optional]
//   L2[43]    Composite CD
//
// Composite CD covers: L2[0-9] + L2[13-19] + L2[21-27] + L2[28-43]
//   i.e., doc-number+cd + DOB+cd + expiry+cd + optional data (15 chars)
// ---------------------------------------------------------------------------

static std::optional<MRZData> try_td3(const std::string& l1, const std::string& l2) {
    if (l1.size() != 44 || l2.size() != 44) return std::nullopt;
    if (!is_mrz_chars(l1) || !is_mrz_chars(l2)) return std::nullopt;

    // Document code must start with P or V (visa) or A/C etc.; at minimum
    // the first char must not be '<'
    if (l1[0] == '<') return std::nullopt;

    MRZData data;
    data.mrzType = MRZType::TD3;

    // Document code (2 chars, strip trailing '<')
    data.documentCode = strip_fillers(l1.substr(0, 2));

    // Issuing state (3 chars)
    data.issuingState = strip_fillers(l1.substr(2, 3));

    // Name (39 chars)
    parse_mrz_name(l1.substr(5, 39), data.primaryIdentifier, data.secondaryIdentifier);

    // Document number (9 chars) + check digit at [9]
    data.documentNumber = strip_fillers(l2.substr(0, 9));
    bool cd_docnum = check_digit_ok(l2, 0, 9, 9);

    // Nationality [10-12]
    data.nationality = strip_fillers(l2.substr(10, 3));

    // DOB [13-18] + check digit at [19]
    data.dateOfBirth = parse_mrz_date(l2.substr(13, 6), false);
    bool cd_dob = check_digit_ok(l2, 13, 6, 19);

    // Sex [20]
    data.sex = normalize_sex(l2[20]);

    // Expiry [21-26] + check digit at [27]
    data.dateOfExpiry = parse_mrz_date(l2.substr(21, 6), true);
    bool cd_expiry = check_digit_ok(l2, 21, 6, 27);

    // Optional data [28-35] + [36-42] = 15 chars total (some states use all 15)
    data.optionalData = strip_fillers(l2.substr(28, 14));

    // Composite check digit at [43]
    // Covers: l2[0..9] (doc num + cd) + l2[13..19] (dob + cd) + l2[21..27] (exp + cd)
    //         + l2[28..42] (optional 15 chars)
    std::string composite = l2.substr(0, 10) + l2.substr(13, 7) + l2.substr(21, 7) + l2.substr(28, 15);
    char cd_comp_expected = compute_check_digit(composite);
    bool cd_composite = (cd_comp_expected == l2[43]);

    data.checkDigitsValid = cd_docnum && cd_dob && cd_expiry && cd_composite;

    return data;
}

// ---------------------------------------------------------------------------
// TD2 (2 lines × 36 chars) — Older passport-style IDs
//
// ICAO 9303 Part 2 (TD2) layout:
// Line 1:
//   [0-1]  Document code
//   [2-4]  Issuing state (3)
//   [5-35] Name field (31)
//
// Line 2:
//   [0-8]  Document number (9)
//   [9]    CD: doc number
//   [10-12] Nationality (3)
//   [13-18] DOB YYMMDD (6)
//   [19]   CD: DOB
//   [20]   Sex (1)
//   [21-26] Expiry YYMMDD (6)
//   [27]   CD: expiry
//   [28-34] Optional data (7)
//   [35]   Composite CD
//
// Composite CD covers: L2[0..9] + L2[13..19] + L2[21..27] + L2[28..34]
// ---------------------------------------------------------------------------

static std::optional<MRZData> try_td2(const std::string& l1, const std::string& l2) {
    if (l1.size() != 36 || l2.size() != 36) return std::nullopt;
    if (!is_mrz_chars(l1) || !is_mrz_chars(l2)) return std::nullopt;

    if (l1[0] == '<') return std::nullopt;

    MRZData data;
    data.mrzType = MRZType::TD2;

    data.documentCode = strip_fillers(l1.substr(0, 2));
    data.issuingState = strip_fillers(l1.substr(2, 3));
    parse_mrz_name(l1.substr(5, 31), data.primaryIdentifier, data.secondaryIdentifier);

    data.documentNumber = strip_fillers(l2.substr(0, 9));
    bool cd_docnum = check_digit_ok(l2, 0, 9, 9);

    data.nationality = strip_fillers(l2.substr(10, 3));

    data.dateOfBirth = parse_mrz_date(l2.substr(13, 6), false);
    bool cd_dob = check_digit_ok(l2, 13, 6, 19);

    data.sex = normalize_sex(l2[20]);

    data.dateOfExpiry = parse_mrz_date(l2.substr(21, 6), true);
    bool cd_expiry = check_digit_ok(l2, 21, 6, 27);

    data.optionalData = strip_fillers(l2.substr(28, 7));

    // Composite: l2[0..9] + l2[13..19] + l2[21..27] + l2[28..34]
    std::string composite = l2.substr(0, 10) + l2.substr(13, 7) + l2.substr(21, 7) + l2.substr(28, 7);
    bool cd_composite = (compute_check_digit(composite) == l2[35]);

    data.checkDigitsValid = cd_docnum && cd_dob && cd_expiry && cd_composite;

    return data;
}

// ---------------------------------------------------------------------------
// TD1 (3 lines × 30 chars) — Credit-card-sized national IDs / residence permits
//
// ICAO 9303 Part 5 (TD1) layout:
// Line 1:
//   [0-1]  Document code
//   [2-4]  Issuing state (3)
//   [5-13] Document number (9)
//   [14]   CD: doc number
//   [15-29] Optional data 1 (15)
//
// Line 2:
//   [0-5]  DOB YYMMDD (6)
//   [6]    CD: DOB
//   [7]    Sex (1)
//   [8-13] Expiry YYMMDD (6)
//   [14]   CD: expiry
//   [15-17] Nationality (3)
//   [18-28] Optional data 2 (11)
//   [29]   Composite CD
//
// Composite CD covers: all of L1[0-29] + L2[0-6] + L2[8-14]
//   (the entire first line + DOB+cd + expiry+cd from L2)
//
// Line 3:
//   [0-29] Name (30)
// ---------------------------------------------------------------------------

static std::optional<MRZData> try_td1(const std::string& l1, const std::string& l2,
                                       const std::string& l3) {
    if (l1.size() != 30 || l2.size() != 30 || l3.size() != 30) return std::nullopt;
    if (!is_mrz_chars(l1) || !is_mrz_chars(l2) || !is_mrz_chars(l3)) return std::nullopt;

    if (l1[0] == '<') return std::nullopt;

    MRZData data;
    data.mrzType = MRZType::TD1;

    data.documentCode = strip_fillers(l1.substr(0, 2));
    data.issuingState = strip_fillers(l1.substr(2, 3));

    data.documentNumber = strip_fillers(l1.substr(5, 9));
    bool cd_docnum = check_digit_ok(l1, 5, 9, 14);

    // Optional data 1 [15-29]
    std::string opt1 = strip_fillers(l1.substr(15, 15));

    // Line 2
    data.dateOfBirth = parse_mrz_date(l2.substr(0, 6), false);
    bool cd_dob = check_digit_ok(l2, 0, 6, 6);

    data.sex = normalize_sex(l2[7]);

    data.dateOfExpiry = parse_mrz_date(l2.substr(8, 6), true);
    bool cd_expiry = check_digit_ok(l2, 8, 6, 14);

    data.nationality = strip_fillers(l2.substr(15, 3));

    // Optional data 2 [18-28]
    std::string opt2 = strip_fillers(l2.substr(18, 11));

    // Combine optional data
    if (!opt1.empty() && !opt2.empty()) {
        data.optionalData = opt1 + " " + opt2;
    } else if (!opt1.empty()) {
        data.optionalData = opt1;
    } else {
        data.optionalData = opt2;
    }

    // Composite CD at L2[29]
    // Covers all 30 chars of L1 + L2[0-6] (DOB + cd) + L2[8-14] (expiry + cd)
    std::string composite = l1 + l2.substr(0, 7) + l2.substr(8, 7);
    bool cd_composite = (compute_check_digit(composite) == l2[29]);

    data.checkDigitsValid = cd_docnum && cd_dob && cd_expiry && cd_composite;

    // Line 3: name
    parse_mrz_name(l3.substr(0, 30), data.primaryIdentifier, data.secondaryIdentifier);

    return data;
}

// ---------------------------------------------------------------------------
// Filter lines to those that are MRZ-eligible (right length, right chars)
// ---------------------------------------------------------------------------

struct IndexedLine {
    size_t original_index;
    std::string content;
};

static std::vector<IndexedLine> filter_mrz_lines(const std::vector<std::string>& lines,
                                                   size_t target_len) {
    std::vector<IndexedLine> result;
    for (size_t i = 0; i < lines.size(); ++i) {
        const std::string& l = lines[i];
        if (l.size() == target_len && is_mrz_chars(l)) {
            // Reject all-'<' lines (no valid doc would have an all-filler line)
            bool all_filler = true;
            for (char c : l) {
                if (c != '<') { all_filler = false; break; }
            }
            if (!all_filler) {
                result.push_back({i, l});
            }
        }
    }
    return result;
}

}  // anonymous namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

std::optional<MRZData> parse_mrz(const std::vector<std::string>& lines) {
    if (lines.empty()) return std::nullopt;

    // --- Try TD3 (2 × 44) ---
    {
        auto cands44 = filter_mrz_lines(lines, 44);
        // We need 2 consecutive (by original index) eligible lines
        std::optional<MRZData> best_td3;
        for (size_t i = 0; i + 1 < cands44.size(); ++i) {
            // Allow lines that are consecutive in the original input
            // (or directly adjacent in the filtered list if they came from consecutive original lines)
            if (cands44[i + 1].original_index == cands44[i].original_index + 1) {
                auto result = try_td3(cands44[i].content, cands44[i + 1].content);
                if (result.has_value()) {
                    if (result->checkDigitsValid) return result;
                    if (!best_td3.has_value()) best_td3 = result;
                }
            }
        }
        if (best_td3.has_value()) return best_td3;
    }

    // --- Try TD2 (2 × 36) ---
    {
        auto cands36 = filter_mrz_lines(lines, 36);
        std::optional<MRZData> best_td2;
        for (size_t i = 0; i + 1 < cands36.size(); ++i) {
            if (cands36[i + 1].original_index == cands36[i].original_index + 1) {
                auto result = try_td2(cands36[i].content, cands36[i + 1].content);
                if (result.has_value()) {
                    if (result->checkDigitsValid) return result;
                    if (!best_td2.has_value()) best_td2 = result;
                }
            }
        }
        if (best_td2.has_value()) return best_td2;
    }

    // --- Try TD1 (3 × 30) ---
    {
        auto cands30 = filter_mrz_lines(lines, 30);
        std::optional<MRZData> best_td1;
        for (size_t i = 0; i + 2 < cands30.size(); ++i) {
            if (cands30[i + 1].original_index == cands30[i].original_index + 1 &&
                cands30[i + 2].original_index == cands30[i].original_index + 2) {
                auto result = try_td1(cands30[i].content, cands30[i + 1].content,
                                       cands30[i + 2].content);
                if (result.has_value()) {
                    if (result->checkDigitsValid) return result;
                    if (!best_td1.has_value()) best_td1 = result;
                }
            }
        }
        if (best_td1.has_value()) return best_td1;
    }

    return std::nullopt;
}

}  // namespace dlscan
