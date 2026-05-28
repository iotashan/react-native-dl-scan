#pragma once
#include <map>
#include <optional>
#include <string>
#include <vector>
#include "mrz/mrz_data.hpp"

namespace dlscan {

/// Document type — determined at parse time.
/// DriverLicense: AAMVA barcode or OCR without MRZ.
/// Passport / NationalId / ResidencePermit: populated from MRZ parse.
/// Unknown: default when type cannot be determined.
enum class DocumentType {
    DriverLicense,
    Passport,
    NationalId,
    ResidencePermit,
    Unknown
};

/// POD struct representing a parsed driver's license.
/// All fields are optional; present only when successfully parsed.
/// String fields match the keys from the Swift AAMVAParser dictionary output.
struct LicenseData {
    std::optional<std::string> firstName;
    std::optional<std::string> lastName;
    std::optional<std::string> middleName;
    std::optional<std::string> licenseNumber;
    std::optional<std::string> dateOfBirth;
    std::optional<std::string> expirationDate;
    std::optional<std::string> issueDate;
    std::optional<std::string> sex;
    std::optional<std::string> eyeColor;
    std::optional<std::string> hairColor;
    std::optional<std::string> height;
    std::optional<std::string> weight;
    std::optional<std::string> street;
    std::optional<std::string> city;
    std::optional<std::string> state;
    std::optional<std::string> postalCode;
    std::optional<std::string> country;
    std::optional<std::string> vehicleClass;
    std::optional<std::string> restrictions;
    std::optional<std::string> endorsements;
    std::optional<int> aamvaVersion;

    // MRZ / travel document extension (additive; null for driver licenses).
    std::optional<DocumentType> documentType;
    std::optional<MRZData> mrz;

