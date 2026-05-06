import { NitroModules } from 'react-native-nitro-modules';
import type { DlScan as DlScanSpec } from './specs/DlScan.nitro';
import type { LicenseData, MRZData, DocumentType } from './types';
import type { LicenseDataSpec } from './specs/DlScan.nitro';

// Re-export so useLicenseScanner and scanFrame can use without a circular import.
export type { LicenseDataSpec };

const _hybrid = NitroModules.createHybridObject<DlScanSpec>('DlScan');

// Export the hybrid so worklets (scanFrameOcr) can call recognizeLicenseFields
// synchronously on the camera thread.
export { _hybrid };

// Nitro maps optional struct fields to `T | undefined` on the JS side,
// but the public LicenseData contract uses `T | null`. Normalize here so
// consumers (scanFrame, useLicenseScanner, and downstream callers) always
// receive null for absent fields rather than undefined.
export const undefinedToNull = <T>(v: T | undefined): T | null =>
  v === undefined ? null : v;

// Normalize a LicenseDataSpec (Nitro raw shape) to the public LicenseData type.
export function normalizeLicenseData(result: LicenseDataSpec): LicenseData {
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
    documentType: undefinedToNull(result.documentType) as DocumentType | null,
    mrz: undefinedToNull(
      result.mrz != null
        ? ({
            mrzType: result.mrz.mrzType as MRZData['mrzType'],
            documentCode: result.mrz.documentCode,
            issuingState: result.mrz.issuingState,
            documentNumber: result.mrz.documentNumber,
            primaryIdentifier: result.mrz.primaryIdentifier,
            secondaryIdentifier: result.mrz.secondaryIdentifier,
            nationality: result.mrz.nationality,
            dateOfBirth: result.mrz.dateOfBirth,
            sex: result.mrz.sex as MRZData['sex'],
            dateOfExpiry: result.mrz.dateOfExpiry,
            optionalData: result.mrz.optionalData,
            checkDigitsValid: result.mrz.checkDigitsValid,
          } satisfies MRZData)
        : undefined
    ),
  };
}

export const NativeDlScan = {
  parseBarcodeData: async (
    barcodeData: string
  ): Promise<LicenseData | null> => {
    const result = await _hybrid.parseBarcodeData(barcodeData);
    if (result == null) return null;
    return normalizeLicenseData(result);
  },
};

export { scanFrame } from './scanFrame';
export { useLicenseScanner } from './useLicenseScanner';
export type {
  LicenseData,
  ScanResult,
  ScanMode,
  DocumentType,
  MRZData,
} from './types';
