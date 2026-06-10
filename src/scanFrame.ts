import type { Frame } from 'react-native-vision-camera';
import type { BarcodeScanner } from 'react-native-vision-camera-barcode-scanner';
import type { LicenseDataSpec } from './specs/DLScan.nitro';
import { _hybrid } from './native';
import { runFieldDetection } from './detector';
import type { TfliteModel } from 'react-native-fast-tflite';
import type { ScanMode } from './types';

/**
 * Scan a single frame for a driver's license barcode (PDF417).
 *
 * Calls `barcodeScanner.scanCodes(frame)` synchronously inside the worklet,
 * finds the first PDF417 barcode, and fires `onBarcodeString` (a runOnJS
 * boundary) so the caller can invoke `NativeDLScan.parseBarcodeData` on the
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
 * JS-orchestrated OCR worklet (NanoDet via react-native-fast-tflite). Native
 * rectifies the frame (doc-seg + perspective-correct) and returns the rectified
 * RGB + a token; JS runs the NanoDet field detector via fast-tflite; native
 * then OCRs + extracts using those detections (ocrExtractFields).
 *
 * With `imagesOnly` set (the hook's `completion.capture: 'imagesOnly'` mode),
 * the same rectify -> detect entry runs, but native short-circuits to the
 * once-per-session card-image save + headshot crop (captureFrontImages) — no
 * OCR text recognition, C++ parse, voting, or TTA. Native returns null every
 * frame until the card JPEG saves; the success spec carries ONLY
 * `cardImagePath` / `headshotImagePath` (all field values absent).
 *
 * Returns the raw LicenseDataSpec (or null until a card + detections land). The
 * caller normalizes undefined -> null at the worklet -> JS boundary.
 *
 * @worklet
 */
export function scanFrameOcrNanodet(
  frame: Frame,
  fieldModel: TfliteModel,
  imagesOnly: boolean = false
): LicenseDataSpec | null {
  'worklet';
  // Dev-only per-frame step timings. Covers EVERY frame (the native
  // scanTimingsJson only rides data-bearing frames) so a slow rectify or
  // detector shows up even on frames that return null. ~1-2 lines/s in dev.
  const t0 = __DEV__ ? Date.now() : 0;
  const rect = _hybrid.rectifyFrame(frame);
  if (rect == null) {
    if (__DEV__) {
      console.log(
        `[dl-scan/timing] worklet rectify=${Date.now() - t0}ms ` +
          'native=skipped (no rectified card)'
      );
    }
    return null;
  }
  const t1 = __DEV__ ? Date.now() : 0;
  const detections = runFieldDetection(
    fieldModel,
    rect.rgb,
    rect.width,
    rect.height
  );
  const t2 = __DEV__ ? Date.now() : 0;
  const result = imagesOnly
    ? (_hybrid.captureFrontImages(rect.token, detections) ?? null)
    : (_hybrid.ocrExtractFields(rect.token, detections) ?? null);
  if (__DEV__) {
    const t3 = Date.now();
    console.log(
      `[dl-scan/timing] worklet rectify=${t1 - t0}ms nanodet=${t2 - t1}ms ` +
        `native=${t3 - t2}ms total=${t3 - t0}ms data=${result != null}`
    );
  }
  return result;
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
  _frame: Frame,
  _mode: ScanMode = 'barcode'
): LicenseDataSpec | null {
  'worklet';
  // Both barcode and OCR detection require state owned by useLicenseScanner()
  // (a BarcodeScanner instance from useBarcodeScanner() in VC v5, or the loaded
  // NanoDet field model for the OCR path). The standalone scanFrame worklet
  // cannot perform detection on its own; use useLicenseScanner() for the
  // complete pipeline.
  return null;
}
