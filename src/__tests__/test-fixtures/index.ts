/**
 * T02_S08: Comprehensive Test Fixtures and Mock Strategies
 * Reusable test data and mock utilities for integration tests
 */

import type { Frame } from 'react-native-vision-camera';
import type {
  LicenseData,
  OCRTextObservation,
  ScanError as ScanErrorType,
} from '../../types/license';

// ===== LICENSE DATA FIXTURES =====

export const LicenseFixtures = {
  // Valid license data samples
  valid: {
    california: {
      firstName: 'JOHN',
      lastName: 'DOE',
      middleName: 'QUINCY',
      licenseNumber: 'D1234567',
      dateOfBirth: new Date('1990-01-15'),
      issueDate: new Date('2020-01-01'),
      expirationDate: new Date('2026-01-15'),
      sex: 'M' as const,
      eyeColor: 'BRO',
      hairColor: 'BRN',
      height: '5-10',
      weight: '180',
      address: {
        street: '123 MAIN ST',
        city: 'LOS ANGELES',
        state: 'CA',
        postalCode: '90210',
        country: 'USA',
      },
      licenseClass: 'C',
      restrictions: 'NONE',
      endorsements: 'NONE',
      issuerIdentificationNumber: '636014',
      documentDiscriminator: '1234567890123456789012345678',
      isOrganDonor: true,
      isVeteran: false,
      isRealID: true,
    } as LicenseData,

    texas: {
      firstName: 'JANE',
      lastName: 'SMITH',
      licenseNumber: 'TX12345678',
      dateOfBirth: new Date('1985-03-20'),
      expirationDate: new Date('2025-03-20'),
      sex: 'F' as const,
      address: {
        street: '456 OAK AVE',
        city: 'HOUSTON',
        state: 'TX',
        postalCode: '77001',
      },
      issuerIdentificationNumber: '636015',
      licenseClass: 'C',
    } as LicenseData,

    newYork: {
      firstName: 'ROBERT',
      lastName: 'JOHNSON',
      licenseNumber: 'NY123456789',
      dateOfBirth: new Date('1975-11-30'),
      expirationDate: new Date('2025-11-30'),
      sex: 'M' as const,
      address: {
        street: '789 BROADWAY',
        city: 'NEW YORK',
        state: 'NY',
        postalCode: '10001',
      },
      issuerIdentificationNumber: '636001',
      licenseClass: 'CDL',
      endorsements: 'HAZMAT',
    } as LicenseData,
  },

  // Expired licenses
  expired: {
    standard: {
      firstName: 'EXPIRED',
      lastName: 'LICENSE',
      licenseNumber: 'EXP123',
      dateOfBirth: new Date('1980-01-01'),
      expirationDate: new Date('2020-01-01'), // Expired
      sex: 'M' as const,
      address: { state: 'CA' },
    } as LicenseData,
  },

  // Incomplete data scenarios
  incomplete: {
    missingDOB: {
      firstName: 'INCOMPLETE',
      lastName: 'DATA',
      licenseNumber: 'INC123',
      sex: 'F' as const,
      // Missing dateOfBirth
    } as Partial<LicenseData>,

    missingAddress: {
      firstName: 'NO',
      lastName: 'ADDRESS',
      licenseNumber: 'NOADDR123',
      dateOfBirth: new Date('1990-01-01'),
      sex: 'M' as const,
      // Missing address
    } as Partial<LicenseData>,
  },
};

// ===== BARCODE DATA FIXTURES =====

export const BarcodeFixtures = {
  valid: {
    california:
      '@\n\x1e\rANSI 636014080000DAQ D1234567 DCSDOE DACJOHN DADQUINCY DBB01151990 DBA01152026 DBD01012020 DBC1 DAU510 DAG123 MAIN ST DAILOS ANGELES DAJCA DAK90210',
    texas:
      '@\n\x1e\rANSI 636015080000DAQ TX12345678 DCSSMITH DACJANE DBB03201985 DBA03202025',
    newYork:
      '@\n\x1e\rANSI 636001080000DAQ NY123456789 DCSJOHNSON DACROBERT DBB11301975 DBA11302025',
  },
  invalid: {
    malformed: 'INVALID_BARCODE_DATA_FORMAT',
    corrupted: '@\n\x1e\rANSI 636014080000DAQ CORRUPTED_DATA',
    empty: '',
    nonANSI: 'NOT_AN_ANSI_BARCODE_12345',
  },
};

// ===== OCR TEXT FIXTURES =====

