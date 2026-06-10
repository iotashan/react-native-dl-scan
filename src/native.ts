// Module-scope singletons that scanFrame.ts and useLicenseScanner.ts both
// need at runtime. Defining them here (instead of in index.ts as before)
// breaks the require cycle that metro warned about:
//
//   index -> scanFrame -> index
//   index -> useLicenseScanner -> index
//
// index.ts re-exports from this file for the public API.

import { NitroModules } from 'react-native-nitro-modules';
import type {
  DLScan as DLScanSpec,
  LicenseDataSpec,
} from './specs/DLScan.nitro';
import type {
  LicenseData,
  MRZData,
  DocumentType,
  ConfidenceEntry,
  ConfidenceTier,
  SexValue,
  EyeColorValue,
  HairColorValue,
  TypedValue,
} from './types';
import { SEX_CODES, EYE_COLOR_CODES, HAIR_COLOR_CODES } from './types';

export type { LicenseDataSpec };

// Lazily initialised via the proxy from Nitro. Single instance shared by
// the JS bridge surface (NativeDLScan) and the camera-thread worklets
// (scanFrame.ts).
export const _hybrid = NitroModules.createHybridObject<DLScanSpec>('DLScan');

// Nitro maps optional struct fields to `T | undefined` on the JS side, but
// the public LicenseData contract uses `T | null`. Normalize here so
// consumers always receive null for absent fields rather than undefined.
export const undefinedToNull = <T>(v: T | undefined): T | null =>
  v === undefined ? null : v;

// Collapse repeated identical lines in a multi-line field value. The address
// (list_8f) bbox can be tall enough that per-region OCR / overlapping
// observations capture the same street line several times, yielding e.g.
// "4827 LAKERIDGE DR\n4827 LAKERIDGE DR\n4827 LAKERIDGE DR". This keeps
// genuinely distinct lines (e.g. "APT 5" + a street) but removes exact repeats
// (case-insensitive). The C++ `strip_duplicate_city_state_zip_suffix` handles a
// different "double-up" (street ending in the city/state/zip); this covers
// identical line repeats. Returns null if nothing survives.
export const dedupeLines = (v: string | null): string | null => {
  if (v == null) return v;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const key = line.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.length > 0 ? out.join('\n') : null;
};

// Clean the street (address line 1): de-dupe repeated lines, then drop any
// line that is actually the city/state/ZIP row (those are separate fields).
// The address bbox often captures both rows, leaving the CSZ line glued onto
// `street` (e.g. "4827 LAKERIDGE DR\nFAIRBROOK, WI 54016"). Drop a line if
// it contains the parsed ZIP, or matches a "<CITY,> ST 12345" shape. Never
// returns empty: if every line looked like a CSZ row, keep the de-duped value.
export const cleanStreet = (
  v: string | null,
  postalCode: string | null
): string | null => {
  const deduped = dedupeLines(v);
  if (deduped == null) return null;
  const zip = postalCode != null ? postalCode.trim() : '';
  // A city/state/ZIP row ends with "<2-letter state> <5-digit ZIP>". Only drop
  // a line that actually matches that shape (or whose trailing token is the
  // parsed ZIP) — NOT any line that merely contains the ZIP digits, so a real
  // street like "12345 COUNTY ROAD 7" is preserved.
  const cszShape = /[A-Za-z]{2}\s+\d{5}(?:-\d{4})?\s*$/;
  const lines = deduped.split('\n');
  const kept = lines.filter((l) => {
    if (cszShape.test(l)) return false;
    if (zip.length >= 5 && l.trim().endsWith(zip)) return false;
    return true;
  });
  return (kept.length > 0 ? kept : lines).join('\n');
};

// Map a raw AAMVA-coded value (sex / eyeColor / hairColor) to the public typed
// value-set union (task #52). The native layer still returns plain strings; the
// enumeration happens here so it is fully unit-testable with no native rebuild.
//
//  - null/undefined/empty (after trim) → null. Never fabricate 'other' from
//    emptiness: a blank field means the scanner read nothing.
//  - matches a known code (case-insensitive, trimmed) → { code }.
//  - anything else → { code: 'other', raw } where `raw` is the ORIGINAL value
//    with only surrounding whitespace trimmed (case preserved) so a consumer
//    can map it to whatever a downstream system expects.
//
// `knownSet` is the field's frozen code array (SEX_CODES / EYE_COLOR_CODES /
// HAIR_COLOR_CODES). Codes are uppercase ASCII, so an uppercased comparison is
// the canonical match.
export const toTypedValue = <C extends string>(
  raw: string | null | undefined,
  knownSet: readonly C[]
): TypedValue<C> | null => {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const upper = trimmed.toUpperCase();
  if ((knownSet as readonly string[]).includes(upper)) {
    return { code: upper as C };
  }
  return { code: 'other', raw: trimmed };
};

