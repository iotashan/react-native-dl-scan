#pragma once
#include <optional>
#include <string>

namespace dlscan {

/// Result of a state/province lookup.
struct StateLookupResult {
    /// Canonical 2-letter code: "WI", "ON", "NY", etc.
    std::string code;
    /// Full canonical name, all caps: "WISCONSIN", "ONTARIO", etc.
    std::string name;
    /// Country code: "US" or "CA".
    std::string country;
};

/// Look up a US state or Canadian province from a free-text token.
///
/// Accepts:
///   - 2-letter codes (case-insensitive): "WI", "wi", "Wi", "ON", "on"
///   - Full names (case-insensitive, with normal whitespace): "Wisconsin",
///     "WISCONSIN", "New York", "British Columbia"
///   - Common variants: "DC" → District of Columbia.
///
/// Returns std::nullopt if the input doesn't match any known state /
/// province. Pure lookup — no fuzzy matching, intentionally strict so that
/// noise like "WI53703" (no separator) or "WISCONSIN ST" (street name)
/// doesn't match. Caller (parse_city_state_zip) is responsible for
/// extracting the right token boundary before calling.
std::optional<StateLookupResult> lookup_state(const std::string& token);

/// Cross-validation: is [zip] consistent with [state_code]'s known
/// ZIP/postal prefix range?
///
///   US: first 3 digits of a 5-digit ZIP must be in the state's range
///       (e.g. WI → 53xxx-54xxx, NY → 100xx-149xx, CA → 900xx-961xx).
///   Canada: first letter of the postal code must be in the province's
///       range (e.g. ON → K/L/M/N/P; BC → V).
///
/// Returns false if either input is empty, the state is unknown, or the
/// ZIP/postal prefix doesn't match. Used as a confidence boost when state
/// and ZIP agree; doesn't reject mismatches at parse time.
bool is_zip_consistent_with_state(const std::string& state_code,
                                  const std::string& zip);

/// Canadian postal-code shape regex pattern (C++ ECMAScript flavour):
///   ANA NAN — 6 chars with optional space between halves.
/// Provided as a constant so callers can build regex objects with it.
extern const char* const kCanadianPostalCodeRegex;

/// US ZIP-code shape: `\d{5}(?:-\d{4})?`
extern const char* const kUsZipCodeRegex;

} // namespace dlscan
