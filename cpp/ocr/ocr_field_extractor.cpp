#include "ocr_field_extractor.hpp"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <initializer_list>
#include <iomanip>
#include <map>
#include <optional>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "aamva/aamva_lexer.hpp"
#include "mrz/mrz_parser.hpp"
#include "state_lookup.hpp"

namespace dlscan {
namespace {

// ---------------------------------------------------------------------------
// String utilities (local)
// ---------------------------------------------------------------------------

static std::string to_upper(const std::string& s) {
    std::string u = s;
    std::transform(u.begin(), u.end(), u.begin(),
                   [](unsigned char c) { return std::toupper(c); });
    return u;
}

static std::string trim_ws(const std::string& s) {
    const std::string ws = " \t\r\n";
    size_t start = s.find_first_not_of(ws);
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(ws);
    return s.substr(start, end - start + 1);
}

static bool starts_with(const std::string& s, const std::string& prefix) {
    return s.size() >= prefix.size() &&
           s.substr(0, prefix.size()) == prefix;
}

/// Join lines with newline.
static std::string join_lines(const std::vector<std::string>& lines) {
    std::string result;
    for (size_t i = 0; i < lines.size(); ++i) {
        if (i > 0) result += '\n';
        result += lines[i];
    }
    return result;
}

// ---------------------------------------------------------------------------
// Date parsing utilities for OCR (MM/DD/YYYY or MM-DD-YYYY)
// ---------------------------------------------------------------------------

struct ParsedDate {
    std::string iso_str;   // yyyy-MM-dd
    int year = 0;
    int month = 0;
    int day = 0;

