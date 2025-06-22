import { renderHook, act } from '@testing-library/react-native';
import { useLicenseScanner } from '../useLicenseScanner';
import { ScanError } from '../../index';
import type { OCRTextObservation } from '../../types/license';

// Mock the FallbackController
jest.mock('../../utils/FallbackController', () => ({
  FallbackController: jest.fn().mockImplementation(() => ({
    scan: jest.fn(),
    cancel: jest.fn(),
    updateConfig: jest.fn(),
    getMode: jest.fn().mockReturnValue('auto'),
    getState: jest.fn().mockReturnValue('idle'),
  })),
}));

// Mock the scanner functions
jest.mock('../../index', () => {
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

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { FallbackController } from '../../utils/FallbackController';

const mockFallbackController = FallbackController as jest.MockedClass<
  typeof FallbackController
>;

describe('useLicenseScanner', () => {
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
      text: 'JOHN DOE',
      confidence: 0.98,
      boundingBox: { x: 100, y: 80, width: 120, height: 20 },
    },
  ];

  let mockControllerInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockControllerInstance = {
      scan: jest.fn(),
      cancel: jest.fn(),
      updateConfig: jest.fn(),
      getMode: jest.fn().mockReturnValue('auto'),
      getState: jest.fn().mockReturnValue('idle'),
    };

    mockFallbackController.mockImplementation(() => mockControllerInstance);
  });

  test('should initialize with default state', () => {
    const { result } = renderHook(() => useLicenseScanner());

    expect(result.current.licenseData).toBeNull();
    expect(result.current.isScanning).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.scanMode).toBe('auto');
    expect(result.current.currentMode).toBe('barcode');
    expect(result.current.scanProgress).toBeNull();
    expect(result.current.scanMetrics).toBeNull();
    expect(result.current.performanceMetrics).toBeNull();
  });

  test('should initialize with custom options', () => {
    const options = {
      mode: 'ocr' as const,
      barcodeTimeout: 5000,
      enableFallback: false,
      confidenceThreshold: 0.8,
    };

    const { result } = renderHook(() => useLicenseScanner(options));

    expect(result.current.scanMode).toBe('ocr');
    expect(mockFallbackController).toHaveBeenCalledWith(
      expect.objectContaining({
        barcodeTimeoutMs: 5000,
        enableFallback: false,
        confidenceThreshold: 0.8,
      }),
      expect.any(Object)
    );
  });

  test('should scan with fallback successfully', async () => {
    mockControllerInstance.scan.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scan('mock-barcode-data', 'auto');
    });

    expect(result.current.licenseData).toEqual(mockLicenseData);
    expect(result.current.isScanning).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockControllerInstance.scan).toHaveBeenCalledWith(
      'mock-barcode-data',
      'auto'
    );
  });

  test('should scan barcode only', async () => {
    mockControllerInstance.scan.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scanBarcode('mock-barcode-data');
    });

    expect(result.current.licenseData).toEqual(mockLicenseData);
    expect(mockControllerInstance.scan).toHaveBeenCalledWith(
      'mock-barcode-data',
      'barcode'
    );
  });

  test('should scan OCR only', async () => {
    mockControllerInstance.scan.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scanOCR(mockOCRData);
    });

    expect(result.current.licenseData).toEqual(mockLicenseData);
    expect(mockControllerInstance.scan).toHaveBeenCalledWith(
      mockOCRData,
      'ocr'
    );
  });

  test('should scan with automatic fallback', async () => {
    mockControllerInstance.scan.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scanWithFallback('mock-barcode-data');
    });

    expect(result.current.licenseData).toEqual(mockLicenseData);
    expect(mockControllerInstance.scan).toHaveBeenCalledWith(
      'mock-barcode-data',
      'auto'
    );
  });

  test('should handle scan errors', async () => {
    const scanError = new ScanError({
      code: 'INVALID_BARCODE_FORMAT',
      message: 'Invalid barcode format',
      userMessage: 'The barcode could not be read',
      recoverable: true,
    });

    mockControllerInstance.scan.mockRejectedValueOnce(scanError);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scan('invalid-barcode');
    });

    expect(result.current.licenseData).toBeNull();
    expect(result.current.isScanning).toBe(false);
    expect(result.current.error).toEqual(scanError);
  });

  test('should handle unknown errors', async () => {
    mockControllerInstance.scan.mockRejectedValueOnce(
      new Error('Network error')
    );

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scan('test-barcode');
    });

    expect(result.current.error).toBeInstanceOf(ScanError);
    expect(result.current.error?.code).toBe('UNKNOWN_ERROR');
    expect(result.current.error?.userMessage).toBe(
      'Something went wrong. Please try again.'
    );
  });

  test('should handle controller not initialized error', async () => {
    // Create a new hook instance with no controller
    const { result } = renderHook(() => useLicenseScanner());

    // Simulate controller not being ready
    const originalControllerInstance = mockControllerInstance;

    // Mock the controller scan to throw the specific error
    mockControllerInstance.scan.mockRejectedValueOnce(
      new ScanError({
        code: 'CONTROLLER_NOT_INITIALIZED',
        message: 'FallbackController not initialized',
        userMessage: 'Scanner not ready. Please try again.',
        recoverable: true,
      })
    );

    await act(async () => {
      await result.current.scan('test-barcode');
    });

    expect(result.current.error).toBeInstanceOf(ScanError);
    expect(result.current.error?.code).toBe('CONTROLLER_NOT_INITIALIZED');

    // Restore
    mockControllerInstance = originalControllerInstance;
  });

  test('should set scanning state during scan', async () => {
    mockControllerInstance.scan.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(mockLicenseData), 100);
        })
    );

    const { result } = renderHook(() => useLicenseScanner());

    act(() => {
      result.current.scan('test-barcode');
    });

    expect(result.current.isScanning).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(result.current.isScanning).toBe(false);
  });

  test('should cancel scan operation', () => {
    const { result } = renderHook(() => useLicenseScanner());

    act(() => {
      result.current.cancel();
    });

    expect(mockControllerInstance.cancel).toHaveBeenCalled();
    expect(result.current.isScanning).toBe(false);
    expect(result.current.scanProgress).toBeNull();
  });

  test('should update fallback configuration', () => {
    const { result } = renderHook(() => useLicenseScanner());

    const newConfig = { barcodeTimeoutMs: 5000 };

    act(() => {
      result.current.updateFallbackConfig(newConfig);
    });

    expect(mockControllerInstance.updateConfig).toHaveBeenCalledWith(newConfig);
  });

  test('should reset state', () => {
    const { result } = renderHook(() => useLicenseScanner());

    // Set some state first
    act(() => {
      result.current.scan('test-barcode');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.licenseData).toBeNull();
    expect(result.current.isScanning).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.scanMode).toBe('auto');
    expect(result.current.scanProgress).toBeNull();
    expect(result.current.scanMetrics).toBeNull();
    expect(mockControllerInstance.cancel).toHaveBeenCalled();
  });

  test('should clear error', async () => {
    const scanError = new ScanError({
      code: 'TEST_ERROR',
      message: 'Test error',
      userMessage: 'Test error message',
      recoverable: true,
    });

    mockControllerInstance.scan.mockRejectedValueOnce(scanError);

    const { result } = renderHook(() => useLicenseScanner());

    await act(async () => {
      await result.current.scan('test-barcode');
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  test('should handle progress updates and update currentMode', () => {
    const { result } = renderHook(() => useLicenseScanner());

    // Simulate progress update from controller
    const mockProgress = {
      state: 'barcode' as const,
      mode: 'auto' as const,
      startTime: Date.now(),
      barcodeAttempts: 1,
      timeElapsed: 1000,
      message: 'Scanning barcode...',
    };

    // Access the events handler passed to the controller
    const controllerCall = mockFallbackController.mock.calls[0];
    const events = controllerCall?.[1];

    act(() => {
      events?.onProgressUpdate(mockProgress);
    });

    expect(result.current.scanProgress).toEqual(mockProgress);
    expect(result.current.currentMode).toBe('barcode');

    // Test OCR mode
    act(() => {
      events?.onProgressUpdate({ ...mockProgress, state: 'ocr' as const });
    });
    expect(result.current.currentMode).toBe('ocr');

    // Test switching mode
    act(() => {
      events?.onProgressUpdate({
        ...mockProgress,
        state: 'fallback_transition' as const,
      });
    });
    expect(result.current.currentMode).toBe('switching');
  });

  test('should handle mode switch events', () => {
    const { result } = renderHook(() => useLicenseScanner());

    // Access the events handler passed to the controller
    const controllerCall = mockFallbackController.mock.calls[0];
    const events = controllerCall?.[1];

    act(() => {
      events?.onModeSwitch('barcode', 'ocr', 'Fallback triggered');
    });

    expect(result.current.scanMode).toBe('ocr');
    expect(result.current.currentMode).toBe('switching');
  });

  test('should handle metrics updates', () => {
    const { result } = renderHook(() => useLicenseScanner());

    // Access the events handler passed to the controller
    const controllerCall = mockFallbackController.mock.calls[0];
    const events = controllerCall?.[1];

    const mockMetrics = {
      totalProcessingTime: 2000,
      barcodeAttemptTime: 1500,
      fallbackTriggered: true,
      success: true,
    };

    act(() => {
      events?.onMetricsUpdate(mockMetrics);
    });

    expect(result.current.scanMetrics).toEqual(
      expect.objectContaining(mockMetrics)
    );
    expect(result.current.performanceMetrics).toEqual(
      expect.objectContaining(mockMetrics)
    );
  });

  test('should cleanup controller on unmount', () => {
    const { unmount } = renderHook(() => useLicenseScanner());

    unmount();

    expect(mockControllerInstance.cancel).toHaveBeenCalled();
  });

  test('backward compatibility: hook works without options', async () => {
    mockControllerInstance.scan.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner());

    // Initial state should be 'auto'
    expect(result.current.scanMode).toBe('auto');

    // Should work exactly as before
    await act(async () => {
      await result.current.scanBarcode('test-barcode');
    });

    expect(result.current.licenseData).toEqual(mockLicenseData);
    // scanBarcode explicitly sets mode to 'barcode'
    expect(mockControllerInstance.scan).toHaveBeenCalledWith(
      'test-barcode',
      'barcode'
    );
  });

  test('should respect mode option when no mode provided to scan', async () => {
    mockControllerInstance.scan.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner({ mode: 'ocr' }));

    await act(async () => {
      await result.current.scan(mockOCRData); // No mode parameter
    });

    expect(mockControllerInstance.scan).toHaveBeenCalledWith(
      mockOCRData,
      'ocr'
    );
  });

  test('should set correct initial currentMode based on mode and input', async () => {
    mockControllerInstance.scan.mockResolvedValueOnce(mockLicenseData);

    const { result } = renderHook(() => useLicenseScanner({ mode: 'auto' }));

    // Test barcode input
    act(() => {
      result.current.scan('barcode-data');
    });
    expect(result.current.currentMode).toBe('barcode');

    // Test OCR input
    act(() => {
      result.current.scan(mockOCRData);
    });
    expect(result.current.currentMode).toBe('ocr');

    // Test explicit OCR mode
    act(() => {
      result.current.scan('barcode-data', 'ocr');
    });
    expect(result.current.currentMode).toBe('ocr');
  });

  test('should reset to configured mode on reset', () => {
    const { result } = renderHook(() => useLicenseScanner({ mode: 'ocr' }));

    // Change mode during scanning
    act(() => {
      result.current.scan('test-barcode', 'barcode');
    });

    expect(result.current.scanMode).toBe('barcode');

    act(() => {
      result.current.reset();
    });

    expect(result.current.scanMode).toBe('ocr'); // Back to configured mode
    expect(result.current.currentMode).toBe('barcode'); // Reset to default
    expect(result.current.performanceMetrics).toBeNull();
  });
});
