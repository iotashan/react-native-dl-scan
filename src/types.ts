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

// ===== Typed value sets (task #52) =====
//
// sex / eyeColor / hairColor are AAMVA-coded enumerations on the card. The
// native layer keeps returning the RAW string (via LicenseDataSpec); JS
// (normalizeLicenseData → toTypedValue) maps each raw value to a discriminated
// union so consumers can branch on a known code OR explicitly handle anything
// off-spec. The `'other'` branch ALWAYS preserves the original (trimmed) raw
// string, which lets a consumer map an unrecognized value to whatever an older
// downstream system expects (e.g. a two-value gender field). The user's intent:
// "map to older mainframe systems that maybe only have two genders".

/** AAMVA D20 sex codes. (1/2/9 numeric forms are normalized to M/F/X upstream.) */
export type SexCode = 'M' | 'F' | 'X';

/** AAMVA D20 eye-color codes. */
export type EyeColorCode =
  | 'BLK'
  | 'BLU'
  | 'BRO'
  | 'GRY'
  | 'GRN'
  | 'HAZ'
  | 'MAR'
  | 'PNK'
  | 'DIC'
  | 'UNK';

/** AAMVA D20 hair-color codes. */
export type HairColorCode =
  | 'BAL'
  | 'BLK'
  | 'BLN'
  | 'BRO'
  | 'GRY'
  | 'RED'
  | 'SDY'
  | 'WHI'
  | 'UNK';

/**
 * A typed value-set field. Either a recognized `code` from the field's known
 * set, OR `{ code: 'other', raw }` carrying the original (trimmed) value the
 * card presented but the spec doesn't enumerate. A null field stays null (the
 * scanner read nothing) — `'other'` is never fabricated from emptiness.
 */
export type TypedValue<C extends string> =
  | { code: C }
  | { code: 'other'; raw: string };

export type SexValue = TypedValue<SexCode>;
export type EyeColorValue = TypedValue<EyeColorCode>;
export type HairColorValue = TypedValue<HairColorCode>;

/**
 * The known-code sets, frozen at runtime so consumers can reuse them (e.g. to
 * populate a dropdown) without risk of mutation. Matching is case-insensitive
 * and whitespace-trimmed (see `toTypedValue`).
 */
export const SEX_CODES: readonly SexCode[] = Object.freeze([
  'M',
  'F',
  'X',
] as const);

export const EYE_COLOR_CODES: readonly EyeColorCode[] = Object.freeze([
  'BLK',
  'BLU',
  'BRO',
  'GRY',
  'GRN',
  'HAZ',
  'MAR',
  'PNK',
  'DIC',
  'UNK',
] as const);

export const HAIR_COLOR_CODES: readonly HairColorCode[] = Object.freeze([
  'BAL',
  'BLK',
  'BLN',
  'BRO',
  'GRY',
  'RED',
  'SDY',
  'WHI',
  'UNK',
] as const);

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
  /**
   * Sex/gender as a typed value set (task #52). `{ code: 'M' | 'F' | 'X' }`
   * for a recognized AAMVA code, or `{ code: 'other', raw }` preserving the
   * original card value. Null when the scanner read nothing.
   */
  sex: SexValue | null;
  /**
   * Eye color as a typed value set (AAMVA D20). `{ code }` for a recognized
   * code, or `{ code: 'other', raw }` for an off-spec value. Null when unread.
   */
  eyeColor: EyeColorValue | null;
  /**
   * Hair color as a typed value set (AAMVA D20). `{ code }` for a recognized
   * code, or `{ code: 'other', raw }` for an off-spec value. Null when unread.
   */
  hairColor: HairColorValue | null;
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
   *   marker_located    (0.88) — free-text value (name/street) located by its
   *                              authoritative AAMVA marker; no content-shape
   *                              check is possible, but provenance is assured.
   *                              Ranked ABOVE shape_matched.
   *   shape_matched     (0.85) — value matches expected regex shape
   *   extracted_raw     (0.50) — value extracted but no content check, and not
   *                              anchored to its marker (unanchored fallback)
   */
  dataConfidence?: Record<string, ConfidenceEntry> | null;
  cardImagePath: string | null;
  /**
   * Per-line OCR observations over the saved card image. Present only
   * when `cardImagePath` is present — the boxes describe that EXACT
   * image. Null/absent on the barcode path or when the card-image OCR
   * pass failed. See {@link OcrObservation} for the coordinate contract.
   */
  ocrObservations?: OcrObservation[] | null;
  headshotImagePath: string | null;
}

/**
 * One recognized OCR text line on the saved card image (`cardImagePath`).
 *
 * Coordinate contract: `x`/`y`/`width`/`height` are normalized to [0, 1]
 * relative to the image at `cardImagePath`, origin TOP-LEFT, +y down;
 * `(x, y)` is the box's top-left corner. Multiply by the rendered image's
 * width/height to position an overlay.
 */
export interface OcrObservation {
  /** The recognized text of this OCR line. */
  text: string;
  /** Normalized [0,1] left edge. */
  x: number;
  /** Normalized [0,1] top edge (+y down). */
  y: number;
  /** Normalized [0,1] box width. */
  width: number;
  /** Normalized [0,1] box height. */
  height: number;
}

export type ConfidenceTier =
  | 'cross_validated'
  | 'all_gates_passed'
  | 'marker_located'
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

/**
 * Render a typed value-set field for display. Returns the bare code for a
 * recognized value (e.g. "M", "BRO"), the preserved raw string for an
 * `'other'` value, and null for an absent field. Pure helper for UI layers —
 * consumers that want their own formatting can switch on `.code` directly.
 */
export function formatTypedValue(
  v: TypedValue<string> | null | undefined
): string | null {
  if (v == null) return null;
  // Structural narrowing: only the `'other'` branch carries `raw`. (Switching
  // on `v.code === 'other'` doesn't narrow when C is the open `string` type,
  // because `{ code: C }` then also admits `code: 'other'`.)
  return 'raw' in v ? v.raw : v.code;
}
