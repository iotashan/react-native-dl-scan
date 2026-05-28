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
  DlScan as DlScanSpec,
  LicenseDataSpec,
} from './specs/DlScan.nitro';
import type {
  LicenseData,
  MRZData,
  DocumentType,
  ConfidenceEntry,
  ConfidenceTier,
} from './types';

export type { LicenseDataSpec };

// Lazily initialised via the proxy from Nitro. Single instance shared by
// the JS bridge surface (NativeDlScan) and the camera-thread worklets
// (scanFrame.ts).
export const _hybrid = NitroModules.createHybridObject<DlScanSpec>('DlScan');

// Nitro maps optional struct fields to `T | undefined` on the JS side, but
// the public LicenseData contract uses `T | null`. Normalize here so
// consumers always receive null for absent fields rather than undefined.
export const undefinedToNull = <T>(v: T | undefined): T | null =>
  v === undefined ? null : v;

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
    street: undefinedToNull(result.street),
    city: undefinedToNull(result.city),
    state: undefinedToNull(result.state),
    postalCode: undefinedToNull(result.postalCode),
    country: undefinedToNull(result.country),
    sex: undefinedToNull(result.sex),
    eyeColor: undefinedToNull(result.eyeColor),
    hairColor: undefinedToNull(result.hairColor),
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
    headshotImagePath: undefinedToNull(result.headshotImagePath),
  };
}

// Score→tier fallback for the v1 bare-number wire format (backwards-compat
// during the migration window). v2 wire format includes the tier name
// explicitly; this is only used when the native side hasn't been upgraded
// yet. Order matters: cascades top-down so an exact 0.85 returns the
// canonical tier rather than falling through.
function tierForScore(score: number): ConfidenceTier {
  if (score >= 1.0) return 'cross_validated';
  if (score >= 0.95) return 'all_gates_passed';
  if (score >= 0.85) return 'shape_matched';
  return 'extracted_raw';
}

const VALID_TIERS: ReadonlySet<ConfidenceTier> = new Set<ConfidenceTier>([
  'cross_validated',
  'all_gates_passed',
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

export const NativeDlScan = {
  parseBarcodeData: async (
    barcodeData: string
  ): Promise<LicenseData | null> => {
    const result = await _hybrid.parseBarcodeData(barcodeData);
    if (result == null) return null;
    return normalizeLicenseData(result);
  },
};
