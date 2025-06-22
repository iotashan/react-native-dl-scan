import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { LicenseResult, OCRTextObservation } from './types/license';

export interface Spec extends TurboModule {
  scanLicense(barcodeData: string): Promise<LicenseResult>;
  parseOCRText(textObservations: OCRTextObservation[]): Promise<LicenseResult>;

  // Future methods for camera integration
  startScanning(): Promise<void>;
  stopScanning(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DlScan');
