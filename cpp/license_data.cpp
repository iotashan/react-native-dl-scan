#include "license_data.hpp"

// Pulled in for its static_assert(OCR_RECTIFY_H == 807) compile-time guard
// — license_data.cpp is in the dlscan_core test library so the assert
// fires in the GoogleTest build, not just at platform-link time.
#include "constants.hpp"

#include <iomanip>
#include <sstream>
#include <string>

namespace dlscan {

/// Map a numeric confidence score back to its canonical tier name. Used
/// by confidence_json — JS consumers branch on the tier name rather than
/// magic float comparisons. v2 Sequence F (task #51).
///
/// Order matters: scores compare top-down so a score of exactly 0.85f
/// returns "shape_matched" (the canonical tier) rather than falling
/// through, and exactly 0.88f returns "marker_located". Out-of-range
/// scores collapse to the nearest tier.
static const char* tier_name_for_score(float score) {
    if (score >= 1.0f)  return "cross_validated";
    if (score >= 0.95f) return "all_gates_passed";
    if (score >= 0.88f) return "marker_located";
    if (score >= 0.85f) return "shape_matched";
    return "extracted_raw";
}

std::string confidence_json(const LicenseData& ld) {
    if (ld.fieldConfidence.empty()) return "";
    // v2 wire format (round-2 lock): emit each field as a
    // {score, tier} object so JS consumers can branch on the
    // semantic tier name without inspecting magic floats. The native.ts
    // decoder accepts BOTH this shape and the v1 bare-number shape during
    // the migration window.
    std::ostringstream os;
    os << '{';
    bool first = true;
    for (const auto& [k, v] : ld.fieldConfidence) {
        if (!first) os << ',';
        first = false;
        os << '"' << k << "\":{\"score\":" << v
           << ",\"tier\":\"" << tier_name_for_score(v) << "\"}";
    }
    os << '}';
    return os.str();
}

} // namespace dlscan
