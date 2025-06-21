# T03_S01 - Create React Native Bridge

**Sprint:** S01 - Foundation & DLParser-Swift Integration  
**Milestone:** M01 - Core PDF417 Barcode Scanning  
**Status:** 📋 PLANNED  
**Priority:** HIGH  
**Estimated Effort:** 4 hours  

## Task Overview

Create a robust React Native bridge that connects the native iOS scanning functionality with the JavaScript layer. This includes TurboModule implementation, proper error handling, and TypeScript definitions.

## Acceptance Criteria

- ✅ TurboModule interface properly defined
- ✅ Native methods callable from JavaScript
- ✅ Error handling between native and JS layers
- ✅ TypeScript definitions accurate and complete
- ✅ React hook implementation for scanning
- ✅ Example app integration working

## Implementation Details

### TurboModule Interface

Update `src/NativeDlScan.ts`:

```typescript
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  scanLicense(barcodeData: string): Promise<LicenseResult>;
  
  // Future methods for camera integration
  startScanning(): Promise<void>;
  stopScanning(): Promise<void>;
}

export interface LicenseResult {
  success: boolean;
  data?: LicenseData;
  error?: ScanError;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DlScan');
```

### Native Implementation

Update `ios/DlScan.mm`:

```objc
#import "DlScan.h"
#import "DlScan-Swift.h"

@implementation DlScan

RCT_EXPORT_MODULE()

RCT_EXPORT_METHOD(scanLicense:(NSString *)barcodeData
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    @try {
        NSDictionary *result = [LicenseParser parse:barcodeData];
        
        if (result[@"error"]) {
            NSDictionary *error = result[@"error"];
            reject(error[@"code"], error[@"message"], nil);
        } else {
            NSDictionary *response = @{
                @"success": @YES,
                @"data": result
            };
            resolve(response);
        }
    } @catch (NSException *exception) {
        reject(@"UNKNOWN_ERROR", exception.reason, nil);
    }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeDlScanSpecJSI>(params);
}

@end
```

### JavaScript Layer

Update `src/index.tsx`:

```typescript
import DlScanModule from './NativeDlScan';
import type { LicenseData, ScanError, LicenseResult } from './types/license';

export * from './types/license';

/**
 * Scan a PDF417 barcode string and extract license data
 */
export async function scanLicense(barcodeData: string): Promise<LicenseData> {
  try {
    const result: LicenseResult = await DlScanModule.scanLicense(barcodeData);
    
    if (result.success && result.data) {
      return result.data;
    } else if (result.error) {
      throw new ScanError(result.error);
    } else {
      throw new Error('Unknown scanning error');
    }
  } catch (error) {
    if (error instanceof ScanError) {
      throw error;
    }
    
    // Handle native errors
    throw new ScanError({
      code: 'UNKNOWN_ERROR',
      message: error.message || 'Unknown error occurred',
      userMessage: 'An unexpected error occurred. Please try again.',
      recoverable: true
    });
  }
}

/**
 * Custom error class for scanning errors
 */
export class ScanError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly recoverable: boolean;

  constructor(error: ScanError) {
    super(error.message);
    this.name = 'ScanError';
    this.code = error.code;
    this.userMessage = error.userMessage;
    this.recoverable = error.recoverable;
  }
}
```

### React Hook Implementation

Create `src/hooks/useLicenseScanner.ts`:

```typescript
import { useState, useCallback } from 'react';
import { scanLicense, ScanError } from '../index';
import type { LicenseData } from '../types/license';

export interface LicenseScannerState {
  licenseData: LicenseData | null;
  isScanning: boolean;
  error: ScanError | null;
}

export interface LicenseScannerActions {
  scan: (barcodeData: string) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

export function useLicenseScanner(): LicenseScannerState & LicenseScannerActions {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);

  const scan = useCallback(async (barcodeData: string) => {
    setIsScanning(true);
    setError(null);
    
    try {
      const data = await scanLicense(barcodeData);
      setLicenseData(data);
    } catch (err) {
      if (err instanceof ScanError) {
        setError(err);
      } else {
        setError(new ScanError({
          code: 'UNKNOWN_ERROR',
          message: 'Unknown error occurred',
          userMessage: 'Something went wrong. Please try again.',
          recoverable: true
        }));
      }
    } finally {
      setIsScanning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLicenseData(null);
    setError(null);
    setIsScanning(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    licenseData,
    isScanning,
    error,
    scan,
    reset,
    clearError,
  };
}
```

### TypeScript Definitions

Update `src/types/license.ts`:

```typescript
export interface LicenseData {
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

export interface ScanError {
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
}

export interface LicenseResult {
  success: boolean;
  data?: LicenseData;
  error?: ScanError;
}
```

## Testing Requirements

### Unit Tests

Create `__tests__/bridge.test.ts`:

```typescript
import { scanLicense, ScanError } from '../src/index';
import { NativeModules } from 'react-native';

// Mock the native module
jest.mock('../src/NativeDlScan', () => ({
  scanLicense: jest.fn(),
}));

describe('React Native Bridge', () => {
  test('should handle successful scan', async () => {
    const mockData = {
      success: true,
      data: {
        firstName: 'John',
        lastName: 'Doe',
        licenseNumber: 'D12345678'
      }
    };
    
    (NativeModules.DlScan.scanLicense as jest.Mock).mockResolvedValue(mockData);
    
    const result = await scanLicense('mock-barcode-data');
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Doe');
  });

  test('should handle parsing errors', async () => {
    const mockError = {
      success: false,
      error: {
        code: 'PARSING_FAILED',
        message: 'Invalid format',
        userMessage: 'This doesn\'t appear to be a valid license.',
        recoverable: true
      }
    };
    
    (NativeModules.DlScan.scanLicense as jest.Mock).mockResolvedValue(mockError);
    
    await expect(scanLicense('invalid-data')).rejects.toThrow(ScanError);
  });
});
```

### Integration Tests

- Test complete data flow from native to JavaScript
- Validate error handling across bridge
- Confirm TypeScript types match runtime data

## Example App Integration

Update `example/src/App.tsx`:

```typescript
import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useLicenseScanner } from 'react-native-dl-scan';

export default function App() {
  const { licenseData, isScanning, error, scan, reset } = useLicenseScanner();

  const handleScan = () => {
    // Test with sample AAMVA data
    const sampleBarcode = "SAMPLE_AAMVA_DATA_HERE";
    scan(sampleBarcode);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DL Scan Test</Text>
      
      <Button 
        title={isScanning ? "Scanning..." : "Test Scan"} 
        onPress={handleScan}
        disabled={isScanning}
      />
      
      {licenseData && (
        <View style={styles.result}>
          <Text>Name: {licenseData.firstName} {licenseData.lastName}</Text>
          <Text>License: {licenseData.licenseNumber}</Text>
        </View>
      )}
      
      {error && (
        <Text style={styles.error}>{error.userMessage}</Text>
      )}
      
      <Button title="Reset" onPress={reset} />
    </View>
  );
}
```

## Dependencies

- **T01_S01_Replace_Template_Code** must be completed
- **T02_S01_Integrate_DLParser_Swift** must be completed

## Blockers

- TurboModule configuration issues
- Native bridge compilation errors
- TypeScript definition mismatches

## Definition of Done

- Native methods callable from JavaScript
- Error handling working correctly
- TypeScript definitions accurate
- Example app demonstrates functionality
- Unit tests passing