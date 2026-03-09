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
}

export type ScanMode = 'barcode' | 'ocr';

export interface ScanResult {
  success: boolean;
  data: LicenseData | null;
  mode: ScanMode;
  error: string | null;
}
