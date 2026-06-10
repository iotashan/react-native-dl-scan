cmake_minimum_required(VERSION 3.16)

enable_testing()
include(GoogleTest)

# AAMVA parser tests
add_executable(aamva_test
    aamva_test.cpp
)
target_link_libraries(aamva_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(aamva_test)

# OCR field extractor tests
add_executable(ocr_field_test
    ocr_field_test.cpp
)
target_link_libraries(ocr_field_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(ocr_field_test)

# Per-field shape gate regression tests (task #81 — cross-field
# contamination defense). Each gate pins the specific cross-contamination
# case observed during device testing.
add_executable(ocr_shape_gates_test
    ocr_shape_gates_test.cpp
)
target_link_libraries(ocr_shape_gates_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(ocr_shape_gates_test)

# State / Province lookup tests — US 50 + DC + territories + Canadian
# provinces with full-name + 2-letter-code support + ZIP-prefix
# cross-validation. Task #36.
add_executable(state_lookup_test
    state_lookup_test.cpp
)
target_link_libraries(state_lookup_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(state_lookup_test)

# MRZ (ICAO 9303) parser tests
add_executable(mrz_test
    mrz_test.cpp
)
target_link_libraries(mrz_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(mrz_test)


# YOLO post-processing (decode + NMS) tests — exercises the shared C++ code
# that both iOS (Swift via C++ interop) and Android (Kotlin via JNI) call to
# convert raw model output tensors into per-field detections.
add_executable(yolo_postprocess_test
    yolo_postprocess_test.cpp
)
target_link_libraries(yolo_postprocess_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(yolo_postprocess_test)

# NanoDet field-detector decode golden tests (cpp/detect). Fixtures are
# planted, well-separated detections; NANODET_FIXTURE_DIR points the test at
# the committed golden bundle regardless of the ctest working directory.
add_executable(nanodet_decode_test
    nanodet_decode_test.cpp
)
target_link_libraries(nanodet_decode_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
target_compile_definitions(nanodet_decode_test
    PRIVATE NANODET_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/nanodet_golden"
)
gtest_discover_tests(nanodet_decode_test)

# NanoDet field-detector preprocessing tests (cpp/detect/preprocess) — pins the
# BGR/mean/std/NCHW contract and the half-pixel bilinear resize with
# hand-computed expected values.
add_executable(preprocess_test
    preprocess_test.cpp
)
target_link_libraries(preprocess_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(preprocess_test)

# FieldDetector orchestration tests (cpp/detect/field_detector) — replays the
# planted golden tensor through a fake interpreter to verify the
# preprocess -> invoke -> decode -> coordinate-map glue without a runtime lib.
add_executable(field_detector_test
    field_detector_test.cpp
)
target_link_libraries(field_detector_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
target_compile_definitions(field_detector_test
    PRIVATE NANODET_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/nanodet_golden"
)
gtest_discover_tests(field_detector_test)

# DocAligner corner-heatmap decode tests (cpp/detect/doc_aligner) — planted
# heatmaps with hand-computed centroids pin the NHWC indexing, channel order,
# and the hard-argmax / soft-argmax paths.
add_executable(doc_aligner_test
    doc_aligner_test.cpp
)
target_link_libraries(doc_aligner_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
target_compile_definitions(doc_aligner_test
    PRIVATE DOCALIGNER_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/docaligner_golden"
)
gtest_discover_tests(doc_aligner_test)

# C-ABI detector bridge tests (cpp/detect/detect_c) — the extern "C" surface
# the native Nitro layer calls (preprocess/decode/corners + capacity contract).
add_executable(detect_c_test
    detect_c_test.cpp
)
target_link_libraries(detect_c_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
target_compile_definitions(detect_c_test
    PRIVATE NANODET_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/nanodet_golden"
)
gtest_discover_tests(detect_c_test)

# Multi-frame voter tests — v2 Sequence D (task #52). Covers the FIFO
# eviction / reset / tie-break / (FieldId, FieldSource) bucket separation
# matrix required by round-2 before deleting the per-platform
# voters.
add_executable(voter_test
    voter_test.cpp
)
target_link_libraries(voter_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(voter_test)

# AAMVA visible-field lexer tests — v2 Sequence E (task #53). Defends the
# round-5/6 invariants (digits-only index char, boundary precondition,
# trailing-digit reject, label-peek value boundary, WI 46→4d alias, height/
# weight/color domain regexes, longest-first label match).
add_executable(aamva_lexer_test
    aamva_lexer_test.cpp
)
target_link_libraries(aamva_lexer_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(aamva_lexer_test)

# Marker-anchored demographic parser tests — the shared C++
# parse_aamva_demographic_fields that replaces the duplicated Swift/Kotlin
# parseAamvaDemographicFields orchestration. Authoritative regression for the
# real Wisconsin on-device scan: look-ahead licence linkage, fused-row sex
# extraction, marker-2 trailing-junk strip, and strict-over-bbox name voting.
add_executable(aamva_demographic_test
    aamva_demographic_test.cpp
)
target_link_libraries(aamva_demographic_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(aamva_demographic_test)

# External DataDetector candidate-merge tests (issue #124) — pins the
# FieldSource::DataDetector fill-only / agreement-upgrade / ambiguity-skip
# contract through the public extract_fields_from_candidates resolver,
# including the {DOB, ISS, EXP} date-ordering rule and the pre-split
# postal-address sub-field gates.
add_executable(external_candidates_test
    external_candidates_test.cpp
)
target_link_libraries(external_candidates_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(external_candidates_test)
