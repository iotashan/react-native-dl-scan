import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

// Document type enum — nitrogen serializes string unions as strings.
export type DocumentType =
  | 'driver_license'
  | 'passport'
  | 'national_id'
  | 'residence_permit'
  | 'unknown';

// MRZ type discriminator
export type MRZTypeSpec = 'TD1' | 'TD2' | 'TD3';

// MRZ data struct — optional on LicenseDataSpec; present only for travel docs.
export interface MRZDataSpec {
  mrzType: MRZTypeSpec;
  documentCode: string;
  issuingState: string;
  documentNumber: string;
  primaryIdentifier: string;
  secondaryIdentifier: string;
  nationality: string;
  dateOfBirth: string;
  sex: Sex;
  dateOfExpiry: string;
  optionalData: string;
  checkDigitsValid: boolean;
}

// Sex must be a named type (nitrogen cannot handle inline string-literal unions).
export type Sex = 'M' | 'F' | 'X';

// A field-detector detection in SOURCE image pixel space. Mirrors
// dlscan::yolo::Detection; returned by decodeFieldOutput for JS-orchestrated
// (react-native-fast-tflite) inference.
export interface FieldDetectionSpec {
  classId: number;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// A rectified (perspective-corrected) camera frame, returned by rectifyFrame for
// JS-orchestrated field detection. `rgb` is row-major RGB8 (3 bytes/px). The
// native side caches the matching pixel buffer under `token` so ocrExtractFields
// can run OCR on it without re-marshaling the image back across the bridge.
export interface RectifiedFrameSpec {
  rgb: ArrayBuffer;
  width: number;
  height: number;
  token: number;
}

/**
 * One recognized OCR text line on the saved card image (`cardImagePath`).
 *
 * Coordinate contract: `x`/`y`/`width`/`height` are normalized to [0, 1]
 * in CARD-IMAGE coordinates — i.e. relative to the exact image saved at
 * `cardImagePath` — with the origin at the TOP-LEFT corner and +y pointing
 * DOWN. `(x, y)` is the box's top-left corner. Multiply by the rendered
 * image's width/height to position an overlay.
 *
 * Produced by a dedicated whole-card OCR pass over the saved card JPEG
 * (Vision on iOS, MLKit on Android) at card-capture time, so the boxes
 * always describe the same pixels as `cardImagePath`.
 */
export interface OcrObservationSpec {
  /** The recognized text of this OCR line. */
  text: string;
  /** Normalized [0,1] left edge (top-left origin). */
  x: number;
  /** Normalized [0,1] top edge (top-left origin, +y down). */
  y: number;
  /** Normalized [0,1] box width. */
  width: number;
  /** Normalized [0,1] box height. */
  height: number;
}

// Mirrors src/types.ts LicenseData with nullable fields expressed as optional
// (Nitro maps optional → std::optional on the native side).
// Note: aamvaVersion is a number here; null/absent means not parsed.
export interface LicenseDataSpec {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  issueDate?: string;
  licenseNumber?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  sex?: Sex;
  eyeColor?: string;
  hairColor?: string;
  height?: string;
  weight?: string;
  vehicleClass?: string;
  restrictions?: string;
  endorsements?: string;
  aamvaVersion?: number;
  documentType?: DocumentType;
  mrz?: MRZDataSpec;
  /**
   * Per-field confidence scores in [0, 1]. Keys are camelCase names
   * matching the fields above (e.g. "firstName", "state", "postalCode").
   * Tiers, as populated by the C++ structured extractor:
   *   - 1.00 — cross-validated: two independent checks agree (e.g. state
   *           code present AND zip-prefix consistent with that state, or a
   *           strict-marker value agreeing with a regular path)
   *   - 0.95 — all gates passed: the 4-gate strict demographic parser
   *   - 0.88 — marker-located: a free-text value (name/street) read off its
   *           authoritative AAMVA marker; provenance assured, no content-shape
   *           check possible. Ranked above shape-matched.
   *   - 0.85 — content-shape only (date passed regex, state in lookup
   *           table, sex normalized to M/F/X, eye/hair in AAMVA whitelist)
   *   - 0.50 — extracted raw; no structural validation and not marker-anchored
   *   - absent / 0.0 — field not populated
   * Surfaced as a JSON-encoded string because Nitro v0.35 generics on
   * Map<string, number> don't round-trip cleanly through the Cxx bridge
   * for arbitrary keys; consumers parse via JSON.parse().
   */
  dataConfidenceJson?: string;
  /**
   * file:// path to the perspective-corrected card image (JPEG) saved in
   * the app sandbox on the consensus frame. Absent when no card corners
   * were detected or the rectification failed.
   */
  cardImagePath?: string;
  /**
   * Per-line OCR observations over the saved card image. Present only
   * when `cardImagePath` is present (they are captured together and
   * describe the SAME image); absent on the barcode path, on the TTA
   * verification path, and whenever the dedicated card-image OCR pass
   * fails (fail-soft — never blocks the scan result).
   * See {@link OcrObservationSpec} for the coordinate contract.
   */
  ocrObservations?: OcrObservationSpec[];
  /**
   * file:// path to the cropped headshot (JPEG) extracted from the card
   * via platform face detection (VNDetectFaceRectanglesRequest on iOS,
   * MLKit FaceDetection on Android). Falls back to the YOLO "face" class
   * bbox if face detection finds nothing. Absent when neither method
   * located a face region.
   */
  headshotImagePath?: string;
}

export interface DLScan extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /**
   * Scan progress as a monotonically increasing float in [0, 1].
   * Updated on each frame processor call. Reset to 0 by
   * resetLicenseFieldRecognition(). JS reads this property in the
   * frame processor worklet to drive a progress bar.
   *
   * Progress is weighted by stabilized-field count, not raw frame
   * count, so it advances as fields lock in rather than linearly
   * with time. design review consensus.
   */
  readonly scanProgress: number;

