export interface LicenseData {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  licenseNumber?: string;
  dateOfBirth?: Date;
  expirationDate?: Date;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  // Additional fields that may be present in AAMVA data
  sex?: string;
  height?: string;
  weight?: string;
  eyeColor?: string;
  hairColor?: string;
  issueDate?: Date;
  documentId?: string;
  restrictionCodes?: string[];
  endorsementCodes?: string[];
  vehicleClassifications?: string[];
}

export interface ScanError {
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
}

export interface ScanResult {
  success: boolean;
  data?: LicenseData;
  error?: ScanError;
}
