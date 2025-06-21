import DlScan from './NativeDlScan';
import type { LicenseData, ScanError, ScanResult } from './types/license';

export function scanLicense(): Promise<ScanResult> {
  return DlScan.scanLicense();
}

// Export types for consumers
export type { LicenseData, ScanError, ScanResult };
