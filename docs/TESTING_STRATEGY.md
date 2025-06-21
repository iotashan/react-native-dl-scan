# Comprehensive Testing Strategy for React Native License Scanner

## Overview

This document outlines a complete testing strategy for the React Native driver's license scanning module, covering unit tests, integration tests, performance tests, and end-to-end testing scenarios.

## Testing Architecture

### Test Pyramid Structure

```
         /\
        /E2E\        <- End-to-End Tests (10%)
       /------\
      /  Integ  \    <- Integration Tests (30%)
     /----------\
    /    Unit     \  <- Unit Tests (60%)
   /--------------\
```

## 1. Unit Testing

### Swift/iOS Native Testing

#### Test Setup

```swift
// LicenseScannerTests/TestHelpers.swift
import XCTest
import Vision
@testable import LicenseScanner

class TestHelpers {
    
    // Generate mock CVPixelBuffer for testing
    static func createMockPixelBuffer(width: Int = 1920, height: Int = 1080) -> CVPixelBuffer? {
        var pixelBuffer: CVPixelBuffer?
        let attrs = [
            kCVPixelBufferCGImageCompatibilityKey: kCFBooleanTrue,
            kCVPixelBufferCGBitmapContextCompatibilityKey: kCFBooleanTrue
        ] as CFDictionary
        
        CVPixelBufferCreate(
            kCFAllocatorDefault,
            width, height,
            kCVPixelFormatType_32BGRA,
            attrs,
            &pixelBuffer
        )
        
        return pixelBuffer
    }
    
    // Load test image as CVPixelBuffer
    static func loadTestImage(named name: String) -> CVPixelBuffer? {
        guard let image = UIImage(named: name),
              let cgImage = image.cgImage else { return nil }
        
        let width = cgImage.width
        let height = cgImage.height
        
        guard let pixelBuffer = createMockPixelBuffer(width: width, height: height) else {
            return nil
        }
        
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(pixelBuffer),
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        ) else { return nil }
        
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        
        return pixelBuffer
    }
}

// Mock data generator for different license types
struct MockLicenseDataGenerator {
    
    static func generateAAMVABarcode(state: String = "CA", expired: Bool = false) -> String {
        let header = "@\n\x1e\rANSI "
        let iin = "636014" // California
        let version = "08"
        let jurisdiction = "00"
        
        let expirationDate = expired ? "01152020" : "01152026"
        
        return """
        \(header)\(iin)\(version)\(jurisdiction)
        DAQD12345678
        DCSPUBLIC
        DACJOHN
        DADQUINCY
        DBD08242018
        DBB01151990
        DBA\(expirationDate)
        DBC1
        DAU072 IN
        DAYGRN
        DAG789 MAIN STREET
        DAILOS ANGELES
        DAJCA
        DAK900010000
        DCF0123456789
        DCGUSA
        DAW200
        DAZBRO
        DDK1
        """
    }
    
    static func generateInvalidAAMVABarcode() -> String {
        return "INVALID_BARCODE_DATA_12345"
    }
    
    static func generatePartialAAMVABarcode() -> String {
        return """
        @
        
        ANSI 636014080000
        DAQD12345678
        DCSPUBLIC
        """
    }
}
```

#### Vision Framework Tests

