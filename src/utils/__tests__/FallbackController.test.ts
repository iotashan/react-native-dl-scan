import { FallbackController } from '../FallbackController';
import type { FallbackControllerEvents } from '../FallbackController';
import type { OCRTextObservation, FallbackConfig } from '../../types/license';

// Mock the scanner functions first
jest.mock('../../index', () => {
  // Mock the ScanError class properly
  class MockScanError extends Error {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly recoverable: boolean;

    constructor(error: {
      code: string;
      message: string;
      userMessage: string;
      recoverable: boolean;
    }) {
      super(error.message);
      this.name = 'ScanError';
      this.code = error.code;
      this.userMessage = error.userMessage;
      this.recoverable = error.recoverable;
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
    startTimer: jest.fn(),
    stopTimer: jest.fn().mockReturnValue(100), // Mock returns 100ms elapsed time
    clearPerformanceMetrics: jest.fn(),
    getPerformanceMetrics: jest.fn().mockReturnValue({}),
    trackMemory: jest.fn(),
    enforceMemoryLimit: jest.fn(),
    measureTime: jest.fn().mockImplementation(async (_name, fn) => await fn()),
    withRetry: jest
      .fn()
      .mockImplementation(async (_operation, fn) => await fn()),
  },
}));

import { scanLicense, parseOCRText, ScanError } from '../../index';

const mockScanLicense = scanLicense as jest.MockedFunction<typeof scanLicense>;
const mockParseOCRText = parseOCRText as jest.MockedFunction<
  typeof parseOCRText
>;

