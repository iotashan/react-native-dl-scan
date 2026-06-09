# react-native-dl-scan

Scan US and Canadian driver's licenses in React Native — iOS and Android — powered by a shared C++17 AAMVA parsing core and exposed as a [Nitro Modules](https://github.com/mrousavy/nitro) HybridObject.

[![npm version](https://img.shields.io/npm/v/react-native-dl-scan.svg)](https://www.npmjs.com/package/react-native-dl-scan)
[![CI](https://github.com/iotashan/react-native-dl-scan/actions/workflows/ci.yml/badge.svg)](https://github.com/iotashan/react-native-dl-scan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## About this project

This library was built by [Shannon Hicks](https://github.com/iotashan) using [Claude Code](https://claude.com/claude-code). It exists because commercial driver-license scanning SDKs are expensive, and the open-source building blocks for an on-device scanner — Vision Camera for the camera surface, the AAMVA D-20 spec for PDF417 payload structure, Apple Vision and Google ML Kit for OCR, YOLOv8 for field detection, DocAligner for document rectification — were already public. Stitching them into a single Nitro module is the work this project represents.

If that origin matters to you when evaluating the library, you have everything you need to judge it on its merits — the code is here, the C++ AAMVA parser has 261 GoogleTest cases, the model card and documented limitations are linked below.

## Quick Example

```tsx
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { useLicenseScanner } from 'react-native-dl-scan';

function ScanScreen() {
  const device = useCameraDevice('back');
  const { licenseData, isScanning, output, reset } = useLicenseScanner('barcode');

  if (!device) return null;

  if (licenseData) {
    return (
      <View>
        <Text>{licenseData.firstName} {licenseData.lastName}</Text>
        <Text>DL #{licenseData.licenseNumber}</Text>
        <Text>DOB: {licenseData.dateOfBirth}</Text>
        <Button title="Scan Again" onPress={reset} />
      </View>
    );
  }

  return (
    <Camera
      device={device}
      isActive={isScanning}
      outputs={[output]}
      style={{ flex: 1 }}
    />
  );
}
```

> **Note:** `outputs={[output]}` is the Vision Camera v5 plural array prop. The v4 `output={...}` single-prop idiom is not supported.

## Features

- **PDF417 barcode scanning** (back of license) via Vision Camera v5's built-in object output on iOS (AVFoundation `AVCaptureMetadataOutput` — pure Apple stack, no MLKit, simulator-friendly) and `react-native-vision-camera-barcode-scanner` on Android (Google MLKit Barcode). Up to 30 fps on both.
- **Front-of-license OCR** via VisionKit (iOS) and ML Kit Text Recognition (Android), feeding a shared C++17 field extractor with strict 4-gate demographic parsing, bbox-IoU YOLO field matching, and multi-frame voting consensus. Cross-platform verified on Pixel 6 and iPhone 15 Pro Max against a Wisconsin DL — 13 of 15 fields populate consistently across cold-launched scans. Accuracy varies by jurisdiction; see [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
- **Full AAMVA v1–v11 support** with US and Canadian jurisdictional quirks, validated by 261 GoogleTest cases for cross-platform parity.
- **Single parsing core** (`cpp/`) shared between iOS (Swift C++ interop) and Android (NDK + JNI bridge) — same results on both platforms.
- **Nitro HybridObject** — approximately 5–10× faster than a legacy TurboModule on small calls; bridge overhead measured in microseconds, not milliseconds.

## Requirements

| Requirement | Minimum version |
|---|---|
| React Native | 0.79+ with the **New Architecture enabled** (Nitro is a New-Arch-only module — no bridge fallback) |
| iOS | 16.0+ (Core ML field detector requires ML Program format) |
| Android API level | 24+ |
| Android Gradle Plugin | 9.1.0+ (matches Vision Camera v5; consumer apps on AGP 8.x must upgrade) |
| Xcode | 15+ (Swift 5.9 C++ interop) |
| Expo | SDK 54+ with a custom dev client. **Not compatible with Expo Go** — this library ships native code. |

### Android development environment

Building **the example app** (or any app consuming this library) on Android requires **JDK 21**. The Gradle plugin pinned by Vision Camera v5 / RN 0.81 fails to load on JDK 25+ with a misleading "Error resolving plugin > 25.0.2" message — that `25.0.2` is the rejected JVM version, not a plugin version.

```sh
# Install JDK 21 via Homebrew
brew install openjdk@21

# Option 1: export in your shell
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home

# Option 2: pin in ~/.gradle/gradle.properties (user-scope, persistent)
org.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

This is a hard requirement for development; end-users of your app are not affected.

### App bundle size impact

Bundled ML model files add to your app's download size:

| Platform | Models | Size |
|---|---|---|
| iOS | `DLScanFieldDetector.mlmodelc` (compiled Core ML) | ~4.3 MB |
| Android | `dl_scan_field_detector.tflite` + `docaligner_lcnet100.tflite` | ~5.7 MB |

The TypeScript / native bridge code itself is small (< 1 MB). For most apps the model footprint is the dominant cost.

## Peer Dependencies

Install all of these in your app's `package.json`:

```sh
yarn add \
  react-native-vision-camera@^5.0.0 \
  react-native-vision-camera-barcode-scanner@^5.0.0 \
  react-native-vision-camera-worklets@^5.0.0 \
  react-native-worklets@^0.8.0 \
  react-native-nitro-modules@^0.35.0 \
  react-native-nitro-image@^0.14.0
```

Or with npm:

```sh
npm install \
  react-native-vision-camera@^5.0.0 \
  react-native-vision-camera-barcode-scanner@^5.0.0 \
  react-native-vision-camera-worklets@^5.0.0 \
  react-native-worklets@^0.8.0 \
  react-native-nitro-modules@^0.35.0 \
  react-native-nitro-image@^0.14.0
```

`react-native-nitro-image` is transitively required by Vision Camera v5.

## Installation

### Add the package

```sh
yarn add react-native-dl-scan
```

### iOS — primary path: Swift Package Manager (RN 0.84+)

1. Open your project in Xcode.
2. **File → Add Package Dependencies…**
3. Enter `https://github.com/iotashan/react-native-dl-scan` and resolve the version.
4. Build.

Alternatively, the package is added automatically through your app workspace's `Package.resolved` once you reference it in your React Native project.

### iOS — legacy path: CocoaPods (RN ≤ 0.83 or pre-SPM migration)

```sh
cd ios && pod install
```

> **CocoaPods sunset notice:** The `DLScan.podspec` is retained as a compatibility shim through **2026-12-02**, when CocoaPods Trunk goes permanently read-only. Plan your migration to SPM before that date — after it, only SPM is supported.

### Android

Standard React Native autolink handles everything. Ensure your `android/build.gradle` and `android/app/build.gradle` meet the minimums:

```groovy
// android/build.gradle
classpath "com.android.tools.build:gradle:9.1.0"

// android/app/build.gradle
minSdkVersion 24
compileSdkVersion 35
```

The CMake-based JNI bridge compiles automatically as part of your app's Gradle build — no additional configuration required.

### Camera permissions

**iOS** — add to `ios/<YourApp>/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Camera access is needed to scan your driver's license</string>
```

**Android** — add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Request the permission at runtime using `useCameraPermission()` from `react-native-vision-camera` before rendering the `<Camera>` component.

## API

### `useLicenseScanner(mode?, ocrModelSources?, completion?)`

```ts
useLicenseScanner(
  mode?: ScanMode,                  // 'barcode' (default) | 'ocr'
  ocrModelSources?: OcrModelSources, // REQUIRED in 'ocr' mode (the NanoDet .tflite)
  completion?: ScanCompletionPolicy  // OCR multi-frame stop policy (see below)
)
```

React hook for camera-based scanning. Returns:

| Property | Type | Description |
|---|---|---|
| `licenseData` | `LicenseData \| null` | Parsed license fields. In OCR mode this is the **accumulated** result across passes — a field is kept once read and only replaced by a higher-confidence read, so values don't flicker out as later frames vary. |
| `error` | `string \| null` | Error message if a scan attempt fails |
| `isScanning` | `boolean` | `true` while actively scanning |
| `progress` | `number` | `0..1`. In OCR mode, the fraction of `requiredFields` read so far (`1` when finished). |
| `scanStatus` | `ScanStatus` | Live, UI-observable snapshot of the multi-frame scan (pass number, which required fields are in vs. pending, validation phase, per-field confidence). See [Scan completion](#scan-completion-ocr-mode). |
| `output` | `CameraOutput` | Pass to `<Camera outputs={[output]} />`. Internally resolved per mode and per platform — barcode mode uses AVFoundation `useObjectOutput` on iOS and `react-native-vision-camera-barcode-scanner` on Android; OCR mode is a worklet frame processor on both. |
| `reset` | `() => void` | Clear `licenseData` / `error` / accumulated result and restart scanning |

### `NativeDLScan.parseBarcodeData(rawAamvaString: string): Promise<LicenseData | null>`

Direct parse for callers who already have a raw AAMVA barcode string — e.g., from a handheld scanner, an NFC read, or a test fixture — without needing a camera feed.

```ts
import { NativeDLScan } from 'react-native-dl-scan';

const data = await NativeDLScan.parseBarcodeData(rawBarcodeString);
if (data) {
  console.log(data.firstName, data.lastName);
}
```

Returns `null` if the string is not a valid AAMVA payload.

### `LicenseData`

```ts
export interface LicenseData {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  dateOfBirth: string | null;       // ISO 8601 date (YYYY-MM-DD)
  expirationDate: string | null;    // ISO 8601 date (YYYY-MM-DD)
  issueDate: string | null;         // ISO 8601 date (YYYY-MM-DD)
  licenseNumber: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  // Typed value sets (AAMVA D20). Either a recognized `{ code }` or
  // `{ code: 'other', raw }` preserving the original card value. Null when
  // the scanner read nothing. See "Typed value sets" below.
  sex: SexValue | null;             // { code: 'M' | 'F' | 'X' } | { code: 'other', raw }
  eyeColor: EyeColorValue | null;   // { code: EyeColorCode } | { code: 'other', raw }
  hairColor: HairColorValue | null; // { code: HairColorCode } | { code: 'other', raw }
  height: string | null;            // e.g. "5'04\"" (canonical) or "5'-04" (VisionKit-raw)
  weight: string | null;            // e.g. "160" or "160 lb"
  vehicleClass: string | null;
  restrictions: string | null;
  endorsements: string | null;
  aamvaVersion: number | null;      // AAMVA spec version (1–11)
  documentType?: DocumentType | null;
  mrz?: MRZData | null;             // populated for travel docs (passport / national_id)
  dataConfidence?: Record<string, ConfidenceEntry>;
}

export type DocumentType =
  | 'driver_license' | 'passport' | 'national_id' | 'residence_permit' | 'unknown';

export interface ConfidenceEntry {
  score: number;                    // 0..1, derived from tier (see Confidence Tiers below)
  tier: 'cross_validated' | 'all_gates_passed' | 'shape_matched' | 'extracted_raw';
}

// Typed value sets (AAMVA D20) — see "Typed value sets" below.
export type SexCode = 'M' | 'F' | 'X';
export type EyeColorCode =
  | 'BLK' | 'BLU' | 'BRO' | 'GRY' | 'GRN'
  | 'HAZ' | 'MAR' | 'PNK' | 'DIC' | 'UNK';
export type HairColorCode =
  | 'BAL' | 'BLK' | 'BLN' | 'BRO' | 'GRY'
  | 'RED' | 'SDY' | 'WHI' | 'UNK';
export type TypedValue<C extends string> =
  | { code: C }
  | { code: 'other'; raw: string };
export type SexValue = TypedValue<SexCode>;
export type EyeColorValue = TypedValue<EyeColorCode>;
export type HairColorValue = TypedValue<HairColorCode>;
```

### `ScanMode`

```ts
type ScanMode = 'barcode' | 'ocr';
```

### Typed value sets

`sex`, `eyeColor`, and `hairColor` are AAMVA D20-coded enumerations on the card. Rather than hand back a bare string, the library normalizes each into a small **discriminated union** so you can branch on a known code *or* explicitly handle anything off-spec:

```ts
export type TypedValue<C extends string> =
  | { code: C }                       // a recognized code from the field's set
  | { code: 'other'; raw: string };   // off-spec — `raw` is the original (trimmed) card value
```

A field is `null` when the scanner read nothing; `{ code: 'other' }` is **never** fabricated from emptiness. The `'other'` branch always preserves the original (trimmed, case-preserved) value, which is what lets you map an unrecognized value to whatever a downstream system expects.

**Known code sets** (AAMVA D20). The frozen arrays `SEX_CODES`, `EYE_COLOR_CODES`, and `HAIR_COLOR_CODES` are exported so you can reuse them (e.g. to populate a dropdown). Matching against them is case-insensitive and whitespace-trimmed:

| Field | Type | Known codes |
|---|---|---|
| `sex` | `SexValue` | `M`, `F`, `X` |
| `eyeColor` | `EyeColorValue` | `BLK`, `BLU`, `BRO`, `GRY`, `GRN`, `HAZ`, `MAR`, `PNK`, `DIC`, `UNK` |
| `hairColor` | `HairColorValue` | `BAL`, `BLK`, `BLN`, `BRO`, `GRY`, `RED`, `SDY`, `WHI`, `UNK` |

`formatTypedValue(v)` is a tiny exported helper that renders a field for display — the bare code for a recognized value (`"M"`, `"BRO"`), the preserved `raw` string for an `'other'` value, and `null` for an absent field:

```ts
import { formatTypedValue } from 'react-native-dl-scan';

<Text>Sex: {formatTypedValue(licenseData.sex) ?? '—'}</Text>
```

**Consumer mapping example.** Suppose a legacy system only models two genders. Because every value carries either a known `code` or the raw card string, you can map deterministically and decide your own fallback for everything else:

```ts
import type { SexValue } from 'react-native-dl-scan';

// Map the typed sex value down to a legacy two-gender field.
function toLegacyGender(sex: SexValue | null): 'M' | 'F' | 'U' {
  if (sex == null) return 'U';            // nothing read
  switch (sex.code) {
    case 'M':
      return 'M';
    case 'F':
      return 'F';
    case 'X':
      return 'U';                          // non-binary → "unspecified" in the legacy schema
    case 'other':
      // An off-spec raw value the card presented (e.g. a numeric "1"/"2" a
      // jurisdiction emitted that wasn't normalized upstream). Inspect `sex.raw`
      // and apply whatever your downstream system requires.
      return sex.raw === '1' ? 'M' : sex.raw === '2' ? 'F' : 'U';
  }
}
```

## Scan Modes

### `'barcode'` (recommended)

Reads the PDF417 barcode on the back of the license. iOS uses Vision Camera v5's built-in `useObjectOutput` (AVFoundation `AVCaptureMetadataOutput` + `AVMetadataMachineReadableCodeObject` — pure Apple stack, simulator-friendly). Android uses `react-native-vision-camera-barcode-scanner` (Google MLKit Barcode). 30 fps capable on both. Handles the vast majority of US and Canadian licenses issued since ~2000.

### `'ocr'`

Reads text from the front of the license. Uses VisionKit on iOS and ML Kit Text Recognition on Android, with rate-limiting to approximately 3.3 fps internally (300 ms cooldown between OCR jobs). The platform layer collects OCR observations and YOLO bbox detections, then hands typed `FieldCandidate` records over Nitro to the C++ extractor — the same `extract_fields_from_candidates` runs on both iOS and Android. Multi-frame voting (a ≥2-vote floor per field) converges on the per-(FieldId, FieldSource) consensus value before structured normalization, and the hook **accumulates** confirmed fields across passes so a field that converged early isn't lost to later OCR variance. When the scan stops is governed by the [completion policy](#scan-completion-ocr-mode) (`requiredFields` / `maxFrames` / `validationPass`). Accuracy varies by jurisdiction; covered jurisdictions are listed in [docs/MODEL_CARD.md](docs/MODEL_CARD.md).

OCR runs **asynchronously** inside the Nitro hybrid: the worklet returns the most recently cached result immediately and queues a fresh OCR job in the background. New results surface on subsequent frames with no frame-processor stall.

**Fallback chains.** When OCR garbles the AAMVA index prefix or fuses adjacent fields, the C++ extractor reaches into the raw text pool to recover. Specifically:
- **Chronological-date scanner** — when the `3 DOB`, `4a ISS`, or `4b EXP` index tokens don't lex cleanly, every observation is scanned for `MM/DD/YYYY` tokens; if exactly three valid dates appear, they're assigned chronologically (oldest = DOB, middle = issue, newest = expire).
- **scanForClass text-pool** — when OCR misreads `4d` as `46` (a real WI/IL OCR pattern) and the lexer never emits a `9 CLASS X` token, every observation is searched for `(CLASS|CLAS|GLASS) X` and the matched code feeds `vehicleClass`.

These fallbacks fire only when the strict parser fails for a given field, so a clean read still flows through the normal `(FieldId, FieldSource)` typed-candidate path.

## Scan completion (OCR mode)

OCR mode reads the front of the card across multiple camera passes, **accumulating** a "presumed result" as fields converge (a field is kept once read and only replaced by a higher-confidence read). **You control when it stops** via the optional `completion` argument:

```ts
import { useLicenseScanner, DEFAULT_REQUIRED_FIELDS } from 'react-native-dl-scan';

const scanner = useLicenseScanner('ocr', OCR_MODELS, {
  // Keep scanning until ALL of these are read, then stop.
  requiredFields: ['firstName', 'lastName', 'street', 'city', 'state', 'postalCode'],
  maxFrames: 30,        // hard cap on passes; finalize best-effort if reached
  validationPass: true, // one extra confirming pass before finishing
});
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `requiredFields` | `(keyof LicenseData)[]` | `DEFAULT_REQUIRED_FIELDS` (name, street, city/state/ZIP, DOB, license #) | The scan accumulates passes until every one of these is populated. **`sex` is intentionally not in the default set** — it is the slowest field to converge on Android, so it is captured opportunistically rather than gating completion. Consumers who must not finalize without it can pass `STRICT_REQUIRED_FIELDS` (the default set + `sex`) with `maxFrames: 40`. Need only name + address? Pass a short list and finish in 1–2 passes. |
| `maxFrames` | `number` | `30` | Hard cap on consensus passes. If the required set isn't complete by then, the scan finalizes best-effort with whatever was captured (`phase: 'incomplete'`). |
| `validationPass` | `boolean` | `true` | After the required set is first met, require one more pass that re-confirms it before finalizing — guards against a single lucky-but-wrong read. |
| `tta` | `{ enabled?: boolean; modes?: TtaMode[] }` | **on** (`{ enabled: true, modes: ['original', 'blueChannel', 'contrastStretch'] }`) | Best-crop re-parse at finalization. On **every** finalize the library re-OCRs the single best captured card crop once under each augmentation with a fresh `minVotes: 1` voter and merges anything new. Additive — it can only fill an absent field or upgrade on strictly-higher confidence, never clobber a confirmed value. Disable with `tta: { enabled: false }`. See [TTA verification](#tta-verification-ocr-mode). |

In one sentence: **scan until the required fields are satisfied, capped by `maxFrames`, with an optional final validation pass**, and on every finalize re-parse the best crop once to recover any field the multi-frame vote dropped.

### `ScanStatus`

`scanner.scanStatus` updates on every pass so your UI can show the scan's inner state — pass number, which required fields are in vs. pending, the validation phase, and per-field confidence:

```ts
export interface ScanStatus {
  phase: 'scanning' | 'validating' | 'complete' | 'incomplete';
  passNumber: number;                       // passes processed so far
  maxFrames: number;
  requiredFields: (keyof LicenseData)[];
  acceptedRequired: (keyof LicenseData)[];  // required fields read so far
  pendingRequired: (keyof LicenseData)[];   // required fields still missing
  acceptedOptional: (keyof LicenseData)[];  // bonus (non-required) fields also captured
  requiredComplete: boolean;
  fractionComplete: number;                 // acceptedRequired / requiredFields, 0..1
  validation: { active: boolean; confirmed: boolean };
  fieldConfidence: LicenseData['dataConfidence'];
}
```

## TTA verification (OCR mode)

The live scan votes each field across ~30 frames with a `minVotes: 2` floor, so a value that OCRs cleanly in only **one** frame (a `sex` read garbled in all the others, a single-character vehicle class) never reaches two votes and is dropped — even though the best retained crop contains it plainly. **Best-crop re-parse** (a test-time-augmentation, "TTA", step) fixes this: on **every** finalization the library re-OCRs the single best captured card crop **once** with a fresh `minVotes: 1` voter and merges anything new into the result. It does not replace `validationPass` — it composes with it.

This runs **by default** (on both finalize paths: the required set being satisfied, and `maxFrames` being hit with `phase: 'incomplete'`). You only touch the `tta` field to tune the augmentations or turn it off:

```ts
const scanner = useLicenseScanner('ocr', OCR_MODELS, {
  validationPass: true,
  // tta is ON by default; this block is only needed to customize or disable it.
  tta: {
    enabled: true, // default; set false to skip the best-crop re-parse entirely
    modes: ['original', 'blueChannel', 'contrastStretch'], // optional; this is the default
  },
});
```

```ts
type TtaMode = 'original' | 'blueChannel' | 'contrastStretch';
```

| Mode | What it does |
|---|---|
| `original` | **Unfiltered passthrough** — the clean retained crop is re-parsed as-is. This is the default first mode and the heart of the step: with `minVotes: 1` it recovers fields (e.g. `sex`) the multi-frame `minVotes: 2` vote dropped. The color/contrast filters below can *degrade* an already-legible read, so `original` runs first and is the safe baseline. |
| `blueChannel` | Grayscale built from the **blue channel only**. On blue document stock (e.g. the Wisconsin license) dark glyphs have maximal contrast in blue, which can recover small characters single-pass OCR drops. |
| `contrastStretch` | Per-channel 2% / 98% percentile linear stretch — a color-agnostic hedge for flat or low-contrast captures. |

**Mechanism.** At finalize the JS hook calls the native `runTtaVerification(modes)` once. Native re-OCRs the consensus rectified card crop the pipeline already retained (the same buffer it saved as `cardImagePath`) under each requested augmentation, votes those re-parsed "frames" with a fresh `minVotes: 1` voter, and returns a consensus `LicenseData`. The hook folds that into the accumulated result with the **same strictly-higher-confidence rule** used across normal frames — already-confirmed fields are kept; a field is only overwritten by a strictly stronger read, so a recovered glyph can fill a gap but never clobber a good value. The pass is best-effort: if native has no retained crop, finds no consensus, or the call throws, the scan finalizes with the data it already had. The re-parse does not mutate the live scan voter and does not re-save the card/headshot images.

> **Status:** the `original` (identity) pass is the designed fix for the real Wisconsin scan that reached 8/9 required fields + all extras with only `sex` dropped — the best crop's OCR plainly contains the sex row, and the shared C++ parser extracts it, but the multi-frame `minVotes: 2` vote dropped the single clean read. `blueChannel` is offline-validated for `vehicleClass` recovery (offline sweep lifted a Wisconsin card crop from 6/10 to 10/10 fields). On-device confirmation of the full default-on flow is pending; treat this section as the documented API surface, not a finished on-device benchmark.

## Confidence Tiers

Every field that reaches `LicenseData` carries a `tier` and a numeric `score` in `dataConfidence`. The score is **not** a probability — it's a fixed value derived from a 4-rung validation ladder:

| Tier | Score | When it fires |
|---|---|---|
| `cross_validated` | 1.00 | Two independent paths (strict-text-pool parser + bbox-IoU YOLO match) **agreed** on the same value |
| `all_gates_passed` | 0.95 | Strict 4-gate demographic parser accepted the value; no bbox confirmation |
| `shape_matched` | 0.85 | Value passed its content-shape regex / allowlist (e.g. `MM/DD/YYYY`, `^(BLK\|BRO\|...)$`, `\d{5}` ZIP) |
| `extracted_raw` | 0.50 | Value was pulled from the OCR text pool but no content gate was applied |

This is documented in `cpp/license_data.hpp` (`enum class ValidationTier`). Users who want a probabilistic confidence should treat the tier as a categorical signal — `cross_validated` and `all_gates_passed` are trustworthy enough to auto-fill a form; `shape_matched` is good for display; `extracted_raw` should be reviewed.

## Architecture

```
JavaScript / React
        │
        ▼
  useLicenseScanner
  (React hook, src/)
        │
        ▼
  Nitro HybridObject  ◄──────── NativeDLScan.parseBarcodeData()
  (DLScan hybrid)
     │         │
     ▼         ▼
  iOS Swift   Android Kotlin
  C++ interop    JNI bridge
     │               │
     └───────┬───────┘
             ▼
     C++17 AAMVA parser core
          (cpp/)
```

- `cpp/` — platform-independent AAMVA parsing logic (C++17). Tested via CMake + GoogleTest (`yarn test:cpp`).
- `ios/` — Swift host that calls the C++ core via Swift 5.9 C++ interop.
- `android/src/main/` — Kotlin host that calls the C++ core via NDK + JNI.

## Performance

| Mode | Latency | Notes |
|---|---|---|
| Barcode | Sub-frame (~1–3 ms) | Handled by the VC v5 barcode-scanner plugin; parsing adds negligible overhead |
| OCR — iOS | ~200–400 ms / frame | Serialized on a `DispatchQueue`; 300 ms cooldown → ~3.3 fps effective |
| OCR — Android | ~250–500 ms / frame | Same 300 ms cooldown; result cached between frames |

The Nitro HybridObject bridge overhead is in the single-digit microseconds range for small calls — roughly 5–10× less than a legacy TurboModule JSI bridge.

## Bundled Models

The `'ocr'` scan mode uses one trained on-device ML model plus platform-vendor
APIs for document segmentation and text recognition. The trained model is
built on the
[IDNet](https://huggingface.co/datasets/cactuslab/IDNet-2025) fully synthetic
identity document dataset — no real PII in the training pipeline.

| Component | Architecture | Purpose |
|---|---|---|
| `DLScanFieldDetector` | YOLOv8n (trained) | Locate individual text fields on the rectified document |
| Document segmentation | Platform vendor | Detect and rectify the ID card in the camera frame |
| Text recognition (OCR) | Platform vendor | Read text from each cropped field region |

**Document segmentation** uses Apple's
[`VNDetectDocumentSegmentationRequest`](https://developer.apple.com/documentation/vision/vndetectdocumentsegmentationrequest)
on iOS (Vision framework, iOS 15+, ANE-accelerated). On Android we ship
**DocAligner** (`lcnet100`, FP16, 2.4 MB) as a bundled TFLite model — Android
has no equivalent free Vision API for corner-based rectification, and the
DocAligner channel-2 heatmap with `setPolyToPoly` matrix transform gives a
parity-quality rectified card. DocAligner is a third-party model from
[DocsaidLab](https://github.com/DocsaidLab/DocAligner), redistributed under
Apache-2.0; see [docs/THIRD_PARTY_MODELS.md](docs/THIRD_PARTY_MODELS.md) for its
license and NOTICE.

The trained field detector is shipped as Core ML (iOS, mode=linear weight-only
int8 with `weight_threshold=65536` to leave the detection head at full FP16) and
TFLite (Android, full int8) and runs entirely on-device. No data is sent to
any server.

**Coverage:** 10 US states (AZ, CA, DC, NV, NC, PA, SD, UT, WV, WI) and
10 international document types. Document segmentation accuracy also depends
on the vendor API and may vary by jurisdiction and lighting conditions.
See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for the full list of unsupported
jurisdictions and known failure modes.

**Not certified for KYC or compliance use.** See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

Full documentation:

- [docs/MODEL_CARD.md](docs/MODEL_CARD.md) — model architecture, license, carbon footprint, citation
- [docs/MODEL_CONTRACT.md](docs/MODEL_CONTRACT.md) — field-detector runtime I/O contract (input preprocessing, output tensor layout, NMS)
- [docs/DATA_CARD.md](docs/DATA_CARD.md) — dataset provenance, privacy, and ethics
- [docs/TRAINING_DETAILS.md](docs/TRAINING_DETAILS.md) — hardware, hyperparameters, reproducibility
- [docs/EVALUATION.md](docs/EVALUATION.md) — evaluation methodology and metrics
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — jurisdictional coverage and failure modes
- [docs/REPRODUCIBILITY.md](docs/REPRODUCIBILITY.md) — step-by-step retrain instructions

## Future Direction

- Runtime fuzzy field-matching (Levenshtein + per-field dictionaries) inside the C++ extractor to absorb common platform-OCR substitution errors at parse time.
- Surfacing the cropped + oriented DL image and the detected headshot region to JS — see issues [#92](https://github.com/iotashan/react-native-dl-scan/issues/92) and [#93](https://github.com/iotashan/react-native-dl-scan/issues/93).
- Scanner config knobs (votingFrames, cameraRotation hint, MRZ fallback path) — see the [open issues](https://github.com/iotashan/react-native-dl-scan/issues).

## Privacy & compliance

This library processes all camera frames and parsed license data **on-device**. It does not transmit any data over the network and does not write license fields to disk except where the consuming app explicitly enables card-image capture (and only into the app's private container).

Consuming apps are responsible for:

- Declaring camera usage in their privacy policy (GDPR, CCPA, state-specific privacy laws)
- Implementing the platform permission prompts (`NSCameraUsageDescription` on iOS, runtime camera permission on Android)
- Deciding how long to retain license fields after the library returns them — the library itself retains nothing across scan sessions

**Not certified for KYC, AML, or regulated identity verification.** This library is intended for convenience data-capture flows. It has not been evaluated against any regulated identity-verification framework.

## Trademarks

This library implements the publicly published AAMVA D-20 driver-license data format. **AAMVA** is a trademark of the American Association of Motor Vehicle Administrators. This project is not affiliated with, endorsed by, or sponsored by AAMVA.

Vendor APIs used by this library (Apple Vision, Apple Core ML, Google ML Kit, Google TensorFlow Lite, Vision Camera) are trademarks of their respective owners.

## Contributing

Bug reports, feature suggestions, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

For security issues, please follow the disclosure process in [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
