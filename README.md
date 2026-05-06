# react-native-dl-scan

Scan US and Canadian driver's licenses in React Native — iOS and Android — powered by a shared C++17 AAMVA parsing core and exposed as a [Nitro Modules](https://github.com/mrousavy/nitro) HybridObject.

[![npm version](https://img.shields.io/npm/v/react-native-dl-scan.svg)](https://www.npmjs.com/package/react-native-dl-scan)
[![CI](https://github.com/iotashan/react-native-dl-scan/actions/workflows/ci.yml/badge.svg)](https://github.com/iotashan/react-native-dl-scan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Quick Example

```tsx
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { useLicenseScanner } from 'react-native-dl-scan';

function ScanScreen() {
  const device = useCameraDevice('back');
  const { licenseData, isScanning, frameProcessor, reset } = useLicenseScanner('barcode');

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
      outputs={[frameProcessor]}
      style={{ flex: 1 }}
    />
  );
}
```

> **Note:** `outputs={[frameProcessor]}` is the Vision Camera v5 plural array prop. The v4 `frameProcessor={...}` single-prop idiom is not supported.

## Features

- **PDF417 barcode scanning** (back of license) via the official `react-native-vision-camera-barcode-scanner` plugin — MLKit on Android, Apple Vision on iOS. Up to 30 fps.
- **Front-of-license OCR** via VisionKit (iOS) and ML Kit Text Recognition (Android), feeding a shared C++17 field extractor. Experimental; accuracy varies by jurisdiction.
- **Full AAMVA v1–v11 support** with US and Canadian jurisdictional quirks, validated by 66 GoogleTest cases for cross-platform parity.
- **Single parsing core** (`cpp/`) shared between iOS (Swift C++ interop) and Android (NDK + JNI bridge) — same results on both platforms.
- **Nitro HybridObject** — approximately 5–10× faster than a legacy TurboModule on small calls; bridge overhead measured in microseconds, not milliseconds.

## Requirements

| Requirement | Minimum version |
|---|---|
| React Native | 0.79+ (Nitro requires the New Architecture) |
| iOS | 15.0+ (Nitro floor + VisionKit baseline) |
| Android API level | 24+ |
| Android Gradle Plugin | 9.1.0+ (matches Vision Camera v5; consumer apps on AGP 8.x must upgrade) |
| Xcode | 15+ (Swift 5.9 C++ interop) |

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
| `frameProcessor` | `CameraFrameOutput` | Pass to `<Camera outputs={[frameProcessor]}>` (Vision Camera v5) |
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
  height: string | null;
  vehicleClass: string | null;
  restrictions: string | null;
  endorsements: string | null;
  aamvaVersion: number | null;      // AAMVA spec version (1–11)
}
```

### `ScanMode`

```ts
type ScanMode = 'barcode' | 'ocr';
```

## Scan Modes

### `'barcode'` (recommended)

Reads the PDF417 barcode on the back of the license. Uses `react-native-vision-camera-barcode-scanner` internally — Apple Vision on iOS, MLKit on Android. 30 fps capable. Handles the vast majority of US and Canadian licenses issued since ~2000.

### `'ocr'` (experimental)

Reads text from the front of the license. Uses VisionKit on iOS and ML Kit Text Recognition on Android, rate-limited to approximately 2 fps internally (500 ms cooldown between OCR jobs). Accuracy varies by jurisdiction — not all states/provinces produce cleanly parseable layouts. Use as a fallback when the barcode is damaged, absent, or obscured.

OCR runs **asynchronously** inside the Nitro hybrid: the worklet returns the most recently cached result immediately and queues a fresh OCR job in the background. New results surface on subsequent frames with no frame-processor stall.

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
| OCR — iOS | ~200–400 ms / frame | Serialized on a `DispatchQueue`; 500 ms cooldown → ~2 fps effective |
| OCR — Android | ~250–500 ms / frame | Same 500 ms cooldown; result cached between frames |

The Nitro HybridObject bridge overhead is in the single-digit microseconds range for small calls — roughly 5–10× less than a legacy TurboModule JSI bridge.

## Future Direction

- `confidence` and `partialMatch` fields for OCR results — the C++ extractor already computes them internally; surfacing them to JS is planned for an upcoming release.
- A bundled YOLOv8-OBB document detector combined with a character-level OCR disambiguation model is in development, trained against a synthetic ID corpus. This will significantly improve front-of-license OCR accuracy across jurisdictions.

## License

MIT — see [LICENSE](LICENSE).
