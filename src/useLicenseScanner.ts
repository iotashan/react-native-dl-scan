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
import { scanFrameOcrNanodet } from './scanFrame';
import { loadFieldModel } from './detector';
import type {
  ModelSource,
  TfliteModel,
  TensorflowModelDelegate,
} from 'react-native-fast-tflite';
import type { LicenseData, ScanMode, ConfidenceEntry } from './types';
import { formatTypedValue } from './types';
import type { LicenseDataSpec } from './specs/DlScan.nitro';

// ===== OCR completion policy + UI-observable scan status =====

/**
 * Metadata keys on LicenseData that are NOT user-facing "fields" — excluded
 * from the required/optional accounting in ScanStatus.
 */
const NON_FIELD_KEYS = new Set<keyof LicenseData>([
  'cardImagePath',
  'headshotImagePath',
  'dataConfidence',
  'mrz',
  'aamvaVersion',
  'documentType',
]);

/** Stage of the OCR multi-frame scan (UI-facing). */
export type ScanPhase = 'scanning' | 'validating' | 'complete' | 'incomplete';

/**
 * Augmentation mode for the finalization best-crop re-parse. Each maps to a
 * `DLSCAN_AUG_*` int the native `runTtaVerification` understands (see
 * cpp/detect/detect_c.hpp):
 *   - `'original'`        → DLSCAN_AUG_IDENTITY (2): unfiltered passthrough —
 *     the clean retained crop is re-parsed as-is. This is the baseline mode and
 *     the heart of the "parse the best crop once at finalization" step: with
 *     minVotes=1 it recovers fields (e.g. sex) the multi-frame minVotes=2 vote
 *     dropped because the clean glyph appeared in too few frames. The
 *     color/contrast filters can DEGRADE an already-legible read, so identity
 *     runs FIRST and is the safe default.
 *   - `'blueChannel'`     → DLSCAN_AUG_BLUE_GRAY (0): grayscale from the blue
 *     channel only. Strongest single augmentation in the offline sweep — dark
 *     glyphs have maximal contrast in blue on blue card stock (e.g. WI), which
 *     recovers small characters (vehicle class) single-pass OCR drops.
 *   - `'contrastStretch'` → DLSCAN_AUG_CONTRAST_STRETCH (1): per-channel 2%/98%
 *     percentile stretch. A color-agnostic hedge for flat/low-contrast captures.
 */
export type TtaMode = 'original' | 'blueChannel' | 'contrastStretch';

/** TtaMode → native DLSCAN_AUG_* int. */
const TTA_MODE_TO_INT: Record<TtaMode, number> = {
  original: 2,
  blueChannel: 0,
  contrastStretch: 1,
};

/**
 * Default best-crop re-parse augmentations when `tta.modes` is omitted.
 * `'original'` (identity) is FIRST so the clean crop is always re-parsed; the
 * blue/contrast filters are appended hedges that can only ADD fields (the merge
 * never overwrites a stronger read).
 */
const DEFAULT_TTA_MODES: TtaMode[] = [
  'original',
  'blueChannel',
  'contrastStretch',
];

/**
 * Configurable completion contract for OCR mode. The scan accumulates frames
 * (votes) until every `requiredFields` entry is populated in the consensus
 * result — each already backed by the native voter's >=2-vote floor — then,
 * if `validationPass`, ONE additional frame must re-confirm those values
 * before finalizing. If `maxFrames` is reached first, the scan finalizes
 * best-effort with whatever was captured (phase `'incomplete'`).
 *
 * Effort scales to the data the caller needs: a consumer that only needs
 * name + address can pass a small `requiredFields` and finish in 1-2 passes;
 * one that needs height/class/etc. keeps scanning (up to `maxFrames`) until
 * those slow demographic fields converge.
 *
 * Pass a STABLE reference (module-level const or memoized). An unstable
 * `requiredFields` array is still correct, but allocates each render.
 */
