cmake_minimum_required(VERSION 3.18.1)
project(DlScan)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_VERBOSE_MAKEFILE ON)

# Add the shared C++ parsing core sources plus the JNI bridge.
add_library(DlScan SHARED
  ../cpp/aamva/aamva_parser.cpp
  ../cpp/ocr/ocr_field_extractor.cpp
  ../cpp/errors/error_codes.cpp
  src/main/cpp/dlscan_jni_bridge.cpp
)

target_include_directories(DlScan PUBLIC
  ../cpp
  ../cpp/aamva
  ../cpp/ocr
  ../cpp/errors
)

# Pull in nitrogen-generated JNI bindings + autolinking.
# This adds its own sources to DlScan via target_sources(...), and links
# fbjni, ReactAndroid, and react-native-nitro-modules.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/DlScan+autolinking.cmake)

find_library(LOG_LIB log)
target_link_libraries(DlScan ${LOG_LIB} android)
