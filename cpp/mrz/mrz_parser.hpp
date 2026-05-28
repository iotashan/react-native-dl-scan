#pragma once
#include <optional>
#include <string>
#include <vector>
#include "mrz_data.hpp"

namespace dlscan {

/// Parse MRZ from a list of pre-OCR'd text lines.
///
/// Filters lines to those whose length is 30, 36, or 44 and that contain
/// only uppercase letters, digits, and '<'. Tries formats in order:
///   TD3 (2 lines × 44 chars) → TD2 (2 lines × 36 chars) → TD1 (3 lines × 30 chars)
///
/// For each candidate, runs ICAO 9303 check-digit validation. Returns the
/// first structurally valid match (pattern matches + all check digits pass).
/// If no format matches with passing check digits, returns the first
/// structurally-matching candidate with checkDigitsValid = false so the caller
/// can decide whether to trust partial results.
///
/// Returns std::nullopt if no MRZ pattern is detected at all.
std::optional<MRZData> parse_mrz(const std::vector<std::string>& lines);

}  // namespace dlscan