```swift
// VisionProcessorTests.swift
class VisionProcessorTests: XCTestCase {
    
    var visionProcessor: VisionProcessor!
    
    override func setUp() {
        super.setUp()
        visionProcessor = VisionProcessor()
    }
    
    func testTextRecognitionConfiguration() {
        let request = visionProcessor.createTextRecognitionRequest()
        
        XCTAssertEqual(request.recognitionLevel, .accurate)
        XCTAssertTrue(request.usesLanguageCorrection)
        XCTAssertEqual(request.recognitionLanguages, ["en-US"])
    }
    
    func testDocumentDetection() throws {
        let expectation = XCTestExpectation(description: "Document detection")
        
        guard let pixelBuffer = TestHelpers.loadTestImage(named: "test_license") else {
            XCTFail("Failed to load test image")
            return
        }
        
        visionProcessor.detectDocument(in: pixelBuffer) { result in
            switch result {
            case .success(let bounds):
                XCTAssertNotNil(bounds)
                XCTAssertTrue(bounds.width > 0)
                XCTAssertTrue(bounds.height > 0)
            case .failure(let error):
                XCTFail("Document detection failed: \(error)")
            }
            expectation.fulfill()
        }
        
        wait(for: [expectation], timeout: 5.0)
    }
    
    func testOCRAccuracy() throws {
        let expectation = XCTestExpectation(description: "OCR processing")
        let testText = "DRIVER LICENSE"
        
        guard let pixelBuffer = TestHelpers.loadTestImage(named: "test_text") else {
            XCTFail("Failed to load test image")
            return
        }
        
        visionProcessor.performOCR(on: pixelBuffer) { result in
            switch result {
            case .success(let extractedText):
                XCTAssertTrue(extractedText.contains(testText))
            case .failure(let error):
                XCTFail("OCR failed: \(error)")
            }
            expectation.fulfill()
        }
        
        wait(for: [expectation], timeout: 5.0)
    }
    
    func testMemoryLeaks() {
        // Test for memory leaks during repeated processing
        let expectation = XCTestExpectation(description: "Memory leak test")
        expectation.expectedFulfillmentCount = 100
        
        guard let pixelBuffer = TestHelpers.createMockPixelBuffer() else {
            XCTFail("Failed to create mock buffer")
            return
        }
        
        for _ in 0..<100 {
            visionProcessor.detectDocument(in: pixelBuffer) { _ in
                expectation.fulfill()
            }
        }
        
        wait(for: [expectation], timeout: 10.0)
        
        // Verify no strong reference cycles
        weak var weakProcessor = visionProcessor
        visionProcessor = nil
        XCTAssertNil(weakProcessor)
    }
}
```

#### DLParser-Swift Integration Tests

```swift
// DLParserIntegrationTests.swift
import XCTest
import DLParser
@testable import LicenseScanner

class DLParserIntegrationTests: XCTestCase {
    
    func testDLParserBasicParsing() throws {
        let mockData = MockLicenseDataGenerator.generateAAMVABarcode()
        let result = try DLParser.parse(mockData)
        
        XCTAssertEqual(result.firstName, "JOHN")
        XCTAssertEqual(result.lastName, "PUBLIC")
        XCTAssertEqual(result.middleName, "QUINCY")
        XCTAssertEqual(result.licenseNumber, "D12345678")
        XCTAssertNotNil(result.dateOfBirth)
        XCTAssertNotNil(result.expirationDate)
        XCTAssertTrue(result.isOrganDonor)
    }
    
    func testDLParserErrorHandling() {
        let invalidData = MockLicenseDataGenerator.generateInvalidAAMVABarcode()
        
        XCTAssertThrowsError(try DLParser.parse(invalidData)) { error in
            if let dlError = error as? DLParser.ParseError {
                switch dlError {
                case .invalidFormat:
                    // Expected error type
                    break
                default:
                    XCTFail("Unexpected error type")
                }
            } else {
                XCTFail("Expected DLParser.ParseError")
            }
        }
    }
    
    func testMultiStateSupport() throws {
        // Test various state formats
        let states = ["CA", "TX", "NY", "FL"]
        
        for state in states {
            let data = MockLicenseDataGenerator.generateAAMVABarcode(state: state)
            let result = try DLParser.parse(data)
            
            XCTAssertNotNil(result.firstName)
            XCTAssertNotNil(result.lastName)
            XCTAssertNotNil(result.licenseNumber)
            XCTAssertEqual(result.state, state)
        }
    }
    
    func testLibraryDataStructure() throws {
        let data = MockLicenseDataGenerator.generateAAMVABarcode()
        let result = try DLParser.parse(data)
        
        // Verify DLParser-Swift data structure
        XCTAssertNotNil(result.allFields)
        XCTAssertFalse(result.allFields.isEmpty)
        
        // Test that all expected fields are accessible
        XCTAssertTrue(result.allFields.keys.contains { $0.hasPrefix("DA") })
    }
}
```

### React Native/TypeScript Testing

#### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-vision-camera)/)',
  ],
  testMatch: [
    '**/__tests__/**/*.test.ts?(x)',
    '**/?(*.)+(spec|test).ts?(x)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

#### Mock Setup

```typescript
// __mocks__/react-native-vision-camera.ts
export const Camera = {
  getAvailableCameraDevices: jest.fn().mockResolvedValue([
    { id: 'back', position: 'back' },
  ]),
  getCameraPermissionStatus: jest.fn().mockResolvedValue('authorized'),
  requestCameraPermission: jest.fn().mockResolvedValue('authorized'),
};

export const useCameraDevice = jest.fn().mockReturnValue({
  id: 'back',
  position: 'back',
});

export const useFrameProcessor = jest.fn();

export const runAtTargetFps = jest.fn((fps, fn) => fn());
export const runOnJS = jest.fn((fn) => fn);

// __mocks__/NativeModules.ts
export const DLParserBridge = {
  parse: jest.fn(),
};

export const LicenseScanner = {
  scanLicense: jest.fn(),
};
```

#### Hook Tests

```typescript
// __tests__/hooks/useLicenseScanner.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { useLicenseScanner } from '../../src/hooks/useLicenseScanner';
import { DLParserBridge } from '../../__mocks__/NativeModules';

describe('useLicenseScanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with null license data', () => {
    const { result } = renderHook(() => useLicenseScanner());
    
    expect(result.current.licenseData).toBeNull();
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle successful scan', async () => {
    const mockLicenseData = {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: 'D12345678',
      dateOfBirth: '1990-01-15',
      expirationDate: '2026-01-15',
      isValid: true,
    };

    DLParserBridge.parse.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scan('mock-barcode-data');
    });

    expect(result.current.licenseData).toEqual(mockLicenseData);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle parsing errors', async () => {
    const mockError = new Error('Invalid AAMVA format');
    DLParserBridge.parse.mockRejectedValueOnce(mockError);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scan('invalid-data');
    });

    expect(result.current.licenseData).toBeNull();
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.error).toBe('Invalid AAMVA format');
  });

  it('should validate license data', () => {
    const { result } = renderHook(() => useLicenseScanner());

    const validData = {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: 'D12345678',
      dateOfBirth: new Date('1990-01-15'),
      expirationDate: new Date('2026-01-15'),
    };

    const errors = result.current.validate(validData);
    expect(errors).toHaveLength(0);
  });

  it('should detect expired licenses', () => {
    const { result } = renderHook(() => useLicenseScanner());

    const expiredData = {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: 'D12345678',
      dateOfBirth: new Date('1990-01-15'),
      expirationDate: new Date('2020-01-15'),
    };

    const errors = result.current.validate(expiredData);
    expect(errors).toContain('License has expired');
  });
});
```

#### Component Tests

```typescript
// __tests__/components/LicenseScanner.test.tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LicenseScanner } from '../../src/components/LicenseScanner';
import { Camera } from 'react-native-vision-camera';

jest.mock('react-native-vision-camera');

describe('LicenseScanner Component', () => {
  const mockOnScanComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (Camera.getCameraPermissionStatus as jest.Mock).mockResolvedValue('authorized');
  });

  it('should render camera when permissions granted', async () => {
    const { getByTestId } = render(
      <LicenseScanner onScanComplete={mockOnScanComplete} />
    );

    await waitFor(() => {
      expect(getByTestId('camera-view')).toBeTruthy();
    });
  });

  it('should show permission request when not authorized', async () => {
    (Camera.getCameraPermissionStatus as jest.Mock).mockResolvedValue('not-determined');

    const { getByText } = render(
      <LicenseScanner onScanComplete={mockOnScanComplete} />
    );

    await waitFor(() => {
      expect(getByText('Camera permission required')).toBeTruthy();
    });
  });

  it('should handle scan completion', async () => {
    const mockLicenseData = {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: 'D12345678',
    };

    const { getByTestId } = render(
      <LicenseScanner onScanComplete={mockOnScanComplete} />
    );

    // Simulate successful scan
    await act(async () => {
      const frameProcessor = useFrameProcessor.mock.calls[0][0];
      frameProcessor({ mock: 'frame' });
    });

    await waitFor(() => {
      expect(mockOnScanComplete).toHaveBeenCalledWith(mockLicenseData);
    });
  });
});
```

## 2. Integration Testing

### Native Bridge Integration Tests

```swift
// BridgeIntegrationTests.swift
class BridgeIntegrationTests: XCTestCase {
    
    func testFrameProcessorWithDLParser() {
        let expectation = XCTestExpectation(description: "Frame processor with DLParser integration")
        
        let plugin = LicenseFrameProcessor()
        let mockFrame = createMockFrameWithBarcode()
        
        let result = plugin.callback(mockFrame, nil)
        
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            // Should contain DLParser-Swift parsed data
            XCTAssertNotNil(dict["firstName"])
            XCTAssertNotNil(dict["lastName"])
            XCTAssertNotNil(dict["licenseNumber"])
        }
        
        expectation.fulfill()
        wait(for: [expectation], timeout: 5.0)
    }
    
    func testConcurrentProcessing() {
        let expectation = XCTestExpectation(description: "Concurrent processing")
        expectation.expectedFulfillmentCount = 10
        
        let plugin = LicenseFrameProcessor()
        let queue = DispatchQueue(label: "test.concurrent", attributes: .concurrent)
        
        for i in 0..<10 {
            queue.async {
                let frame = self.createMockFrameWithBarcode()
                let result = plugin.callback(frame, ["frameId": i])
                XCTAssertNotNil(result)
                expectation.fulfill()
            }
        }
        
        wait(for: [expectation], timeout: 10.0)
    }
}
```

### React Native Integration Tests

```typescript
// __tests__/integration/ScanningFlow.test.tsx
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { ScanningFlow } from '../../src/screens/ScanningFlow';

describe('Scanning Flow Integration', () => {
  it('should complete full scanning flow', async () => {
    const { getByTestId, getByText } = render(
      <NavigationContainer>
        <ScanningFlow />
      </NavigationContainer>
    );

    // Start scanning
    const startButton = getByTestId('start-scanning');
    fireEvent.press(startButton);

    // Wait for camera
    await waitFor(() => {
      expect(getByTestId('camera-view')).toBeTruthy();
    });

    // Simulate successful scan
    const mockLicenseData = {
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: 'D12345678',
      dateOfBirth: new Date('1990-01-15'),
      expirationDate: new Date('2026-01-15'),
    };

    // Trigger scan completion
    await act(async () => {
      const onScanComplete = Camera.mock.calls[0][0].onScanComplete;
      onScanComplete(mockLicenseData);
    });

    // Verify results screen
    await waitFor(() => {
      expect(getByText('John Doe')).toBeTruthy();
      expect(getByText('D12345678')).toBeTruthy();
    });
  });
});
```

## 3. Performance Testing

### Frame Rate Performance Tests

```swift
// PerformanceTests.swift
class PerformanceTests: XCTestCase {
    
    func testFrameProcessingPerformance() {
        let processor = LicenseFrameProcessor()
        
        measure {
            let pixelBuffer = TestHelpers.createMockPixelBuffer()!
            let expectation = XCTestExpectation(description: "Performance")
            
            processor.processFrame(pixelBuffer) { _ in
                expectation.fulfill()
            }
            
            wait(for: [expectation], timeout: 1.0)
        }
    }
    
    func testBatchProcessingPerformance() {
        let processor = LicenseFrameProcessor()
        let buffers = (0..<30).map { _ in TestHelpers.createMockPixelBuffer()! }
        
        measure {
            let group = DispatchGroup()
            
            for buffer in buffers {
                group.enter()
                processor.processFrame(buffer) { _ in
                    group.leave()
                }
            }
            
            group.wait()
        }
    }
}
```

### Memory Performance Tests

```typescript
// __tests__/performance/memory.test.ts
describe('Memory Performance', () => {
  it('should not leak memory during continuous scanning', async () => {
    const iterations = 100;
    const memorySnapshots: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Simulate frame processing
      const frame = createMockFrame();
      await processFrame(frame);

      // Measure memory usage
      if (global.gc) {
        global.gc();
      }
      
      const usage = process.memoryUsage();
      memorySnapshots.push(usage.heapUsed);
    }

    // Check for memory growth
    const firstQuarter = memorySnapshots.slice(0, 25);
    const lastQuarter = memorySnapshots.slice(75);
    
    const avgFirst = average(firstQuarter);
    const avgLast = average(lastQuarter);
    
    // Memory growth should be less than 10%
    const growth = (avgLast - avgFirst) / avgFirst;
    expect(growth).toBeLessThan(0.1);
  });
});
```

## 4. End-to-End Testing

### Detox Configuration

```javascript
// .detoxrc.js
module.exports = {
  testRunner: 'jest',
  runnerConfig: 'e2e/config.json',
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/LicenseScanner.app',
      build: 'xcodebuild -workspace ios/LicenseScanner.xcworkspace -scheme LicenseScanner -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPad Air (5th generation)',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
  },
};
```

### E2E Test Scenarios

```typescript
// e2e/scanningFlow.e2e.ts
describe('License Scanning E2E', () => {
  beforeAll(async () => {
    await device.launchApp({
      permissions: { camera: 'YES' },
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should complete successful scan', async () => {
    // Navigate to scanner
    await element(by.id('scan-license-button')).tap();
    
    // Verify camera is active
    await expect(element(by.id('camera-view'))).toBeVisible();
    
    // Position test license (in simulator, use photo library)
    await element(by.id('use-photo-library')).tap();
    await element(by.id('test-license-1')).tap();
    
    // Wait for processing
    await waitFor(element(by.id('scan-result')))
      .toBeVisible()
      .withTimeout(5000);
    
    // Verify extracted data
    await expect(element(by.text('John Doe'))).toBeVisible();
    await expect(element(by.text('D12345678'))).toBeVisible();
    await expect(element(by.text('01/15/1990'))).toBeVisible();
  });

  it('should handle expired license', async () => {
    await element(by.id('scan-license-button')).tap();
    await element(by.id('use-photo-library')).tap();
    await element(by.id('test-license-expired')).tap();
    
    await waitFor(element(by.id('error-message')))
      .toBeVisible()
      .withTimeout(5000);
    
    await expect(element(by.text('License has expired'))).toBeVisible();
  });

  it('should handle poor quality scan', async () => {
    await element(by.id('scan-license-button')).tap();
    await element(by.id('use-photo-library')).tap();
    await element(by.id('test-license-blurry')).tap();
    
    await waitFor(element(by.id('scan-guidance')))
      .toBeVisible()
      .withTimeout(3000);
    
    await expect(element(by.text('Please hold steady'))).toBeVisible();
  });
});
```

## 5. Test Data Management

### Mock License Generator

```typescript
// testUtils/mockLicenseGenerator.ts
export class MockLicenseGenerator {
  static generateValidLicense(state: string = 'CA'): AAMVALicenseData {
    const states = {
      CA: { iin: '636014', code: 'CA' },
      TX: { iin: '636015', code: 'TX' },
      NY: { iin: '636001', code: 'NY' },
      FL: { iin: '636010', code: 'FL' },
    };

    const stateInfo = states[state] || states.CA;
    
    return {
      // Personal Information
      firstName: faker.name.firstName(),
      lastName: faker.name.lastName(),
      middleName: faker.name.firstName(),
      dateOfBirth: faker.date.birthdate({ min: 21, max: 65 }),
      
      // License Information
      licenseNumber: `${state[0]}${faker.random.numeric(8)}`,
      documentDiscriminator: faker.random.alphaNumeric(10),
      issueDate: faker.date.recent({ years: 5 }),
      expirationDate: faker.date.future({ years: 5 }),
      
      // Physical Description
      sex: faker.helpers.arrayElement(['male', 'female']),
      eyeColor: faker.helpers.arrayElement(['BRO', 'BLU', 'GRN', 'HAZ']),
      hairColor: faker.helpers.arrayElement(['BRO', 'BLK', 'BLN', 'RED']),
      height: { value: faker.number.int({ min: 60, max: 78 }), unit: 'inches' },
      weight: { value: faker.number.int({ min: 100, max: 250 }), unit: 'pounds' },
      
      // Address
      street1: faker.location.streetAddress(),
      city: faker.location.city(),
      state: stateInfo.code,
      postalCode: faker.location.zipCode(),
      country: 'USA',
      
      // Metadata
      issuerIdentificationNumber: stateInfo.iin,
      aamvaVersionNumber: '08',
      jurisdictionVersionNumber: '00',
      
      // Flags
      isOrganDonor: faker.datatype.boolean(),
      isVeteran: faker.datatype.boolean(),
      isRealID: faker.datatype.boolean(),
      isValid: true,
    };
  }

  static generateBarcodeImage(data: AAMVALicenseData): string {
    // Generate PDF417 barcode image for testing
    const barcodeData = this.encodeAAMVA(data);
    // Return base64 encoded image
    return generatePDF417(barcodeData);
  }

  private static encodeAAMVA(data: AAMVALicenseData): string {
    // Encode data in AAMVA format
    const lines = [
      '@',
      '\x1e\rANSI ',
      `${data.issuerIdentificationNumber}${data.aamvaVersionNumber}${data.jurisdictionVersionNumber}`,
      `DAQ${data.licenseNumber}`,
      `DCS${data.lastName}`,
      `DAC${data.firstName}`,
      `DAD${data.middleName || ''}`,
      `DBB${formatDate(data.dateOfBirth)}`,
      `DBA${formatDate(data.expirationDate)}`,
      `DBD${formatDate(data.issueDate)}`,
      // Add more fields as needed
    ];
    
    return lines.join('\n');
  }
}
```

## 6. Continuous Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'yarn'
      
      - name: Install dependencies
        run: yarn install --frozen-lockfile
      
      - name: Run TypeScript tests
        run: yarn test:unit --coverage
      
      - name: Run iOS tests
        run: |
          cd ios
          xcodebuild test \
            -workspace LicenseScanner.xcworkspace \
            -scheme LicenseScanner \
            -destination 'platform=iOS Simulator,name=iPad Air (5th generation)' \
            -resultBundlePath TestResults
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info,./ios/TestResults/coverage.xml

  integration-tests:
    runs-on: macos-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup environment
        run: |
          brew install watchman
          yarn install --frozen-lockfile
          cd ios && pod install
      
      - name: Build app
        run: yarn ios:build:test
      
      - name: Run integration tests
        run: yarn test:integration

  e2e-tests:
    runs-on: macos-latest
    needs: integration-tests
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Detox
        run: |
          brew tap wix/brew
          brew install applesimutils
          yarn global add detox-cli
          yarn install --frozen-lockfile
      
      - name: Build for Detox
        run: yarn detox:build:ios
      
      - name: Run E2E tests
        run: yarn detox:test:ios
      
      - name: Upload artifacts
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: detox-artifacts
          path: artifacts/
```

## 7. Test Reporting

### Coverage Reports

```typescript
// jest.coverage.config.js
module.exports = {
  collectCoverage: true,
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/',
    '/__mocks__/',
    '/testUtils/',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/core/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
```

### Test Results Dashboard

```typescript
// testReporter.ts
export class TestReporter {
  static async generateReport(results: TestResults): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: results.total,
        passed: results.passed,
        failed: results.failed,
        skipped: results.skipped,
        duration: results.duration,
      },
      coverage: {
        lines: results.coverage.lines,
        branches: results.coverage.branches,
        functions: results.coverage.functions,
        statements: results.coverage.statements,
      },
      failures: results.failures.map(f => ({
        test: f.testName,
        error: f.error.message,
        stack: f.error.stack,
      })),
    };

    // Save report
    await fs.writeFile(
      'test-results/report.json',
      JSON.stringify(report, null, 2)
    );

    // Generate HTML report
    await this.generateHTMLReport(report);
  }
}
```

## Testing Best Practices

1. **Test Isolation**: Each test should be independent and not rely on others
2. **Mock External Dependencies**: Mock native modules, network calls, and file system
3. **Use Test IDs**: Add testID props for reliable E2E test selectors
4. **Parallel Execution**: Run tests in parallel when possible
5. **Continuous Monitoring**: Track test execution time and flaky tests
6. **Regular Maintenance**: Update tests when implementation changes

## Conclusion

This comprehensive testing strategy ensures high-quality, reliable license scanning functionality. The multi-layered approach catches issues at different levels, from unit-level logic errors to integration problems and user-facing bugs.