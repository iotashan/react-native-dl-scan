# Testing Patterns and Best Practices

## Overview

This document outlines the testing patterns and best practices for the React Native DL Scan module. We follow a consistent approach across JavaScript/TypeScript and Swift codebases.

## Test Naming Conventions

### JavaScript/TypeScript Tests

```typescript
// Format: describe block > test case
describe('ComponentOrModule', () => {
  describe('methodName', () => {
    it('should [expected behavior] when [condition]', () => {
      // test implementation
    });
    
    it('should throw error when [error condition]', () => {
      // error test
    });
  });
});
```

### Swift Tests

```swift
// Format: test[MethodName][Scenario][ExpectedOutcome]
func testValidPDF417ParsingReturnsCorrectData() { }
func testInvalidDataThrowsParsingError() { }
func testBlurryImageReturnsLowConfidenceScore() { }
```

## Test Structure Pattern (AAA)

All tests follow the Arrange-Act-Assert pattern:

### JavaScript/TypeScript Example

```typescript
it('should parse license data correctly', async () => {
  // Arrange
  const mockData = {
    barcodeData: 'AAMVA_COMPLIANT_DATA',
    scanMode: 'pdf417'
  };
  
  // Act
  const result = await DLScanModule.scanLicense(mockData);
  
  // Assert
  expect(result.success).toBe(true);
  expect(result.data.firstName).toBe('JOHN');
});
```

### Swift Example

```swift
func testPDF417Parsing() throws {
    // Given (Arrange)
    let testData = TestDataProvider.validPDF417Data()
    let parser = LicenseParser()
    
    // When (Act)
    let result = try parser.parse(testData)
    
    // Then (Assert)
    XCTAssertNotNil(result)
    XCTAssertEqual(result.firstName, "JOHN")
}
```

## Mocking Strategies

### JavaScript/TypeScript Mocking

1. **Native Module Mocking**
```typescript
// In __mocks__/DLScanModule.ts
export default {
  scanLicense: jest.fn().mockResolvedValue({
    success: true,
    data: mockLicenseData
  }),
  startScanning: jest.fn(),
  stopScanning: jest.fn()
};
```

2. **React Hook Mocking**
```typescript
// Mock the entire hook
jest.mock('../hooks/useLicenseScanner', () => ({
  useLicenseScanner: () => ({
    isScanning: false,
    error: null,
    licenseData: mockData,
    startScanning: jest.fn(),
    stopScanning: jest.fn()
  })
}));
```

3. **Camera Mocking**
```typescript
// Mock Vision Camera
jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevices: () => ({
    back: { id: 'back' },
    front: { id: 'front' }
  }),
  useFrameProcessor: jest.fn()
}));
```

### Swift Mocking

1. **Protocol-Based Mocking**
```swift
protocol BarcodeDetectorProtocol {
    func detectBarcode(in buffer: CVPixelBuffer) -> String?
}

class MockBarcodeDetector: BarcodeDetectorProtocol {
    var shouldSucceed = true
    var mockResult = "MOCK_BARCODE_DATA"
    
    func detectBarcode(in buffer: CVPixelBuffer) -> String? {
        return shouldSucceed ? mockResult : nil
    }
}
```

2. **Delegate Mocking**
```swift
class MockScannerDelegate: ScannerDelegate {
    var expectation: XCTestExpectation?
    var capturedResult: ScanResult?
    
    func scanner(_ scanner: Scanner, didScan result: ScanResult) {
        capturedResult = result
        expectation?.fulfill()
    }
}
```

## Test Data Fixtures

### JavaScript/TypeScript

```typescript
// fixtures/licenseData.ts
export const validLicenseData = {
  firstName: 'JOHN',
  lastName: 'DOE',
  documentNumber: 'D123456789',
  dateOfBirth: '01/01/1990',
  dateOfExpiry: '01/01/2025',
  address: '123 MAIN ST',
  city: 'ANYTOWN',
  state: 'CA',
  postalCode: '12345'
};

export const corruptedBarcodeData = '@ANSI...CORRUPTED';
```

### Swift

```swift
// TestDataProvider.swift
class TestDataProvider {
    static func validPDF417Data() -> String {
        // Return AAMVA compliant test data
    }
    
    static func sampleLicenseImage() -> UIImage {
        // Return test image
    }
}
```

## Async Testing Patterns

### JavaScript/TypeScript

```typescript
// Using async/await
it('should handle async operations', async () => {
  const result = await scannerModule.processImage(testImage);
  expect(result).toBeDefined();
});

// Using promises
it('should handle promises', () => {
  return scannerModule.processImage(testImage).then(result => {
    expect(result).toBeDefined();
  });
});

// Testing hooks with React Testing Library
import { renderHook, act } from '@testing-library/react-hooks';

it('should update state correctly', async () => {
  const { result } = renderHook(() => useLicenseScanner());
  
  await act(async () => {
    await result.current.startScanning();
  });
  
  expect(result.current.isScanning).toBe(true);
});
```

