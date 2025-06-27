# Integration Guide

A step-by-step guide for integrating react-native-dl-scan into your React Native application.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Basic Integration](#basic-integration)
- [Advanced Integration](#advanced-integration)
- [Production Considerations](#production-considerations)
- [Platform-Specific Setup](#platform-specific-setup)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before integrating react-native-dl-scan, ensure your project meets these requirements:

- React Native 0.70.0 or later
- TypeScript support (recommended)
- iOS deployment target 11.0 or later
- Android API level 21 (Android 5.0) or later

### Required Dependencies

The library depends on these peer dependencies:

```json
{
  "react-native-vision-camera": "^3.0.0",
  "react-native-reanimated": "^3.0.0"
}
```

## Installation

### Step 1: Install the Package

```bash
npm install react-native-dl-scan
# or
yarn add react-native-dl-scan
```

### Step 2: Install Peer Dependencies

```bash
npm install react-native-vision-camera react-native-reanimated
# or
yarn add react-native-vision-camera react-native-reanimated
```

### Step 3: iOS Setup

1. Install iOS dependencies:
```bash
cd ios && pod install
```

2. Add camera permission to `ios/YourApp/Info.plist`:
```xml
<key>NSCameraUsageDescription</key>
<string>This app uses the camera to scan driver licenses for identity verification</string>
```

### Step 4: Android Setup

1. Add camera permission to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.CAMERA" />
```

2. Ensure minimum SDK version in `android/app/build.gradle`:
```gradle
android {
    ...
    defaultConfig {
        minSdkVersion 21
        ...
    }
}
```

### Step 5: Configure Reanimated

Add to your `babel.config.js`:

```javascript
module.exports = {
  plugins: [
    'react-native-reanimated/plugin',
  ],
};
```

## Basic Integration

### Step 1: Simple Scanning Component

Create a basic scanning component:

```tsx
// ScannerScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
} from 'react-native';
import {
  CameraScanner,
  useLicenseScanner,
  type LicenseData,
} from 'react-native-dl-scan';

export default function ScannerScreen() {
  const [showCamera, setShowCamera] = useState(false);
  const { licenseData, error, reset } = useLicenseScanner();

  const handleScanComplete = (data: LicenseData) => {
    setShowCamera(false);
    Alert.alert(
      'Scan Successful',
      `License scanned for ${data.firstName} ${data.lastName}`,
      [{ text: 'OK' }]
    );
  };

  const handleError = (scanError: Error) => {
    setShowCamera(false);
    Alert.alert('Scan Error', scanError.message, [
      { text: 'Try Again', onPress: () => setShowCamera(true) },
      { text: 'Cancel' },
    ]);
  };

  if (showCamera) {
    return (
      <CameraScanner
        onLicenseScanned={handleScanComplete}
        onError={handleError}
        onCancel={() => setShowCamera(false)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>License Scanner</Text>
        
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => setShowCamera(true)}
        >
          <Text style={styles.scanButtonText}>Start Scanning</Text>
        </TouchableOpacity>

        {licenseData && (
          <View style={styles.resultContainer}>
            <Text style={styles.resultTitle}>Last Scan Result:</Text>
            <Text>Name: {licenseData.firstName} {licenseData.lastName}</Text>
            <Text>License: {licenseData.licenseNumber}</Text>
            <TouchableOpacity style={styles.clearButton} onPress={reset}>
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error.userMessage}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
  },
  scanButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
  },
  scanButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  resultContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  clearButton: {
    backgroundColor: '#FF3B30',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 10,
  },
  clearButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    padding: 15,
    borderRadius: 10,
    borderColor: '#F44336',
    borderWidth: 1,
  },
  errorText: {
    color: '#D32F2F',
    textAlign: 'center',
  },
});
```

### Step 2: Add to Navigation

If using React Navigation:

```tsx
// App.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ScannerScreen from './screens/ScannerScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Scanner"
          component={ScannerScreen}
          options={{ title: 'License Scanner' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## Advanced Integration

### Step 1: Custom Hook for App-Specific Logic

Create a custom hook for your business logic:

```tsx
// hooks/useIdentityVerification.ts
import { useState, useCallback } from 'react';
import {
  useLicenseScanner,
  type LicenseData,
  type ScanMode,
} from 'react-native-dl-scan';

interface VerificationState {
  isVerified: boolean;
  verificationId?: string;
  verificationScore?: number;
}

export function useIdentityVerification() {
  const scanner = useLicenseScanner({
    mode: 'auto',
    enableFallback: true,
    confidenceThreshold: 0.85,
  });
  
  const [verificationState, setVerificationState] = useState<VerificationState>({
    isVerified: false,
  });
  
  const [scanHistory, setScanHistory] = useState<LicenseData[]>([]);

  const verifyIdentity = useCallback(async (licenseData: LicenseData) => {
    // Implement your verification logic here
    try {
      const response = await fetch('/api/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: licenseData.firstName,
          lastName: licenseData.lastName,
          licenseNumber: licenseData.licenseNumber,
          dateOfBirth: licenseData.dateOfBirth,
        }),
      });
      
      const result = await response.json();
      
      setVerificationState({
        isVerified: result.verified,
        verificationId: result.verificationId,
        verificationScore: result.score,
      });
      
      // Add to scan history
      setScanHistory(prev => [licenseData, ...prev.slice(0, 9)]);
      
      return result;
    } catch (error) {
      console.error('Verification failed:', error);
      throw error;
    }
  }, []);

  const resetVerification = useCallback(() => {
    setVerificationState({ isVerified: false });
    scanner.reset();
  }, [scanner]);

  return {
    ...scanner,
    verificationState,
    scanHistory,
    verifyIdentity,
    resetVerification,
  };
}
```

### Step 2: Enhanced Scanner Component

```tsx
// components/AdvancedScanner.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  CameraScanner,
  QualityIndicator,
  ModeSelector,
  type LicenseData,
  type QualityMetrics,
  type ScanMode,
} from 'react-native-dl-scan';
import { useIdentityVerification } from '../hooks/useIdentityVerification';

interface AdvancedScannerProps {
  onVerificationComplete?: (data: LicenseData, verificationId: string) => void;
  onCancel?: () => void;
  requireVerification?: boolean;
}

export default function AdvancedScanner({
  onVerificationComplete,
  onCancel,
  requireVerification = false,
}: AdvancedScannerProps) {
  const {
    scanMode,
    setScanMode,
    verificationState,
    verifyIdentity,
  } = useIdentityVerification();
  
  const [isVerifying, setIsVerifying] = useState(false);
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics | null>(null);
  const [showQualityIndicator, setShowQualityIndicator] = useState(true);

  const handleScanComplete = useCallback(async (data: LicenseData) => {
    if (requireVerification) {
      setIsVerifying(true);
      try {
        const result = await verifyIdentity(data);
        if (result.verified) {
          onVerificationComplete?.(data, result.verificationId);
        } else {
          Alert.alert(
            'Verification Failed',
            'The scanned license could not be verified. Please try again.',
            [{ text: 'OK' }]
          );
        }
      } catch (error) {
        Alert.alert(
          'Verification Error',
          'An error occurred during verification. Please try again.',
          [{ text: 'OK' }]
        );
      } finally {
        setIsVerifying(false);
      }
    } else {
      onVerificationComplete?.(data, 'no-verification');
    }
  }, [requireVerification, verifyIdentity, onVerificationComplete]);

  if (isVerifying) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Verifying identity...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraScanner
        mode={scanMode}
        onLicenseScanned={handleScanComplete}
        onError={(error) => {
          Alert.alert('Scan Error', error.message);
        }}
        onCancel={onCancel}
        onQualityMetricsUpdate={setQualityMetrics}
        showQualityIndicator={false} // We'll show our own
        qualityCheckInterval={200}
      />
      
      <View style={styles.overlayContainer}>
        <ModeSelector
          currentMode={scanMode}
          onModeChange={setScanMode}
          style={styles.modeSelector}
        />
        
        {showQualityIndicator && qualityMetrics && (
          <QualityIndicator
            metrics={qualityMetrics}
            dismissible={true}
            onDismiss={() => setShowQualityIndicator(false)}
            style={styles.qualityIndicator}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none',
  },
  modeSelector: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
  },
  qualityIndicator: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  loadingText: {
    color: 'white',
    fontSize: 16,
    marginTop: 20,
  },
});
```

### Step 3: Data Processing and Storage

```tsx
// services/LicenseDataService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type LicenseData } from 'react-native-dl-scan';

const STORAGE_KEY = '@license_data';

interface StoredLicenseData extends LicenseData {
  scanId: string;
  scannedAt: string;
  verificationStatus?: 'verified' | 'pending' | 'failed';
}

export class LicenseDataService {
  static async storeLicenseData(
    data: LicenseData,
    verificationStatus?: string
  ): Promise<string> {
    const scanId = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const storedData: StoredLicenseData = {
      ...data,
      scanId,
      scannedAt: new Date().toISOString(),
      verificationStatus: verificationStatus as any,
    };

    try {
      const existingData = await this.getAllLicenseData();
      const updatedData = [storedData, ...existingData.slice(0, 49)]; // Keep last 50
      
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedData));
      return scanId;
    } catch (error) {
      console.error('Error storing license data:', error);
      throw error;
    }
  }

  static async getAllLicenseData(): Promise<StoredLicenseData[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error retrieving license data:', error);
      return [];
    }
  }

  static async getLicenseDataById(scanId: string): Promise<StoredLicenseData | null> {
    try {
      const allData = await this.getAllLicenseData();
      return allData.find(item => item.scanId === scanId) || null;
    } catch (error) {
      console.error('Error retrieving license data by ID:', error);
      return null;
    }
  }

  static async clearAllData(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing license data:', error);
      throw error;
    }
  }

  static formatLicenseData(data: LicenseData): Record<string, any> {
    return {
      fullName: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
      age: data.dateOfBirth ? this.calculateAge(data.dateOfBirth) : null,
      fullAddress: data.address ? [
        data.address.street,
        data.address.city,
        data.address.state,
        data.address.postalCode,
      ].filter(Boolean).join(', ') : null,
      isExpired: data.expirationDate ? data.expirationDate < new Date() : null,
    };
  }

  private static calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }
}
```

## Production Considerations

### Error Handling and Recovery

```tsx
// utils/ErrorHandler.ts
import { ScanError } from 'react-native-dl-scan';
import crashlytics from '@react-native-firebase/crashlytics';

export class ScanErrorHandler {
  static handleScanError(error: unknown, context: Record<string, any> = {}) {
    if (error instanceof ScanError) {
      // Log to analytics
      crashlytics().recordError(error);
      crashlytics().setAttributes({
        errorCode: error.code,
        recoverable: error.recoverable.toString(),
        ...context,
      });

      // Return user-friendly message
      return {
        title: this.getErrorTitle(error.code),
        message: error.userMessage,
        recoverable: error.recoverable,
        actions: this.getRecoveryActions(error.code),
      };
    }

    // Handle unexpected errors
    crashlytics().recordError(new Error('Unexpected scan error'));
    return {
      title: 'Unexpected Error',
      message: 'An unexpected error occurred. Please try again.',
      recoverable: true,
      actions: ['retry', 'contact_support'],
    };
  }

  private static getErrorTitle(code: string): string {
    const titles: Record<string, string> = {
      PERMISSION_DENIED: 'Camera Permission Required',
      CAMERA_NOT_AVAILABLE: 'Camera Unavailable',
      INVALID_LICENSE_FORMAT: 'License Not Recognized',
      SCAN_TIMEOUT: 'Scan Timeout',
      PROCESSING_ERROR: 'Processing Error',
      OCR_PARSING_ERROR: 'Text Recognition Error',
      UNSUPPORTED_LICENSE: 'Unsupported License',
    };
    
    return titles[code] || 'Scan Error';
  }

  private static getRecoveryActions(code: string): string[] {
    const actions: Record<string, string[]> = {
      PERMISSION_DENIED: ['open_settings', 'cancel'],
      CAMERA_NOT_AVAILABLE: ['retry', 'contact_support'],
      INVALID_LICENSE_FORMAT: ['retry', 'try_different_mode'],
      SCAN_TIMEOUT: ['retry', 'improve_lighting'],
      PROCESSING_ERROR: ['retry', 'contact_support'],
      OCR_PARSING_ERROR: ['retry', 'try_barcode_mode'],
      UNSUPPORTED_LICENSE: ['contact_support', 'manual_entry'],
    };
    
    return actions[code] || ['retry', 'cancel'];
  }
}
```

### Performance Monitoring

```tsx
// utils/PerformanceMonitor.ts
import perf from '@react-native-firebase/perf';
import { type ScanMetrics } from 'react-native-dl-scan';

export class ScanPerformanceMonitor {
  private static trace = perf().newTrace('license_scan');

  static startScan() {
    this.trace.start();
  }

  static recordScanComplete(metrics: ScanMetrics) {
    this.trace.putAttribute('scan_mode', metrics.finalMode);
    this.trace.putAttribute('fallback_triggered', metrics.fallbackTriggered.toString());
    this.trace.putAttribute('success', metrics.success.toString());
    this.trace.putMetric('processing_time', metrics.totalProcessingTime);
    
    if (metrics.barcodeAttempts) {
      this.trace.putMetric('barcode_attempts', metrics.barcodeAttempts);
    }
    
    if (metrics.peakMemoryUsageMB) {
      this.trace.putMetric('peak_memory_mb', metrics.peakMemoryUsageMB);
    }
    
    this.trace.stop();
  }

  static recordError(error: Error) {
    this.trace.putAttribute('error', error.message);
    this.trace.stop();
  }
}
```

### Configuration Management

```tsx
// config/ScannerConfig.ts
interface AppScannerConfig {
  production: {
    barcodeTimeout: number;
    ocrTimeout: number;
    enableAnalytics: boolean;
    confidenceThreshold: number;
  };
  development: {
    barcodeTimeout: number;
    ocrTimeout: number;
    enableAnalytics: boolean;
    confidenceThreshold: number;
  };
}

const config: AppScannerConfig = {
  production: {
    barcodeTimeout: 10000,
    ocrTimeout: 15000,
    enableAnalytics: true,
    confidenceThreshold: 0.85,
  },
  development: {
    barcodeTimeout: 5000,
    ocrTimeout: 8000,
    enableAnalytics: false,
    confidenceThreshold: 0.7,
  },
};

export const getScannerConfig = () => {
  return __DEV__ ? config.development : config.production;
};
```

## Platform-Specific Setup

### iOS Specific

#### Privacy Manifest

Add to `ios/YourApp/PrivacyInfo.xcprivacy`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryCamera</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>3B52.1</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
```

#### App Store Review

Prepare for App Store review by documenting:
- Why camera access is needed
- How license data is processed and stored
- Privacy measures in place
- Compliance with relevant regulations

### Android Specific

#### ProGuard Configuration

Add to `android/app/proguard-rules.pro`:

```
# React Native DL Scan
-keep class com.reactnativedlscan.** { *; }
-keepclassmembers class com.reactnativedlscan.** { *; }

# ML Kit
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# ZXing
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**
```

#### Permissions

For targeted SDK 31+, add to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="true" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

## Testing

### Unit Testing

```tsx
// __tests__/hooks/useIdentityVerification.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { useIdentityVerification } from '../../hooks/useIdentityVerification';

jest.mock('react-native-dl-scan', () => ({
  useLicenseScanner: () => ({
    licenseData: null,
    isScanning: false,
    error: null,
    scan: jest.fn(),
    reset: jest.fn(),
  }),
}));

describe('useIdentityVerification', () => {
  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useIdentityVerification());
    
    expect(result.current.verificationState.isVerified).toBe(false);
    expect(result.current.scanHistory).toEqual([]);
  });

  it('should handle verification process', async () => {
    const { result } = renderHook(() => useIdentityVerification());
    
    const mockLicenseData = {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: '123456789',
    };

    // Mock successful verification
    global.fetch = jest.fn().mockResolvedValueOnce({
      json: () => Promise.resolve({
        verified: true,
        verificationId: 'verify-123',
        score: 0.95,
      }),
    });

    await act(async () => {
      await result.current.verifyIdentity(mockLicenseData);
    });

    expect(result.current.verificationState.isVerified).toBe(true);
    expect(result.current.verificationState.verificationId).toBe('verify-123');
  });
});
```

### Integration Testing

```tsx
// __tests__/components/AdvancedScanner.test.tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AdvancedScanner from '../../components/AdvancedScanner';

jest.mock('react-native-dl-scan', () => ({
  CameraScanner: ({ onLicenseScanned }: any) => {
    const MockedCameraScanner = require('react-native').View;
    return (
      <MockedCameraScanner
        testID="camera-scanner"
        onPress={() => onLicenseScanned({
          firstName: 'Test',
          lastName: 'User',
          licenseNumber: '123456789',
        })}
      />
    );
  },
  QualityIndicator: () => null,
  ModeSelector: () => null,
}));

describe('AdvancedScanner', () => {
  it('should call onVerificationComplete when scan succeeds', async () => {
    const mockOnComplete = jest.fn();
    
    const { getByTestId } = render(
      <AdvancedScanner
        onVerificationComplete={mockOnComplete}
        requireVerification={false}
      />
    );

    fireEvent.press(getByTestId('camera-scanner'));

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Test',
          lastName: 'User',
          licenseNumber: '123456789',
        }),
        'no-verification'
      );
    });
  });
});
```

### E2E Testing

```typescript
// e2e/scanner.e2e.ts
import { device, expect, element, by } from 'detox';

