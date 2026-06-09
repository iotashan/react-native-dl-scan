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
/// Keys MUST be YOLO class names from the trained DLScanFieldDetector
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
///     city/state/postalCode. Unparseable strings leave all three empty
///     (no raw-string fallback into city — a fabricated field is worse than
///     an honest empty one; the separately-parsed `street` still carries the
///     address).
///
/// Returns std::nullopt only when NO core identity field could be extracted —
/// the validity gate accepts any of: a name (first or last), a license number,
/// a date of birth, or an address (street, or city+state+postalCode). A
/// surname-only read is normal for international IDs; a partial parse (e.g.
/// DOB- or address-only) is surfaced and marked incomplete downstream rather
/// than dropped.
/// v2 candidate-evidence path. Accepts a vector of typed FieldCandidate
/// values; the resolver buckets candidates by (FieldId, FieldSource) and
/// applies tier resolution: shape-checkable fields earn StrictAgrees →
/// CrossValidated (1.00) when StrictTextPool and BboxIoU candidates converge,
/// while free-text fields (name/street) use a provenance ladder that caps
/// corroboration at AllGatesPassed (0.95) — their content can't be
/// shape-verified and the two paths can share input.
///
/// Returns std::nullopt only when the validity gate fails — no name, license
/// number, date of birth, or address could be extracted.
///
/// Named alias for std::vector<FieldCandidate> so Swift Cxx-interop sees
/// a single concrete type — Cxx struggles with the template form.
using FieldCandidateVector = std::vector<FieldCandidate>;

std::optional<LicenseData> extract_fields_from_candidates(
    const FieldCandidateVector& candidates);

/// Shared marker-anchored demographic parser (the 4-gate "strict text pool").
///
/// Single source of truth for the visible-field AAMVA-index parse that used
/// to be duplicated in Swift (HybridDLScanIOS.parseAamvaDemographicFields)
/// and Kotlin (HybridDLScanAndroid.parseAamvaDemographicFields). Both
/// platforms now feed their OCR observation texts (in reading order) into
/// this function and emit the returned candidates as FieldSource::
/// StrictTextPool into the multi-frame voter, exactly as before. Moving the
/// orchestration here lets it be unit-tested once and keeps iOS/Android in
/// lock-step.
///
/// Input: `observations` is the OCR reading-order list of whole-card text
/// lines (already ASCII-filtered, already split on AAMVA indices by the
/// platform's splitObservationsByAamvaIndices). bbox geometry is NOT needed
/// here — this parse is text-only.
///
/// Behaviour (the three device-observed fixes baked in):
///   1. One-step LOOK-AHEAD: a bare marker observation (e.g. "4d" with no
///      value, or a marker whose own value fails its domain) adopts the
///      NEXT observation's text as its value when that next observation
///      carries no AAMVA token of its own and matches the marker's domain.
///      Recovers the WI licence number where "4d" and "J415-2208-5573-28"
///      land on separate OCR lines.
///   2. FUSED-ROW marker extraction: a row carrying several markers (e.g.
///      "15 SEX M 18 HOT 5 - 04 17 WOT 160 0") is tokenised per marker and
///      each value is shape-extracted (extract_field_shape) so the sex
///      single-[MFX] is pulled cleanly out of the fused row.
///   3. NAME marker-2 trailing-junk strip: index-2 ("MARCUS ANTOINE ON PA")
///      has trailing non-name endorsement-line artifacts removed so the
///      strict given-name candidate is clean before the resolver splits it
///      into firstName / middleName.
///
/// All emitted candidates carry FieldSource::StrictTextPool. Returns an
/// empty vector when nothing recovers (never nullopt — it is purely
/// additive evidence for the voter).
///
/// Named alias for std::vector<std::string> so Swift Cxx-interop sees a
/// single concrete type for the observation list (matches the
/// FieldCandidateVector alias rationale above — Cxx struggles with the bare
/// template form as a parameter type).
using ObservationVector = std::vector<std::string>;

FieldCandidateVector parse_aamva_demographic_fields(
    const ObservationVector& observations);

} // namespace dlscan
