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

# MRZ (ICAO 9303) parser tests
add_executable(mrz_test
    mrz_test.cpp
)
target_link_libraries(mrz_test
    PRIVATE dlscan_core
    PRIVATE GTest::gtest_main
)
gtest_discover_tests(mrz_test)
