# Simulator Testing Guide for React Native DL Scan

## Overview

This guide provides comprehensive instructions for testing the React Native DL Scan module using the iPad simulator with mocked camera functionality. This approach enables extensive automated testing without requiring physical devices or real camera hardware.

## Prerequisites

- iPad Air 11-inch (M3) simulator running
- WebDriverAgent configured and running
- Jest testing framework setup
- react-native-vision-camera mocking configured

## Camera Mocking Strategy

### 1. React Native Vision Camera Mocking

Following the [official mocking guide](https://react-native-vision-camera.com/docs/guides/mocking), we mock camera functionality to enable comprehensive testing:

```typescript
// __mocks__/react-native-vision-camera.ts
export const Camera = {
  getAvailableCameraDevices: jest.fn(() => Promise.resolve([
    {
      id: 'back',
      position: 'back',
      hasFlash: true,
      hasTorch: true,
      minFocusDistance: 10,
      formats: mockFormats
    }
  ])),
  getCameraPermissionStatus: jest.fn(() => 'granted'),
  requestCameraPermission: jest.fn(() => Promise.resolve('granted')),
};

export const useCameraDevices = jest.fn(() => [mockBackCamera]);
export const useFrameProcessor = jest.fn((processor) => processor);
export const runOnJS = jest.fn((fn) => fn);
```

### 2. Frame Processor Mocking

Mock frame processors to simulate barcode detection, OCR, and document detection:

```typescript
// __mocks__/frameProcessors.ts
export const mockFrameProcessor = {
  // PDF417 barcode simulation
  scanLicense: jest.fn((frame, options) => {
    const mode = options?.mode || 'barcode';
    
    switch (mode) {
      case 'barcode':
        return mockBarcodeResult;
      case 'ocr':
        return mockOCRResult;
      case 'document':
        return mockDocumentResult;
      default:
        return mockErrorResult;
    }
  })
};
```

## Test Data Fixtures

### 1. Valid License Data

```typescript
// __tests__/fixtures/licenseData.ts
export const mockLicenseData = {
  // Valid California license
  california: {
    firstName: 'John',
    lastName: 'Doe',
    licenseNumber: 'D1234567',
    dateOfBirth: '1990-01-15',
    expirationDate: '2025-12-31',
    address: {
      street: '123 Main Street',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90210'
    },
    restrictions: 'NONE',
    endorsements: 'NONE',
    class: 'C'
  },
  
  // Valid Texas license
  texas: {
    firstName: 'Jane',
    lastName: 'Smith',
    licenseNumber: '12345678',
    dateOfBirth: '1985-03-22',
    expirationDate: '2026-03-22',
    address: {
      street: '456 Oak Avenue',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001'
    }
  }
};
```

### 2. PDF417 Barcode Test Data

```typescript
// __tests__/fixtures/barcodeData.ts
export const validPDF417Samples = {
  california: 'ANSI 636014080002DL00410288ZC03190008DLDAAJOHN,DOE...',
  texas: 'ANSI 636015080002DL00410274ZT03190008DLDAAJANE,SMITH...',
  florida: 'ANSI 636010080002DL00410265ZF03190008DLDAAMIKE,JOHNSON...'
};

export const invalidBarcodeData = [
  'INVALID_FORMAT',
  '', // Empty string
  'ANSI 636014080002DL00410288ZC03190008DLDAA', // Truncated
  'CORRUPTED_DATA_WITH_SPECIAL_CHARS@#$%'
];
```

### 3. OCR Test Data

```typescript
// __tests__/fixtures/ocrData.ts
export const mockOCRResults = {
  highQuality: {
    confidence: 0.95,
    extractedText: [
      { text: 'CALIFORNIA', confidence: 0.98, bounds: [10, 20, 200, 45] },
      { text: 'DRIVER LICENSE', confidence: 0.97, bounds: [10, 50, 250, 75] },
      { text: 'DL D1234567', confidence: 0.96, bounds: [10, 100, 180, 125] },
      { text: 'DOE, JOHN', confidence: 0.95, bounds: [10, 130, 150, 155] }
    ]
  },
  
  mediumQuality: {
    confidence: 0.75,
    extractedText: [
      { text: 'CALlFORNlA', confidence: 0.78, bounds: [10, 20, 200, 45] }, // OCR errors
      { text: 'DRIVER LICENSE', confidence: 0.82, bounds: [10, 50, 250, 75] },
      { text: 'DL D123456?', confidence: 0.71, bounds: [10, 100, 180, 125] }, // Unclear character
      { text: 'D0E, J0HN', confidence: 0.69, bounds: [10, 130, 150, 155] } // 0/O confusion
    ]
  },
  
  lowQuality: {
    confidence: 0.45,
    extractedText: [
      { text: 'CAL1F0RN1A', confidence: 0.48, bounds: [10, 20, 200, 45] },
      { text: 'DR1VER L1CENSE', confidence: 0.52, bounds: [10, 50, 250, 75] },
      { text: 'DL D123***', confidence: 0.35, bounds: [10, 100, 180, 125] },
      { text: '***E, ***N', confidence: 0.28, bounds: [10, 130, 150, 155] }
    ]
  }
};
```

## Testing Frameworks

### 1. Unit Testing with Jest

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### 2. Integration Testing

```typescript
// Example integration test
describe('Frame Processor Integration', () => {
  beforeEach(() => {
    mockCamera.setup({
      permissionStatus: 'granted',
      frameProcessor: true
    });
  });

  it('should process PDF417 frames end-to-end', async () => {
    const mockFrame = createMockFrame({
      mode: 'barcode',
      data: validPDF417Samples.california
    });
    
    const result = await processFrame(mockFrame);
    
    expect(result.success).toBe(true);
    expect(result.licenseData.firstName).toBe('JOHN');
    expect(result.licenseData.lastName).toBe('DOE');
  });
});
```

### 3. E2E Testing with Detox

```javascript
// e2e/scanning.e2e.js
describe('License Scanning E2E', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  it('should complete full scanning flow', async () => {
    // Start scanning
    await element(by.id('start-scan-button')).tap();
    
    // Simulate camera permission
    await mockCameraPermission('granted');
    
    // Inject test barcode data
    await mockCameraInput({
      type: 'barcode',
      data: validPDF417Samples.california
    });
    
    // Verify results display
    await waitFor(element(by.id('scan-result')))
      .toBeVisible()
      .withTimeout(5000);
    
    await expect(element(by.id('license-name'))).toHaveText('JOHN DOE');
  });
});
```

## Simulator-Specific Testing Scenarios

### 1. Permission Handling

```typescript
describe('Camera Permissions', () => {
  it('should handle denied permissions gracefully', async () => {
    mockCamera.setPermissionStatus('denied');
    
    const scanner = renderHook(() => useLicenseScanner());
    
    await waitFor(() => {
      expect(scanner.result.current.error?.code).toBe('PERMISSION_DENIED');
    });
  });

  it('should request permissions when needed', async () => {
    mockCamera.setPermissionStatus('not-determined');
    
    const requestSpy = jest.spyOn(Camera, 'requestCameraPermission');
    
    renderHook(() => useLicenseScanner());
    
    expect(requestSpy).toHaveBeenCalled();
  });
});
```

### 2. Error Scenarios

```typescript
describe('Error Handling', () => {
  it('should handle invalid barcode data', async () => {
    const mockFrame = createMockFrame({
      mode: 'barcode',
      data: 'INVALID_BARCODE_DATA'
    });
    
    const result = await processFrame(mockFrame);
    
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('PARSING_FAILED');
    expect(result.error.recoverable).toBe(true);
  });

  it('should handle OCR failures', async () => {
    const mockFrame = createMockFrame({
      mode: 'ocr',
      imageData: 'corrupted_image_data'
    });
    
    const result = await processFrame(mockFrame);
    
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('OCR_FAILED');
  });
});
```

### 3. Performance Testing

```typescript
describe('Performance Validation', () => {
  it('should process frames within time limits', async () => {
    const startTime = Date.now();
    
    const mockFrame = createMockFrame({
      mode: 'barcode',
      data: validPDF417Samples.california
    });
    
    await processFrame(mockFrame);
    
    const processingTime = Date.now() - startTime;
    expect(processingTime).toBeLessThan(500); // 500ms limit
  });

  it('should handle frame rate throttling', async () => {
    const frameProcessor = new LicenseFrameProcessor();
    const frames = Array(10).fill(null).map(() => createMockFrame());
    
    const processedFrames = [];
    
    for (const frame of frames) {
      const result = await frameProcessor.process(frame);
      if (result) processedFrames.push(result);
    }
    
    // Should throttle to max 10 FPS
    expect(processedFrames.length).toBeLessThanOrEqual(3);
  });
});
```

## Interactive Testing with Mobile MCP

### Overview

For interactive development and testing, the iOS simulator can be controlled using the Mobile MCP (Model Context Protocol) tool with WebDriverAgent. This approach enables real-time interaction with the app for manual testing, UI validation, and iterative development.

### Prerequisites

- iPad Air 11-inch (M3) simulator running
- WebDriverAgent installed and configured on the simulator
- Mobile MCP tool available in the development environment

### Setup WebDriverAgent

WebDriverAgent should already be installed on the iPad simulator for interactive testing:

```bash
# Verify WebDriverAgent is running on simulator
# The mobile MCP tool will automatically connect to the WebDriverAgent session
```

### Using Mobile MCP for Interactive Testing

#### 1. Launch the Example App

```bash
# From project root
cd example
yarn start  # Start Metro bundler

# In another terminal
yarn ios   # Launch app on simulator
```

#### 2. Control Simulator with Mobile MCP

Use mobile MCP commands to interact with the running app:

```javascript
// Take screenshot to see current app state
mobile_take_screenshot

// List interactive elements on screen
mobile_list_elements_on_screen

// Click on specific elements (e.g., "Open Camera" button)
mobile_click_on_screen_at_coordinates(x, y)

// Type text input if needed
mobile_type_keys("sample text", true)

// Navigate using device buttons
mobile_press_button("HOME")
mobile_press_button("BACK")

// Swipe gestures for scrolling
swipe_on_screen("up", 200)
```

#### 3. Interactive Testing Scenarios

**Camera Permission Testing:**
```javascript
// Launch app and trigger camera permission request
mobile_click_on_screen_at_coordinates(/* Open Camera button coordinates */)

// Handle system permission dialog
mobile_click_on_screen_at_coordinates(/* Allow button coordinates */)
```

**Navigation Flow Testing:**
```javascript
// Test full scanning workflow
mobile_take_screenshot()  // Initial state
mobile_click_on_screen_at_coordinates(/* Open Camera */)
mobile_take_screenshot()  // Camera view
mobile_click_on_screen_at_coordinates(/* Close or Back */)
mobile_take_screenshot()  // Back to main view
```

**Error State Testing:**
```javascript
// Test app behavior under different conditions
mobile_click_on_screen_at_coordinates(/* Test Scan button */)
mobile_take_screenshot()  // Results display
mobile_click_on_screen_at_coordinates(/* Reset button */)
mobile_take_screenshot()  // Reset state
```

#### 4. Sample Data Integration

For testing without real camera input, provide sample ID card images:

```javascript
// Request sample images from user as needed
// "I need sample ID card images for testing. Can you provide:"
// - Front of California driver's license
// - Front of Texas driver's license  
// - Sample with poor lighting conditions
// - Sample with damaged/worn license
```

#### 5. Mobile MCP Testing Workflow

```javascript
// 1. Launch and verify app state
mobile_use_default_device()
mobile_take_screenshot()

// 2. Navigate through app features
mobile_list_elements_on_screen()
mobile_click_on_screen_at_coordinates(x, y)

// 3. Validate UI responses
mobile_take_screenshot()

// 4. Test error conditions
mobile_click_on_screen_at_coordinates(/* error trigger */)
mobile_take_screenshot()

// 5. Reset for next test
mobile_click_on_screen_at_coordinates(/* reset button */)
```

### Interactive Testing Benefits

- **Real-time feedback**: See immediate results of code changes
- **Manual validation**: Verify UI/UX behavior that automated tests might miss
- **Sample data testing**: Test with real ID card images provided by user
- **Performance observation**: Monitor app responsiveness during interactions
- **Camera simulation limitations**: Work around simulator camera restrictions

### Integration with Development

The mobile MCP approach complements the automated testing framework:

1. **Development**: Use mobile MCP for iterative UI development
2. **Manual Testing**: Validate user experience flows
3. **Sample Data**: Test with realistic ID card images
4. **Debugging**: Interactive debugging of camera permission and scanning flows
5. **Automated Testing**: Fall back to Jest/Detox for CI/CD

### Best Practices for Mobile MCP Testing

- **Screenshot frequently**: Document each step for debugging
- **Element coordinates**: Use `mobile_list_elements_on_screen()` to find precise coordinates
- **State verification**: Take screenshots before and after each interaction
- **Sample data ready**: Have various ID card images prepared for testing
- **Permission flows**: Test both granted and denied camera permissions
- **Error recovery**: Verify app handles errors gracefully with user-friendly messages

## Best Practices

### 1. Test Organization

- **Unit Tests**: Individual component and function testing
- **Integration Tests**: Cross-module communication testing
- **E2E Tests**: Full user flow validation
- **Performance Tests**: Timing and resource usage validation

### 2. Mock Management

- Keep mock data realistic and current with AAMVA standards
- Update test fixtures when license formats change
- Use deterministic mock responses for consistent testing

### 3. Coverage Goals

- **Unit Tests**: 60% coverage minimum
- **Integration Tests**: 30% coverage minimum  
- **E2E Tests**: 10% coverage minimum
- **Total Coverage**: 80%+ across all test types

### 4. CI/CD Integration

```yaml
# .github/workflows/test.yml
- name: Run Unit Tests
  run: npm run test:unit
  
- name: Run Integration Tests  
  run: npm run test:integration
  
- name: Run E2E Tests on Simulator
  run: |
    xcrun simctl boot "iPad Air (5th generation)" 
    npm run test:e2e:ios
```

## Troubleshooting

### Common Issues

1. **Mock not working**: Ensure `__mocks__` directory is at project root
2. **Frame processor errors**: Verify mock frame structure matches expected format
3. **E2E test failures**: Check simulator state and WebDriverAgent connection
4. **Performance test flakiness**: Use consistent timing and avoid system load during tests

### Debug Tips

- Use `console.log` in mock functions to verify call patterns
- Enable Jest verbose mode for detailed test output
- Use Detox's screenshot capability for E2E debugging
- Monitor simulator performance during test runs

## Integration with Development Workflow

1. **Pre-commit**: Run unit tests automatically
2. **Pull Request**: Run full test suite including integration tests
3. **Release**: Run E2E tests on multiple simulator configurations
4. **Post-deployment**: Validate with device testing when available

This simulator testing approach provides comprehensive validation while enabling rapid development cycles and consistent CI/CD integration.