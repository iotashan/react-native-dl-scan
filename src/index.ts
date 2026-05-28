// Public surface for react-native-dl-scan.
//
// Module-scope singletons (_hybrid, NativeDlScan, normalizeLicenseData,
// undefinedToNull) live in ./native to keep both worklet code (scanFrame.ts)
// and the React-side hook (useLicenseScanner.ts) able to import from a leaf
// module — without the index <-> scanFrame / index <-> useLicenseScanner
// require cycles metro warned about.

export {
  _hybrid,
  NativeDlScan,
  normalizeLicenseData,
  undefinedToNull,
} from './native';
export type { LicenseDataSpec } from './native';

export { scanFrame } from './scanFrame';
export { useLicenseScanner } from './useLicenseScanner';
export type {
  LicenseData,
  ScanResult,
  ScanMode,
  DocumentType,
  MRZData,
  ConfidenceEntry,
  ConfidenceTier,
} from './types';
