# Training Details

This document provides the full hardware specification, software stack,
hyperparameters, random seeds, and known reproducibility caveats for the
two trained ML models in `react-native-dl-scan`. It is intended to satisfy
the NeurIPS reproducibility checklist and ML Commons reproducibility standards.

**Note on the doc detector:** A YOLOv8n-OBB document detector was originally
planned as a third trained model. Training was abandoned after the MPS smoke
test (2-epoch MPS-vs-CPU comparison on 10K images) produced a KL divergence
of >0.10 on the predicted angle distribution — the threshold for the
documented MPS-OBB silent-correctness bug (Ultralytics issues
[#10181](https://github.com/ultralytics/ultralytics/issues/10181) and
[#13081](https://github.com/ultralytics/ultralytics/issues/13081)). Document
segmentation at runtime is instead handled by
`VNDetectDocumentSegmentationRequest` (iOS) and the bundled DocAligner
`lcnet100` TFLite model (Android). See
[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) for the full decision
record.

For the one-command retrain walkthrough see [REPRODUCIBILITY.md](REPRODUCIBILITY.md).
For dataset provenance see [DATA_CARD.md](DATA_CARD.md).

---

## Hardware

| Property | Value |
|---|---|
| Machine | Apple Mac Studio (2025) |
| Chip | Apple M3 Ultra |
| CPU | 32-core (16 performance + 16 efficiency) |
| GPU | Up to 80-core Apple GPU |
| Neural Engine | 32-core Apple Neural Engine |
| Unified memory | 256 GB @ 819 GB/s memory bandwidth |
| Peak GPU FP16 throughput | ~28 TFLOPS |
| Operating system | macOS 26.4 (Tahoe) |
| Storage | 4 TB external NVMe (IDNet data + checkpoints) |

Training is **single-node only**. There is no cloud fallback and no distributed
training configuration. All GPU operations run through PyTorch's MPS
(Metal Performance Shaders) backend.

---

## Software Stack

| Component | Version | Notes |
|---|---|---|
| Python | 3.11 (RangiLyu/nanodet env) | NanoDet torch-2 patches validated on 3.11 |
| PyTorch | 2.2.2 (MPS backend) | NanoDet training; AMP FP16 only — BF16 not supported on MPS |
| RangiLyu/nanodet | Apache-2.0 fork | NanoDet-Plus training framework (replaces Ultralytics/YOLOv8) |
| litert-torch | (ai-edge-torch successor) | PyTorch → LiteRT/TFLite export of the field detector |
| numpy | ≥1.26.0, <2.0 | Upper bound for compatibility |
| Pillow | ≥10.0.0 | Image loading |
| OpenCV | ≥4.10.0 (headless) | Document rectification |
| PyYAML | ≥6.0.0 | NanoDet config / COCO conversion |
| scikit-learn | ≥1.4.0 | Stratified splitting, evaluation metrics |

Full pinned dependency list: [`model-training/requirements.txt`](../model-training/requirements.txt).

### Verified working combination (training machine)

The NanoDet field detector is trained in a dedicated env under
`model-training/envs/nanodet/` (the [RangiLyu/nanodet](https://github.com/RangiLyu/nanodet)
checkout + torch 2.2.2, with the torch-2 patches recorded in
`model-training/nanodet/PATCHES.md`: a `torch._six` shim and a DFL `Integral`
matmul→multiply-sum rewrite for the MPS path). Export to LiteRT/TFLite runs in
a **separate, fresh** env with `litert-torch` (see
`model-training/nanodet/export_tflite/export_internal.py`) — kept isolated from
the training env because litert-torch pulls a different torch/tensorflow stack.

The legacy per-stage uv-locked envs under `model-training/envs/` (`train`,
`export-ios`, `export-android`) remain as scaffolding for the OBB doc-detector
and the retired YOLOv8n field detector, but the shipped field detector is
trained and exported with the NanoDet + litert-torch envs above.

---

## Model 1: DLScanFieldDetector (NanoDet-Plus-m)

### Architecture

- Base: NanoDet-Plus-m — ShuffleNetV2 1.0x backbone + GhostPAN neck (out
  channels 96) + NanoDetPlusHead (GFL/DFL, `reg_max=7`), strides 8/16/32/64,
  ~4.2M params. Config: `model-training/nanodet/configs/dlscan-nanodet-plus-m_416.yml`.
- Task: Per-field axis-aligned bounding box detection on rectified 416×416
  document crops (30 classes).
- Input: 416×416 NHWC RGB8; preprocess applies BGR ImageNet mean/std
  (mean `[103.53, 116.28, 123.675]`, std `[57.375, 57.12, 58.395]`).
- Output: single anchor-major tensor `[1, 3598, 62]` — per anchor, 30 sigmoid
  class scores (sigmoid baked in at export) + 4×8 DFL logits. The shared C++
  decode does center-prior + DFL integral + per-class NMS.

### Hyperparameters

(from `configs/dlscan-nanodet-plus-m_416.yml`)

| Parameter | Value | Notes |
|---|---|---|
| `input_size` | 416×416 | NanoDet-native; sufficient for region localization (OCR reads text at full res) |
| `batchsize_per_gpu` | 8 (config) | the M3-Ultra full run used a larger effective batch; see config/STATUS |
| `total_epochs` | 30 | early-stop when val mAP@0.5 saturates |
| `optimizer` | AdamW (`lr` 1e-3, `weight_decay` 0.05) | cosine LR (`CosineAnnealingLR`, eta_min 5e-5), 500-step linear warmup |
| `weight_averager` | EMA (decay 0.9998) | shipped weights are the EMA `model_best` |
| `precision` | 32 | |
| `device` | `mps` | trained on Apple M3 Ultra via MPS |
| `flip` aug | 0.0 | disabled — field layout is orientation-specific |

### Training outputs

```
model-training/nanodet/workspace/dlscan-nanodet-416/model_best/nanodet_model_best.pth
```

This EMA checkpoint is exported to `models/nanodet_field_416.tflite` via
`model-training/nanodet/export_tflite/export_internal.py` (litert-torch).

---

## OCR post-processing (no ML in v1)

A trained Keras disambiguation model was attempted (1D-Conv + BiLSTM
"per-char classification" or LSTM seq2seq with attention, dispatched at
training time by `measure_error_types.py`) but failed in evaluation — the
model dropped held-out string accuracy from 10.7% → 4.8% via mode collapse.
The model and its pipeline were removed from the v1 product.

See [`../model-training/idnet/DISAMBIG_POSTMORTEM.md`](../model-training/idnet/DISAMBIG_POSTMORTEM.md)
for the full failure analysis, the surviving training data location
(`$IDNET_DATA_ROOT/ocr_pairs.jsonl`, 111 897 pairs preserved for any future v2
attempt; `$IDNET_DATA_ROOT` is the IDNet data directory, e.g.
`~/idnet-data`), and the architectural changes that would be required for any
future retry.

In v1, OCR errors made by VisionKit (iOS) or ML Kit Text Recognition
(Android) flow through to the C++ field extractor as-is. The C++ extractor
absorbs common patterns (date separator confusables, simple substitutions)
via regex and format normalization rather than via a trained model.

---

## Export and quantization

### LiteRT / TFLite (both platforms) — fp32 default

The field detector exports to a single LiteRT/TFLite model
(`models/nanodet_field_416.tflite`) loaded in JS via `react-native-fast-tflite`
on both iOS and Android — there is no longer a per-platform Core ML vs. TFLite
split for this model.

- Export path: PyTorch → LiteRT/TFLite via `litert-torch`
  (`export_tflite/export_internal.py`). It wraps `forward()` to permute
  NHWC→NCHW so the tflite input is NHWC `[1, 416, 416, 3]`, and bakes
  `sigmoid` into the 30 class channels (the DFL logits stay raw; the decode
  does the integral). `onnx2tf` does **not** work for this graph (shape-inference
  bug in the NanoDet-Plus head) — litert-torch converts the torch model directly.
- The **shipped** model is **fp32** (4.99 MB). Parity vs PyTorch is tight
  (max abs diff ~1.07e-5, corr ~1.0; see `export_tflite/parity_check.py`).
- A **dynamic-int8** variant (`export_tflite/nanodet_field_416_dynint8.tflite`,
  ~1.6 MB, 3× smaller) exists via `export_tflite/quant_int8.py` but shows
  cls-head deviation on OOD input. It is **not shipped** and must be validated
  on-device before use.

### OBB non-maximum suppression

The YOLOv8n-OBB doc detector is not trained in the current pipeline, so there
is no OBB NMS to handle at export time. The field detector uses axis-aligned
bounding boxes, which are natively supported by Core ML and TFLite.

If a future contributor re-enables the OBB doc detector (e.g., via CUDA cloud
training), note that rotated NMS would need to be implemented separately in
the iOS Swift and Android Kotlin consumer wrappers — neither Core ML nor TFLite
supports rotated NMS natively.

---

## Random Seeds

| Stage | Seed | Location |
|---|---|---|
| Stratified subset extraction | 42 | `extract_subsets.py` (fixed) |
| Train/val/test split | 42 | `prepare_yolo_fields.py` (fixed); converted to COCO by `nanodet/yolo_to_coco.py` |
| NanoDet field detector training | per NanoDet config | `nanodet/train_nanodet.py` with `configs/dlscan-nanodet-plus-m_416.yml` |

---

## Known Reproducibility Caveats

### PyTorch MPS OBB — REQUIRES CUDA; MPS path is broken

PyTorch MPS has documented silent correctness bugs in rotated bounding-box
(OBB) operations. The smoke test (`smoke_test_obb.py`) ran 2 epochs on 10K
images comparing MPS vs CPU loss curves and angle distributions, and produced
a KL divergence of **>0.10** on the predicted angle distribution — above the
0.10 failure threshold. This matches the documented bug in:

- Ultralytics issue [#10181](https://github.com/ultralytics/ultralytics/issues/10181)
- Ultralytics issue [#13081](https://github.com/ultralytics/ultralytics/issues/13081)

**OBB model training REQUIRES CUDA as of PyTorch 2.11.0 + Ultralytics 8.4.47.
The MPS path produces loss convergence but incorrect angle predictions — a
silent correctness failure. We chose to skip OBB training entirely rather
than commit to a CUDA cloud spend.** Document segmentation at runtime uses
`VNDetectDocumentSegmentationRequest` (iOS) and the bundled DocAligner
`lcnet100` TFLite model (Android). See
[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md).

If a future contributor wants to resume OBB training (e.g., from a CUDA cloud
instance), the scaffolding (`prepare_yolo_obb.py`, `train_doc_detector.py`,
`export_doc_detector.py`) remains in `model-training/` and only needs
reactivation.

### MPS FP16 AMP maturity

PyTorch MPS FP16 AMP is less mature than CUDA FP16 AMP. Numerical differences
between MPS and CUDA training are expected. Reproducing these exact models on
a CUDA GPU will likely yield **~1–2% mAP variance** even with identical seeds
and hyperparameters.

### Wall time estimates

These are single-run estimates on the target hardware (M3 Ultra, 256 GB).
Doc detector training (Stage 3 in the original plan) is omitted — it was
abandoned after the MPS smoke test failure described above.

| Stage | Estimated wall time |
|---|---|
| IDNet extraction (~358K images) | ~2 hours |
| YOLO-fields → COCO dataset preparation | ~1 hour |
| NanoDet field detector training (MPS, ~5 h/epoch; early-stop when val mAP@0.5 saturates) | ~1 day |
| LiteRT/TFLite export (litert-torch) + parity check | ~10 minutes |
| **Total** | **~1 day + a few hours of data prep** |

---

## Carbon Footprint Calculation

- Hardware TDP: ~285 W (M3 Ultra, combined GPU + CPU + Neural Engine at load)
- Total training wall time: ~25 hours (one-time; doc detector skipped)
- US average grid carbon intensity: ~0.4 kg CO₂/kWh
- **Estimated one-time carbon cost: ~3 kg CO₂**
  (285 W × 25 h × 0.4 kg CO₂/kWh × 10⁻³ ≈ 2.85 kg CO₂)

This is roughly half the original ~5.7 kg CO₂ estimate and is approximately
equivalent to driving a passenger car ~11 km.
Inference carbon cost is negligible: on-device inference consumes < 100 mW
per frame on A-series / M-series Apple Silicon.
