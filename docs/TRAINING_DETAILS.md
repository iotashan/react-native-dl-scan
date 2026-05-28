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
`VNDetectDocumentSegmentationRequest` (iOS) and the ML Kit Document Scanner
(Android). See [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) for the
full decision record.

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
| Python | 3.12.13 (Homebrew / pyenv) | tensorflow-macos requires 3.11 or 3.12 |
| PyTorch | ≥2.6.0 (MPS backend) | AMP FP16 only — BF16 not supported on MPS |
| Ultralytics | ≥8.3.0 | YOLOv8 OBB training API; community fork of YOLOv8 |
| coremltools | ≥9.0 | Core ML export + linear weight quantization |
| numpy | ≥1.26.0, <2.0 | Upper bound required for TF-macos 2.16 compatibility |
| Pillow | ≥10.0.0 | Image loading |
| OpenCV | ≥4.10.0 (headless) | Document rectification |
| PyYAML | ≥6.0.0 | YOLO data.yaml generation |
| scikit-learn | ≥1.4.0 | Stratified splitting, evaluation metrics |

Full pinned dependency list: [`model-training/requirements.txt`](../model-training/requirements.txt).

### Verified working combination (training machine)

Per-stage uv-locked envs under `model-training/envs/`. Currently shipped:

```
envs/train/         — torch 2.11 + ultralytics 8.4.46         (YOLO training, MPS)
envs/export-ios/    — torch 2.11 + ultralytics + coremltools 9.0
envs/export-android/— torch + ultralytics + tensorflow 2.18.1 + onnx2tf
                      + ai-edge-litert 1.2.0                  (TFLite int8 export)
```

Each env is created by `uv sync --frozen` against a checked-in `uv.lock`.
Launchers in `model-training/scripts/*.sh` set `YOLO_AUTOINSTALL=False` and
print version assertions before running real work — Ultralytics' default
`check_requirements()` AutoInstall is a footgun on Apple Silicon (it
overwrites pinned wheels with generic ones), and the per-stage env layout
plus the `YOLO_AUTOINSTALL=False` guard prevents that.

---

## Model 1: DlScanFieldDetector (YOLOv8n axis-aligned)

### Architecture

- Base: YOLOv8n pretrained weights (`yolov8n.pt`)
- Task: Per-field axis-aligned bounding box detection on rectified 640×640
  document crops
- Output: class probabilities + bounding boxes (x_center y_center w h,
  normalized 0–1)

### Hyperparameters

| Parameter | Value | Notes |
|---|---|---|
| `imgsz` | 640 | Higher resolution required for small text field bboxes |
| `batch` | 64 | Reduced from 128 due to larger image size |
| `epochs` | 60 | Convergence faster than doc detector |
| `optimizer` | AdamW | |
| `lr0` | 1e-3 | |
| `cos_lr` | True | |
| `amp` | True | FP16 AMP |
| `patience` | 10 | |
| `device` | `mps` | Axis-aligned; no OBB correctness risk |
| `seed` | 0 | |

No MPS smoke test required for this model — axis-aligned NMS is well-supported
on all current PyTorch MPS versions.

### Training outputs

```
model-training/runs/field_detector/run/weights/best.pt
model-training/runs/field_detector/run/weights/last.pt
model-training/runs/field_detector/run/results.csv
```

---

## OCR post-processing (no ML in v1)

A trained Keras disambiguation model was attempted (1D-Conv + BiLSTM
"per-char classification" or LSTM seq2seq with attention, dispatched at
training time by `measure_error_types.py`) but failed in evaluation — the
model dropped held-out string accuracy from 10.7% → 4.8% via mode collapse.
The model and its pipeline were removed from the v1 product.

See [`../model-training/idnet/DISAMBIG_POSTMORTEM.md`](../model-training/idnet/DISAMBIG_POSTMORTEM.md)
for the full failure analysis, the surviving training data location
(`/Volumes/Work4TB/dev/iotashan/idnet-data/ocr_pairs.jsonl`, 111 897 pairs
preserved for any future v2 attempt), and the architectural changes that
would be required for any future retry.

In v1, OCR errors made by VisionKit (iOS) or ML Kit Text Recognition
(Android) flow through to the C++ field extractor as-is. The C++ extractor
absorbs common patterns (date separator confusables, simple substitutions)
via regex and format normalization rather than via a trained model.

---

## Quantization

### Core ML (iOS) — weight-only int8

Applied via `coremltools.optimize.coreml.linear_quantize_weights`.

- Only weight tensors are quantized; activations remain float16/float32.
- No calibration data required (distinguishes this from full int8).
- Typical size reduction: ~4× vs float32.
- Typical mAP drop: < 0.5% absolute.
- Runs primarily on the Apple Neural Engine with some CPU float operations.
- **mAP validation on macOS does not exercise the Neural Engine path.**
  Post-export, validate Core ML models on a physical iPhone using the held-out
  test set. See `validate_quantization.py` output notes.

### TFLite (Android) — full int8

Applied via TensorFlow Lite converter with `representative_dataset`.

- Both weights AND activations are quantized to int8.
- Calibration set: 300–500 stratified samples from the training distribution.
- More aggressive compression than Core ML weight-only.
- Validated automatically by `validate_quantization.py` via Ultralytics'
  built-in TFLite inference path.
- Regression threshold: mAP@0.5 delta < 1% absolute vs FP32.

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
| Train/val/test split | 42 | `prepare_yolo_fields.py` (fixed) |
| YOLO field detector training | 0 | `train_field_detector.py` (`seed=0` in YOLO args) |
| TFLite calibration sampling | 42 | `export_field_detector.py` |

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
`VNDetectDocumentSegmentationRequest` (iOS) and the ML Kit Document Scanner
(Android). See [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md).

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
| YOLO fields dataset preparation | ~1 hour |
| Field detector training (60 epochs, MPS) | ~15–25 hours (early-stop typical at 11–20 hrs) |
| Core ML int8 export + validation | ~5 minutes |
| TFLite int8 export + validation | ~25–35 minutes |
| **Total** | **~20–28 hours** |

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
