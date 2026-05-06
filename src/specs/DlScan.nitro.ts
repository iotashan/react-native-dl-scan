import type { HybridObject } from 'react-native-nitro-modules';

// Sex must be a named type (nitrogen cannot handle inline string-literal unions).
export type Sex = 'M' | 'F' | 'X';

// Mirrors src/types.ts LicenseData with nullable fields expressed as optional
// (Nitro maps optional → std::optional on the native side).
// Note: aamvaVersion is a number here; null/absent means not parsed.
export interface LicenseDataSpec {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  issueDate?: string;
  licenseNumber?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  sex?: Sex;
  eyeColor?: string;
  height?: string;
  vehicleClass?: string;
  restrictions?: string;
  endorsements?: string;
  aamvaVersion?: number;
}

export interface DlScan extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  parseBarcodeData(barcodeData: string): Promise<LicenseDataSpec | null>;
}
