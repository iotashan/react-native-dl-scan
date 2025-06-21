import DlScan from './NativeDlScan';
import type { LicenseData, ScanError, ScanResult } from './types/license';

export function scanLicense(barcodeData: string): Promise<ScanResult> {
  return DlScan.scanLicense(barcodeData);
}

// Export types for consumers
export type { LicenseData, ScanError, ScanResult };
