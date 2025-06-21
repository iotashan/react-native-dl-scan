import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { ScanError } from '../types/license';

export interface ErrorHandlerOptions {
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function useErrorHandler(options?: ErrorHandlerOptions) {
  const [lastError, setLastError] = useState<ScanError | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  const handleError = useCallback(
    (error: ScanError | Error) => {
      const scanError: ScanError =
        'code' in error
          ? (error as ScanError)
          : {
              code: 'UNKNOWN_ERROR',
              message: error.message,
              userMessage: 'An unexpected error occurred',
              recoverable: true,
            };

      setLastError(scanError);
      setErrorCount((prev) => prev + 1);

      // Show appropriate alert based on error type
      switch (scanError.code) {
        case 'CAMERA_PERMISSION_DENIED':
          Alert.alert(
            'Camera Permission Required',
            scanError.userMessage,
            [
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: options?.onDismiss,
              },
              {
                text: 'Open Settings',
                onPress: () => {
                  Linking.openSettings();
                  options?.onDismiss?.();
                },
              },
            ],
            { cancelable: false }
          );
          break;

        case 'DETECTION_TIMEOUT':
          Alert.alert(
            'Scanning Timeout',
            scanError.userMessage,
            [
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: options?.onDismiss,
              },
              {
                text: 'Try Again',
                onPress: options?.onRetry,
              },
            ],
            { cancelable: false }
          );
          break;

        case 'SYSTEM_ERROR':
        case 'VISION_ERROR':
          Alert.alert(
            'System Error',
            scanError.userMessage,
            [
              {
                text: 'OK',
                onPress: options?.onDismiss,
              },
            ],
            { cancelable: false }
          );
          break;

        default:
          // For other errors, show if they're not recoverable or if error count is high
          if (!scanError.recoverable || errorCount > 5) {
            Alert.alert(
              'Scanning Error',
              scanError.userMessage,
              [
                {
                  text: 'Cancel',
                  style: 'cancel',
                  onPress: options?.onDismiss,
                },
                {
                  text: 'Try Again',
                  onPress: () => {
                    setErrorCount(0);
                    options?.onRetry?.();
                  },
                },
              ],
              { cancelable: true }
            );
          }
      }
    },
    [errorCount, options]
  );

  const clearError = useCallback(() => {
    setLastError(null);
    setErrorCount(0);
  }, []);

  return {
    lastError,
    errorCount,
    handleError,
    clearError,
  };
}