describe('FallbackController', () => {
  let controller: FallbackController;
  let events: FallbackControllerEvents;

  const mockLicenseData = {
    firstName: 'John',
    lastName: 'Doe',
    licenseNumber: 'D12345678',
    address: {
      street: '123 Main St',
      city: 'Anytown',
      state: 'CA',
      postalCode: '12345',
    },
  };

  const mockOCRData: OCRTextObservation[] = [
    {
      text: 'JOHN',
      confidence: 0.98,
      boundingBox: { x: 100, y: 80, width: 60, height: 20 },
    },
    {
      text: 'DOE',
      confidence: 0.97,
      boundingBox: { x: 170, y: 80, width: 50, height: 20 },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    events = {
      onProgressUpdate: jest.fn(),
      onModeSwitch: jest.fn(),
      onMetricsUpdate: jest.fn(),
    };

    controller = new FallbackController({}, events);
  });

  afterEach(() => {
    // Clean up any timers or intervals
    controller.cancel();
    jest.clearAllTimers();
  });

  describe('Configuration', () => {
    test('should use default configuration when none provided', () => {
      const config = controller.getConfig();

      expect(config.barcodeTimeoutMs).toBe(3000);
      expect(config.maxBarcodeAttempts).toBe(5);
      expect(config.maxFallbackProcessingTimeMs).toBe(4000);
      expect(config.enableQualityAssessment).toBe(true);
    });

    test('should accept custom configuration', () => {
      const customConfig: Partial<FallbackConfig> = {
        barcodeTimeoutMs: 5000,
        maxBarcodeAttempts: 3,
      };

      const customController = new FallbackController(customConfig);
      const config = customController.getConfig();

      expect(config.barcodeTimeoutMs).toBe(5000);
      expect(config.maxBarcodeAttempts).toBe(3);
      expect(config.maxFallbackProcessingTimeMs).toBe(4000); // Should keep default
    });

    test('should update configuration at runtime', () => {
      const newConfig: Partial<FallbackConfig> = {
        barcodeTimeoutMs: 2000,
      };

      controller.updateConfig(newConfig);
      const config = controller.getConfig();

      expect(config.barcodeTimeoutMs).toBe(2000);
    });
  });

  describe('Barcode scanning', () => {
    test('should successfully scan barcode in barcode mode', async () => {
      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      const result = await controller.scan('mock-barcode-data', 'barcode');

      expect(result).toEqual(mockLicenseData);
      expect(mockScanLicense).toHaveBeenCalledWith('mock-barcode-data');
      expect(events.onProgressUpdate).toHaveBeenCalled();
      expect(events.onMetricsUpdate).toHaveBeenCalled();
    });

    test('should fail gracefully when barcode scanning fails in barcode mode', async () => {
      const scanError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      mockScanLicense.mockRejectedValueOnce(scanError);

      await expect(
        controller.scan('invalid-barcode', 'barcode')
      ).rejects.toThrow('Invalid barcode format');
    });
  });

  describe('OCR scanning', () => {
    test('should successfully scan OCR in OCR mode', async () => {
      mockParseOCRText.mockResolvedValueOnce(mockLicenseData);

      const result = await controller.scan(mockOCRData, 'ocr');

      expect(result).toEqual(mockLicenseData);
      expect(mockParseOCRText).toHaveBeenCalledWith(mockOCRData);
      expect(events.onProgressUpdate).toHaveBeenCalled();
    });

    test('should fail gracefully when OCR scanning fails', async () => {
      const ocrError = new ScanError({
        code: 'OCR_PARSING_ERROR',
        message: 'OCR parsing failed',
        userMessage: 'Unable to read license text',
        recoverable: true,
      });

      mockParseOCRText.mockRejectedValueOnce(ocrError);

      await expect(controller.scan(mockOCRData, 'ocr')).rejects.toThrow(
        'OCR parsing failed'
      );
    });
  });

  describe('Automatic fallback', () => {
    test('should fallback to OCR when barcode scanning fails', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      mockScanLicense.mockRejectedValueOnce(barcodeError);
      mockParseOCRText.mockResolvedValueOnce(mockLicenseData);

      const result = await controller.scan('invalid-barcode', 'auto');

      expect(result).toEqual(mockLicenseData);
      expect(mockScanLicense).toHaveBeenCalledWith('invalid-barcode');
      expect(mockParseOCRText).toHaveBeenCalled();
      expect(events.onModeSwitch).toHaveBeenCalledWith(
        'barcode',
        'ocr',
        'Fallback triggered: failure'
      );
    });

    test('should fallback to OCR on timeout', async () => {
      // Mock a slow barcode scan that exceeds timeout
      mockScanLicense.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(
                new ScanError({
                  code: 'TIMEOUT_ERROR',
                  message: 'Barcode scan timeout',
                  userMessage: 'Barcode scan took too long',
                  recoverable: true,
                })
              );
            }, 100);
          })
      );

      mockParseOCRText.mockResolvedValueOnce(mockLicenseData);

      // Configure shorter timeout for testing
      controller.updateConfig({ barcodeTimeoutMs: 50 });

      const result = await controller.scan('slow-barcode', 'auto');

      expect(result).toEqual(mockLicenseData);
      expect(events.onModeSwitch).toHaveBeenCalled();
    }, 10000);

    test('should not fallback when not in auto mode', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      mockScanLicense.mockRejectedValueOnce(barcodeError);

      await expect(
        controller.scan('invalid-barcode', 'barcode')
      ).rejects.toThrow('Invalid barcode format');

      expect(mockParseOCRText).not.toHaveBeenCalled();
      expect(events.onModeSwitch).not.toHaveBeenCalled();
    });

    test('should not fallback when remaining time is insufficient', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      // Configure very short total time limit
      controller.updateConfig({ maxFallbackProcessingTimeMs: 100 });

      // Mock delay to simulate elapsed time
      mockScanLicense.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(barcodeError), 95);
          })
      );

      await expect(controller.scan('slow-barcode', 'auto')).rejects.toThrow(
        'Invalid barcode format'
      );

      expect(mockParseOCRText).not.toHaveBeenCalled();
    });
  });

  describe('Progress tracking', () => {
    test('should emit progress updates during scanning', async () => {
      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      await controller.scan('test-barcode', 'barcode');

      expect(events.onProgressUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'barcode',
          mode: 'barcode',
          barcodeAttempts: 1,
        })
      );
    });

    test('should emit metrics updates', async () => {
      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      await controller.scan('test-barcode', 'barcode');

      expect(events.onMetricsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          finalMode: 'barcode',
          barcodeAttemptTime: expect.any(Number),
          totalProcessingTime: expect.any(Number),
        })
      );
    });
  });

  describe('Cancellation', () => {
    test('should reset state when cancelled', () => {
      controller.cancel();

      expect(controller.getState()).toBe('idle');
    });
  });

  describe('State management', () => {
    test('should track scanning state correctly', async () => {
      expect(controller.getState()).toBe('idle');

      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      await controller.scan('test-barcode', 'barcode');

      // Should complete successfully
      expect(events.onProgressUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'completed',
        })
      );
    });

    test('should track mode correctly', async () => {
      expect(controller.getMode()).toBe('auto');

      mockScanLicense.mockResolvedValueOnce(mockLicenseData);
      await controller.scan('test-barcode', 'barcode');

      expect(controller.getMode()).toBe('barcode');
    });
  });

  describe('Error handling', () => {
    test('should handle invalid input types', async () => {
      await expect(controller.scan(123 as any, 'auto')).rejects.toThrow(
        'Invalid input type for auto mode'
      );
    });

    test('should wrap unknown errors in ScanError', async () => {
      mockScanLicense.mockRejectedValueOnce(new Error('Unexpected error'));

      try {
        await controller.scan('test-barcode', 'barcode');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ScanError);
        expect((error as ScanError).code).toBe('BARCODE_SCAN_ERROR');
        expect((error as ScanError).message).toBe('Barcode scanning failed');
      }
    });
  });

  describe('Performance requirements', () => {
    test('should complete fallback process within 4 seconds', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      // Simulate delays but within limits
      mockScanLicense.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(barcodeError), 1000);
          })
      );

      mockParseOCRText.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockLicenseData), 500);
          })
      );

      const startTime = Date.now();
      const result = await controller.scan('test-barcode', 'auto');
      const endTime = Date.now();

      expect(result).toEqual(mockLicenseData);
      expect(endTime - startTime).toBeLessThan(4000);
    });
  });
});