export interface ScanCompletionPolicy {
  /** Fields that must ALL be present to finish. Default: {@link DEFAULT_REQUIRED_FIELDS}. */
  requiredFields?: (keyof LicenseData)[];
  /** Hard cap on consensus frames before best-effort finalize. Default 30. */
  maxFrames?: number;
  /** Require one extra confirming frame after the required set is first met. Default true. */
  validationPass?: boolean;
  /**
   * Best-crop re-parse at finalization — ADDITIVE, default ON. On EVERY
   * finalization (required set satisfied — and its fresh-frame
   * {@link validationPass} confirmed, if enabled — OR `maxFrames` hit, phase
   * `'incomplete'`), the native side re-OCRs the single BEST retained card crop
   * ONCE under each augmentation in `modes` with a fresh minVotes=1 voter, and
   * merges the result into the accumulated data via the same
   * strictly-higher-confidence rule used across frames.
   *
   * This deterministically recovers fields the multi-frame minVotes=2 vote
   * dropped: a value (e.g. `sex`) that OCRs cleanly in only ONE of the ~30
   * frames never reaches 2 votes in the live voter, but the minVotes=1 re-parse
   * of the best crop reads it. The default `modes` lead with `'original'`
   * (identity) so the clean crop is parsed unfiltered (the color/contrast
   * filters can DEGRADE a clean read); blue/contrast are appended hedges.
   *
   * The merge can only FILL absent fields or UPGRADE on strictly-higher
   * confidence — it can never overwrite a correct multi-frame value with a
   * worse single-crop one (see {@link _mergeAccumulated}). Composes WITH
   * `validationPass` — it does not replace it.
   *
   * Disable explicitly with `tta: { enabled: false }`. `enabled` omitted ⇒ ON.
   * `modes` defaults to `['original', 'blueChannel', 'contrastStretch']`.
   */
  tta?: { enabled?: boolean; modes?: TtaMode[] };
}

/**
 * Live snapshot of the multi-frame scan's inner state. Updated on every
 * consensus frame so the UI can convey: the pass number, which required
 * fields are in vs. still pending, any bonus optional fields captured, the
 * final-check (validation) state, and per-field confidence.
 */
export interface ScanStatus {
  /** Current stage of the scan. */
  phase: ScanPhase;
  /** Consensus frames processed so far (the "pass number"). */
  passNumber: number;
  /** Configured hard cap on passes. */
  maxFrames: number;
  /** The configured required-field set. */
  requiredFields: (keyof LicenseData)[];
  /** Required fields satisfied so far. */
  acceptedRequired: (keyof LicenseData)[];
  /** Required fields still missing. */
  pendingRequired: (keyof LicenseData)[];
  /** Non-required fields also captured (bonus). */
  acceptedOptional: (keyof LicenseData)[];
  /** True once every required field is present. */
  requiredComplete: boolean;
  /** acceptedRequired / requiredFields, in [0, 1] — drive a progress bar. */
  fractionComplete: number;
  /**
   * Final-check state: `active` once the required set is met and the scan is
   * awaiting one confirming frame; `confirmed` when that frame agreed and the
   * scan finalized.
   */
  validation: { active: boolean; confirmed: boolean };
  /** Per-field confidence (score + tier) from the native extractor. */
  fieldConfidence: LicenseData['dataConfidence'];
}

/** Default minimum set required to finish a scan (core identity fields). */
export const DEFAULT_REQUIRED_FIELDS: (keyof LicenseData)[] = [
  'firstName',
  'lastName',
  'street',
  'city',
  'state',
  'postalCode',
  'dateOfBirth',
  'licenseNumber',
  'sex',
];

/** Default hard cap on consensus frames before a best-effort finalize. */
const DEFAULT_MAX_FRAMES = 30;

/**
 * Absolute worklet-side frame cap — a safety backstop only. The JS completion
 * logic enforces the configurable `maxFrames` and stops the worklet early by
 * blocking `resultCount` to this value; the worklet never reaches it in
 * practice. Must be >= any reasonable `maxFrames`.
 */
