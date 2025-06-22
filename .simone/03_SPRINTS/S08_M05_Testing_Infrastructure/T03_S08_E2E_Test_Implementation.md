# T03_S08: E2E Test Implementation

## Task ID
**T03_S08**

## Description
Implement comprehensive end-to-end tests using Detox or similar framework to validate complete scanning workflows, mode switching, error handling, and user interactions across different devices and scenarios.

## Parent Module
**M05: Testing, Optimization & Documentation**

## Prerequisites
- T01_S08: Unit test framework setup complete
- T02_S08: Integration tests implemented
- Full app functionality implemented
- UI components and navigation complete

## Complexity
**Medium** - Requires device automation and complex scenario orchestration

## Sub-tasks

### 1. E2E Framework Setup
- Configure Detox for React Native
- Set up test runners for iOS and Android
- Configure device farm integration
- Implement test artifacts collection

### 2. Core Scanning Flow Tests
- Test PDF417 scanning happy path
- Test OCR fallback activation
- Validate mode switching behaviors
- Test scanning timeout scenarios

### 3. Error Case Testing
- Test camera permission denial
- Test poor lighting conditions
- Test invalid barcode handling
- Test network failure scenarios

### 4. Device Matrix Testing
- Define supported device matrix
- Test on various screen sizes
- Validate orientation changes
- Test on different OS versions

## Acceptance Criteria
- [ ] Detox configured for both platforms
- [ ] Core scanning flows tested E2E
- [ ] Error scenarios comprehensively covered
- [ ] Device matrix defined and tested
- [ ] Test reports with screenshots/videos
- [ ] CI integration complete

## Technical Notes

### Detox Configuration
```javascript
// .detoxrc.js
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js'
    },
    jest: {
      setupTimeout: 120000
    }
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/RNDLScan.app',
      build: 'xcodebuild -workspace ios/RNDLScan.xcworkspace -scheme RNDLScan -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build'
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
      reversePorts: [8081]
    }
  },
  devices: {
    'ios.simulator': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 14'
      }
    },
    'android.emulator': {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_5_API_31'
      }
    }
  },
  configurations: {
    'ios.sim.debug': {
      device: 'ios.simulator',
      app: 'ios.debug'
    },
    'android.emu.debug': {
      device: 'android.emulator',
      app: 'android.debug'
    }
  }
};
```

### Core Scanning Flow Test
```typescript
// e2e/scanningFlow.test.ts
describe('Driver License Scanning Flow', () => {
  beforeAll(async () => {
    await device.launchApp({
      permissions: { camera: 'YES' }
    });
  });
  
  beforeEach(async () => {
    await device.reloadReactNative();
  });
  
  it('should complete PDF417 scanning successfully', async () => {
    // Navigate to scanner
    await element(by.id('scan-button')).tap();
    
    // Verify camera view is visible
    await expect(element(by.id('camera-view'))).toBeVisible();
    await expect(element(by.id('scan-guide-overlay'))).toBeVisible();
    
    // Simulate barcode detection
    await device.sendToHome();
    await device.launchApp({
      url: 'rndlscan://test?mockBarcode=valid-pdf417'
    });
    
    // Wait for processing
    await waitFor(element(by.id('scan-result')))
      .toBeVisible()
      .withTimeout(5000);
    
    // Verify extracted data
    await expect(element(by.text('JOHN DOE'))).toBeVisible();
    await expect(element(by.text('01/15/1990'))).toBeVisible();
    await expect(element(by.id('confirm-button'))).toBeVisible();
    
    // Confirm and complete
    await element(by.id('confirm-button')).tap();
    await expect(element(by.id('success-screen'))).toBeVisible();
  });
  
  it('should fallback to OCR when PDF417 fails', async () => {
    // Start scanning
    await element(by.id('scan-button')).tap();
    
    // Wait for timeout (simulated)
    await device.launchApp({
      url: 'rndlscan://test?simulateTimeout=true'
    });
    
    // Verify OCR mode activated
    await waitFor(element(by.id('ocr-mode-indicator')))
      .toBeVisible()
      .withTimeout(35000);
    
    // Verify instruction change
    await expect(element(by.text('Position front of license'))).toBeVisible();
    
    // Simulate OCR capture
    await device.launchApp({
      url: 'rndlscan://test?mockOCR=valid-front'
    });
    
    // Verify OCR results
    await waitFor(element(by.id('ocr-result')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
```

