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
