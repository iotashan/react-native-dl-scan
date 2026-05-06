import type { Frame } from 'react-native-vision-camera';
import type { BarcodeScanner } from 'react-native-vision-camera-barcode-scanner';
import type { ScanResult, ScanMode } from './types';

/**
 * Scan a single frame for a driver's license barcode (PDF417).
 *
 * Calls `barcodeScanner.scanCodes(frame)` synchronously inside the worklet,
 * finds the first PDF417 barcode, and fires `onBarcodeString` (a runOnJS
 * boundary) so the caller can invoke `NativeDlScan.parseBarcodeData` on the
 * JS thread.
 *
 * The optional `onBeforeDispatch` callback is invoked synchronously in the
 * worklet immediately before `onBarcodeString` is scheduled. This lets the
 * caller flip a Synchronizable guard (e.g. `hasResult`) while still inside the
 * worklet context, before JS-thread state has a chance to propagate. The guard
 * lives in `useLicenseScanner` rather than here to preserve separation of
 * concerns — `scanFrameBarcode` stays generic and unaware of hook state.
 *
 * @worklet  Must be called inside useFrameOutput's onFrame callback.
 */
export function scanFrameBarcode(
  frame: Frame,
  barcodeScanner: BarcodeScanner,
  onBarcodeString: (raw: string) => void,
  onBeforeDispatch?: () => void
): void {
  'worklet';
  const barcodes = barcodeScanner.scanCodes(frame);
  for (let i = 0; i < barcodes.length; i++) {
    const barcode = barcodes[i];
    if (!barcode) continue;
    if (barcode.format === 'pdf-417' && barcode.rawValue != null) {
      onBeforeDispatch?.();
      onBarcodeString(barcode.rawValue);
      return;
    }
  }
}

/**
 * OCR mode stub — returns null until Task 6 rewrites the iOS frame processor
 * in Swift using the VC v5 Nitro API.
 *
 * @worklet
 */
export function scanFrameOcr(_frame: Frame): ScanResult | null {
  'worklet';
  return null;
}

/**
 * Legacy worklet helper — kept for public API compatibility (re-exported via
 * index.ts). In VC v5, barcode detection requires a `BarcodeScanner` instance
 * obtained from `useBarcodeScanner()`; use `useLicenseScanner()` instead for
 * the full scanning pipeline.
 *
 * @worklet
 */
export function scanFrame(
  frame: Frame,
  mode: ScanMode = 'barcode'
): ScanResult | null {
  'worklet';
  if (mode === 'ocr') {
    return scanFrameOcr(frame);
  }
  // Barcode detection in VC v5 requires a BarcodeScanner instance from
  // useBarcodeScanner(). The standalone scanFrame worklet cannot perform
  // barcode detection; use useLicenseScanner() for the complete pipeline.
  return null;
}
