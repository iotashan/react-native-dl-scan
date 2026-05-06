import { useCallback, useMemo, useState } from 'react';
import { runOnJS, createSynchronizable } from 'react-native-worklets';
import { useFrameOutput } from 'react-native-vision-camera';
import { useBarcodeScanner } from 'react-native-vision-camera-barcode-scanner';
import { NativeDlScan, normalizeLicenseData } from './index';
import { scanFrameBarcode, scanFrameOcr } from './scanFrame';
import type { LicenseData, ScanMode } from './types';
import type { LicenseDataSpec } from './specs/DlScan.nitro';

export function useLicenseScanner(mode: ScanMode = 'barcode') {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(true);

  // useBarcodeScanner is only needed for barcode mode; hook rules require
  // unconditional call, so we always create it but only use it in barcode mode.
  const barcodeScanner = useBarcodeScanner({ barcodeFormats: ['pdf-417'] });

  // Guard that prevents the worklet from scheduling more JS callbacks after a
  // successful scan. Created once per hook instance (stable across re-renders).
  // Uses createSynchronizable (react-native-worklets) rather than useSharedValue
  // because the project migrated off react-native-worklets-core.
  // Read inside the worklet via getDirty() (non-blocking, safe in frame processor).
  // Write via setBlocking() — called from the worklet immediately before
  // dispatching the JS callback so the guard is already up for the next frame.
  const hasResult = useMemo(() => createSynchronizable<boolean>(false), []);

  // JS-thread handler: parse raw PDF417 string and update state.
  // Memoized so the worklet closure stays stable across re-renders.
  const handleBarcodeString = useCallback(
    (raw: string) => {
      NativeDlScan.parseBarcodeData(raw)
        .then((data) => {
          if (data != null) {
            setLicenseData(data);
            setIsScanning(false);
          }
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : 'Unknown parse error';
          setError(message);
        });
    },
    [] // NativeDlScan is module-level; state setters are stable
  );

  // JS-thread handler: normalize the raw Nitro LicenseDataSpec coming from the
  // OCR path and update state. Called via runOnJS so normalizeLicenseData
  // (which uses undefinedToNull) runs on the JS thread, not the worklet thread.
  const handleOcrResult = useCallback(
    (spec: LicenseDataSpec) => {
      const data = normalizeLicenseData(spec);
      setLicenseData(data);
      setIsScanning(false);
    },
    [] // normalizeLicenseData is module-level; state setters are stable
  );

  const handleError = useCallback((message: string) => {
    setError(message);
  }, []);

  // runOnJS wraps JS-thread functions so they can be called from the
  // camera-thread worklet. These are created once per render cycle; for
  // production, memoize via useMemo if profiling reveals excess allocations.
  const scheduleHandleBarcode = useMemo(
    () => runOnJS(handleBarcodeString),
    [handleBarcodeString]
  );
  const scheduleHandleOcr = useMemo(
    () => runOnJS(handleOcrResult),
    [handleOcrResult]
  );
  const scheduleHandleError = useMemo(
    () => runOnJS(handleError),
    [handleError]
  );

  // useFrameOutput replaces useFrameProcessor in VC v5.
  // The returned CameraFrameOutput is passed to <Camera outputs={[frameProcessor]} />.
  const frameProcessor = useFrameOutput({
    onFrame: (frame) => {
      'worklet';
      // Early-exit once a result has been found. The consumer is responsible
      // for deactivating the camera (<Camera isActive={false} />) from the JS
      // thread, which may take several frames. Without this guard every one of
      // those frames would schedule a parseBarcodeData() call, causing 30+
      // in-flight Promises before state propagates back.
      // getDirty() is the non-blocking worklet-thread read; safe at 30 fps.
      if (hasResult.getDirty()) {
        frame.dispose();
        return;
      }

      if (mode === 'barcode') {
        try {
          scanFrameBarcode(frame, barcodeScanner, scheduleHandleBarcode, () => {
            // Flip the guard synchronously in the worklet, before the JS
            // callback fires, so the next frame is already blocked.
            hasResult.setBlocking(true);
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Barcode scan error';
          scheduleHandleError(msg);
        }
      } else {
        // OCR mode: recognizeLicenseFields runs synchronously and returns the
        // latest cached result (may be null for the first few frames while
        // the background VisionKit job is running). When a non-null result
        // arrives, flip the guard and dispatch to the JS thread for normalization.
        try {
          const spec = scanFrameOcr(frame);
          if (spec != null) {
            hasResult.setBlocking(true);
            scheduleHandleOcr(spec);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'OCR scan error';
          scheduleHandleError(msg);
        }
      }
      frame.dispose();
    },
  });

  const reset = useCallback(() => {
    setLicenseData(null);
    setError(null);
    setIsScanning(true);
    // Re-arm the guard so the scanner is live again after reset().
    hasResult.setBlocking(false);
  }, [hasResult]);

  return { licenseData, error, isScanning, frameProcessor, reset };
}
