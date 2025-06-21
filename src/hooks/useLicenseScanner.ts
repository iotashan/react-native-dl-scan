import { useState, useCallback } from 'react';
import { scanLicense, ScanError } from '../index';
import type { LicenseData } from '../types/license';
import { logger } from '../utils/logger';

export interface LicenseScannerState {
  licenseData: LicenseData | null;
  isScanning: boolean;
  error: ScanError | null;
}

export interface LicenseScannerActions {
  scan: (barcodeData: string) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

export function useLicenseScanner(): LicenseScannerState &
  LicenseScannerActions {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);

  const scan = useCallback(async (barcodeData: string) => {
    setIsScanning(true);
    setError(null);

    logger.info('Starting license scan', {
      barcodeLength: barcodeData.length,
    });

    try {
      const data = await scanLicense(barcodeData);
      setLicenseData(data);

      logger.info('License scan successful', {
        hasFirstName: !!data.firstName,
        hasLastName: !!data.lastName,
        hasLicenseNumber: !!data.licenseNumber,
        state: data.address?.state,
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
      });
    } finally {
      setIsScanning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLicenseData(null);
    setError(null);
    setIsScanning(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    licenseData,
    isScanning,
    error,
    scan,
    reset,
    clearError,
  };
}
