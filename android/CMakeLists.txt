cmake_minimum_required(VERSION 3.18.1)
project(DLScan)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_VERBOSE_MAKEFILE ON)

# Add the shared C++ parsing core sources plus the JNI bridge.
# voter.cpp added per round-2 — this list is independent of
# cpp/CMakeLists.txt's so a missing entry would only fail at Android link
# time and not in the GoogleTest run.
add_library(DLScan SHARED
  ../cpp/aamva/aamva_parser.cpp
  ../cpp/aamva/aamva_lexer.cpp
  ../cpp/license_data.cpp
  ../cpp/ocr/ocr_field_extractor.cpp
  ../cpp/ocr/state_lookup.cpp
  ../cpp/mrz/mrz_parser.cpp
  ../cpp/yolo/yolo_postprocess.cpp
  ../cpp/yolo/field_classes.cpp
  ../cpp/detect/nanodet_decode.cpp
  ../cpp/detect/preprocess.cpp
  ../cpp/detect/doc_aligner.cpp
  ../cpp/detect/field_detector.cpp
  ../cpp/detect/detect_c.cpp
  ../cpp/errors/error_codes.cpp
  ../cpp/voter.cpp
  ../cpp/voter_c.cpp
  src/main/cpp/dlscan_jni_bridge.cpp
)

target_include_directories(DLScan PUBLIC
  ../cpp
  ../cpp/aamva
  ../cpp/ocr
  ../cpp/mrz
  ../cpp/yolo
  ../cpp/detect
  ../cpp/errors
)

# Pull in nitrogen-generated JNI bindings + autolinking.
# This adds its own sources to DLScan via target_sources(...), and links
# fbjni, ReactAndroid, and react-native-nitro-modules.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/DLScan+autolinking.cmake)

# VisionCamera: HybridDLScanSpec.hpp #includes <VisionCamera/HybridFrameSpec.hpp>
# (the Nitro-generated frame-processor type for recognizeLicenseFields).
# VisionCamera ships a prefab so we resolve via find_package + link.
find_package(react-native-vision-camera REQUIRED)
target_link_libraries(DLScan react-native-vision-camera::VisionCamera)

find_library(LOG_LIB log)
target_link_libraries(DLScan ${LOG_LIB} android)
