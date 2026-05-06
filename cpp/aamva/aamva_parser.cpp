#include "aamva_parser.hpp"

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <map>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

namespace dlscan {
namespace {

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

static std::string trim_whitespace(const std::string& s) {
    const std::string ws = " \t\r\n";
    size_t start = s.find_first_not_of(ws);
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(ws);
    return s.substr(start, end - start + 1);
}

static bool is_aamva_first_char(char c) {
    return c == 'D' || c == 'P' || c == 'Z';
}

static bool is_upper_alnum(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

static bool is_upper_alpha(char c) {
    return c >= 'A' && c <= 'Z';
}

static bool is_digit(char c) {
    return c >= '0' && c <= '9';
}

/// Split a string on any character in `delims`.
static std::vector<std::string> split_any(const std::string& s,
                                          const std::string& delims) {
    std::vector<std::string> parts;
    std::string current;
    for (char c : s) {
        if (delims.find(c) != std::string::npos) {
            parts.push_back(current);
            current.clear();
        } else {
            current += c;
        }
    }
    parts.push_back(current);
    return parts;
}

/// Split on a single delimiter character.
/// When skip_empty is true, omit empty components (matches Swift's split(separator:) default).
static std::vector<std::string> split_char(const std::string& s, char delim,
                                            bool skip_empty = false) {
    std::vector<std::string> parts;
    std::string current;
    for (char c : s) {
        if (c == delim) {
            if (!skip_empty || !current.empty()) parts.push_back(current);
            current.clear();
        } else {
            current += c;
        }
    }
    if (!skip_empty || !current.empty()) parts.push_back(current);
    return parts;
}

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

/// Detect AAMVA version from the header.
/// Pattern: (?:ANSI\s?|AAMVA)\d{6}(\d{2})
/// Returns nullopt if not found.
static std::optional<int> detect_version(const std::string& data) {
    // ECMAScript regex matching Swift's NSRegularExpression behavior
    static const std::regex kVersionRe(
        "(?:ANSI\\s?|AAMVA)\\d{6}(\\d{2})",
        std::regex::ECMAScript);
    std::smatch m;
    if (!std::regex_search(data, m, kVersionRe)) return std::nullopt;
    if (m.size() < 2) return std::nullopt;
    try {
        return std::stoi(m[1].str());
    } catch (...) {
        return std::nullopt;
    }
}

// ---------------------------------------------------------------------------
// Date format
// ---------------------------------------------------------------------------

/// Returns "yyyyMMdd" or "MMddyyyy" per Swift's dateFormat(for:country:).
static std::string date_format(std::optional<int> version,
                               const std::optional<std::string>& country) {
    bool is_canada = false;
    if (country.has_value()) {
        std::string upper = country.value();
        std::transform(upper.begin(), upper.end(), upper.begin(),
                       [](unsigned char c) { return std::toupper(c); });
        is_canada = (upper == "CAN");
    }

    if (version.has_value()) {
        switch (version.value()) {
            case 1:  return "yyyyMMdd";
            case 2:  return "MMddyyyy";
            default: return is_canada ? "yyyyMMdd" : "MMddyyyy";
        }
    }
    return is_canada ? "yyyyMMdd" : "MMddyyyy";
}

// ---------------------------------------------------------------------------
// Date parsing (ISO-8601 output)
// ---------------------------------------------------------------------------

/// Parse an 8-char date string using the given format ("yyyyMMdd" or "MMddyyyy").
/// Returns ISO-8601 date string ("yyyy-MM-dd") or empty string on failure.
static std::string parse_date_with_format(const std::string& date_str,
                                           const std::string& fmt) {
    if (date_str.size() != 8) return "";

    std::tm tm{};
    tm.tm_isdst = -1;

    // Manual parsing — std::get_time has platform inconsistencies for %Y vs 4-digit year.
    // Use a strict integer parser: reject any segment containing non-digit characters
    // (std::stoi("1A") returns 1; Swift's Int("1A") returns nil).
    auto strict_parse_uint = [](const std::string& s) -> std::optional<int> {
        if (s.empty()) return std::nullopt;
        for (char c : s) {
            if (!std::isdigit(static_cast<unsigned char>(c))) return std::nullopt;
        }
        size_t pos = 0;
        int v = std::stoi(s, &pos);
        if (pos != s.size()) return std::nullopt;
        return v;
    };

    int y = 0, m = 0, d = 0;
    bool ok = false;

    if (fmt == "yyyyMMdd") {
        // YYYYMMDD
        if (date_str.size() == 8) {
            auto oy = strict_parse_uint(date_str.substr(0, 4));
            auto om = strict_parse_uint(date_str.substr(4, 2));
            auto od = strict_parse_uint(date_str.substr(6, 2));
            if (oy && om && od) {
                y = *oy; m = *om; d = *od;
                ok = true;
            }
        }
    } else {
        // MMddYYYY
        if (date_str.size() == 8) {
            auto om = strict_parse_uint(date_str.substr(0, 2));
            auto od = strict_parse_uint(date_str.substr(2, 2));
            auto oy = strict_parse_uint(date_str.substr(4, 4));
            if (oy && om && od) {
                m = *om; d = *od; y = *oy;
                ok = true;
            }
        }
    }

    if (!ok || y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return "";

    // Round-trip validation: mktime normalizes impossible dates (e.g. Feb 30
    // becomes Mar 1/2). If the fields changed, the original date was invalid.
    {
        std::tm check{};
        check.tm_year = y - 1900;
        check.tm_mon  = m - 1;
        check.tm_mday = d;
        check.tm_hour = 12; // avoid DST midnight edge cases
        std::time_t t = std::mktime(&check);
        if (t == static_cast<std::time_t>(-1)) return "";
        if (check.tm_year != y - 1900 || check.tm_mon != m - 1 || check.tm_mday != d) return "";
    }

    // Emit ISO-8601
    std::ostringstream oss;
    oss << std::setfill('0')
        << std::setw(4) << y << '-'
        << std::setw(2) << m << '-'
        << std::setw(2) << d;
    return oss.str();
}

/// Parse date string to ISO-8601, trying primary format then fallback.
static std::optional<std::string> parse_date(
    const std::optional<std::string>& date_str,
    const std::string& primary_fmt) {
    if (!date_str.has_value()) return std::nullopt;
    const std::string& s = date_str.value();
    if (s.size() != 8) return std::nullopt;

    std::string result = parse_date_with_format(s, primary_fmt);
    if (!result.empty()) return result;

    // Fallback to alternate format
    std::string fallback = (primary_fmt == "MMddyyyy") ? "yyyyMMdd" : "MMddyyyy";
    result = parse_date_with_format(s, fallback);
    if (!result.empty()) return result;

    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Header element extraction
// ---------------------------------------------------------------------------

/// Extract the first data element embedded in an AAMVA header line.
/// Mirrors Swift's extractHeaderElement(from:into:).
static void extract_header_element(const std::string& line,
                                   std::map<std::string, std::string>& elements) {
    const std::vector<char> chars(line.begin(), line.end());
    const int n = static_cast<int>(chars.size());
    int i = 15; // Skip past minimum header length

    while (i < n - 2) {
        // Check for DL/ID subfile marker followed by a valid field code
        if (i + 4 < n) {
            std::string prefix2(chars.begin() + i, chars.begin() + i + 2);
            if (prefix2 == "DL" || prefix2 == "ID") {
                int code_start = i + 2;
                if (code_start + 3 <= n) {
                    std::string code(chars.begin() + code_start,
                                     chars.begin() + code_start + 3);
                    bool all_upper_alpha = true;
                    for (char c : code) {
                        if (!is_upper_alpha(c)) { all_upper_alpha = false; break; }
                    }
                    if (all_upper_alpha && !code.empty() &&
                        is_aamva_first_char(code[0])) {
                        int value_start = code_start + 3;
                        if (value_start < n) {
                            std::string value(chars.begin() + value_start,
                                              chars.end());
                            value = trim_whitespace(value);
                            if (!value.empty()) {
                                elements[code] = value;
                            }
                        }
                        return;
                    }
                }
                i += 2;
                continue;
            }
        }

        // Check for field code directly after offset table digits (no DL/ID marker)
        if (i + 3 <= n) {
            std::string code(chars.begin() + i, chars.begin() + i + 3);
            bool all_upper_alpha = true;
            for (char c : code) {
                if (!is_upper_alpha(c)) { all_upper_alpha = false; break; }
            }
            if (all_upper_alpha && !code.empty() &&
                is_aamva_first_char(code[0]) &&
                i > 0 && is_digit(chars[i - 1])) {
                int value_start = i + 3;
                if (value_start < n) {
                    std::string value(chars.begin() + value_start, chars.end());
                    value = trim_whitespace(value);
                    if (!value.empty()) {
                        elements[code] = value;
                    }
                }
                return;
            }
        }

        ++i;
    }
}

// ---------------------------------------------------------------------------
// Data element extraction
// ---------------------------------------------------------------------------

static std::map<std::string, std::string> extract_data_elements(
    const std::string& data) {
    std::map<std::string, std::string> elements;

    // Split on \n \r \x1C \x1E \x1D
    const std::string delims = "\n\r\x1C\x1E\x1D";
    std::vector<std::string> lines = split_any(data, delims);

    for (const std::string& raw_line : lines) {
        std::string trimmed = trim_whitespace(raw_line);
        if (trimmed.size() < 3) continue;

        std::string code_line = trimmed;

        // Strip DL/ID subfile prefix when followed by a valid element code
        if ((code_line.substr(0, 2) == "DL" || code_line.substr(0, 2) == "ID") &&
            code_line.size() >= 5) {
            std::string after_prefix = code_line.substr(2);
            if (!after_prefix.empty()) {
                char first = after_prefix[0];
                if (first == 'D' || first == 'P' || first == 'Z') {
                    code_line = after_prefix;
                }
            }
        }

        if (code_line.size() < 3) continue;

        std::string code = code_line.substr(0, 3);

        // Valid AAMVA codes: 3 upper-alnum chars starting with D, P, or Z
        bool valid_code = true;
        if (!is_aamva_first_char(code[0])) valid_code = false;
        if (code.size() != 3) valid_code = false;
        if (valid_code) {
            for (char c : code) {
                if (!is_upper_alnum(c)) { valid_code = false; break; }
            }
        }

        if (!valid_code) {
            // Check if this is an AAMVA header with embedded field data
            if (code_line.find("ANSI") != std::string::npos ||
                code_line.find("AAMVA") != std::string::npos) {
                extract_header_element(code_line, elements);
            }
            continue;
        }

        std::string value = code_line.substr(3);
        value = trim_whitespace(value);
        if (!value.empty()) {
            elements[code] = value;
        }
    }

    return elements;
}

// ---------------------------------------------------------------------------
// Sex mapping
// ---------------------------------------------------------------------------

static std::optional<std::string> map_sex(
    const std::map<std::string, std::string>& elements) {
    auto it = elements.find("DBC");
    if (it == elements.end()) return std::nullopt;

    std::string c = trim_whitespace(it->second);
    if (c == "1" || c == "M") return std::string("M");
    if (c == "2" || c == "F") return std::string("F");
    if (c == "9" || c == "X") return std::string("X");
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Postal code cleanup
// ---------------------------------------------------------------------------

static std::optional<std::string> clean_postal_code(
    const std::map<std::string, std::string>& elements) {
    auto it = elements.find("DAK");
    if (it == elements.end()) return std::nullopt;

    std::string trimmed = trim_whitespace(it->second);
    if (trimmed.empty()) return std::nullopt;

    // Strip trailing "0000" padding from US 9-digit zips
    bool all_digits = true;
    for (char c : trimmed) {
        if (!is_digit(c)) { all_digits = false; break; }
    }
    if (trimmed.size() == 9 && all_digits &&
        trimmed.substr(5) == "0000") {
        return trimmed.substr(0, 5);
    }
    return trimmed;
}

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

static std::optional<std::string> clean_name(const std::string* raw) {
    if (!raw) return std::nullopt;
    std::string result = trim_whitespace(*raw);
    if (result.empty()) return std::nullopt;
    // Trim trailing commas
    while (!result.empty() && result.back() == ',') {
        result.pop_back();
        result = trim_whitespace(result);
    }
    return result.empty() ? std::nullopt : std::optional<std::string>(result);
}

static std::optional<std::string> map_get(
    const std::map<std::string, std::string>& m, const std::string& key) {
    auto it = m.find(key);
    if (it == m.end()) return std::nullopt;
    return it->second;
}

static std::optional<std::string> resolve_first_name(
    const std::map<std::string, std::string>& e) {
    // Priority: DAC -> DCT first component -> DAA second component
    auto dac = map_get(e, "DAC");
    if (dac.has_value()) {
        auto n = clean_name(&dac.value());
        if (n.has_value()) return n;
    }

    auto dct = map_get(e, "DCT");
    if (dct.has_value() && !dct.value().empty()) {
        auto parts = split_char(dct.value(), ',', true);
        for (auto& p : parts) p = trim_whitespace(p);
        if (!parts.empty() && !parts[0].empty()) return parts[0];
    }

    auto daa = map_get(e, "DAA");
    if (daa.has_value() && !daa.value().empty()) {
        auto parts = split_char(daa.value(), ',', true);
        for (auto& p : parts) p = trim_whitespace(p);
        if (parts.size() >= 2 && !parts[1].empty()) return parts[1];
    }

    return std::nullopt;
}

static std::optional<std::string> resolve_last_name(
    const std::map<std::string, std::string>& e) {
    // Priority: DCS -> DAB -> DAA first component
    auto dcs = map_get(e, "DCS");
    if (dcs.has_value()) {
        auto n = clean_name(&dcs.value());
        if (n.has_value()) return n;
    }

    auto dab = map_get(e, "DAB");
    if (dab.has_value()) {
        auto n = clean_name(&dab.value());
        if (n.has_value()) return n;
    }

    auto daa = map_get(e, "DAA");
    if (daa.has_value() && !daa.value().empty()) {
        auto parts = split_char(daa.value(), ',', true);
        for (auto& p : parts) p = trim_whitespace(p);
        if (!parts.empty() && !parts[0].empty()) return parts[0];
    }

    return std::nullopt;
}

static std::optional<std::string> resolve_middle_name(
    const std::map<std::string, std::string>& e) {
    // Priority: DAD -> DCT remaining components -> DAA third component
    auto dad = map_get(e, "DAD");
    if (dad.has_value()) {
        auto n = clean_name(&dad.value());
        if (n.has_value()) return n;
    }

    auto dct = map_get(e, "DCT");
    if (dct.has_value() && !dct.value().empty()) {
        auto parts = split_char(dct.value(), ',', true);
        for (auto& p : parts) p = trim_whitespace(p);
        if (parts.size() >= 2) {
            std::vector<std::string> middles;
            for (size_t i = 1; i < parts.size(); ++i) {
                if (!parts[i].empty()) middles.push_back(parts[i]);
            }
            if (!middles.empty()) {
                std::string joined;
                for (size_t i = 0; i < middles.size(); ++i) {
                    if (i > 0) joined += " ";
                    joined += middles[i];
                }
                return joined;
            }
        }
    }

    auto daa = map_get(e, "DAA");
    if (daa.has_value() && !daa.value().empty()) {
        auto parts = split_char(daa.value(), ',', true);
        for (auto& p : parts) p = trim_whitespace(p);
        if (parts.size() >= 3 && !parts[2].empty()) return parts[2];
    }

    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

} // anonymous namespace

std::optional<LicenseData> parse_aamva(const std::string& raw_data) {
    // Must contain ANSI or AAMVA marker
    if (raw_data.find("ANSI") == std::string::npos &&
        raw_data.find("AAMVA") == std::string::npos) {
        return std::nullopt;
    }

    auto elements = extract_data_elements(raw_data);
    if (elements.empty()) return std::nullopt;

    auto version = detect_version(raw_data);
    auto country_opt = map_get(elements, "DCG");
    std::string date_fmt = date_format(version, country_opt);

    LicenseData result;

    // Names
    result.firstName = resolve_first_name(elements);
    result.lastName = resolve_last_name(elements);
    result.middleName = resolve_middle_name(elements);

    // Core fields
    auto daq = map_get(elements, "DAQ");
    if (daq.has_value() && !daq.value().empty()) result.licenseNumber = daq;

    result.dateOfBirth = parse_date(map_get(elements, "DBB"), date_fmt);
    result.expirationDate = parse_date(map_get(elements, "DBA"), date_fmt);
    result.issueDate = parse_date(map_get(elements, "DBD"), date_fmt);

    result.sex = map_sex(elements);

    auto day = map_get(elements, "DAY");
    if (day.has_value() && !day.value().empty()) result.eyeColor = day;

    auto dau = map_get(elements, "DAU");
    if (dau.has_value() && !dau.value().empty()) result.height = dau;

    auto dag = map_get(elements, "DAG");
    if (dag.has_value() && !dag.value().empty()) result.street = dag;

    auto dai = map_get(elements, "DAI");
    if (dai.has_value() && !dai.value().empty()) result.city = dai;

    auto daj = map_get(elements, "DAJ");
    if (daj.has_value() && !daj.value().empty()) result.state = daj;

    result.postalCode = clean_postal_code(elements);

    // Country: DCG or default "USA"
    if (country_opt.has_value() && !country_opt.value().empty()) {
        result.country = country_opt.value();
    } else {
        result.country = "USA";
    }

    // Vehicle class/restrictions/endorsements with v1 fallback to PA* codes
    auto dca = map_get(elements, "DCA");
    auto paa = map_get(elements, "PAA");
    if (dca.has_value() && !dca.value().empty()) {
        result.vehicleClass = dca;
    } else if (paa.has_value() && !paa.value().empty()) {
        result.vehicleClass = paa;
    }

    auto dcb = map_get(elements, "DCB");
    auto pae = map_get(elements, "PAE");
    if (dcb.has_value() && !dcb.value().empty()) {
        result.restrictions = dcb;
    } else if (pae.has_value() && !pae.value().empty()) {
        result.restrictions = pae;
    }

    auto dcd = map_get(elements, "DCD");
    auto paf = map_get(elements, "PAF");
    if (dcd.has_value() && !dcd.value().empty()) {
        result.endorsements = dcd;
    } else if (paf.has_value() && !paf.value().empty()) {
        result.endorsements = paf;
    }

    result.aamvaVersion = version;

    return result;
}

} // namespace dlscan
