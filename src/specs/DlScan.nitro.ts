import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

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

  /**
   * Synchronously called from a frame-processor worklet. Returns the latest
   * cached OCR result, or null if no result is available yet.
   *
   * Behavior: each call submits a new VisionKit + extract_ocr_fields job on
   * a serial queue (rate-limited internally to ~2 fps). The first non-null
   * result becomes available a few frames after the first call. Once the
   * caller has consumed a non-null result, they should stop calling this
   * method (e.g., by setting hasResult.value = true in their worklet) — the
   * cache is not auto-cleared.
   *
   * The Frame is consumed (not retained) within this call's pixel-buffer
   * read; safe to call frame.dispose() immediately after.
   */
  recognizeLicenseFields(frame: Frame): LicenseDataSpec | null;
}
