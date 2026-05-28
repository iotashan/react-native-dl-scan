import { useCallback, useEffect, useRef, useState } from 'react';
import { scheduleOnRN, createSynchronizable } from 'react-native-worklets';
import {
  useFrameOutput,
  type Frame,
  type CameraOutput,
  CommonResolutions,
} from 'react-native-vision-camera';
import { NativeDlScan, normalizeLicenseData, _hybrid } from './native';
// Platform-resolved barcode output. Metro picks the .ios.ts or
// .android.ts variant per platform at bundle time. iOS uses Vision
// Camera v5's built-in `useObjectOutput` (AVFoundation, no MLKit);
// Android uses `react-native-vision-camera-barcode-scanner` (MLKit).
// The autolinker still has to be told not to install
// `react-native-vision-camera-barcode-scanner`'s pod on iOS — see
// `expo.autolinking.ios.exclude` in the consumer app's package.json.
// Both files export the same `useBarcodeOutput` signature.
import { useBarcodeOutput } from './scanner/barcodeOutput';
import { scanFrameOcr } from './scanFrame';
import type { LicenseData, ScanMode } from './types';
import type { LicenseDataSpec } from './specs/DlScan.nitro';

/**
 * Drive the full license-scan pipeline (barcode + OCR) for a Camera.
 *
 * Returns an Output (`output`) you spread into `<Camera outputs={[output]} />`.
 * The Output type depends on `mode`:
 *
 *  - `'barcode'`: returns a platform-resolved barcode-output configured
 *    for PDF417. iOS uses Vision Camera v5's built-in
 *    `useObjectOutput` (AVFoundation, no MLKit on iOS); Android uses
 *    `useBarcodeScannerOutput` (MLKit). Both surface the same JS
 *    callback shape via `./scanner/barcodeOutput`. On a detection the
 *    raw AAMVA string routes through `NativeDlScan.parseBarcodeData`
 *    (JS → Nitro → C++ AAMVA).
 *
 *  - `'ocr'`: returns a frame-output worklet that calls
 *    `scanFrameOcr(frame)` (synchronous Nitro hybrid call into C++ field
 *    extractor). Result is shipped back to JS via `scheduleOnRN`.
 *
 * Both modes update the same {licenseData, error, isScanning} state.
 */
