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
  toTypedValue,
} from './native';
export type { LicenseDataSpec } from './native';

export { scanFrame } from './scanFrame';
export {
  useLicenseScanner,
  DEFAULT_REQUIRED_FIELDS,
  STRICT_REQUIRED_FIELDS,
} from './useLicenseScanner';
export type {
  OcrModelSources,
  ScanCompletionPolicy,
  ScanStatus,
  ScanPhase,
  TtaMode,
} from './useLicenseScanner';

// Unified TFLite runtime (react-native-fast-tflite), JS-orchestrated.
export {
  loadDetectorModels,
  loadFieldModel,
  runFieldDetection,
  runDocAligner,
} from './detector';
export type { DetectorModels, FieldDetectionSpec } from './detector';
export { formatTypedValue } from './types';
export { SEX_CODES, EYE_COLOR_CODES, HAIR_COLOR_CODES } from './types';
export type {
  LicenseData,
  ScanResult,
  ScanMode,
  DocumentType,
  MRZData,
  ConfidenceEntry,
  ConfidenceTier,
  TypedValue,
  SexValue,
  EyeColorValue,
  HairColorValue,
  SexCode,
  EyeColorCode,
  HairColorCode,
} from './types';