  /**
   * Pipeline processing stage. Set synchronously at each step boundary
   * during the extraction pipeline. Read by the PipelineOverlay to show
   * real step completion signals.
   *
   * 0 = idle (scanning, voter accumulating)
   * 1 = extracting fields (C++ extract_fields_from_candidates)
   * 2 = normalizing data (C++ per-field normalizers)
   * 3 = saving card image (perspective correction + JPEG encode)
   * 4 = detecting face (platform face detection + headshot crop)
   * 5 = done (result ready)
   *
   * Reset to 0 by resetLicenseFieldRecognition().
   */
  readonly pipelineStage: number;

  /**
   * Last-detected card corners as 8 floats [x0,y0, x1,y1, x2,y2, x3,y3]
   * in normalized [0,1] coordinates relative to the oriented camera image.
   * Updated on every frame where doc-seg finds a card. Empty array when
   * no card is detected. JS reads this to animate the reticle to follow
   * the card's position.
   */
  readonly detectedCardCorners: number[];

  parseBarcodeData(barcodeData: string): Promise<LicenseDataSpec | null>;

  /**
   * Reset the OCR-mode field-recognition cache. Call from the JS side when
   * the consumer's scan session ends (e.g., after a successful read or when
   * `useLicenseScanner.reset()` runs) so that the next scan does NOT see a
   * stale cached result from the previous card. Also invalidates any
   * in-flight detection job — its result will be discarded if the
   * generation has changed by the time it lands.
   */
  resetLicenseFieldRecognition(): void;

  // ---- Unified TFLite runtime (react-native-fast-tflite), JS-orchestrated ----
  //
  // The detector/doc-seg inference runs through react-native-fast-tflite in the
  // JS/worklet layer (JS loads the models via loadTensorflowModel and calls
  // model.runSync). These methods bridge the shared, tested C++ pre/post (the
  // detect_c C-ABI) without referencing fast-tflite's c++-only TfliteModel type
  // — which a 5-cycle iOS build proved cannot be passed into a Swift/Kotlin
  // HybridObject (fails at both the <NitroTflite/...> C++ include and the Swift
  // `any HybridTfliteModelSpec` type). See docs/.../2026-05-30-ios-build-findings.md.

  /**
   * Preprocess a rectified RGB8 image (row-major, 3 bytes/px) into the NanoDet
   * field-detector input tensor: NHWC, BGR, ImageNet-BGR mean/std, 416. JS
   * passes the result to the fast-tflite model's runSync.
   */
  preprocessFieldInput(
    rgb: ArrayBuffer,
    width: number,
    height: number
  ): ArrayBuffer;