    bool operator<(const ParsedDate& o) const {
        if (year != o.year) return year < o.year;
        if (month != o.month) return month < o.month;
        return day < o.day;
    }
};

static std::optional<ParsedDate> parse_ocr_date(const std::string& date_str) {
    // Accepts MM/DD/YYYY or MM-DD-YYYY
    if (date_str.size() != 10) return std::nullopt;
    char sep = date_str[2];
    if (sep != '/' && sep != '-') return std::nullopt;
    if (date_str[5] != sep) return std::nullopt;

    try {
        int m = std::stoi(date_str.substr(0, 2));
        int d = std::stoi(date_str.substr(3, 2));
        int y = std::stoi(date_str.substr(6, 4));

        if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1) return std::nullopt;

        std::ostringstream oss;
        oss << std::setfill('0')
            << std::setw(4) << y << '-'
            << std::setw(2) << m << '-'
            << std::setw(2) << d;

        ParsedDate pd;
        pd.iso_str = oss.str();
        pd.year = y;
        pd.month = m;
        pd.day = d;
        return pd;
    } catch (...) {
        return std::nullopt;
    }
}

/// Extract all date strings matching \b(\d{2}[/-]\d{2}[/-]\d{4})\b from lines.
static std::vector<ParsedDate> extract_dates(const std::vector<std::string>& lines) {
    static const std::regex kDateRe(
        "\\b(\\d{2}[/\\-]\\d{2}[/\\-]\\d{4})\\b",
        std::regex::ECMAScript);

    std::vector<ParsedDate> dates;
    for (const std::string& line : lines) {
        auto begin = std::sregex_iterator(line.begin(), line.end(), kDateRe);
        auto end = std::sregex_iterator();
        for (auto it = begin; it != end; ++it) {
            std::string matched = (*it)[1].str();
            auto pd = parse_ocr_date(matched);
            if (pd.has_value()) dates.push_back(pd.value());
        }
    }
    return dates;
}

// ---------------------------------------------------------------------------
// Value extraction helpers (mirrors Swift helpers)
// ---------------------------------------------------------------------------

/// Extract value after one of `labels` in `line` (case-insensitive label match).
static std::optional<std::string> extract_value(const std::vector<std::string>& labels,
                                                 const std::string& line) {
    std::string upper_line = to_upper(line);
    for (const std::string& label : labels) {
        std::string upper_label = to_upper(label);
        size_t pos = upper_line.find(upper_label);
        if (pos == std::string::npos) continue;
        std::string after = line.substr(pos + label.size());
        // Trim leading whitespace and punctuation
        size_t start = after.find_first_not_of(" \t:,.");
        if (start == std::string::npos) continue;
        after = after.substr(start);
        after = trim_ws(after);
        if (!after.empty()) return after;
    }
    return std::nullopt;
}

/// Search for a labeled value in lines near `index` (within ±3).
static std::optional<std::string> find_nearby_value(
    const std::vector<std::string>& labels,
    const std::vector<std::string>& lines,
    size_t index) {
    size_t lo = (index > 3) ? index - 3 : 0;
    size_t hi = std::min(lines.size() - 1, index + 3);
    for (size_t i = lo; i <= hi; ++i) {
        auto v = extract_value(labels, lines[i]);
        if (v.has_value()) return v;
    }
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Name extraction
// ---------------------------------------------------------------------------

struct NameResult {
    std::string first;
    std::string last;
    std::optional<std::string> middle;
};

static std::optional<NameResult> extract_name(const std::vector<std::string>& lines) {
    for (size_t i = 0; i < lines.size(); ++i) {
        const std::string& line = lines[i];
        std::string upper = to_upper(line);

        if (starts_with(upper, "LN ") || starts_with(upper, "LAST ")) {
            auto last = extract_value({"LN", "LAST NAME", "LAST"}, line);
            auto first = find_nearby_value({"FN", "FIRST NAME", "FIRST"}, lines, i);
            if (last.has_value() && first.has_value()) {
                auto mid = find_nearby_value({"MN", "MIDDLE NAME", "MIDDLE"}, lines, i);
                NameResult nr;
                nr.first = first.value();
                nr.last = last.value();
                nr.middle = mid;
                return nr;
            }
        }

        if (starts_with(upper, "FN ") || starts_with(upper, "FIRST ")) {
            auto first = extract_value({"FN", "FIRST NAME", "FIRST"}, line);
            auto last = find_nearby_value({"LN", "LAST NAME", "LAST"}, lines, i);
            if (first.has_value() && last.has_value()) {
                auto mid = find_nearby_value({"MN", "MIDDLE NAME", "MIDDLE"}, lines, i);
                NameResult nr;
                nr.first = first.value();
                nr.last = last.value();
                nr.middle = mid;
                return nr;
            }
        }
    }
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// License number extraction
// ---------------------------------------------------------------------------

static std::optional<std::string> extract_license_number(
    const std::vector<std::string>& lines) {
    // Patterns mirror Swift's extractLicenseNumber
    static const std::regex kDlRe("DL[:\\s]*([A-Z0-9]{6,15})",
                                   std::regex::ECMAScript);
    static const std::regex kLicRe("LIC(?:ENSE)?[:\\s#]*([A-Z0-9]{6,15})",
                                    std::regex::ECMAScript);
    static const std::regex kLicenseRe(
        "LICENSE\\s*(?:NO|NUMBER|#)?[:\\s]*([A-Z0-9]{6,15})",
        std::regex::ECMAScript);

    for (const std::string& line : lines) {
        for (const std::regex* re :
             {&kDlRe, &kLicRe, &kLicenseRe}) {
            std::smatch m;
            if (std::regex_search(line, m, *re) && m.size() > 1) {
                // m[1] is the captured ID group — use it directly instead of
                // re-scanning m[0] (which would return the label word, not the ID).
                return m[1].str();
            }
        }
    }
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Address extraction
// ---------------------------------------------------------------------------

struct AddressResult {
    std::string street;
    std::string city;
    std::string state;
    std::string zip;
};

static std::optional<AddressResult> extract_address(
    const std::vector<std::string>& lines) {
    static const std::regex kCsvRe(
        "([A-Za-z\\s]+)[,\\s]+([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)",
        std::regex::ECMAScript);

    for (size_t i = 0; i < lines.size(); ++i) {
        std::smatch m;
        if (std::regex_search(lines[i], m, kCsvRe)) {
            std::string city = trim_ws(m[1].str());
            std::string state = m[2].str();
            std::string zip = m[3].str();
            std::string street = (i > 0) ? lines[i - 1] : "";
            if (!city.empty() && !state.empty()) {
                AddressResult ar;
                ar.street = street;
                ar.city = city;
                ar.state = state;
                ar.zip = zip;
                return ar;
            }
        }
    }
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Sex extraction
// ---------------------------------------------------------------------------

static std::optional<std::string> extract_sex(const std::string& text) {
    std::string upper = to_upper(text);
    if (upper.find("SEX M") != std::string::npos ||
        upper.find("SEX: M") != std::string::npos ||
        upper.find("MALE") != std::string::npos) {
        return std::string("M");
    }
    if (upper.find("SEX F") != std::string::npos ||
        upper.find("SEX: F") != std::string::npos ||
        upper.find("FEMALE") != std::string::npos) {
        return std::string("F");
    }
    if (upper.find("SEX X") != std::string::npos ||
        upper.find("SEX: X") != std::string::npos) {
        return std::string("X");
    }
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Date assignment (mirrors Swift's assignDates)
// ---------------------------------------------------------------------------

static void assign_dates(const std::vector<ParsedDate>& dates, LicenseData& result) {
    if (dates.empty()) return;

    std::vector<ParsedDate> sorted = dates;
    std::sort(sorted.begin(), sorted.end());

    if (sorted.size() >= 1) {
        result.dateOfBirth = sorted[0].iso_str;
    }
    if (sorted.size() >= 2) {
        result.expirationDate = sorted[sorted.size() - 1].iso_str;
    }
    if (sorted.size() >= 3) {
        result.issueDate = sorted[1].iso_str;
    }
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

std::optional<LicenseData> extract_ocr_fields(const std::vector<std::string>& lines) {
    // --- MRZ detection: try before AAMVA-OCR heuristics ---
    {
        auto mrz = parse_mrz(lines);
        if (mrz.has_value()) {
            LicenseData out;
            if (mrz->mrzType == MRZType::TD3) {
                out.documentType = DocumentType::Passport;
            } else if (mrz->documentCode.size() >= 2 &&
                       mrz->documentCode[0] == 'A' && mrz->documentCode[1] == 'C') {
                out.documentType = DocumentType::ResidencePermit;
            } else {
                out.documentType = DocumentType::NationalId;
            }
            out.mrz = mrz;
            // Populate driver-license-equivalent fields where they overlap
            if (!mrz->primaryIdentifier.empty())
                out.lastName = mrz->primaryIdentifier;
            if (!mrz->secondaryIdentifier.empty())
                out.firstName = mrz->secondaryIdentifier;
            if (!mrz->dateOfBirth.empty())
                out.dateOfBirth = mrz->dateOfBirth;
            if (!mrz->dateOfExpiry.empty())
                out.expirationDate = mrz->dateOfExpiry;
            if (!mrz->documentNumber.empty())
                out.licenseNumber = mrz->documentNumber;
            if (!mrz->issuingState.empty())
                out.country = mrz->issuingState;
            if (!mrz->sex.empty())
                out.sex = mrz->sex;
            return out;
        }
    }
    // Fall through to AAMVA-OCR field heuristic (existing logic below)

    LicenseData result;

    std::string joined = join_lines(lines);

    // Extract dates
    auto dates = extract_dates(lines);

    // Name extraction
    auto name_opt = extract_name(lines);
    if (name_opt.has_value()) {
        result.firstName = name_opt.value().first;
        result.lastName = name_opt.value().last;
        result.middleName = name_opt.value().middle;
    }

    // License number
    result.licenseNumber = extract_license_number(lines);

    // Assign dates
    assign_dates(dates, result);

    // Address
    auto addr = extract_address(lines);
    if (addr.has_value()) {
        result.street = addr.value().street;
        result.city = addr.value().city;
        result.state = addr.value().state;
        result.postalCode = addr.value().zip;
    }

    // Sex
    result.sex = extract_sex(joined);

    // Need at least a name or license number to consider it a valid parse
    if (!result.firstName.has_value() && !result.licenseNumber.has_value()) {
        return std::nullopt;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Structured field extractor — consumes YOLO-class-keyed map produced by the
// platform layer (Swift / Kotlin) after running the field detector and
// IoU-matching OCR observations to detected bboxes.
// ---------------------------------------------------------------------------

namespace {

/// Read the first non-empty value matching any of the keys, in priority order.
static std::optional<std::string> read_first_field(
    const std::map<std::string, std::string>& fields,
    std::initializer_list<const char*> keys) {
    for (const char* k : keys) {
        auto it = fields.find(k);
        if (it == fields.end()) continue;
        std::string v = trim_ws(it->second);
        if (!v.empty()) return v;
    }
    return std::nullopt;
}

/// Normalize a date string to ISO YYYY-MM-DD. Accepts ISO already, else
/// MM/DD/YYYY or MM-DD-YYYY via parse_ocr_date. If neither matches, returns
/// nullopt so the caller sees an absent field rather than garbage OCR text.
/// (Diagnostics for the raw OCR string belong on a separate path, not here.)
static std::optional<std::string> normalize_date_field(
    const std::optional<std::string>& raw) {
    if (!raw.has_value()) return std::nullopt;
    const std::string& v = raw.value();

    // Already ISO YYYY-MM-DD?
    if (v.size() == 10 && v[4] == '-' && v[7] == '-') {
        try {
            int y = std::stoi(v.substr(0, 4));
            int m = std::stoi(v.substr(5, 2));
            int d = std::stoi(v.substr(8, 2));
            if (y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                return v;
            }
        } catch (...) {
            // fall through to other formats
        }
    }

    // Try MM/DD/YYYY or MM-DD-YYYY
    auto parsed = parse_ocr_date(v);
    if (parsed.has_value()) return parsed->iso_str;

    // OCR-noise variant: the date "/" separator is consistently misread as
    // "1" on many state DL fonts (eval harness found this on 100% of WI
    // date fields — task #39 finding). Accept any 10-char digit-string of
    // shape `MM x DD x YYYY` where x is any single digit. The next-best
    // validity check (m∈1..12, d∈1..31) rejects garbage like "1234567890".
    if (v.size() == 10) {
        bool all_digits = true;
        for (char c : v) if (!std::isdigit(static_cast<unsigned char>(c))) { all_digits = false; break; }
        if (all_digits) {
            try {
                int m = std::stoi(v.substr(0, 2));
                int d = std::stoi(v.substr(3, 2));
                int y = std::stoi(v.substr(6, 4));
                if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900) {
                    std::ostringstream oss;
                    oss << std::setfill('0')
                        << std::setw(4) << y << '-'
                        << std::setw(2) << m << '-'
                        << std::setw(2) << d;
                    return oss.str();
                }
            } catch (...) {}
        }
    }
    // OCR-noise variant: separator entirely missing — "MMDDYYYY" (8 chars).
    if (v.size() == 8) {
        bool all_digits = true;
        for (char c : v) if (!std::isdigit(static_cast<unsigned char>(c))) { all_digits = false; break; }
        if (all_digits) {
            try {
                int m = std::stoi(v.substr(0, 2));
                int d = std::stoi(v.substr(2, 2));
                int y = std::stoi(v.substr(4, 4));
                if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900) {
                    std::ostringstream oss;
                    oss << std::setfill('0')
                        << std::setw(4) << y << '-'
                        << std::setw(2) << m << '-'
                        << std::setw(2) << d;
                    return oss.str();
                }
            } catch (...) {}
        }
    }

    // Unrecognized — caller sees absent, not garbage.
    return std::nullopt;
}

/// Normalize a sex/gender string to "M" / "F" / "X". Returns nullopt for
/// values that don't clearly indicate one of the three.
static std::optional<std::string> normalize_sex_field(
    const std::optional<std::string>& raw) {
    if (!raw.has_value()) return std::nullopt;
    std::string upper = to_upper(trim_ws(raw.value()));
    if (upper.empty()) return std::nullopt;
    if (upper == "M" || upper == "MALE" || upper == "MAN") return std::string("M");
    if (upper == "F" || upper == "FEMALE" || upper == "WOMAN") return std::string("F");
    if (upper == "X") return std::string("X");
    // Try the free-form sex extractor as a fallback ("SEX: M", etc.)
    return extract_sex(raw.value());
}

/// Strip all whitespace from a license-number-like string. Assumes the
/// platform layer has already removed any field-label prefix (e.g.
/// "DL " or "LICENSE NO ") so the input here is the value alone.
static std::string strip_whitespace(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s) {
        if (!std::isspace(c)) out.push_back(static_cast<char>(c));
    }
    return out;
}

/// Strip a leading visible-label token from a value. Case-insensitive label
/// match; punctuation/whitespace immediately following the label is also
/// consumed. Returns the value unchanged if none of [labels] match the
/// prefix. Used to canonicalize HGT/WGT/EYES/HAIR-style printed labels that
/// AAMVA D-20 places next to the field index — e.g. "HGT 5'-04\"" → "5'-04\"".
///
/// paired plan, 2026-05-10: this lives in C++ (not the platform layer)
/// because field semantics belong to the parser core. Platform owns geometry
/// and transport; C++ owns "what does this raw OCR text mean for this field".
static std::optional<std::string> strip_leading_label(
    const std::optional<std::string>& raw,
    std::initializer_list<const char*> labels) {
    if (!raw.has_value()) return std::nullopt;
    std::string trimmed = trim_ws(raw.value());
    if (trimmed.empty()) return std::nullopt;
    std::string upper = to_upper(trimmed);
    for (const char* lbl : labels) {
        std::string upper_label = to_upper(lbl);
        if (upper.size() < upper_label.size()) continue;
        if (upper.compare(0, upper_label.size(), upper_label) != 0) continue;
        // Label must be followed by EOL or a non-alphanumeric separator so
        // we don't strip "HG" from "HGT-COLOR" or "EYE" from "EYES".
        if (upper.size() == upper_label.size()) {
            return std::string("");
        }
        char next = upper[upper_label.size()];
        if (std::isalnum(static_cast<unsigned char>(next))) continue;
        std::string after = trimmed.substr(upper_label.size());
        // Eat leading whitespace + punctuation between label and value.
        // Real-world OCR separators include space/tab + `:`, `,`, `.`, plus
        // the iter-44 additions `;` and `-` (e.g. "WGT- 165 LB", "EYES; BRO").
        // The label-followed-by-alnum guard above already prevents this from
        // chewing through `HGT165` (no separator) — only consumes punctuation
        // that's already AFTER a confirmed label boundary.
        size_t start = after.find_first_not_of(" \t:,.;-");
        if (start == std::string::npos) return std::string("");
        return trim_ws(after.substr(start));
    }
    return trimmed;
}

/// Height value normalizer. Strips "HGT", "HEIGHT", "HT" labels, then
/// shape-gates: accept iff the value contains a `'` (foot/prime mark) OR
/// is a digit-only cm value in human range. Anything else (e.g. a ZIP
/// code or random OCR garbage that the YOLO bbox landed on when the
/// height row was missed) is rejected as nullopt.
///
/// Task #27 — driven by parser_eval finding that on states like California
/// the list_16 bbox lands on the wrong card row and returns nonsense like
/// `"95101"` which the previous unguarded normalizer accepted as height.
/// The "contains a `'`" rule keeps even noisy OCR forms (`5'_04':`,
/// `S'-02"`, `5'06`) — we'd rather pass an imperfect height through than
/// drop a real one because OCR mangled the inch mark.
static std::optional<std::string> normalize_height_field(
    const std::optional<std::string>& raw) {
    auto v = strip_leading_label(raw, {"HGT", "HEIGHT", "HT"});
    if (!v.has_value() || v->empty()) return std::nullopt;
    const std::string& s = v.value();
    // Fast path: anything with a foot/prime mark AND at least one digit
    // counts as height-shaped. The digit-adjacency guard closes the
    // apostrophe-name edge case (`O'NEIL`, `D'ARCY`) without losing any
    // real height (every `5'-06"`, `S'-02"`, `5'_04':` contains a digit).
    if (s.find('\'') != std::string::npos &&
        std::any_of(s.begin(), s.end(),
                    [](unsigned char c) { return std::isdigit(c) != 0; })) {
        return s;
    }
    // Apostrophe-loss path: dense WI / IL / NY card rows OCR the foot
    // mark out of the height ("5'-04\"" → "5-04"). Accept dash-form when
    // both numbers parse as realistic feet (4..7) and inches (0..11);
    // reformat to canonical "F'II\"" so downstream consumers see a
    // single shape rather than having to handle both.
    static const std::regex kDashForm(
        R"(^\s*(\d)-(\d{1,2})\s*$)",
        std::regex::ECMAScript);
    std::smatch dm;
    if (std::regex_match(s, dm, kDashForm)) {
        try {
            int feet = std::stoi(dm[1].str());
            int inches = std::stoi(dm[2].str());
            if (feet >= 4 && feet <= 7 && inches >= 0 && inches <= 11) {
                char buf[16];
                std::snprintf(buf, sizeof(buf), "%d'%02d\"", feet, inches);
                return std::string(buf);
            }
        } catch (...) {}
    }
    // Fallback: digit-only cm value in human height range. Reject ZIPs,
    // weights, and longer numerics by demanding 140..230.
    static const std::regex kCm(
        R"(^\s*(\d{2,3})\s*(?:cm)?\s*$)",
        std::regex::ECMAScript);
    std::smatch m;
    if (std::regex_match(s, m, kCm)) {
        try {
            int n = std::stoi(m[1].str());
            if (n >= 140 && n <= 230) return s;
        } catch (...) {}
    }
    return std::nullopt;
}

/// Weight value normalizer. Strips "WGT", "WEIGHT", "WT" labels, then
/// shape-gates: must contain 2-3 consecutive digits in human weight
/// range (50..400 lb / 22..180 kg, expanded window). Tolerates OCR
/// noise around the number (e.g. `221.LB`, `175LBS`, `17&B`).
/// Task #27 — gate is permissive on noise but rejects values where no
/// run of 2-3 digits in human range exists (e.g. a ZIP code captured by
/// a mis-routed bbox would have 5 digits, not 2-3).
static std::optional<std::string> normalize_weight_field(
    const std::optional<std::string>& raw) {
    auto v = strip_leading_label(raw, {"WGT", "WEIGHT", "WT"});
    if (!v.has_value() || v->empty()) return std::nullopt;
    const std::string& s = v.value();
    // Accept iff the string STARTS with 2-3 digits in human weight range.
    // Trailing noise (`221.LB`, `175LBS`, `242LB`, `219<weird>`) is fine —
    // the platform layer / eval downstream strips it. This is just a
    // "the leading numeric portion looks like a weight" gate.
    static const std::regex kStartDigits(R"(^\s*(\d{2,3})(?!\d))");
    std::smatch m;
    if (!std::regex_search(s, m, kStartDigits)) return std::nullopt;
    try {
        int n = std::stoi(m[1].str());
        if (n < 50 || n > 400) return std::nullopt;
    } catch (...) { return std::nullopt; }
    return s;
}

/// Walk whitespace-delimited tokens of `value`. If a length-4 token's
/// first 3 chars match `allowlist` (case-insensitive, exact only — no
/// digit-confusion variants here; the tier-upgrade helper handles those
/// later), return the canonical 3-char code uppercased. Used by the
/// eye/hair color normalizers to strip the stray trailing letter that
/// WI/Pixel OCR appends ("BLKO" → "BLK", "BROO" → "BRO"). Task #82.
static std::optional<std::string> recover_trailing_noise_allowlist(
    const std::string& value,
    const std::unordered_set<std::string>& allowlist) {
    std::string upper;
    upper.reserve(value.size());
    for (char c : value) {
        upper.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
    }
    std::size_t i = 0;
    while (i < upper.size()) {
        std::size_t start = upper.find_first_not_of(" \t\r\n", i);
        if (start == std::string::npos) break;
        std::size_t end = upper.find_first_of(" \t\r\n", start);
        if (end == std::string::npos) end = upper.size();
        if (end - start == 4) {
            std::string head = upper.substr(start, 3);
            if (allowlist.count(head) > 0) return head;
        }
        i = end;
    }
    return std::nullopt;
}

/// Eye-color value normalizer. Strips "EYES", "EYE", "EYE COLOR" labels,
/// then shape-gates: must contain at least 2 consecutive alphabetic
/// characters. Rejects pure-digit or near-pure-digit OCR garbage (e.g. a
/// ZIP code captured when the bbox missed the color row) while still
/// accepting noisy substitutions like "8RO" for "BRO" (Arizona dominant
/// OCR pattern — 482 occurrences in the IDNet corpus, all 2-alpha runs).
static std::optional<std::string> normalize_eye_color_field(
    const std::optional<std::string>& raw) {
    auto v = strip_leading_label(raw, {"EYE COLOR", "EYES", "EYE"});
    if (!v.has_value() || v->empty()) return std::nullopt;
    // Soft alpha gate: at least 2 total alphabetic chars (not required
    // consecutive). Catches "B1K", "8R0", "BLU"; rejects pure-digit
    // garbage like "12345" (a misclassified ZIP). round-6 fix:
    // was [A-Za-z]{2,} requiring consecutive — that rejected legitimate
    // OCR-noise like "B1K" where the L gets read as 1.
    int alphaCount = 0;
    for (unsigned char c : *v) {
        if (std::isalpha(c)) ++alphaCount;
        if (alphaCount >= 2) break;
    }
    if (alphaCount < 2) return std::nullopt;
    // Trailing-noise recovery: live Pixel logcat showed OCR appending a
    // stray char to the 3-letter code ("BROO" for "BRO"). The lexer's
    // dom regex now tolerates the trailing char so the candidate
    // reaches us; here we extract the canonical 3-char code so the
    // result UI shows "BRO" not "BROO". Task #82 follow-on.
    if (auto canon = recover_trailing_noise_allowlist(*v, eye_color_codes());
        canon.has_value()) {
        return canon;
    }
    return v;
}

// (state/province lookups + ZIP prefix validation land in #36 patch)

/// Hair-color value normalizer. Strips "HAIR", "HAIR COLOR" labels, then
/// shape-gates: must contain at least 2 consecutive alphabetic characters
/// — same logic as eye color.
static std::optional<std::string> normalize_hair_color_field(
    const std::optional<std::string>& raw) {
    auto v = strip_leading_label(raw, {"HAIR COLOR", "HAIR"});
    if (!v.has_value() || v->empty()) return std::nullopt;
    // Soft alpha gate (round-6 fix): 2 total alphabetic chars
    // (not required consecutive). See normalize_eye_color_field above
    // for the rationale — "B1K" needs to survive this gate so the
    // digit-letter-confusion allowlist variant generator can recover
    // "BLK".
    int alphaCount = 0;
    for (unsigned char c : *v) {
        if (std::isalpha(c)) ++alphaCount;
        if (alphaCount >= 2) break;
    }
    if (alphaCount < 2) return std::nullopt;
    // Trailing-noise recovery: WI Pixel logcat showed "BLKO" for "BLK".
    // Extract the canonical 3-char code so the UI shows "BLK".
    if (auto canon = recover_trailing_noise_allowlist(*v, hair_color_codes());
        canon.has_value()) {
        return canon;
    }
    return v;
}

/// Task #44 — color allowlist tier upgrade helper.
/// Returns true iff `value` contains a whitespace-delimited 3-letter token
/// (case-insensitive) that appears in `allowlist`. Used to decide whether a
/// normalized eye/hair color value earns the ShapeMatched (0.85) tier (real
/// AAMVA code) versus ExtractedRaw (0.50, soft alpha gate only).
///
/// "BRO"           → true   (exact match)
/// "BROWN"         → false  (4 letters, not in allowlist)
/// "8RO"           → false  (3 chars but digit-prefixed, won't match)
/// "EYES BRO"      → true   (whitespace split, BRO matches)
/// "BRO RACE W"    → true   (leading token matches)
/// "12345"         → false  (no alpha tokens)
/// Generate OCR-digit-letter-confusion variants of a 3-char token.
/// Common confusions in WI's small DL font (per round-6 / device
/// telemetry): 1↔L/I, 0↔O, 5↔S, 8↔B, 6↔G. Returns the input plus all
/// 1-substitution variants. Used by contains_allowlist_code to accept
/// "B1K" (OCR misread of "BLK") into the hair-color allowlist.
static std::vector<std::string> ocr_digit_letter_variants(
    const std::string& token) {
    static const std::unordered_map<char, std::vector<char>> kSwap = {
        {'1', {'L', 'I'}}, {'0', {'O'}}, {'5', {'S'}},
        {'8', {'B'}}, {'6', {'G'}},
    };
    std::vector<std::string> out{token};
    for (std::size_t i = 0; i < token.size(); ++i) {
        auto it = kSwap.find(token[i]);
        if (it == kSwap.end()) continue;
        // Append one new variant per substitution option. Bounded —
        // typical 3-char tokens have at most 1-2 digit substitutions.
        std::size_t base_count = out.size();
        for (std::size_t j = 0; j < base_count; ++j) {
            for (char alt : it->second) {
                std::string variant = out[j];
                variant[i] = alt;
                out.push_back(variant);
            }
        }
    }
    return out;
}

static bool contains_allowlist_code(
    const std::string& value,
    const std::unordered_set<std::string>& allowlist) {
    // Walk whitespace-delimited tokens, uppercase, length-3-only check.
    std::string upper;
    upper.reserve(value.size());
    for (char c : value) {
        upper.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
    }
    size_t i = 0;
    while (i < upper.size()) {
        size_t start = upper.find_first_not_of(" \t\r\n", i);
        if (start == std::string::npos) break;
        size_t end = upper.find_first_of(" \t\r\n", start);
        if (end == std::string::npos) end = upper.size();
        if (end - start == 3) {
            std::string token = upper.substr(start, 3);
            // Exact match — fast path.
            if (allowlist.count(token) > 0) return true;
            // OCR-digit-letter-confusion fallback. Generate variants
            // and check each. Only matters when token has digits.
            for (const auto& variant : ocr_digit_letter_variants(token)) {
                if (variant != token && allowlist.count(variant) > 0) {
                    return true;
                }
            }
        }
        i = end;
    }
    return false;
}

/// Parse a "city, STATE zip" or "city STATE zip" string into components.
/// Returns true if a structured parse succeeded; populates fields by reference.
///
/// Recognises BOTH 2-letter codes (WI, ON, NY) AND full state/province
/// names (Wisconsin, Ontario, New York) — but ONLY in the canonical
/// city-state-zip position (anchored regex_match, never regex_search),
/// so a street-address token like "2134 Wisconsin St" cannot false-match
/// because that text doesn't satisfy the full city + state + zip shape.
///
/// Output `state_out` is normalised to the canonical 2-letter code
/// (uppercase) regardless of input form. Supports US 5-digit ZIPs and
/// Canadian A1A 1A1 postal codes. Task #36, user ask 2026-05-10.
///
/// Uses a broadened city character class that covers hyphens, periods,
/// and apostrophes — "WINSTON-SALEM", "ST. PAUL", "ST. JOHN'S" all parse.
static bool parse_city_state_zip(const std::string& s,
                                  std::string& city_out,
                                  std::string& state_out,
                                  std::string& zip_out) {
    // Form 1: "<city>, <STATE 2-letter> <ZIP>" — most common US format.
    static const std::regex kUsCodeRe(
        R"(^\s*([A-Za-z][A-Za-z .'\-]*?)[,\s]+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$)",
        std::regex::ECMAScript);
    // Form 2: "<city>, <full state name> <ZIP>" — many state DLs print the
    // full state name on the back. Allow 1-3 capitalised words.
    static const std::regex kUsFullRe(
        R"(^\s*([A-Za-z][A-Za-z .'\-]*?)[,\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s+(\d{5}(?:-\d{4})?)\s*$)",
        std::regex::ECMAScript);
    // Form 3: "<city>, <PROV> <postal>" — Canadian variant with 2-letter +
    // ANA NAN postal code.
    static const std::regex kCaCodeRe(
        R"(^\s*([A-Za-z][A-Za-z .'\-]*?)[,\s]+([A-Z]{2})\s+([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)\s*$)",
        std::regex::ECMAScript);
    // Form 4: Canadian with full province name.
    static const std::regex kCaFullRe(
        R"(^\s*([A-Za-z][A-Za-z .'\-]*?)[,\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s+([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)\s*$)",
        std::regex::ECMAScript);

    auto try_match = [&](const std::regex& re) -> bool {
        std::smatch m;
        if (!std::regex_match(s, m, re)) return false;
        std::string city = trim_ws(m[1].str());
        std::string state_token = trim_ws(m[2].str());
        std::string zip = trim_ws(m[3].str());
        if (city.empty()) return false;
        // Normalise via state_lookup — converts "Wisconsin"→"WI",
        // "ONTARIO"→"ON", and rejects unknown tokens like "Square".
        auto resolved = lookup_state(state_token);
        if (!resolved.has_value()) return false;
        city_out = city;
        state_out = resolved->code;
        zip_out = zip;
        return true;
    };

    // Prefer Form 1 (cheap, most common). Then full name. Then Canadian.
    if (try_match(kUsCodeRe)) return true;
    if (try_match(kUsFullRe)) return true;
    if (try_match(kCaCodeRe)) return true;
    if (try_match(kCaFullRe)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Per-field shape gates (task #81 — round-3 design).
//
// Each YOLO bbox + per-region OCR pass can land an OCR string in a field
// whose YOLO bbox happened to drift over the wrong card region. The voter
// then accepts that wrong reading as the consensus. Until the field
// detector is trained to reject wrong locations confidently, the
// authoritative defense is a per-field shape gate in the extractor.
//
// Gates reject obviously-wrong values (the value goes to nullopt and the
// confidence entry is never recorded). Mild OCR noise that still respects
// the field's character class is allowed through — the gate is shape,
// not allowlist.
// ---------------------------------------------------------------------------

/// Validate a name (firstName, middleName, lastName). Reject if it
/// contains an ASCII digit (license-number-shaped, date-shaped, or
/// address-leading-number-shaped values all fail this), if it contains
/// a comma (typical of the city-state-zip line bleeding through), or if
/// it is too short / too long to be a real name. We deliberately do NOT
/// require capitalization or denylist street tokens (`ST JOHN`, etc.,
/// are plausible names per round-3 guidance).
static bool is_valid_name(const std::string& s) {
    std::string trimmed = trim_ws(s);
    if (trimmed.empty() || trimmed.size() > 60) return false;
    for (unsigned char c : trimmed) {
        if (std::isdigit(c)) return false;
        if (c == ',') return false;
    }
    return true;
}

static std::pair<std::string, std::optional<std::string>>
split_first_middle_name(const std::string& s) {
    std::string trimmed = trim_ws(s);
    std::size_t split = trimmed.find_first_of(" \t\r\n");
    if (split == std::string::npos) {
        return {trimmed, std::nullopt};
    }
    std::string first = trim_ws(trimmed.substr(0, split));
    std::string middle = trim_ws(trimmed.substr(split + 1));
    if (middle.empty()) return {first, std::nullopt};
    return {first, middle};
}

static bool contains_whitespace(const std::string& s) {
    return std::any_of(s.begin(), s.end(), [](unsigned char c) {
        return std::isspace(c) != 0;
    });
}

static bool is_alpha_word_token(const std::string& token) {
    if (token.empty()) return false;
    for (unsigned char c : token) {
        if (!std::isalpha(c)) return false;
    }
    return true;
}

static int alpha_word_token_count(const std::string& s) {
    int count = 0;
    std::size_t i = 0;
    while (i < s.size()) {
        std::size_t start = s.find_first_not_of(" \t\r\n", i);
        if (start == std::string::npos) break;
        std::size_t end = s.find_first_of(" \t\r\n", start);
        if (end == std::string::npos) end = s.size();
        if (is_alpha_word_token(s.substr(start, end - start))) ++count;
        i = end;
    }
    return count;
}

static bool is_valid_license_candidate_value(const std::string& s) {
    std::string trimmed = trim_ws(s);
    if (trimmed.empty()) return false;
    if (alpha_word_token_count(trimmed) >= 2) return false;
    if (strip_whitespace(trimmed).size() < 4) return false;
    if (contains_whitespace(trimmed)) {
        std::string compact = to_upper(strip_whitespace(trimmed));
        static const std::regex kCompactLicenseShape(
            R"(^[A-Z0-9]+(?:-[A-Z0-9]+)*$)", std::regex::ECMAScript);
        return std::regex_match(compact, kCompactLicenseShape);
    }
    return true;
}

static std::optional<std::string> normalize_country_field(
    const std::optional<std::string>& raw) {
    if (!raw.has_value()) return std::nullopt;
    std::string upper = to_upper(trim_ws(raw.value()));
    if (upper.empty()) return std::nullopt;
    static const std::regex kCountryCode(
        R"(^[A-Z]{2,3}$)", std::regex::ECMAScript);
    if (!std::regex_match(upper, kCountryCode)) return std::nullopt;
    return upper;
}

static std::optional<std::string> normalize_endorsements_field(
    const std::optional<std::string>& raw) {
    auto stripped = strip_leading_label(raw, {"END", "ENDORSEMENTS"});
    if (!stripped.has_value()) return std::nullopt;
    std::string upper = to_upper(trim_ws(stripped.value()));
    if (upper.empty()) return std::nullopt;
    static const std::regex kEndorsements(
        R"(^(?:NONE|[A-Z]+)$)", std::regex::ECMAScript);
    if (!std::regex_match(upper, kEndorsements)) return std::nullopt;
    return upper;
}

/// Validate an AAMVA D-20 vehicle class code. Must be 1-3 chars,
/// start with a letter, contain only alphanumerics, AND not be one of
/// the address / direction abbreviations that commonly contaminate the
/// list_9 bbox when YOLO drifts.
static bool is_valid_class_code(const std::string& s) {
    std::string upper = to_upper(trim_ws(s));
    if (upper.empty() || upper.size() > 3) return false;
    if (!std::isalpha(static_cast<unsigned char>(upper[0]))) return false;
    for (unsigned char c : upper) {
        if (!std::isalnum(c)) return false;
    }
    static const std::set<std::string> kDeny = {
        "ST", "RD", "DR", "AVE", "BLVD",
        "LN", "CT", "CIR", "HWY", "PKWY",
        "NONE", "EXP", "EYE", "DOB",
    };
    return kDeny.find(upper) == kDeny.end();
}

/// Validate a street (address line 1) shape. Must start with one of:
///   • house number + space (digits followed by whitespace),
///   • PO BOX (case-insensitive),
///   • RR ###  (rural route),
///   • HC ###  (highway contract).
/// Anything else (city-state-zip lines, free-form OCR garbage, names
/// with no leading digits) is rejected.
static bool is_valid_street_shape(const std::string& s) {
    static const std::regex kStreetRe(
        R"(^(\d+\s|PO\s+BOX|RR\s|HC\s).+)",
        std::regex::ECMAScript | std::regex::icase);
    std::string trimmed = trim_ws(s);
    return !trimmed.empty() && std::regex_search(trimmed, kStreetRe);
}

/// If `street` ends with a duplicate of the already-parsed city-state-zip
/// (this happens when YOLO's list_8f bbox is too tall and per-region OCR
/// reads both address lines), strip the trailing portion and return the
/// cleaned street. If no duplicate suffix found, returns the input
/// unchanged. Comparison is case-insensitive on the city/state, and
/// tolerates an interleaving comma or whitespace.
static std::string strip_trailing_csz(
    const std::string& street,
    const std::optional<std::string>& city,
    const std::optional<std::string>& state,
    const std::optional<std::string>& zip) {
    if (!city.has_value() && !state.has_value() && !zip.has_value()) {
        return street;
    }
    std::string upper_street = to_upper(street);
    // Build a regex tail: optional comma/whitespace, then any of the
    // present components in order. Use a permissive whitespace
    // separator between them.
    std::ostringstream pat;
    pat << "[,\\s]+";
    if (city.has_value()) {
        std::string c = to_upper(*city);
        // Escape regex metas — cities don't contain them in practice
        // but defensive against `ST. JOHN'S` etc.
        std::string esc;
        for (char ch : c) {
            if (ch == '.' || ch == '\\' || ch == '(' || ch == ')' ||
                ch == '[' || ch == ']' || ch == '{' || ch == '}' ||
                ch == '*' || ch == '+' || ch == '?' || ch == '^' ||
                ch == '$' || ch == '|') {
                esc.push_back('\\');
            }
            esc.push_back(ch);
        }
        pat << esc << "\\s*";
    }
    if (state.has_value()) {
        pat << to_upper(*state) << "\\s*";
    }
    if (zip.has_value()) {
        std::string z = *zip;
        // Escape the optional ZIP+4 dash.
        std::string esc;
        for (char ch : z) {
            if (ch == '-') esc.push_back('\\');
            esc.push_back(ch);
        }
        pat << esc;
    }
    pat << "\\s*$";
    try {
        std::regex re(pat.str());
        std::smatch m;
        if (std::regex_search(upper_street, m, re)) {
            return trim_ws(street.substr(0, m.position()));
        }
    } catch (const std::regex_error&) {
        // Malformed city/zip on input — leave street unchanged.
    }
    return street;
}

} // anonymous namespace (structured)

/// Confidence tier scores — see [ValidationTier] in license_data.hpp.
static constexpr float CONFIDENCE_VALIDATED      = to_score(ValidationTier::CrossValidated);
static constexpr float CONFIDENCE_ALL_GATES      = to_score(ValidationTier::AllGatesPassed);
static constexpr float CONFIDENCE_MARKER_LOCATED = to_score(ValidationTier::MarkerLocated);
static constexpr float CONFIDENCE_SHAPE_MATCH    = to_score(ValidationTier::ShapeMatched);
static constexpr float CONFIDENCE_EXTRACTED_RAW  = to_score(ValidationTier::ExtractedRaw);

/// Set the per-field confidence iff the value was populated. Caller
/// determines the tier from extract-time signals (regex match, cross-
/// validation outcome, fallback path used). Idempotent — last write wins,
/// which lets later validators upgrade a field (e.g. state code goes from
/// 0.85 → 1.00 once zip-consistency confirms).
static void record_confidence(LicenseData& out, const char* field,
                               float score) {
    out.fieldConfidence[field] = score;
}

/// Provenance hint for a value read from the FieldsMap. Drives the
/// confidence-tier stamp at the call site.
///   StrictAgrees    — both `<key>_strict` and `<key>` are present and the
///                     trimmed values match. Strongest intra-field signal:
///                     the 4-gate strict parser AND the bbox-IoU matcher
///                     independently converged on the same reading.
///   StrictOnly      — only `<key>_strict` is present (or strict and bbox
///                     disagree; strict wins per #42 design).
///   RegularOnly     — only `<key>` is present.
///   None            — neither key has a non-empty value.
enum class FieldProvenance { None, RegularOnly, StrictOnly, StrictAgrees };

/// Resolve a field with strict-path provenance. The platform-layer 4-gate
/// demographic parser writes its outputs under a `<key>_strict` suffix
/// alongside any value the bbox-IoU matcher produced under `<key>`.
/// Task #42 — round-11 design. Extended in #43: detect agreement.
static std::pair<std::optional<std::string>, FieldProvenance>
read_strict_or_regular(const std::map<std::string, std::string>& fields,
                       const char* base_key) {
    std::string strict_key = std::string(base_key) + "_strict";
    auto sit = fields.find(strict_key);
    auto rit = fields.find(base_key);
    std::optional<std::string> strict_v, regular_v;
    if (sit != fields.end()) {
        std::string v = trim_ws(sit->second);
        if (!v.empty()) strict_v = v;
    }
    if (rit != fields.end()) {
        std::string v = trim_ws(rit->second);
        if (!v.empty()) regular_v = v;
    }
    if (strict_v.has_value() && regular_v.has_value()) {
        return (*strict_v == *regular_v)
            ? std::pair{strict_v, FieldProvenance::StrictAgrees}
            : std::pair{strict_v, FieldProvenance::StrictOnly};
    }
    if (strict_v.has_value())  return {strict_v, FieldProvenance::StrictOnly};
    if (regular_v.has_value()) return {regular_v, FieldProvenance::RegularOnly};
    return {std::nullopt, FieldProvenance::None};
}

/// Map provenance + the field's "regular path" tier to the final score to
/// stamp. StrictAgrees promotes to CrossValidated; StrictOnly maps to
/// AllGatesPassed; RegularOnly uses the caller-supplied [regular_tier].
static float tier_for(FieldProvenance prov, float regular_tier) {
    switch (prov) {
        case FieldProvenance::StrictAgrees: return to_score(ValidationTier::CrossValidated);
        case FieldProvenance::StrictOnly:   return to_score(ValidationTier::AllGatesPassed);
        case FieldProvenance::RegularOnly:  return regular_tier;
        case FieldProvenance::None:         return regular_tier;
    }
    return regular_tier;
}

/// Resolve provenance for a FREE-TEXT field that is read via a PRIORITY KEY
/// LIST (read_first_field) rather than the single `<base>`/`<base>_strict`
/// pair. The strict AAMVA-marker token lives ONLY under [strict_key]; the
/// regular candidates (international MRZ keys, bbox crops) live under
/// [regular_keys], tried in order. This MIRRORS read_strict_or_regular's
/// agreement logic but over a list of regular keys, and crucially it does
/// NOT pick the value — value selection stays with read_first_field over the
/// full ordered list (strict first), so no parsed value changes. We only
/// derive the provenance verdict to drive the confidence stamp:
///   • strict present AND equals the first non-empty regular value
///       → StrictAgrees (two independent paths converged)
///   • strict present (regular absent, or strict ≠ regular — strict wins the
///       value via read_first_field's priority order)
///       → StrictOnly (located by its authoritative marker)
///   • regular only → RegularOnly (an unanchored fallback crop)
///   • neither → None
static FieldProvenance freetext_provenance(
    const std::map<std::string, std::string>& fields,
    const char* strict_key,
    std::initializer_list<const char*> regular_keys) {
    std::optional<std::string> strict_v;
    auto sit = fields.find(strict_key);
    if (sit != fields.end()) {
        std::string v = trim_ws(sit->second);
        if (!v.empty()) strict_v = v;
    }
    std::optional<std::string> regular_v;
    for (const char* k : regular_keys) {
        auto it = fields.find(k);
        if (it == fields.end()) continue;
        std::string v = trim_ws(it->second);
        if (!v.empty()) { regular_v = v; break; }
    }
    if (strict_v.has_value() && regular_v.has_value()) {
        return (*strict_v == *regular_v) ? FieldProvenance::StrictAgrees
                                         : FieldProvenance::StrictOnly;
    }
    if (strict_v.has_value())  return FieldProvenance::StrictOnly;
    if (regular_v.has_value()) return FieldProvenance::RegularOnly;
    return FieldProvenance::None;
}

/// Map provenance to the confidence score for a FREE-TEXT field (name,
/// street). Distinct from tier_for() — a free-text value can never reach the
/// shape-checkable tiers, so its provenance ladder is:
///   StrictAgrees → AllGatesPassed (0.95) — strict marker + a regular path agree;
///                  capped below 1.00 because for free-text the two paths can
///                  share input (Android bbox reads the same whole-card OCR) and
///                  the content itself is unverifiable
///   StrictOnly   → MarkerLocated  (0.88) — located by its authoritative marker,
///                  free-text content (no content-shape verification possible)
///   RegularOnly  → ExtractedRaw   (0.50) — an unanchored fallback crop
///   None         → ExtractedRaw   (0.50) — defensive; caller only stamps when
///                  a value was actually populated
static float tier_for_freetext(FieldProvenance prov) {
    switch (prov) {
        case FieldProvenance::StrictAgrees: return CONFIDENCE_ALL_GATES;
        case FieldProvenance::StrictOnly:   return CONFIDENCE_MARKER_LOCATED;
        case FieldProvenance::RegularOnly:  return CONFIDENCE_EXTRACTED_RAW;
        case FieldProvenance::None:         return CONFIDENCE_EXTRACTED_RAW;
    }
    return CONFIDENCE_EXTRACTED_RAW;
}

// Internal (legacy-shape) extractor. Public surface is
// extract_fields_from_candidates; this function survives as a private
// implementation detail of that one — the FieldsMap shape is a
// convenient internal lookup table that drives the field-by-field
// resolver and the _strict-suffix-driven tier upgrade logic in
// read_strict_or_regular(). v2 Sequence G — task #54.
using FieldsMap = std::map<std::string, std::string>;
static std::optional<LicenseData> extract_fields_structured(const FieldsMap& fields) {
    LicenseData out;

    // Names — international keys take priority over AAMVA list_* keys.
    // Apply the is_valid_name shape gate (no digits, no comma, sensible
    // length) — task #81. A value that fails the gate is treated as
    // "not extracted" so the consumer sees nullopt rather than a
    // license-number or address line in the name slot.
    {
        // Prefer the STRICT AAMVA-index candidate (`list_1_strict`, parsed from
        // the "1 DELGADO" visible-field token) over the detector-bbox class:
        // the per-region OCR path can land the surname/given_name bbox on the
        // wrong name row (observed on iOS — first/last swapped), but the
        // index-token parse is reliable. Bbox classes remain the fallback for
        // layouts that don't print AAMVA index numbers.
        auto raw = read_first_field(fields, {"list_1_strict", "surname", "list_1"});
        if (raw.has_value() && is_valid_name(*raw)) {
            out.lastName = raw;
            // Provenance-aware confidence: a name located by its authoritative
            // AAMVA marker (`list_1_strict`) earns MarkerLocated (0.88) — or
            // CrossValidated (1.00) if a regular path agrees — instead of the
            // bare ExtractedRaw stamp. A name from an unanchored bbox/MRZ
            // fallback only (no strict marker) stays ExtractedRaw (0.50).
            record_confidence(out, "lastName",
                tier_for_freetext(freetext_provenance(
                    fields, "list_1_strict", {"surname", "list_1"})));
        }
    }
    {
        // The AAMVA "2" field (and the international `given_name` class) is
        // first + middle on one row (e.g. WI "MARCUS ANTOINE"), so BOTH the
        // given_name and list_2 paths split on the first space: token 0 ->
        // firstName, remainder -> middleName. A single-token value (no space)
        // splits to just firstName, leaving middleName empty. Strict
        // index-token candidate (`list_2_strict`) preferred over the bbox class
        // (see lastName above for the swap rationale).
        auto raw_given =
            read_first_field(fields, {"list_2_strict", "given_name", "list_2"});
        if (raw_given.has_value() && is_valid_name(*raw_given)) {
            // Provenance is derived from the GIVEN-NAME source (list_2_strict
            // vs given_name/list_2) and shared by both firstName and middleName
            // — they're split out of the same authoritative token, so they
            // carry the same marker-located trust. MarkerLocated (0.88), or
            // AllGatesPassed (0.95) on agreement, instead of bare ExtractedRaw.
            float name_tier = tier_for_freetext(freetext_provenance(
                fields, "list_2_strict", {"given_name", "list_2"}));
            auto split = split_first_middle_name(*raw_given);
            out.firstName = split.first;
            record_confidence(out, "firstName", name_tier);
            if (split.second.has_value() && is_valid_name(*split.second)) {
                out.middleName = split.second;
                record_confidence(out, "middleName", name_tier);
            }
        }
    }

    // Dates — ISO-normalized. If the normalizer accepted the value it
    // necessarily passed a shape gate (8/10-digit pattern with valid
    // m/d/y ranges), so SHAPE_MATCH.
    //
    // round-6 (task #82 follow-on): also accept candidates from
    // the strict-text-pool path (list_*_strict keys) so the demographic
    // parser's fallback for DOB/issue/expire reaches the date
    // normalizer. The text-pool emits values like "DOB 03/27/1976" so
    // strip the label first with strip_leading_label.
    {
        auto pr = read_strict_or_regular(fields, "list_3");
        auto raw = pr.first.has_value()
            ? pr.first
            : read_first_field(fields, {"birthday"});
        auto stripped = strip_leading_label(raw, {"DOB", "BIRTH"});
        out.dateOfBirth = normalize_date_field(stripped);
        if (out.dateOfBirth.has_value())
            record_confidence(out, "dateOfBirth",
                              tier_for(pr.second, CONFIDENCE_SHAPE_MATCH));
    }
    {
        auto pr = read_strict_or_regular(fields, "list_4a");
        auto stripped =
            strip_leading_label(pr.first, {"ISS", "ISSUE", "ISSUED"});
        out.issueDate = normalize_date_field(stripped);
        if (out.issueDate.has_value())
            record_confidence(out, "issueDate",
                              tier_for(pr.second, CONFIDENCE_SHAPE_MATCH));
    }
    {
        auto pr = read_strict_or_regular(fields, "list_4b");
        auto raw = pr.first.has_value()
            ? pr.first
            : read_first_field(fields, {"expire_date"});
        auto stripped =
            strip_leading_label(raw, {"EXP", "EXPIRES", "EXPIRATION"});
        out.expirationDate = normalize_date_field(stripped);
        if (out.expirationDate.has_value())
            record_confidence(out, "expirationDate",
                              tier_for(pr.second, CONFIDENCE_SHAPE_MATCH));
    }

    // License number — strip internal whitespace. Tier:
    //   ShapeMatched (0.85) if value matches `[A-Z0-9]+(?:-[A-Z0-9]+)*`
    //     after stripping (round-16 finding — task #43 carries the
    //     upgrade. The same shape gate already runs in Kotlin's
    //     tightenByContentShape before reaching here, so most production
    //     values that arrive will pass.)
    //   ExtractedRaw (0.50) otherwise.
    // Prefer the STRICT whole-card "4d ..." index parse over the detector-bbox
    // crop: the per-region bbox OCR can clip the DLN's leading/trailing chars
    // (observed on iOS: "J415-...-28" -> "415-...-5573"), whereas the visible-
    // field token parse reads the full row. Bbox classes remain the fallback.
    auto raw_license = read_first_field(fields,
        {"list_4d_strict", "personal_num", "list_4d", "card_num1"});
    if (raw_license.has_value()) {
        // Class-suffix recovery: live WI Pixel logcat showed the lexer
        // capturing CLASS as part of the DLN row ("4d D440-1234-5678-99
        // cLASS D" or "4d D440-...-07 CLASS D"). Peel the trailing
        // "(CLASS|CLAS|GLASS) X" off the DLN value into vehicleClass
        // before canonicalizing the DLN — leaving it attached would
        // produce a "J415...28CLASSD" license number AND keep
        // vehicleClass empty. Task #82 follow-on.
        std::string before_canon = raw_license.value();
        static const std::regex kClassSuffix(
            R"(\s+(?:CLASS|CLAS|CLA5S|GLASS)[\s:]+([A-Z0-9]{1,3})\s*$)",
            std::regex::ECMAScript | std::regex::icase);
        std::smatch csm;
        if (std::regex_search(before_canon, csm, kClassSuffix)) {
            std::string cls = to_upper(csm[1].str());
            if (is_valid_class_code(cls) && !out.vehicleClass.has_value()) {
                out.vehicleClass = cls;
                record_confidence(out, "vehicleClass", CONFIDENCE_EXTRACTED_RAW);
            }
            before_canon = before_canon.substr(0, csm.position(0));
        }
        if (is_valid_license_candidate_value(before_canon)) {
            // Canonicalize: strip internal whitespace AND uppercase. AAMVA D-20
            // license numbers are printed uppercase on the card; lowercase from
            // OCR is itself a noise indicator. Storing the value uppercased
            // also keeps the shape-match regex (which requires `[A-Z0-9]`)
            // honest — without to_upper, `"d12345"` would be stored as-is and
            // miss the ShapeMatched tier. round-18 catch (task #43).
            std::string ln = to_upper(strip_whitespace(before_canon));
            if (!ln.empty()) {
                out.licenseNumber = ln;
                static const std::regex kLicenseShape(
                    R"(^[A-Z0-9]+(?:-[A-Z0-9]+)*$)", std::regex::ECMAScript);
                float ln_tier = std::regex_match(ln, kLicenseShape)
                    ? CONFIDENCE_SHAPE_MATCH
                    : CONFIDENCE_EXTRACTED_RAW;
                record_confidence(out, "licenseNumber", ln_tier);
            }
        }
    }

    // Sex — value came from one of {gender (intl key), list_15_strict
    // (platform 4-gate parser), list_15 (bbox match)}. Tier ladder:
    //   StrictAgrees  → CrossValidated  (1.00)
    //   StrictOnly    → AllGatesPassed  (0.95)
    //   RegularOnly   → ShapeMatched    (0.85) — sex normalizer is a shape check
    {
        auto sex_raw = read_first_field(fields, {"gender"});
        FieldProvenance sex_prov = FieldProvenance::RegularOnly;
        if (!sex_raw.has_value()) {
            auto pr = read_strict_or_regular(fields, "list_15");
            sex_raw = pr.first;
            sex_prov = pr.second;
        }
        out.sex = normalize_sex_field(sex_raw);
        if (out.sex.has_value())
            record_confidence(out, "sex", tier_for(sex_prov, CONFIDENCE_SHAPE_MATCH));
    }

    // Demographic / appearance — same tier ladder as sex, with the
    // RegularOnly fallback at ExtractedRaw (0.50) since the bbox-path
    // values for these classes have no shape gate beyond label stripping.
    {
        auto pr = read_strict_or_regular(fields, "list_16");
        out.height = normalize_height_field(pr.first);
        if (out.height.has_value())
            record_confidence(out, "height", tier_for(pr.second, CONFIDENCE_EXTRACTED_RAW));
    }
    {
        auto pr = read_strict_or_regular(fields, "list_17");
        out.weight = normalize_weight_field(pr.first);
        if (out.weight.has_value())
            record_confidence(out, "weight", tier_for(pr.second, CONFIDENCE_EXTRACTED_RAW));
    }
    {
        auto pr = read_strict_or_regular(fields, "list_18");
        out.eyeColor = normalize_eye_color_field(pr.first);
        if (out.eyeColor.has_value()) {
            // Task #44: an AAMVA canonical 3-letter code earns ShapeMatched.
            // The soft alpha-2 gate that lets "8RO" pass for OCR robustness
            // shouldn't get the same confidence as a verified "BRO" hit.
            float base = contains_allowlist_code(*out.eyeColor, eye_color_codes())
                ? CONFIDENCE_SHAPE_MATCH
                : CONFIDENCE_EXTRACTED_RAW;
            record_confidence(out, "eyeColor", tier_for(pr.second, base));
        }
    }
    {
        auto pr = read_strict_or_regular(fields, "list_19");
        out.hairColor = normalize_hair_color_field(pr.first);
        if (out.hairColor.has_value()) {
            float base = contains_allowlist_code(*out.hairColor, hair_color_codes())
                ? CONFIDENCE_SHAPE_MATCH
                : CONFIDENCE_EXTRACTED_RAW;
            record_confidence(out, "hairColor", tier_for(pr.second, base));
        }
    }

    // Geographic
    out.country = normalize_country_field(read_first_field(fields, {"country"}));
    if (out.country.has_value())
        record_confidence(out, "country", CONFIDENCE_EXTRACTED_RAW);
    // Read raw street value now, but DON'T assign it yet — we need
    // city/state/postalCode to be parsed first so we can strip a
    // trailing duplicate of the city-state-zip line that a too-tall
    // list_8f bbox often picks up (task #81).
    auto raw_street = read_first_field(fields, {"list_8f_strict", "list_8f", "list_5"});

    // City / state / postal — list_8s is the AAMVA "city STATE zip" line.
    // If parse_city_state_zip succeeded, the state came from the
    // state_lookup table which means SHAPE_MATCH on city/state/postal.
    // If state ↔ zip cross-validation ALSO agrees, upgrade to VALIDATED.
    //
    // Strict-first read (mirrors the names path at list_1_strict /
    // list_2_strict): the platform-layer city/state/ZIP scanner emits its
    // "CITY STATE ZIP" reading as a StrictTextPool candidate under
    // `list_8s_strict`. The bbox-IoU `list_8s` crop stays as the fallback.
    // The state ("8") AAMVA index is absent from the demographic parser's
    // index map (no `<X> CITY STATE ZIP` index-label form on the card),
    // so this strict key is fed by a dedicated scanner, not the 4-gate
    // loop — but it routes through the same StrictTextPool → "_strict"
    // suffix convention so it preempts a drifted bbox crop.
    auto csz = read_first_field(fields, {"list_8s_strict", "list_8s"});
    if (csz.has_value()) {
        std::string city, state, zip;
        if (parse_city_state_zip(csz.value(), city, state, zip)) {
            out.city = city;
            out.state = state;
            out.postalCode = zip;
            record_confidence(out, "city", CONFIDENCE_SHAPE_MATCH);
            float zip_state_tier = is_zip_consistent_with_state(state, zip)
                ? CONFIDENCE_VALIDATED : CONFIDENCE_SHAPE_MATCH;
            record_confidence(out, "state", zip_state_tier);
            record_confidence(out, "postalCode", zip_state_tier);
        }
        // Failed split: leave city / state / postalCode EMPTY. Dumping the
        // whole unsplit "<garbage>" line into city produced wrong values like
        // city="FAKETOWN, XX 00000" — a fabricated field is worse than an
        // honest empty one (and `street`, parsed below, still carries the
        // address). The validity gate's address clause already required all
        // three of city+state+postalCode, which a failed split never set, so
        // dropping the city-dump cannot flip has_address.
    }

    // Finalize street — strip any trailing duplicate of the city-state-zip
    // line, then shape-gate the result (task #81). A too-tall list_8f bbox
    // commonly picks up both address lines; once we've parsed CSZ from
    // list_8s above, we can strip it from the end of the raw street.
    if (raw_street.has_value()) {
        std::string cleaned = strip_trailing_csz(
            *raw_street, out.city, out.state, out.postalCode);
        if (is_valid_street_shape(cleaned)) {
            out.street = cleaned;
            // Provenance-aware: a street located by its authoritative AAMVA
            // marker (`list_8f_strict`) earns MarkerLocated (0.88) — or
            // CrossValidated (1.00) if list_8f/list_5 agree — rather than the
            // bare ExtractedRaw stamp. The is_valid_street_shape() gate above
            // is a loose well-formedness check, not the kind of content-shape
            // verification the format-checkable fields earn, so the street
            // stays on the free-text provenance ladder. Provenance is keyed off
            // the SAME ordered key list raw_street was read from, so it matches
            // the value's true source even after CSZ-stripping.
            record_confidence(out, "street",
                tier_for_freetext(freetext_provenance(
                    fields, "list_8f_strict", {"list_8f", "list_5"})));
        }
    }

    // Vehicle class — list_9 is in the strict demographic parser's domain.
    // Apply the AAMVA-class-code shape gate (task #81): 1-3 alphanumeric
    // chars starting with a letter, and not one of the address / direction
    // tokens that commonly drift into the list_9 bbox.
    // restrictions (list_9a) is NOT in the strict path; always EXTRACTED_RAW.
    {
        auto pr = read_strict_or_regular(fields, "list_9");
        if (pr.first.has_value() && is_valid_class_code(*pr.first)) {
            out.vehicleClass = pr.first;
            record_confidence(out, "vehicleClass",
                              tier_for(pr.second, CONFIDENCE_EXTRACTED_RAW));
        }
    }
    // restrictions = list_12 (AAMVA D-20). The previous mapping read
    // list_9a here, which is actually endorsements — round-6
    // caught this. list_9a now correctly populates `endorsements`
    // below. Both surfaces accept the strict-text-pool fallback
    // candidates added in this same round; the demographic parser
    // emits values like "REST NONE" so strip the label first.
    {
        auto pr = read_strict_or_regular(fields, "list_12");
        out.restrictions = strip_leading_label(
            pr.first,
            {"REST", "RESTR", "RESTR.", "RESTRICTIONS", "RSTR"});
        if (out.restrictions.has_value())
            record_confidence(out, "restrictions",
                              tier_for(pr.second, CONFIDENCE_EXTRACTED_RAW));
    }
    {
        auto pr = read_strict_or_regular(fields, "list_9a");
        out.endorsements = normalize_endorsements_field(pr.first);
        if (out.endorsements.has_value())
            record_confidence(out, "endorsements",
                              tier_for(pr.second, CONFIDENCE_EXTRACTED_RAW));
    }

    // Validity check: return a result if ANY core identity field parsed.
    // Each field already passed its own shape gate above, so these are real
    // values, not garbage. nullopt only when the parse produced nothing
    // meaningful. (Loosened from name-or-license: a card with a valid DOB +
    // address but no parseable name and an honestly-empty license number is a
    // useful PARTIAL parse — the old gate discarded the whole result, losing
    // every field. This gate is the last step; fields are already computed, so
    // loosening can only surface more correct fields, never change a value.)
    bool has_name = out.firstName.has_value() || out.lastName.has_value();
    bool has_address = out.street.has_value() ||
        (out.city.has_value() && out.state.has_value() &&
         out.postalCode.has_value());
    if (!has_name && !out.licenseNumber.has_value() &&
        !out.dateOfBirth.has_value() && !has_address) {
        return std::nullopt;
    }

    return out;
}

// ============================================================================
// v2 candidate-evidence path (Sequence C scaffold + Sequence G delete-
// legacy). Translates a typed FieldCandidate vector into the private
// FieldsMap intermediate and dispatches to the now-static
// extract_fields_structured. The FieldsMap shape stays as a private
// implementation detail of this translation unit — round-1
// agreed: keep the internal lookup table, hide the public surface.
//
// Mapping invariants per hpp doc:
//   (a) FieldId → string key (table below)
//   (b) StrictTextPool → "<key>_strict"
//   (c) BboxIoU / Barcode / Manual → "<key>"
//   (d) std::map last-write-wins on key collision
// ============================================================================

namespace {

/// Map a typed FieldId to the legacy string key. Returning nullptr signals
/// "unknown/unsupported" — those candidates are silently dropped, matching
/// extract_fields_structured's behavior on unknown YOLO class names.
static const char* field_id_to_key(FieldId id) {
    switch (id) {
        case FieldId::List1:       return "list_1";
        case FieldId::List2:       return "list_2";
        case FieldId::List3:       return "list_3";
        case FieldId::List4a:      return "list_4a";
        case FieldId::List4b:      return "list_4b";
        case FieldId::List4d:      return "list_4d";
        case FieldId::List5:       return "list_5";
        case FieldId::List8f:      return "list_8f";
        case FieldId::List8s:      return "list_8s";
        case FieldId::List9:       return "list_9";
        case FieldId::List9a:      return "list_9a";
        case FieldId::List12:      return "list_12";
        case FieldId::List15:      return "list_15";
        case FieldId::List16:      return "list_16";
        case FieldId::List17:      return "list_17";
        case FieldId::List18:      return "list_18";
        case FieldId::List19:      return "list_19";
        case FieldId::Surname:     return "surname";
        case FieldId::GivenName:   return "given_name";
        case FieldId::Birthday:    return "birthday";
        case FieldId::ExpireDate:  return "expire_date";
        case FieldId::PersonalNum: return "personal_num";
        case FieldId::Gender:      return "gender";
        case FieldId::Country:     return "country";
        case FieldId::Unknown:     return nullptr;
    }
    return nullptr;
}

} // anonymous namespace

// ============================================================================
// Shared marker-anchored demographic parser (parse_aamva_demographic_fields).
//
// Ported from the duplicated Swift HybridDLScanIOS.parseAamvaDemographicFields
// and Kotlin HybridDLScanAndroid.parseAamvaDemographicFields so the 4-gate
// strict text-pool scan — including the device-observed look-ahead linkage,
// fused-row marker extraction, and name-marker trailing-junk strip — lives in
// ONE place with one regression test. The platforms now call through here.
// ============================================================================

namespace {

/// AAMVA visible-field index → typed FieldId. Mirrors the indexToFieldId map
/// in the former Swift/Kotlin parsers (only the markers the strict parser
/// binds; names included so the marker-anchored 1/2 candidates outrank bbox).
static FieldId demographic_index_to_field_id(const std::string& index) {
    static const std::map<std::string, FieldId> kMap = {
        {"1", FieldId::List1},   {"2", FieldId::List2},
        {"3", FieldId::List3},   {"4a", FieldId::List4a},
        {"4b", FieldId::List4b}, {"4d", FieldId::List4d},
        {"9", FieldId::List9},   {"12", FieldId::List12},
        {"15", FieldId::List15}, {"16", FieldId::List16},
        {"17", FieldId::List17}, {"18", FieldId::List18},
        {"19", FieldId::List19},
    };
    auto it = kMap.find(index);
    return it == kMap.end() ? FieldId::Unknown : it->second;
}

static std::string trim_punct_ends(const std::string& s) {
    std::string t = trim_ws(s);
    // Trim trailing ".,;" (matches Swift trimmingCharacters(.,;) / Kotlin
    // trimEnd('.', ',', ';')). Leading punctuation is not stripped — the
    // value never starts with it after the lexer's label-peek.
    size_t end = t.find_last_not_of(".,;");
    if (end == std::string::npos) return "";
    return t.substr(0, end + 1);
}

/// First regex match (whole-match substring), or empty string on miss.
static std::string first_regex_match(const std::string& value,
                                     const std::regex& re) {
    std::smatch m;
    if (std::regex_search(value, m, re)) return m.str();
    return "";
}

/// Per-AAMVA-index value pre-extractor. OCR concatenates adjacent fields onto
/// one observation ("16 HGT 5'-04 17 WGT 160 lb", "15 SEX M 16 HGT"); the
/// lexer's value span then includes the trailing junk and the anchored domain
/// regex rejects it. Pull JUST the field-shape portion so value_matches_domain
/// sees a clean value. Direct port of Swift/Kotlin extractFieldShape. Returns
/// the input unchanged when no shape applies.
static std::string extract_field_shape(const std::string& index,
                                       const std::string& value) {
    using F = std::regex;
    if (index == "3" || index == "4a" || index == "4b") {
        static const F re(R"((\d{1,2})[/\-](\d{1,2})[/\-](\d{4}))");
        auto m = first_regex_match(value, re);
        return m.empty() ? value : m;
    }
    if (index == "16") {
        static const F re(R"((\d{1,2}'-?\s*\d{1,2}["]?|\d{1,2}-\d{1,2}|\d{3}))");
        auto m = first_regex_match(value, re);
        return m.empty() ? value : m;
    }
    if (index == "17") {
        static const F withUnit(R"((\d{2,3})\s*(?:lbs?|kg))", F::icase);
        auto wu = first_regex_match(value, withUnit);
        if (!wu.empty()) return wu;
        static const F bare(R"(\b(\d{2,3})\b)");
        auto b = first_regex_match(value, bare);
        return b.empty() ? value : b;
    }
    if (index == "15") {
        // Sex — a single isolated [MFX]. Uppercase first so a lowercased
        // OCR run still matches. The fused "15 SEX M 18 HGT" reduces to "M".
        static const F re(R"(\b([MFX])\b)");
        auto m = first_regex_match(to_upper(value), re);
        return m.empty() ? value : m;
    }
    if (index == "12") {
        static const F none(R"(\b(NONE|N/A)\b)", F::icase);
        auto n = first_regex_match(value, none);
        if (!n.empty()) return to_upper(n);
        static const F code(R"(\b([A-Z]{1,3})\b)");
        auto c = first_regex_match(value, code);
        return c.empty() ? value : c;
    }
    if (index == "4d") {
        static const F re(R"([A-Za-z0-9][A-Za-z0-9-]{3,})");
        auto m = first_regex_match(value, re);
        return m.empty() ? value : m;
    }
    return value;
}

/// Recover a BARE-RUN-OF-DIGITS (or space-grouped / alpha-prefixed) licence
/// number out of a 4d value/look-ahead row, returning the cleaned licence
/// string or "" when the row carries no licence-shaped value.
///
/// This exists because the lexer's 4d value-domain regex
/// (^[A-Za-z0-9][A-Za-z0-9-]{3,31}$) only accepts a SINGLE whitespace-free
/// token — so it rejects the common US-jurisdiction layouts where the DLN is:
///   • a bare run of digits on its own line   (NV "3364620541", UT "775298128",
///     NC "574792379241", DC "8138430")        — the "4d ID NO." / "4d DLN" /
///                                                "4d.DLN" label sits on the
///                                                PRECEDING observation;
///   • space-grouped digits                    (PA "48 604 659", "23 050 852"),
///     optionally with a residual label prefix on the same row
///     ("4dDLN: 65 552 080", "DLN: 48 604 659");
///   • an alpha-prefixed run                    (AZ "D92356369", WV "W909785").
///
/// The function scans for the FIRST license-shaped run — alnum groups joined by
/// single spaces or hyphens — that (a) contains at least one digit (so a pure
/// label word like "DLN"/"OLN"/"ID NO"/"WISCONSIN" is rejected, never
/// fabricating a value) and (b) compacts to a US-DLN length (4-13 chars, or up
/// to 20 when hyphen-formatted like WI "J415-2208-5573-28"). Internal spaces
/// are collapsed; hyphens are preserved (the resolver canonicalizes them).
///
/// NO-FABRICATION: every returned character comes verbatim from the OCR row.
/// A leading character the OCR genuinely dropped (CA "DL 9972261" for GT
/// "I9972261") is NOT invented here — the honest short value is returned and
/// scores edit1, not strict, which is correct.
///
/// Caller-anchored: this is ONLY invoked from the 4d marker / 4d look-ahead
/// path, so a digit run elsewhere on the card (DOB, the "5 DD" audit number,
/// an address house number) can never reach it as a licence candidate.
static std::string extract_4d_value(const std::string& raw) {
    static const std::regex kRun(
        R"([A-Za-z0-9](?:[A-Za-z0-9 \-]*[A-Za-z0-9])?)");
    auto begin = std::sregex_iterator(raw.begin(), raw.end(), kRun);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        std::string run = it->str();
        // Collapse internal whitespace ("48 604 659" -> "48604659").
        std::string compact;
        compact.reserve(run.size());
        for (char c : run) {
            if (!std::isspace(static_cast<unsigned char>(c))) compact.push_back(c);
        }
        // Must carry at least one digit — a bare label/banner word is not a DLN.
        if (!std::any_of(compact.begin(), compact.end(), [](unsigned char ch) {
                return std::isdigit(ch) != 0;
            })) {
            continue;
        }
        // US-DLN length gate on the alphanumeric core (hyphens excluded from
        // the count). Hyphen-formatted licences (WI "J415-...-28") run longer.
        std::size_t alnum = 0;
        bool hyphen = false;
        for (char c : compact) {
            if (c == '-') hyphen = true;
            else ++alnum;
        }
        std::size_t max_len = hyphen ? 20 : 13;
        if (alnum < 4 || alnum > max_len) continue;
        // YEAR-COLLISION GATE: a bare 4-digit 19xx/20xx run is a calendar year
        // bleeding off an adjacent date row (the "46 EXP <date>" expiry line
        // lexes as a SECOND "4d" token via the pinned 46->4d alias; the
        // look-ahead / shape pull can then surface its "2025"/"2026" year as
        // the licence number — observed on South Dakota, whose real DLN label
        // is an OCR-garbled non-Latin glyph that never lexes). A real US DLN is
        // never a bare 4-digit year, so reject the year and keep scanning for a
        // genuine licence-shaped run. honest-empty > wrong-year.
        if (compact.size() == 4 && std::isdigit((unsigned char)compact[0]) &&
            (compact.compare(0, 2, "19") == 0 || compact.compare(0, 2, "20") == 0) &&
            std::isdigit((unsigned char)compact[2]) &&
            std::isdigit((unsigned char)compact[3])) {
            continue;
        }
        return compact;
    }
    return "";
}

/// True when `v` is a bare 4-digit calendar year (^(19|20)\d\d$). Used to gate
/// the 4d/licence-number emit path: a value that is exactly such a year is a
/// date-row collision, never a real driver-licence number, so it must be
/// rejected (honest-empty) rather than shipped as the DLN.
static bool is_bare_year(const std::string& v) {
    if (v.size() != 4) return false;
    if (!(v[0] == '1' && v[1] == '9') && !(v[0] == '2' && v[1] == '0'))
        return false;
    return std::isdigit((unsigned char)v[2]) && std::isdigit((unsigned char)v[3]);
}

/// Strip trailing non-name tokens from an AAMVA name-row value. The WI scan
/// produced "MARCUS ANTOINE ON PA" for marker 2 — the trailing "ON PA" is an
/// adjacent endorsement-line OCR artifact. Heuristic, conservative: keep the
/// FIRST two alphabetic tokens (first + middle) and only drop tokens beyond a
/// real given-name pair when the value has >2 tokens. A 1- or 2-token value is
/// returned unchanged so clean "MARIA ELENA" survives. Hyphenated and
/// apostrophe tokens count as one token. Mirrors the platform-layer intent of
/// keeping firstName/middleName and discarding endorsement bleed.
static std::string strip_trailing_name_junk(const std::string& value) {
    std::string t = trim_ws(value);
    if (t.empty()) return t;
    std::vector<std::string> tokens;
    size_t i = 0;
    while (i < t.size()) {
        size_t start = t.find_first_not_of(" \t\r\n", i);
        if (start == std::string::npos) break;
        size_t end = t.find_first_of(" \t\r\n", start);
        if (end == std::string::npos) end = t.size();
        tokens.push_back(t.substr(start, end - start));
        i = end;
    }
    if (tokens.size() <= 2) return t;  // first + middle (or just first)
    // Keep first two tokens (firstName + middleName); the remainder is
    // treated as adjacent-line OCR bleed. Conservative by design: AAMVA
    // index-2 prints given names only; 3+ "name" tokens on this row is the
    // endorsement-artifact signature observed on the WI card.
    return tokens[0] + " " + tokens[1];
}

/// Scan every observation for a "(CLASS|CLAS|GLASS) X" pattern; return the
/// matched class code uppercased, or "" if none realistic. Port of Swift/Kotlin
/// scanForClass — the WI card fuses CLASS onto the DLN row and may misread
/// "4d", so neither the lexer nor the bbox path produces a List9 candidate.
static std::string scan_for_class(const std::vector<std::string>& observations) {
    static const std::set<std::string> denylist = {
        "ST", "RD", "DR", "AVE", "BLVD", "LN", "CT", "CIR",
        "HWY", "PKWY", "NONE", "N/A",
    };
    static const std::regex re(
        R"(\b(?:CLASS|CLAS|GLASS)[\s:]+([A-Z][A-Z0-9]{0,2})\b)",
        std::regex::icase);
    for (const auto& obs : observations) {
        std::smatch m;
        if (std::regex_search(obs, m, re) && m.size() >= 2) {
            std::string code = to_upper(m[1].str());
            if (denylist.count(code)) continue;
            return code;
        }
    }
    return "";
}

/// Scan every observation for a "CITY STATE ZIP" address line; return the
/// first match verbatim (e.g. "FAIRBROOK, WI 54016") so parse_city_state_zip
/// can split it. Port of Swift/Kotlin scanForCityStateZip. The trailing
/// state+ZIP shape is the discriminator so a street row can't false-match.
static std::string scan_for_city_state_zip(
    const std::vector<std::string>& observations) {
    static const std::regex re(
        R"([A-Za-z][A-Za-z .'\-]*[, ]\s*[A-Za-z]{2}\s+(?:\d{5}(?:-\d{4})?|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d))");
    for (const auto& obs : observations) {
        std::smatch m;
        if (std::regex_search(obs, m, re)) {
            return trim_ws(m.str());
        }
    }
    return "";
}

/// Scan every observation for an AAMVA street (address line 1). The WI card
/// prints it as index-8 ("8 4827 LAKERIDGE DR") on its OWN observation,
/// separate from the city/state/zip line. The lexer recognises index 8 but
/// the demographic index→FieldId map deliberately excludes it (no value-domain
/// gate for free-form street text), so the 4-gate loop never emits a street
/// candidate. Recover it here: a marker-8 observation whose value is
/// street-shaped (house number / PO BOX / RR / HC) becomes the List8f
/// candidate. The is_valid_street_shape gate in the resolver re-checks shape,
/// so a mis-OCR'd "8" on some other row can't leak a bad street through.
static std::string scan_for_street(
    const std::vector<std::string>& observations) {
    for (const auto& obs : observations) {
        for (const auto& token : find_all_aamva_tokens(obs)) {
            if (token.index != "8") continue;
            std::string v = trim_ws(token.value);
            if (v.empty()) continue;
            if (is_valid_street_shape(v)) return v;
        }
    }
    return "";
}

/// Scan for the standalone vehicle-class VALUE when the class LABEL appeared
/// on a label-only observation ("9 QLASS", "9 CLASS", "g CLASS") with no value
/// attached. The WI card prints the class letter ("D") on its own nearby
/// observation. scan_for_class only matches "CLASS X" fused on one line, so it
/// misses this layout. Here: if any observation carries a class label (an
/// index-9 token, or a bare "CLASS"-family label word) and the class value is
/// absent, look at the WHOLE observation list for a lone class-code token
/// ("D") that is a valid class code and not some other field's value.
static std::string scan_for_class_value(
    const std::vector<std::string>& observations) {
    // Confirm a class LABEL is present somewhere (so we don't grab a stray
    // single letter when the card simply didn't print a class field).
    static const std::regex kClassLabel(
        R"(\b(?:CLASS|CLAS|GLASS|QLASS|OLASS)\b)", std::regex::icase);
    bool label_present = false;
    for (const auto& obs : observations) {
        if (std::regex_search(obs, kClassLabel)) { label_present = true; break; }
    }
    if (!label_present) return "";
    // A standalone class value is a single-token observation that is a valid
    // AAMVA class code (1 letter, optionally letter+digit). "DONOR" / "REGULAR"
    // are multi-letter words and fail is_valid_class_code's <=3 + denylist;
    // a lone "D" passes. Require the observation to be EXACTLY the code (after
    // trimming) so a "D" inside a longer word can't match.
    for (const auto& obs : observations) {
        std::string t = trim_ws(obs);
        if (t.size() != 1) continue;  // class value here is the lone letter "D"
        std::string up = to_upper(t);
        if (up.size() == 1 && up[0] >= 'A' && up[0] <= 'Z' &&
            is_valid_class_code(up)) {
            return up;
        }
    }
    return "";
}

/// Scan for the endorsements value. AAMVA index 9a (endorsements) is rarely
/// printed as a clean "9a END NONE" token: WI prints "END NONE" on its own
/// observation, and on some scans the endorsement bleeds into the DOB row
/// ("3 DOB 03/27/1976 sa END NONE"). The "END" label is not an AAMVA index so
/// the 4-gate loop can't bind it. Scan every observation for "END <value>" and
/// return the value uppercased. The endorsement value is a short alpha code
/// ("NONE", "A", "M", "TS", ...) — gate on that shape so the hair color "BLK"
/// from a neighbouring "19 HAIR BLK" token can't leak in. Critically, the
/// "END" match must be a whole word (\bEND\b) so "LAKERIDGE"/"FRIEND" etc.
/// never trigger, and the value token must immediately follow the END label.
static std::string scan_for_endorsements(
    const std::vector<std::string>& observations) {
    static const std::regex re(
        R"(\bEND(?:ORSEMENTS)?[\s:.]+([A-Za-z]{1,5}|N/A)\b)", std::regex::icase);
    for (const auto& obs : observations) {
        std::smatch m;
        if (std::regex_search(obs, m, re) && m.size() >= 2) {
            std::string val = to_upper(trim_ws(m[1].str()));
            // Defensive: never let a color/appearance code masquerade as an
            // endorsement (the bug we're fixing leaked "BLK"/"IRBLK"). Only
            // accept the canonical "NONE"/"N/A" or a real 1-2-char endorsement
            // code; reject 3-letter color codes outright.
            if (val == "NONE" || val == "N/A") return "NONE";
            if (val.size() <= 2) return val;
        }
    }
    return "";
}

/// Scan for eye and hair color codes on the fused WI appearance row
/// "18 EYES BRO 19 HAIRBLK". The lexer can't split index 19 here because
/// "HAIRBLK" has the HAIR label fused to the BLK value with no separator, so
/// match_label_at rejects it (label followed by a letter) and index-18's value
/// swallows the rest. Rather than loosen the lexer's label rule globally
/// (which the round-5/6 invariant tests pin), recover both colors here from
/// the raw row: find "EYE(S) <code>" and "HAIR<code>" / "HAIR <code>" against
/// the AAMVA D-20 allowlists. Emits canonical 3-letter codes; the resolver's
/// normalize_*_color_field re-validates. `eye_out`/`hair_out` are set by ref.
static void scan_for_eye_hair_colors(
    const std::vector<std::string>& observations,
    std::string& eye_out,
    std::string& hair_out) {
    // EYE(S) label then optional separators then a 3-letter color run. The
    // label has a leading word boundary but NOT a trailing one: the WI row
    // fuses the value onto the label with no separator ("HAIRBLK"), and EYES
    // can likewise fuse ("EYESBRO"). A captured 3-letter run that follows the
    // label and matches the allowlist is the discriminator. Allow a trailing
    // noise char the resolver trims (e.g. "BROO").
    static const std::regex eyeRe(
        R"(\bEYE(?:S)?[\s:.]*([A-Za-z]{3})[A-Za-z]?)", std::regex::icase);
    // HAIR label fused or separated from a 3-letter run (NO trailing \b so
    // "HAIRBLK" matches with capture "BLK").
    static const std::regex hairRe(
        R"(\bHAIR[\s:.]*([A-Za-z]{3})[A-Za-z]?)", std::regex::icase);
    for (const auto& obs : observations) {
        std::smatch m;
        if (eye_out.empty() && std::regex_search(obs, m, eyeRe) && m.size() >= 2) {
            std::string code = to_upper(m[1].str());
            if (eye_color_codes().count(code)) eye_out = code;
        }
        if (hair_out.empty() && std::regex_search(obs, m, hairRe) && m.size() >= 2) {
            std::string code = to_upper(m[1].str());
            if (hair_color_codes().count(code)) hair_out = code;
        }
    }
}

/// OCR-noise observation normalizer applied before lexing. Today it recovers
/// ONE device-observed defect: the AAMVA "4d" licence-number marker read as
/// "48" and FUSED directly onto its value with no separator
/// ("48J415-2208-5573-28"). The lexer can't tokenise this — "48" canonicalizes
/// to neither a known index nor the 4d alias (only "46"→"4d" exists), and the
/// bare "4" is rejected by the trailing-digit rule. Rather than add a global
/// "48"→"4d" canonicalize alias (which would let "4800 ST"-style address rows
/// false-match the licence marker and changes a pinned lexer invariant), we
/// surgically rewrite ONLY a whole observation of the exact shape
/// `4[68]<license-shaped-value>` into `4d <value>` so the unchanged lexer then
/// reads a clean 4d token. The value must itself match the 4d value domain, so
/// a random "48HELLO" cannot leak a licence number through.
static std::string normalize_observation_for_lexing(const std::string& obs) {
    std::string t = trim_ws(obs);
    // `4` then a `6` or `8` (the two WI OCR misreads of the `d` glyph), then a
    // value that starts with an alnum and contains only license characters.
    static const std::regex kFused4d(
        R"(^4[68]([A-Za-z0-9][A-Za-z0-9-]{3,31})$)", std::regex::ECMAScript);
    std::smatch m;
    if (std::regex_match(t, m, kFused4d) && m.size() >= 2) {
        std::string value = m[1].str();
        if (value_matches_domain(value, "4d")) {
            return "4d " + value;
        }
    }
    // The "4d" marker glyph is also misread with the leading "4" rendered as
    // "A"/"«" and FUSED onto its visible DL-number label ("DLN"/"OLN"), so the
    // lexer never sees a "4d" index at all:
    //   PA "AdDLN: 23 050 852"  (4dDLN: <spaced digits>)
    //   AZ "AdOLN D92356369"    (4dOLN <alpha-prefixed run>)
    // Rewrite a LEADING misread-marker + DL/OL-number label into a clean
    // "4d <remainder>" so the unchanged lexer reads a 4d token; the 4d
    // same-row recovery then pulls the licence value out of <remainder>. The
    // remainder must itself carry a licence-shaped run (extract_4d_value
    // non-empty), so a non-licence line cannot be rewritten into a 4d marker.
    static const std::regex kMisreadMarkerLabel(
        R"(^[A4][dD][ .]?(?:DLN|OLN|DL|OL)\b[:.\s]*(.+)$)",
        std::regex::ECMAScript);
    if (std::regex_match(t, m, kMisreadMarkerLabel) && m.size() >= 2) {
        std::string remainder = trim_ws(m[1].str());
        if (!extract_4d_value(remainder).empty()) {
            return "4d " + remainder;
        }
    }
    return obs;
}

// ===========================================================================
// ALPHABETIC-LABEL FALLBACK (California-style layouts).
//
// Some jurisdictions (California foremost) print their visible fields with
// ALPHABETIC labels — "LN", "FN", "DL", "DOB", "EXP", "ISS", "SEX", "HGT",
// "WGT", "EYES", "HAIR", "CLASS" — instead of the numeric AAMVA markers
// (1/2/3/4a/4b/4d/15/16/17/18/19) the strict 4-gate lexer anchors on. On a CA
// card the numeric path finds NO tokens at all, so it produced an empty
// candidate set, the resolver returned a null LicenseData (no name / no DLN),
// and every field scored 0 (97.5% null in the cross-jurisdiction guardrail).
//
// This scanner recognises the alphabetic labels and emits the SAME
// FieldId / FieldSource::StrictTextPool candidates the numeric path emits, so
// iOS and Android both benefit from one shared implementation.
//
// NON-REGRESSION DESIGN (why this can't hurt the numeric-marker states):
//
//   Gate (b) — per observation: SKIP any observation whose FIRST non-space
//   token is itself a numeric AAMVA marker (the lexer already binds those).
//   Every WI/WV/PA/NV/UT demographic row is numeric-led ("15 SEX M",
//   "16 HGT ...", "4d ...", "3 DOB ...", "18 EYES BRO 19 HAIR BRO"), so the
//   alphabetic labels SEX/HGT/WGT/EYES/HAIR that ALSO appear on those cards
//   are never re-scanned here.
//
//   Gate (a) — per field, applied by the CALLER: an alphabetic candidate is
//   emitted ONLY for a field the numeric path produced NOTHING for in this
//   sample (the `emitted` set). For a field the numeric path already bound,
//   the alphabetic value is dropped, so it can never overwrite a strict
//   numeric reading. On samples where the numeric path produced nothing for
//   a field, that field was already returning empty (scoring 0), so filling
//   it can only raise or hold the per-field strict% — never lower it.
//
// The two gates are independent and each is sufficient; together they make
// the fallback strictly additive on the numeric-marker states.
// ===========================================================================

/// True iff the FIRST non-space token of `obs` is a numeric AAMVA marker the
/// strict lexer would bind (a leading run of digits, optionally "a"/"b"/"d"
/// suffix, e.g. "15", "4d", "4a"). Used by gate (b) to leave numeric-led rows
/// entirely to the strict path. A leading non-digit (CA's "SEX F", "HGT ...",
/// "DL ...") returns false so the alphabetic scanner engages.
static bool begins_with_numeric_marker(const std::string& obs) {
    std::string t = trim_ws(obs);
    if (t.empty() || !std::isdigit(static_cast<unsigned char>(t[0]))) {
        return false;
    }
    // Take the leading token (up to the first space) and confirm the lexer
    // recognises it as an AAMVA index. This reuses the single source of truth
    // (the lexer) rather than re-encoding the marker grammar here.
    size_t sp = t.find_first_of(" \t");
    std::string head = (sp == std::string::npos) ? t : t.substr(0, sp);
    auto toks = find_all_aamva_tokens(head);
    if (toks.empty()) return false;
    // The token must start at offset 0 of the head — a bare leading numeric
    // marker, not a digit buried after other chars.
    return toks.front().range_begin == 0;
}

/// Pull the FIRST MM/DD/YYYY (or MM-DD-YYYY) date out of `s`, or "" on miss.
static std::string first_date_shape(const std::string& s) {
    static const std::regex re(R"((\d{1,2})[/\-](\d{1,2})[/\-](\d{4}))");
    return first_regex_match(s, re);
}

/// One emitted alphabetic candidate: typed field id + cleaned value.
struct AlphaCandidate {
    FieldId id;
    std::string value;
};

/// Scan whole-card observations for ALPHABETIC field labels and return typed
/// candidates. Gate (b) (skip numeric-led rows) is applied here; gate (a)
/// (emit only for un-bound fields) is applied by the caller against the
/// numeric path's `emitted` set.
///
/// Field-specific shape gates keep a mislabel from leaking the wrong value:
///   • LN / FN  → alpha-only name (is_valid_name), label may be fused
///                ("LNISHIKAWA") or split ("LN AGUILAR"); FN can degrade to a
///                lone "F" prefix on the given-name token.
///   • DL / DLN → license-shaped (>=4 alnum), the lexer's 4d value domain.
///   • DOB/EXP/ISS → first MM/DD/YYYY shape on the row (or, for a label-only
///                row like CA's bare "ISS", the next non-numeric-led row).
///   • SEX      → lone [MFX].
///   • HGT/HT   → foot-prime or "F-II" dash form.
///   • WGT      → 2-3 digit weight WITH a unit/label cue so the height inches
///                ("5-03") can't masquerade as a weight.
///   • EYES/HAIR→ 3-letter AAMVA color code.
static std::vector<AlphaCandidate> scan_alphabetic_label_fields(
    const std::vector<std::string>& observations) {
    std::vector<AlphaCandidate> out;

    // ---- compiled label patterns (case-insensitive) ----------------------
    using F = std::regex;
    // Last name: "LN" then optional separator then the value, OR "LN" fused
    // directly onto the value ("LNISHIKAWA"). Capture the alpha run.
    static const F lnRe(R"(\bLN[\s:.\-]*([A-Za-z][A-Za-z'\- ]*))", F::icase);
    // First name: "FN" (or a lone leading "F") then the value. CA prints the
    // given name as "FN YINGYING", "FNJOHN", or just "FABIGAIL"/"FALIYAH"
    // (the "FN" degraded to a single "F" glued onto the name). We only accept
    // the lone-"F" form when the remainder is a plausible name.
    static const F fnRe(R"(\bFN[\s:.\-]*([A-Za-z][A-Za-z'\- ]*))", F::icase);
    // License number: "DL" (optionally "DLN", optional trailing ".") then the
    // value. The value is license-shaped — handled by the 4d domain gate.
    static const F dlRe(R"(\bDL[N]?\.?[\s:]*([A-Za-z0-9][A-Za-z0-9\- ]{3,}))",
                        F::icase);
    // Date labels. NO trailing word boundary: CA glues the date directly onto
    // the label with no separator ("DOB04/08/1992"), where "B0" carries no \b.
    // The label still needs a LEADING boundary so it can't match mid-word.
    static const F dobRe(R"(\bDOB)", F::icase);
    static const F expRe(R"(\bEXP)", F::icase);
    static const F issRe(R"(\bISS)", F::icase);
    // Sex.
    static const F sexRe(R"(\bSEX[\s:.]*([MFX])\b)", F::icase);
    // Height: HGT/HT label then a foot-prime form or "F-II" dash form.
    static const F hgtRe(
        R"(\bH(?:GT|T)[\s:.]*(\d{1,2}'?-?\s*\d{1,2}["']?|\d{1,2}-\d{1,2}))",
        F::icase);
    // Weight: must carry a unit/label cue so the height inches can't match.
    static const F wgtRe(R"(\b(?:WGT|WT)[\s:.]*(\d{2,3}))", F::icase);
    static const F wgtUnitRe(R"((\d{2,3})\s*(?:lbs?|kg)\b)", F::icase);
    // Colors.
    static const F eyesRe(R"(\bEYES?[\s:.]*([A-Za-z]{3})\b)", F::icase);
    static const F hairRe(R"(\bHAIR[\s:.]*([A-Za-z]{3})\b)", F::icase);

    // Track which fields we've emitted so the FIRST clean match wins (mirrors
    // the strict path's "unique across the pool" preference and avoids two
    // colliding alphabetic candidates for the same field).
    std::set<FieldId> seen;
    auto emit = [&](FieldId id, const std::string& v) {
        if (v.empty() || seen.count(id)) return;
        seen.insert(id);
        out.push_back({id, v});
    };

    const size_t n = observations.size();
    for (size_t oi = 0; oi < n; ++oi) {
        const std::string& obs = observations[oi];
        // Gate (b): numeric-led rows belong to the strict path. Skip them so
        // this scanner never touches a WI/WV/PA/NV/UT demographic row.
        if (begins_with_numeric_marker(obs)) continue;

        std::smatch m;

        // Names — alpha only, comma/digit-free (is_valid_name).
        if (!seen.count(FieldId::List1) &&
            std::regex_search(obs, m, lnRe) && m.size() >= 2) {
            std::string v = strip_trailing_name_junk(trim_ws(m[1].str()));
            if (is_valid_name(v)) emit(FieldId::List1, to_upper(v));
        }
        if (!seen.count(FieldId::List2) &&
            std::regex_search(obs, m, fnRe) && m.size() >= 2) {
            std::string v = strip_trailing_name_junk(trim_ws(m[1].str()));
            if (is_valid_name(v)) emit(FieldId::List2, to_upper(v));
        }

        // License number — gate via the lexer's 4d value domain so a stray
        // "DL" inside a word can't leak a non-license value.
        if (!seen.count(FieldId::List4d) &&
            std::regex_search(obs, m, dlRe) && m.size() >= 2) {
            std::string v = trim_punct_ends(trim_ws(m[1].str()));
            v = extract_field_shape("4d", v);
            if (value_matches_domain(v, "4d") &&
                std::any_of(v.begin(), v.end(), [](unsigned char ch) {
                    return std::isdigit(ch) != 0;
                })) {
                emit(FieldId::List4d, to_upper(v));
            }
        }

        // Dates. The label may carry the date on the same row ("EXP 07/26/2028",
        // "DOB04/08/1992") or be label-only ("ISS" with the date on the next
        // non-numeric-led observation, as CA prints it).
        auto handle_date = [&](const F& label, FieldId id) {
            if (seen.count(id)) return;
            if (!std::regex_search(obs, label)) return;
            std::string d = first_date_shape(obs);
            if (d.empty() && oi + 1 < n &&
                !begins_with_numeric_marker(observations[oi + 1])) {
                // Label-only row: adopt the next row IF it carries no OTHER
                // alphabetic field label (just a bare date), so "ISS" doesn't
                // swallow a labelled neighbour.
                const std::string& next = observations[oi + 1];
                if (!std::regex_search(next, dobRe) &&
                    !std::regex_search(next, expRe) &&
                    !std::regex_search(next, dlRe) &&
                    !std::regex_search(next, sexRe)) {
                    d = first_date_shape(next);
                }
            }
            if (!d.empty()) emit(id, d);
        };
        handle_date(dobRe, FieldId::List3);
        handle_date(expRe, FieldId::List4b);
        handle_date(issRe, FieldId::List4a);

        // Sex.
        if (!seen.count(FieldId::List15) &&
            std::regex_search(obs, m, sexRe) && m.size() >= 2) {
            emit(FieldId::List15, to_upper(m[1].str()));
        }

        // Height.
        if (!seen.count(FieldId::List16) &&
            std::regex_search(obs, m, hgtRe) && m.size() >= 2) {
            emit(FieldId::List16, trim_ws(m[1].str()));
        }

        // Weight — labelled form first, then a bare "<n> lb/kg" unit form
        // (CA glues weight onto the height row: "HGT 5-03 GT 155lb").
        if (!seen.count(FieldId::List17)) {
            if (std::regex_search(obs, m, wgtRe) && m.size() >= 2) {
                emit(FieldId::List17, trim_ws(m[1].str()));
            } else if (std::regex_search(obs, m, wgtUnitRe) && m.size() >= 2) {
                emit(FieldId::List17, trim_ws(m[1].str()));
            }
        }

        // Colors.
        if (!seen.count(FieldId::List18) &&
            std::regex_search(obs, m, eyesRe) && m.size() >= 2) {
            std::string code = to_upper(m[1].str());
            if (eye_color_codes().count(code)) emit(FieldId::List18, code);
        }
        if (!seen.count(FieldId::List19) &&
            std::regex_search(obs, m, hairRe) && m.size() >= 2) {
            std::string code = to_upper(m[1].str());
            if (hair_color_codes().count(code)) emit(FieldId::List19, code);
        }

        // Street (address line 1). CA prints it unlabelled and WITHOUT an
        // AAMVA index ("9835 UNIVERSITY AVENUE"), so scan_for_street (which
        // keys off an index-8 token) never finds it. It IS digit-led, but gate
        // (b) only skipped it if the leading digits canonicalize to a real
        // AAMVA marker — a house number like "9835" does not. is_valid_street_shape
        // re-checks the house-number/PO-BOX/RR/HC shape so a date row
        // ("DD 000...") or "DL 9972261" can't masquerade as a street.
        if (!seen.count(FieldId::List8f)) {
            std::string t = trim_ws(obs);
            if (is_valid_street_shape(t)) emit(FieldId::List8f, t);
        }
    }
    return out;
}

// ===========================================================================
// LABEL-AWARE LOOK-AHEAD (marker + label-phrase + next-line layouts).
//
// Some jurisdictions (Washington DC foremost) print a numeric AAMVA marker
// GLUED to its visible LABEL PHRASE on one OCR row and the actual VALUE on the
// NEXT row:
//
//   "1.FAMILY NAME"  ->  "GARCIA"     (marker 1, value on next line)
//   "2.GIVEN NAMES"  ->  "EMMA"       (marker 2)
//   "4b.EPX"         ->  a date       (marker 4b)
//   "4a.ISS"         ->  a date       (marker 4a)
//   "3.DOB"          ->  a date       (marker 3)
//   "9.CLASS"        ->  "A"          (marker 9)
//
// The lexer matches the index, consumes the "." separator, and (because the
// jurisdiction's label phrase — "FAMILY NAME", "GIVEN NAMES" — is NOT in the
// lexer's visible-label vocabulary) leaves the label phrase AS the token value.
// For the name markers the label phrase ("FAMILY NAME") even passes the index-1
// name-domain regex, so the existing look-ahead (which only fires when the
// same-row value FAILS its domain) never triggers and the LABEL gets bound as
// the field value (DC list_1/list_2 scored strict 0%).
//
// `same_row_value_is_marker_label` recognises, per marker, the set of label
// PHRASES a jurisdiction prints in the value slot. When the same-row value IS
// such a label phrase, the demographic parser treats the marker as having no
// real same-row value and falls into the existing one-step look-ahead — pulling
// the value from the NEXT observation, validated by that marker's domain.
//
// NON-REGRESSION DESIGN (why this can't hurt the numeric-marker states):
//
//   • EXACT WHOLE-VALUE MATCH. The value is normalised (uppercased, internal
//     whitespace collapsed, surrounding punctuation trimmed) and compared for
//     EQUALITY against a small per-marker label set — never a substring/prefix
//     test. A genuine same-row value (WI "J415-2208-5573-28", PA "23 050 852",
//     a real surname "GARCIA", a real class letter "A") never equals a label
//     phrase, so it is left untouched and binds from its own row as before.
//
//   • FALLBACK ONLY. The parser consults this AFTER same-row 4d recovery and
//     ONLY to decide whether to ENTER the look-ahead branch. It can never
//     override a real same-row value, and the look-ahead it enables is itself
//     gated by the next row carrying no AAMVA token of its own AND matching the
//     marker's value domain — so it can only fill a field the marker would
//     otherwise have mis-bound to its own label or left empty.
//
//   • Numeric-marker states (WI/WV/PA/NV/UT) and CA print real values (not the
//     bare label phrase) in the value slot, so the equality test never fires
//     for them; the change is inert on those jurisdictions.
// ===========================================================================

/// Per-marker label PHRASES that some jurisdictions print in the value slot
/// (the marker is glued to its own label, with the value on the next OCR row).
/// Keys are canonical AAMVA indices; values are UPPERCASE, whitespace-collapsed
/// label phrases. Kept deliberately tight to known visible field labels so a
/// genuine value can never be mistaken for a label.
static const std::unordered_map<std::string, std::unordered_set<std::string>>&
marker_label_phrases() {
    static const std::unordered_map<std::string, std::unordered_set<std::string>>
        map = {
            {"1",  {"FAMILY NAME", "FAMILYNAME", "LAST NAME", "LASTNAME",
                    "SURNAME"}},
            {"2",  {"GIVEN NAMES", "GIVEN NAME", "GIVENNAMES", "GIVENNAME",
                    "FIRST NAME", "FIRSTNAME"}},
            {"4d", {"DLN", "OLN", "ID NO", "LIC NO", "LICENSE NO",
                    "LICENCE NO"}},
            {"4a", {"ISS", "ISSUE", "ISSUED", "ISSUE DATE"}},
            {"4b", {"EPX", "EXP", "EXPIRES", "EXP DATE", "EXPIRATION",
                    "EXPIRES ON"}},
            {"3",  {"DOB", "BIRTH", "DATE OF BIRTH"}},
            {"9",  {"CLASS"}},
            {"12", {"RESTRICTIONS", "REST", "RESTR"}},
            {"15", {"SEX"}},
            {"16", {"HGT", "HEIGHT"}},
            {"17", {"WGT", "WEIGHT"}},
            {"18", {"EYES", "EYE"}},
            {"19", {"HAIR"}},
        };
    return map;
}

/// True iff `value` is — EXACTLY, after upper + internal-whitespace-collapse +
/// surrounding-punctuation trim — a recognised label phrase printed in the
/// value slot for `index`. The marker therefore carries NO real same-row value
/// and the caller should fall into the one-step look-ahead. EXACT equality (not
/// substring) is the over-broad-match guard: a real value never equals a label.
static bool same_row_value_is_marker_label(const std::string& index,
                                           const std::string& value) {
    auto it = marker_label_phrases().find(index);
    if (it == marker_label_phrases().end()) return false;
    // Normalise: trim surrounding punctuation/space, uppercase, collapse runs
    // of internal whitespace to a single space ("FAMILY  NAME" -> "FAMILY NAME",
    // ". FAMILY NAME" -> "FAMILY NAME").
    std::string t = trim_ws(value);
    // Strip leading/trailing ".,;:" left by the marker separator ("." in
    // "4d.DLN") or trailing punctuation, then re-trim whitespace.
    size_t b = t.find_first_not_of(".,;: \t");
    size_t e = t.find_last_not_of(".,;: \t");
    if (b == std::string::npos) return false;
    t = t.substr(b, e - b + 1);
    std::string norm;
    norm.reserve(t.size());
    bool last_space = false;
    for (char c : t) {
        unsigned char uc = static_cast<unsigned char>(c);
        if (std::isspace(uc)) {
            if (!norm.empty() && !last_space) {
                norm.push_back(' ');
                last_space = true;
            }
        } else {
            norm.push_back(static_cast<char>(std::toupper(uc)));
            last_space = false;
        }
    }
    if (!norm.empty() && norm.back() == ' ') norm.pop_back();
    return it->second.count(norm) != 0;
}

// ===========================================================================
// MARKER-9 LOOK-AHEAD VALUE GATE — plausible vehicle-class codes only.
//
// The marker-9 (vehicle class) value domain in the lexer is deliberately
// permissive (^[A-Z]{1,3}-?\d?$) so a same-row "9 CLASS B" / "9 CLASS DM"
// binds. That breadth is harmless on the SAME-ROW path (the value sits right
// after the CLASS label, validated across all 10 guardrail states), but it is
// dangerous on the label-aware LOOK-AHEAD path ("9.CLASS" on one row, the
// value on the NEXT row): any stray 1-3-letter token on the following line
// (USA, GRA, SEX, DLN, DOB, EXP, ISS, HGT, WGT, END, DD, DL, the OCR-noise
// "AL") passes the loose regex and binds as vehicleClass. The cross-
// jurisdiction guardrail cannot catch this — IDNet carries NO vehicle-class
// ground truth (list_9 is absent; list_9a is endorsements), so the class
// field is invisible to parser_eval_vision.
//
// This gate constrains ONLY the look-ahead-adopted marker-9 value to a
// PLAUSIBLE US DL class code. Design (allowlist-shape + denylist-backstop):
//
//   • SHAPE: 1-2 uppercase letters with an optional single trailing digit.
//     This provably covers every real US class GT value — the AAMVA core set
//     {A,B,C,D,M}, the state regular-license classes {D,E,R}, and the common
//     printed two-letter combined classes {AM,BM,CM,DM,DJ,MJ} — none of which
//     is ever dropped. (Empirically, the look-ahead path across all 10 states
//     only ever sees the single letters A/B/C; the wider shape is headroom so
//     a future jurisdiction's R/E/DM/DJ on the next line still binds.)
//
//   • The shape cap of <=2 letters already rejects every 3+-letter poisoner
//     (USA/GRA/SEX/DLN/DOB/EXP/ISS/HGT/WGT/END and the 4+-letter banner
//     words). Two length-2 non-class tokens slip past the shape — the "5.DD"
//     audit-number label "DD", the "DL" document-type token, and the OCR
//     misread "AL" — so a small DENYLIST backstops them, alongside any single-
//     /double-letter prefix of a known marker-label phrase. Rejecting "AL"
//     (noise) is correct: an honest empty vehicleClass beats a wrong "AL"
//     (vehicleClass is a non-required field).
//
// SCOPE: applied ONLY in the look-ahead branch, gated on token.index=="9".
// The same-row index-9 path is left byte-identical (guardrail-validated).
static bool is_plausible_vehicle_class(const std::string& value) {
    // Shape: 1-2 uppercase letters + optional single trailing digit.
    static const std::regex kClassShape(R"(^[A-Z]{1,2}\d?$)",
                                        std::regex::ECMAScript);
    if (!std::regex_match(value, kClassShape)) return false;
    // Denylist: length-2 non-class tokens that pass the shape but are never a
    // real class (the "5.DD" audit label, the "DL" doc-type word, the OCR
    // misread "AL"), plus a backstop of recognised non-class marker labels.
    static const std::unordered_set<std::string> kNonClass = {
        "DD", "DL", "AL", "ID", "NO", "OL", "LN",
    };
    return kNonClass.count(value) == 0;
}

}  // anonymous namespace

FieldCandidateVector parse_aamva_demographic_fields(
    const ObservationVector& observations) {
    FieldCandidateVector out;

    // Collect candidate (index -> cleaned values). Gate (a) index ∈ domain,
    // (c) value matches expected-domain regex, (d) unique across the pool.
    // Gate (b) (label compatibility) is a signal only — round-6 downgraded it
    // from reject to non-fatal because Vision/MLKit mangle labels (HGT→HOT).
    struct Entry {
        AamvaToken tok;
        std::string cleaned;
        // True iff `cleaned` was adopted from the NEXT observation via the
        // one-step look-ahead (the marker's own row carried no usable value —
        // e.g. it was a label phrase like "1.FAMILY NAME"). The name emit path
        // must then emit `cleaned`, not the raw token value (which is the
        // label), to avoid re-binding the label as the name.
        bool from_lookahead = false;
    };
    std::map<std::string, std::vector<Entry>> by_index;

    // Pre-normalize observations for lexing (recovers the fused "48<license>"
    // misread of the 4d marker). Look-ahead linkage below also indexes this
    // normalized view so a normalized line participates consistently.
    std::vector<std::string> norm;
    norm.reserve(observations.size());
    for (const auto& o : observations) {
        norm.push_back(normalize_observation_for_lexing(o));
    }

    // ===================================================================
    // POSITIONAL BLOCK-MATCHING (#118) — multi-column label-block /
    // value-block OCR layouts.
    //
    // Some OCR engines emit the left-column visible LABELS as one
    // contiguous run of observations and the right-column VALUES as a
    // SECOND contiguous run, e.g.:
    //
    //   "1.FAMILY NAME" "2.GIVEN NAMES"   "DOE" "JANE"
    //   [---- label block (run>=2) ----]  [- value block (run>=2) -]
    //
    // The one-step look-ahead below is WRONG here: marker 2 (GIVEN NAMES)
    // sees "DOE" (the SURNAME) as its immediately-next observation and
    // binds it as firstName, dropping the real first name "JANE". This
    // pre-pass detects the [label-block][value-block] shape and records a
    // POSITIONAL binding (1st label-marker -> 1st value, 2nd -> 2nd, …),
    // which the main loop consults BEFORE the one-step look-ahead.
    //
    // ADDITIVE / FALLBACK-ONLY. The pre-pass fires ONLY for the specific
    // shape: a run of >=2 consecutive observations each carrying exactly
    // one demographic AAMVA marker whose same-row value is a recognised
    // LABEL phrase (no real same-row value — same_row_value_is_marker_label),
    // immediately followed by a run of >=2 consecutive BARE observations
    // (no AAMVA token at all). Single-column INTERLEAVED layouts (label,
    // value, label, value …) never form a label-run of length >=2, so the
    // pre-pass is inert and the existing one-step look-ahead is unchanged.
    // Numeric-marker same-row states (WI "1 DELGADO") carry a real value,
    // not a label phrase, so they never enter a label block either.
    //
    // `positional_value[oi]` holds the domain-validated value to bind for
    // the label-marker observation at `oi`. `positional_claimed` marks the
    // label-marker observations that participated in a detected block:
    // even when a marker's positionally-paired value FAILS its domain (and
    // so is not recorded in positional_value), the marker is still claimed
    // so it does NOT fall through to the one-step look-ahead and
    // cross-adopt a neighbouring value.
    std::unordered_map<std::size_t, std::string> positional_value;
    std::unordered_set<std::size_t> positional_claimed;
    {
        // True iff `oi` is a label-ONLY demographic marker: exactly one
        // demographic AAMVA token whose same-row value is a label phrase.
        auto label_only_marker =
            [&](std::size_t oi, std::string* out_index) -> bool {
            auto toks = find_all_aamva_tokens(norm[oi]);
            if (toks.size() != 1) return false;
            const auto& t = toks[0];
            if (demographic_index_to_field_id(t.index) == FieldId::Unknown) {
                return false;
            }
            std::string val = trim_punct_ends(t.value);
            val = extract_field_shape(t.index, val);
            if (!same_row_value_is_marker_label(t.index, val)) return false;
            if (out_index) *out_index = t.index;
            return true;
        };
        // True iff `oi` is a BARE value observation: non-blank and carrying
        // no AAMVA token of its own.
        auto bare_value = [&](std::size_t oi) -> bool {
            if (trim_ws(norm[oi]).empty()) return false;
            return find_all_aamva_tokens(norm[oi]).empty();
        };
        // Validate a positionally-paired value against its marker's domain.
        // Returns the cleaned value to bind, or "" when it fails the domain.
        // Mirrors EVERY gate the normal look-ahead path applies so the
        // positional path can never bind a value the one-step look-ahead
        // would have rejected:
        //   • 4d: extract_4d_value() pulls the DLN-shaped run, THEN the final
        //     value_matches_domain(.,"4d") gate (the normal path's gate (c))
        //     rejects an edge-shaped run that exceeds the 4d domain regex
        //     (e.g. a hyphenated value longer than the {3,31} cap).
        //   • 9 (vehicle class): the permissive index-9 domain
        //     (^[A-Z]{1,3}-?\d?$) lets broad 1-3-letter tokens (USA/SEX/DLN/
        //     DOB) through, so — exactly like the look-ahead branch — also
        //     require is_plausible_vehicle_class so a bogus next-column token
        //     can't bind List9 (and then suppress the safer class fallback).
        auto positional_domain_value =
            [&](const std::string& index,
                const std::string& raw) -> std::string {
            std::string cand = trim_punct_ends(raw);
            if (index == "4d") {
                std::string recovered = extract_4d_value(cand);
                return value_matches_domain(recovered, index)
                           ? recovered
                           : std::string();
            }
            std::string shaped = extract_field_shape(index, cand);
            if (!value_matches_domain(shaped, index)) return std::string();
            if (index == "9" && !is_plausible_vehicle_class(shaped)) {
                return std::string();
            }
            return shaped;
        };

        std::size_t i = 0;
        while (i < norm.size()) {
            std::string idx;
            if (!label_only_marker(i, &idx)) {
                ++i;
                continue;
            }
            // Gather the maximal run of consecutive label-only markers.
            std::vector<std::size_t> labels;
            std::vector<std::string> label_indices;
            std::size_t j = i;
            while (j < norm.size() && label_only_marker(j, &idx)) {
                labels.push_back(j);
                label_indices.push_back(idx);
                ++j;
            }
            // Immediately-following run of consecutive bare value rows.
            std::vector<std::size_t> values;
            std::size_t k = j;
            while (k < norm.size() && bare_value(k)) {
                values.push_back(k);
                ++k;
            }
            // Block shape requires >=2 labels AND >=2 values.
            if (labels.size() >= 2 && values.size() >= 2) {
                std::size_t pairs = std::min(labels.size(), values.size());
                // Claim EVERY label-marker in the detected block — not just
                // the paired ones. When labels.size() > values.size() the
                // trailing UNPAIRED label-markers have no positional value,
                // but they MUST still be claimed: otherwise the main parse
                // loop reprocesses them and its one-step look-ahead would
                // one-step-ADOPT the first value row's text — e.g. block
                // "1.FAMILY NAME, 2.GIVEN NAMES, 12.RESTRICTIONS" + values
                // "A, BOB": marker 12 (unpaired) would wrongly adopt "A".
                // A claimed-but-unvalued marker has no positional_value entry,
                // so the main loop's positional branch binds NOTHING for it.
                for (std::size_t p = 0; p < labels.size(); ++p) {
                    positional_claimed.insert(labels[p]);
                }
                for (std::size_t p = 0; p < pairs; ++p) {
                    std::string bound = positional_domain_value(
                        label_indices[p], norm[values[p]]);
                    if (!bound.empty()) {
                        positional_value[labels[p]] = bound;
                    }
                }
                // Advance past the consumed label rows so a value row is never
                // re-scanned as the start of a new block. All label-markers in
                // [i, j) are now claimed, so resume at j (after the run).
                i = j;
                continue;
            }
            // Not a block — resume scanning after this label run.
            i = j;
        }
    }

    for (std::size_t oi = 0; oi < norm.size(); ++oi) {
        const std::string& text = norm[oi];
        for (const auto& token : find_all_aamva_tokens(text)) {
            if (demographic_index_to_field_id(token.index) == FieldId::Unknown) {
                continue;  // (a)
            }
            std::string cleaned = trim_punct_ends(token.value);
            cleaned = extract_field_shape(token.index, cleaned);

            // (0-pre) POSITIONAL BLOCK-MATCHING (#118): when this observation
            // is a label-only marker that participated in a detected
            // [label-block][value-block] layout, bind its POSITIONALLY-paired
            // value (recorded in the pre-pass above) instead of the one-step
            // look-ahead — which would wrongly adopt the neighbouring column's
            // value. A claimed marker whose paired value FAILED its domain has
            // no positional_value entry; it binds nothing AND must not fall
            // through to the look-ahead (which would cross-adopt a neighbour),
            // so we `continue` past it. Emitted via the from_lookahead path so
            // the recovered value (not the label phrase) is bound for names/
            // class. This branch fires ONLY for the multi-column block shape;
            // all single-column / interleaved / same-row layouts skip it.
            if (positional_claimed.count(oi)) {
                auto pv = positional_value.find(oi);
                if (pv == positional_value.end()) {
                    continue;  // paired value failed domain — bind nothing
                }
                Entry e;
                e.tok = token;
                e.cleaned = pv->second;
                e.from_lookahead = true;
                by_index[token.index].push_back(std::move(e));
                continue;
            }

            // (0) SAME-ROW 4d recovery: the DLN value can sit on the marker's
            // own row behind a residual label fragment and/or as space-grouped
            // digits the single-token domain regex rejects
            // ("4dDLN: 65 552 080" -> value "DLN: 65 552 080"; "4d.DLN" ->
            // ".DLN"). Pull the licence-shaped run from the token value before
            // we decide whether to look ahead, so a same-row PA "4dDLN: ## ###
            // ###" binds here and never spuriously borrows the next row.
            if (token.index == "4d" &&
                !value_matches_domain(cleaned, token.index)) {
                std::string same_row = extract_4d_value(token.value);
                if (!same_row.empty()) cleaned = same_row;
            }

            // (0b) LABEL-AWARE same-row reset: when the marker's same-row value
            // is itself a recognised LABEL PHRASE for this marker — the
            // jurisdiction glued the marker to its own label and printed the
            // VALUE on the next line ("1.FAMILY NAME" -> "GARCIA",
            // "2.GIVEN NAMES" -> "EMMA", "9.CLASS" -> "A") — there is no real
            // same-row value. Reset `cleaned` to empty so the one-step
            // look-ahead below engages and the label is never bound as the
            // value. EXACT whole-value equality (see same_row_value_is_marker_
            // label) guarantees a genuine same-row value (a real surname, a
            // real DLN, a real class letter) is left untouched, so this is
            // inert on the numeric-marker states (WI/WV/PA/NV/UT) and CA.
            // Applied AFTER same-row 4d recovery so a real same-row 4d value
            // already pulled above is never discarded.
            if (!cleaned.empty() &&
                same_row_value_is_marker_label(token.index, cleaned)) {
                cleaned.clear();
            }

            // (1) One-step LOOK-AHEAD: a marker whose own value is empty or
            // fails its domain adopts the NEXT observation's text — but only
            // when that next observation carries NO AAMVA token of its own
            // (otherwise it is a field in its own right) AND matches this
            // marker's value domain. Recovers the WI licence number where
            // "4d" and "J415-2208-5573-28" land on separate OCR lines.
            bool adopted_next = false;
            if (!value_matches_domain(cleaned, token.index) &&
                oi + 1 < norm.size()) {
                const std::string& next = norm[oi + 1];
                if (find_all_aamva_tokens(next).empty()) {
                    std::string cand = trim_punct_ends(next);
                    if (token.index == "4d") {
                        // 4d-specific recovery: a bare run of digits ("4d ID
                        // NO." / "4d DLN" / "4d.DLN" on the prior row, the
                        // value on this one — NV/UT/NC/DC), space-grouped
                        // digits ("48 604 659" — PA), or an alpha-prefixed run
                        // ("D92356369" — AZ, "W909785" — WV) are all valid DLN
                        // shapes the single-token domain regex rejects.
                        // extract_4d_value REQUIRES a digit, so a tokenless
                        // alpha banner ("WISCONSIN", "DRIVER LICENSE") yields
                        // "" and is NOT adopted — no fabrication.
                        std::string recovered = extract_4d_value(cand);
                        if (!recovered.empty()) { cleaned = recovered; adopted_next = true; }
                    } else if (value_matches_domain(cand, token.index) &&
                               (token.index != "9" ||
                                is_plausible_vehicle_class(cand))) {
                        // Marker-9 (vehicle class) look-ahead is additionally
                        // gated to a PLAUSIBLE class code: the permissive
                        // index-9 domain (^[A-Z]{1,3}-?\d?$) otherwise lets a
                        // stray next-line token (USA/GRA/SEX/DLN/DD/AL…) bind
                        // as vehicleClass. Scoped to this look-ahead branch
                        // only — the same-row path stays byte-identical.
                        cleaned = cand;
                        adopted_next = true;
                    }
                }
            }

            if (!value_matches_domain(cleaned, token.index)) {
                continue;  // (c)
            }
            Entry e;
            e.tok = token;
            e.cleaned = cleaned;
            e.from_lookahead = adopted_next;
            by_index[token.index].push_back(std::move(e));
        }
    }

    // 4d date-collision prune: the pinned lexer aliases "46"->"4d" (a WI OCR
    // misread of the "d" glyph). On cards that print the EXPIRY marker as
    // "46 EXP <date>" (NC reads its "4b EXP" as "46 EXP"), that row lexes as a
    // SECOND 4d token whose value is a date. Left alongside the real DLN 4d
    // entry, the uniqueness gate (d) would drop BOTH and lose the licence
    // number. A real DLN row never carries an MM/DD/YYYY date, so when the 4d
    // bucket holds BOTH a date-shaped entry and a real (non-date) one, drop
    // the date-shaped intruder(s) so the real DLN survives uniqueness.
    //
    // Scoped narrowly: the prune fires ONLY when a non-date 4d entry coexists.
    // If the date entry is the SOLE 4d candidate (e.g. SD, whose real DLN sits
    // behind an OCR-garbled non-Latin "LIC" label that never lexes), the
    // bucket is left untouched — this change never makes such a card's parse
    // worse than the pre-existing behaviour.
    {
        auto it = by_index.find("4d");
        if (it != by_index.end() && it->second.size() > 1) {
            static const std::regex kDateRow(
                R"(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})", std::regex::ECMAScript);
            auto& entries = it->second;
            bool has_non_date = std::any_of(
                entries.begin(), entries.end(), [](const Entry& e) {
                    return !std::regex_search(e.tok.value, kDateRow);
                });
            if (has_non_date) {
                entries.erase(
                    std::remove_if(entries.begin(), entries.end(),
                        [](const Entry& e) {
                            return std::regex_search(e.tok.value, kDateRow);
                        }),
                    entries.end());
            }
        }
    }

    for (const auto& kv : by_index) {
        const std::string& index = kv.first;
        const std::vector<Entry>& entries = kv.second;
        if (entries.size() != 1) continue;  // (d) unique
        FieldId fieldId = demographic_index_to_field_id(index);
        if (fieldId == FieldId::Unknown) continue;
        const Entry& e = entries[0];

        std::string v;
        if (index == "15") {
            // Sex — emit the extracted single [MFX] uppercased.
            v = trim_ws(to_upper(e.cleaned));
        } else if (index == "4d") {
            // Licence number. The resolver peels a fused "<DLN> CLASS X"
            // trailing class off the raw row, so ONLY when the raw value
            // carries that class suffix do we emit the FULL raw row (and let
            // the resolver peel + canonicalize). Otherwise emit e.cleaned: the
            // shape-extracted / same-row / look-ahead-recovered DLN value.
            // This stops the previous "emit raw unless empty" path from
            // shipping a bare label word ("DLN", ".DLN", "OLN", "ID NO.",
            // "DLN: 48 604 659") as the licence number — those score strict 0%
            // because the resolver rejects the label-poisoned value.
            static const std::regex kClassSuffixProbe(
                R"(\s(?:CLASS|CLAS|CLA5S|GLASS)\b)",
                std::regex::ECMAScript | std::regex::icase);
            std::string raw = trim_ws(e.tok.value);
            if (std::regex_search(raw, kClassSuffixProbe)) {
                v = raw;
            } else {
                v = trim_ws(e.cleaned);
            }
            // YEAR-COLLISION GATE (emit chokepoint): when the surviving 4d
            // entry came from a date row ("46 EXP 01/23/2025" lexed as a 4d
            // token via the 46->4d alias) and no real DLN row coexisted to let
            // the date-collision prune above fire, extract_field_shape("4d", …)
            // pulls the bare year "2025" out as the value. A real US DLN is
            // never a bare 4-digit 19xx/20xx year, so drop it to honest-empty
            // rather than ship a wrong year as the licence number. This never
            // changes a currently-correct reading.
            if (is_bare_year(v)) v.clear();
        } else if (index == "1" || index == "2") {
            // Name rows — strip trailing endorsement-line OCR junk (the
            // principled multi-token drop of "... ANTOINE ON PA" extra
            // space-separated tokens) so the strict given/family candidate is
            // clean before the resolver splits it into firstName/middleName.
            // We deliberately do NOT strip a single trailing OCR letter glued
            // onto the last token ("ANTOINEO"): that risked corrupting real
            // middle names, and middleName is a non-required field.
            //
            // When the value was pulled from the NEXT line via the label-aware
            // look-ahead ("1.FAMILY NAME" -> "GARCIA"), the RAW token value is
            // the label phrase, not the name — emit the look-ahead-recovered
            // `e.cleaned` instead so the label is never bound. Same-row name
            // values (WI "MARCUS ANTOINE") still emit the raw row so the
            // trailing-junk strip operates on the full multi-token value.
            v = strip_trailing_name_junk(e.from_lookahead ? e.cleaned
                                                          : e.tok.value);
        } else if (index == "3" || index == "4a" || index == "4b" ||
                   index == "16" || index == "17" ||
                   index == "18" || index == "19" || index == "12") {
            // Dates and appearance/restriction rows — emit the SHAPE-EXTRACTED
            // core (e.cleaned), not the raw token value. OCR fuses adjacent
            // fields and endorsement bleed onto these rows
            // ("3 DOB 03/27/1976 sa END NONE", "18 EYES BRO 19 HAIRBLK");
            // extract_field_shape already isolated the field-shaped portion
            // (the date, the color code, the weight). Emitting the raw value
            // would hand the resolver "03/27/1976 sa END NONE" which its
            // normalize_date_field rejects (not 10-char), dropping the field.
            v = trim_ws(e.cleaned);
        } else {
            // Catch-all (index 9 vehicle class, etc.). When the value came from
            // the label-aware look-ahead ("9.CLASS" -> "A"), the raw token value
            // is the label phrase — emit the recovered `e.cleaned` instead.
            v = trim_ws(e.from_lookahead ? e.cleaned : e.tok.value);
        }
        if (!v.empty()) {
            FieldCandidate c;
            c.id = fieldId;
            c.source = FieldSource::StrictTextPool;
            c.text = v;
            out.push_back(std::move(c));
        }
    }

    // Fallbacks the strict 4-gate loop can't bind from an index→label→value
    // token: vehicle class fused onto the DLN row, and the unlabeled
    // CITY/STATE/ZIP address line. Only emit when not already covered.
    std::set<FieldId> emitted;
    for (const auto& c : out) emitted.insert(c.id);

    if (!emitted.count(FieldId::List9)) {
        // Class fused on a "CLASS X" line ("4d ... CLASS D"), then the lone
        // class-letter layout ("9 CLASS" label-only + "D" on its own line).
        // Both require a REAL class value somewhere in the OCR — we never
        // fabricate one. When the card prints a class label but OCR dropped
        // the value entirely, vehicleClass stays empty (it is a non-required
        // field) rather than assuming the US-regular-DL "D", which would
        // mislabel non-D / CDL / motorcycle / permit cards.
        std::string cls = scan_for_class(observations);
        if (cls.empty()) cls = scan_for_class_value(observations);
        if (!cls.empty()) {
            FieldCandidate c;
            c.id = FieldId::List9;
            c.source = FieldSource::StrictTextPool;
            c.text = cls;
            out.push_back(std::move(c));
        }
    }
    if (!emitted.count(FieldId::List8s)) {
        std::string csz = scan_for_city_state_zip(observations);
        if (!csz.empty()) {
            FieldCandidate c;
            c.id = FieldId::List8s;
            c.source = FieldSource::StrictTextPool;
            c.text = csz;
            out.push_back(std::move(c));
        }
    }
    // Street (address line 1) — AAMVA index 8, excluded from the 4-gate
    // index map (free-form text, no value-domain gate). Recovered by scanner.
    if (!emitted.count(FieldId::List8f)) {
        std::string street = scan_for_street(observations);
        if (!street.empty()) {
            FieldCandidate c;
            c.id = FieldId::List8f;
            c.source = FieldSource::StrictTextPool;
            c.text = street;
            out.push_back(std::move(c));
        }
    }
    // Endorsements — the "END NONE" line (or DOB-row bleed) carries no AAMVA
    // index, so the 4-gate loop can't bind it. Recover via label scan.
    if (!emitted.count(FieldId::List9a)) {
        std::string end = scan_for_endorsements(observations);
        if (!end.empty()) {
            FieldCandidate c;
            c.id = FieldId::List9a;
            c.source = FieldSource::StrictTextPool;
            c.text = end;
            out.push_back(std::move(c));
        }
    }
    // Eye / hair color — the fused "18 EYES BRO 19 HAIRBLK" row defeats the
    // lexer's value-boundary scan (HAIR fused to BLK without a separator),
    // so neither List18 nor List19 binds. Recover both from the raw row.
    {
        std::string eye, hair;
        scan_for_eye_hair_colors(observations, eye, hair);
        if (!emitted.count(FieldId::List18) && !eye.empty()) {
            FieldCandidate c;
            c.id = FieldId::List18;
            c.source = FieldSource::StrictTextPool;
            c.text = eye;
            out.push_back(std::move(c));
        }
        if (!emitted.count(FieldId::List19) && !hair.empty()) {
            FieldCandidate c;
            c.id = FieldId::List19;
            c.source = FieldSource::StrictTextPool;
            c.text = hair;
            out.push_back(std::move(c));
        }
    }

    // Alphabetic-label fallback (California-style layouts). LAST so it sees
    // everything the numeric path + the other scanners emitted: gate (a)
    // emits an alphabetic candidate ONLY for a field nothing else bound in
    // this sample. Rebuild `emitted` from the FULL current candidate set so
    // the alphabetic values are strictly additive and can never overwrite a
    // numeric/scanner reading (the non-regression guarantee for WI/WV/PA/
    // NV/UT — see scan_alphabetic_label_fields' header).
    {
        std::set<FieldId> covered;
        for (const auto& c : out) covered.insert(c.id);
        for (const auto& ac : scan_alphabetic_label_fields(observations)) {
            if (covered.count(ac.id)) continue;
            FieldCandidate c;
            c.id = ac.id;
            c.source = FieldSource::StrictTextPool;
            c.text = ac.value;
            out.push_back(std::move(c));
            covered.insert(ac.id);  // keep the first alphabetic match per field
        }
    }
    return out;
}

// v2 Sequence G — the public field_from_key / field_id_to_key_str
// wrappers were deleted along with the legacy Map<String,String> wire
// format. The anonymous-namespace helpers parse_key_to_field and
// field_id_to_key remain as private implementation details of the
// FieldsMap-internal path that extract_fields_from_candidates dispatches
// to. Platform callers should use FieldId / FieldSource directly.

std::optional<LicenseData> extract_fields_from_candidates(
    const FieldCandidateVector& candidates) {
    FieldsMap merged;
    for (const auto& c : candidates) {
        // round-2 hardening: drop FieldSource::Unknown so a buggy
        // caller passing source=0 isn't silently treated as BboxIoU
        // (the bare-key path). Both id and source must be valid for
        // the candidate to participate in the resolver.
        if (c.source == FieldSource::Unknown) continue;
        const char* key = field_id_to_key(c.id);
        if (key == nullptr) continue;
        // StrictTextPool emits under "<key>_strict" so the v1 provenance
        // detection in read_strict_or_regular() picks it up. Bbox /
        // Barcode / Manual all share the bare key. Empty text is skipped
        // so it can't override a non-empty earlier candidate (the v1
        // read_first_field also skips empties via trim_ws).
        if (c.text.empty()) continue;
        std::string out_key(key);
        if (c.source == FieldSource::StrictTextPool) {
            out_key += "_strict";
        }
        // Last-write-wins matches std::map semantics. The caller is
        // responsible for any within-source dedup before passing in.
        merged[out_key] = c.text;
    }
    return extract_fields_structured(merged);
}

} // namespace dlscan
