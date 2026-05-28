import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

// Document type enum — nitrogen serializes string unions as strings.
export type DocumentType =
  | 'driver_license'
  | 'passport'
  | 'national_id'
  | 'residence_permit'
  | 'unknown';

// MRZ type discriminator
export type MRZTypeSpec = 'TD1' | 'TD2' | 'TD3';

// MRZ data struct — optional on LicenseDataSpec; present only for travel docs.
export interface MRZDataSpec {
  mrzType: MRZTypeSpec;
  documentCode: string;
  issuingState: string;
  documentNumber: string;
  primaryIdentifier: string;
  secondaryIdentifier: string;
  nationality: string;
  dateOfBirth: string;
  sex: Sex;
  dateOfExpiry: string;
  optionalData: string;
  checkDigitsValid: boolean;
}

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
  hairColor?: string;
  height?: string;
  weight?: string;
  vehicleClass?: string;
  restrictions?: string;
  endorsements?: string;
  aamvaVersion?: number;
  documentType?: DocumentType;
  mrz?: MRZDataSpec;
  /**
   * Per-field confidence scores in [0, 1]. Keys are camelCase names
   * matching the fields above (e.g. "firstName", "state", "postalCode").
   * Tiers, as populated by the C++ structured extractor:
   *   - 1.00 — content-shape + cross-validation (e.g. state code present
   *           AND zip-prefix consistent with that state)
   *   - 0.85 — content-shape only (date passed regex, state in lookup
   *           table, sex normalized to M/F/X, eye/hair in AAMVA whitelist)
   *   - 0.50 — extracted raw; no structural validation available
   *   - absent / 0.0 — field not populated
   * Surfaced as a JSON-encoded string because Nitro v0.35 generics on
   * Map<string, number> don't round-trip cleanly through the Cxx bridge
   * for arbitrary keys; consumers parse via JSON.parse().
   */
  dataConfidenceJson?: string;
  /**
   * file:// path to the perspective-corrected card image (JPEG) saved in
   * the app sandbox on the consensus frame. Absent when no card corners
   * were detected or the rectification failed.
   */
  cardImagePath?: string;
  /**
   * file:// path to the cropped headshot (JPEG) extracted from the card
   * via platform face detection (VNDetectFaceRectanglesRequest on iOS,
   * MLKit FaceDetection on Android). Falls back to the YOLO "face" class
   * bbox if face detection finds nothing. Absent when neither method
   * located a face region.
   */
  headshotImagePath?: string;
}

export interface DlScan extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /**
   * Scan progress as a monotonically increasing float in [0, 1].
   * Updated on each frame processor call. Reset to 0 by
   * resetLicenseFieldRecognition(). JS reads this property in the
   * frame processor worklet to drive a progress bar.
   *
   * Progress is weighted by stabilized-field count, not raw frame
   * count, so it advances as fields lock in rather than linearly
   * with time. design review consensus.
   */
  readonly scanProgress: number;

  /**
   * Pipeline processing stage. Set synchronously at each step boundary
   * during the extraction pipeline. Read by the PipelineOverlay to show
   * real step completion signals.
   *
   * 0 = idle (scanning, voter accumulating)
   * 1 = extracting fields (C++ extract_fields_from_candidates)
   * 2 = normalizing data (C++ per-field normalizers)
   * 3 = saving card image (perspective correction + JPEG encode)
   * 4 = detecting face (platform face detection + headshot crop)
   * 5 = done (result ready)
   *
   * Reset to 0 by resetLicenseFieldRecognition().
   */
  readonly pipelineStage: number;

  /**
   * Last-detected card corners as 8 floats [x0,y0, x1,y1, x2,y2, x3,y3]
   * in normalized [0,1] coordinates relative to the oriented camera image.
   * Updated on every frame where doc-seg finds a card. Empty array when
   * no card is detected. JS reads this to animate the reticle to follow
   * the card's position.
   */
  readonly detectedCardCorners: number[];

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

  /**
   * Reset the OCR-mode field-recognition cache. Call from the JS side when
   * the consumer's scan session ends (e.g., after a successful read or when
   * `useLicenseScanner.reset()` runs) so that the next scan does NOT see a
   * stale cached result from the previous card. Also invalidates any
   * in-flight detection job — its result will be discarded if the
   * generation has changed by the time it lands.
   */
  resetLicenseFieldRecognition(): void;
}