  /**
   * Decode the NanoDet output tensor (anchor-major [A,62]) into detections in
   * SOURCE pixel space. scaleX/scaleY are inputSize/width and inputSize/height
   * (416/width, 416/height) from the preprocess stretch-resize.
   */
  decodeFieldOutput(
    output: ArrayBuffer,
    scaleX: number,
    scaleY: number
  ): FieldDetectionSpec[];

  /**
   * Preprocess a rectified RGB8 image into the DocAligner input tensor: NHWC,
   * RGB, pixel/255, 256.
   */
  preprocessDocAlignerInput(
    rgb: ArrayBuffer,
    width: number,
    height: number
  ): ArrayBuffer;

  /**
   * Decode the DocAligner corner heatmap ([128,128,4] NHWC) into 4 corners as 8
   * normalized floats [x0,y0,x1,y1,x2,y2,x3,y3] in order TL, TR, BR, BL.
   */
  decodeCorners(output: ArrayBuffer): number[];

  /**
   * Rectify a camera frame for JS-orchestrated field detection: doc-seg +
   * perspective-correct, returning the rectified image as RGB8 bytes plus a
   * `token`. The native side caches the rectified pixel buffer under `token`
   * so ocrExtractFields can OCR it without re-marshaling. Returns null when no
   * card is detected or the call is rate-limited / a job is in flight.
   */
  rectifyFrame(frame: Frame): RectifiedFrameSpec | null;

  /**
   * Run OCR + structured extraction on a previously-rectified frame (looked up
   * by `token`) using JS-provided NanoDet field detections: per-region OCR,
   * demographic parse, voting, C++ field extraction, and card/headshot capture,
   * then free the token. Returns the LicenseDataSpec, or null on any stage
   * failure / unknown token.
   */
  ocrExtractFields(
    token: number,
    detections: FieldDetectionSpec[]
  ): LicenseDataSpec | null;

  /**
   * Images-only capture (NO OCR) for a previously-rectified frame (looked up
   * by `token`), using the JS-provided NanoDet field detections as the
   * quality gate (non-empty detections prove a recognizable card front is in
   * frame) and as the YOLO-face fallback source for the headshot crop. Rides
   * the exact same rectify -> detect entry as `ocrExtractFields`, but
   * short-circuits straight to the once-per-session card-image save +
   * headshot extraction — no OCR text recognition, no C++ parse, no voting,
   * and no TTA-crop retention run (quicker and cheaper per frame).
   *
   * Returns null on every frame until the card JPEG saves successfully (a
   * failed save does NOT latch the once-per-session capture, so the next
   * frame retries). On success returns a LicenseDataSpec whose field values
   * are ALL absent and only `cardImagePath` (always present on success) and
   * `headshotImagePath` (best-effort — absent when no face region was found)
   * are populated. `ocrObservations` is absent too: it is produced by the
   * card-image OCR pass, which this mode skips.
   */
  captureFrontImages(
    token: number,
    detections: FieldDetectionSpec[]
  ): LicenseDataSpec | null;

  /**
   * Test-time-augmentation (TTA) verification pass. ADDITIVE + opt-in: the JS
   * hook only calls this when the consumer enables `completion.tta`, after the
   * normal scan has reached completion. Re-OCRs the BEST captured card crop —
   * the consensus rectified RGB buffer the pipeline already retains when it
   * saved `cardImagePath` — under each requested augmentation, recovering small
   * glyphs a single OCR pass misses (e.g. the standalone vehicle-class "D" on
   * blue WI card stock).
   *
   * `modes` is a list of DLSCAN_AUG_* augmentation ints (see detect_c.hpp:
   * 0 = blue-channel grayscale, 1 = per-channel contrast stretch). For each
   * mode the native side synthesizes an augmented copy of the retained crop via
   * the shared C++ `dlscan_augment_rgb`, runs the SAME whole-card OCR +
   * AAMVA-demographic strict parse + C++ field extraction the normal path uses
   * (whole-card only — no field detector), votes the augmented frames together
   * with a FRESH voter, and returns the voted LicenseDataSpec.
   *
   * Returns null when no consensus crop is currently retained (e.g. the scan
   * finalized best-effort with no card captured, or after
   * resetLicenseFieldRecognition()), or when the augmented frames produce no
   * extractable consensus. Does NOT mutate the live scan voter or re-save the
   * card/headshot images.
   */
  runTtaVerification(modes: number[]): LicenseDataSpec | null;
}
