# UPGRADE.md — 2026 Best-Practices Review

Status snapshot of `react-native-dl-scan` v0.1.0 against current React Native / Vision Camera ecosystem norms, with a prioritized upgrade path.

---

## What the project does

iOS-only React Native library for scanning US/Canadian driver's licenses.

- **Live scan path** — registers as a `react-native-vision-camera` v4 frame-processor plugin and runs Apple Vision (`VNDetectBarcodesRequest` for PDF417, `VNRecognizeTextRequest` for OCR) on each camera frame.
- **Direct parse path** — TurboModule method `parseBarcodeData(rawString)` runs an AAMVA v1–v11 parser (ported from DLParser-Swift) on a barcode string you already have.

Output is a normalized `LicenseData` (name, DOB, license #, address, sex, eye color, height, vehicle class, etc.; ISO-8601 dates).

Android is **deliberately disabled** in `react-native.config.js` (`android: null`).

---

## Architecture (iOS only)

```
┌─────────────────────── JS / TS layer (src/) ─────────────────────────┐
│                                                                       │
│  useLicenseScanner(mode)                                              │
│   ├─ useState: licenseData / error / isScanning                       │
│   ├─ useSharedValue: hasResult         (worklets-core)                │
│   ├─ useRunOnJS: onResult / onError    (worklets-core)                │
│   └─ useFrameProcessor ───────► scanFrame(frame, mode)  [worklet]     │
│                                       │                                │
│                                       ▼                                │
│                          VisionCameraProxy.call('scanLicense', …)     │
│                                                                       │
│  NativeDlScan (TurboModule, Codegen) ──► parseBarcodeData(string)     │
└───────────────┬────────────────────────────────┬──────────────────────┘
                │ (frame processor path)          │ (direct parse path)
                ▼                                 ▼
┌──────────────────────────────────────┐  ┌────────────────────────────┐
│ DlScanFrameProcessor.m   [Obj-C]     │  │ DlScan.mm   [TurboModule]  │
│  • holds BarcodeScanner + OCRScanner │  │  RCT_EXPORT_METHOD         │
│  • rate-limits: barcode 10fps,       │  │  parseBarcodeData          │
│    OCR 2fps (NSDate, no lock)        │  │      │                     │
│  • orientation: UI→CGImageProperty   │  └──────┼─────────────────────┘
│      │                                          │
│      ▼ mode == "barcode"      mode == "ocr"     │
│  ┌─────────────────┐    ┌──────────────────┐    │
│  │ BarcodeScanner  │    │ OCRScanner       │    │
│  │ Vision PDF417   │    │ VNRecognizeText  │    │
│  │ confidence ≥0.5 │    │ accurate level   │    │
│  │ try? perform()  │    │ try? perform()   │    │
│  │ (sync, blocks)  │    │ (sync, blocks)   │    │
│  └────────┬────────┘    └────────┬─────────┘    │
│           ▼                      ▼               │
│   payload string          [String] lines         │
│           │                      │               │
│           ▼                      ▼               │
│   ┌──────────────┐       ┌────────────────┐     │
│   │ AAMVAParser  │◄──────│ OCRFieldParser │     │
│   │ v1–v11       │       │ regex heuristic│     │
│   └──────┬───────┘       └────────┬───────┘     │
│          │                        │              │
│          └──────────┬─────────────┘              │
│                     ▼                            │
│              [String:Any] dict ──────────────────┘
│                     │
│                     ▼
│   Frame processor → NSDictionary back to JS worklet
│   TurboModule     → resolve Promise
│                     │
│                     ▼
│   onResult/onError via runOnJS → React state
```

**Android:** none. No Kotlin/Java sources, autolinking off.

---

## What's already right

- **Modern stack** — RN 0.79.2 + React 19, new architecture via TurboModules + Codegen (`codegenConfig` in `package.json`), Vision Camera v4 + `react-native-worklets-core` 1.x, iOS 15 deployment target.
- **Library scaffolding** — `react-native-builder-bob` (ESM output), commitlint + conventional commits, lefthook, ESLint 9 flat config, Prettier, Yarn Berry. Matches a current library template.
- **AAMVA parser is genuinely good** — version-anchored regex (`(?:ANSI\s?|AAMVA)\d{6}(\d{2})`), version+country-aware date formats, name-resolution fallback chains across DAC/DCT/DAA, postal-code padding cleanup, multi-state test suite. Strongest piece of code in the repo.
- **Runtime hygiene in the frame processor** — rate-limiting (10 fps barcode / 2 fps OCR), confidence thresholds (PDF417 ≥0.5, OCR ≥0.3), correct UI→CGImageProperty orientation mapping, a single shared `hasResult` worklet gate to stop processing after a hit.

---

## Upgrade path (prioritized)

### P0 — Migrate from TurboModule to Nitro Modules

**Biggest gap from 2026 best practice.** This is a Vision Camera ecosystem plugin (Marc Rousavy's stack), and Nitro Modules are the recommended path for new VC-adjacent libraries:

- ~5–10× faster than Codegen TurboModules on small calls.
- No `.mm` glue — Swift-native HybridObjects.
- Consistent with how Vision Camera itself bridges natively.

The TurboModule here exists for **one** method (`parseBarcodeData`) that operates on a string — a perfect Nitro candidate. The Obj-C++ shim (`DlScan.mm`, `DlScan.h`, parts of `DlScanFrameProcessor.m`) exists almost entirely to bridge Swift→TurboModule; Nitro lets this become pure Swift.

**Action:**
- Replace `src/NativeDlScan.ts` with a Nitro `HybridObject` spec.
- Drop `codegenConfig` from `package.json`, drop `DlScan.mm` / `DlScan.h`.
- Add `react-native-nitro-modules` peer dependency.
- Re-export `parseBarcodeData` through the new HybridObject.

### P1 — Convert frame-processor plugin to Swift

VisionCamera v4 supports Swift frame-processor plugins directly. Today `DlScanFrameProcessor.m` is Objective-C only because the Swift classes (`BarcodeScanner`, `OCRScanner`) are exposed through `@objc public` and `DlScan-Swift.h`. Going Swift-native removes the round-trip.

**Action:**
- Rewrite `DlScanFrameProcessor.m` as a Swift `FrameProcessorPlugin` subclass.
- Drop `@objc` annotations on `BarcodeScanner` / `OCRScanner` / `OCRFieldParser` / `AAMVAParser` (keep them only where Nitro/VC require them).
- Combined with P0, this leaves an all-Swift native side.

### P1 — Move Vision requests off the frame thread

`try? handler.perform([request])` runs synchronously inside the frame callback. For accurate OCR this can sit at 200–500 ms, stalling the frame thread. VisionCamera drops queued frames so the camera doesn't tear, but back-to-back OCR calls will still serialize.

**Action:**
- Hold a serial `DispatchQueue` in the plugin; submit Vision work, return `nil` immediately, deliver results via a callback / shared state on the next frame tick.
- Or: switch to Vision's async APIs (`perform(_:on:)` with a queue).
- At minimum, document the per-mode latency in the README.

### P1 — Lock the rate-limit timestamps

`_lastBarcodeTime` / `_lastOCRTime` are mutable `NSDate *` properties with no `atomic`, no lock. Today VisionCamera invokes the plugin serially on its own thread, but **two `Camera` instances share a single plugin** in some VC versions, which silently breaks the assumption.

**Action:**
- Use `os_unfair_lock` (or `dispatch_semaphore_t`) around access.
- Or mark the properties `atomic`.
- Cleanest: replace with `CFAbsoluteTimeGetCurrent()` reads guarded by a single lock.

### P2 — Tighten Android scope

`react-native.config.js` disables autolinking, but `package.json` has no platform constraint and the README mentions iOS-only only once. An Android-only consumer gets no install-time error.

**Action:**
- Add `"os": ["darwin"]` to `package.json` (npm-level guard for darwin builds).
- Add an Android stub module that throws a clear "iOS only" error at runtime, in case the user runs the JS layer on Android.
- Make the iOS-only constraint prominent in the README.

### P2 — Convert tests to XCTest

`ios/Tests/DlScanTests.swift` is a hand-rolled `var passed = 0 / var failed = 0` script with a custom `assert` function. Works, but:

- Not integrated with Xcode's test runner.
- No JUnit/XML output for CI.
- No code coverage instrumentation.

**Action:**
- Wrap as `XCTestCase` subclasses.
- Add an `xcodebuild test` step to CI.
- Add a Jest config + `test` script for the JS layer (currently only `typecheck` and `lint` exist).

### P2 — Mark OCR mode experimental

The OCR field extraction is regex heuristic over recognized text lines. Hard to make robust across 51 US jurisdictions. The barcode path is canonical; OCR should be labeled accordingly.

**Action:**
- README: rename "fallback" → "experimental — accuracy varies by jurisdiction."
- Consider returning a `confidence` score or `partialMatch` flag from OCR mode so consumers can decide whether to trust it.

### P3 — Smaller polish

- `as unknown as ScanResult | null` cast in `scanFrame.ts` — acceptable for VC plugins, but tighten with a runtime type guard.
- `s.dependency "VisionCamera"` in the podspec while `react-native-vision-camera` is only a peer — works because consumers install VC, but worth a comment in the podspec.
- No CI workflows visible under `.github/` — add at least typecheck + lint + iOS build.

---

## Suggested execution order

1. **P0 Nitro migration** — biggest win, unblocks P1 Swift cleanup.
2. **P1 Swift frame-processor + thread-safety + async Vision** — natural follow-up; same files touched.
3. **P2 Android guard + XCTest + README clarifications** — independent, can land in parallel.
4. **P3 polish** — opportunistic.

After P0 + P1, the entire native side is Swift, the JS interop is Nitro, and the only Obj-C in the repo is the VisionCamera plugin glue (which itself becomes Swift). That's a 2026-shaped library.
