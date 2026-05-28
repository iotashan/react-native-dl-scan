# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
