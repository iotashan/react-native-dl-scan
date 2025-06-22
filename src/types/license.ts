export interface LicenseData {
  // Personal Information
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;

  // Dates
  dateOfBirth?: Date;
  issueDate?: Date;
  expirationDate?: Date;

  // Physical Description
  sex?: 'M' | 'F';
  eyeColor?: string;
  hairColor?: string;
  height?: string;
  weight?: string;

  // Address
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };

  // License Information
  licenseNumber?: string;
  licenseClass?: string;
  restrictions?: string;
  endorsements?: string;

  // Metadata
  issuerIdentificationNumber?: string;
  documentDiscriminator?: string;

  // Flags
  isOrganDonor?: boolean;
  isVeteran?: boolean;
  isRealID?: boolean;

  // Raw data for debugging
  allFields?: Record<string, string>;
}

export interface ScanError {
  code: string;
  message: string;
  userMessage: string;
  recoverable: boolean;
}

export interface LicenseResult {
  success: boolean;
  data?: LicenseData;
  error?: ScanError;
  processingTime?: number;
}

export interface OCRTextObservation {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type ScanMode = 'auto' | 'barcode' | 'ocr';

export type ScanningState =
  | 'idle'
  | 'barcode'
  | 'ocr'
  | 'fallback_transition'
  | 'completed'
  | 'failed';

export interface FallbackConfig {
  barcodeTimeoutMs: number;
  maxBarcodeAttempts: number;
  maxFallbackProcessingTimeMs: number;
  enableQualityAssessment: boolean;
  enableFallback?: boolean;
  confidenceThreshold?: number;
}

export interface ScanProgress {
  state: ScanningState;
  mode: ScanMode;
  startTime: number;
  barcodeAttempts: number;
  timeElapsed: number;
  message?: string;
}

export interface ScanMetrics {
  totalProcessingTime: number;
  barcodeAttemptTime: number;
  ocrProcessingTime: number;
  fallbackTriggered: boolean;
  fallbackReason?: 'timeout' | 'failure' | 'quality' | 'manual';
  finalMode: ScanMode;
  success: boolean;
}
