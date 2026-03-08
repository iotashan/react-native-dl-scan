# react-native-dl-scan

React Native Turbo Module for scanning US driver's licenses. Detects PDF417 barcodes (back of license) and falls back to OCR text recognition (front of license) using Apple's Vision framework. Integrates with [react-native-vision-camera](https://github.com/mrousavy/react-native-vision-camera) as a frame processor plugin.

**iOS only.** Requires iOS 15.0+.

## Installation

```sh
yarn add react-native-dl-scan react-native-vision-camera react-native-worklets-core
cd ios && pod install
```

Add camera permission to your `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Camera access is needed to scan your driver's license</string>
```

## Usage

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
        <Text>DL# {licenseData.licenseNumber}</Text>
        <Text>DOB: {licenseData.dateOfBirth}</Text>
        <Button title="Scan Again" onPress={reset} />
      </View>
    );
  }

  return (
    <Camera
      device={device}
      isActive={isScanning}
      frameProcessor={frameProcessor}
      style={{ flex: 1 }}
    />
  );
}
```

### Scan Modes

- `'barcode'` — Scans the PDF417 barcode on the back of the license (recommended, most accurate)
- `'ocr'` — Uses text recognition on the front of the license (fallback, less reliable)

### Direct Barcode Parsing

If you already have a raw AAMVA barcode string, you can parse it directly:

```ts
import NativeDlScan from 'react-native-dl-scan/src/NativeDlScan';

const data = await NativeDlScan.parseBarcodeData(rawBarcodeString);
```

## API

### `useLicenseScanner(mode?: ScanMode)`

React hook that returns:

| Property | Type | Description |
|---|---|---|
| `licenseData` | `LicenseData \| null` | Parsed license data on success |
| `error` | `string \| null` | Error message if scanning fails |
| `isScanning` | `boolean` | Whether scanning is active |
| `frameProcessor` | `(frame: Frame) => void` | Pass to Camera's `frameProcessor` prop |
| `reset` | `() => void` | Reset to scan again |

### `LicenseData`

```ts
interface LicenseData {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  dateOfBirth: string | null;       // ISO 8601 date
  expirationDate: string | null;    // ISO 8601 date
  issueDate: string | null;         // ISO 8601 date
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
}
```

## License

MIT
