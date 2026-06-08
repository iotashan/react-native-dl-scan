# Phase 2 — fast-tflite native wiring (execution blueprint)

**Status:** scaffolding DONE + validated up to the inference call; the inference
cutover itself is gated on (a) an example build to validate the ArrayBuffer
marshaling / Android JNI, and (b) a trained NanoDet `.tflite` to actually run
the field detector (DocAligner half can run as soon as it's built — its
`.tflite` ships).

## Progress (2026-05-30, all committed on `claude/nanodet-ort`)
- ✅ **2.0 deps/config** — fast-tflite ^3.0.0 (lib peer+dev, example dep), metro
  singleton + `tflite` assetExt, expo plugin (Core ML + Android GPU). `5dcdb46`
- ✅ **2.1 Nitro spec** — `setFieldDetectorModel`/`setDocAlignerModel(TfliteModel)`
  added; `yarn nitrogen` regenerated cross-module bindings
  (`shared_ptr<HybridTfliteModelSpec>` + `NitroTflite` include) for all 3
  languages; **`tsc` + `eslint` clean** → integration proven at codegen level. `8fe69f8`
- ✅ **native setters** — Swift (`import NitroTflite`) + Kotlin (FQN) impls store
  the injected models, matching the generated abstract signatures exactly. `92e4b8c`
- ✅ **C-ABI** (`detect_c`) + **C++ core** — 282 tests. `7ba218a` + earlier.
- ⏳ **2.2 TS hook** — load both `.tflite` via `loadTensorflowModel`, call the
  setters. (Field `.tflite` needs trained weights.)
- ✅ **cpp/detect wired into both app builds** — podspec glob + android/CMakeLists
  (the 282-test C++ was not compiled into either app before). `3074eb8`
- ✅ **2.3 C++ orchestrator** — `detect_tflite.{hpp,cpp}`: `run_field_detector_tflite`
  / `run_doc_aligner_tflite` do preprocess → `model->runSync` → decode entirely
  in C++ (avoids ArrayBuffer marshaling in Swift+Kotlin). `__has_include`-guarded
  so it's live in the app builds, empty TU in the GoogleTest build. `8eb78f3`
