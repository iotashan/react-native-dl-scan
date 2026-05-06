import { NitroModules } from 'react-native-nitro-modules';
import type { DlScan as DlScanSpec } from './specs/DlScan.nitro';
import type { LicenseData } from './types';

const _hybrid = NitroModules.createHybridObject<DlScanSpec>('DlScan');

// Nitro maps optional struct fields to `T | undefined` on the JS side,
// but the public LicenseData contract uses `T | null`. Normalize here so
// consumers (scanFrame, useLicenseScanner, and downstream callers) always
// receive null for absent fields rather than undefined.
const undefinedToNull = <T>(v: T | undefined): T | null =>
  v === undefined ? null : v;

export const NativeDlScan = {
  parseBarcodeData: async (
    barcodeData: string
  ): Promise<LicenseData | null> => {
    const result = await _hybrid.parseBarcodeData(barcodeData);
    if (result == null) return null;
    return {
      firstName: undefinedToNull(result.firstName),
      lastName: undefinedToNull(result.lastName),
      middleName: undefinedToNull(result.middleName),
      dateOfBirth: undefinedToNull(result.dateOfBirth),
      expirationDate: undefinedToNull(result.expirationDate),
      issueDate: undefinedToNull(result.issueDate),
      licenseNumber: undefinedToNull(result.licenseNumber),
      street: undefinedToNull(result.street),
      city: undefinedToNull(result.city),
      state: undefinedToNull(result.state),
      postalCode: undefinedToNull(result.postalCode),
      country: undefinedToNull(result.country),
      sex: undefinedToNull(result.sex),
      eyeColor: undefinedToNull(result.eyeColor),
      height: undefinedToNull(result.height),
      vehicleClass: undefinedToNull(result.vehicleClass),
      restrictions: undefinedToNull(result.restrictions),
      endorsements: undefinedToNull(result.endorsements),
      aamvaVersion: undefinedToNull(result.aamvaVersion),
    };
  },
};

export { scanFrame } from './scanFrame';
export { useLicenseScanner } from './useLicenseScanner';
export type { LicenseData, ScanResult, ScanMode } from './types';
