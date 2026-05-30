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
| iOS | `DlScanFieldDetector.mlmodelc` (compiled Core ML) | ~4.3 MB |
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

> **CocoaPods sunset notice:** The `DlScan.podspec` is retained as a compatibility shim through **2026-12-02**, when CocoaPods Trunk goes permanently read-only. Plan your migration to SPM before that date — after it, only SPM is supported.

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

### `useLicenseScanner(mode?: ScanMode)`

React hook for camera-based scanning. Returns:

| Property | Type | Description |
|---|---|---|
| `licenseData` | `LicenseData \| null` | Parsed license fields once a scan succeeds |
| `error` | `string \| null` | Error message if a scan attempt fails |
| `isScanning` | `boolean` | `true` while actively scanning |
| `output` | `CameraOutput` | Pass to `<Camera outputs={[output]} />`. Internally resolved per mode and per platform — barcode mode uses AVFoundation `useObjectOutput` on iOS and `react-native-vision-camera-barcode-scanner` on Android; OCR mode is a worklet frame processor on both. |
| `reset` | `() => void` | Clear `licenseData` / `error` and restart scanning |

### `NativeDlScan.parseBarcodeData(rawAamvaString: string): Promise<LicenseData | null>`

Direct parse for callers who already have a raw AAMVA barcode string — e.g., from a handheld scanner, an NFC read, or a test fixture — without needing a camera feed.

```ts
import { NativeDlScan } from 'react-native-dl-scan';

const data = await NativeDlScan.parseBarcodeData(rawBarcodeString);
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
  sex: 'M' | 'F' | 'X' | null;
  eyeColor: string | null;
  hairColor: string | null;
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
```

### `ScanMode`

```ts
type ScanMode = 'barcode' | 'ocr';
```

## Scan Modes

### `'barcode'` (recommended)

Reads the PDF417 barcode on the back of the license. iOS uses Vision Camera v5's built-in `useObjectOutput` (AVFoundation `AVCaptureMetadataOutput` + `AVMetadataMachineReadableCodeObject` — pure Apple stack, simulator-friendly). Android uses `react-native-vision-camera-barcode-scanner` (Google MLKit Barcode). 30 fps capable on both. Handles the vast majority of US and Canadian licenses issued since ~2000.

### `'ocr'`

Reads text from the front of the license. Uses VisionKit on iOS and ML Kit Text Recognition on Android, with rate-limiting to approximately 3.3 fps internally (300 ms cooldown between OCR jobs). The platform layer collects OCR observations and YOLO bbox detections, then hands typed `FieldCandidate` records over Nitro to the C++ extractor — the same `extract_fields_from_candidates` runs on both iOS and Android. Multi-frame voting (8 frames by default with adaptive consensus exit on 2 consecutive identical results) converges on the per-(FieldId, FieldSource) consensus value before structured normalization. Accuracy varies by jurisdiction; covered jurisdictions are listed in [docs/MODEL_CARD.md](docs/MODEL_CARD.md).

OCR runs **asynchronously** inside the Nitro hybrid: the worklet returns the most recently cached result immediately and queues a fresh OCR job in the background. New results surface on subsequent frames with no frame-processor stall.

**Fallback chains.** When OCR garbles the AAMVA index prefix or fuses adjacent fields, the C++ extractor reaches into the raw text pool to recover. Specifically:
- **Chronological-date scanner** — when the `3 DOB`, `4a ISS`, or `4b EXP` index tokens don't lex cleanly, every observation is scanned for `MM/DD/YYYY` tokens; if exactly three valid dates appear, they're assigned chronologically (oldest = DOB, middle = issue, newest = expire).
- **scanForClass text-pool** — when OCR misreads `4d` as `46` (a real WI/IL OCR pattern) and the lexer never emits a `9 CLASS X` token, every observation is searched for `(CLASS|CLAS|GLASS) X` and the matched code feeds `vehicleClass`.

These fallbacks fire only when the strict parser fails for a given field, so a clean read still flows through the normal `(FieldId, FieldSource)` typed-candidate path.

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
  Nitro HybridObject  ◄──────── NativeDlScan.parseBarcodeData()
  (DlScan hybrid)
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
| `DlScanFieldDetector` | YOLOv8n (trained) | Locate individual text fields on the rectified document |
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
