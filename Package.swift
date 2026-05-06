// swift-tools-version:5.9
// NOTE: SPM distribution is incomplete during the in-flight migration.
// The DlScan target contains only Swift utility types (parser, scanner) today —
// the React Native bridge layer (DlScan.h, DlScan.mm, DlScanFrameProcessor.m)
// is omitted because SwiftPM does not support mixed-language targets.
// Step 3 of the migration replaces the bridge with Nitro Modules; at that
// point the SPM product becomes consumer-ready.
// Do NOT add this package as a dependency until Step 3 is merged.
// DlScanCxx contains the C++17 shared parsing core (AAMVA + OCR).
// Swift C++ interop (interoperabilityMode(.Cxx)) will be added in Step 3.
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
      sources: [
        "AAMVAParser.swift",
        "BarcodeScanner.swift",
        "OCRFieldParser.swift",
        "OCRScanner.swift",
      ]
    ),
    .testTarget(
      name: "DlScanTests",
      dependencies: ["DlScan"],
      path: "ios/Tests"
    ),
  ],
  cxxLanguageStandard: .cxx17
)
