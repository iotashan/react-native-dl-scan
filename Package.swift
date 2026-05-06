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
  platforms: [.iOS(.v15)],
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
      ]
    ),
    .target(
      name: "DlScan",
      dependencies: ["DlScanCxx"],
      path: "ios",
      sources: ["HybridDlScanIOS.swift"],
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