const WORKLET_FRAME_CAP = 120;

const isFieldPresent = (data: LicenseData, f: keyof LicenseData): boolean => {
  const v = data[f];
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

const makeInitialStatus = (
  requiredFields: (keyof LicenseData)[],
  maxFrames: number
): ScanStatus => ({
  phase: 'scanning',
  passNumber: 0,
  maxFrames,
  requiredFields,
  acceptedRequired: [],
  pendingRequired: requiredFields,
  acceptedOptional: [],
  requiredComplete: false,
  fractionComplete: 0,
  validation: { active: false, confirmed: false },
  fieldConfidence: null,
});

const confScore = (conf: LicenseData['dataConfidence'], key: string): number =>
  conf != null ? (conf[key]?.score ?? 0) : 0;

/**
 * Merge a single frame's consensus into the accumulated "presumed result".
 *
 * The native voter returns its best guess PER FRAME, but a high-variance field
 * (a name/license# that OCRs slightly differently each frame) can win 2 votes
 * early then drop out of the sliding window as later noise dilutes the bucket.
 * Observed on a real WI DL: lastName/sex/licenseNumber appeared on passes 1-2
 * then vanished. So instead of replacing licenseData with each volatile frame,
 * we accumulate: once a field is populated (it already cleared the native
 * voter's >=2-vote floor + the C++ value-gates), we KEEP it, and only overwrite
 * with a STRICTLY higher-confidence read. This is the "presumed results" the
 * completion + validation logic runs against — it never loses a confirmed
 * field. Confidence ties keep the incumbent (no flapping).
 */
// Exported for unit testing ONLY (the `_` prefix marks it internal — it is not
// re-exported from the package index). This is the exact fold the opt-in TTA
// verification pass uses to merge its voted result into the accumulated data:
// confirmed fields are kept, and a field is overwritten only by a strictly
// higher-confidence read.
export const _mergeAccumulated = (
  prev: LicenseData | null,
  next: LicenseData
): LicenseData => {
  if (prev == null) return next;
  const merged: LicenseData = { ...prev };
  const mergedConf: Record<string, ConfidenceEntry> = {
    ...(prev.dataConfidence ?? {}),
  };
  for (const key of Object.keys(next) as (keyof LicenseData)[]) {
    if (NON_FIELD_KEYS.has(key)) continue; // metadata handled below
    if (!isFieldPresent(next, key)) continue; // absent this frame — keep prev
    const k = String(key);
    if (
      !isFieldPresent(merged, key) ||
      confScore(next.dataConfidence, k) > confScore(merged.dataConfidence, k)
    ) {
      (merged as unknown as Record<string, unknown>)[k] = next[key];
      const entry = next.dataConfidence?.[k];
      if (entry != null) mergedConf[k] = entry;
    }
  }
  // Image paths arrive late (consensus frame only); prefer any non-null.
  if (next.cardImagePath != null) merged.cardImagePath = next.cardImagePath;
  if (next.headshotImagePath != null) {
    merged.headshotImagePath = next.headshotImagePath;
  }
  if (next.mrz != null) merged.mrz = next.mrz;
  merged.dataConfidence = mergedConf;
  return merged;
};

/**
 * True when this frame re-reads a required field with a non-empty value that
 * DIFFERS from the value accumulated BEFORE this frame. Compared against the
 * pre-merge snapshot (not the post-merge result), so a higher-confidence strict
 * re-read can't overwrite the baseline and then mask its own contradiction
 * during the validation pass. Typed value-set fields ({ code } objects) are
 * compared by display form, not "[object Object]".
 */
export const _detectRequiredContradiction = (
  prevAccumulated: LicenseData | null,
  frameData: LicenseData,
  requiredFields: Array<keyof LicenseData>
): boolean => {
  if (prevAccumulated == null) return false;
  const norm = (x: unknown) => {
    const s =
      x != null && typeof x === 'object' && 'code' in x
        ? (formatTypedValue(x as Parameters<typeof formatTypedValue>[0]) ?? '')
        : String(x ?? '');
    return s.trim().toUpperCase();
  };
  return requiredFields.some((f) => {
    const fresh = frameData[f];
    const prior = prevAccumulated[f];
    return (
      fresh != null &&
      norm(fresh).length > 0 &&
      prior != null &&
      norm(prior).length > 0 &&
      norm(fresh) !== norm(prior)
    );
  });
};

/** Inputs for {@link _decideScanOutcome}. */
export interface ScanOutcomeInput {
  /** The accumulator BEFORE this frame was merged (the contradiction baseline). */
  prevAccumulated: LicenseData | null;
  frameData: LicenseData;
  requiredFields: Array<keyof LicenseData>;
  /** Whether every required field is present in the post-merge accumulator. */
  requiredComplete: boolean;
  maxFrames: number;
  validationPass: boolean;
  /** Current validation fingerprint state (validationFpRef). */
  validationFp: string;
  /** This frame's pass number (already incremented). */
  passCount: number;
}

/** The per-frame scan decision produced by {@link _decideScanOutcome}. */
export interface ScanOutcome {
  phase: ScanPhase;
  finalize: boolean;
  validationActive: boolean;
  validationConfirmed: boolean;
  nextValidationFp: string;
}

/**
 * Pure per-frame scan decision, extracted from handleOcrResult so the
 * validation-pass logic is unit-testable. It deliberately receives only the
 * PRE-merge accumulator (prevAccumulated) and never the post-merge result, so
 * the contradiction check structurally cannot regress to comparing a value
 * against one this same frame just merged in.
 */
export const _decideScanOutcome = (input: ScanOutcomeInput): ScanOutcome => {
  const {
    prevAccumulated,
    frameData,
    requiredFields: req,
    requiredComplete,
    maxFrames: cap,
    validationPass: doValidate,
    validationFp,
    passCount,
  } = input;

  let phase: ScanPhase = 'scanning';
  let finalize = false;
  let validationActive = false;
  let validationConfirmed = false;
  let nextValidationFp = validationFp;

  if (requiredComplete) {
    if (!doValidate) {
      finalize = true;
      phase = 'complete';
    } else if (validationFp === '') {
      // Required set just completed — wait one more (fresh) frame to re-confirm.
      nextValidationFp = 'awaiting';
      phase = 'validating';
      validationActive = true;
    } else if (_detectRequiredContradiction(prevAccumulated, frameData, req)) {
      // The fresh frame contradicts a required field versus the PRE-merge
      // accumulator — still uncertain, so keep scanning (or maxFrames finalizes).
      phase = 'validating';
      validationActive = true;
    } else {
      finalize = true;
      phase = 'complete';
      validationConfirmed = true;
    }
  } else {
    // A required field is (still) missing — abandon any pending validation.
    nextValidationFp = '';
  }

  // Hard cap: finalize best-effort even if the required set never completed.
  if (!finalize && passCount >= cap) {
    finalize = true;
    phase = requiredComplete ? 'complete' : 'incomplete';
  }

  return {
    phase,
    finalize,
    validationActive,
    validationConfirmed,
    nextValidationFp,
  };
};

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
 *  - `'ocr'`: returns a frame-output worklet that runs the JS-orchestrated
 *    NanoDet path (`scanFrameOcrNanodet`): native rectifies the frame, JS runs
 *    the NanoDet field detector via react-native-fast-tflite, and native OCRs +
 *    extracts the fields. Result is shipped back to JS via `scheduleOnRN`.
 *    `ocrModelSources` is REQUIRED in this mode. Multi-frame completion is
 *    governed by `completion` (see {@link ScanCompletionPolicy}); the live
 *    `scanStatus` exposes the scan's inner state for the UI.
 *
 * Both modes update the same {licenseData, error, isScanning} state.
 */
/**
 * Field + doc-aligner .tflite sources for the JS-orchestrated OCR path
 * (react-native-fast-tflite). REQUIRED in OCR mode: field detection runs via
 * NanoDet in the worklet (scanFrameOcrNanodet) and there is no native field-
 * detection fallback. Pass via require('...tflite') or { url }.
 */
export interface OcrModelSources {
  /**
   * NanoDet field-detector .tflite. Pass a STABLE reference (a module-level
   * const or a memoized value): the hook reloads the model whenever this
   * ocrModelSources object identity changes.
   */
  field: ModelSource;
  /**
   * Reserved for a future fully-JS doc-segmentation path. Currently UNUSED and
   * NOT loaded (doc-seg runs natively inside rectifyFrame), so it is optional.
   */
  docAligner?: ModelSource;
  delegates?: TensorflowModelDelegate[];
}

export function useLicenseScanner(
  mode: ScanMode = 'barcode',
  ocrModelSources?: OcrModelSources,
  completion?: ScanCompletionPolicy
) {
  // Resolve the completion policy (defaults applied). Read per-result through
  // cfgRef so the result handler keeps a stable identity (the frame-processor
  // worklet captures it) even if the caller passes an unstable `completion`.
  const requiredFields = completion?.requiredFields ?? DEFAULT_REQUIRED_FIELDS;
  const maxFrames = completion?.maxFrames ?? DEFAULT_MAX_FRAMES;
  const validationPass = completion?.validationPass ?? true;
  // Best-crop re-parse config — resolved to native DLSCAN_AUG_* ints up front
  // so the result handler keeps a stable identity. Default ON: finalization
  // ALWAYS re-parses the best retained crop once and merges, deterministically
  // recovering fields the multi-frame vote dropped. Disable only via an
  // explicit `tta: { enabled: false }`.
  const ttaEnabled = completion?.tta?.enabled !== false;
  const ttaModeInts = ttaEnabled
    ? (completion?.tta?.modes ?? DEFAULT_TTA_MODES).map(
        (m) => TTA_MODE_TO_INT[m]
      )
    : [];
  const cfgRef = useRef({
    requiredFields,
    maxFrames,
    validationPass,
    ttaEnabled,
    ttaModeInts,
  });
  cfgRef.current = {
    requiredFields,
    maxFrames,
    validationPass,
    ttaEnabled,
    ttaModeInts,
  };

  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [progress, setProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState<ScanStatus>(() =>
    makeInitialStatus(requiredFields, maxFrames)
  );

  // JS-orchestration: load the NanoDet field detector (+ doc-aligner) once when
  // OCR-mode model sources are supplied. While null, OCR uses the legacy native
  // path. fast-tflite models are worklet-shareable, so the loaded model is
  // captured directly by the frame-processor worklet below.
  const [fieldModel, setFieldModel] = useState<TfliteModel | null>(null);
  useEffect(() => {
    if (mode !== 'ocr' || ocrModelSources == null) return;
    let cancelled = false;
    loadFieldModel(ocrModelSources.field, ocrModelSources.delegates ?? [])
      .then((m) => {
        if (!cancelled) setFieldModel(m);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'detector model load failed');
      });
    return () => {
      cancelled = true;
    };
  }, [mode, ocrModelSources]);

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
  // Multi-frame voting: the native side maintains a per-field majority voter
  // (>=2-vote floor) across recent frames. Each non-null result from
  // `scanFrameOcrNanodet` is the CURRENT consensus across all frames seen so
  // far this session. The completion policy (above) decides WHEN that consensus
  // is "done": keep accumulating frames until every required field is present,
  // then one validation frame re-confirms, or until `maxFrames` is hit.
  //
  // resultCount is a worklet<->JS synchronizable: the worklet increments it per
  // successful consensus and the JS side blocks it to WORKLET_FRAME_CAP to stop
  // the worklet once the scan finalizes.
  const resultCount = useState(() => createSynchronizable<number>(0))[0];

  // Per-pass count (JS side, mirrors resultCount), the validation fingerprint
  // of the required fields awaiting a confirming frame, and the accumulated
  // "presumed result" merged across all passes this session.
  const passRef = useRef(0);
  const validationFpRef = useRef('');
  const accumulatedRef = useRef<LicenseData | null>(null);

  /**
   * Best-crop re-parse, run once at EVERY finalize (default ON). Re-OCRs the
   * single best retained card crop under the configured augmentations natively
   * (with a fresh minVotes=1 voter), then merges the voted result into the
   * accumulated data with the same strictly-higher-confidence rule used across
   * frames (already-confirmed fields are kept; only stronger reads overwrite, so
   * a recovered field like sex fills a gap but never clobbers a good value).
   * Returns the (possibly unchanged) data. No-op — returns `data` untouched —
   * when explicitly disabled, native returns null (no retained crop / no
   * consensus), or the call throws.
   */
  const applyTtaVerification = useCallback((data: LicenseData): LicenseData => {
    const { ttaEnabled: ttaOn, ttaModeInts: modes } = cfgRef.current;
    if (!ttaOn || modes.length === 0) return data;
    try {
      const spec = _hybrid.runTtaVerification(modes);
      if (spec == null) return data;
      const ttaData = normalizeLicenseData(spec);
      return _mergeAccumulated(data, ttaData);
    } catch {
      // Verification is best-effort: never fail the scan over a TTA error.
      return data;
    }
  }, []);

  // Single-arg handler — scheduleOnRN in worklets v0.8.x is typed as
  // (fn, arg) => void and only forwards one payload. Tried passing
  // isFinal as a second arg; got dropped (or arity-reinterpreted by the
  // worklet bridge), so isScanning flipped false on frame #1 and the
  // Camera unmounted. Use a separate callback for the "scan complete"
  // signal instead of overloading handleOcrResult.
  const handleOcrResult = useCallback(
    (spec: LicenseDataSpec) => {
      // Accumulate this frame's consensus into the presumed result so a field
      // that converged on an earlier pass is never lost to later OCR variance.
      const frameData = normalizeLicenseData(spec);
      // Snapshot the accumulator BEFORE merging this frame, so the validation
      // contradiction check below compares the fresh re-read against the prior
      // accumulated value — not against a value this same frame just merged in.
      const prevAccumulated = accumulatedRef.current;
      const data = _mergeAccumulated(prevAccumulated, frameData);
      accumulatedRef.current = data;
      setLicenseData(data);

      const {
        requiredFields: req,
        maxFrames: cap,
        validationPass: doValidate,
      } = cfgRef.current;
      passRef.current += 1;

      const acceptedRequired = req.filter((f) => isFieldPresent(data, f));
      const pendingRequired = req.filter((f) => !isFieldPresent(data, f));
      const requiredComplete = pendingRequired.length === 0;
      const acceptedOptional = (
        Object.keys(data) as (keyof LicenseData)[]
      ).filter(
        (k) =>
          !NON_FIELD_KEYS.has(k) && !req.includes(k) && isFieldPresent(data, k)
      );

      const decision = _decideScanOutcome({
        prevAccumulated,
        frameData,
        requiredFields: req,
        requiredComplete,
        maxFrames: cap,
        validationPass: doValidate,
        validationFp: validationFpRef.current,
        passCount: passRef.current,
      });
      validationFpRef.current = decision.nextValidationFp;
      const { phase, finalize, validationActive, validationConfirmed } =
        decision;

      const fractionComplete =
        req.length > 0 ? acceptedRequired.length / req.length : 1;

      // On EVERY finalize (completion OR maxFrames-hit/'incomplete'), re-parse
      // the best retained crop and fold its result into the accumulator BEFORE
      // publishing the final data/status. Composes with the fresh-frame
      // validation above (does not replace it). When explicitly disabled this is
      // a no-op and `finalData === data`.
      const finalData = finalize ? applyTtaVerification(data) : data;
      // Recompute the field-accounting sets from finalData so a TTA-recovered
      // field is reflected in the published status. The merge only adds or
      // strengthens fields (never removes), so this can only grow the accepted
      // sets relative to `data`.
      const fAcceptedRequired =
        finalData === data
          ? acceptedRequired
          : req.filter((f) => isFieldPresent(finalData, f));
      const fPendingRequired =
        finalData === data
          ? pendingRequired
          : req.filter((f) => !isFieldPresent(finalData, f));
      const fAcceptedOptional =
        finalData === data
          ? acceptedOptional
          : (Object.keys(finalData) as (keyof LicenseData)[]).filter(
              (k) =>
                !NON_FIELD_KEYS.has(k) &&
                !req.includes(k) &&
                isFieldPresent(finalData, k)
            );
      const fRequiredComplete =
        finalData === data ? requiredComplete : fPendingRequired.length === 0;
      const fFractionComplete =
        finalData === data
          ? fractionComplete
          : req.length > 0
            ? fAcceptedRequired.length / req.length
            : 1;
      if (finalize && finalData !== data) {
        accumulatedRef.current = finalData;
        setLicenseData(finalData);
      }

      setScanStatus({
        phase: finalize ? phase : validationActive ? 'validating' : 'scanning',
        passNumber: passRef.current,
        maxFrames: cap,
        requiredFields: req,
        acceptedRequired: fAcceptedRequired,
        pendingRequired: fPendingRequired,
        acceptedOptional: fAcceptedOptional,
        requiredComplete: fRequiredComplete,
        fractionComplete: fFractionComplete,
        validation: {
          active: validationActive,
          confirmed: validationConfirmed,
        },
        fieldConfidence: finalData.dataConfidence ?? null,
      });
      setProgress(finalize ? 1 : fractionComplete);

      if (finalize) {
        resultCount.setBlocking(WORKLET_FRAME_CAP);
        setIsScanning(false);
      }
    },
    [resultCount, applyTtaVerification]
  );

  const handleScanComplete = useCallback(() => {
    // The worklet hit the absolute frame cap without the JS side finalizing
    // (rare — JS enforces the configurable maxFrames first). Still run the
    // best-crop re-parse on the accumulated result.
    if (accumulatedRef.current != null) {
      const finalData = applyTtaVerification(accumulatedRef.current);
      if (finalData !== accumulatedRef.current) {
        accumulatedRef.current = finalData;
        setLicenseData(finalData);
      }
    }
    setIsScanning(false);
    setProgress(1);
    setScanStatus((s) => ({
      ...s,
      phase: s.requiredComplete ? 'complete' : 'incomplete',
      fieldConfidence:
        accumulatedRef.current?.dataConfidence ?? s.fieldConfidence,
    }));
  }, [applyTtaVerification]);

  const handleError = useCallback((message: string) => {
    setError(message);
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
      if (seen >= WORKLET_FRAME_CAP) {
        frame.dispose();
        return;
      }
      try {
        // The NanoDet field model is required for OCR mode (loaded from
        // ocrModelSources). Until it finishes loading, skip frames rather
        // than running any detection — there is no native fallback path.
        if (fieldModel == null) {
          frame.dispose();
          return;
        }
        const spec = scanFrameOcrNanodet(frame, fieldModel);
        if (spec != null) {
          const next = seen + 1;
          resultCount.setBlocking(next);
          scheduleOnRN(handleOcrResult, spec);
          if (next >= WORKLET_FRAME_CAP) {
            scheduleOnRN(handleScanComplete);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'OCR scan error';
        scheduleOnRN(handleError, msg);
      }
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
    passRef.current = 0;
    validationFpRef.current = '';
    accumulatedRef.current = null;
    setScanStatus(
      makeInitialStatus(cfgRef.current.requiredFields, cfgRef.current.maxFrames)
    );
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
    scanStatus,
    pipelineStage,
    detectedCorners,
    output,
    reset,
  };
}
