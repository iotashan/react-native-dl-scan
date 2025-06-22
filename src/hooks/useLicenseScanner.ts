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
import type { FallbackControllerEvents } from '../utils/FallbackController';

export interface LicenseScannerState {
  licenseData: LicenseData | null;
  isScanning: boolean;
  error: ScanError | null;
  scanMode: ScanMode;
  scanProgress: ScanProgress | null;
  scanMetrics: ScanMetrics | null;
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

export function useLicenseScanner(): LicenseScannerState &
  LicenseScannerActions {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('auto');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanMetrics, setScanMetrics] = useState<ScanMetrics | null>(null);

  const fallbackControllerRef = useRef<FallbackController | null>(null);

  // Initialize FallbackController
  useEffect(() => {
    const events: FallbackControllerEvents = {
      onProgressUpdate: (progress: ScanProgress) => {
        setScanProgress(progress);
        logger.debug('Scan progress update', progress);
      },
      onModeSwitch: (fromMode: ScanMode, toMode: ScanMode, reason: string) => {
        setScanMode(toMode);
        logger.info('Scan mode switched', { fromMode, toMode, reason });
      },
      onMetricsUpdate: (metrics: Partial<ScanMetrics>) => {
        setScanMetrics((prev) => ({ ...prev, ...metrics }) as ScanMetrics);
        logger.debug('Scan metrics update', metrics);
      },
    };

    fallbackControllerRef.current = new FallbackController({}, events);

    return () => {
      if (fallbackControllerRef.current) {
        fallbackControllerRef.current.cancel();
      }
    };
  }, []);

  // Main scan function with fallback support
  const scan = useCallback(
    async (input: string | OCRTextObservation[], mode: ScanMode = 'auto') => {
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
      setScanMode(mode);
      setScanProgress(null);
      setScanMetrics(null);

      const inputType = typeof input === 'string' ? 'barcode' : 'ocr';
      logger.info('Starting license scan with fallback', {
        mode,
        inputType,
        inputLength: typeof input === 'string' ? input.length : input.length,
      });

      try {
        const data = await fallbackControllerRef.current.scan(input, mode);
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
    []
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
    setScanMode('auto');
    setScanProgress(null);
    setScanMetrics(null);
    if (fallbackControllerRef.current) {
      fallbackControllerRef.current.cancel();
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    licenseData,
    isScanning,
    error,
    scanMode,
    scanProgress,
    scanMetrics,
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
