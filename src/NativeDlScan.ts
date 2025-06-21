import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { LicenseResult } from './types/license';

export interface Spec extends TurboModule {
  scanLicense(barcodeData: string): Promise<LicenseResult>;

  // Future methods for camera integration
  startScanning(): Promise<void>;
  stopScanning(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DlScan');
