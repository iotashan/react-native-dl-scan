# JS-Orchestration Pipeline Refactor — Implementation Plan

> Completes the AGPL-YOLO -> Apache-NanoDet rewrite by moving field detection into
> JS (react-native-fast-tflite) and feeding the native OCR pipeline JS-provided
> detections. Export + validation + native-bridge compilation are DONE (commits
> bce7fa3, 8f7b78a; iOS BUILD SUCCEEDED; 282 C++ tests + typecheck + lint green).

**Goal:** remove the bundled YOLOv8 Core ML / .tflite + native runYOLO; field
detection runs in the JS worklet via the validated detector.ts path; native does
rectify + OCR + extract.

## The data-flow split (key design)

Today (iOS `runDetectionPipeline`, async on ocrQueue): docseg -> runYOLO(CoreML)
-> per-bbox Vision OCR -> voter -> C++ extract -> cached spec (JS polls via
recognizeLicenseFields). Detections feed runVisionKitPerRegion + extractHeadshot.

New flow (worklet-orchestrated):
```
const rect = _hybrid.rectifyFrame(frame)              // native: docseg + perspective-correct
if (!rect) return null                                 //   -> {rgb, width, height, token} | null
const dets = runFieldDetection(fieldModel, rect.rgb, rect.width, rect.height)  // JS fast-tflite
return _hybrid.ocrExtractFields(rect.token, dets)      // native: OCR(dets)+voter+extract -> spec|null
```
Native caches the rectified CVPixelBuffer/Bitmap under `token` (small ring, e.g. 4)
so the heavy buffer is marshaled to JS once (as RGB) and reused natively for OCR.

## New Nitro spec (src/specs/DlScan.nitro.ts) + nitrogen regen
- `interface RectifiedFrameSpec { rgb: ArrayBuffer; width: number; height: number; token: number }`
- `rectifyFrame(frame: Frame): RectifiedFrameSpec | null` — rate-limited (~3fps) +
  in-flight guard inside native; null on no-card / throttle. Reuses runDocSeg.
- `ocrExtractFields(token: number, detections: FieldDetectionSpec[]): LicenseDataSpec | null`
  — looks up cached buffer; runs the existing runVisionKitPerRegion(detections) +
  demographic parse + voter + extract_fields_from_candidates + card/headshot capture;
  frees the token. Preserve scanProgress/pipelineStage/generation semantics.
- Keep recognizeLicenseFields during migration (deprecate after parity), or remove +
  update the OCR worklet. Decision: remove (single path) once both platforms wired.

## iOS (ios/HybridDlScanIOS.swift)
- Add rectifyFrame: extract pixel buffer (existing code) -> runDocSeg -> render RGB8
  bytes into an ArrayBuffer + cache the rectified CVPixelBuffer in a [token: CVPixelBuffer]
  dict under a lock; return RectifiedFrameSpec. Keep the rate-limit/generation logic.
- Add ocrExtractFields: fetch cached buffer by token; run the steps currently after
  runYOLO in runDetectionPipeline, with `detections` coming from the arg (map
  FieldDetectionSpec -> the internal Detection/yolo::Detection used by
  runVisionKitPerRegion + extractHeadshot). Remove runYOLO + cachedYoloRequest +
  the VNCoreMLRequest/Core ML model load.
- DELETE the DlScanFieldDetector.mlmodelc/.mlpackage bundling (podspec resource_bundles).

## Android (android/.../HybridDlScanAndroid.kt) — mirror
- rectifyFrame (MLKit/doc-seg + rectify -> RGB + token cache), ocrExtractFields
  (MLKit text per region + voter + extract). Remove the native TFLite YOLO interpreter
  + dl_scan_field_detector.tflite load from the OCR path.

## JS (src/useLicenseScanner.ts + scanFrame.ts)
- Load models once: loadDetectorModels(require('<field>.tflite'), require('<docaligner>.tflite'),
  delegates) in the hook; thread fieldModel into the OCR worklet (Worklets sharable).
- Rewrite scanFrameOcr to the 3-step flow above. Keep undefined->null normalization.

## Model placement
- Put nanodet_field_416.tflite where require() resolves for both platforms (metro
  assetExts already lists tflite). Swap models/ + android/src/main/assets/
  dl_scan_field_detector.tflite -> the NanoDet model; update models/version.json
  (NanoDet-Plus-m, 416, mAP 0.967, sigmoid'd cls, Apache-2.0). The fp32 4.99MB is the
  default; the 1.59MB dynamic-int8 is an on-device perf-sweep candidate.

## Build/test gates (per increment)
- yarn test:cpp (282), yarn typecheck, yarn lint after JS/spec changes.
- nitrogen (npx nitro-codegen) after spec change; commit generated.
- iOS: xcodebuild simulator (CODE_SIGNING_ALLOWED=NO) — already green baseline.
- Android: ./gradlew (JDK21 per CLAUDE.md) assembleDebug.
- Device/SimCam: launch example, feed an IDNet card via SimCam, confirm fields read.

## Open decision (needs on-device measurement)
Synchronous-in-worklet (simplest) vs. keep rectify/OCR async-queued (preserves
preview FPS). Start synchronous + rate-limited; if FPS drops, move ocrExtractFields
back onto a native queue with a JS poll (token stays valid until consumed).

## Phase-4 cleanup (after parity)
- Delete cpp/yolo/* IF nanodet_decode fully replaces it (verify no other caller),
  the old Core ML model, old .tflite, NitroTflite/native-orchestration remnants.
- Update docs/ model+data cards.

