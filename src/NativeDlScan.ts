import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { LicenseData, ScanError } from './types/license';

export interface Spec extends TurboModule {
  scanLicense(): Promise<{
    success: boolean;
    data?: LicenseData;
    error?: ScanError;
  }>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DlScan');
