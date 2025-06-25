# E2E Testing Suite

## Overview

This directory contains the comprehensive End-to-End (E2E) testing suite for the React Native DL Scan library. The tests are built using Detox and provide coverage for:

- Core scanning workflows (PDF417 and OCR)
- Error handling scenarios
- Device matrix compatibility
- Performance validation
- User experience flows

## Test Structure

```
e2e/
├── jest.config.js              # Jest configuration for E2E tests
├── setup.ts                    # Global test setup and utilities
├── globalSetup.js              # One-time setup for test runs
├── globalTeardown.js           # Cleanup after test runs
├── scanningFlow.test.ts        # Core scanning workflow tests
├── errorScenarios.test.ts      # Error handling and recovery tests
├── deviceMatrix.test.ts        # Device compatibility tests
├── utils/
│   ├── testSequencer.js        # Test execution order control
│   ├── pathBuilder.js          # Artifact path organization
│   ├── artifactCollector.js    # Test artifact collection
│   └── testRunner.js           # Enhanced test runner
├── artifacts/                  # Generated test artifacts
│   ├── screenshots/            # Test screenshots
│   ├── videos/                 # Test recordings
│   └── logs/                   # Device and app logs
└── reports/                    # Test reports and summaries
```

## Quick Start

### Prerequisites

1. **Node.js 18+** and **Yarn**
2. **React Native development environment** set up
3. **Detox CLI** installed globally: `npm install -g detox-cli`
4. **iOS Simulator** (for iOS tests) or **Android Emulator** (for Android tests)

### Running Tests

```bash
# Install dependencies
yarn install

# Build the app for testing (iOS)
npx detox build --configuration ios.sim.debug

# Build the app for testing (Android)
npx detox build --configuration android.emu.debug

# Run all E2E tests (iOS)
npx detox test --configuration ios.sim.debug

# Run all E2E tests (Android)
npx detox test --configuration android.emu.debug

# Run specific test suite
npx detox test --configuration ios.sim.debug e2e/scanningFlow.test.ts

# Run tests with custom device
npx detox test --configuration ios.sim.debug --device-name "iPhone 14 Pro Max"
```

## Test Configurations

### Device Matrix

The test suite supports multiple device configurations:

**iOS Devices:**
- iPhone 14 (standard)
- iPhone 14 Pro Max (large screen)
- iPhone 13 mini (small screen)
- iPad Pro 12.9" (tablet)

**Android Devices:**
- Pixel 7 (modern Android)
- Pixel 5 (mid-range)
- Samsung Galaxy S22 (vendor variation)
- Pixel Tablet (tablet)

### Test Scenarios

#### Core Scanning Flow (`scanningFlow.test.ts`)
- PDF417 barcode scanning happy paths
- OCR fallback activation and processing
- Mode switching between PDF417 and OCR
- Timeout handling and recovery
- Performance validation

#### Error Scenarios (`errorScenarios.test.ts`)
- Camera permission denial and recovery
- Poor lighting condition handling
- Invalid barcode format processing
- Network connectivity issues
- System-level error recovery

#### Device Matrix (`deviceMatrix.test.ts`)
- Screen size adaptation testing
- Orientation change handling
- Platform-specific feature validation
- Performance across device types
- Accessibility compliance

## Test Artifacts

The test suite automatically collects comprehensive artifacts:

### Screenshots
- Test start/end screenshots
- Failure point captures
- UI state documentation

### Videos
- Complete test execution recordings
- Failure scenario playbacks

### Logs
- Device system logs
- App debugging output
- Performance metrics

### Reports
- HTML test reports with visual artifacts
- JSON reports for programmatic analysis
- JUnit XML for CI integration

## CI/CD Integration

### GitHub Actions

The test suite includes comprehensive CI/CD integration:

```yaml
# Trigger E2E tests
name: E2E Tests
on:
  push: [main, develop]
  pull_request: [main, develop]
  schedule: '0 2 * * *'  # Nightly
```

### Test Matrix Options

- **Quick**: iOS only, core tests
- **Full**: iOS + Android, all test suites
- **iOS Only**: All iOS devices and tests
- **Android Only**: All Android devices and tests

### Manual Triggers

