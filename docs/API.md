# React Native DL Scan API Reference

A comprehensive guide to the public API of react-native-dl-scan, a React Native library for scanning driver's licenses using PDF417 barcodes and OCR.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Functions](#core-functions)
- [Hooks](#hooks)
- [Components](#components)
- [Types](#types)
- [Error Handling](#error-handling)
- [Advanced Configuration](#advanced-configuration)
- [Performance Monitoring](#performance-monitoring)

## Installation

```bash
npm install react-native-dl-scan
# or
yarn add react-native-dl-scan
```

### iOS Setup

1. Install iOS dependencies:
```bash
cd ios && pod install
```

2. Add camera usage permission to your `Info.plist`:
```xml
<key>NSCameraUsageDescription</key>
<string>This app needs access to camera to scan driver licenses</string>
```

### Android Setup

Add camera permission to your `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.CAMERA" />
```

## Quick Start

### Basic Usage with Hooks

```tsx
import React from 'react';
import { View, Button, Text } from 'react-native';
import { useLicenseScanner, CameraScanner } from 'react-native-dl-scan';

export default function App() {
  const { licenseData, isScanning, error, scan, reset } = useLicenseScanner();

  return (
    <View style={{ flex: 1 }}>
      {!isScanning ? (
        <View>
          <Button title="Start Scanning" onPress={() => scan()} />
          {licenseData && (
            <Text>Name: {licenseData.firstName} {licenseData.lastName}</Text>
          )}
          {error && <Text>Error: {error.userMessage}</Text>}
        </View>
      ) : (
        <CameraScanner
          onLicenseScanned={(data) => {
            console.log('Scanned:', data);
          }}
          onError={(err) => console.error(err)}
          onCancel={reset}
        />
      )}
    </View>
  );
}
```

### Direct Function Usage

```tsx
import { scanLicense, parseOCRText } from 'react-native-dl-scan';

// Scan PDF417 barcode data
const licenseData = await scanLicense(barcodeString);

// Parse OCR text observations
const licenseData = await parseOCRText(textObservations);
```

## Core Functions

### `scanLicense(barcodeData: string): Promise<LicenseData>`

Scans a PDF417 barcode string and extracts license data.

**Parameters:**
- `barcodeData` (string): The raw PDF417 barcode string

**Returns:**
- `Promise<LicenseData>`: Parsed license information

**Example:**
```tsx
try {
  const data = await scanLicense(barcodeString);
  console.log(`License holder: ${data.firstName} ${data.lastName}`);
} catch (error) {
  if (error instanceof ScanError) {
    console.error(`Scan failed: ${error.userMessage}`);
  }
}
```

### `parseOCRText(textObservations: OCRTextObservation[]): Promise<LicenseData>`

Parses OCR text observations into structured license data.

**Parameters:**
- `textObservations` (OCRTextObservation[]): Array of text observations from Vision Framework

**Returns:**
- `Promise<LicenseData>`: Parsed license information

**Example:**
```tsx
const textObservations = [
  {
    text: "JOHN DOE",
    confidence: 0.95,
    boundingBox: { x: 10, y: 20, width: 100, height: 20 }
  }
];

const data = await parseOCRText(textObservations);
```

## Hooks

### `useLicenseScanner(options?: LicenseScannerOptions)`

A comprehensive React hook for license scanning with automatic fallback support.

**Parameters:**
- `options` (LicenseScannerOptions, optional): Configuration options

**Returns:**
- `LicenseScannerState & LicenseScannerActions`: Combined state and actions

#### LicenseScannerOptions

```tsx
interface LicenseScannerOptions {
  mode?: 'auto' | 'barcode' | 'ocr';           // Default: 'auto'
  barcodeTimeout?: number;                      // Default: 10000ms
  enableFallback?: boolean;                     // Default: true
  confidenceThreshold?: number;                 // Default: 0.8
}
```

#### State Properties

```tsx
interface LicenseScannerState {
  licenseData: LicenseData | null;             // Scanned license data
  isScanning: boolean;                          // Current scanning state
  error: ScanError | null;                     // Last error encountered
  scanMode: ScanMode;                          // Current scan mode
  currentMode: 'barcode' | 'ocr' | 'switching'; // Active processing mode
  scanProgress: ScanProgress | null;           // Real-time progress info
  scanMetrics: ScanMetrics | null;             // Performance metrics
  autoModeState: AutoModeState | null;         // Auto mode state machine
  lastQualityMetrics: QualityMetrics | null;   // Latest quality assessment
}
```

#### Action Methods

```tsx
interface LicenseScannerActions {
  // Primary scanning methods
  scan: (input: string | OCRTextObservation[], mode?: ScanMode) => Promise<void>;
  scanBarcode: (barcodeData: string) => Promise<void>;
  scanOCR: (textObservations: OCRTextObservation[]) => Promise<void>;
  scanWithFallback: (barcodeData: string) => Promise<void>;
  
  // State management
  reset: () => void;
  clearError: () => void;
  cancel: () => void;
  setScanMode: (mode: ScanMode) => void;
  
  // Configuration
  updateFallbackConfig: (config: Partial<FallbackConfig>) => void;
  processQualityMetrics: (metrics: QualityMetrics) => boolean;
}
```

**Example:**
```tsx
const {
  licenseData,
  isScanning,
  error,
  scan,
  reset,
  scanMode,
  setScanMode
} = useLicenseScanner({
  mode: 'auto',
  barcodeTimeout: 15000,
  enableFallback: true
});

// Change scan mode
setScanMode('barcode');

// Start scanning with custom mode
await scan(inputData, 'ocr');
```

### `useThrottledQualityMetrics(interval?: number)`

Hook for throttled quality metrics processing to optimize performance.

**Parameters:**
- `interval` (number, optional): Throttle interval in milliseconds (default: 100ms)

**Returns:**
- Object with throttled quality processing functions

**Example:**
```tsx
const { processQualityMetrics, lastMetrics } = useThrottledQualityMetrics(500);

// Process quality metrics (throttled)
const shouldContinue = processQualityMetrics(qualityData);
```

## Components

### `<CameraScanner />`

Primary camera component for license scanning with automatic mode detection.

#### Props

```tsx
interface CameraScannerProps {
  // Core callbacks
  onLicenseScanned?: (data: LicenseData) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
  
  // Mode control
  mode?: ScanMode;                              // 'auto' | 'barcode' | 'ocr'
  onModeChange?: (mode: ScanMode) => void;
  autoModeState?: AutoModeState | null;
  
  // Progress and metrics
  scanProgress?: ScanProgress | null;
  onQualityMetrics?: (metrics: QualityMetrics) => void;
  
  // Configuration
  frameProcessorConfig?: {
    enableBarcode?: boolean;
    enableOCR?: boolean;
    confidenceThreshold?: number;
  };
  
  // Accessibility
  accessibilityOptions?: {
    voiceGuidance?: boolean;
    hapticFeedback?: boolean;
    highContrast?: boolean;
  };
  
  // Quality feedback
  showQualityIndicator?: boolean;
  qualityCheckInterval?: number;                // Default: 1000ms
  onQualityMetricsUpdate?: (metrics: QualityMetrics) => void;
}
```

**Example:**
```tsx
<CameraScanner
  mode="auto"
  onLicenseScanned={(data) => {
    console.log('Scanned:', data);
    navigation.navigate('Results', { data });
  }}
  onError={(error) => {
    Alert.alert('Scan Error', error.message);
  }}
  onModeChange={(mode) => {
    console.log('Mode changed to:', mode);
  }}
  showQualityIndicator={true}
  accessibilityOptions={{
    voiceGuidance: true,
    hapticFeedback: true
  }}
/>
```

### `<QualityIndicator />`

Real-time quality feedback component for scan conditions.

#### Props

```tsx
interface QualityIndicatorProps {
  metrics: QualityMetrics;
  dismissible?: boolean;                        // Default: false
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;                           // Default: false
}
```

**Example:**
```tsx
<QualityIndicator
  metrics={{
    documentDetection: { detected: true, confidence: 0.95 },
    lighting: { brightness: 0.8, uniformity: 0.7 },
    focus: { clarity: 0.9 },
    positioning: { coverage: 0.85, status: 'good' }
  }}
  dismissible={true}
  onDismiss={() => setShowQuality(false)}
/>
```

### `<ModeSelector />`

UI component for manual scan mode selection.

#### Props

```tsx
interface ModeSelectorProps {
  currentMode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  availableModes?: ScanMode[];                 // Default: ['auto', 'barcode', 'ocr']
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}
```

**Example:**
```tsx
<ModeSelector
  currentMode={scanMode}
  onModeChange={setScanMode}
  availableModes={['barcode', 'ocr']}
  style={{ marginVertical: 20 }}
/>
```

### `<GuidanceOverlay />`

Contextual guidance overlay for improved scan success rates.

#### Props

```tsx
interface GuidanceOverlayProps {
  scanMode: ScanMode;
  qualityMetrics?: QualityMetrics;
  scanProgress?: ScanProgress;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}
```

## Types

### `LicenseData`

Complete license information structure.

```tsx
interface LicenseData {
  // Personal Information
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;

  // Dates
  dateOfBirth?: Date;
  issueDate?: Date;
  expirationDate?: Date;

  // Physical Description
  sex?: 'M' | 'F';
  eyeColor?: string;
  hairColor?: string;
  height?: string;
  weight?: string;

  // Address
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };

  // License Information
  licenseNumber?: string;
  licenseClass?: string;
  restrictions?: string;
  endorsements?: string;

  // Metadata
  issuerIdentificationNumber?: string;
  documentDiscriminator?: string;

  // Flags
  isOrganDonor?: boolean;
  isVeteran?: boolean;
  isRealID?: boolean;

  // Raw data for debugging
  allFields?: Record<string, string>;
}
```

### `ScanMode`

```tsx
type ScanMode = 'auto' | 'barcode' | 'ocr';
```

- `'auto'`: Automatically tries barcode first, falls back to OCR
- `'barcode'`: PDF417 barcode scanning only
- `'ocr'`: Optical Character Recognition only

### `QualityMetrics`

Real-time scan quality assessment.

```tsx
interface QualityMetrics {
  documentDetection: {
    detected: boolean;
    confidence: number;                         // 0-1
  };
  lighting: {
    brightness: number;                         // 0-1
    uniformity: number;                         // 0-1
    status: 'good' | 'warning' | 'poor';
  };
  focus: {
    clarity: number;                           // 0-1
    status: 'good' | 'warning' | 'poor';
  };
  positioning: {
    coverage: number;                          // 0-1
    status: 'good' | 'warning' | 'poor';
  };
}
```

### `ScanProgress`

Real-time scanning progress information.

```tsx
interface ScanProgress {
  state: 'idle' | 'barcode' | 'ocr' | 'fallback_transition' | 'completed' | 'failed';
  mode: ScanMode;
  startTime: number;
  barcodeAttempts: number;
  timeElapsed: number;
  message?: string;
  progressPercentage?: number;                  // 0-100
  showCancelButton?: boolean;
  isTransitioning?: boolean;
  estimatedTimeRemaining?: number;
  accessibilityAnnouncement?: string;
}
```

### `ScanMetrics`

Performance and diagnostic metrics.

```tsx
interface ScanMetrics {
  totalProcessingTime: number;
  barcodeAttemptTime?: number;
  ocrProcessingTime?: number;
  modeTransitionTime?: number;
  fallbackTriggered: boolean;
  fallbackReason?: 'timeout' | 'failure' | 'quality' | 'manual';
  finalMode: ScanMode;
  success: boolean;
  
  // Performance metrics
  barcodeAttempts?: number;
  ocrAttempts?: number;
  retryAttempts?: number;
  peakMemoryUsageMB?: number;
  frameQualityScore?: number;
  confidenceScore?: number;
  performanceRating?: 'excellent' | 'good' | 'acceptable' | 'poor' | 'critical';
}
```

## Error Handling

### `ScanError`

Custom error class for scanning-related errors.

```tsx
class ScanError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly recoverable: boolean;
  
  constructor(error: {
    code: string;
    message: string;
    userMessage: string;
    recoverable: boolean;
  });
}
```

#### Error Codes

- `PERMISSION_DENIED`: Camera permission not granted
- `CAMERA_NOT_AVAILABLE`: No camera device available
- `INVALID_LICENSE_FORMAT`: Unable to parse license data
- `SCAN_TIMEOUT`: Scanning operation timed out
- `PROCESSING_ERROR`: Internal processing error
- `OCR_PARSING_ERROR`: OCR text parsing failed
- `UNSUPPORTED_LICENSE`: License format not supported
- `UNKNOWN_ERROR`: Unexpected error occurred

#### Error Handling Pattern

```tsx
try {
  const data = await scanLicense(barcodeData);
  // Handle success
} catch (error) {
  if (error instanceof ScanError) {
    console.log(`Error code: ${error.code}`);
    console.log(`User message: ${error.userMessage}`);
    console.log(`Recoverable: ${error.recoverable}`);
    
    if (error.recoverable) {
      // Show retry option
      showRetryDialog(error.userMessage);
    } else {
      // Show error and alternative options
      showErrorDialog(error.userMessage);
    }
  } else {
    // Handle unexpected errors
    console.error('Unexpected error:', error);
  }
}
```

## Advanced Configuration

### FallbackController

Advanced fallback management for production applications.

```tsx
import { FallbackController } from 'react-native-dl-scan';

const fallbackController = new FallbackController({
  barcodeTimeoutMs: 10000,
  ocrTimeoutMs: 15000,
  maxBarcodeAttempts: 3,
  maxFallbackProcessingTimeMs: 30000,
  enableQualityAssessment: true,
  confidenceThreshold: 0.8
});

// Listen to events
fallbackController.on('progressUpdate', (progress) => {
  console.log('Progress:', progress);
});

fallbackController.on('performanceAlert', (alert) => {
  console.log('Performance alert:', alert);
});
```

### Storage Configuration

Persist user preferences and scan modes.

```tsx
import {
  initializeStorage,
  getPersistedScanMode,
  persistScanMode,
  InMemoryStorageAdapter
} from 'react-native-dl-scan';

// Initialize with custom storage adapter
await initializeStorage(new InMemoryStorageAdapter());

// Persist user's preferred scan mode
await persistScanMode('barcode');

// Retrieve persisted mode
const mode = await getPersistedScanMode();
```

### Frame Processor Configuration

Fine-tune scanning behavior for specific use cases.

```tsx
const frameProcessorConfig = {
  enableBarcode: true,
  enableOCR: true,
  confidenceThreshold: 0.85,
  qualityThreshold: 0.7
};

<CameraScanner
  frameProcessorConfig={frameProcessorConfig}
  mode="auto"
  onLicenseScanned={handleScan}
/>
```

## Performance Monitoring

### Performance Metrics

Monitor scanning performance for optimization.

```tsx
const { scanMetrics } = useLicenseScanner();

useEffect(() => {
  if (scanMetrics) {
    console.log('Scan took:', scanMetrics.totalProcessingTime, 'ms');
    console.log('Performance rating:', scanMetrics.performanceRating);
    
    if (scanMetrics.performanceRating === 'poor') {
      // Consider fallback strategies or device-specific optimizations
    }
  }
}, [scanMetrics]);
```

### Quality Assessment

Implement quality-based scanning decisions.

```tsx
const qualityHandler = (metrics: QualityMetrics) => {
  const overallScore = (
    metrics.lighting.brightness +
    metrics.focus.clarity +
    metrics.positioning.coverage
  ) / 3;
  
  if (overallScore < 0.6) {
    // Show guidance for better conditions
    showQualityGuidance(metrics);
  }
};

<CameraScanner
  onQualityMetricsUpdate={qualityHandler}
  qualityCheckInterval={500}
/>
```

## Platform Considerations

### iOS

- Requires iOS 11.0 or later
- Utilizes Vision Framework for OCR
- PDF417 scanning via Vision Framework barcode detection
- Automatic Neural Engine optimization when available

### Android

- Requires Android API level 21 (Android 5.0) or later
- Uses ML Kit for text recognition
- ZXing library for barcode scanning
- Automatic hardware acceleration when available

## Best Practices

1. **Always handle camera permissions gracefully**
2. **Provide clear user feedback during scanning**
3. **Implement proper error recovery mechanisms**
4. **Use appropriate scan modes for your use case**
5. **Monitor performance metrics in production**
6. **Provide accessibility support for all users**
7. **Test thoroughly on various device configurations**

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues and solutions.

## Examples

See the [example app](../example/README.md) for comprehensive usage examples demonstrating all library features.