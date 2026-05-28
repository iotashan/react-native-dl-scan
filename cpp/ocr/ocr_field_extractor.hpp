#pragma once
#include "license_data.hpp"
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace dlscan {

/// Extract license fields from OCR-recognized text lines (legacy heuristic
/// path). Used when no field detector is available; scans free-form lines
/// for label patterns. Returns std::nullopt if insufficient data could be
/// extracted. Mirrors OCRFieldParser.parseFields(from:) from Swift.
std::optional<LicenseData> extract_ocr_fields(
    const std::vector<std::string>& lines);

/// Extract license fields from a YOLO-field-detector-keyed map.
///
/// Caller contract:
///   - Called only after document classification + field detection have
///     identified per-field text crops and run vendor OCR on each. The
///     platform layer (Swift / Kotlin) is responsible for resolving
///     duplicate-bbox conflicts and label stripping BEFORE this is called.
///   - The map carries exactly one value per YOLO class id. There is no
///     multi-candidate semantics here; if multiple OCR observations matched
///     the same class, the platform layer must have already picked a winner
///     (highest IoU) or concatenated for known multi-line classes.
///   - The AAMVA D-20 field-INDEX prefix (e.g. "1 ", "4d ", "16 ") has been
///     stripped by the platform layer when the matched YOLO class's expected
///     index agrees with the observation's leading token. The C++ side does
///     NOT strip index prefixes.
///   - Visible field LABELS ("HGT", "WGT", "EYES", "HAIR", "SEX:", "DL ",
///     "LICENSE NO ") are NOT pre-stripped by the platform — C++ owns label
///     normalization per field (normalize_height_field, normalize_weight_field,
///     normalize_eye_color_field, normalize_hair_color_field, normalize_sex_field).
///     This split mirrors the responsibility boundary: platform owns geometry
///     and AAMVA index recognition; C++ owns field-value semantics.
///
/// Keys MUST be YOLO class names from the trained DlScanFieldDetector
/// (see model-training/idnet/prepare_yolo_fields.py FIELD_CLASSES). The
/// 30 supported keys include the AAMVA "list_*" series (list_1, list_2,
/// list_3, list_4a, list_4b, list_4d, list_5, list_8f, list_8s, list_9,
/// list_9a, list_15, list_16, list_17, list_18, list_19) and the international-ID series
/// (surname, given_name, birthday, gender, expire_date, personal_num,
/// country). Unknown keys are silently ignored.
///
/// Multi-line classes (list_5, list_8f, list_8s) are expected to arrive
/// pre-concatenated by the platform layer — this function does NOT do
/// bbox-matching or per-observation merging.
///
/// Normalization performed by this function:
///   - Dates: accepts "MM/DD/YYYY", "MM-DD-YYYY", or ISO "YYYY-MM-DD";
///     output is ISO. Unrecognized formats produce nullopt for that field.
///   - Sex: normalized to "M" / "F" / "X". Locale-specific full words
///     (e.g. French "Masculin", Spanish "Femenino") are NOT recognized
///     here — the platform layer should canonicalize before passing in.
///   - License number: internal whitespace stripped.
///   - list_8s: parsed for "city, STATE zip" structure into
///     city/state/postalCode. Unparseable strings fall back to city only.
///
/// Returns std::nullopt if none of {firstName, lastName, licenseNumber}
/// could be extracted (validity gate). All three are accepted: surname-only
/// is normal for international IDs; firstName-only matches AAMVA legacy.
/// v2 candidate-evidence path. Accepts a vector of typed FieldCandidate
/// values; the resolver buckets candidates by (FieldId, FieldSource) and
/// applies tier resolution including the StrictAgrees → CrossValidated
/// (1.00) upgrade when StrictTextPool and BboxIoU candidates converge on
/// the same value (round-2 lock).
///
/// Returns std::nullopt when the validity gate fails ({firstName,
/// lastName, licenseNumber} all empty).
///
/// Named alias for std::vector<FieldCandidate> so Swift Cxx-interop sees
/// a single concrete type — Cxx struggles with the template form.
using FieldCandidateVector = std::vector<FieldCandidate>;

std::optional<LicenseData> extract_fields_from_candidates(
    const FieldCandidateVector& candidates);

} // namespace dlscan
