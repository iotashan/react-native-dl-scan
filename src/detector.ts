// JS-orchestrated unified TFLite runtime (react-native-fast-tflite).
//
// The field detector (NanoDet) and doc-segmenter (DocAligner) run through
// react-native-fast-tflite in JS/worklet land: JS loads the .tflite models and
// calls `model.runSync`, while the shared, tested C++ core does the
// model-specific pre/post via the native C-ABI (exposed on the DlScan hybrid
// object as preprocessFieldInput/decodeFieldOutput/preprocessDocAlignerInput/
// decodeCorners).
//
// This is the architecture the iOS build settled on: passing fast-tflite's
// c++-only TfliteModel INTO the native Swift/Kotlin object fails at both the
// C++ include and the Swift-type layers (see
// docs/superpowers/plans/2026-05-30-ios-build-findings.md). Keeping the model in
// JS and threading only ArrayBuffers across the boundary sidesteps that
// entirely and reuses 100% of the 282-test C++ core.

import {
  loadTensorflowModel,
  type ModelSource,
  type TensorflowModelDelegate,
  type TfliteModel,
} from 'react-native-fast-tflite';

import { _hybrid } from './native';
import type { FieldDetectionSpec } from './specs/DlScan.nitro';

// The native preprocess emits the model-native input size; JS only needs these
// to compute the inverse-stretch scale for decodeFieldOutput.
const FIELD_INPUT_SIZE = 416;

export type { FieldDetectionSpec };

export interface DetectorModels {
  /** NanoDet field detector (30 classes). */
  field: TfliteModel;
  /** DocAligner corner-heatmap doc-segmenter. */
  docAligner: TfliteModel;
}

/**
 * Load the unified TFLite runtime models. Pass the `.tflite` assets via
 * `require('...tflite')` (metro must list `tflite` in assetExts — it does) or
 * `{ url }`. `delegates` selects hardware acceleration: `['core-ml']` (iOS ANE),
 * `['android-gpu']`/`['nnapi']` (Android), or `[]` for the CPU default.
 */
export async function loadDetectorModels(
  fieldSource: ModelSource,
  docAlignerSource: ModelSource,
  delegates: TensorflowModelDelegate[] = []
): Promise<DetectorModels> {
  const [field, docAligner] = await Promise.all([
    loadTensorflowModel(fieldSource, delegates),
    loadTensorflowModel(docAlignerSource, delegates),
  ]);
  return { field, docAligner };
}

/**
 * Load only the NanoDet field detector. The OCR worklet path
 * (scanFrameOcrNanodet) does doc-segmentation natively, so the DocAligner model
 * is not needed there — use this instead of loadDetectorModels so a missing/
 * failed DocAligner asset can't gate field detection.
 */
export async function loadFieldModel(
  fieldSource: ModelSource,
  delegates: TensorflowModelDelegate[] = []
): Promise<TfliteModel> {
  return loadTensorflowModel(fieldSource, delegates);
}

/**
 * Run the NanoDet field detector on a rectified RGB8 image (row-major, 3
 * bytes/px, `width` x `height`). Returns detections in SOURCE pixel space.
 * Synchronous — safe to call from a frame-processor worklet via runSync.
 */
export function runFieldDetection(
  model: TfliteModel,
  rgb: ArrayBuffer,
  width: number,
  height: number
): FieldDetectionSpec[] {
  'worklet';
  const input = _hybrid.preprocessFieldInput(rgb, width, height);
  const output = model.runSync([input])[0];
  if (output == null) return [];
  return _hybrid.decodeFieldOutput(
    output,
    FIELD_INPUT_SIZE / width,
    FIELD_INPUT_SIZE / height
  );
}

/**
 * Run DocAligner on a rectified RGB8 image. Returns 8 normalized [0,1] corner
 * floats [x0,y0, x1,y1, x2,y2, x3,y3] in order TL, TR, BR, BL (empty on failure).
 */
export function runDocAligner(
  model: TfliteModel,
  rgb: ArrayBuffer,
  width: number,
  height: number
): number[] {
  'worklet';
  const input = _hybrid.preprocessDocAlignerInput(rgb, width, height);
  const output = model.runSync([input])[0];
  if (output == null) return [];
  return _hybrid.decodeCorners(output);
}
