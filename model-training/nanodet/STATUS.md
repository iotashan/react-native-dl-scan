# Rewrite execution status (live) — updated 2026-05-30 ~12:22

## DONE
- Phase -1.2: NanoDet export gate PASSED. NanoDet-Plus-m, torch 2.2.2/py3.11. (GATE_RESULT.md)
  - Corrected facts: 4 strides (8/16/32/64), reg_max=7, output [1,A,62], 4.23M params.
- Phase -1.1: runtime gate -> **LiteRT** (not ORT). ORT 42.9MB iOS / 27MB Android > 12MB gate; LiteRT smaller + incumbent on Android. (GATE_RESULT_runtime.md)
- Dataset: yolo_fields -> COCO (95,490 train / 12,055 val). instances_{train,val}.json under yolo_fields/coco/.
- Config: dlscan-nanodet-plus-m_416.yml (30 cls, no flip aug). 640 variant also exists.
- NanoDet torch-2 patches applied + recorded (PATCHES.md): torch._six shim; DFL Integral matmul->multiply-sum (MPS fix).
- preprocess_contract.json: BGR, mean [103.53,116.28,123.675], std [57.375,57.12,58.395], 416 input.

## RESOLUTION DECISION (corrects the plan's 640)
Detector LOCALIZES field regions; OCR (Vision/MLKit) reads text at full res separately.
=> 416 (NanoDet-native) is sufficient for localization + 2.4x faster to train. Training at 416.

## TRAINING (long pole, running in background)
- PID 68601: CPU-multicore (MPS is fallback-crippled single-core; CPU hit ~1286%/13 cores).
  config 416, full 95K, 30 epochs, bs48, val every 3. Log: /tmp/nanodet-416cpu.log
- Checkpoints -> workspace/dlscan-nanodet-416/. Early-stop when val mAP@0.5 clears 0.98 floor (task saturates).

## DECODE REFERENCE (for Phase 1 C++)
nanodet_plus_head.py get_bboxes (line 464): dis = Integral(reg) * stride; bbox = distance2bbox(center, dis).
distance2bbox: x1=cx-d_l, y1=cy-d_t, x2=cx+d_r, y2=cy+d_b. cls = sigmoid. then per-class NMS.

## NEXT (Phase 1, weights-independent, do in parallel w/ training)
1. Golden-gen: probe model -> raw [1,A,62] + NanoDet get_bboxes detections (Python). 
2. cpp/detect/nanodet_decode.{hpp,cpp} reproducing it (4 strides, reg_max=7). GoogleTest goldens.
3. LiteRT C++ integration (FieldDetector) + DocAligner. Then platform wiring, then on-device (iPad/Pixel).


## ~~TRAINING-HARDWARE WALL~~ — CORRECTED 2026-05-30 ~22:25: MPS WORKS, training on this M3 Ultra
The earlier "needs cloud GPU / 17 days / INFEASIBLE" note was a MISDIAGNOSIS. What
actually happened: I saw MPS pegging a single CPU core and assumed CPU-fallback,
then benchmarked the pure-CPU path (`--cpu`, ~25 s/iter) instead of MPS. In reality:
- MPS handles every op — a `PYTORCH_ENABLE_MPS_FALLBACK=0` smoke run COMPLETED with
  no unsupported-op crash. The single busy CPU core is just MPS's normal
  Python-thread-driving-the-GPU; the GPU does the compute.
- Smoke (bs8, 416): Iter0->Iter20 = 32s ≈ 1.6 s/iter. Full run (bs48): ~several s/iter.
  => ~5 h/epoch. With val_intervals now 1 + the val-mAP early-stop (this 30-class
  fine-tune from pretrained converges in a few epochs), real weights are ~a day of
  background training ON THIS M3 Ultra (256 GB RAM, 28 cores).
- Config tuned for this box: workers_per_gpu 8->20, val_intervals 3->1.

TRAINING IS RUNNING: `train_nanodet.py dlscan-nanodet-plus-m_416.yml` on MPS, log
/tmp/nanodet-train.log, checkpoints -> workspace/dlscan-nanodet-416/model_best/.
Early-stop when val mAP@0.5 clears the floor. Then export best.pth -> ONNX -> TFLite
(confirm NHWC input + anchor-major [1,3598,62] output) -> the JS-orchestrated field
detector (react-native-fast-tflite) has real weights to run.

## PHASE 1 COMPLETE — shared C++ inference core (2026-05-30, weights-independent)
The ENTIRE runtime-agnostic C++ core for both models is implemented + host-verified (274/274 ctest):
- cpp/detect/nanodet_decode.{hpp,cpp}  — center priors + DFL integral + per-class NMS (planted goldens)
- cpp/detect/preprocess.{hpp,cpp}      — preprocess() NanoDet (NCHW BGR ImageNet-mean/std, 416, half-pixel bilinear) + preprocess_docaligner() (NHWC RGB/255, 256). Hand-computed goldens.
- cpp/detect/model_interpreter.hpp     — generic ModelInterpreter seam (float in -> float out), shared by both orchestrators. LiteRT/CoreML-delegate/XNNPACK/NNAPI are all just different ModelInterpreters.
- cpp/detect/field_detector.{hpp,cpp}  — FieldDetector: preprocess -> invoke -> nanodet_decode -> source-space coord map. Fake-interpreter goldens at 1x/2x.
- cpp/detect/doc_aligner.{hpp,cpp}     — decode_corners (argmax + soft-argmax sub-pixel) + DocAligner orchestrator. Planted goldens + REAL-MODEL goldens (cpp/tests/fixtures/docaligner_golden, generated from docaligner_lcnet100.tflite on IDNet cards).
- DocAligner I/O contract recovered empirically (model-training/docaligner/CONTRACT.md): 256x256x3 RGB/255 NHWC in, 128x128x4 NHWC out, channel order TL,TR,BR,BL.

## WHAT REMAINS — all gated on external resources (NOT artificially stuck)
1. TRAINED NANODET WEIGHTS — IN PROGRESS on this M3 Ultra via MPS (~5h/epoch; see the corrected note above). NOT a cloud-GPU blocker.
2. LiteRtInterpreter (concrete backend) — needs LiteRT lib+headers. Checked: ai-edge-litert wheel has NO clean C-API headers; macOS link = 30-min bazel build (skipped). It links cleanly in the iOS pod (TensorFlowLiteC xcframework) + Android AAR/NDK. => Phase 2 artifact, written+smoke-tested there. Partly blocked on (1) for the field detector (DocAligner half could be wired now since its real model exists).
3. Platform wiring (Phase 2): podspec/gradle pull LiteRT; C-ABI bridge (voter_c.cpp pattern) for FieldDetector/DocAligner; Swift/Kotlin call sites; delete VNCoreMLRequest/old-TFLite field path. Needs the iOS/Android build toolchains + validated by building example app.
4. On-device perf tuning (Phase 3): EP x quant x resolution sweep on physical iPad+Pixel = the "accuracy over speed" exploration. Needs the devices + (1).
5. Cleanup (Phase 4): delete AGPL YOLOv8 artifacts — PREMATURE until the replacement runs.