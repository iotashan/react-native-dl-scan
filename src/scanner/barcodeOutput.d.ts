// Type-only declaration that lets TypeScript resolve
// `./scanner/barcodeOutput` without picking a platform. Metro
// resolves the actual implementation at bundle time:
//   - iOS    → ./barcodeOutput.ios.ts  (Vision Camera v5 + AVFoundation)
//   - Android → ./barcodeOutput.android.ts (vision-camera-barcode-scanner + MLKit)
//
// This file holds the shared TYPE contract so the orchestrator
// (`useLicenseScanner`) doesn't import platform-specific source.

import type { CameraOutput } from 'react-native-vision-camera';

export interface UseBarcodeOutputOptions {
  /** Called with the raw AAMVA payload string when the scanner
   *  decodes a PDF-417 that starts with `@\nANSI ` (or `@\rANSI `).
   *  The orchestrator pipes this through `NativeDlScan.parseBarcodeData`.
   *  Fires once per decoded frame; the orchestrator de-duplicates
   *  via a result latch. */
  onAamvaString: (raw: string) => void;
  /** Scanner-thread error message string. */
  onError: (message: string) => void;
}

export declare function useBarcodeOutput(
  options: UseBarcodeOutputOptions
): CameraOutput;