### Swift

```swift
// Using XCTestExpectation
func testAsyncOperation() {
    let expectation = self.expectation(description: "Async operation")
    
    scanner.scan { result in
        XCTAssertNotNil(result)
        expectation.fulfill()
    }
    
    waitForExpectations(timeout: 5.0)
}

// Using async/await (iOS 13+)
func testAsyncAwait() async throws {
    let result = try await scanner.scan()
    XCTAssertNotNil(result)
}
```

## Error Testing

### JavaScript/TypeScript

```typescript
it('should handle camera permission denied', async () => {
  // Mock permission denied
  mockCheckPermission.mockResolvedValue('denied');
  
  await expect(scanner.start()).rejects.toThrow('Camera permission denied');
});

it('should handle network errors gracefully', async () => {
  // Mock network error
  mockFetch.mockRejectedValue(new Error('Network error'));
  
  const result = await scanner.uploadResult();
  expect(result.success).toBe(false);
  expect(result.error).toContain('Network');
});
```

### Swift

```swift
func testErrorHandling() {
    do {
        _ = try parser.parse("INVALID_DATA")
        XCTFail("Should have thrown error")
    } catch let error as ParsingError {
        XCTAssertEqual(error.code, .invalidFormat)
    } catch {
        XCTFail("Unexpected error type: \(error)")
    }
}
```

## Performance Testing

### JavaScript/TypeScript

```typescript
it('should process frames within performance budget', () => {
  const iterations = 100;
  const startTime = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    processor.processFrame(mockFrame);
  }
  
  const totalTime = performance.now() - startTime;
  const avgTime = totalTime / iterations;
  
  expect(avgTime).toBeLessThan(100); // 100ms budget
});
```

### Swift

```swift
func testPerformance() {
    measure {
        // Code to measure
        for _ in 0..<100 {
            _ = parser.parse(testData)
        }
    }
}

func testMemoryUsage() {
    // Use Instruments or manual measurement
    let baseline = memoryUsage()
    
    // Perform operations
    for _ in 0..<1000 {
        autoreleasepool {
            _ = processLargeImage()
        }
    }
    
    let peak = memoryUsage()
    XCTAssertLessThan(peak - baseline, 50_000_000) // 50MB limit
}
```

## Integration Testing

### React Native Bridge Testing

```typescript
// Test native module integration
it('should communicate with native module', async () => {
  const spy = jest.spyOn(NativeModules.DLScan, 'scanLicense');
  
  await DLScanModule.scanLicense({ mode: 'auto' });
  
  expect(spy).toHaveBeenCalledWith({ mode: 'auto' });
});
```

### Camera Integration Testing

```swift
func testCameraIntegration() {
    let camera = CameraManager()
    let expectation = self.expectation(description: "Frame received")
    
    camera.onFrameReceived = { frame in
        XCTAssertNotNil(frame)
        expectation.fulfill()
    }
    
    camera.startCapture()
    waitForExpectations(timeout: 10.0)
}
```

## Best Practices

### 1. Test Isolation
- Each test should be independent
- Use `beforeEach`/`afterEach` for setup/teardown
- Reset mocks between tests

### 2. Descriptive Test Names
- Test names should clearly describe what is being tested
- Include the scenario and expected outcome
- Use consistent naming patterns

### 3. Test Coverage Goals
- Core business logic: 90%+
- UI components: 80%+
- Utilities: 85%+
- Bridge/Integration: 75%+

### 4. Mock External Dependencies
- Mock all external services
- Mock native modules in JS tests
- Mock system frameworks when needed

### 5. Test Data Management
- Use factories or builders for test data
- Keep test data close to tests
- Avoid hardcoded values

### 6. Continuous Integration
- Run tests on every commit
- Fail builds on test failures
- Monitor test execution time
- Track coverage trends

## Example Test Suite Structure

```
__tests__/
├── unit/
│   ├── components/
│   │   ├── Scanner.test.tsx
│   │   └── ResultDisplay.test.tsx
│   ├── hooks/
│   │   └── useLicenseScanner.test.ts
│   ├── utils/
│   │   ├── parser.test.ts
│   │   └── validator.test.ts
│   └── modules/
│       └── DLScanModule.test.ts
├── integration/
│   ├── bridge.test.ts
│   └── camera.test.ts
├── e2e/
│   ├── scanning.e2e.ts
│   └── permissions.e2e.ts
└── fixtures/
    ├── licenseData.ts
    └── testImages.ts
```

## Testing Checklist

Before considering a feature complete:

- [ ] Unit tests written for all new code
- [ ] Integration tests for module interactions
- [ ] Error scenarios tested
- [ ] Performance benchmarks met
- [ ] Test coverage meets thresholds
- [ ] Tests run in CI successfully
- [ ] Documentation updated