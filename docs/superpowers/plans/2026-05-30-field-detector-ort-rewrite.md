# Field-Detector Inference Rewrite (NanoDet → ONNX → ONNX Runtime, unified in C++) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AGPL-3.0 Ultralytics YOLOv8 field detector (run as two separate runtimes — Core ML on iOS, TFLite on Android) with an Apache-2.0 NanoDet model exported to ONNX and run through a single ONNX Runtime inference path living in the shared C++ core — then empirically tune it for best on-device performance on a real iPad + Pixel.

**Architecture:** Today, model inference is the *one* part of the pipeline that is NOT unified: Swift runs `VNCoreMLRequest`, Kotlin runs a TFLite `Interpreter`, and only the *decode* (`dlscan::yolo::decode_and_nms`) is shared C++. This plan moves inference itself into `cpp/` via ONNX Runtime, so the platform layer shrinks to "hand C++ the rectified RGB image," and one ONNX model + one decode + one quantization pipeline serve both platforms. This closes the last platform-divergence seam and removes the AGPL license blocker.

**Tech Stack:** NanoDet-Plus (PyTorch, Apache-2.0) · ONNX · ONNX Runtime C++ (MIT; Core ML EP on iOS, XNNPACK/NNAPI on Android) · existing `cpp/` core (C++17, GoogleTest, CMake) · Nitro Modules (Swift/Kotlin hybrids) · Python model-training env (uv).

---

## Context: current state and what moves

**Current OCR-mode pipeline** (inside `HybridDLScanIOS.swift::recognizeLicenseFields` / `HybridDLScanAndroid.kt::recognizeLicenseFields`):

```
rectified card image
  → [PLATFORM] run field detector     iOS: VNCoreMLRequest(.mlmodelc)   Android: TFLite Interpreter(.tflite)   ← AGPL, two runtimes
  → [C++]      dlscan::yolo::decode_and_nms(raw tensor)  → Detection[]                                          ← YOLOv8-specific decode
  → [PLATFORM] vendor OCR              iOS: VisionKit    Android: ML Kit Text Recognition
  → [PLATFORM] IoU-match OCR text ↔ detection bboxes (uses C++ dlscan::yolo::iou helper)
  → [C++]      dlscan::ocr extract_fields → LicenseDataSpec
```

**After this rewrite:**

```
rectified card image (RGB buffer)
  → [C++] dlscan::detect::FieldDetector::run(image)                                                            ← ORT inference (one runtime)
            internally: preprocess(letterbox 640²) → ORT session.Run() → nanodet decode + NMS → Detection[]    ← Apache-2.0, shared
  → [PLATFORM] vendor OCR (unchanged: VisionKit / ML Kit)
  → [PLATFORM] IoU-match (unchanged)
  → [C++] dlscan::ocr extract_fields (unchanged)
```

The **barcode/PDF417 tier is untouched** — it never used the detector. OCR mode is the only consumer.

**Files that exist today (read these before starting):**
- `cpp/yolo/yolo_postprocess.{hpp,cpp}` — current YOLOv8 decode (`decode_and_nms`, `iou`). KEEP `iou`; the YOLOv8 `decode_and_nms` becomes dead once NanoDet ships (remove in Phase 4).
- `cpp/yolo/field_classes.{hpp,cpp}` — 30-class index↔FieldId table. Reused; re-sort only if NanoDet emits a different class order.
- `ios/HybridDLScanIOS.swift` — `runYOLO()` (~line 694), `recognizeLicenseFields` pipeline (~line 399), `ensureYoloRequest`/`cachedYoloRequest` (~line 217).
- `android/src/main/java/com/margelo/nitro/dlscan/HybridDLScanAndroid.kt` — `runYolo()` (~line 360), `recognizeLicenseFields`, TFLite `Interpreter` lifecycle (~line 133).
- `cpp/CMakeLists.txt` — C++ build + GoogleTest wiring (this is where ORT links for tests).
- `android/CMakeLists.txt` — Android NDK build (this is where ORT links for the app).
- `DLScan.podspec` + `Package.swift` — iOS dependency declarations (this is where ORT links for the app).
- `model-training/` — 4 isolated uv projects (train / export-ios / export-android / disambig per memory `project_env_layout`). A NanoDet env is added; the two platform-export envs collapse to one ONNX export.
- `models/version.json` — model metadata (currently records the AGPL YOLOv8 export).

---

## Model selection (verified licenses — do not trust secondary claims)

The detector must be Apache/BSD/MIT-permissive AND mobile-tiny (the role is a ~30-class field localizer on a rectified card; the task saturates a nano model). Licenses below are **independently verified** (2026-05-30) — a prior review casually mislabeled several, which is exactly the mistake that created this whole effort, so every candidate's license is checked, not assumed:

| Candidate | License | Fit | Verdict |
|---|---|---|---|
| **NanoDet-Plus-m** | **Apache-2.0** ✓ | ~1 MB, mobile-first, ShuffleNetV2 | **Primary** |
| **YOLOX-Nano** | **Apache-2.0** ✓ | 0.9M params, anchor-free decoupled head | **Backup** (decode closer to YOLOv8 → smaller C++ change) |
| RT-DETR (Baidu/lyuwenyu) | Apache-2.0 ✓ | smallest is R18 **@ 20M params** | Too heavy (~20× NanoDet) — rejected |
| YOLOv6 (Meituan) | **GPL-3.0** ✗ | — | Disqualified (copyleft, same class of problem as AGPL) |
| YOLOv5 (Ultralytics) | **AGPL-3.0** ✗ | — | Disqualified |
| Gold-YOLO (Huawei Noah) | unverified/non-permissive ⚠️ | — | Rejected until license confirmed |

**Decision: NanoDet-Plus-m primary, YOLOX-Nano as the fallback** if NanoDet's export/decode proves troublesome (Phase −1 gate decides). Caveat to carry into Phase −1: **RangiLyu/nanodet is largely unmaintained since ~2022-2023** — verify it exports to ONNX under a current PyTorch/opset before committing; if export is broken, switch to YOLOX-Nano (more active, Apache-2.0). The C++ decode differs between them, so the model choice gates Task 1.3.

## DocAligner: folded into the unified ORT runtime (do-it-right scope — user decision 2026-05-30)

The field detector is not the only model: Android also runs **DocAligner lcnet100** (Apache-2.0, DocsaidLab) for document segmentation, today via its own TFLite `Interpreter`; iOS does doc-seg via Apple Vision `VNDetectDocumentSegmentationRequest` (no bundled model). That's *two* asymmetries (Android-TFLite vs iOS-Apple-Vision, AND a different method entirely per platform). Per "do it right," DocAligner is folded into the **same** unified ORT-in-C++ runtime as the field detector, so doc-seg also runs one model + one decode + one quantization path.

