#pragma once
#include "../license_data.hpp"
#include <optional>
#include <string>

namespace dlscan {

/// Parse raw AAMVA barcode string into a LicenseData struct.
/// Returns std::nullopt if the data is not valid AAMVA format.
/// Mirrors AAMVAParser.parse(_ rawData: String) from Swift.
std::optional<LicenseData> parse_aamva(const std::string& raw_data);

} // namespace dlscan
