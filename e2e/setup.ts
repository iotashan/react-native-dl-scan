/**
 * T03_S08: E2E Test Setup
 * Global setup configuration for Detox E2E testing
 */

import { device, expect, element, by, waitFor } from 'detox';
import adapter from 'detox/runners/jest/adapter';
import specReporter from 'detox/runners/jest/specReporter';

// Set the default timeout for all waitFor operations
jest.setTimeout(300000);
jasmine.getEnv().addReporter(adapter);

// Add the spec reporter for better test output
jasmine.getEnv().addReporter(specReporter);

// Global test setup
beforeAll(async () => {
  await device.launchApp({
    permissions: { camera: 'YES' },
    launchArgs: {
      detoxEnableHeartBeat: true,
      detoxPrintBusyIdleResources: true,
    },
  });
});

beforeEach(async () => {
  // Reset the app state before each test
  await device.reloadReactNative();

  // Wait for app to be ready
  await waitFor(element(by.id('app-root')))
    .toBeVisible()
    .withTimeout(10000);
});

afterEach(async () => {
  // Take screenshot on test failure
  const testName = expect.getState().currentTestName || 'unknown-test';
  const hasFailures =
    expect.getState().numPassingAsserts === 0 &&
    expect.getState().suppressedErrors.length > 0;

  if (hasFailures) {
    await device.takeScreenshot(`${testName}-failure`);

    // Collect device logs on failure
    try {
      const logs =
        (await device.getPlatform()) === 'ios'
          ? await device.getUiDevice().getDeviceLog()
          : await device.getUiDevice().getAdbLog();

      console.log(`📱 Device logs for failed test: ${testName}`);
      console.log(logs);
    } catch (error) {
      console.warn('Failed to collect device logs:', error);
    }
  }
});

afterAll(async () => {
  // Clean up after all tests
  await device.terminateApp();
});

// Custom matchers for E2E testing
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeVisibleOnScreen(): R;
      toHaveValidCameraPermission(): R;
      toCompleteWithinTimeout(timeout: number): R;
    }
  }
}

// Add custom Detox matchers
expect.extend({
  async toBeVisibleOnScreen(received) {
    try {
      await waitFor(received).toBeVisible().withTimeout(5000);
      return {
        message: () => 'Element is visible on screen',
        pass: true,
      };
    } catch (error) {
      return {
        message: () => `Element is not visible on screen: ${error}`,
        pass: false,
      };
    }
  },

  async toHaveValidCameraPermission() {
    try {
      // Check if camera permission is granted by looking for camera-related UI
      await waitFor(element(by.id('camera-view')))
        .toBeVisible()
        .withTimeout(3000);

      return {
        message: () => 'Camera permission is granted',
        pass: true,
      };
    } catch (error) {
      return {
        message: () =>
          'Camera permission is not granted or camera view not accessible',
        pass: false,
      };
    }
  },

  async toCompleteWithinTimeout(received, timeout: number) {
    const startTime = Date.now();

    try {
      await received;
      const actualTime = Date.now() - startTime;

      if (actualTime <= timeout) {
        return {
          message: () =>
            `Operation completed in ${actualTime}ms (within ${timeout}ms)`,
          pass: true,
        };
      } else {
        return {
          message: () =>
            `Operation took ${actualTime}ms (exceeded ${timeout}ms limit)`,
          pass: false,
        };
      }
    } catch (error) {
      return {
        message: () => `Operation failed: ${error}`,
        pass: false,
      };
    }
  },
});

// Global test utilities
global.TestUtils = {
  async navigateToScanner() {
    await element(by.id('scan-button')).tap();
    await waitFor(element(by.id('camera-view')))
      .toBeVisible()
      .withTimeout(5000);
  },

  async simulateBarcodeScan(barcodeData: string) {
    await device.sendToHome();
    await device.launchApp({
      url: `rndlscan://test?mockBarcode=${barcodeData}`,
      newInstance: false,
    });
  },

  async waitForScanResult(timeout: number = 10000) {
    await waitFor(element(by.id('scan-result')))
      .toBeVisible()
      .withTimeout(timeout);
  },

  async takeTestScreenshot(name: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await device.takeScreenshot(`${name}-${timestamp}`);
  },

  async checkElementExists(elementId: string, shouldExist: boolean = true) {
    if (shouldExist) {
      await expect(element(by.id(elementId))).toBeVisible();
    } else {
      await expect(element(by.id(elementId))).not.toBeVisible();
    }
  },

  async typeText(elementId: string, text: string) {
    await element(by.id(elementId)).tap();
    await element(by.id(elementId)).typeText(text);
  },

  async clearAndType(elementId: string, text: string) {
    await element(by.id(elementId)).tap();
    await element(by.id(elementId)).clearText();
    await element(by.id(elementId)).typeText(text);
  },
};

// Test data for E2E scenarios
global.TestData = {
  validBarcodes: {
    california: 'validPDF417CaliforniaBarcode',
    texas: 'validPDF417TexasBarcode',
    newYork: 'validPDF417NewYorkBarcode',
  },

  invalidBarcodes: {
    malformed: 'invalidMalformedBarcode',
    wrongFormat: 'invalidWrongFormatBarcode',
    corrupted: 'invalidCorruptedBarcode',
  },

  expectedResults: {
    california: {
      firstName: 'JOHN',
      lastName: 'DOE',
      licenseNumber: 'D1234567',
      dateOfBirth: '01/15/1990',
    },
    texas: {
      firstName: 'JANE',
      lastName: 'SMITH',
      licenseNumber: 'T9876543',
      dateOfBirth: '03/22/1985',
    },
  },

  timeouts: {
    scanTimeout: 30000, // 30 seconds for scan timeout
    ocrFallback: 35000, // 35 seconds to activate OCR fallback
    processing: 5000, // 5 seconds for processing
    navigation: 3000, // 3 seconds for navigation
  },
};

console.log('🧪 E2E Test setup completed');
console.log(`📱 Platform: ${device.getPlatform()}`);
console.log(`🎯 Test environment ready`);