// Normalize a LicenseDataSpec (Nitro raw shape) to the public LicenseData type.
export function normalizeLicenseData(result: LicenseDataSpec): LicenseData {
  return {
    firstName: undefinedToNull(result.firstName),
    lastName: undefinedToNull(result.lastName),
    middleName: undefinedToNull(result.middleName),
    dateOfBirth: undefinedToNull(result.dateOfBirth),
    expirationDate: undefinedToNull(result.expirationDate),
    issueDate: undefinedToNull(result.issueDate),
    licenseNumber: undefinedToNull(result.licenseNumber),
    street: cleanStreet(
      undefinedToNull(result.street),
      undefinedToNull(result.postalCode)
    ),
    city: undefinedToNull(result.city),
    state: undefinedToNull(result.state),
    postalCode: undefinedToNull(result.postalCode),
    country: undefinedToNull(result.country),
    sex: toTypedValue(result.sex, SEX_CODES) as SexValue | null,
    eyeColor: toTypedValue(
      result.eyeColor,
      EYE_COLOR_CODES
    ) as EyeColorValue | null,
    hairColor: toTypedValue(
      result.hairColor,
      HAIR_COLOR_CODES
    ) as HairColorValue | null,
    height: undefinedToNull(result.height),
    weight: undefinedToNull(result.weight),
    vehicleClass: undefinedToNull(result.vehicleClass),
    restrictions: undefinedToNull(result.restrictions),
    endorsements: undefinedToNull(result.endorsements),
    aamvaVersion: undefinedToNull(result.aamvaVersion),
    documentType: undefinedToNull(result.documentType) as DocumentType | null,
    mrz: undefinedToNull(
      result.mrz != null
        ? ({
            mrzType: result.mrz.mrzType as MRZData['mrzType'],
            documentCode: result.mrz.documentCode,
            issuingState: result.mrz.issuingState,
            documentNumber: result.mrz.documentNumber,
            primaryIdentifier: result.mrz.primaryIdentifier,
            secondaryIdentifier: result.mrz.secondaryIdentifier,
            nationality: result.mrz.nationality,
            dateOfBirth: result.mrz.dateOfBirth,
            sex: result.mrz.sex as MRZData['sex'],
            dateOfExpiry: result.mrz.dateOfExpiry,
            optionalData: result.mrz.optionalData,
            checkDigitsValid: result.mrz.checkDigitsValid,
          } satisfies MRZData)
        : undefined
    ),
    // Decode JSON-encoded per-field confidence map from native side.
    // Task #38: native uses string transport because Nitro v0.35 generics
    // don't round-trip Map<string,number> cleanly. Decode here so JS
    // consumers see a plain object.
    dataConfidence:
      result.dataConfidenceJson != null && result.dataConfidenceJson !== ''
        ? safeParseConfidence(result.dataConfidenceJson)
        : null,
    cardImagePath: undefinedToNull(result.cardImagePath),
    // OcrObservationSpec and the public OcrObservation are structurally
    // identical plain objects; pass through, normalizing only the
    // undefined → null convention.
    ocrObservations: undefinedToNull(result.ocrObservations),
    headshotImagePath: undefinedToNull(result.headshotImagePath),
    scanTimings: safeParseTimings(result.scanTimingsJson),
  };
}

/** Decode the scanTimingsJson wire string; null on any malformed input
 *  (fail-soft — timings are diagnostics, never worth failing a scan). */
function safeParseTimings(
  json: string | undefined
): Record<string, number> | null {
  if (json == null || json === '') return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed == null || typeof parsed !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

// Score→tier fallback for the v1 bare-number wire format (backwards-compat
// during the migration window). v2 wire format includes the tier name
// explicitly; this is only used when the native side hasn't been upgraded
// yet. Order matters: cascades top-down so an exact 0.85 returns the
// canonical tier rather than falling through.
function tierForScore(score: number): ConfidenceTier {
  if (score >= 1.0) return 'cross_validated';
  if (score >= 0.95) return 'all_gates_passed';
  if (score >= 0.88) return 'marker_located';
  if (score >= 0.85) return 'shape_matched';
  return 'extracted_raw';
}

const VALID_TIERS: ReadonlySet<ConfidenceTier> = new Set<ConfidenceTier>([
  'cross_validated',
  'all_gates_passed',
  'marker_located',
  'shape_matched',
  'extracted_raw',
]);

function safeParseConfidence(
  json: string
): Record<string, ConfidenceEntry> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed == null || typeof parsed !== 'object') return null;
    const out: Record<string, ConfidenceEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      // v2 wire: {score, tier}. Validate both fields.
      if (v != null && typeof v === 'object') {
        const obj = v as { score?: unknown; tier?: unknown };
        if (
          typeof obj.score === 'number' &&
          Number.isFinite(obj.score) &&
          typeof obj.tier === 'string' &&
          VALID_TIERS.has(obj.tier as ConfidenceTier)
        ) {
          out[k] = { score: obj.score, tier: obj.tier as ConfidenceTier };
        }
        continue;
      }
      // v1 wire (backwards-compat): bare number. Derive tier from score.
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = { score: v, tier: tierForScore(v) };
      }
    }
    return out;
  } catch {
    return null;
  }
}

export const NativeDLScan = {
  parseBarcodeData: async (
    barcodeData: string
  ): Promise<LicenseData | null> => {
    const result = await _hybrid.parseBarcodeData(barcodeData);
    if (result == null) return null;
    return normalizeLicenseData(result);
  },
};
