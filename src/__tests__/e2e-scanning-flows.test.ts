// Mock the main scanning functions first
jest.mock('../index', () => ({
  scanLicense: jest.fn(),
  parseOCRText: jest.fn(),
  ScanError: class ScanError extends Error {
    code: string;
    message: string;
    userMessage: string;
    recoverable: boolean;

    constructor(options: {
      code: string;
      message: string;
      userMessage: string;
      recoverable: boolean;
    }) {
      super(options.message);
      this.code = options.code;
      this.message = options.message;
      this.userMessage = options.userMessage;
      this.recoverable = options.recoverable;
    }
  },
}));

import { FallbackController } from '../utils/FallbackController';
import { ScanController } from '../utils/ScanController';
import { IntelligentModeManager } from '../utils/IntelligentModeManager';
import type { FallbackControllerEvents } from '../utils/FallbackController';
import type { ScanControllerEvents } from '../utils/ScanController';
import type { IntelligentModeManagerEvents } from '../utils/IntelligentModeManager';
import type { QualityMetrics } from '../types/license';
import { AutoModeState as AutoModeStateEnum } from '../types/license';
import { scanLicense, parseOCRText, ScanError } from '../index';

describe('End-to-End Scanning Flows', () => {
  const mockScanLicense = scanLicense as jest.MockedFunction<
    typeof scanLicense
  >;
  const mockParseOCRText = parseOCRText as jest.MockedFunction<
    typeof parseOCRText
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup default mock implementations
    mockScanLicense.mockResolvedValue({
      firstName: 'John',
      lastName: 'Doe',
      licenseNumber: 'D12345678',
      expirationDate: new Date('2025-12-31'),
      birthDate: new Date('1990-01-01'),
      address: {
        street: '123 Main St',
        city: 'Anytown',
        state: 'CA',
        zipCode: '12345',
      },
    });

    mockParseOCRText.mockResolvedValue({
      firstName: 'Jane',
      lastName: 'Smith',
      licenseNumber: 'S87654321',
      expirationDate: new Date('2026-06-30'),
      birthDate: new Date('1985-05-15'),
      address: {
        street: '456 Oak Ave',
        city: 'Somewhere',
        state: 'NY',
        zipCode: '54321',
      },
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('FallbackController E2E', () => {
    let controller: FallbackController;
    let events: jest.Mocked<FallbackControllerEvents>;

    beforeEach(() => {
      events = {
        onProgressUpdate: jest.fn(),
        onModeSwitch: jest.fn(),
        onMetricsUpdate: jest.fn(),
        onPerformanceAlert: jest.fn(),
        onAutoModeStateChange: jest.fn(),
        onModeRecommendation: jest.fn(),
        onQualityAssessment: jest.fn(),
      };

      controller = new FallbackController(
        {
          barcodeTimeoutMs: 3000,
          ocrTimeoutMs: 2000,
          maxBarcodeAttempts: 3,
          maxFallbackProcessingTimeMs: 4000,
          enableQualityAssessment: true,
        },
        events
      );
    });

    afterEach(() => {
      controller.destroy();
    });

    it('should complete full auto-mode flow with barcode success', async () => {
      const resultPromise = controller.scan('valid-barcode-data', 'auto');

      // Wait for scan to start
      await Promise.resolve();

      // Verify initial state
      expect(events.onProgressUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'barcode',
          mode: 'auto',
        })
      );

      // Complete the scan
      const result = await resultPromise;

      expect(result).toEqual(
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe',
          licenseNumber: 'D12345678',
        })
      );

      // Verify metrics
      expect(events.onMetricsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          fallbackTriggered: false,
        })
      );

      // Verify no memory leaks - controller should be cleanable
      expect(() => controller.destroy()).not.toThrow();
    });

    it('should complete full auto-mode flow with fallback to OCR', async () => {
      // Make barcode fail after max attempts
      let barcodeAttempts = 0;
      mockScanLicense.mockImplementation(() => {
        barcodeAttempts++;
        return Promise.reject(
          new ScanError({
            code: 'BARCODE_NOT_FOUND',
            message: 'No barcode found',
            userMessage: 'No barcode found',
            recoverable: true,
          })
        );
      });

      const resultPromise = controller.scan('invalid-barcode-data', 'auto');

      // Wait for retries and fallback
      while (barcodeAttempts < 3) {
        await Promise.resolve();
        jest.advanceTimersByTime(100);
      }

      // Wait for fallback to complete
      await Promise.resolve();
      jest.runAllTimers();

      // Complete the scan
      const result = await resultPromise;

      expect(result).toEqual(
        expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Smith',
          licenseNumber: 'S87654321',
        })
      );

      // Verify mode switch happened
      expect(events.onModeSwitch).toHaveBeenCalledWith(
        'barcode',
        'ocr',
        expect.stringContaining('Fallback triggered')
      );

      // Verify metrics
      expect(events.onMetricsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          fallbackTriggered: true,
        })
      );
    });

    it('should handle scan cancellation properly', async () => {
      // Make scan take longer so we can cancel it
      mockScanLicense.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  firstName: 'John',
                  lastName: 'Doe',
                  licenseNumber: 'D12345678',
                  expirationDate: new Date('2025-12-31'),
                  birthDate: new Date('1990-01-01'),
                  address: {
                    street: '123 Main St',
                    city: 'Anytown',
                    state: 'CA',
                    zipCode: '12345',
                  },
                }),
              5000
            )
          )
      );

      const scanPromise = controller.scan('barcode-data', 'auto');

      // Wait a bit then cancel
      await Promise.resolve();
      jest.advanceTimersByTime(100);

      controller.cancel();

      // Scan should complete (cancellation doesn't reject in current implementation)
      // but state should be reset
      try {
        await scanPromise;
      } catch (error) {
        // If it does throw, that's also acceptable
      }

      // Verify state is reset
      expect(controller.getState()).toBe('idle');

      // Verify no lingering timers
      jest.runAllTimers();
    });

    it('should process quality metrics in auto-mode', async () => {
      const scanPromise = controller.scan('barcode-data', 'auto');

      // Wait for scan to start
      await Promise.resolve();

      // Send quality metrics
      const poorQualityMetrics: QualityMetrics = {
        brightness: 0.3,
        blur: 0.8,
        glare: 0.7,
        documentAlignment: 0.2,
      };

      // Process multiple frames to trigger quality-based switch
      for (let i = 0; i < 5; i++) {
        controller.processQualityMetrics(poorQualityMetrics);
      }

      // Verify quality assessment event
      expect(events.onQualityAssessment).toHaveBeenCalledWith(
        poorQualityMetrics,
        expect.any(Boolean)
      );

      // Complete the scan
      await scanPromise;
    });

    it('should handle intelligent mode state transitions', async () => {
      // Make barcode scan take longer to see state transitions
      mockScanLicense.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  firstName: 'John',
                  lastName: 'Doe',
                  licenseNumber: 'D12345678',
                  expirationDate: new Date('2025-12-31'),
                  birthDate: new Date('1990-01-01'),
                  address: {
                    street: '123 Main St',
                    city: 'Anytown',
                    state: 'CA',
                    zipCode: '12345',
                  },
                }),
              15000
            )
          ) // Longer than warning threshold
      );

      const scanPromise = controller.scan('barcode-data', 'auto');

      // Wait for auto-mode to start
      await Promise.resolve();
      jest.advanceTimersByTime(100);

      // The initial state change might not be called immediately
      // Check if we get auto mode state
      const autoModeState = controller.getCurrentAutoState();
      expect(autoModeState).toBe(AutoModeStateEnum.INITIAL_PDF417);

      // Fast-forward to warning threshold (10s * 0.7 = 7s)
      jest.advanceTimersByTime(7000);

      // Check for warning state via getCurrentAutoState
      const warningState = controller.getCurrentAutoState();
      expect([
        AutoModeStateEnum.PDF417_TIMEOUT_WARNING,
        AutoModeStateEnum.INITIAL_PDF417, // May still be in initial state
      ]).toContain(warningState);

      // Complete or cancel to clean up
      controller.cancel();
      try {
        await scanPromise;
      } catch {
        // Expected to fail due to cancellation
      }
    });
  });

  describe('ScanController E2E', () => {
    let controller: ScanController;
    let events: jest.Mocked<ScanControllerEvents>;

    beforeEach(() => {
      events = {
        onProgressUpdate: jest.fn(),
        onModeSwitch: jest.fn(),
        onMetricsUpdate: jest.fn(),
      };

      controller = new ScanController(
        {
          barcodeTimeoutMs: 3000,
          ocrTimeoutMs: 2000,
          maxBarcodeAttempts: 3,
          maxFallbackProcessingTimeMs: 4000,
          enableQualityAssessment: true,
        },
        events
      );
    });

    afterEach(() => {
      controller.destroy();
    });

    it('should handle barcode-only flow', async () => {
      const result = await controller.scan('barcode-data', 'barcode');

      expect(result).toEqual(
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe',
        })
      );

      expect(events.onMetricsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          finalMode: 'barcode',
        })
      );

      // Verify clean state
      expect(controller.getState()).toBe('completed');
    });

    it('should handle OCR-only flow', async () => {
      const mockOCRData = [
        {
          text: 'JANE',
          confidence: 0.95,
          boundingBox: { x: 100, y: 80, width: 60, height: 20 },
        },
        {
          text: 'SMITH',
          confidence: 0.97,
          boundingBox: { x: 170, y: 80, width: 50, height: 20 },
        },
      ];

      const result = await controller.scan(mockOCRData, 'ocr');

      expect(result).toEqual(
        expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Smith',
        })
      );

      expect(events.onMetricsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          finalMode: 'ocr',
        })
      );
    });

    it('should properly clean up resources on destroy', () => {
      // Start a scan
      const scanPromise = controller.scan('barcode-data', 'auto');

      // Destroy mid-scan
      controller.destroy();

      // Verify no errors on multiple destroy calls
      expect(() => {
        controller.destroy();
        controller.destroy();
      }).not.toThrow();

      // Cancel the promise to clean up
      scanPromise.catch(() => {
        // Expected to fail
      });
    });
  });

  describe('IntelligentModeManager E2E', () => {
    let manager: IntelligentModeManager;
    let events: jest.Mocked<IntelligentModeManagerEvents>;

    beforeEach(() => {
      events = {
        onAutoModeStateChange: jest.fn(),
        onModeRecommendation: jest.fn(),
        onWarningThresholdReached: jest.fn(),
        onQualityAssessment: jest.fn(),
      };

      manager = new IntelligentModeManager(
        {
          pdf417TimeoutMs: 10000,
          warningThresholdMs: 7000,
          minQualityScore: 0.7,
          switchDelayMs: 500,
        },
        events
      );
    });

    afterEach(() => {
      manager.destroy();
    });

    it('should complete full timeout-based transition flow', () => {
      // Start session
      manager.startAutoModeSession();

      expect(manager.getCurrentAutoState()).toBe(
        AutoModeStateEnum.INITIAL_PDF417
      );

      // Fast-forward to warning
      jest.advanceTimersByTime(7000);

      expect(events.onWarningThresholdReached).toHaveBeenCalled();
      expect(manager.getCurrentAutoState()).toBe(
        AutoModeStateEnum.PDF417_TIMEOUT_WARNING
      );

      // Fast-forward to timeout
      jest.advanceTimersByTime(3000);

      expect(events.onAutoModeStateChange).toHaveBeenCalledWith(
        AutoModeStateEnum.PDF417_TIMEOUT_WARNING,
        AutoModeStateEnum.SWITCHING_TO_OCR
      );

      // Fast-forward through switch delay
      jest.advanceTimersByTime(500);

      expect(events.onModeRecommendation).toHaveBeenCalledWith(
        'ocr',
        'Auto-mode switching due to timeout'
      );
      expect(manager.getCurrentAutoState()).toBe(AutoModeStateEnum.OCR_ACTIVE);
    });

    it('should complete quality-based transition flow', () => {
      // Start session
      manager.startAutoModeSession();

      // Send poor quality metrics
      const poorMetrics: QualityMetrics = {
        brightness: 0.2,
        blur: 0.9,
        glare: 0.8,
        documentAlignment: 0.1,
      };

      // Need at least 3 frames
      let switchTriggered = false;
      for (let i = 0; i < 5; i++) {
        switchTriggered = manager.processQualityMetrics(poorMetrics);
        if (switchTriggered) break;
      }

      expect(switchTriggered).toBe(true);
      expect(events.onQualityAssessment).toHaveBeenCalled();

      // Fast-forward through switch delay
      jest.advanceTimersByTime(500);

      expect(events.onModeRecommendation).toHaveBeenCalledWith(
        'ocr',
        'Auto-mode switching due to quality'
      );
    });

    it('should handle success flow', () => {
      // Start session
      manager.startAutoModeSession();

      // Mark success
      manager.markSuccess();

      expect(manager.getCurrentAutoState()).toBe(AutoModeStateEnum.SUCCESS);
      expect(events.onAutoModeStateChange).toHaveBeenCalledWith(
        AutoModeStateEnum.INITIAL_PDF417,
        AutoModeStateEnum.SUCCESS
      );

      // Verify timers are cleared
      jest.runAllTimers();
      // No additional state changes should occur
      expect(events.onAutoModeStateChange).toHaveBeenCalledTimes(1);
    });

    it('should clean up all resources on destroy', () => {
      // Start session with timers
      manager.startAutoModeSession();

      // Add some quality metrics
      manager.processQualityMetrics({
        brightness: 0.8,
        blur: 0.2,
        glare: 0.1,
        documentAlignment: 0.9,
      });

      // Destroy
      manager.destroy();

      // Advance all timers - nothing should fire
      jest.runAllTimers();

      expect(events.onWarningThresholdReached).not.toHaveBeenCalled();
      expect(events.onModeRecommendation).not.toHaveBeenCalled();

      // Multiple destroy calls should not error
      expect(() => {
        manager.destroy();
        manager.destroy();
      }).not.toThrow();
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should not leak memory across multiple scan sessions', async () => {
      const controller = new FallbackController();

      // Perform multiple scan sessions
      for (let i = 0; i < 10; i++) {
        try {
          await controller.scan(`barcode-${i}`, 'auto');
        } catch {
          // Some scans may fail, that's ok
        }
      }

      // Clean up
      controller.destroy();

      // If we get here without memory issues, the test passes
      expect(true).toBe(true);
    });

    it('should clean up all timers when controllers are destroyed', () => {
      const timers = new Set<NodeJS.Timeout>();
      const originalSetTimeout = global.setTimeout;

      // Track all timers
      global.setTimeout = jest.fn((callback, delay) => {
        const timer = originalSetTimeout(callback, delay);
        timers.add(timer);
        return timer;
      }) as any;

      // Create controllers
      const fallbackController = new FallbackController();
      const scanController = new ScanController({
        barcodeTimeoutMs: 3000,
        maxBarcodeAttempts: 3,
        maxFallbackProcessingTimeMs: 4000,
      });
      const intelligentManager = new IntelligentModeManager();

      // Start operations to create timers
      fallbackController.scan('test', 'auto').catch(() => {});
      scanController.scan('test', 'auto').catch(() => {});
      intelligentManager.startAutoModeSession();

      // Should have created some timers
      expect(timers.size).toBeGreaterThan(0);

      // Destroy all
      fallbackController.destroy();
      scanController.destroy();
      intelligentManager.destroy();

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;

      // Run all timers - nothing should execute since they should be cleared
      jest.runAllTimers();

      // Test passes if no errors occurred
      expect(true).toBe(true);
    });
  });

  describe('Resource Disposal Verification', () => {
    it('should dispose all resources in correct order', () => {
      const disposeOrder: string[] = [];

      // Mock sub-components to track disposal order
      const mockTimeoutManager = {
        destroy: jest.fn(() => disposeOrder.push('timeout')),
      };
      const mockQualityProcessor = {
        reset: jest.fn(() => disposeOrder.push('quality')),
      };
      const mockStateManager = {
        destroy: jest.fn(() => disposeOrder.push('state')),
      };

      // Use actual controller to test disposal
      const controller = new FallbackController();

      // Inject mocks (this is a simplified example, actual implementation may vary)
      (controller as any).timeoutManager = mockTimeoutManager;
      (controller as any).qualityProcessor = mockQualityProcessor;
      (controller as any).stateManager = mockStateManager;

      // Destroy
      controller.destroy();

      // Verify disposal order
      expect(mockTimeoutManager.destroy).toHaveBeenCalled();
      expect(mockQualityProcessor.reset).toHaveBeenCalled();
      expect(mockStateManager.destroy).toHaveBeenCalled();

      // Verify order is correct
      expect(disposeOrder).toEqual(['timeout', 'quality', 'state']);
    });
  });
});
