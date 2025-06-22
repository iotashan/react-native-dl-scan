import DlScanModule from './NativeDlScan';
import type {
  LicenseData,
  LicenseResult,
  ScanError as ScanErrorType,
  OCRTextObservation,
} from './types/license';

export * from './types/license';
export { useLicenseScanner } from './hooks/useLicenseScanner';
export type {
  LicenseScannerOptions,
  LicenseScannerState,
  LicenseScannerActions,
} from './hooks/useLicenseScanner';
export { scanLicense as scanLicenseFrame } from './frameProcessors/scanLicense';
export type { ScanLicenseResult } from './frameProcessors/scanLicense';
export { CameraScanner } from './components/CameraScanner';
export type { CameraScannerProps } from './components/CameraScanner';
export { FallbackController } from './utils/FallbackController';
export type {
  FallbackControllerEvents,
  PerformanceAlert,
} from './utils/FallbackController';

/**
 * Parse OCR text observations into structured license data
 *
 * @param textObservations Array of text observations from Vision Framework OCR
 * @returns Promise<LicenseData> Structured license data
 */
export async function parseOCRText(
  textObservations: OCRTextObservation[]
): Promise<LicenseData> {
  try {
    const result: LicenseResult =
      await DlScanModule.parseOCRText(textObservations);

    if (result.success && result.data) {
      return result.data;
    } else if (result.error) {
      throw new ScanError(result.error);
    } else {
      throw new Error('No license data could be extracted from OCR text');
    }
  } catch (error) {
    if (error instanceof ScanError) {
      throw error;
    }

    // Handle native errors
    throw new ScanError({
      code: 'OCR_PARSING_ERROR',
      message: (error as Error).message || 'OCR parsing failed',
      userMessage:
        'Unable to process the license image. Please try again with better lighting.',
      recoverable: true,
    });
  }
}

/**
 * Scan a PDF417 barcode string and extract license data
 */
export async function scanLicense(barcodeData: string): Promise<LicenseData> {
  try {
    const result: LicenseResult = await DlScanModule.scanLicense(barcodeData);

    if (result.success && result.data) {
      return result.data;
    } else if (result.error) {
      throw new ScanError(result.error);
    } else {
      throw new Error('Unknown scanning error');
    }
  } catch (error) {
    if (error instanceof ScanError) {
      throw error;
    }

    // Handle native errors
    throw new ScanError({
      code: 'UNKNOWN_ERROR',
      message: (error as Error).message || 'Unknown error occurred',
      userMessage: 'An unexpected error occurred. Please try again.',
      recoverable: true,
    });
  }
}

/**
 * Custom error class for scanning errors
 */
export class ScanError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly recoverable: boolean;

  constructor(error: ScanErrorType) {
    super(error.message);
    this.name = 'ScanError';
    this.code = error.code;
    this.userMessage = error.userMessage;
    this.recoverable = error.recoverable;
  }
}
