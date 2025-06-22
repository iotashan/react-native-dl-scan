# T02_S08: Integration Test Suite

## Task ID
**T02_S08**

## Description
Create comprehensive integration tests for React Native bridge communication, camera frame processors, and cross-platform module interactions. Focus on testing the integration points between JavaScript and native code.

## Parent Module
**M05: Testing, Optimization & Documentation**

## Prerequisites
- T01_S08: Unit test framework established
- Native modules fully implemented
- React Native bridge operational
- Frame processors integrated

## Complexity
**Medium** - Requires testing across platform boundaries and simulating hardware

## Sub-tasks

### 1. Bridge Communication Testing
- Test method invocations from JS to native
- Verify callback and promise handling
- Test event emission from native to JS
- Validate data serialization/deserialization

### 2. Frame Processor Integration Tests
- Mock camera frame data
- Test frame processor plugin registration
- Verify barcode detection pipeline
- Test performance under load

### 3. Mock Strategy Implementation
- Create mock native modules for testing
- Implement camera frame simulators
- Build test fixture generators
- Design deterministic test scenarios

### 4. Cross-Platform Test Suite
- Ensure tests run on both iOS and Android
- Handle platform-specific behaviors
- Create shared test utilities
- Implement platform-agnostic assertions

## Acceptance Criteria
- [ ] Bridge communication tests cover all public APIs
- [ ] Frame processor tests validate detection accuracy
- [ ] Mock strategies documented and reusable
- [ ] Test fixtures cover edge cases and error scenarios
- [ ] Integration tests run in < 10 minutes
- [ ] Platform-specific behaviors properly tested

## Technical Notes

### Bridge Communication Test Example
```typescript
// Integration test for bridge communication
describe('RNDLScan Bridge Integration', () => {
  let mockNativeModule: jest.Mocked<typeof NativeModules.RNDLScan>;
  
  beforeEach(() => {
    mockNativeModule = {
      startScanning: jest.fn().mockResolvedValue(true),
      stopScanning: jest.fn().mockResolvedValue(true),
      processFrame: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn()
    };
    
    NativeModules.RNDLScan = mockNativeModule;
  });
  
  it('should handle scanning lifecycle correctly', async () => {
    // Start scanning
    const config = { mode: 'pdf417', timeout: 30000 };
    await RNDLScanModule.startScanning(config);
    
    expect(mockNativeModule.startScanning)
      .toHaveBeenCalledWith(config);
    
    // Simulate barcode detection
    const mockEvent = {
      type: 'pdf417',
      data: 'encoded-license-data',
      confidence: 0.95
    };
    
    // Trigger native event
    const eventCallback = mockNativeModule.addListener
      .mock.calls[0][1];
    eventCallback(mockEvent);
    
    // Stop scanning
    await RNDLScanModule.stopScanning();
    
    expect(mockNativeModule.stopScanning)
      .toHaveBeenCalled();
  });
});
```

### Frame Processor Test Setup
```typescript
// Mock frame data generator
class MockFrameGenerator {
  static createFrame(options: FrameOptions): Frame {
    return {
      width: options.width || 1920,
      height: options.height || 1080,
      bytesPerRow: options.bytesPerRow || 1920 * 4,
      planesCount: options.planesCount || 1,
      orientation: options.orientation || 'portrait',
      timestamp: Date.now(),
      buffer: this.generateMockBuffer(options)
    };
  }
  
  static generateMockBuffer(options: FrameOptions): ArrayBuffer {
    // Generate mock image data with embedded barcode
    const size = options.width * options.height * 4;
    const buffer = new ArrayBuffer(size);
    
    if (options.embedBarcode) {
      // Embed synthetic barcode pattern
      this.embedBarcodePattern(buffer, options);
    }
    
    return buffer;
  }
}

// Frame processor integration test
describe('Frame Processor Integration', () => {
  it('should detect PDF417 in mock frame', async () => {
    const mockFrame = MockFrameGenerator.createFrame({
      width: 1920,
      height: 1080,
      embedBarcode: true,
      barcodeType: 'pdf417'
    });
    
    const result = await frameProcessor(mockFrame);
    
    expect(result).toMatchObject({
      detected: true,
      type: 'pdf417',
      confidence: expect.any(Number)
    });
  });
});
```

### Test Fixture Structure
```typescript
// Test fixtures for various scenarios
export const TestFixtures = {
  licenses: {
    valid: {
      pdf417: 'ANSI-6360100102DL...',
      firstName: 'JOHN',
      lastName: 'DOE',
      dob: '01/15/1990'
    },
    expired: {
      pdf417: 'ANSI-6360100102DL...',
      expirationDate: '01/01/2020'
    },
    malformed: {
      pdf417: 'INVALID-DATA-FORMAT'
    }
  },
  
  frames: {
    clearBarcode: () => MockFrameGenerator.createFrame({
      embedBarcode: true,
      barcodeQuality: 'high'
    }),
    blurryBarcode: () => MockFrameGenerator.createFrame({
      embedBarcode: true,
      barcodeQuality: 'low',
      blur: 5
    }),
    noBarcde: () => MockFrameGenerator.createFrame({
      embedBarcode: false
    })
  },
  
  ocrText: {
    valid: [
      'DOE, JOHN',
      'DOB: 01/15/1990',
      'EXP: 01/15/2025'
    ],
    partial: [
      'DOE, J',
      'DOB: 01/--/1990'
    ]
  }
};
```

### Platform-Specific Test Handling
```typescript
// Platform-agnostic test utilities
export const PlatformTestUtils = {
  runPlatformTest: (testName: string, iosTest: Function, androidTest: Function) => {
    if (Platform.OS === 'ios') {
      test(`${testName} (iOS)`, iosTest);
    } else {
      test(`${testName} (Android)`, androidTest);
    }
  },
  
  mockPlatformSpecificModule: (moduleName: string) => {
    const mockModule = Platform.select({
      ios: require(`./mocks/ios/${moduleName}`),
      android: require(`./mocks/android/${moduleName}`)
    });
    
    jest.doMock(moduleName, () => mockModule);
  }
};
```

## Dependencies
- React Native Testing Library
- Jest with React Native preset
- Detox (for E2E preparation)
- Mock camera frame generators
- Platform-specific test utilities

## Risks & Mitigations
- **Risk**: Flaky tests due to async operations
  - **Mitigation**: Use proper wait strategies and timeouts
- **Risk**: Platform differences causing test failures
  - **Mitigation**: Create platform-aware test utilities
- **Risk**: Mock data not representing real scenarios
  - **Mitigation**: Base mocks on actual device data

## Success Metrics
- 100% coverage of bridge API methods
- All integration points tested
- Test execution time < 10 minutes
- Zero flaky tests in CI
- Mock strategies reused across test suites