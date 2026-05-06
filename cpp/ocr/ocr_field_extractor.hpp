#pragma once
#include "../license_data.hpp"
#include <optional>
#include <string>
#include <vector>

namespace dlscan {

/// Extract license fields from OCR-recognized text lines.
/// Returns std::nullopt if insufficient data could be extracted.
/// Mirrors OCRFieldParser.parseFields(from:) from Swift.
std::optional<LicenseData> extract_ocr_fields(
    const std::vector<std::string>& lines);

} // namespace dlscan
