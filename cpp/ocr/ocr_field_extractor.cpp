#include "ocr_field_extractor.hpp"

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

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

} // namespace dlscan