- ⏳ **2.4 native call sites (LAST MILE, build-gated)** — Swift/Kotlin must obtain
  the underlying `shared_ptr<HybridTfliteModelSpec>` from the injected model and
  call `dlscan::detect::run_field_detector_tflite(model, rgb, w, h)` (+ the
  doc-aligner one), then route the result into the pipeline in place of
  `runYOLO`/`runDocAligner` (gate on `fieldDetectorModel != nil`, else fall back).

  **Bridging breadcrumbs (verified by reading the generated code — do this in a
  build session where the cross-module types resolve):**
  - The injected model reaches Swift as `any HybridTfliteModelSpec`; Nitro's
    generated `HybridDlScanSpec_cxx.swift` already shows the forward conversion
    `HybridTfliteModelSpec_cxx.fromUnsafe(ptr).getHybridTfliteModelSpec()` from a
    `bridge.std__shared_ptr_margelo__nitro__tflite__HybridTfliteModelSpec_`. For
    the call site, go the reverse direction to get the C++ `shared_ptr` and pass
    it to the orchestrator. The `HybridTfliteModelSpec_cxx` Swift type +
    `NitroTflite` module are generated at pod-build time (not shipped in the
    npm package), which is why this line can only be written/compiled there.
  - `react-native-fast-tflite` ships ONLY C++ for `TfliteModel`
    (`HybridTfliteModelSpec.{hpp,cpp}`, namespace `margelo::nitro::tflite`); no
    Swift/Kotlin wrapper files — so driving `runSync` from Swift/Kotlin directly
    is not available; go through the C++ orchestrator (already committed).
  - Swift ArrayBuffer API (if ever needed directly):
    `margelo.nitro.ArrayBufferHolder.copy(...)` / `.wrap(data,size,deleteFn)`
    (`node_modules/react-native-nitro-modules/ios/core/ArrayBuffer.swift`).
  - Android: add a JNI function in `android/src/main/cpp/dlscan_jni_bridge.cpp`
    that receives the model (via its Nitro Kotlin handle's C++ pointer) + the
    bitmap bytes and calls the orchestrator; the existing `nativeExtract*` JNI
    functions show the pattern.
  - RGB source: reuse the existing rectified-buffer extraction in `runYOLO`
    (iOS `CVPixelBuffer`) / `runDocAligner` (Android `Bitmap`).
- ⏳ **2.5 delete** old VNCoreMLRequest/`.mlmodelc` + `org.tensorflow.lite` paths
  (after cutover validated).
- ⏳ **2.6 validate** — build example; DocAligner end-to-end now, field detector
  once weights exist; then Phase 3 on-device sweep.

**Done before this phase (committed on `claude/nanodet-ort`, 282 C++ tests):**
- C++ core: `nanodet_decode`, `preprocess` (NHWC/NCHW), `doc_aligner` decode +
  `preprocess_docaligner`, orchestrators, `ModelInterpreter` seam.
- C-ABI bridge `cpp/detect/detect_c.{hpp,cpp}`: `dlscan_preprocess_field`,
  `dlscan_decode_field`, `dlscan_preprocess_docaligner`, `dlscan_decode_corners`.
- Deps/config: `react-native-fast-tflite ^3.0.0` declared (lib peer+dev, example
  dep), metro singleton + `tflite` assetExt, expo plugin (Core ML + Android GPU).

## Architecture (decided)

Inference moves to **react-native-fast-tflite** (Nitro HybridObject), one runtime
on both platforms. Orchestration stays in the existing native Nitro object
(`HybridDlScanIOS.swift` / `HybridDlScanAndroid.kt`):

```
camera RGB ──▶ C++ dlscan_preprocess_field ──▶ Float32 ArrayBuffer
            ──▶ fast-tflite TfliteModel.runSync(buffer)  [Core ML / GPU / NNAPI]
            ──▶ output ArrayBuffer ──▶ C++ dlscan_decode_field ──▶ detections
```
Same shape for DocAligner via `dlscan_preprocess_docaligner` / `dlscan_decode_corners`.

This **replaces**: iOS `VNCoreMLRequest` + `DlScanFieldDetector.mlmodelc`
(`runYOLO`, `cachedYoloRequest`); Android `org.tensorflow.lite.Interpreter`
(`tfliteInterpreter`, `docAlignerInterpreter`, `ensureTfliteInterpreter`,
`runDocAligner`). And it **replaces the decode**: old YOLOv8 `(1,34,8400)`
channel-major via `dlscan::yolo::decode_and_nms` → NanoDet `(1,3598,62)`
anchor-major via `dlscan_decode_field`.

## Open risk to resolve on first export (CRITICAL)

The NanoDet ONNX→TFLite (onnx2tf) output layout is **unconfirmed** — local
conversion hit the known onnx2tf shape-inference error (fall back to onnx2tf
1.26.3 per the TFLite-stack memory). The C++ decode assumes **anchor-major
`[1,3598,62]`**. If onnx2tf emits **channel-major `[1,62,3598]`**, `decode_field`
must transpose (the `dlscan::yolo` code already carries a `TensorLayout` enum for
exactly this). **Verify the converted `.tflite` output shape before trusting the
decode**, and add a layout guard/param to `dlscan_decode_field` if channel-major.
Confirm input is NHWC `[1,416,416,3]` (preprocess already emits NHWC).

## Tasks

### 2.1 Nitro spec: receive fast-tflite model handles
- `src/specs/DlScan.nitro.ts`: add a way for the native object to use the loaded
  models. Preferred: a setter taking the fast-tflite model HybridObjects, e.g.
  `setModels(field: TensorflowModel, docAligner: TensorflowModel): void`, OR
  pass them per-call. (fast-tflite's `TfliteModel` is a Nitro HybridObject with a
  C++ base, bridgeable to Swift/Kotlin — confirm the exact exported type name
  after install.)
- Run `yarn nitrogen` to regenerate `nitrogen/generated/`.

### 2.2 TS hook: load + pass models
- `src/` hook (`useLicenseScanner`): `loadTensorflowModel(require('...nanodet.tflite'), 'core-ml')`
  and the DocAligner model; pass both to the native object via `setModels`.
- Models bundled as assets (metro `tflite` assetExt already set). Decide asset
  location (JS-require'd path vs the current android/ios native asset dirs).

### 2.3 iOS Swift wiring (`ios/HybridDlScanIOS.swift`)
- Hold the injected `TfliteModel` handles.
- Replace `runYOLO`: call `dlscan_preprocess_field` (Cxx interop) → `model.runSync`
  → `dlscan_decode_field`. Map detections exactly as today downstream.
- Replace the iOS doc-seg step with `dlscan_preprocess_docaligner` + `runSync` +
  `dlscan_decode_corners`.
- Delete `cachedYoloRequest`, the `VNCoreMLRequest` plumbing, and the
  `DlScanFieldDetector.mlmodelc` resource.

### 2.4 Android Kotlin wiring (`android/src/main/java/.../HybridDlScanAndroid.kt`)
- Hold the injected `TfliteModel` handles.
- Replace `ensureTfliteInterpreter`/`runYOLO`-equivalent + `runDocAligner` with
  fast-tflite `runSync` around JNI calls to the `dlscan_*` C-ABI (add a thin
  JNI wrapper that forwards to `detect_c.hpp`).
- Delete `org.tensorflow.lite.Interpreter` usage + the `org.tensorflow:tensorflow-lite`
  gradle deps (fast-tflite brings its own runtime).

### 2.5 Remove the old yolo decode path (after both platforms cut over)
- `cpp/yolo/yolo_postprocess.*` `decode_and_nms` is now unused by the field
  detector; keep only if something else references it (audit), else delete with
  its tests.

### 2.6 Validate
- `yarn install` (lib + example), `yarn nitrogen`, `yarn typecheck`.
- Build the example (iOS sim via SimCam + Android). Field detector needs the
  trained NanoDet `.tflite`; until then validate DocAligner end-to-end + verify
  the field path compiles and runs against the untrained/probe `.tflite` for
  shape/layout (NOT accuracy).
- On-device EP × quant × resolution sweep (Phase 3) on physical iPad + Pixel.

## Why not done in this session
Recent kernel panic (mach-port/fd zone exhaustion attributed to claude.exe under
the parallel-workflow load) → avoiding heavy build/parallel ops. And the native
changes must be compiled against an example build + a trained `.tflite` to be
verifiable; committing ~5k lines of blind native refactor would violate the
do-it-right / verify-before-completion SOP. C++ + C-ABI + config are done and
tested so this phase is turnkey once a build environment + weights are available.
