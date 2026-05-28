// Android PDF-417 barcode scanner (task #77 follow-up to #71).
//
// Uses `react-native-vision-camera-barcode-scanner`'s
// `useBarcodeScannerOutput` (mrousavy), which is backed by Google ML
// Kit's BarcodeScanning. ML Kit IS the right tool on Android — there's
// no comparable native Android barcode-scanning API for PDF-417, and
// ML Kit's Android binary works correctly across all Android arches
// (arm64-v8a, armeabi-v7a, x86_64). The arm64-iphonesimulator gap that
// motivated the iOS platform split here doesn't apply to Android.
//
// Output-shape contract is identical to the iOS variant
// (`barcodeOutput.ios.ts`) so the shared `useLicenseScanner`
// orchestrator doesn't need to know which scanner is underneath.

import type { CameraOutput } from 'react-native-vision-camera';
import {
  useBarcodeScannerOutput,
  type Barcode,
} from 'react-native-vision-camera-barcode-scanner';

// Module-level constant so `useBarcodeScannerOutput`'s identity-based
// useMemo doesn't allocate a new `barcodeFormats` array each render
// and tear down + recreate the underlying MLKit scanner. Mirrors the
// iOS-side memoization in `barcodeOutput.ios.ts`. The literal annotation
// gives the narrow `TargetBarcodeFormat` element type the scanner
// requires (excludes `'unknown'`) while keeping the array mutable.
const FORMATS: 'pdf-417'[] = ['pdf-417'];

function isAamvaPayload(raw: string): boolean {
  return raw.startsWith('@') && raw.includes('ANSI ');
}

export interface UseBarcodeOutputOptions {
  onAamvaString: (raw: string) => void;
  onError: (message: string) => void;
}

export function useBarcodeOutput(
  options: UseBarcodeOutputOptions
): CameraOutput {
  const { onAamvaString, onError } = options;
  return useBarcodeScannerOutput({
    barcodeFormats: FORMATS,
    // PDF417 on a driver license is small + dense (~5cm × 1cm with
    // sub-millimeter modules). 'preview' resolution is often too low
    // for MLKit to resolve individual modules. 'full' uses the
    // camera's max buffer size at the cost of higher CPU per frame
    // but is necessary for license-scale PDF417 reliability.
    outputResolution: 'full',
    onBarcodeScanned: (codes: Barcode[]) => {
      for (const c of codes) {
        const raw = c.rawValue ?? '';
        // We don't trust MLKit's format classification because it
        // can mis-tag out-of-focus PDF417 as code-128 (only one row
        // glimpsed). The AAMVA-header sentinel is the source of truth.
        if (isAamvaPayload(raw)) {
          onAamvaString(raw);
          return;
        }
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
    },
  });
}