### Error Scenario Tests
```typescript
// e2e/errorScenarios.test.ts
describe('Error Handling Scenarios', () => {
  it('should handle camera permission denial', async () => {
    await device.launchApp({
      permissions: { camera: 'NO' }
    });
    
    await element(by.id('scan-button')).tap();
    
    // Verify permission error
    await expect(element(by.id('permission-error'))).toBeVisible();
    await expect(element(by.text('Camera access required'))).toBeVisible();
    
    // Test settings navigation
    await element(by.id('open-settings-button')).tap();
    // Note: Can't fully test settings, but verify attempt
  });
  
  it('should handle poor lighting conditions', async () => {
    await device.launchApp({
      permissions: { camera: 'YES' },
      launchArgs: { simulateLowLight: true }
    });
    
    await element(by.id('scan-button')).tap();
    
    // Verify lighting warning
    await waitFor(element(by.id('lighting-warning')))
      .toBeVisible()
      .withTimeout(3000);
    
    await expect(element(by.text('Improve lighting'))).toBeVisible();
  });
  
  it('should handle invalid barcode gracefully', async () => {
    await element(by.id('scan-button')).tap();
    
    // Simulate invalid barcode
    await device.launchApp({
      url: 'rndlscan://test?mockBarcode=invalid-format'
    });
    
    // Verify error handling
    await waitFor(element(by.id('scan-error')))
      .toBeVisible()
      .withTimeout(5000);
    
    await expect(element(by.text('Invalid license format'))).toBeVisible();
    await element(by.id('retry-button')).tap();
    
    // Verify scanner restarted
    await expect(element(by.id('camera-view'))).toBeVisible();
  });
});
```

### Device Matrix Test Configuration
```typescript
// e2e/deviceMatrix.config.ts
export const deviceMatrix = {
  ios: [
    { name: 'iPhone 14 Pro Max', os: '16.0' },
    { name: 'iPhone 13', os: '15.5' },
    { name: 'iPhone 12 mini', os: '15.0' },
    { name: 'iPad Pro 12.9', os: '16.0' }
  ],
  android: [
    { name: 'Pixel 7', api: 33 },
    { name: 'Pixel 5', api: 31 },
    { name: 'Samsung Galaxy S22', api: 32 },
    { name: 'OnePlus 9', api: 30 }
  ]
};

// Device-specific test
describe('Multi-Device Tests', () => {
  deviceMatrix.ios.forEach(device => {
    describe(`${device.name} - iOS ${device.os}`, () => {
      beforeAll(async () => {
        await device.selectDevice(device);
      });
      
      it('should handle orientation changes', async () => {
        await element(by.id('scan-button')).tap();
        
        // Test portrait
        await device.setOrientation('portrait');
        await expect(element(by.id('camera-view'))).toBeVisible();
        
        // Test landscape
        await device.setOrientation('landscape');
        await expect(element(by.id('camera-view'))).toBeVisible();
        
        // Verify UI adapts
        await expect(element(by.id('scan-guide-overlay')))
          .toHaveStyle({ aspectRatio: 1.586 });
      });
    });
  });
});
```

### Test Artifacts Collection
```javascript
// e2e/jest.config.js
module.exports = {
  maxWorkers: 1,
  testTimeout: 120000,
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  reporters: [
    'default',
    [
      'jest-html-reporter',
      {
        pageTitle: 'RNDLScan E2E Test Report',
        outputPath: 'e2e/reports/test-report.html',
        includeFailureMsg: true,
        includeConsoleLog: true
      }
    ]
  ],
  setupFilesAfterEnv: ['<rootDir>/e2e/setup.ts']
};

// Artifact collection setup
afterEach(async () => {
  const testName = expect.getState().currentTestName;
  
  if (expect.getState().assertionCalls > 0) {
    // Take screenshot on failure
    await device.takeScreenshot(`${testName}-failure`);
    
    // Collect logs
    await device.gatherLogs().then(logs => {
      saveArtifact(`${testName}-logs.txt`, logs);
    });
  }
});
```

## Dependencies
- Detox framework
- Jest for test runner
- Device farm service (AWS, BrowserStack)
- Test reporting tools
- Mock data generators

## Risks & Mitigations
- **Risk**: E2E tests are inherently flaky
  - **Mitigation**: Implement retry logic and proper waits
- **Risk**: Device farm costs
  - **Mitigation**: Run subset on CI, full suite nightly
- **Risk**: Slow test execution
  - **Mitigation**: Parallelize where possible, optimize waits

## Success Metrics
- All critical user paths covered by E2E tests
- < 5% test flakiness rate
- Test execution time < 30 minutes for full suite
- 100% device matrix coverage
- Automated test reports with artifacts