#pragma once
#include <array>
#include <cstddef>
#include <string_view>

#include "license_data.hpp"

namespace dlscan {
namespace yolo {

/// Class index ordering used by the trained DLScanFieldDetector model.
/// MUST mirror model-training/idnet/prepare_yolo_fields.py FIELD_CLASSES,
/// which is a Python `sorted([...])` of the 30 class names. Changing this
/// table without retraining the model breaks the class-id mapping silently.
constexpr std::size_t kNumClasses = 30;

extern const std::array<const char*, kNumClasses> kFieldClassNames;

/// Returns the class name for a given index, or an empty string if the index
/// is out of range. Annotated returns_nonnull so Swift Cxx-interop imports
/// the return as UnsafePointer<CChar> (non-optional) — the function never
/// returns nullptr (out-of-range yields an empty static string).
const char* class_name_or_empty(int class_id) __attribute__((returns_nonnull));

/// Map a YOLO class index directly to a typed FieldId. Returns
/// FieldId::Unknown for indices that don't correspond to a parseable
/// AAMVA / international field (e.g. face, donor, ghostimg, card_num1,
/// card_num2, list_3c). The mapping is the typed replacement for
/// carrying class-name strings as the source of field identity through
/// the platform pipelines. Out-of-range index → FieldId::Unknown.
///
/// v2 Sequence G — task #54.
FieldId class_id_to_field_id(int class_id);

/// Same lookup keyed by class name string. Used by tooling (parser_eval)
/// and tests that have string-keyed input data — the public platform
/// path uses class_id_to_field_id (no string round-trip).
FieldId class_name_to_field_id(std::string_view class_name);

} // namespace yolo
} // namespace dlscan