describe('License Scanner E2E', () => {
  beforeAll(async () => {
    await device.launchApp({ permissions: { camera: 'YES' } });
  });

  it('should complete scanning flow', async () => {
    // Navigate to scanner
    await element(by.id('start-scan-button')).tap();
    
    // Wait for camera to initialize
    await waitFor(element(by.id('camera-scanner')))
      .toBeVisible()
      .withTimeout(5000);
    
    // Simulate successful scan (in real tests, you'd mock the camera input)
    await element(by.id('mock-scan-success')).tap();
    
    // Verify results screen
    await expect(element(by.id('scan-results'))).toBeVisible();
    await expect(element(by.text('Scan Successful'))).toBeVisible();
  });
});
```

## Troubleshooting

### Common Issues

1. **Camera Permission Issues**
   - Ensure permissions are properly declared
   - Handle permission request gracefully
   - Provide clear messaging to users

2. **Build Errors**
   - Ensure all peer dependencies are installed
   - Run `pod install` after installation
   - Clear cache if needed: `npx react-native start --reset-cache`

3. **Performance Issues**
   - Monitor scan metrics in production
   - Implement quality-based scanning decisions
   - Consider device-specific optimizations

4. **Platform Differences**
   - Test on both iOS and Android
   - Account for different camera behaviors
   - Handle platform-specific errors

### Debug Mode

Enable debug logging:

```tsx
import { logger } from 'react-native-dl-scan/utils/logger';

// Enable debug logs in development
if (__DEV__) {
  logger.setLevel('debug');
}
```

### Support

For additional support:
- Check the [API documentation](./API.md)
- Review the [example app](../example/)
- Search existing issues on GitHub
- Create a new issue with reproduction steps

## Next Steps

After successful integration:

1. **Optimize for your use case** - Configure scan modes and timeouts
2. **Implement analytics** - Monitor performance and success rates
3. **Add comprehensive error handling** - Provide great user experience
4. **Test thoroughly** - Ensure reliability across devices
5. **Plan for scale** - Consider server-side verification if needed

For more advanced features and customization options, see the [API Reference](./API.md).