```bash
# Trigger via GitHub CLI
gh workflow run "E2E Tests" --field device_matrix=full --field test_suite=all

# Or use GitHub UI workflow dispatch
```

## Configuration

### Environment Variables

```bash
# Test artifact locations
E2E_ARTIFACTS_DIR=./e2e/artifacts
E2E_REPORTS_DIR=./e2e/reports
E2E_SCREENSHOTS_DIR=./e2e/artifacts/screenshots
E2E_LOGS_DIR=./e2e/artifacts/logs
E2E_VIDEOS_DIR=./e2e/artifacts/videos

# Test configuration
DETOX_CONFIGURATION=ios.sim.debug
DETOX_DEVICE_NAME="iPhone 14"
TEST_TIMEOUT=120000
```

### Detox Configuration

The test suite uses `.detoxrc.js` for configuration:

```javascript
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js'
    }
  },
  apps: {
    'ios.debug': { /* iOS app config */ },
    'android.debug': { /* Android app config */ }
  },
  devices: {
    'ios.simulator': { /* iOS device config */ },
    'android.emulator': { /* Android device config */ }
  }
};
```

## Debugging Tests

### Running Tests in Debug Mode

```bash
# Enable verbose logging
DEBUG=detox* npx detox test --configuration ios.sim.debug

# Run single test with artifacts
npx detox test --configuration ios.sim.debug --testNamePattern "should complete PDF417 scanning"

# Keep artifacts on success
npx detox test --configuration ios.sim.debug --cleanup=false
```

### Common Issues

#### iOS Simulator Issues
```bash
# Reset iOS Simulator
xcrun simctl erase all

# Rebuild app
npx detox build --configuration ios.sim.debug
```

#### Android Emulator Issues
```bash
# Cold boot emulator
emulator -avd <AVD_NAME> -cold-boot

# Clear emulator cache
emulator -avd <AVD_NAME> -wipe-data
```

#### Metro Bundler Issues
```bash
# Reset Metro cache
npx react-native start --reset-cache

# Kill Metro processes
killall node
```

## Performance Expectations

### Test Execution Times
- **Core scanning flow**: < 2 minutes per device
- **Error scenarios**: < 3 minutes per device
- **Device matrix**: < 5 minutes per device
- **Full suite**: < 10 minutes per device

### Performance Targets
- Scanner startup: < 3 seconds
- Barcode processing: < 5 seconds
- OCR processing: < 10 seconds
- Mode switching: < 1 second

## Best Practices

### Writing New Tests

1. **Use Test Utilities**: Leverage `TestUtils` for common operations
2. **Capture Artifacts**: Screenshots and logs for debugging
3. **Handle Timing**: Use `waitFor` with appropriate timeouts
4. **Clean State**: Reset app state between tests
5. **Platform Awareness**: Consider iOS/Android differences

### Test Data Management

```typescript
// Use predefined test data
const validBarcode = TestData.validBarcodes.california;
const expectedResult = TestData.expectedResults.california;

// Simulate barcode scanning
await TestUtils.simulateBarcodeScan(validBarcode);
await TestUtils.waitForScanResult();
```

### Error Handling

```typescript
// Capture failure artifacts
afterEach(async () => {
  if (hasTestFailed) {
    await TestUtils.takeTestScreenshot('failure');
    await TestUtils.collectDeviceLogs();
  }
});
```

## Maintenance

### Regular Tasks

1. **Update Device Matrix**: Add new device configurations quarterly
2. **Review Performance**: Monitor test execution times
3. **Artifact Cleanup**: Manage storage of test artifacts
4. **Dependencies**: Keep Detox and testing tools updated

### Monitoring

- Test execution times trending upward
- Artifact storage usage
- CI/CD pipeline success rates
- Device compatibility matrix coverage

## Support

For issues with the E2E testing suite:

1. Check the [troubleshooting guide](./TROUBLESHOOTING.md)
2. Review recent test artifacts and logs
3. Verify device/emulator configuration
4. Check CI/CD pipeline logs

## Contributing

When adding new E2E tests:

1. Follow existing test patterns and structure
2. Add appropriate test data to fixtures
3. Update device matrix if needed
4. Ensure CI integration works
5. Document new test scenarios