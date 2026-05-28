// swift-tools-version:5.9
// DlScanCxx — C++17 shared parsing core (AAMVA + OCR field extraction).
// DlScan    — Swift bridge layer; implements the Nitro HybridDlScanIOS class.
//
// SPM consumers:
//   The DlScan target now includes HybridDlScanIOS (the Nitro HybridObject),
//   but NitroModules is not published as a Swift Package — it ships as a
//   CocoaPods pod only.  If you are consuming this library via SPM directly
//   (i.e., without CocoaPods), you must add NitroModules to your host project's
//   package manifest separately and ensure it is visible to the DlScan target.
//
//   For CocoaPods consumers the `DlScan.podspec` handles everything, including
//   the `NitroModules` dependency and autolinking registration via the generated
//   `DlScanAutolinking.mm`.
import PackageDescription

let package = Package(
  name: "DlScan",
  platforms: [.iOS(.v16)],  // bumped for ML Program (.mlpackage) Core ML support
  products: [
    .library(name: "DlScan", targets: ["DlScan"]),
    .library(name: "DlScanCxx", targets: ["DlScanCxx"]),
  ],
  targets: [
    .target(
      name: "DlScanCxx",
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
      name: "DlScan",
      dependencies: ["DlScanCxx"],
      path: "ios",
      // The DlScan target lives at ios/, with its source restricted to the
      // single Swift file. The compiled Core ML model is copied verbatim
      // into the SPM resource bundle so it can be loaded at runtime via
      // Bundle.module.url(forResource:withExtension:).
      sources: ["HybridDlScanIOS.swift"],
      resources: [
        .copy("Resources/DlScanFieldDetector.mlmodelc"),
      ],
      swiftSettings: [
        // Enable bidirectional Swift <-> C++ interoperability so that
        // HybridDlScanIOS can import and call DlScanCxx (parse_aamva,
        // extract_ocr_fields, etc.).
        .interoperabilityMode(.Cxx),
      ]
    ),
  ],
  cxxLanguageStandard: .cxx17
)
