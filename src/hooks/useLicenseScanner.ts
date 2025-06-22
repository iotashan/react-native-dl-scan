import { useState, useCallback, useRef, useEffect } from 'react';
import { ScanError } from '../index';
import type {
  LicenseData,
  ScanMode,
  ScanProgress,
  ScanMetrics,
  FallbackConfig,
  OCRTextObservation,
} from '../types/license';
import { logger } from '../utils/logger';
import { FallbackController } from '../utils/FallbackController';
import type {
  FallbackControllerEvents,
  PerformanceAlert,
} from '../utils/FallbackController';

export interface LicenseScannerOptions {
  mode?: 'auto' | 'barcode' | 'ocr';
  barcodeTimeout?: number;
  enableFallback?: boolean;
  confidenceThreshold?: number;
}

export interface LicenseScannerState {
  licenseData: LicenseData | null;
  isScanning: boolean;
  error: ScanError | null;
  scanMode: ScanMode;
  currentMode: 'barcode' | 'ocr' | 'switching';
  scanProgress: ScanProgress | null;
  scanMetrics: ScanMetrics | null;
  performanceMetrics: ScanMetrics | null;
}

export interface LicenseScannerActions {
  scan: (
    input: string | OCRTextObservation[],
    mode?: ScanMode
  ) => Promise<void>;
  scanBarcode: (barcodeData: string) => Promise<void>;
  scanOCR: (textObservations: OCRTextObservation[]) => Promise<void>;
  scanWithFallback: (barcodeData: string) => Promise<void>;
  reset: () => void;
  clearError: () => void;
  cancel: () => void;
  updateFallbackConfig: (config: Partial<FallbackConfig>) => void;
}