    /// Serialize [fieldConfidence] to a compact JSON object string for
    /// JS-side decoding (Nitro v0.35 generics on Map<string,number> don't
    /// round-trip cleanly through Cxx-interop). Empty map → empty string.
    /// Free function form intentionally — Swift cxx-interop iterates
    /// std::map<string,float> awkwardly, so this gives both Swift and
    /// Kotlin a single call site.
    ///
    /// Per-field confidence scores in [0, 1]. Keys are camelCase field
    /// names matching the struct fields above. Populated by the structured
    /// extractor — see [ValidationTier] below for the canonical scores.
    /// paired design — task #38 (user-requested 2026-05-10),
    /// extended task #42 (AllGatesPassed tier from strict demographic
    /// parser).
    std::map<std::string, float> fieldConfidence;
};

/// Confidence tier for [LicenseData::fieldConfidence] scores. Numeric values
/// are the scores stamped into the map; the enum exists so callers don't
/// sprinkle magic floats. Higher = more trust.
///
/// **Semantic note:** these tiers express the LIBRARY's confidence in
/// having extracted the value correctly, not a truth guarantee about the
/// underlying document. Even CrossValidated (1.00) means "two independent
/// checks within the library agreed" — not "the value on the card is
/// definitely X". Consumers that need a hard truth gate should still
/// validate against an external authority.
///
///   CrossValidated (1.00) — passed two independent checks, e.g.:
///     • state code matches leading-3 ZIP prefix (state_lookup table), OR
///     • bbox-IoU and 4-gate strict paths agree on the same value
///       (intra-field cross-validation, task #43).
///   AllGatesPassed (0.95) — value came from the platform-layer 4-gate
///     strict demographic parser (AAMVA-index ∈ domain, label compatible
///     with index, value matches expected-domain regex, candidate unique
///     across observation pool). Stricter than ShapeMatched because three
///     of the gates are content-aware checks beyond regex shape.
///   ShapeMatched  (0.85) — value matches the field's expected regex shape
///     (e.g. ISO date, normalised sex M/F/X, parseable city-state-zip,
///     `[A-Z0-9]+(?:-[A-Z0-9]+)*` license number).
///   ExtractedRaw  (0.50) — value came from the FieldsMap but the
///     structured extractor couldn't apply any content-shape verification.
enum class ValidationTier {
    CrossValidated = 100,
    AllGatesPassed = 95,
    ShapeMatched   = 85,
    ExtractedRaw   = 50,
};

constexpr float to_score(ValidationTier t) {
    return static_cast<int>(t) / 100.0f;
}

/// Serialize [ld.fieldConfidence] to a compact JSON object string, e.g.
///   {"firstName":0.5,"state":1,"postalCode":1}
/// Empty map → empty string. Used by the JS bridges (Android JNI, iOS
/// Swift cxx-interop) to surface dataConfidenceJson on LicenseDataSpec.
std::string confidence_json(const LicenseData& ld);

// ============================================================================
// Typed candidate-evidence model (v2 Sequence C — task #50)
//
// The platform layer (iOS Swift / Android Kotlin) emits zero or more
// FieldCandidate values per logical field per frame. The C++ resolver
// fuses them into a single LicenseData with per-field confidence tiers.
//
// Provenance — recorded on the candidate, never inferred from string keys.
// This replaces the v1 `_strict` key-suffix hack on map<string,string>:
// the StrictAgrees→CrossValidated tier upgrade is now an explicit check
// against (FieldId, FieldSource) pairs in the resolver, not a presence
// test against a magic suffix.
// ============================================================================

/// Typed field identifier — encodes every AAMVA D-20 visible-field index
/// the parser cares about plus the international ID variants. Stable enum
/// values (do NOT reorder) so the JNI / Swift Cxx wire shape is durable.
enum class FieldId {
    Unknown    = 0,
    // AAMVA D-20 visible-field indices
    List1      = 1,    // family / last name
    List2      = 2,    // given names
    List3      = 3,    // date of birth
    List4a     = 41,   // issue date
    List4b     = 42,   // expiration date
    List4d     = 43,   // licence number (DAQ)
    List5      = 5,    // alt address / state inventory id
    List8f     = 81,   // street (address line 1)
    List8s     = 82,   // city/state/zip (address line 2)
    List9      = 9,    // vehicle class
    List9a     = 91,   // endorsements
    List12     = 12,   // restrictions
    List15     = 15,   // sex
    List16     = 16,   // height
    List17     = 17,   // weight
    List18     = 18,   // eye colour
    List19     = 19,   // hair colour
    // International ID keys (used by MRZ-fed paths)
    Surname    = 100,
    GivenName  = 101,
    Birthday   = 102,
    ExpireDate = 103,
    PersonalNum= 104,
    Gender     = 105,
    Country    = 106,
};

/// Where the value came from. The resolver uses this to pick the right
/// confidence tier when multiple candidates exist for the same field, and
/// to detect agreement between independent extraction paths.
enum class FieldSource {
    Unknown        = 0,
    Barcode        = 1,   // PDF417 digital decode — always CrossValidated
    BboxIoU        = 2,   // YOLO bbox matched to an OCR observation
    StrictTextPool = 3,   // 4-gate AAMVA demographic parser
    Manual         = 4,   // explicitly supplied by host app
};

/// One candidate observation of one field. The resolver consumes a vector
/// of these and produces a LicenseData. Multiple candidates per field
/// are expected and are the input to the multi-frame voter (v2 Sequence D)
/// and to intra-field cross-validation (StrictTextPool agreeing with
/// BboxIoU upgrades the field to CrossValidated/1.00).
///
/// round-2 design note: frameIndex is std::optional — Barcode and
/// Manual sources don't have a frame index. The resolver must NOT
/// deduplicate same-text candidates from different sources before the
/// merge step — source agreement IS the cross-validation signal.
struct FieldCandidate {
    FieldId id = FieldId::Unknown;
    std::string text;
    FieldSource source = FieldSource::Unknown;
    std::optional<float> ocrConfidence;       // raw Vision/MLKit score
    std::optional<float> detectorConfidence;  // YOLO class score
    std::optional<float> iou;                 // bbox-to-observation overlap
    std::optional<int> frameIndex;            // nullopt for Barcode/Manual
};

} // namespace dlscan
