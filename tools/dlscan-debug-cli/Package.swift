// swift-tools-version:5.9
import PackageDescription

// Task #68 — split the CLI into a library + executable so the
// regex tightener helpers in ProductionStrip.swift can be exercised
// by an XCTest target. SwiftPM forbids importing an executableTarget,
// so the testable code must live in a separate library target.
//
// Targets:
//   - AamvaLexerC          (C++): wraps cpp/aamva/aamva_lexer.cpp via the
//                          DLSCAN_AAMVA_STANDALONE C ABI.
//   - DLScanDebugCore      (Swift library): AamvaLexer.swift +
//                          ProductionStrip.swift — the pure-Swift
//                          tightener helpers + the thin wrapper over
//                          AamvaLexerC. Public surface tested by
//                          DLScanDebugCoreTests.
//   - dlscan-debug-cli     (Swift executable): main.swift only; depends
//                          on DLScanDebugCore. Behaviour unchanged.
//   - DLScanDebugCoreTests (Swift test): XCTest parity with
//                          android/src/test/.../TightenersTest.kt.
let package = Package(
    name: "dlscan-debug-cli",
    platforms: [.macOS(.v13)],
    targets: [
        .target(
            name: "AamvaLexerC",
            path: "Sources/AamvaLexerC",
            sources: ["aamva_lexer.cpp", "aamva_lexer_c.cpp"],
            publicHeadersPath: "include",
            cxxSettings: [
                .headerSearchPath("include"),
                .define("DLSCAN_AAMVA_STANDALONE")
            ]
        ),
        .target(
            name: "DLScanDebugCore",
            dependencies: ["AamvaLexerC"],
            path: "Sources/DLScanDebugCore",
            swiftSettings: [
                // Task #70: enable SE-0409 access-control-on-import syntax
                // so `internal import AamvaLexerC` in AamvaLexer.swift parses
                // cleanly on Swift 5.9+ without the @_implementationOnly
                // deprecation warning. The feature is default-on in Swift 6
                // but must be opted in on 5.9-5.10 toolchains.
                .enableUpcomingFeature("AccessLevelOnImport"),
            ]
        ),
        .executableTarget(
            name: "dlscan-debug-cli",
            dependencies: ["DLScanDebugCore"],
            path: "Sources/dlscan-debug-cli"
        ),
        .testTarget(
            name: "DLScanDebugCoreTests",
            dependencies: ["DLScanDebugCore"],
            path: "Tests/DLScanDebugCoreTests"
        )
    ],
    cxxLanguageStandard: .cxx20
)
