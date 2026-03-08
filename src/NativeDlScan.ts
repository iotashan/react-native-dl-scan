import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  parseBarcodeData(
    barcodeData: string
  ): Promise<{ [key: string]: string | null }>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DlScan');