export function useLicenseScanner(mode: ScanMode = 'barcode') {
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [progress, setProgress] = useState(0);

  // Result latch — both scanner backends fire their callback for every
  // matching frame (AVFoundation's AVCaptureMetadataOutput re-fires
  // each delegate tick; MLKit re-fires every analysis). Without this
  // ref, the AAMVA payload would be parsed dozens of times per scan,
  // producing dozens of `parseBarcodeData` calls before the consumer's
  // UI detaches the output. Reset by `reset()`. Phase F-G+ review note.
  const hasResultRef = useRef(false);

  /** JS-thread handler for a decoded PDF417 raw string. */
  const handleBarcodeString = useCallback((raw: string) => {
    if (hasResultRef.current) return;
    hasResultRef.current = true;
    NativeDlScan.parseBarcodeData(raw)
      .then((data) => {
        if (data != null) {
          setLicenseData(data);
          setError(null); // clear any stale diagnostic from earlier frames
          setIsScanning(false);
        } else {
          // Parser returned null — unlatch so the next matching frame
          // can try again. (Shouldn't happen for valid AAMVA, but
          // defensive.)
          hasResultRef.current = false;
        }
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Unknown parse error';
        setError(message);
        hasResultRef.current = false; // allow retry
      });
  }, []);

  const onBarcodeError = useCallback((message: string) => {
    setError(message);
  }, []);

  /**
   * Barcode-mode Output. Always created so the hook order stays stable
   * across mode changes (rules-of-hooks). Only attached to the Camera in
   * barcode mode. Platform-resolved: iOS uses AVFoundation, Android
   * uses MLKit — see ./scanner/barcodeOutput.{ios,android}.ts.
   */
  const barcodeOutput: CameraOutput = useBarcodeOutput({
    onAamvaString: handleBarcodeString,
    onError: onBarcodeError,
  });

  // OCR-mode frame processor.
  //
  // Multi-frame voting (task #33, round-8): the native side maintains
  // a per-field majority voter across recent frames. Each non-null result
  // from `scanFrameOcr` is the CURRENT consensus across all frames seen so
  // far in this scan session. We keep scanning for up to MAX_VOTING_FRAMES
  // successful results so the voter has data to converge — earlier single-
  // frame-wins behavior locked in OCR variance ("JOHN QUINCYY" / "8
  // 2119 ..." etc.) on whichever frame happened to fire first.
  //
  // The progressDisplay updates with EVERY consensus result so the user
  // sees fields refining as votes accumulate, then stabilises and the
  // `isScanning` UI flag flips false once the budget is reached.
  // Bumped 8→12 per round-6 to give the voter more samples
  // before locking consensus. The text-pool fallback for small-print
  // fields (HGT, HAIR, ISSUED on WI DLs) hits OCR variance that needs
  // more votes to converge. Cost: scan time goes ~30s → ~45s; benefit:
  // higher recovery rate on noisy demographic fields.
  const MAX_VOTING_FRAMES = 8;
  const resultCount = useState(() => createSynchronizable<number>(0))[0];

  // Single-arg handler — scheduleOnRN in worklets v0.8.x is typed as
  // (fn, arg) => void and only forwards one payload. Tried passing
  // isFinal as a second arg; got dropped (or arity-reinterpreted by the
  // worklet bridge), so isScanning flipped false on frame #1 and the
  // Camera unmounted. Use a separate callback for the "scan complete"
  // signal instead of overloading handleOcrResult.
  // Adaptive exit: track consecutive frames that agree on all populated
  // fields. When 3 consecutive frames produce identical field values,
  // the result is stable — exit early regardless of frame count.
  const prevResultRef = useRef<string>('');
  const stabilityCountRef = useRef(0);
  const STABILITY_THRESHOLD = 2;

  const handleOcrResult = useCallback(
    (spec: LicenseDataSpec) => {
      const data = normalizeLicenseData(spec);
      // Build a fingerprint of populated field values for stability check
      const fp = [
        data.firstName,
        data.lastName,
        data.dateOfBirth,
        data.licenseNumber,
        data.street,
        data.city,
        data.state,
        data.postalCode,
        data.sex,
        data.eyeColor,
        data.hairColor,
        data.vehicleClass,
      ]
        .filter(Boolean)
        .join('|');

      if (fp === prevResultRef.current && fp.length > 0) {
        stabilityCountRef.current += 1;
      } else {
        stabilityCountRef.current = 1;
        prevResultRef.current = fp;
      }

      setLicenseData(data);

      if (stabilityCountRef.current >= STABILITY_THRESHOLD) {
        resultCount.setBlocking(MAX_VOTING_FRAMES);
        setProgress(1);
        setIsScanning(false);
      }
    },
    [resultCount]
  );

  const handleScanComplete = useCallback(() => {
    setProgress(1);
    setIsScanning(false);
  }, []);

  const handleError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleProgress = useCallback((p: number) => {
    setProgress(p);
  }, []);

  const ocrOutput: CameraOutput = useFrameOutput({
    // YUV planes are what MLKit + Apple Vision both consume natively;
    // skips RGB conversion overhead.
    pixelFormat: 'yuv',
    // Camera's max-available 4:3 format. VisionCamera resolves HIGHEST_4_3
    // (30000×40000 cap) to the largest 4:3 size the active CameraDevice
    // exposes — Pixel 6: 4032×3024 = 12 MP. The frame-processor pipeline
    // already rate-limits OCR to 2 fps internally, so the cost of larger
    // frames lands on per-frame YUV→bitmap copy + DocAligner+YOLO
    // downscale rather than continuous throughput. The win is denser
    // pixels under the demographic-row text (5'-04", 160 lb, BRO, BLK)
    // and under the AAMVA index tokens, which MLKit OCR needs to
    // recognise without smearing characters across word boundaries. Up
    // from FHD_4_3 (2.7 MP) where Sex/Height/Eye/Hair/Weight rarely
    // survived MLKit text recognition cleanly enough to satisfy the
    // demographic parser's four-gate match.
    targetResolution: CommonResolutions.HIGHEST_4_3,
    onFrame: (frame: Frame) => {
      'worklet';
      const seen = resultCount.getDirty();
      if (seen >= MAX_VOTING_FRAMES) {
        frame.dispose();
        return;
      }
      try {
        const spec = scanFrameOcr(frame);
        if (spec != null) {
          const next = seen + 1;
          resultCount.setBlocking(next);
          scheduleOnRN(handleOcrResult, spec);
          if (
            next >= MAX_VOTING_FRAMES ||
            (next >= 5 && _hybrid.scanProgress >= 0.85)
          ) {
            scheduleOnRN(handleScanComplete);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'OCR scan error';
        scheduleOnRN(handleError, msg);
      }
      scheduleOnRN(handleProgress, _hybrid.scanProgress);
      frame.dispose();
    },
  });

  const output = mode === 'barcode' ? barcodeOutput : ocrOutput;

  const reset = useCallback(() => {
    _hybrid.resetLicenseFieldRecognition();
    setLicenseData(null);
    setError(null);
    setIsScanning(true);
    setProgress(0);
    resultCount.setBlocking(0);
    prevResultRef.current = '';
    stabilityCountRef.current = 0;
    hasResultRef.current = false; // clear the barcode result latch
  }, [resultCount]);

  // Reset the native voter cache on every hook mount. The JS hook state
  // starts at default values automatically (useState initializers), but
  // the native `cachedOcrResult` survives across remounts. Without this
  // call, a freshly-mounted ScannerScreen could see the previous
  // session's cached spec on the very first worklet poll. Mount-only
  // (empty dep array); the consumer can still call `reset()` explicitly
  // if they want to re-arm mid-scan.
  useEffect(() => {
    _hybrid.resetLicenseFieldRecognition();
  }, []);

  const pipelineStage = _hybrid.pipelineStage;
  const detectedCorners = _hybrid.detectedCardCorners;
  return {
    licenseData,
    error,
    isScanning,
    progress,
    pipelineStage,
    detectedCorners,
    output,
    reset,
  };
}
