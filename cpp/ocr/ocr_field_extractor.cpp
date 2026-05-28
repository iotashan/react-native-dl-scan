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
        auto raw = read_first_field(fields, {"surname", "list_1"});
        if (raw.has_value() && is_valid_name(*raw)) {
            out.lastName = raw;
            record_confidence(out, "lastName", CONFIDENCE_EXTRACTED_RAW);
        }
    }
    {
        auto raw = read_first_field(fields, {"given_name", "list_2"});
        if (raw.has_value() && is_valid_name(*raw)) {
            out.firstName = raw;
            record_confidence(out, "firstName", CONFIDENCE_EXTRACTED_RAW);
        }
    }

    // Dates — ISO-normalized. If the normalizer accepted the value it
    // necessarily passed a shape gate (8/10-digit pattern with valid
    // m/d/y ranges), so SHAPE_MATCH.
    //
    // round-6 (task #82 follow-on): also accept candidates from
    // the strict-text-pool path (list_*_strict keys) so the demographic
    // parser's fallback for DOB/issue/expire reaches the date
    // normalizer. The text-pool emits values like "DOB 08/12/1980" so
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
    auto raw_license = read_first_field(fields,
        {"personal_num", "list_4d", "card_num1"});
    if (raw_license.has_value()) {
        // Class-suffix recovery: live WI Pixel logcat showed the lexer
        // capturing CLASS as part of the DLN row ("4d D440-1234-5678-99
        // cLASS D" or "4d D440-...-07 CLASS D"). Peel the trailing
        // "(CLASS|CLAS|GLASS) X" off the DLN value into vehicleClass
        // before canonicalizing the DLN — leaving it attached would
        // produce a "H200...07CLASSD" license number AND keep
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
    out.country = read_first_field(fields, {"country"});
    if (out.country.has_value())
        record_confidence(out, "country", CONFIDENCE_EXTRACTED_RAW);
    // Read raw street value now, but DON'T assign it yet — we need
    // city/state/postalCode to be parsed first so we can strip a
    // trailing duplicate of the city-state-zip line that a too-tall
    // list_8f bbox often picks up (task #81).
    auto raw_street = read_first_field(fields, {"list_8f", "list_5"});

    // City / state / postal — list_8s is the AAMVA "city STATE zip" line.
    // If parse_city_state_zip succeeded, the state came from the
    // state_lookup table which means SHAPE_MATCH on city/state/postal.
    // If state ↔ zip cross-validation ALSO agrees, upgrade to VALIDATED.
    auto csz = read_first_field(fields, {"list_8s"});
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
        } else {
            // Couldn't structure-parse — store raw in city as best effort.
            out.city = csz.value();
            record_confidence(out, "city", CONFIDENCE_EXTRACTED_RAW);
        }
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
            record_confidence(out, "street", CONFIDENCE_EXTRACTED_RAW);
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
    out.endorsements = read_first_field(fields, {"list_9a"});
    if (out.endorsements.has_value())
        record_confidence(out, "endorsements", CONFIDENCE_EXTRACTED_RAW);

    // Validity check: at least a name (first or last) OR a license number.
    // Mirrors extract_ocr_fields's gate.
    bool has_name = out.firstName.has_value() || out.lastName.has_value();
    if (!has_name && !out.licenseNumber.has_value()) {
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
