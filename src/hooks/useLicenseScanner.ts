import { useState, useCallback } from 'react';
import { scanLicense, ScanError } from '../index';
import type { LicenseData } from '../types/license';

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

export function useLicenseScanner(): LicenseScannerState & LicenseScannerActions {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);

  const scan = useCallback(async (barcodeData: string) => {
    setIsScanning(true);
    setError(null);
    
    try {
      const data = await scanLicense(barcodeData);
      setLicenseData(data);
    } catch (err) {
      if (err instanceof ScanError) {
        setError(err);
      } else {
        setError(new ScanError({
          code: 'UNKNOWN_ERROR',
          message: 'Unknown error occurred',
          userMessage: 'Something went wrong. Please try again.',
          recoverable: true
        }));
      }
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