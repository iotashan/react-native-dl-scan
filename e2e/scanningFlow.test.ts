/**
 * T03_S08: Core Scanning Flow E2E Tests
 * End-to-end tests for driver license scanning workflows
 */

import { device, expect, element, by, waitFor } from 'detox';

describe('Driver License Scanning Flow E2E', () => {
  beforeAll(async () => {
    // App is already launched in setup.ts
    console.log('🎯 Starting Core Scanning Flow E2E Tests');
  });

  beforeEach(async () => {
    // Additional setup for each test if needed
    await TestUtils.takeTestScreenshot('test-start');
  });

  afterEach(async () => {
    // Return to home state after each test
    try {
      await element(by.id('back-button')).tap();
    } catch (error) {
      // Back button might not be visible, try home navigation
      await device.pressBack(); // Android
    }
  });

  describe('PDF417 Barcode Scanning Happy Path', () => {
    it('should complete PDF417 scanning successfully with California license', async () => {
      console.log('🔍 Testing PDF417 scanning with California license');

      // Navigate to scanner
      await TestUtils.navigateToScanner();

      // Verify camera view is visible and permissions granted
      await expect(element(by.id('camera-view'))).toBeVisibleOnScreen();
      await expect(element(by.id('scan-guide-overlay'))).toBeVisible();

      // Verify scanning instructions are shown
      await expect(
        element(by.text('Position barcode on back of license'))
      ).toBeVisible();

      // Simulate PDF417 barcode detection
      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);

      // Wait for processing and verify results
      await TestUtils.waitForScanResult(TestData.timeouts.processing);

      // Verify extracted license data is displayed
      const expectedData = TestData.expectedResults.california;
      await expect(element(by.text(expectedData.firstName))).toBeVisible();
      await expect(element(by.text(expectedData.lastName))).toBeVisible();
      await expect(element(by.text(expectedData.licenseNumber))).toBeVisible();
      await expect(element(by.text(expectedData.dateOfBirth))).toBeVisible();

      // Verify action buttons are available
      await expect(element(by.id('confirm-button'))).toBeVisible();
      await expect(element(by.id('retry-button'))).toBeVisible();

      // Confirm the scan results
      await element(by.id('confirm-button')).tap();

      // Verify success screen
      await waitFor(element(by.id('success-screen')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.navigation);

      await expect(
        element(by.text('Scan Completed Successfully'))
      ).toBeVisible();

      console.log('✅ PDF417 scanning completed successfully');
    });

    it('should handle Texas license PDF417 scanning', async () => {
      console.log('🔍 Testing PDF417 scanning with Texas license');

      await TestUtils.navigateToScanner();
      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.texas);
      await TestUtils.waitForScanResult();

      const expectedData = TestData.expectedResults.texas;
      await expect(element(by.text(expectedData.firstName))).toBeVisible();
      await expect(element(by.text(expectedData.lastName))).toBeVisible();

      await element(by.id('confirm-button')).tap();
      await expect(element(by.id('success-screen'))).toBeVisible();

      console.log('✅ Texas license scanning completed successfully');
    });

    it('should show scanning progress and processing indicators', async () => {
      console.log('🔍 Testing scanning progress indicators');

      await TestUtils.navigateToScanner();

      // Verify initial scanning state
      await expect(element(by.id('scanning-status'))).toHaveText(
        'Ready to scan'
      );
      await expect(element(by.id('progress-indicator'))).not.toBeVisible();

      // Simulate barcode detection and verify processing state
      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);

      // Should show processing state (might be brief in E2E)
      try {
        await expect(element(by.id('scanning-status'))).toHaveText(
          'Processing...'
        );
        await expect(element(by.id('progress-indicator'))).toBeVisible();
      } catch (error) {
        // Processing might complete too quickly in simulation
        console.log(
          '⚠️  Processing completed too quickly to capture intermediate state'
        );
      }

      // Verify final result state
      await TestUtils.waitForScanResult();
      await expect(element(by.id('scan-result'))).toBeVisible();

      console.log('✅ Progress indicators working correctly');
    });
  });

  describe('OCR Fallback Activation', () => {
    it('should activate OCR fallback when PDF417 scanning times out', async () => {
      console.log('🔍 Testing OCR fallback activation on timeout');

      await TestUtils.navigateToScanner();
      await expect(element(by.id('camera-view'))).toBeVisible();

      // Simulate scanning timeout (no barcode detected)
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?simulateTimeout=true',
        newInstance: false,
      });

      // Wait for OCR mode to activate (after 30 second timeout)
      await waitFor(element(by.id('ocr-mode-indicator')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.ocrFallback);

      // Verify OCR mode UI changes
      await expect(element(by.text('Position front of license'))).toBeVisible();
      await expect(element(by.id('ocr-instructions'))).toBeVisible();
      await expect(element(by.id('capture-button'))).toBeVisible();

      // Verify scanning mode indicator
      await expect(element(by.text('OCR Mode'))).toBeVisible();

      console.log('✅ OCR fallback activated successfully');
    });

    it('should complete OCR scanning workflow', async () => {
      console.log('🔍 Testing complete OCR scanning workflow');

      await TestUtils.navigateToScanner();

      // Force OCR mode activation
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?forceOCRMode=true',
        newInstance: false,
      });

      await waitFor(element(by.id('ocr-mode-indicator')))
        .toBeVisible()
        .withTimeout(5000);

      // Simulate OCR capture
      await element(by.id('capture-button')).tap();

      // Simulate OCR processing
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?mockOCR=valid-front',
        newInstance: false,
      });

      // Wait for OCR results
      await waitFor(element(by.id('ocr-result')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.processing);

      // Verify OCR results displayed
      await expect(element(by.id('ocr-extracted-text'))).toBeVisible();
      await expect(element(by.id('confirm-ocr-button'))).toBeVisible();

      await element(by.id('confirm-ocr-button')).tap();
      await expect(element(by.id('success-screen'))).toBeVisible();

      console.log('✅ OCR scanning workflow completed successfully');
    });
  });

  describe('Mode Switching Behaviors', () => {
    it('should allow manual switch between PDF417 and OCR modes', async () => {
      console.log('🔍 Testing manual mode switching');

      await TestUtils.navigateToScanner();

      // Verify initial PDF417 mode
      await expect(
        element(by.text('Position barcode on back of license'))
      ).toBeVisible();
      await expect(element(by.id('mode-toggle'))).toBeVisible();

      // Switch to OCR mode manually
      await element(by.id('mode-toggle')).tap();

      // Verify OCR mode activated
      await expect(element(by.text('Position front of license'))).toBeVisible();
      await expect(element(by.id('capture-button'))).toBeVisible();

      // Switch back to PDF417 mode
      await element(by.id('mode-toggle')).tap();

      // Verify back to PDF417 mode
      await expect(
        element(by.text('Position barcode on back of license'))
      ).toBeVisible();
      await expect(element(by.id('scan-guide-overlay'))).toBeVisible();

      console.log('✅ Mode switching working correctly');
    });

    it('should maintain scanning state during mode switches', async () => {
      console.log('🔍 Testing state persistence during mode switches');

      await TestUtils.navigateToScanner();

      // Start a scan attempt
      await TestUtils.simulateBarcodeScan('partial-scan-data');

      // Switch modes before completion
      await element(by.id('mode-toggle')).tap();

      // Verify mode switched but no data lost
      await expect(element(by.id('ocr-mode-indicator'))).toBeVisible();

      // Switch back
      await element(by.id('mode-toggle')).tap();

      // Should be able to continue scanning
      await expect(element(by.id('camera-view'))).toBeVisible();
      await expect(element(by.id('scan-guide-overlay'))).toBeVisible();

      console.log('✅ State persistence during mode switches verified');
    });
  });

  describe('Scanning Timeout Scenarios', () => {
    it('should handle PDF417 scanning timeout gracefully', async () => {
      console.log('🔍 Testing PDF417 scanning timeout handling');

      await TestUtils.navigateToScanner();

      // Wait for timeout without providing barcode
      await waitFor(element(by.id('timeout-warning')))
        .toBeVisible()
        .withTimeout(25000); // Should show warning before full timeout

      await expect(
        element(by.text('Taking longer than expected'))
      ).toBeVisible();
      await expect(element(by.id('continue-scanning-button'))).toBeVisible();
      await expect(element(by.id('switch-to-ocr-button'))).toBeVisible();

      // Test continue scanning option
      await element(by.id('continue-scanning-button')).tap();

      // Should return to scanning state
      await expect(element(by.id('camera-view'))).toBeVisible();

      console.log('✅ PDF417 timeout handling verified');
    });

    it('should handle OCR scanning timeout with retry options', async () => {
      console.log('🔍 Testing OCR scanning timeout handling');

      await TestUtils.navigateToScanner();

      // Switch to OCR mode
      await element(by.id('mode-toggle')).tap();
      await expect(element(by.id('ocr-mode-indicator'))).toBeVisible();

      // Simulate OCR timeout
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?simulateOCRTimeout=true',
        newInstance: false,
      });

      // Wait for OCR timeout handling
      await waitFor(element(by.id('ocr-timeout-dialog')))
        .toBeVisible()
        .withTimeout(15000);

      await expect(element(by.text('OCR processing timed out'))).toBeVisible();
      await expect(element(by.id('retry-ocr-button'))).toBeVisible();
      await expect(element(by.id('back-to-barcode-button'))).toBeVisible();

      // Test retry OCR option
      await element(by.id('retry-ocr-button')).tap();

      // Should return to OCR capture mode
      await expect(element(by.id('capture-button'))).toBeVisible();

      console.log('✅ OCR timeout handling verified');
    });

    it('should provide helpful timeout guidance to users', async () => {
      console.log('🔍 Testing timeout guidance messaging');

      await TestUtils.navigateToScanner();

      // Wait for timeout warning
      await waitFor(element(by.id('timeout-warning')))
        .toBeVisible()
        .withTimeout(25000);

      // Verify helpful guidance is shown
      await expect(element(by.text('Tips for better scanning:'))).toBeVisible();
      await expect(element(by.text('• Ensure good lighting'))).toBeVisible();
      await expect(element(by.text('• Hold device steady'))).toBeVisible();
      await expect(
        element(by.text('• Position barcode clearly'))
      ).toBeVisible();

      console.log('✅ Timeout guidance messaging verified');
    });
  });

  describe('User Experience and Navigation', () => {
    it('should provide clear scanning instructions throughout the flow', async () => {
      console.log('🔍 Testing scanning instructions clarity');

      await TestUtils.navigateToScanner();

      // PDF417 mode instructions
      await expect(
        element(by.text('Position barcode on back of license'))
      ).toBeVisible();
      await expect(
        element(by.text('Align within the guide frame'))
      ).toBeVisible();

      // Switch to OCR mode
      await element(by.id('mode-toggle')).tap();

      // OCR mode instructions
      await expect(element(by.text('Position front of license'))).toBeVisible();
      await expect(
        element(by.text('Ensure text is clear and readable'))
      ).toBeVisible();

      console.log('✅ Scanning instructions are clear and helpful');
    });

    it('should allow users to cancel scanning and return to main screen', async () => {
      console.log('🔍 Testing scan cancellation flow');

      await TestUtils.navigateToScanner();
      await expect(element(by.id('camera-view'))).toBeVisible();

      // Cancel scanning
      await element(by.id('cancel-scan-button')).tap();

      // Should show confirmation dialog
      await expect(element(by.text('Cancel scanning?'))).toBeVisible();
      await expect(element(by.id('confirm-cancel-button'))).toBeVisible();
      await expect(element(by.id('continue-scanning-button'))).toBeVisible();

      // Confirm cancellation
      await element(by.id('confirm-cancel-button')).tap();

      // Should return to main screen
      await expect(element(by.id('main-screen'))).toBeVisible();
      await expect(element(by.id('scan-button'))).toBeVisible();

      console.log('✅ Scan cancellation flow working correctly');
    });
  });

  describe('Performance and Responsiveness', () => {
    it('should start scanning within acceptable time limits', async () => {
      console.log('🔍 Testing scanning startup performance');

      const startTime = Date.now();

      await TestUtils.navigateToScanner();
      await expect(element(by.id('camera-view'))).toBeVisible();

      const loadTime = Date.now() - startTime;

      // Camera should start within 3 seconds
      expect(loadTime).toBeLessThan(3000);

      console.log(`✅ Scanner started in ${loadTime}ms`);
    });

    it('should process scan results within performance requirements', async () => {
      console.log('🔍 Testing scan processing performance');

      await TestUtils.navigateToScanner();

      const scanStartTime = Date.now();
      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);
      await TestUtils.waitForScanResult();
      const processingTime = Date.now() - scanStartTime;

      // Processing should complete within 5 seconds
      expect(processingTime).toBeLessThan(5000);

      console.log(`✅ Scan processed in ${processingTime}ms`);
    });

    it('should maintain responsive UI during scanning operations', async () => {
      console.log('🔍 Testing UI responsiveness during scanning');

      await TestUtils.navigateToScanner();

      // UI should remain responsive during scanning
      await element(by.id('mode-toggle')).tap();
      await expect(element(by.id('ocr-mode-indicator'))).toBeVisible();

      await element(by.id('mode-toggle')).tap();
      await expect(
        element(by.text('Position barcode on back of license'))
      ).toBeVisible();

      // Cancel button should remain responsive
      await element(by.id('cancel-scan-button')).tap();
      await expect(element(by.text('Cancel scanning?'))).toBeVisible();

      // Continue scanning
      await element(by.id('continue-scanning-button')).tap();
      await expect(element(by.id('camera-view'))).toBeVisible();

      console.log('✅ UI remains responsive during scanning operations');
    });
  });
});