export function useLicenseScanner(
  options: LicenseScannerOptions = {}
): LicenseScannerState & LicenseScannerActions {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>(options.mode || 'auto');
  const [currentMode, setCurrentMode] = useState<
    'barcode' | 'ocr' | 'switching'
  >('barcode');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanMetrics, setScanMetrics] = useState<ScanMetrics | null>(null);
  const [performanceMetrics, setPerformanceMetrics] =
    useState<ScanMetrics | null>(null);

  const fallbackControllerRef = useRef<FallbackController | null>(null);

  // Initialize FallbackController
  useEffect(() => {
    const events: FallbackControllerEvents = {
      onProgressUpdate: (progress: ScanProgress) => {
        setScanProgress(progress);
        // Update currentMode based on progress state
        if (progress.state === 'barcode') {
          setCurrentMode('barcode');
        } else if (progress.state === 'ocr') {
          setCurrentMode('ocr');
        } else if (progress.state === 'fallback_transition') {
          setCurrentMode('switching');
        }
        logger.debug('Scan progress update', progress);
      },
      onModeSwitch: (fromMode: ScanMode, toMode: ScanMode, reason: string) => {
        setScanMode(toMode);
        setCurrentMode('switching');
        logger.info('Scan mode switched', { fromMode, toMode, reason });
      },
      onMetricsUpdate: (metrics: Partial<ScanMetrics>) => {
        setScanMetrics((prev) => ({ ...prev, ...metrics }) as ScanMetrics);
        setPerformanceMetrics(
          (prev) => ({ ...prev, ...metrics }) as ScanMetrics
        );
        logger.debug('Scan metrics update', metrics);
      },
      onPerformanceAlert: (alert: PerformanceAlert) => {
        logger.warn('Performance alert', alert);

        // Show user-friendly message based on alert type
        if (alert.type === 'critical') {
          setError(
            new ScanError({
              code: 'PERFORMANCE_CRITICAL',
              message: alert.message,
              userMessage:
                'Performance issue detected. ' +
                (alert.message || 'Please try again.'),
              recoverable: true,
            })
          );
        }
      },
    };

    // Initialize with configuration from options
    const fallbackConfig: Partial<FallbackConfig> = {
      ...(options.barcodeTimeout && {
        barcodeTimeoutMs: options.barcodeTimeout,
      }),
      ...(options.enableFallback !== undefined && {
        enableFallback: options.enableFallback,
      }),
      ...(options.confidenceThreshold && {
        confidenceThreshold: options.confidenceThreshold,
      }),
    };

    fallbackControllerRef.current = new FallbackController(
      fallbackConfig,
      events
    );

    return () => {
      if (fallbackControllerRef.current) {
        fallbackControllerRef.current.cancel();
      }
    };
  }, [
    options.barcodeTimeout,
    options.enableFallback,
    options.confidenceThreshold,
  ]);

  // Main scan function with fallback support
  const scan = useCallback(
    async (input: string | OCRTextObservation[], mode?: ScanMode) => {
      const effectiveMode = mode || options.mode || 'auto';
      if (!fallbackControllerRef.current) {
        throw new ScanError({
          code: 'CONTROLLER_NOT_INITIALIZED',
          message: 'FallbackController not initialized',
          userMessage: 'Scanner not ready. Please try again.',
          recoverable: true,
        });
      }

      setIsScanning(true);
      setError(null);
      setScanMode(effectiveMode);
      setScanProgress(null);
      setScanMetrics(null);
      setPerformanceMetrics(null);

      const inputType = typeof input === 'string' ? 'barcode' : 'ocr';
      // Set initial currentMode based on effective mode and input type
      if (effectiveMode === 'ocr' || inputType === 'ocr') {
        setCurrentMode('ocr');
      } else {
        setCurrentMode('barcode');
      }

      logger.info('Starting license scan with fallback', {
        mode: effectiveMode,
        inputType,
        inputLength: typeof input === 'string' ? input.length : input.length,
      });

      try {
        const data = await fallbackControllerRef.current.scan(
          input,
          effectiveMode
        );
        setLicenseData(data);

        logger.info('License scan successful', {
          hasFirstName: !!data.firstName,
          hasLastName: !!data.lastName,
          hasLicenseNumber: !!data.licenseNumber,
          state: data.address?.state,
          finalMode: fallbackControllerRef.current.getMode(),
        });
      } catch (err) {
        const scanError =
          err instanceof ScanError
            ? err
            : new ScanError({
                code: 'UNKNOWN_ERROR',
                message: 'Unknown error occurred',
                userMessage: 'Something went wrong. Please try again.',
                recoverable: true,
              });

        setError(scanError);

        logger.error('License scan failed', {
          errorCode: scanError.code,
          errorMessage: scanError.message,
          recoverable: scanError.recoverable,
          mode: fallbackControllerRef.current.getMode(),
        });
      } finally {
        setIsScanning(false);
      }
    },
    [options.mode]
  );

  // Legacy barcode-only scan for backward compatibility
  const scanBarcode = useCallback(
    async (barcodeData: string) => {
      await scan(barcodeData, 'barcode');
    },
    [scan]
  );

  // OCR-only scan
  const scanOCR = useCallback(
    async (textObservations: OCRTextObservation[]) => {
      await scan(textObservations, 'ocr');
    },
    [scan]
  );

  // Scan with automatic fallback (barcode → OCR)
  const scanWithFallback = useCallback(
    async (barcodeData: string) => {
      await scan(barcodeData, 'auto');
    },
    [scan]
  );

  // Cancel current scan operation
  const cancel = useCallback(() => {
    if (fallbackControllerRef.current) {
      fallbackControllerRef.current.cancel();
    }
    setIsScanning(false);
    setScanProgress(null);
    logger.info('Scan cancelled by user');
  }, []);

  // Update fallback configuration
  const updateFallbackConfig = useCallback(
    (config: Partial<FallbackConfig>) => {
      if (fallbackControllerRef.current) {
        fallbackControllerRef.current.updateConfig(config);
        logger.info('Fallback config updated', config);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setLicenseData(null);
    setError(null);
    setIsScanning(false);
    setScanMode(options.mode || 'auto');
    setCurrentMode('barcode');
    setScanProgress(null);
    setScanMetrics(null);
    setPerformanceMetrics(null);
    if (fallbackControllerRef.current) {
      fallbackControllerRef.current.cancel();
    }
  }, [options.mode]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    licenseData,
    isScanning,
    error,
    scanMode,
    currentMode,
    scanProgress,
    scanMetrics,
    performanceMetrics,
    scan,
    scanBarcode,
    scanOCR,
    scanWithFallback,
    reset,
    clearError,
    cancel,
    updateFallbackConfig,
  };
}
