/**
 * Memory Management Tests for FallbackController
 * Tests specifically for timer cleanup and resource management
 */

import { FallbackController } from '../FallbackController';
import type { FallbackControllerEvents } from '../FallbackController';

// Mock dependencies
jest.mock('../../index', () => {
  class MockScanError extends Error {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly recoverable: boolean;

    constructor(mockProps: any) {
      super(mockProps.message);
      this.name = 'ScanError';
      this.code = mockProps.code;
      this.userMessage = mockProps.userMessage;
      this.recoverable = mockProps.recoverable;
    }
  }

  return {
    scanLicense: jest.fn(),
    parseOCRText: jest.fn(),
    ScanError: MockScanError,
  };
});

jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../PerformanceMonitor', () => ({
  performanceMonitor: {
    startSession: jest.fn().mockReturnValue('session-id'),
    endSession: jest.fn().mockReturnValue({
      totalProcessingTime: 100,
      meetsOcrTarget: true,
      meetsFallbackTarget: true,
      meetsMemoryTarget: true,
      meetsCpuTarget: true,
    }),
    getRecentAlerts: jest.fn().mockReturnValue([]),
  },
}));

describe('FallbackController Memory Management', () => {
  let controller: FallbackController;
  let events: FallbackControllerEvents;

  beforeEach(() => {
    events = {
      onProgressUpdate: jest.fn(),
      onModeSwitch: jest.fn(),
      onMetricsUpdate: jest.fn(),
      onPerformanceAlert: jest.fn(),
    };

    controller = new FallbackController(
      {
        barcodeTimeoutMs: 100,
        ocrTimeoutMs: 100,
        maxFallbackProcessingTimeMs: 200,
      },
      events
    );
  });

  afterEach(() => {
    if (controller) {
      controller.destroy();
    }
  });

  describe('Timer Management', () => {
    test('should clean up all timers when destroyed', () => {
      // Access private property for testing
      const activeTimers = (controller as any)
        .activeTimers as Set<NodeJS.Timeout>;

      expect(activeTimers.size).toBe(1); // OCR processor preparation timer

      controller.destroy();

      expect(activeTimers.size).toBe(0);
    });

    test('should clean up timers when scan is cancelled', async () => {
      const activeTimers = (controller as any)
        .activeTimers as Set<NodeJS.Timeout>;

      // Start a scan that will create timers
      const scanPromise = controller.scan('test-data', 'barcode');

      // Cancel immediately
      controller.cancel();

      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(activeTimers.size).toBe(0);

      try {
        await scanPromise;
      } catch (error) {
        // Expected to throw due to cancellation
      }
    });

    test('should handle timer callback errors gracefully', async () => {
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Create a timer that will throw an error
      const createTimer = (controller as any).createTimer.bind(controller);

      createTimer(() => {
        throw new Error('Test error in timer callback');
      }, 10);

      // Wait for timer to execute
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should not crash the application
      expect(consoleSpy).not.toHaveBeenCalled(); // Logger handles the error

      consoleSpy.mockRestore();
    });

    test('should prevent timer execution after abort', async () => {
      let callbackExecuted = false;

      // Initialize abortController by starting a scan
      const scanPromise = controller.scan('test-data', 'barcode');

      const createTimer = (controller as any).createTimer.bind(controller);

      // Create a timer
      createTimer(() => {
        callbackExecuted = true;
      }, 50);

      // Abort controller
      const abortController = (controller as any).abortController;
      if (abortController) {
        abortController.abort();
      }

      // Wait for timer to potentially execute
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(callbackExecuted).toBe(false);

      // Clean up scan promise
      try {
        await scanPromise;
      } catch (error) {
        // Expected to fail
      }
    });
  });

  describe('Resource Cleanup', () => {
    test('should clear all references on destroy', () => {
      controller.destroy();

      expect((controller as any).events).toBeUndefined();
      expect((controller as any).abortController).toBeUndefined();
      expect((controller as any).currentState).toBe('idle');
      expect((controller as any).scanStartTime).toBe(0);
      expect((controller as any).barcodeAttempts).toBe(0);
      expect((controller as any)._ocrProcessorReady).toBe(false);
    });

    test('should handle destruction errors gracefully', () => {
      // Mock clearTimeout to throw an error
      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = jest.fn().mockImplementation(() => {
        throw new Error('Mock clearTimeout error');
      });

      // Should not throw
      expect(() => controller.destroy()).not.toThrow();

      // Restore
      global.clearTimeout = originalClearTimeout;
    });

    test('should be safe to call destroy multiple times', () => {
      expect(() => {
        controller.destroy();
        controller.destroy();
        controller.destroy();
      }).not.toThrow();
    });
  });

  describe('Memory Leak Prevention', () => {
    test('should not accumulate timers across multiple operations', async () => {
      const activeTimers = (controller as any)
        .activeTimers as Set<NodeJS.Timeout>;

      // Perform multiple operations
      for (let i = 0; i < 3; i++) {
        try {
          await controller.scan('test-data', 'barcode');
        } catch (error) {
          // Expected to fail with mocked dependencies
        }

        // Reset between operations
        (controller as any).reset();
      }

      // Should not have accumulated timers
      expect(activeTimers.size).toBeLessThanOrEqual(1); // Only OCR prep timer
    });

    test('should clean up timers on scan completion', async () => {
      const { scanLicense } = require('../../index');

      // Mock successful scan
      scanLicense.mockResolvedValueOnce({
        firstName: 'John',
        lastName: 'Doe',
        licenseNumber: 'D123456',
      });

      const activeTimers = (controller as any)
        .activeTimers as Set<NodeJS.Timeout>;
      const initialTimerCount = activeTimers.size;

      await controller.scan('test-data', 'barcode');

      // Should not have more timers than initially
      expect(activeTimers.size).toBeLessThanOrEqual(initialTimerCount);
    });
  });
});
