# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Field detector: YOLOv8n -> NanoDet-Plus-m.** The front-of-card field detector
  was replaced with NanoDet-Plus-m (Apache-2.0), trained on IDNet
  (mAP@0.5:0.95 0.967 / AP@0.5 0.9996). This removes the AGPL ambiguity that came
  from training/exporting with Ultralytics; every model in the pipeline is now
  Apache-2.0 (see [docs/THIRD_PARTY_MODELS.md](docs/THIRD_PARTY_MODELS.md)).
- **Field-detector inference is now JS-orchestrated** via
  [react-native-fast-tflite](https://github.com/mrousavy/react-native-fast-tflite),
  replacing the native Core ML (iOS) + native TFLite (Android) detection paths.
  The native side bridges the shared C++ preprocess+decode (the detect_c C-ABI:
  rectifyFrame + ocrExtractFields); JS loads the model and runs inference. See
  ADR 002 in [docs/ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md).
- The field detector now ships at `models/nanodet_field_416.tflite`
  (416x416 NHWC, `[1,3598,62]` output).
- **Front-OCR parsing generalized across US jurisdictions** — alphabetic-label
  (California-style) layouts, bare-number license numbers, DC marker+label+next-line
  names, marker-9 vehicle-class hardening, and a partial-parse validity gate.
  Verified by a 10-state replay guardrail with no per-field regressions.
- **Default `requiredFields` no longer gates on `sex`.** It is the slowest field
  to converge on Android, so it is captured opportunistically rather than blocking
  completion (iOS reads it reliably via VisionKit). Use the new
  `STRICT_REQUIRED_FIELDS` to require it. `maxFrames` default stays 30.
- **Per-field confidence is provenance-aware.** Free-text fields (name/street)
  located by their authoritative AAMVA marker report a `marker_located` (0.88)
  tier rather than the flat 0.50 floor; corroborated free-text caps at
  `all_gates_passed` (0.95). The example result screen colors tiers perceptually,
  reserving red for missing fields.

### Removed

- **BREAKING:** the native `recognizeLicenseFields` method and the legacy YOLO
  detection path (Core ML `DLScanFieldDetector.mlmodelc` on iOS,
  `dl_scan_field_detector.tflite` on Android). OCR mode now requires the
  field-detector model via the new `useLicenseScanner` `ocrModelSources` option:
  `useLicenseScanner('ocr', { field: require('react-native-dl-scan/models/nanodet_field_416.tflite') })`.

### Added

- **Images-only capture mode** — `completion: { capture: 'imagesOnly' }` on
  `useLicenseScanner` (new `CaptureMode` type). The front scan rides the same
  doc-seg rectification + NanoDet quality gate but skips OCR text recognition,
  the C++ AAMVA parse, multi-frame voting, and TTA entirely, returning only
  the rectified card JPEG (`cardImagePath`) and the best-effort headshot crop
  (`headshotImagePath`, nullable). Completes as soon as the card image saves;
  `requiredFields` is ignored, every `LicenseData` field value is null, and
  `ocrObservations` is absent. Quicker and cheaper per frame than a full scan.
  Use case: read the barcode for data AND keep a photo of the card front
  (dealership test drives, rental counters). Backed by a new
  `captureFrontImages` Nitro method on both platforms.
- **`ocrObservations` on the scan result** — per-line OCR observations
  (`text` + normalized bounding box) over the saved card image. Boxes are
  normalized `[0,1]`, origin top-left, +y down, relative to the exact image
  at `cardImagePath` (a dedicated whole-card OCR pass runs on the saved
  image at capture time on both platforms). Optional and fail-soft: absent
  on the barcode path or when the pass fails; never affects parsing.
- **Example: Overlay | Original scanned-card view** — the result screen's
  SCANNED CARD section gains a segmented toggle (Overlay default) that
  renders each recognized string at its position/size over a translucent
  scrim; falls back to the plain image (toggle disabled) when no
  observations are available.
- `loadDetectorModels` / `loadFieldModel` / `runFieldDetection` / `runDocAligner`
  and the `OcrModelSources` type for the JS-orchestrated detector path.
- `STRICT_REQUIRED_FIELDS` — the default required set plus `sex`, for consumers
  that must not finalize a scan without it (pair with `maxFrames: 40`).
- **iOS 26+: DataDetector cross-check in the finalization pass.** Apple Vision's
  `RecognizeDocumentsRequest` runs once over the saved card crop; its
  DataDetector hits (dates, postal address) fill empty fields at
  `shape_matched` or upgrade exact-agreeing fields to `cross_validated`. Strictly
  enrich-only and fail-closed (dates assigned only when exactly three distinct,
  plausible dates are detected; any populated-slot disagreement discards the
  whole set). No-op below iOS 26, on Android, and for consumers building with
  pre-Xcode-26 SDKs (compile-guarded).

### Fixed

- The OCR validation pass could finalize prematurely when a higher-confidence
  re-read overwrote the accumulator before the contradiction check; it now
  compares the fresh frame against a pre-merge snapshot.
- A failed `"city, ST zip"` address split no longer dumps the raw line into `city`.
- **Importing the library no longer crashes Android apps at startup.** The
  Android barcode output eagerly imported
  `react-native-vision-camera-barcode-scanner`, whose module-scope
  `createHybridObject` throws under bridgeless React Native (the plugin's
  native init never runs — an upstream `companion object init {}` bug). The
  plugin is now lazy-required on first use of barcode mode, fully decoupling
  front-OCR scanning from the plugin's load state.
- Example app: the license hero card sizes to its content on both form factors
  (no more giant empty card on tablets / overflowing card on phones); the
  detected-card bounding box renders on all shells via orientation-aware
  corner mapping (previously phone-portrait only); the processing-stage
  narration matches the real pipeline on both platforms; the tablet
  result-screen "Start scan" no longer re-emits the prior result.

## [0.2.0] - 2026-05-28

First public release on npm. This release represents a near-complete rewrite of
the library on top of [Nitro Modules](https://nitro.margelo.com) and adds
Android support, on-device YOLO field detection, a shared C++ core, and a new
scanner UX. Earlier `0.1.x` versions were never published; if you were tracking
the repo before this release, treat `0.2.0` as the start of the public history.

### Added

- **Nitro Modules architecture.** The native bridge is now generated from
  Nitro's HybridObject specs, replacing the prior Turbo Modules surface. This
  is the foundation for every change below.
- **Android support.** The library was iOS-only prior to this release. Android
  now ships with feature parity for PDF417 decoding, OCR, field detection, and
  document segmentation.
- **Shared C++ core.** Parsing, scoring, and multi-frame voting logic live in
  `cpp/` and are compiled into both the iOS and Android targets, with the
  TypeScript API as a thin wrapper. See
  [docs/ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md).
- **C++ AAMVA parser** for PDF417 back-of-card data, covering AAMVA versions 1
  through 10 and the common state-specific element extensions. Verified by 261
  GoogleTest cases in `cpp/tests/`.
- **Shipped YOLO field-detector models** for the front of the card:
  - iOS: Core ML, int8 weight-quantized.
  - Android: TFLite, int8.
  - See [docs/MODEL_CARD.md](docs/MODEL_CARD.md) for inputs, outputs,
    quantization details, and known accuracy bounds.
- **Document segmentation.** iOS uses Apple's
  `VNDetectDocumentSegmentationRequest` (Vision framework). Android ships a
  bundled DocAligner LCNet100 TFLite model (~2.4 MB) since the ML Kit
  Document Scanner exposes a prompted UI flow that's incompatible with our
  worklet-based capture loop. Detected corners drive perspective correction
  before OCR on both platforms.
- **Corner-tracking overlay.** A live overlay traces the detected card corners
  in the camera viewfinder so the user can see when alignment is good.
- **Multi-frame field voter** with a consensus exit. Per-field OCR results are
  accumulated across frames; when the top candidate clears the agreement
  threshold the voter exits early instead of running the full frame budget.
- **MRZ decode preparation.** Hooks and field plumbing for Machine Readable
  Zone decoding are in place for non-US documents. End-to-end MRZ decode is not
  enabled in this release.
- **`ResultView` component** that renders parsed fields with confidence tiers
  (high / medium / low) so consuming apps can highlight uncertain values
  without writing their own scoring logic.
- **`FlipCard` scanner-to-result transition.** A 3D card flip on iOS and a
  slide transition on Android hand off from the live scanner to the result
  view.
- **Debug drawer.** A developer-only panel that surfaces frame timings, voter
  state, OCR confidences, and the last few decoded payloads. Off by default;
  opt in via prop.
- **Performance optimizations:**
  - Adaptive consecutive-agreement exit (stop voting once N frames agree).
  - OCR cooldown of 300 ms between frame submissions to avoid backpressure.
  - `MAX_VOTING_FRAMES = 8` cap to bound worst-case latency.
- **Tablet and landscape layouts** (Phase H of the rebuild). Scanner and
  result UI now adapt to iPad and Android tablet form factors and to
  landscape orientation on phones.

### Changed

- **Turbo Modules → Nitro Modules.** This is a breaking architectural change
  (Phase H of internal task #71). Consuming apps must be on a New Architecture
  build of React Native.
- **`react-native-vision-camera` v4 → v5.** The peer-dependency bump aligns
  with Vision Camera's frame-processor changes; see Vision Camera's own
  migration notes for any consumer-side impact.
- **License: GPL-3.0 → MIT.** The project is now distributed under the MIT
  license. All prior unpublished versions were GPL-3.0; the relicense is part
  of the public release.

### Known limitations

- **State coverage.** The shipped field detector and OCR pipeline were trained
  and evaluated against the [IDNet](https://github.com/joshpilkington/IDNet)
  dataset (10 US states). Other states' layouts may decode at lower accuracy
  until additional training data is added. See
  [docs/LIMITATIONS.md](docs/LIMITATIONS.md) and
  [docs/EVALUATION.md](docs/EVALUATION.md).
- **Corner-tracking overlay** is disabled in landscape orientation and on
  tablets in this release; a v2 polish pass is planned.
- **Not certified for KYC/AML.** This library is intended for convenience
  data-capture flows. It is not a substitute for a regulated identity
  verification service and has not been evaluated against KYC/AML compliance
  requirements.

[Unreleased]: https://github.com/iotashan/react-native-dl-scan/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/iotashan/react-native-dl-scan/releases/tag/v0.2.0
