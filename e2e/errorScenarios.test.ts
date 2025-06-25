/**
 * T03_S08: Error Scenario E2E Tests
 * End-to-end tests for error handling and recovery scenarios
 */

import { device, expect, element, by, waitFor } from 'detox';

describe('Error Handling Scenarios E2E', () => {
  beforeAll(async () => {
    console.log('🚨 Starting Error Scenario E2E Tests');
  });

  beforeEach(async () => {
    await TestUtils.takeTestScreenshot('error-test-start');
  });

  afterEach(async () => {
    // Clean up any error states
    try {
      await device.terminateApp();
      await device.launchApp({ permissions: { camera: 'YES' } });
    } catch (error) {
      console.warn('Error during test cleanup:', error);
    }
  });

  describe('Camera Permission Denial', () => {
    it('should handle camera permission denial gracefully', async () => {
      console.log('🚨 Testing camera permission denial');

      // Launch app without camera permission
      await device.terminateApp();
      await device.launchApp({
        permissions: { camera: 'NO' },
        newInstance: true,
      });

      // Try to navigate to scanner
      await element(by.id('scan-button')).tap();

      // Should show permission error immediately
      await waitFor(element(by.id('permission-error')))
        .toBeVisible()
        .withTimeout(3000);

      // Verify error message content
      await expect(element(by.text('Camera Access Required'))).toBeVisible();
      await expect(
        element(by.text('This app needs camera access to scan driver licenses'))
      ).toBeVisible();

      // Verify action buttons
      await expect(element(by.id('open-settings-button'))).toBeVisible();
      await expect(element(by.id('cancel-button'))).toBeVisible();

      // Test settings navigation (can't fully test settings, but verify attempt)
      await element(by.id('open-settings-button')).tap();

      // Note: In E2E, we can't fully test the Settings app,
      // but we can verify the intent to open settings
      console.log('✅ Settings navigation attempted');

      // Return to app and test cancel
      await device.launchApp({ newInstance: false });
      await element(by.id('cancel-button')).tap();

      // Should return to main screen
      await expect(element(by.id('main-screen'))).toBeVisible();

      console.log('✅ Camera permission denial handled correctly');
    });

    it('should retry camera access after permission granted', async () => {
      console.log('🚨 Testing camera permission retry flow');

      // Start with denied permission
      await device.terminateApp();
      await device.launchApp({
        permissions: { camera: 'NO' },
        newInstance: true,
      });

      await element(by.id('scan-button')).tap();
      await expect(element(by.id('permission-error'))).toBeVisible();

      // Simulate permission being granted (restart with permission)
      await device.terminateApp();
      await device.launchApp({
        permissions: { camera: 'YES' },
        newInstance: true,
      });

      // Try scanning again
      await element(by.id('scan-button')).tap();

      // Should now access camera successfully
      await expect(element(by.id('camera-view'))).toBeVisible();
      await expect(element(by.id('scan-guide-overlay'))).toBeVisible();

      console.log('✅ Camera permission retry flow working');
    });

    it('should provide clear guidance for permission issues', async () => {
      console.log('🚨 Testing permission guidance messaging');

      await device.terminateApp();
      await device.launchApp({
        permissions: { camera: 'NO' },
        newInstance: true,
      });

      await element(by.id('scan-button')).tap();
      await expect(element(by.id('permission-error'))).toBeVisible();

      // Verify detailed guidance
      await expect(
        element(by.text('How to enable camera access:'))
      ).toBeVisible();
      await expect(element(by.text('1. Tap "Open Settings"'))).toBeVisible();
      await expect(
        element(by.text('2. Find this app in the list'))
      ).toBeVisible();
      await expect(
        element(by.text('3. Toggle Camera permission ON'))
      ).toBeVisible();
      await expect(element(by.text('4. Return to this app'))).toBeVisible();

      console.log('✅ Permission guidance is clear and helpful');
    });
  });

  describe('Poor Lighting Conditions', () => {
    it('should detect and warn about poor lighting conditions', async () => {
      console.log('🚨 Testing poor lighting detection');

      // Launch app with simulated low light conditions
      await device.launchApp({
        permissions: { camera: 'YES' },
        launchArgs: { simulateLowLight: true },
      });

      await TestUtils.navigateToScanner();

      // Wait for lighting analysis
      await waitFor(element(by.id('lighting-warning')))
        .toBeVisible()
        .withTimeout(5000);

      // Verify warning content
      await expect(element(by.text('Poor Lighting Detected'))).toBeVisible();
      await expect(
        element(by.text('For best results, move to better lighting'))
      ).toBeVisible();

      // Verify suggestions
      await expect(
        element(by.text('• Move closer to a light source'))
      ).toBeVisible();
      await expect(
        element(by.text('• Avoid shadows on the license'))
      ).toBeVisible();
      await expect(
        element(by.text('• Try turning on device flashlight'))
      ).toBeVisible();

      // Test flashlight toggle
      await expect(element(by.id('toggle-flashlight'))).toBeVisible();
      await element(by.id('toggle-flashlight')).tap();

      // Verify flashlight activated
      await expect(element(by.text('Flashlight ON'))).toBeVisible();

      console.log('✅ Poor lighting detection and guidance working');
    });

    it('should continue scanning despite lighting warnings', async () => {
      console.log('🚨 Testing scanning continuation with lighting warning');

      await device.launchApp({
        permissions: { camera: 'YES' },
        launchArgs: { simulateLowLight: true },
      });

      await TestUtils.navigateToScanner();
      await waitFor(element(by.id('lighting-warning')))
        .toBeVisible()
        .withTimeout(5000);

      // Dismiss warning and continue
      await element(by.id('continue-anyway-button')).tap();

      // Should still be able to scan
      await expect(element(by.id('camera-view'))).toBeVisible();
      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);
      await TestUtils.waitForScanResult();

      // Should process successfully despite lighting warning
      await expect(element(by.id('scan-result'))).toBeVisible();

      console.log('✅ Scanning continues despite lighting warnings');
    });

    it('should auto-dismiss lighting warnings when conditions improve', async () => {
      console.log('🚨 Testing automatic lighting warning dismissal');

      await device.launchApp({
        permissions: { camera: 'YES' },
        launchArgs: { simulateLowLight: true },
      });

      await TestUtils.navigateToScanner();
      await waitFor(element(by.id('lighting-warning')))
        .toBeVisible()
        .withTimeout(5000);

      // Simulate lighting improvement
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?improveLighting=true',
        newInstance: false,
      });

      // Warning should auto-dismiss
      await waitFor(element(by.id('lighting-warning')))
        .not.toBeVisible()
        .withTimeout(3000);

      await expect(element(by.id('camera-view'))).toBeVisible();

      console.log('✅ Lighting warnings auto-dismiss when conditions improve');
    });
  });

  describe('Invalid Barcode Handling', () => {
    it('should handle malformed barcode data gracefully', async () => {
      console.log('🚨 Testing malformed barcode handling');

      await TestUtils.navigateToScanner();

      // Simulate malformed barcode
      await TestUtils.simulateBarcodeScan(TestData.invalidBarcodes.malformed);

      // Should show error message
      await waitFor(element(by.id('scan-error')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.processing);

      await expect(element(by.text('Invalid Barcode Format'))).toBeVisible();
      await expect(
        element(
          by.text('The scanned barcode is not a valid driver license format')
        )
      ).toBeVisible();

      // Verify retry options
      await expect(element(by.id('retry-scan-button'))).toBeVisible();
      await expect(element(by.id('try-ocr-button'))).toBeVisible();

      // Test retry scanning
      await element(by.id('retry-scan-button')).tap();

      // Should return to scanning state
      await expect(element(by.id('camera-view'))).toBeVisible();
      await expect(element(by.id('scan-guide-overlay'))).toBeVisible();

      console.log('✅ Malformed barcode handled gracefully');
    });

    it('should handle wrong barcode format (non-PDF417)', async () => {
      console.log('🚨 Testing wrong barcode format handling');

      await TestUtils.navigateToScanner();

      // Simulate wrong format barcode (e.g., QR code)
      await TestUtils.simulateBarcodeScan(TestData.invalidBarcodes.wrongFormat);

      await waitFor(element(by.id('scan-error')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('Incorrect Barcode Type'))).toBeVisible();
      await expect(
        element(
          by.text('Please scan the PDF417 barcode on the back of the license')
        )
      ).toBeVisible();

      // Verify helpful guidance
      await expect(
        element(by.text('Look for the rectangular barcode, not QR codes'))
      ).toBeVisible();

      // Test automatic retry
      await element(by.id('understood-button')).tap();
      await expect(element(by.id('camera-view'))).toBeVisible();

      console.log('✅ Wrong barcode format handled appropriately');
    });

    it('should handle corrupted barcode data', async () => {
      console.log('🚨 Testing corrupted barcode data handling');

      await TestUtils.navigateToScanner();

      // Simulate corrupted barcode
      await TestUtils.simulateBarcodeScan(TestData.invalidBarcodes.corrupted);

      await waitFor(element(by.id('scan-error')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('Barcode Read Error'))).toBeVisible();
      await expect(
        element(by.text('Unable to read barcode clearly'))
      ).toBeVisible();

      // Verify suggestions for improvement
      await expect(element(by.text('Tips for better scanning:'))).toBeVisible();
      await expect(
        element(by.text('• Clean the license surface'))
      ).toBeVisible();
      await expect(element(by.text('• Improve lighting'))).toBeVisible();
      await expect(element(by.text('• Hold device steadier'))).toBeVisible();

      // Test OCR fallback option
      await element(by.id('try-ocr-button')).tap();

      // Should switch to OCR mode
      await expect(element(by.id('ocr-mode-indicator'))).toBeVisible();
      await expect(element(by.text('Position front of license'))).toBeVisible();

      console.log('✅ Corrupted barcode data handled with fallback');
    });

    it('should handle multiple consecutive scan failures', async () => {
      console.log('🚨 Testing multiple consecutive scan failures');

      await TestUtils.navigateToScanner();

      // First failure
      await TestUtils.simulateBarcodeScan(TestData.invalidBarcodes.malformed);
      await waitFor(element(by.id('scan-error')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('retry-scan-button')).tap();

      // Second failure
      await TestUtils.simulateBarcodeScan(TestData.invalidBarcodes.corrupted);
      await waitFor(element(by.id('scan-error')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('retry-scan-button')).tap();

      // Third failure - should offer enhanced guidance
      await TestUtils.simulateBarcodeScan(TestData.invalidBarcodes.wrongFormat);
      await waitFor(element(by.id('scan-error')))
        .toBeVisible()
        .withTimeout(5000);

      // Should show enhanced guidance after multiple failures
      await expect(element(by.text('Having trouble scanning?'))).toBeVisible();
      await expect(element(by.id('enhanced-help-button'))).toBeVisible();
      await expect(element(by.id('contact-support-button'))).toBeVisible();

      console.log(
        '✅ Multiple consecutive failures handled with enhanced guidance'
      );
    });
  });

  describe('Network Failure Scenarios', () => {
    it('should handle network connectivity issues during processing', async () => {
      console.log('🚨 Testing network connectivity issues');

      await TestUtils.navigateToScanner();

      // Simulate network failure during scan processing
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?simulateNetworkError=true',
        newInstance: false,
      });

      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);

      // Should show network error
      await waitFor(element(by.id('network-error')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.processing + 2000);

      await expect(element(by.text('Network Connection Error'))).toBeVisible();
      await expect(
        element(by.text('Unable to process scan due to network issues'))
      ).toBeVisible();

      // Verify retry options
      await expect(element(by.id('retry-with-network-button'))).toBeVisible();
      await expect(element(by.id('save-offline-button'))).toBeVisible();

      console.log('✅ Network connectivity issues handled gracefully');
    });

    it('should offer offline processing when network is unavailable', async () => {
      console.log('🚨 Testing offline processing fallback');

      await TestUtils.navigateToScanner();

      // Simulate network unavailable
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?networkUnavailable=true',
        newInstance: false,
      });

      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);

      await waitFor(element(by.id('offline-processing-dialog')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('Process Offline?'))).toBeVisible();
      await expect(
        element(by.text('Network unavailable. Process scan locally?'))
      ).toBeVisible();

      // Test offline processing
      await element(by.id('process-offline-button')).tap();

      // Should proceed with local processing
      await waitFor(element(by.id('scan-result')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.processing);

      // Should show offline indicator
      await expect(element(by.id('offline-indicator'))).toBeVisible();
      await expect(element(by.text('Processed Offline'))).toBeVisible();

      console.log('✅ Offline processing works as fallback');
    });

    it('should queue scans for retry when network returns', async () => {
      console.log('🚨 Testing scan queueing for network retry');

      await TestUtils.navigateToScanner();

      // Process scan offline due to network issues
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?networkUnavailable=true',
        newInstance: false,
      });

      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);
      await waitFor(element(by.id('offline-processing-dialog')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('process-offline-button')).tap();
      await waitFor(element(by.id('scan-result')))
        .toBeVisible()
        .withTimeout(5000);

      // Simulate network return
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?networkRestored=true',
        newInstance: false,
      });

      // Should offer to sync/retry
      await waitFor(element(by.id('sync-notification')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('Network Restored'))).toBeVisible();
      await expect(element(by.text('Sync offline scans?'))).toBeVisible();
      await expect(element(by.id('sync-now-button'))).toBeVisible();

      console.log('✅ Scan queueing and sync on network restore working');
    });

    it('should handle API service unavailability', async () => {
      console.log('🚨 Testing API service unavailability');

      await TestUtils.navigateToScanner();

      // Simulate API service down
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?serviceUnavailable=true',
        newInstance: false,
      });

      await TestUtils.simulateBarcodeScan(TestData.validBarcodes.california);

      await waitFor(element(by.id('service-error')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.processing + 2000);

      await expect(
        element(by.text('Service Temporarily Unavailable'))
      ).toBeVisible();
      await expect(
        element(by.text('Our scanning service is temporarily down'))
      ).toBeVisible();

      // Should offer local processing
      await expect(element(by.id('use-local-processing-button'))).toBeVisible();
      await expect(element(by.id('try-again-later-button'))).toBeVisible();

      // Test local processing fallback
      await element(by.id('use-local-processing-button')).tap();

      await waitFor(element(by.id('scan-result')))
        .toBeVisible()
        .withTimeout(TestData.timeouts.processing);

      console.log('✅ API service unavailability handled with local fallback');
    });
  });

  describe('System-Level Error Recovery', () => {
    it('should recover from app crashes during scanning', async () => {
      console.log('🚨 Testing recovery from app crashes');

      await TestUtils.navigateToScanner();

      // Simulate app crash
      await device.terminateApp();
      await device.launchApp({
        permissions: { camera: 'YES' },
        newInstance: true,
      });

      // Should detect crash recovery
      await waitFor(element(by.id('crash-recovery-dialog')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(
        element(by.text('Unexpected Restart Detected'))
      ).toBeVisible();
      await expect(element(by.text('Resume previous scan?'))).toBeVisible();

      // Test resume option
      await element(by.id('resume-scan-button')).tap();

      // Should return to scanner
      await expect(element(by.id('camera-view'))).toBeVisible();

      console.log('✅ App crash recovery working');
    });

    it('should handle device memory pressure gracefully', async () => {
      console.log('🚨 Testing device memory pressure handling');

      await TestUtils.navigateToScanner();

      // Simulate memory pressure
      await device.sendToHome();
      await device.launchApp({
        url: 'rndlscan://test?simulateMemoryPressure=true',
        newInstance: false,
      });

      // Should handle memory pressure
      await waitFor(element(by.id('memory-warning')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('Device Memory Low'))).toBeVisible();
      await expect(
        element(by.text('Close other apps for better performance'))
      ).toBeVisible();

      // Should continue functioning
      await element(by.id('continue-button')).tap();
      await expect(element(by.id('camera-view'))).toBeVisible();

      console.log('✅ Memory pressure handled gracefully');
    });

    it('should provide appropriate error reporting options', async () => {
      console.log('🚨 Testing error reporting functionality');

      await TestUtils.navigateToScanner();

      // Trigger a reportable error
      await TestUtils.simulateBarcodeScan('trigger-unknown-error');

      await waitFor(element(by.id('unknown-error')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.text('Unexpected Error'))).toBeVisible();
      await expect(element(by.id('report-error-button'))).toBeVisible();
      await expect(element(by.id('contact-support-button'))).toBeVisible();

      // Test error reporting
      await element(by.id('report-error-button')).tap();

      await expect(element(by.text('Error Report Sent'))).toBeVisible();
      await expect(
        element(by.text('Thank you for helping us improve'))
      ).toBeVisible();

      console.log('✅ Error reporting functionality working');
    });
  });
});
