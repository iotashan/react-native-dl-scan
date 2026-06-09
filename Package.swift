// swift-tools-version:5.9
// DLScanCxx — C++17 shared parsing core (AAMVA + OCR field extraction).
// DLScan    — Swift bridge layer; implements the Nitro HybridDLScanIOS class.
//
// SPM consumers:
//   The DLScan target now includes HybridDLScanIOS (the Nitro HybridObject),
//   but NitroModules is not published as a Swift Package — it ships as a
//   CocoaPods pod only.  If you are consuming this library via SPM directly
//   (i.e., without CocoaPods), you must add NitroModules to your host project's
//   package manifest separately and ensure it is visible to the DLScan target.
//
//   For CocoaPods consumers the `DLScan.podspec` handles everything, including
//   the `NitroModules` dependency and autolinking registration via the generated
//   `DLScanAutolinking.mm`.
import PackageDescription

let package = Package(
  name: "DLScan",
  platforms: [.iOS(.v16)],  // Vision Camera v5 / Nitro Modules supported floor
  products: [
    .library(name: "DLScan", targets: ["DLScan"]),
    .library(name: "DLScanCxx", targets: ["DLScanCxx"]),
  ],
  targets: [
    .target(
      name: "DLScanCxx",
      path: "cpp",
      exclude: ["build", "tests", "CMakeLists.txt"],
      publicHeadersPath: ".",
      cxxSettings: [
        .headerSearchPath("aamva"),
        .headerSearchPath("ocr"),
        .headerSearchPath("errors"),
        .headerSearchPath("mrz"),
        .headerSearchPath("yolo"),
      ]
    ),
    .target(
      name: "DLScan",
      dependencies: ["DLScanCxx"],
      path: "ios",
      // The DLScan target lives at ios/, with its source restricted to the
      // single Swift file. No bundled Core ML model: field detection runs in
      // JS via react-native-fast-tflite (NanoDet); the native layer only does
      // Vision document-segmentation + text-recognition.
      sources: ["HybridDLScanIOS.swift"],
      swiftSettings: [
        // Enable bidirectional Swift <-> C++ interoperability so that
        // HybridDLScanIOS can import and call DLScanCxx (parse_aamva,
        // extract_ocr_fields, etc.).
        .interoperabilityMode(.Cxx),
      ]
    ),
  ],
  cxxLanguageStandard: .cxx17
)
