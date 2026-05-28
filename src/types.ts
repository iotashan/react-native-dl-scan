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
  hairColor: string | null;
  height: string | null;
  weight: string | null;
  vehicleClass: string | null;
  restrictions: string | null;
  endorsements: string | null;
  aamvaVersion: number | null;
  documentType?: DocumentType | null;
  mrz?: MRZData | null;
  /**
   * Per-field confidence info. Keys are camelCase field names matching
   * the fields above. Each value carries both a numeric `score` in [0, 1]
   * AND the canonical `tier` name so consumers can branch on semantics
   * rather than magic floats. Decoded from native dataConfidenceJson by
   * normalizeLicenseData. Absent key = field not populated.
   *
   * Tier ladder (v2 Sequence F — task #51):
   *   cross_validated   (1.00) — two independent checks agree
   *   all_gates_passed  (0.95) — 4-gate strict demographic parser
   *   shape_matched     (0.85) — value matches expected regex shape
   *   extracted_raw     (0.50) — value extracted but no content check
   */
  dataConfidence?: Record<string, ConfidenceEntry> | null;
  cardImagePath: string | null;
  headshotImagePath: string | null;
}

export type ConfidenceTier =
  | 'cross_validated'
  | 'all_gates_passed'
  | 'shape_matched'
  | 'extracted_raw';

export interface ConfidenceEntry {
  score: number;
  tier: ConfidenceTier;
}

export type ScanMode = 'barcode' | 'ocr';

export interface ScanResult {
  success: boolean;
  data: LicenseData | null;
  mode: ScanMode;
  error: string | null;
}
