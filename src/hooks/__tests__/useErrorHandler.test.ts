import { renderHook, act } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { useErrorHandler } from '../useErrorHandler';
import type { ErrorHandlerOptions } from '../useErrorHandler';
import type { ScanError } from '../../types/license';

// Mock React Native modules
jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn(),
  },
  Linking: {
    openSettings: jest.fn(() => Promise.resolve()),
  },
}));

const mockAlert = Alert.alert as jest.MockedFunction<typeof Alert.alert>;
const mockOpenSettings = Linking.openSettings as jest.MockedFunction<
  typeof Linking.openSettings
>;

describe('useErrorHandler', () => {
  let mockOptions: ErrorHandlerOptions;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOptions = {
      onRetry: jest.fn(),
      onDismiss: jest.fn(),
    };
  });

  describe('initialization', () => {
    it('should initialize with no error and zero count', () => {
      const { result } = renderHook(() => useErrorHandler());

      expect(result.current.lastError).toBeNull();
      expect(result.current.errorCount).toBe(0);
      expect(typeof result.current.handleError).toBe('function');
      expect(typeof result.current.clearError).toBe('function');
    });

    it('should accept options parameter', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      expect(result.current).toBeDefined();
      expect(typeof result.current.handleError).toBe('function');
    });
  });

  describe('handleError', () => {
    it('should handle ScanError with camera permission denied', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'CAMERA_PERMISSION_DENIED',
        message: 'Camera permission is required',
        userMessage: 'Please grant camera permission to scan licenses',
        recoverable: true,
      };

      act(() => {
        result.current.handleError(error);
      });

      expect(result.current.lastError).toEqual(error);
      expect(result.current.errorCount).toBe(1);
      expect(mockAlert).toHaveBeenCalledWith(
        'Camera Permission Required',
        error.userMessage,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: mockOptions.onDismiss,
          },
          {
            text: 'Open Settings',
            onPress: expect.any(Function),
          },
        ],
        { cancelable: false }
      );
    });

    it('should handle detection timeout errors', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'DETECTION_TIMEOUT',
        message: 'Barcode detection timed out',
        userMessage:
          'Unable to detect license. Please ensure good lighting and hold steady.',
        recoverable: true,
      };

      act(() => {
        result.current.handleError(error);
      });

      expect(mockAlert).toHaveBeenCalledWith(
        'Scanning Timeout',
        error.userMessage,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: mockOptions.onDismiss,
          },
          {
            text: 'Try Again',
            onPress: mockOptions.onRetry,
          },
        ],
        { cancelable: false }
      );
    });

    it('should handle system errors', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'SYSTEM_ERROR',
        message: 'System failure',
        userMessage: 'A system error occurred. Please restart the app.',
        recoverable: false,
      };

      act(() => {
        result.current.handleError(error);
      });

      expect(mockAlert).toHaveBeenCalledWith(
        'System Error',
        error.userMessage,
        [
          {
            text: 'OK',
            onPress: mockOptions.onDismiss,
          },
        ],
        { cancelable: false }
      );
    });

    it('should handle vision framework errors', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'VISION_ERROR',
        message: 'Vision framework error',
        userMessage: 'Vision processing failed. Please try again.',
        recoverable: true,
      };

      act(() => {
        result.current.handleError(error);
      });

      expect(mockAlert).toHaveBeenCalledWith(
        'System Error',
        error.userMessage,
        [
          {
            text: 'OK',
            onPress: mockOptions.onDismiss,
          },
        ],
        { cancelable: false }
      );
    });

    it('should handle generic Error objects', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error = new Error('Generic error message');

      act(() => {
        result.current.handleError(error);
      });

      expect(result.current.lastError).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'Generic error message',
        userMessage: 'An unexpected error occurred',
        recoverable: true,
      });
      expect(result.current.errorCount).toBe(1);
    });

    it('should show alert for non-recoverable errors', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'FATAL_ERROR',
        message: 'Fatal error occurred',
        userMessage: 'A critical error occurred',
        recoverable: false,
      };

      act(() => {
        result.current.handleError(error);
      });

      expect(mockAlert).toHaveBeenCalledWith(
        'Scanning Error',
        error.userMessage,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: mockOptions.onDismiss,
          },
          {
            text: 'Try Again',
            onPress: expect.any(Function),
          },
        ],
        { cancelable: true }
      );
    });

    it('should show alert after multiple recoverable errors (>5)', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'PARSING_FAILED',
        message: 'Parse error',
        userMessage: 'Unable to parse license data',
        recoverable: true,
      };

      // Trigger 6 errors to exceed the threshold
      act(() => {
        for (let i = 0; i < 6; i++) {
          result.current.handleError(error);
        }
      });

      expect(result.current.errorCount).toBe(6);
      expect(mockAlert).toHaveBeenLastCalledWith(
        'Scanning Error',
        error.userMessage,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: mockOptions.onDismiss,
          },
          {
            text: 'Try Again',
            onPress: expect.any(Function),
          },
        ],
        { cancelable: true }
      );
    });

    it('should not show alert for recoverable errors under threshold', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'PARSING_FAILED',
        message: 'Parse error',
        userMessage: 'Unable to parse license data',
        recoverable: true,
      };

      act(() => {
        result.current.handleError(error);
      });

      expect(result.current.errorCount).toBe(1);
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it('should reset error count when retry is pressed after threshold', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'PARSING_FAILED',
        message: 'Parse error',
        userMessage: 'Unable to parse license data',
        recoverable: true,
      };

      // Trigger 6 errors to exceed threshold
      act(() => {
        for (let i = 0; i < 6; i++) {
          result.current.handleError(error);
        }
      });

      expect(mockAlert).toHaveBeenCalled();

      // Get the retry callback from the last Alert.alert call
      const lastAlertCall =
        mockAlert.mock.calls[mockAlert.mock.calls.length - 1];
      const retryButton = lastAlertCall?.[2]?.[1];

      act(() => {
        retryButton?.onPress?.();
      });

      expect(result.current.errorCount).toBe(0);
      expect(mockOptions.onRetry).toHaveBeenCalled();
    });
  });

  describe('clearError', () => {
    it('should clear error and reset count', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'TEST_ERROR',
        message: 'Test error',
        userMessage: 'Test error message',
        recoverable: true,
      };

      act(() => {
        result.current.handleError(error);
        result.current.handleError(error);
      });

      expect(result.current.lastError).toEqual(error);
      expect(result.current.errorCount).toBe(2);

      act(() => {
        result.current.clearError();
      });

      expect(result.current.lastError).toBeNull();
      expect(result.current.errorCount).toBe(0);
    });
  });

  describe('camera permission settings integration', () => {
    it('should open settings when Open Settings is pressed', () => {
      const { result } = renderHook(() => useErrorHandler(mockOptions));

      const error: ScanError = {
        code: 'CAMERA_PERMISSION_DENIED',
        message: 'Camera permission denied',
        userMessage: 'Please grant camera permission',
        recoverable: true,
      };

      act(() => {
        result.current.handleError(error);
      });

      // Get the "Open Settings" button callback
      const alertCall = mockAlert.mock.calls[0];
      const openSettingsButton = alertCall?.[2]?.[1];

      act(() => {
        openSettingsButton?.onPress?.();
      });

      expect(mockOpenSettings).toHaveBeenCalled();
      expect(mockOptions.onDismiss).toHaveBeenCalled();
    });
  });

  describe('hook stability', () => {
    it('should maintain function references across re-renders when options unchanged', () => {
      const { result, rerender } = renderHook(
        ({ options }) => useErrorHandler(options),
        { initialProps: { options: mockOptions } }
      );

      const initialHandleError = result.current.handleError;
      const initialClearError = result.current.clearError;

      rerender({ options: mockOptions });

      expect(result.current.handleError).toBe(initialHandleError);
      expect(result.current.clearError).toBe(initialClearError);
    });

    it('should update function references when options change', () => {
      const { result, rerender } = renderHook(
        ({ options }) => useErrorHandler(options),
        { initialProps: { options: mockOptions } }
      );

      const initialHandleError = result.current.handleError;

      const newOptions = {
        onRetry: jest.fn(),
        onDismiss: jest.fn(),
      };

      rerender({ options: newOptions });

      expect(result.current.handleError).not.toBe(initialHandleError);
    });
  });
});
