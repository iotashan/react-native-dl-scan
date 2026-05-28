// iOS PDF-417 barcode scanner (task #77 follow-up to #71).
//
// Uses Vision Camera v5's BUILT-IN object output (`useObjectOutput`),
// which on iOS is backed by `AVCaptureMetadataOutput` +
// `AVMetadataMachineReadableCodeObject` — pure AVFoundation. NO MLKit.
//
// This was a deliberate split from the original
// `react-native-vision-camera-barcode-scanner` scanner (mrousavy),
// which uses GoogleMLKit/BarcodeScanning on iOS even though its iOS-
// only feature surface is a near-perfect overlap with Vision Camera v5's
// own built-in detection. GoogleMLKit 8.x still ships no
// `arm64-iphonesimulator` slice (its podspec sets
// EXCLUDED_ARCHS=arm64 on iphonesimulator), which forces consumers'
// iOS-sim builds to x86_64 — unrunnable on Apple Silicon simulators.
// AVFoundation has no such gap, so the iOS sim can now exercise the
// full PDF-417 → AAMVA pipeline (e.g. driven by SimCam).
//
// Output-shape contract is identical across platforms (.ios.ts and
// .android.ts both export the same `useBarcodeOutput` signature) so
// the shared `useLicenseScanner` orchestrator doesn't need to know
// which scanner is underneath.

import {
  isScannedCode,
  useObjectOutput,
  type CameraOutput,
  type ScannedObject,
  type ScannedObjectType,
} from 'react-native-vision-camera';

// Module-level constant so `useObjectOutput`'s identity-based useMemo
// doesn't allocate a new `enabledObjectTypes` array each render and
// thereby tear down + recreate the AVCapture output every commit.
// Phase F-G+ review note.
const TYPES: ScannedObjectType[] = ['pdf-417'];

// AAMVA header sentinel — every spec-compliant PDF-417 on a US/Canada
// driver license starts with `@\nANSI ` (or `@\rANSI `). MLKit
// occasionally mis-tags out-of-focus PDF-417 as `code-128` (one row
// glimpsed); AVFoundation's `AVMetadataObject.ObjectType.pdf417`
// rejects partial decodes outright, so a pure AAMVA-header check is
// sufficient here without a type-cross-check fallback.
function isAamvaPayload(raw: string): boolean {
  return raw.startsWith('@') && raw.includes('ANSI ');
}

export interface UseBarcodeOutputOptions {
  /** Called with the raw AAMVA payload when a PDF-417 scan decodes
   *  successfully and matches the AAMVA shape. The orchestrator
   *  pipes this into `NativeDlScan.parseBarcodeData` (Nitro → C++).
   *  The hook fires this once per matching frame; the orchestrator
   *  is responsible for de-duping (typically via a hasResult ref). */
  onAamvaString: (raw: string) => void;
  /** Reserved — AVFoundation's metadata output doesn't surface
   *  recoverable errors through this path. Implemented for parity
   *  with the Android implementation but not currently invoked. */
  onError: (message: string) => void;
}

export function useBarcodeOutput(
  options: UseBarcodeOutputOptions
): CameraOutput {
  const { onAamvaString } = options;
  return useObjectOutput({
    types: TYPES,
    onObjectsScanned: (objects: ScannedObject[]) => {
      // AVMetadataObject can include non-code object types in theory
      // (face, body, etc.) but we only register `pdf-417` above; this
      // guard is a defensive narrow that costs nothing.
      for (const obj of objects) {
        if (!isScannedCode(obj)) continue;
        const raw = obj.value;
        if (raw != null && isAamvaPayload(raw)) {
          onAamvaString(raw);
          return;
        }
      }
    },
  });
}
