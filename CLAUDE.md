# react-native-dl-scan

A React Native library for scanning US driver's licenses. It runs a tiered
pipeline: the **back** of the card is read from its PDF417 barcode via Vision
Camera v5, and the **front** is read with OCR plus YOLO field detection and a
C++ AAMVA parser. The native layer is built on **Nitro Modules** (New
Architecture only). A thin TypeScript API in `src/` sits over a shared core
implemented once in C++17 (`cpp/`) and bridged through Swift (`ios/`) and
Kotlin (`android/`); the Nitro codegen is committed under
`nitrogen/generated/`.

## Architecture map

- `src/` — TypeScript API: the `useLicenseScanner` hook, the Nitro spec at
  `src/specs/DlScan.nitro.ts`, and per-platform barcode outputs under
  `src/scanner/`.
- `ios/` — Swift Nitro hybrid object backed by Core ML.
- `android/` — Kotlin Nitro hybrid object backed by TFLite.
- `cpp/` — the shared core: `aamva/`, `mrz/`, `ocr/`, and `yolo/` parsers plus
  the field voter, with 261 GoogleTest cases in `cpp/tests/`.
- `nitrogen/generated/` — committed Nitro codegen (do not hand-edit).
- `example/` — Expo demo app.
- `docs/` — model and data cards.

## Build & test

- `yarn typecheck` — TypeScript (`tsc`).
- `yarn lint` — ESLint.
- `yarn test` — JS test suite (Jest).
- `yarn test:cpp` — configures and builds the C++ core with CMake, then runs the
  GoogleTest suite via `ctest`.

Full prerequisites and instructions for running the example app live in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Git Workflow
- after a successful merge, delete the task branch

## Android dev environment
- The example Android build requires **JDK 21**. `@react-native/gradle-plugin@0.81` was built against Kotlin 2.1.20 / AGP 8.11 and FAILS to load under JDK 25+. When this happens, gradle's error is the very misleading `Error resolving plugin [id: 'com.facebook.react.settings'] > 25.0.2` — the `25.0.2` is the rejected JVM version, NOT a plugin version.
- Fix: `brew install openjdk@21`, then either:
  - Set `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` in shell, or
  - Add `org.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` to `~/.gradle/gradle.properties` (user-scope; safer than the prebuild-output `example/android/gradle.properties` which Expo wipes).
- Homebrew's `openjdk` keg auto-upgrades to whatever's latest; this is what regresses gradle without warning. The `openjdk@21` versioned keg is the stable pin.
- The example/android directory is gitignored Expo prebuild output. Don't try to commit changes there — write a config plugin in app.json's plugins array if a persistent change is needed.