**Deltas to the phases (DocAligner rides the same infrastructure as NanoDet):**
- **Phase 0 (Task 0.6):** export DocAligner lcnet100 → ONNX (FP16; from DocsaidLab source if available, else convert the existing `docaligner_lcnet100.tflite` → ONNX). Generate goldens for its **4-channel 128×128 corner-heatmap** output (the validated approach per the doc-seg notes: channel→peak → 4 corners → `setPolyToPoly` rectification). Apache-2.0 — clean, no AGPL issue (only the YOLOv8 field detector had that).
- **Phase 1 (Task 1.6):** `cpp/detect/doc_aligner.{hpp,cpp}` — reuse the `FieldDetector` ORT-session pattern; decode = per-channel heatmap peak → 4 corner points (its own golden test on the Mac).
- **Phase 2:** Android — replace the DocAligner TFLite `Interpreter` (`docAlignerInterpreter`) with the ORT C++ `DocAligner`. iOS — **sub-decision (measure, don't assume):** keep Apple Vision doc-seg (free, ANE, zero bundle cost, maintained by Apple) vs. switch to bundled DocAligner-via-ORT for true cross-platform parity (adds ~2.4 MB to the iOS bundle, drops a working vendor path). Default per the parity argument = unify onto DocAligner; **but** Apple Vision's zero-cost ANE doc-seg is a real win, so this one is gated on a Phase-3 measurement (does unified DocAligner match Apple Vision's corner accuracy on real iPad captures? if yes, unify; if Apple Vision is clearly better/cheaper, keep it iOS-only and accept the doc-seg asymmetry while the *field detector* stays unified).
- **Phase 3:** add doc-seg to the per-device timing matrix (its own EP/quant), plus the iOS Apple-Vision-vs-DocAligner accuracy+latency comparison.
- **Phase 4:** delete `android/src/main/assets/docaligner_lcnet100.tflite` (replaced by the ONNX); keep the THIRD_PARTY_MODELS.md DocAligner attribution; update docs.

This makes the **entire** on-device model story — field detection AND document segmentation — run through one C++ ORT path (modulo the iOS-doc-seg sub-decision), which is the maximal expression of the single-core thesis.

## Decided up-front (objectively better — NOT A/B'd)

Per the "do it right pre-publish" SOP and performance reasoning, two of the candidate "variations" have a clear winner and are decided, not measured:

### Decision 1 — Preprocessing happens in C++ (not platform-native), shared across platforms.
**Why this is objectively right here, not just convenient:** the project's entire thesis is "single parsing core, *same results on both platforms*." If iOS resizes via `vImage` and Android via `Bitmap.createScaledBitmap`, the two produce subtly different resampled pixels → different model inputs → *different detections on each platform*. Doing letterbox+resize+normalize once in C++ guarantees **bit-identical model inputs** on both platforms, which is a correctness property, not a style preference. The perf cost is negligible: resizing one 640×640 image is sub-millisecond-to-low-ms vs. inference at multiple ms. The platform passes a raw RGB(A) buffer + dimensions across the Swift/Kotlin↔C++ boundary; C++ owns letterbox, BGR/RGB ordering, normalization, and NCHW layout. **Instrument** preprocessing time so if it ever exceeds ~10% of inference latency we revisit — but do not build a second platform-native implementation speculatively.

### Decision 2 — NanoDet decode runs in C++ on raw model outputs (default), with the in-graph variant exported up-front so Phase 3 can measure it.
**Why C++ decode is the default:** (a) NanoDet's native export emits raw per-level head tensors and expects the consumer to decode (their reference ncnn demo decodes in C++) — low-friction, well-trodden; (b) it matches the existing architecture (`decode_and_nms` already lives in C++); (c) it *may* protect accelerator residency — a pure-conv graph lets the Core ML EP / NNAPI run end-to-end on the ANE/TPU while the cheap GFL-integral + grid + NMS decode runs on CPU.
**Honest caveat (review pushback, accepted):** "in-graph decode causes EP partitioning" is a *hypothesis, not a fact* — Core ML supports softmax/gather/reshape/arithmetic, so an in-graph DFL decode might stay on the ANE; meanwhile the raw-output path has its *own* cost (copying 3 head-tensor levels out of the session + an accelerator→CPU sync stall). Both effects are real and only measurable on-device. So: export BOTH a raw-output ONNX (Task 0.4) and an in-graph-decode ONNX (Task 0.4b) in Phase 0, make raw-vs-in-graph an explicit Phase-3 axis, and ensure `Timing.decode_ms` includes the output tensor copy (not just arithmetic) so the round-trip cost is visible. Default C++/raw; switch to in-graph only if device data favors it.

These decisions mean the genuinely-uncertain axes that remain are **execution provider, quantization, and input resolution** — measured on real devices in Phase 3.

---

## Testing tiers (and the SimCam revisit)

| Tier | Runs on | Tests what | Speed | Authoritative for |
|---|---|---|---|---|
| **1. C++ golden** | dev Mac (GoogleTest + `cpp/eval`) | ORT-CPU inference + NanoDet decode vs Python golden outputs; NMS; class→FieldId mapping | seconds | **decode + inference correctness** |
| **2. Simulator / emulator** | iOS Simulator + SimCam · Android emulator | the native ORT path wired into each platform on its **CPU** provider; UI flow | minutes | **integration correctness (CPU EP)** |
| **3. Real devices** | iPad + Pixel (pointed at your DL) | EP performance (ANE/TPU vs CPU), quantization perf+accuracy, end-to-end latency, real-DL field accuracy | manual | **all performance + final accuracy** |

**SimCam / simulator — what changed and what's still blocked:**
- ✅ **Now testable on the iOS simulator (was not before):** the NanoDet inference + decode. It moved off `VNCoreMLRequest` (Apple Vision, simulator-hostile) onto ORT's **CPU execution provider**, which runs fine on the arm64 simulator. SimCam streams a DL image into the simulator camera (Vision Camera 5.x works out of the box per the SimCam setup), so you can exercise the detector path in the running app on the sim.
- ❌ **Still simulator-blocked:** `VNDetectDocumentSegmentationRequest` (iOS doc-seg), VisionKit OCR, `VNDetectFaceRectanglesRequest` — all Apple Vision, all limited on the simulator. So full iOS **OCR-mode end-to-end** on the simulator remains unreliable; SimCam is for the *detector* step + UI, not the whole OCR chain.
- ⚠️ **The simulator cannot measure the thing that matters most:** there is no Neural Engine in the simulator, and ORT's Core ML EP falls back to CPU there. **All EP/ANE performance numbers must come from the real iPad.** Same for Android: the emulator has no Pixel Tensor TPU, so NNAPI/GPU perf must come from the real Pixel.
- **Android emulator** has no SimCam equivalent, but its virtual camera can be fed a static image / host webcam; ORT-CPU inference + bundled DocAligner doc-seg + ML Kit OCR (on a Google-Play system image) all run on the emulator, so Android E2E correctness iteration on the emulator is *more* complete than iOS sim. Perf still real-Pixel-only.

**Bottom line for iteration:** do correctness in Tier 1 (Mac C++ golden — fastest, no device), confirm integration in Tier 2 (sim/emulator), and run Tier 3 (real devices) for every performance decision. You'll have the iPad + Pixel pointed at your DL for Tier 3.

---

## The on-device experiment matrix (Phase 3)

**Primary metric:** median field-detector step latency (preprocess + ORT Run + decode), ms/frame, measured in-app on each real device over ≥100 frames after a thermal warmup.
**Accuracy floor (must not regress):** field-detection mAP@0.5 on the held-out IDNet split must stay ≥ 0.98 (current YOLOv8 baseline is ~0.995 in-distribution), AND the real-DL end-to-end field-populate rate must match or beat the current behavior (README baseline: 13/15 fields on the Wisconsin DL). Latency wins only among configs that clear the floor.
**Also measure (review fix):** **time-to-first-detection** (first `Run` includes Core ML/NNAPI graph compilation — 3–10× sustained; the user cares about scan startup latency, not just sustained p50) reported separately from sustained p50/p95.
**Thermal protocol (pin it):** warm up by discarding the first 30 frames, then measure until p50 is stable within ±5% across 3 consecutive 20-frame windows (min 2 minutes); record whether thermal throttling was observed and re-run throttled samples.
**Pinned ORT config:** `graph_optimization_level = ORT_ENABLE_ALL`, fixed intra-op thread count (record it); verify `EXTENDED` vs `ALL` doesn't change on-device INT8 accuracy.
**Secondary:** binary-size delta (per platform), sustained-throughput/thermal behavior over a 2-minute scan, peak memory.
**mAP@0.5 is necessary but NOT sufficient (review fix):** a model can hit mAP 0.98 yet mis-localize the `license_number` box by a few px, failing the OCR-bbox IoU match and dropping the field. **Task 3.5 (real-DL field-populate on iPad + Pixel) is the AUTHORITATIVE accuracy gate; mAP is only the pre-filter.**

**Axes (measured independently per platform — iOS and Android may legitimately choose different winners, since only the ORT session options differ; the model + decode are shared):**

| Axis | Variants to measure | Prior / hypothesis |
|---|---|---|
| **A. Execution provider (iOS)** | Core ML EP (`MLComputeUnits=CPUAndNeuralEngine`) · Core ML EP (`ALL`) · CPU EP (XNNPACK) | ANE should win big for a conv net; verify op coverage doesn't force heavy fallback |
| **A. Execution provider (Android)** | XNNPACK CPU EP · NNAPI EP · (XNNPACK + GPU if available) | NNAPI is **deprecated in Android-15 NDK headers** (works; removal ≥ A17-18) — ORT's only path to the Pixel Tensor accelerator; measure but weight XNNPACK/GPU for longevity |
| **B. Quantization** | INT8 (QDQ) · FP16 · FP32 | INT8 smallest/fastest on CPU; but Core ML EP / NNAPI INT8 op-support varies — FP16 may win on the accelerator. Measure perf **and** mAP per format. |
| **C. Input resolution** | 640 · 512 · 416 | Strong prior for 640 (DL fine print: license #, address). Smaller is faster but may drop small-field mAP below the floor. This is a **retrain** per resolution. |

Fill in this results table per device during Phase 3 (one table for iPad, one for Pixel):

```
Device: __________   (e.g. iPad Pro M4, iOS 26.x  /  Pixel 6, Android __)
| Res | Quant | EP            | latency p50 (ms) | latency p95 | mAP@0.5 | size Δ (MB) | meets floor? |
|-----|-------|---------------|------------------|-------------|---------|-------------|--------------|
| 640 | INT8  | CoreML(ANE)   |                  |             |         |             |              |
| 640 | FP16  | CoreML(ANE)   |                  |             |         |             |              |
| 640 | INT8  | CPU(XNNPACK)  |                  |             |         |             |              |
| 512 | FP16  | CoreML(ANE)   |                  |             |         |             |              |
| ... |       |               |                  |             |         |             |              |
```

**Decision rule:** per platform, pick the lowest-p50-latency config that clears the accuracy floor and keeps binary-size delta acceptable (target < +8 MB/platform after ORT-minimal build; measure). Record the winner + rationale in `models/version.json` and `docs/MODEL_CARD.md`. The chosen *model* (resolution + quant) should be shared if one config wins on both platforms; if iOS wants FP16-640 and Android wants INT8-640, ship both quantized ONNX variants (same architecture, two quantizations) and select at session-init per platform.

---

## Phase −1 — Feasibility gate (DO THIS FIRST; hard go/no-go before any training)

> A ~1-day throwaway proof-of-concept that de-risks the two assumptions that, if wrong, waste the entire plan. **Do not start Phase 0 until both gates pass.** (The user declined a standalone "spike," but these gates ARE the first tasks of the plan, not a separate effort.)

### Task −1.1: ONNX Runtime size + iOS-SPM feasibility gate
- [ ] Build ORT-**minimal** (reduced-ops, scoped to a NanoDet-class op set: Conv, BN, ReLU/SiLU, Resize, Concat, Sigmoid, Softmax, Reshape, Transpose, Gather/Slice/Add/Mul) for macOS-arm64, iOS-arm64, Android-arm64. Measure the resulting `.xcframework` / `.so` size per platform.
- [ ] Stand up a dummy SPM `.binaryTarget` consuming the ORT xcframework and confirm a trivial RN test lib can `swift build` + resolve it the way a *consumer* would (SPM is this library's PRIMARY iOS path; ORT's first-class packaging is CocoaPods, so this is the real risk).
- [ ] **GATE:** if per-platform binary delta > **12 MB** after minimal build, OR SPM consumption is not cleanly feasible (binary target needs a hosted URL+checksum, not path-only, for published packages) → **switch the runtime to LiteRT** (Apache-2.0; Android keeps its existing TFLite; iOS gets the Core ML delegate for ANE; official xcframework via SPM + CocoaPods). LiteRT is the pre-approved fallback — document the decision either way. Everything downstream of this gate (C++ `FieldDetector`, decode, experiments) is runtime-agnostic except the session-options code, so a LiteRT swap changes only Task 1.4's session wiring.
- [ ] Note ORT thread-safety: `Ort::Session::Run` concurrency requires it; the single cached `FieldDetector` must serialize calls (mutex) or the Nitro module must guarantee serial invocation — decide here, implement in Task 1.4/2.x.

### Task −1.2: Model export feasibility gate (NanoDet vs YOLOX-Nano)
- [ ] In the Phase-0 `nanodet` env, attempt a NanoDet-Plus-m → ONNX export at current PyTorch/opset on a *pretrained COCO* checkpoint (no training yet). Confirm it exports, `onnxsim`-folds, and loads in ORT-Python with sane output shapes.
- [ ] **GATE:** if NanoDet export is broken under current PyTorch (the repo is ~unmaintained since 2022-2023), **switch the model to YOLOX-Nano** (Apache-2.0, more active). This flips the Task 1.3 decode from FCOS/GFL/DFL to YOLOX's decoupled-head decode. Record the choice; it gates Task 0.3 + 1.3.

---

## Phase 0 — NanoDet training + ONNX export (Python, `model-training/`)

> Produces the candidate ONNX models. Output: `models/field_detector_nanodet_{res}_{quant}.onnx` + a golden-fixtures bundle for Tier-1 tests.

### Task 0.1: Add a NanoDet training env

**Files:**
- Create: `model-training/envs/nanodet/pyproject.toml`
- Create: `model-training/envs/nanodet/README.md`

- [ ] **Step 1:** Create an isolated uv project (per memory `project_env_layout` — never share venvs). `pyproject.toml` pins: `nanodet` (from the RangiLyu/nanodet repo, Apache-2.0; install from a pinned git SHA), `torch`, `onnx`, `onnxruntime` (for golden generation), `onnxsim`. Set `YOLO_AUTOINSTALL=False` is N/A here (that was Ultralytics) — but pin every dep explicitly.
- [ ] **Step 2:** `README.md` documents: `cd model-training/envs/nanodet && uv sync`, the dataset path via `$IDNET_DATA_ROOT` (no hardcoded `/Volumes` paths — per the OSS-hygiene fix), and the train/export commands.
- [ ] **Step 3:** Commit.

```bash
git add model-training/envs/nanodet/
git commit -m "feat(training): add isolated NanoDet (Apache-2.0) training env"
```

### Task 0.2: Convert the existing field-bbox dataset to NanoDet (COCO-json) format

**Files:**
- Create: `model-training/nanodet/yolo_to_coco.py`
- Test: `model-training/nanodet/test_yolo_to_coco.py`

- [ ] **Step 1: Write the failing test** — assert the converter maps a known YOLO-txt label (class id + normalized cx,cy,w,h) to the correct COCO bbox (abs x,y,w,h) and preserves all 30 class names in the existing `field_classes` order.

```python
def test_yolo_label_to_coco_bbox():
    # 640x640 image, class 9 (given_name), centered 0.5,0.5 box 0.2x0.1
    coco = convert_label(line="9 0.5 0.5 0.2 0.1", img_w=640, img_h=640)
    assert coco["category_id"] == 9
    assert coco["bbox"] == [256.0, 288.0, 128.0, 64.0]  # x,y,w,h absolute
```

- [ ] **Step 2:** Run `uv run pytest model-training/nanodet/test_yolo_to_coco.py -v` → FAIL (no `convert_label`).
- [ ] **Step 3:** Implement `convert_label` + a directory walker that reads `$IDNET_DATA_ROOT/yolo_fields/{train,val}` and emits `instances_{train,val}.json`. The 30-class category list MUST come from `cpp/yolo/field_classes.hpp` order (single source of truth) — read it / hardcode the same sorted list and assert length 30.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit.

### Task 0.3: NanoDet config + train at 640

**Files:**
- Create: `model-training/nanodet/configs/dlscan_nanodet-plus-m_640.yml`
- Create: `model-training/nanodet/train.sh`

- [ ] **Step 1:** Write a NanoDet-Plus-m config: 30 classes, `input_size: [640,640]`, the converted COCO json paths via `$IDNET_DATA_ROOT`, ShuffleNetV2 backbone, AdamW, schedule matched to the prior run (31 epochs, the prior run hit val saturation by ~epoch 21 — start there). Keep `keep_ratio: true` (letterbox) to match the C++ preprocessing contract.
- [ ] **Step 2:** `train.sh` wraps `uv run python -m nanodet.trainer ... --config configs/dlscan_nanodet-plus-m_640.yml`. Document the M3 Ultra device flag.
- [ ] **Step 3:** Run training. **Verify:** final `val/mAP` ≥ 0.98 (the accuracy floor). If below, this architecture/resolution fails the floor — stop and report before proceeding (do not export a sub-floor model).
- [ ] **Step 4:** Commit the config + a `runs/nanodet_640/` pointer (weights are gitignored per `runs/` rule; record the metric in the commit message).

### Task 0.4: Export raw-output ONNX (640) + simplify

**Files:**
- Create: `model-training/nanodet/export_onnx.py`

- [ ] **Step 1:** Export the trained NanoDet to ONNX with **raw head outputs** (cls + reg-distribution per FPN level; NO post-processing in the graph — per Decision 2). Run `onnxsim` to fold constants. Opset 17. Output `models/field_detector_nanodet_640_fp32.onnx`.
- [ ] **Step 2: Verify** with `onnxruntime` (Python, CPU) on 3 fixed rectified DL fixture images: print output tensor shapes + a few decoded detections. Confirm the model loads and produces plausible per-level tensors.
- [ ] **Step 3:** Record the exact output tensor names, shapes, strides (8/16/32), and reg_max in a doc comment + in `models/version.json` (the C++ decode needs these constants).
- [ ] **Step 4:** Commit `export_onnx.py` (the `.onnx` goes in `models/`, which IS tracked — confirm it's not gitignored).

### Task 0.4b: Export the in-graph-decode ONNX variant (for the Phase-3 raw-vs-in-graph axis)

**Files:** Modify `model-training/nanodet/export_onnx.py` (add a `--decode in-graph` mode)

- [ ] **Step 1:** Export a second ONNX that appends the decode (DFL integral softmax+matmul, grid generation, sigmoid, box assembly) into the graph, emitting final boxes+scores+classes. Output `models/field_detector_nanodet_640_fp32_ingraph.onnx`.
- [ ] **Step 2: Verify** it loads in ORT-Python and produces detections matching the raw-output+Python-decode path on the 3 fixtures (this also cross-checks your decode math).
- [ ] **Step 3:** Commit. (Phase 3 measures whether in-graph beats raw-output+C++-decode on the ANE/TPU; both ONNX files exist from here so no late re-export.)

### Task 0.4c: Pin the preprocessing contract (shared by Python goldens AND C++)

**Files:** Create `model-training/nanodet/preprocess_contract.json`

- [ ] **Step 1:** Write a single spec file recording the EXACT preprocessing: `mean`, `std` (per channel), `resampler` (e.g. bilinear), `pad_color`, `channel_order` (RGB), `letterbox: keep_ratio centered`, `layout: NCHW`. Both `make_golden.py` (Python) and `cpp/detect/preprocess.cpp` (C++, Task 1.2) MUST read/match this file — this prevents the Python-golden vs C++-impl divergence (cv2 border handling ≠ a hand-rolled bilinear). The C++ test asserts its constants equal this file.
- [ ] **Step 2:** Commit before generating goldens.

### Task 0.5: Generate Tier-1 golden fixtures

**Files:**
- Create: `model-training/nanodet/make_golden.py`
- Create: `cpp/tests/fixtures/nanodet_golden/` (committed: 3 preprocessed 640³ input tensors as raw float bin + their expected decoded detections as json)

- [ ] **Step 1:** For 3 fixture DL images **chosen for aspect diversity (review fix): one standard ~3:2 card, one PORTRAIT/taller-than-wide crop, one OFF-CENTER** — so letterbox pad_x-vs-pad_y and asymmetric-inverse bugs (Task 1.3 traps) cannot hide. Preprocess PER `preprocess_contract.json` (Task 0.4c), save `input_{n}.bin` (NCHW float32). Run ORT-Python → save raw outputs `out_{n}_*.bin` AND the decoded+NMS'd detections as `expected_{n}.json`.
- [ ] **Step 2:** These become the C++ golden tests' ground truth — the C++ decode must reproduce `expected_{n}.json` from `out_{n}_*.bin`, and the C++ ORT path must reproduce the raw outputs from `input_{n}.bin`.
- [ ] **Step 3:** Commit the fixtures (small: 3 × ~5 MB tensors — acceptable; or store fp16 to halve).

---

## Phase 1 — ONNX Runtime in C++: integration, inference wrapper, NanoDet decode, golden tests (Mac)

> All of Phase 1 is validated on the **dev Mac** via GoogleTest (Tier 1) — no device needed.

### Task 1.1: Link ONNX Runtime into the C++ test build

**Files:**
- Modify: `cpp/CMakeLists.txt`
- Create: `cpp/third_party/onnxruntime/README.md` (how the ORT lib is vendored/fetched)

- [ ] **Step 1:** Add ORT to the CMake build for the test target: fetch the ORT C/C++ prebuilt (macOS arm64) — either via `FetchContent` from the official ORT release, or a vendored `onnxruntime.xcframework`/dylib + headers under `cpp/third_party/onnxruntime/`. Pin the exact ORT version (record it; ORT is MIT). Link `onnxruntime` into the test executable; expose `<onnxruntime_cxx_api.h>`.
- [ ] **Step 2: Write a smoke test** `cpp/tests/ort_smoke_test.cpp`: create an `Ort::Env`, load `models/field_detector_nanodet_640_fp32.onnx`, assert input/output node counts + the recorded shapes.
- [ ] **Step 3:** Run `yarn test:cpp` → FAIL (ORT not linked / model not found).
- [ ] **Step 4:** Wire CMake until it links; run → PASS.
- [ ] **Step 5:** Commit.

**Risk note for the executor:** ORT's iOS SPM story is the integration risk (Phase 2), NOT here. On the Mac/CMake side ORT links cleanly. Flag binary size early.

### Task 1.2: C++ preprocessing (letterbox 640, normalize, NCHW) — golden-matched

**Files:**
- Create: `cpp/detect/preprocess.{hpp,cpp}`
- Test: `cpp/tests/preprocess_test.cpp`

- [ ] **Step 1: Write the failing test** — feed a known small RGB buffer, assert the output NCHW float tensor matches a hand-computed letterbox+normalize (use the NanoDet mean/std constants from Task 0.5). Assert letterbox padding is centered and aspect-preserving.

```cpp
TEST(Preprocess, LetterboxCentersAndNormalizes) {
  std::vector<uint8_t> rgb = make_solid_rgb(/*w=*/320, /*h=*/640, /*r=*/128,128,128);
  auto t = dlscan::detect::preprocess(rgb.data(), 320, 640, /*target=*/640);
  EXPECT_EQ(t.width, 640); EXPECT_EQ(t.height, 640);
  // 320x640 letterboxed into 640x640 → scale 1.0 on height, pad 160px L/R
  EXPECT_NEAR(t.pad_x, 160.0f, 0.5f);
  EXPECT_NEAR(t.data[/*center pixel, channel 0*/ idx], (128/255.0f - MEAN0)/STD0, 1e-4);
}
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `preprocess(const uint8_t* rgb, int w, int h, int target) -> InputTensor{ data (NCHW float), width, height, pad_x, pad_y, scale }`. Keep `pad_x/pad_y/scale` — the decode needs them to map boxes back to original coords. Bilinear resize (hand-rolled or stb_image_resize2 vendored). RGB order + mean/std per the NanoDet config.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 1.3: NanoDet decode (GFL integral + grid + per-class NMS)

**Files:**
- Create: `cpp/detect/nanodet_decode.{hpp,cpp}`
- Test: `cpp/tests/nanodet_decode_test.cpp`

- [ ] **Step 1: Write the failing golden test** — load `out_0_*.bin` (raw NanoDet outputs from Task 0.5), run `decode`, assert it reproduces `expected_0.json` detections (class_id exact; coords within 1px; conf within 1e-3). Repeat for fixtures 1 and 2.

```cpp
TEST(NanoDetDecode, MatchesPythonGolden_Fixture0) {
  auto raw = load_raw_outputs("fixtures/nanodet_golden/out_0");      // per-level cls+reg
  auto expected = load_expected("fixtures/nanodet_golden/expected_0.json");
  auto got = dlscan::detect::nanodet_decode(raw, kStrides /*8,16,32*/, kRegMax, NmsConfig{});
  ASSERT_EQ(got.size(), expected.size());
  for (size_t i=0;i<got.size();++i){ EXPECT_EQ(got[i].class_id, expected[i].class_id);
    EXPECT_NEAR(got[i].x1, expected[i].x1, 1.0f); /* … */ }
}
```

- [ ] **Step 2:** Run → FAIL (no `nanodet_decode`).
- [ ] **Step 3:** Implement the FCOS-style decode: for each FPN level (strides 8/16/32), for each grid cell, compute class score (sigmoid of GFL logits), and box via DFL integral (softmax over `reg_max+1` bins per side, expectation × stride), produce ltrb→xyxy in input-image space, then reuse `dlscan::yolo::iou` for per-class greedy NMS (factor the NMS out of the old `decode_and_nms` into a shared `nms()` so both decoders share it). Return `Detection[]` (same struct as today — downstream IoU-match is unchanged).

  **Decode correctness traps — implement against these explicitly (each a silent wrong-box bug; review-sourced):**
  - **reg_max off-by-one:** DFL uses `reg_max + 1` distribution bins, not `reg_max`. Wrong count biases every edge by a half-stride. Add a test with a box far from the cell center.
  - **grid-cell center offset:** anchor point at stride `s`, cell `(i,j)` is `(j*s + s/2, i*s + s/2)` — the `+ s/2` matters (4px at stride 8 on 640²; visible on license-number digits). Omitting it shifts every box top-left.
  - **sigmoid vs softmax placement:** classification scores are **sigmoid** (multi-label); DFL box bins are **softmax** (per edge). Don't softmax the class scores.
  - **letterbox inverse on ltrb→xyxy→original:** apply pad_x/pad_y + scale symmetrically to all four coords; an asymmetric subtraction makes boxes drift with aspect ratio. Include ≥1 off-center and ≥1 portrait-aspect fixture (Task 0.5) so this can't hide.
  - **FPN stride ordering:** confirm the export emits stride-8,16,32 (finest→coarsest). If the export reverses it and the decode hardcodes the order, every box is off by 4×/8× — silently. **Add a shape-validation assertion as the first line of `nanodet_decode`:** each level tensor's grid dims must equal `input/stride` for the assumed stride; fail loudly otherwise.
- [ ] **Step 4:** Run the 3 golden tests → PASS.
- [ ] **Step 5:** Commit.

### Task 1.4: FieldDetector — the unified C++ inference entry point

**Files:**
- Create: `cpp/detect/field_detector.{hpp,cpp}`
- Test: `cpp/tests/field_detector_test.cpp`

- [ ] **Step 1: Write the failing end-to-end golden test** — construct `FieldDetector` from `models/field_detector_nanodet_640_fp32.onnx`, feed fixture-0's *original* RGB image, assert the returned detections match `expected_0.json` (this exercises preprocess → ORT Run → decode as one unit, all on CPU EP).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:

```cpp
namespace dlscan::detect {
struct FieldDetectorOptions {
  enum class Provider { Cpu, CoreML, Nnapi };   // set per platform in Phase 2/3
  Provider provider = Provider::Cpu;
  int      input_size = 640;
  // CoreML compute-units knob etc. surfaced for the Phase-3 experiments.
};
class FieldDetector {
 public:
  FieldDetector(const void* onnx_bytes, size_t len, const FieldDetectorOptions&);
  // image: tightly-packed RGB8, w×h. Returns detections in ORIGINAL-image px
  // (decode un-letterboxes using pad/scale from preprocess).
  std::vector<yolo::Detection> run(const uint8_t* rgb, int w, int h);
  // exposed for the Phase-3 latency harness:
  struct Timing { double preprocess_ms, infer_ms, decode_ms; };
  Timing last_timing() const;
 private:
  Ort::Env env_; Ort::Session session_; FieldDetectorOptions opts_;
};
}
```

Construct the `Ort::SessionOptions` from `opts_.provider` (CPU/XNNPACK by default; CoreML/NNAPI appended in Phase 2/3). Load model from memory bytes (so the platform can hand over the bundled asset). Time each stage into `Timing`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 1.5: Wire `FieldDetector` into `cpp/eval` for batch mAP

**Files:**
- Modify: `cpp/eval/parser_eval.cpp` (or add `cpp/eval/detector_eval.cpp`)

- [ ] **Step 1:** Add an eval entry that runs `FieldDetector` over the held-out IDNet split (`$IDNET_DATA_ROOT`, no hardcoded paths) and computes mAP@0.5 + per-class AP. This is the Mac-side accuracy gate used to confirm a given ONNX/quant meets the 0.98 floor before any device work.
- [ ] **Step 2: Verify** the FP32-640 model reports mAP@0.5 ≥ 0.98 here (should match Task 0.3's training metric closely).
- [ ] **Step 3:** Commit.

---

## Phase 2 — Platform wiring: hand C++ the rectified image; remove the per-platform detector runtimes

> After this phase, the app on both platforms runs the field detector through the C++ `FieldDetector`. Validated in Tier 2 (sim/emulator, CPU EP).

> **⚠ Execution order (review fix):** do **Task 2.2 + 2.3 (link ORT into the app builds) BEFORE Task 2.1 (wire the Swift/Kotlin call sites)** — you cannot compile Swift/Kotlin that calls `FieldDetector` until ORT links. The tasks are numbered by topic, not order; follow 2.2 → 2.3 → 2.1 → 2.4.
>
> **Three things Task 2.1 must get right (review-sourced), beyond the bullets below:**
> 1. **ONNX bytes loading:** iOS retrieves the bundled model via `Bundle.module` (SPM) — NOT `Bundle.main`; the resource must be declared on the SPM target and the bytes read and handed to the C++ `const void*` ctor. Android opens it via `context.assets.open("…​.onnx")` → byte[]. Write this loading code explicitly; `Bundle.module` vs `Bundle.main` is a known SPM footgun.
> 2. **Session warm-up:** Core ML EP / NNAPI compile the graph on first `Run` (200–500 ms). The deleted `ensureYoloRequest` solved exactly this for VNCoreMLRequest. Decide and implement: **eager-init the `FieldDetector` (and run one dummy inference) during module construction**, so the user's first real scan frame doesn't eat the compile stall. Measure "time-to-first-detection" separately from sustained p50 (see Phase 3).
> 3. **Concurrency:** the single cached `FieldDetector` must serialize `run()` (mutex) unless the Nitro hybrid guarantees serial calls — `Ort::Session::Run` is only concurrency-safe under specific session options. Decided in Task −1.1; enforce here.

### Task 2.1: Expose `FieldDetector` to Swift and Kotlin

**Files:**
- Modify: `cpp/detect/field_detector.hpp` (ensure a C-ABI or Swift-C++-interop-friendly surface; Android uses it via the existing JNI bridge `android/src/main/cpp/`)
- Modify: `ios/HybridDLScanIOS.swift`, `android/.../HybridDLScanAndroid.kt`

- [ ] **Step 1:** iOS (Swift↔C++ interop): from `recognizeLicenseFields`, after doc-seg rectification, get the rectified image as a tightly-packed RGB buffer (convert the `CVPixelBuffer`/`CGImage` → RGB8 once) and call `FieldDetector::run`. Delete `runYOLO`, `ensureYoloRequest`, `cachedYoloRequest`, and the `VNCoreMLRequest` field-detector code. Construct one `FieldDetector` lazily (cache it) with the bundled ONNX bytes.
- [ ] **Step 2:** Android (JNI): from `recognizeLicenseFields`, pass the rectified `Bitmap`'s RGB bytes to a new JNI method that calls `FieldDetector::run`. Delete the TFLite `Interpreter` field-detector lifecycle (`tfliteInterpreter`, `runYolo`, the ByteBuffer quantization). **Also** replace the DocAligner TFLite `Interpreter` with the ORT C++ `DocAligner` (Task 1.6) — DocAligner is folded into the unified runtime per the do-it-right scope; see the DocAligner section. (iOS doc-seg Apple-Vision-vs-DocAligner is the Phase-3 sub-decision.)
- [ ] **Step 3: Verify (Tier 1 still green):** `yarn test:cpp` passes; `yarn typecheck`/`yarn lint` pass.
- [ ] **Step 4:** Commit per platform.

### Task 2.2: Link ORT into the iOS app build (SPM + CocoaPods)

**Files:**
- Modify: `DLScan.podspec`, `Package.swift`

- [ ] **Step 1:** Add ORT as an iOS dependency. **Primary (SPM):** add an `onnxruntime` binary target — if ORT lacks a clean SPM package at the pinned version, vendor `onnxruntime.xcframework` as a `.binaryTarget(path:)`. **CocoaPods:** add `s.dependency 'onnxruntime-c'` (pin version) to the podspec. Confirm the bundled `.onnx` is listed as a resource in BOTH `Package.swift` (`.copy`) and the podspec `resource_bundles` (mirror how `.mlmodelc` was wired — then remove the `.mlmodelc` resource in Phase 4).
- [ ] **Step 2: Verify** `pod lib lint DLScan.podspec --quick --allow-warnings` and `swift build` succeed (this is what CI's iOS job runs).
- [ ] **Step 3:** Measure the iOS framework binary-size delta from adding ORT; record it. If > ~8 MB, switch to an ORT-minimal/reduced-ops build (custom ORT build including only the ops the NanoDet model uses — ORT's `--include_ops_by_config` from the model).
- [ ] **Step 4:** Commit.

### Task 2.3: Link ORT into the Android app build (CMake)

**Files:**
- Modify: `android/CMakeLists.txt`, `android/build.gradle`

- [ ] **Step 1:** Add the ORT Android prebuilt (C/C++ `.so` + headers, or the `onnxruntime-android` AAR's native libs) to the NDK build; link into the existing JNI target. Pin the version (match iOS). Bundle the `.onnx` in `android/src/main/assets/` (alongside DocAligner).
- [ ] **Step 2: Verify** the Android CI script-validation job still passes; do a local `assembleDebug` on the example (JDK 21 per CLAUDE.md) to confirm it links.
- [ ] **Step 3:** Measure the Android `.so` size delta; ORT-minimal if needed.
- [ ] **Step 4:** Commit.

### Task 2.4: Tier-2 integration check (sim + emulator, CPU EP)

- [ ] **Step 1: iOS Simulator + SimCam:** boot the sim, `simcamctl set-source --back --image <DL fixture>` (per the SimCam recipe: 3:4 portrait canvas, DL ~50% width), launch the example, switch to OCR mode, confirm via `agent-device` snapshot + logs that `FieldDetector::run` returns detections (the inference path now runs on the sim). Note: doc-seg/OCR may be empty on the sim — you're verifying the *detector* fires, not full E2E.
- [ ] **Step 2: Android emulator** (Google Play system image): feed the virtual camera the DL fixture, confirm OCR mode produces detections + (since ML Kit + DocAligner work on the emulator) a populated `LicenseDataSpec`.
- [ ] **Step 3:** No code change expected; if the detector returns empty where the golden test passed, debug the platform→C++ buffer hand-off (channel order, stride, row-padding) — the most likely bug surface.
- [ ] **Step 4:** Commit any fixes.

---

## Phase 3 — On-device performance experiments (real iPad + Pixel)

> The only phase that requires real hardware. Fill the results tables; pick winners. You'll have the iPad + Pixel pointed at your DL.

### Task 3.1: Build the in-app benchmark harness

**Files:**
- Modify: `example/` (add a hidden "Detector Bench" screen reachable from the DebugDrawer) + a Nitro method `benchmarkDetector(provider, n)` that runs `FieldDetector::run` N times on the current frame and returns `Timing` percentiles.

- [ ] **Step 1:** Add a Nitro method that takes a provider/quant/res selector + iteration count, runs the detector on a held frame, and returns p50/p95 of `last_timing()` (preprocess/infer/decode split) + total. Surface a results screen in the example.
- [ ] **Step 2:** Verify it runs on both devices and prints stable numbers after warmup.
- [ ] **Step 3:** Commit.

### Task 3.2: Export the quantization + resolution variants

- [ ] **Step 1:** From Phase 0's trained checkpoints, export the variant matrix: {640, 512, 416} × {INT8(QDQ), FP16}. (Resolutions 512/416 require their own retrains — Task 0.3 repeated per resolution; gate each on the mAP floor in `cpp/eval` before shipping it to a device.) Produce `models/field_detector_nanodet_{res}_{quant}.onnx` for each that clears the floor.
- [ ] **Step 2:** Record each variant's mAP in the results table. **For FP32/FP16, Mac-side ORT-CPU mAP is representative (float is numerically close across EPs) — measure once on the Mac.** **For INT8 this is NOT EP-independent (review fix):** the Core ML EP may re-quantize on its own precision schedule, and NNAPI has known per-channel-depthwise INT8 accuracy regressions (ShuffleNetV2 uses depthwise heavily) — so an INT8 variant only clears the accuracy floor when its mAP is measured **on-device with the shipping EP**, not just on the Mac. Use the Mac ORT-CPU INT8 mAP only as a cheap pre-filter to reject obviously-bad configs early.
- [ ] **Step 3:** Commit the variant ONNX files (or, if size is a concern, keep only the eventual winners — log which were dropped).

### Task 3.3: Run the iPad EP × quant × resolution sweep

- [ ] **Step 1:** For each variant, run the bench harness on the iPad with each iOS provider (CoreML-ANE, CoreML-ALL, CPU-XNNPACK). Record p50/p95 into the iPad results table.
- [ ] **Step 2:** Note any provider where Core ML EP heavily partitions the graph (large decode/infer split anomaly or perf worse than CPU) — that's the EP-fallback signal that would justify trying the in-graph-decode contingency (Decision 2). Only pursue the contingency if the data demands it.
- [ ] **Step 3:** Pick the iPad winner per the decision rule. Record rationale.

### Task 3.4: Run the Pixel EP × quant × resolution sweep

- [ ] **Step 1:** Same harness on the Pixel with each Android provider: **XNNPACK-CPU**, **NNAPI** (ORT's *only* path to the Pixel Tensor accelerator — no dedicated Tensor EP exists), and the **ORT OpenCL GPU EP** if wired (`libonnxruntime_providers_opencl.so` + `AppendExecutionProvider_OpenCL`; 2–5× over CPU on conv nets). Record into the Pixel table.
- [ ] **Step 1b (decision rule, review fix):** NNAPI is deprecated in Android-15 NDK headers but still works (removal ≥ A17-18). **Prefer XNNPACK/GPU unless NNAPI is faster by BOTH > ~20% AND > 5 ms absolute.** Record the longevity tradeoff in the ADR.
- [ ] **Step 2:** Pick the Pixel winner. Record rationale.

### Task 3.5: Real-DL accuracy confirmation on both devices

- [ ] **Step 1:** With the winning config on each device, run the *full OCR mode* against your real DL (iPad + Pixel pointed at the front). Confirm the end-to-end field-populate rate meets/beats the README baseline (13/15 on the WI DL) and that the headshot/card-image crops still land (the detector's `face` class + bbox feed those).
- [ ] **Step 2:** If a config that won on latency drops a field that the YOLOv8 baseline got, it fails the accuracy floor — fall back to the next-best config. Record the final per-platform choice.

---

## Phase 4 — Finalize: lock winners, remove AGPL + dead runtimes, update docs/metadata, re-verify

### Task 4.1: Lock the chosen model(s) + remove the variant clutter

- [ ] **Step 1:** Keep only the winning ONNX variant(s) under `models/` (one if a single config won both platforms; two quantizations if they differ). Name them clearly. Delete the losers.
- [ ] **Step 2:** Rewrite `models/version.json`: NanoDet architecture, Apache-2.0, the chosen resolution/quant per platform, the real mAP numbers, ORT version, export date, training data = IDNet ($IDNET_DATA_ROOT, no machine path), and **no `/Volumes` path and no AGPL/Ultralytics string** (the new export is clean by construction — verify with `strings`).
- [ ] **Step 3:** Commit.

### Task 4.2: Delete the AGPL YOLOv8 artifacts and dead code

**Files:**
- Delete: `ios/Resources/DLScanFieldDetector.mlmodelc`, `models/DLScanFieldDetector.mlmodelc`, `models/DLScanFieldDetector.mlpackage`, `android/src/main/assets/dl_scan_field_detector.tflite`
- Delete: `cpp/yolo/yolo_postprocess.{hpp,cpp}` (the YOLOv8 `decode_and_nms`) IF no longer referenced — keep `iou`/`nms` by having moved them to a shared header in Task 1.3. Update `cpp/yolo/yolo_postprocess_test.cpp` accordingly (or delete + rely on `nanodet_decode_test`).
- Modify: `DLScan.podspec`, `Package.swift`, `android` assets globs — drop the old model resources.

- [ ] **Step 1:** Delete the files above. `git grep -i 'mlmodelc\|DLScanFieldDetector\|dl_scan_field_detector.tflite\|decode_and_nms'` → confirm zero live references remain (docs get updated in 4.3).
- [ ] **Step 2: Verify** `yarn test:cpp`, `yarn typecheck`, `yarn lint`, `pod lib lint`, `swift build`, and a local Android `assembleDebug` all pass with the YOLOv8 artifacts gone.
- [ ] **Step 3:** Confirm the AGPL blockers are resolved — **definitive check (review fix): pack and grep the tarball**, not just `strings`: `npm pack && mkdir -p /tmp/pkg && tar xf *.tgz -C /tmp/pkg && grep -rni 'agpl\|ultralytics\|/Volumes\|/Users/' /tmp/pkg` → must return nothing.
- [ ] **Step 4:** Commit.

### Task 4.3: Update all docs to the NanoDet/ORT reality

**Files:**
- Modify: `docs/MODEL_CARD.md` (field detector = NanoDet Apache-2.0, ORT runtime, the **now-true** weights-license line — this resolves the one line Phase-1 OSS-remediation left for the human), `README.md` (Bundled Models table, model sizes, Features bullet about field detection, the "single C++ core now includes inference" architecture note), `docs/THIRD_PARTY_MODELS.md` (add NanoDet attribution: RangiLyu/nanodet, Apache-2.0; keep DocAligner), `docs/ARCHITECTURE_DECISIONS.md` (new ADR: "unify field-detector inference into C++ via ONNX Runtime; replace AGPL YOLOv8 with Apache NanoDet"), `CHANGELOG.md`.

- [ ] **Step 1:** Make the edits. The MODEL_CARD weights-license line can finally state Apache-2.0 truthfully (NanoDet) — no more deferred-to-human caveat.
- [ ] **Step 2:** Add an ADR documenting the decision + the Phase-3 experiment results table (winners + rationale) so the perf choices are recorded for contributors.
- [ ] **Step 3:** Commit.

### Task 4.4: Full verification + tarball re-audit

- [ ] **Step 1:** Run the whole gate: `yarn typecheck && yarn lint && yarn test && yarn test:cpp`, `pod lib lint`, `swift build`, Android `assembleDebug`.
- [ ] **Step 2:** `npm pack --dry-run` → confirm the ONNX model(s) ship, ORT is linked (not bundled as a stray file), no AGPL artifacts, no `/Volumes` paths, size delta acceptable.
- [ ] **Step 3:** Re-run the OSS-readiness checks for the model dimension (the two AGPL blockers + the leaked-path blocker should now be fully closed).
- [ ] **Step 4:** Commit; this branch is now ready for the broader pre-publish finalization.

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| ORT iOS **SPM** integration is rough (ORT's first-class packaging is CocoaPods) | Med | Vendor `onnxruntime.xcframework` as an SPM `.binaryTarget`; CocoaPods path as the proven fallback. De-risk in Task 2.2 early. |
| ORT **binary size** too large for a library | Med | ORT-minimal (`--include_ops_by_config`). **Hard gate in Task −1.1 BEFORE training: if > 12 MB/platform, switch to LiteRT** (pre-approved fallback). Don't discover a 35 MB iOS binary after 3 weeks. |
| Core ML EP / NNAPI **partition** the graph → ANE/TPU underutilized | Med | Decision 2 (C++ decode keeps the graph pure-conv). If profiling still shows fallback, try the in-graph-decode contingency export. |
| NanoDet at 640 **doesn't clear the mAP floor** | Low | The task saturates YOLOv8n at 0.995; large headroom. If it fails, try NanoDet-Plus-m-1.5x (slightly larger) before abandoning. Gate is explicit in Task 0.3. |
| NNAPI **deprecation** (Android-15 NDK headers; removal ≥ A17-18) | Known | Short-term OK; prefer XNNPACK/GPU unless NNAPI > 20% AND > 5 ms faster. ORT reaches Pixel Tensor only via NNAPI. |
| **NanoDet repo unmaintained** (~2022-23); ONNX export may break on current PyTorch | Med | Task −1.2 gate: test-export a pretrained checkpoint FIRST; switch to YOLOX-Nano if broken. |
| ORT **warm-up** stall (Core ML/NNAPI compile 200-500 ms first Run) | Med | Eager-init + dummy inference at module construction (Task 2.1); measure time-to-first-detection. |
| ORT **session concurrency** (`Run` not always thread-safe) | Low-Med | Mutex around the cached `FieldDetector` or serial Nitro calls (Task −1.1). |
| Platform→C++ **buffer hand-off** bug (channel order/stride) silently empties detections | Med | Golden tests pass on Mac; Task 2.4 explicitly debugs the hand-off as the prime suspect if sim/emulator detections are empty. |
| Real-DL accuracy regresses vs YOLOv8 despite mAP parity | Low-Med | Task 3.5 is an explicit real-DL gate; fall back to next-best config; resolution 640 prior protects small fields. |

## Self-review

- **Spec coverage:** EP/quant/resolution → Phase 3 experiments ✓. Preprocessing-location & decode-location → decided up-front with rationale (✓ the user allowed "just go that route" when objectively known). SimCam/sim + emulator → testing-tiers section + Task 2.4 ✓. NanoDet→ONNX→ORT unified in C++ → Phases 0-2 ✓. AGPL removal → Phase 4 ✓. Real iPad+Pixel → Phase 3 ✓.
- **Placeholder scan:** experiment *values* (latency numbers) are intentionally blank tables to be filled on-device — that's data collection, not a plan placeholder; every code/decode task has concrete signatures + golden-test structure. NanoDet mean/std and tensor shapes are explicitly deferred to Task 0.4/0.5 *recording* steps because they're emitted by the actual export — the plan names exactly where they get pinned.
- **Type consistency:** `Detection` struct reused from `cpp/yolo`; `FieldDetector`/`FieldDetectorOptions`/`Timing` defined once in Task 1.4 and referenced consistently in Phase 2/3. `nms()`/`iou()` factored to shared header in Task 1.3 and reused.

## Open question for the user before execution

- **Worktree:** this is a large, multi-phase change — implement on a dedicated branch/worktree (e.g. `claude/nanodet-ort`) off the current `main`? (Recommended, per `using-git-worktrees`.)
- **DocAligner:** ✅ IN SCOPE (user decided 2026-05-30, "do it right") — folded into the unified ORT runtime; see the DocAligner section. The only residual is the Phase-3 iOS sub-decision (keep Apple Vision doc-seg vs. unify onto bundled DocAligner), settled by measurement.
