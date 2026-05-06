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

# Core static library: AAMVA parser + OCR extractor + error codes
add_library(dlscan_core STATIC
    aamva/aamva_parser.cpp
    ocr/ocr_field_extractor.cpp
    errors/error_codes.cpp
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
