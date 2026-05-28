cmake_minimum_required(VERSION 3.16)
project(DlScanCore CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

enable_testing()

# Fetch GoogleTest via FetchContent (version-pinned, no system install required)
include(FetchContent)
FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG        v1.14.0
)
# Prevent GTest from overriding the parent project's compiler/linker settings
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# Core static library: AAMVA parser + OCR extractor + MRZ parser + error codes
# + v2 multi-frame voter (task #52) + voter C-ABI bridge for cross-platform
# binding (Swift via Cxx, Android via JNI wrapper).
add_library(dlscan_core STATIC
    aamva/aamva_parser.cpp
    aamva/aamva_lexer.cpp
    aamva/aamva_lexer_c.cpp
    license_data.cpp
    ocr/ocr_field_extractor.cpp
    ocr/state_lookup.cpp
    mrz/mrz_parser.cpp
    yolo/yolo_postprocess.cpp
    yolo/field_classes.cpp
    errors/error_codes.cpp
    voter.cpp
    voter_c.cpp
)

target_include_directories(dlscan_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_options(dlscan_core PRIVATE
    -Wall
    -Wextra
    -Wno-unused-parameter
)

# Test executables
add_subdirectory(tests)

# Evaluation harness — parser_eval replays IDNet's recorded OCR strings
# through extract_fields_structured and reports per-(state, field) match
# rates. Standalone executable; not part of `ctest`. Run with
# `IDNET_DATA_ROOT=... ./parser_eval --state us_wisconsin_dl`. Task #39.
add_executable(parser_eval
    eval/parser_eval.cpp
)
target_link_libraries(parser_eval
    PRIVATE dlscan_core
)
target_include_directories(parser_eval PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)