export const OCRFixtures = {
  valid: {
    california: [
      {
        text: 'DRIVER LICENSE',
        confidence: 0.98,
        boundingBox: { x: 50, y: 20, width: 200, height: 25 },
      },
      {
        text: 'CALIFORNIA',
        confidence: 0.97,
        boundingBox: { x: 260, y: 20, width: 120, height: 25 },
      },
      {
        text: 'DOE, JOHN',
        confidence: 0.96,
        boundingBox: { x: 50, y: 80, width: 150, height: 30 },
      },
      {
        text: 'D1234567',
        confidence: 0.94,
        boundingBox: { x: 250, y: 110, width: 100, height: 25 },
      },
      {
        text: 'DOB 01/15/1990',
        confidence: 0.92,
        boundingBox: { x: 50, y: 140, width: 130, height: 20 },
      },
      {
        text: 'EXP 01/15/2026',
        confidence: 0.91,
        boundingBox: { x: 200, y: 140, width: 130, height: 20 },
      },
    ] as OCRTextObservation[],

    partial: [
      {
        text: 'DOE, J',
        confidence: 0.75,
        boundingBox: { x: 50, y: 80, width: 80, height: 30 },
      },
      {
        text: 'D1234---',
        confidence: 0.6,
        boundingBox: { x: 250, y: 110, width: 100, height: 25 },
      },
      {
        text: 'DOB 01/--/1990',
        confidence: 0.55,
        boundingBox: { x: 50, y: 140, width: 130, height: 20 },
      },
    ] as OCRTextObservation[],

    lowConfidence: [
      {
        text: 'DRIVER',
        confidence: 0.45,
        boundingBox: { x: 50, y: 20, width: 80, height: 25 },
      },
      {
        text: 'LICENSE',
        confidence: 0.4,
        boundingBox: { x: 140, y: 20, width: 100, height: 25 },
      },
    ] as OCRTextObservation[],
  },

  invalid: {
    empty: [] as OCRTextObservation[],
    gibberish: [
      {
        text: '!@#$%^&*()',
        confidence: 0.2,
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      },
    ] as OCRTextObservation[],
  },
};

// ===== ERROR FIXTURES =====

export const ErrorFixtures = {
  barcode: {
    invalidFormat: {
      code: 'INVALID_BARCODE_FORMAT',
      message: 'Invalid barcode format detected',
      userMessage: "This doesn't appear to be a valid driver's license barcode",
      recoverable: true,
    } as ScanErrorType,

    timeout: {
      code: 'TIMEOUT_ERROR',
      message: 'Barcode scan timeout',
      userMessage: 'Scanning took too long, please try again',
      recoverable: true,
    } as ScanErrorType,

    parsingFailed: {
      code: 'PARSING_FAILED',
      message: 'Failed to parse AAMVA data',
      userMessage: 'Unable to read license information',
      recoverable: true,
    } as ScanErrorType,
  },

  ocr: {
    parsingError: {
      code: 'OCR_PARSING_ERROR',
      message: 'OCR text parsing failed',
      userMessage: 'Unable to read text from license image',
      recoverable: true,
    } as ScanErrorType,

    lowConfidence: {
      code: 'LOW_CONFIDENCE_ERROR',
      message: 'OCR confidence too low',
      userMessage: 'License image quality is too low to read',
      recoverable: true,
    } as ScanErrorType,
  },

  system: {
    cameraPermission: {
      code: 'CAMERA_PERMISSION_DENIED',
      message: 'Camera permission required',
      userMessage: 'Please grant camera permission to scan licenses',
      recoverable: true,
    } as ScanErrorType,

    networkError: {
      code: 'NETWORK_ERROR',
      message: 'Network connection failed',
      userMessage: 'Check your internet connection and try again',
      recoverable: true,
    } as ScanErrorType,

    unknownError: {
      code: 'UNKNOWN_ERROR',
      message: 'An unexpected error occurred',
      userMessage: 'Something went wrong, please try again',
      recoverable: false,
    } as ScanErrorType,
  },
};

// ===== FRAME GENERATOR =====

export interface MockFrameOptions {
  width?: number;
  height?: number;
  bytesPerRow?: number;
  planesCount?: number;
  orientation?: string;
  timestamp?: number;
  pixelFormat?: string;
  quality?: 'high' | 'medium' | 'low';
  blur?: number;
  embedBarcode?: boolean;
  barcodeType?: 'pdf417' | 'qr' | 'code128';
  corrupted?: boolean;
}

export class MockFrameGenerator {
  static createFrame(options: MockFrameOptions = {}): Frame {
    const width = options.width || 1920;
    const height = options.height || 1080;

    return {
      width,
      height,
      bytesPerRow: options.bytesPerRow || width * 4,
      planesCount: options.planesCount || 1,
      orientation: options.orientation || 'portrait',
      timestamp: options.timestamp || Date.now(),
      isValid: !options.corrupted,
      isMirrored: false,
      pixelFormat: options.pixelFormat || 'yuv',
      planarImage: true,
      pixelBuffer: null, // Not used in mock
    } as Frame;
  }

