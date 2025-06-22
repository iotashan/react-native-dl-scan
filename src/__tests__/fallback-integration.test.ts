/**
 * Integration tests for the complete fallback pipeline
 * Tests the end-to-end functionality from hook to controller to native functions
 */

import { renderHook, act } from '@testing-library/react-native';
import { useLicenseScanner } from '../hooks/useLicenseScanner';
import { scanLicense, parseOCRText, ScanError } from '../index';
import type { OCRTextObservation } from '../types/license';

// Mock the native module first
jest.mock('../NativeDlScan', () => ({
  scanLicense: jest.fn(),
  parseOCRText: jest.fn(),
}));

// Mock the TurboModuleRegistry
jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => ({
  getEnforcing: jest.fn(() => ({
    scanLicense: jest.fn(),
    parseOCRText: jest.fn(),
  })),
}));

// Mock the native functions
jest.mock('../index', () => {
  // Mock the ScanError class
  class MockScanError extends Error {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly recoverable: boolean;

    constructor(error: any) {
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

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockScanLicense = scanLicense as jest.MockedFunction<typeof scanLicense>;
const mockParseOCRText = parseOCRText as jest.MockedFunction<
  typeof parseOCRText
>;

describe('Fallback Integration Pipeline', () => {
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
    {
      text: 'D12345678',
      confidence: 0.93,
      boundingBox: { x: 100, y: 110, width: 100, height: 20 },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful barcode scanning', () => {
    test('should complete barcode scan without fallback', async () => {
      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanWithFallback('valid-barcode-data');
      });

      expect(result.current.licenseData).toEqual(mockLicenseData);
      expect(result.current.error).toBeNull();
      expect(result.current.scanMode).toBe('auto');
      expect(mockScanLicense).toHaveBeenCalledWith('valid-barcode-data');
      expect(mockParseOCRText).not.toHaveBeenCalled();
    });
  });

  describe('Automatic fallback scenarios', () => {
    test('should fallback from barcode to OCR on invalid format error', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      mockScanLicense.mockRejectedValueOnce(barcodeError);
      mockParseOCRText.mockResolvedValueOnce(mockLicenseData);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanWithFallback('invalid-barcode');
      });

      expect(result.current.licenseData).toEqual(mockLicenseData);
      expect(result.current.error).toBeNull();
      expect(mockScanLicense).toHaveBeenCalledWith('invalid-barcode');
      expect(mockParseOCRText).toHaveBeenCalled();

      // Should have triggered mode switch
      expect(result.current.scanMetrics?.fallbackTriggered).toBe(true);
      expect(result.current.scanMetrics?.fallbackReason).toBe('failure');
    });

    test('should fallback on barcode timeout', async () => {
      // Simulate timeout by having barcode scan take too long
      mockScanLicense.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(
                new ScanError({
                  code: 'TIMEOUT_ERROR',
                  message: 'Barcode scan timeout',
                  userMessage: 'Scanning took too long',
                  recoverable: true,
                })
              );
            }, 100);
          })
      );

      mockParseOCRText.mockResolvedValueOnce(mockLicenseData);

      const { result } = renderHook(() => useLicenseScanner());

      // Configure short timeout for testing
      act(() => {
        result.current.updateFallbackConfig({ barcodeTimeoutMs: 50 });
      });

      await act(async () => {
        await result.current.scanWithFallback('slow-barcode');
      });

      expect(result.current.licenseData).toEqual(mockLicenseData);
      expect(mockParseOCRText).toHaveBeenCalled();
    });

    test('should handle fallback failure gracefully', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      const ocrError = new ScanError({
        code: 'OCR_PARSING_ERROR',
        message: 'OCR parsing failed',
        userMessage: 'Unable to read license text',
        recoverable: true,
      });

      mockScanLicense.mockRejectedValueOnce(barcodeError);
      mockParseOCRText.mockRejectedValueOnce(ocrError);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanWithFallback('invalid-input');
      });

      expect(result.current.licenseData).toBeNull();
      expect(result.current.error).toEqual(ocrError);
      expect(result.current.scanMetrics?.success).toBe(false);
      expect(mockScanLicense).toHaveBeenCalled();
      expect(mockParseOCRText).toHaveBeenCalled();
    });
  });

  describe('Mode-specific scanning', () => {
    test('should perform barcode-only scan', async () => {
      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanBarcode('barcode-data');
      });

      expect(result.current.licenseData).toEqual(mockLicenseData);
      expect(mockScanLicense).toHaveBeenCalledWith('barcode-data');
      expect(mockParseOCRText).not.toHaveBeenCalled();
    });

    test('should perform OCR-only scan', async () => {
      mockParseOCRText.mockResolvedValueOnce(mockLicenseData);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanOCR(mockOCRData);
      });

      expect(result.current.licenseData).toEqual(mockLicenseData);
      expect(mockParseOCRText).toHaveBeenCalledWith(mockOCRData);
      expect(mockScanLicense).not.toHaveBeenCalled();
    });

    test('should not fallback in barcode-only mode', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      mockScanLicense.mockRejectedValueOnce(barcodeError);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanBarcode('invalid-barcode');
      });

      expect(result.current.licenseData).toBeNull();
      expect(result.current.error).toEqual(barcodeError);
      expect(mockParseOCRText).not.toHaveBeenCalled();
    });
  });

  describe('Performance requirements', () => {
    test('should complete fallback within 4 seconds', async () => {
      const barcodeError = new ScanError({
        code: 'INVALID_BARCODE_FORMAT',
        message: 'Invalid barcode format',
        userMessage: 'Unable to read barcode',
        recoverable: true,
      });

      // Simulate realistic delays
      mockScanLicense.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(barcodeError), 1000); // 1 second barcode attempt
          })
      );

      mockParseOCRText.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockLicenseData), 500); // 0.5 second OCR
          })
      );

      const { result } = renderHook(() => useLicenseScanner());

      const startTime = Date.now();

      await act(async () => {
        await result.current.scanWithFallback('test-barcode');
      });

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      expect(result.current.licenseData).toEqual(mockLicenseData);
      expect(totalTime).toBeLessThan(4000); // Should complete within 4 seconds
      expect(result.current.scanMetrics?.totalProcessingTime).toBeLessThan(
        4000
      );
    });

    test('should track performance metrics accurately', async () => {
      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanBarcode('test-barcode');
      });

      expect(result.current.scanMetrics).toEqual(
        expect.objectContaining({
          success: true,
          fallbackTriggered: false,
          finalMode: 'barcode',
          totalProcessingTime: expect.any(Number),
        })
      );
    });
  });

  describe('Progress tracking', () => {
    test('should provide progress updates during scanning', async () => {
      mockScanLicense.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockLicenseData), 100);
          })
      );

      const { result } = renderHook(() => useLicenseScanner());

      // Start scan without awaiting to check progress state
      act(() => {
        result.current.scanBarcode('test-barcode');
      });

      // Should have progress during scan
      expect(result.current.isScanning).toBe(true);
      expect(result.current.scanProgress).toEqual(
        expect.objectContaining({
          state: expect.any(String),
          mode: 'barcode',
          timeElapsed: expect.any(Number),
        })
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(result.current.isScanning).toBe(false);
    });
  });

  describe('Error recovery', () => {
    test('should allow retry after error', async () => {
      const barcodeError = new ScanError({
        code: 'TEMPORARY_ERROR',
        message: 'Temporary error',
        userMessage: 'Please try again',
        recoverable: true,
      });

      // First attempt fails
      mockScanLicense.mockRejectedValueOnce(barcodeError);

      const { result } = renderHook(() => useLicenseScanner());

      await act(async () => {
        await result.current.scanBarcode('test-barcode');
      });

      expect(result.current.error).toEqual(barcodeError);

      // Clear error and retry
      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();

      // Second attempt succeeds
      mockScanLicense.mockResolvedValueOnce(mockLicenseData);

      await act(async () => {
        await result.current.scanBarcode('test-barcode');
      });

      expect(result.current.licenseData).toEqual(mockLicenseData);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Cancellation', () => {
    test('should cancel ongoing scan operation', async () => {
      mockScanLicense.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockLicenseData), 1000);
          })
      );

      const { result } = renderHook(() => useLicenseScanner());

      // Start scan without awaiting to check cancellation
      act(() => {
        result.current.scanBarcode('test-barcode');
      });

      expect(result.current.isScanning).toBe(true);

      // Cancel after short delay
      act(() => {
        result.current.cancel();
      });

      expect(result.current.isScanning).toBe(false);
      expect(result.current.scanProgress).toBeNull();
    });
  });
});
