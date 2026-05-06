export type DocumentType =
  | 'driver_license'
  | 'passport'
  | 'national_id'
  | 'residence_permit'
  | 'unknown';

export interface MRZData {
  mrzType: 'TD1' | 'TD2' | 'TD3';
  documentCode: string;
  issuingState: string;
  documentNumber: string;
  primaryIdentifier: string;
  secondaryIdentifier: string;
  nationality: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'X';
  dateOfExpiry: string;
  optionalData: string;
  checkDigitsValid: boolean;
}

export interface LicenseData {
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  dateOfBirth: string | null;
  expirationDate: string | null;
  issueDate: string | null;
  licenseNumber: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  sex: 'M' | 'F' | 'X' | null;
  eyeColor: string | null;
  height: string | null;
  vehicleClass: string | null;
  restrictions: string | null;
  endorsements: string | null;
  aamvaVersion: number | null;
  documentType?: DocumentType | null;
  mrz?: MRZData | null;
}

export type ScanMode = 'barcode' | 'ocr';

export interface ScanResult {
  success: boolean;
  data: LicenseData | null;
  mode: ScanMode;
  error: string | null;
}