  static createHighQualityFrame(): Frame {
    return this.createFrame({
      width: 1920,
      height: 1080,
      quality: 'high',
      embedBarcode: true,
      barcodeType: 'pdf417',
    });
  }

  static createLowQualityFrame(): Frame {
    return this.createFrame({
      width: 640,
      height: 480,
      quality: 'low',
      blur: 5,
      embedBarcode: true,
      barcodeType: 'pdf417',
    });
  }

  static createFrameWithoutBarcode(): Frame {
    return this.createFrame({
      width: 1920,
      height: 1080,
      embedBarcode: false,
    });
  }

  static createCorruptedFrame(): Frame {
    return this.createFrame({
      width: 100,
      height: 100,
      corrupted: true,
    });
  }

  static createFrameSequence(
    count: number,
    options: MockFrameOptions = {}
  ): Frame[] {
    return Array.from({ length: count }, (_, index) =>
      this.createFrame({
        ...options,
        timestamp: Date.now() + index * 100, // 100ms apart
      })
    );
  }
}

// ===== STATE CONFIGURATIONS =====

export const StateConfigurations = [
  { code: 'CA', iin: '636014', name: 'California' },
  { code: 'TX', iin: '636015', name: 'Texas' },
  { code: 'NY', iin: '636001', name: 'New York' },
  { code: 'FL', iin: '636010', name: 'Florida' },
  { code: 'WA', iin: '636045', name: 'Washington' },
  { code: 'OR', iin: '636029', name: 'Oregon' },
  { code: 'AZ', iin: '636026', name: 'Arizona' },
  { code: 'NV', iin: '636030', name: 'Nevada' },
  { code: 'CO', iin: '636020', name: 'Colorado' },
  { code: 'UT', iin: '636040', name: 'Utah' },
];

// ===== PERFORMANCE TEST DATA =====

export const PerformanceFixtures = {
  // Test data for measuring scan speed
  rapidSequence: {
    frameCount: 30,
    targetFPS: 2,
    maxProcessingTime: 500, // ms per frame
    totalTimeLimit: 15000, // 15 seconds total
  },

  // Memory leak detection
  memoryTest: {
    iterations: 100,
    maxMemoryIncrease: 50, // MB
    gcThreshold: 10, // Force GC every 10 iterations
  },

  // Load testing
  loadTest: {
    concurrent: 5,
    sequential: 50,
    timeoutPerScan: 2000, // ms
  },
};

// ===== MOCK RESPONSE GENERATORS =====

export class MockResponseGenerator {
  static successfulScan(
    licenseData: LicenseData = LicenseFixtures.valid.california
  ) {
    return {
      success: true,
      data: licenseData,
      processingTime: Math.random() * 100 + 50, // 50-150ms
      confidence: 0.85 + Math.random() * 0.15, // 0.85-1.0
    };
  }

  static failedScan(
    error: ScanErrorType = ErrorFixtures.barcode.invalidFormat
  ) {
    return {
      success: false,
      error,
      processingTime: Math.random() * 50 + 25, // 25-75ms
    };
  }

  static ocrResult(
    observations: OCRTextObservation[] = OCRFixtures.valid.california
  ) {
    return {
      success: true,
      fields: this.extractFieldsFromOCR(observations),
      confidence: this.calculateOverallConfidence(observations),
      processingTime: Math.random() * 200 + 100, // 100-300ms
    };
  }

  private static extractFieldsFromOCR(
    observations: OCRTextObservation[]
  ): Partial<LicenseData> {
    // Simplified field extraction for testing
    const fields: Partial<LicenseData> = {};

    observations.forEach((obs) => {
      if (obs.text.includes('DOE, JOHN')) {
        fields.firstName = 'JOHN';
        fields.lastName = 'DOE';
      }
      if (obs.text.startsWith('D') && obs.text.length >= 7) {
        fields.licenseNumber = obs.text;
      }
      if (obs.text.includes('DOB')) {
        const match = obs.text.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (match) {
          fields.dateOfBirth = new Date(match[1]);
        }
      }
    });

    return fields;
  }

  private static calculateOverallConfidence(
    observations: OCRTextObservation[]
  ): number {
    if (observations.length === 0) return 0;

    const totalConfidence = observations.reduce(
      (sum, obs) => sum + obs.confidence,
      0
    );
    return totalConfidence / observations.length;
  }
}

// ===== EXPORT DEFAULT COLLECTION =====

export const TestFixtures = {
  licenses: LicenseFixtures,
  barcodes: BarcodeFixtures,
  ocr: OCRFixtures,
  errors: ErrorFixtures,
  performance: PerformanceFixtures,
  states: StateConfigurations,
  frames: MockFrameGenerator,
  responses: MockResponseGenerator,
};

export default TestFixtures;
