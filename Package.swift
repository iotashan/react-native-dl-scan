// swift-tools-version:5.9
// NOTE: SPM distribution is incomplete during the in-flight migration.
// The DlScan target contains only Swift utility types (parser, scanner) today —
// the React Native bridge layer (DlScan.h, DlScan.mm, DlScanFrameProcessor.m)
// is omitted because SwiftPM does not support mixed-language targets.
// Step 3 of the migration replaces the bridge with Nitro Modules; at that
// point the SPM product becomes consumer-ready.
// Do NOT add this package as a dependency until Step 3 is merged.
import PackageDescription

let package = Package(
  name: "DlScan",
  platforms: [.iOS(.v15)],
  products: [
    .library(name: "DlScan", targets: ["DlScan"]),
  ],
  targets: [
    .target(
      name: "DlScan",
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
  ]
)
