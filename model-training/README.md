# react-native-dl-scan — Model Training Pipeline

Local training pipeline for the three on-device ML models that power
`react-native-dl-scan`:

| Model | Architecture | Purpose |
|---|---|---|
| `DlScanDocDetector` | YOLOv8n-OBB | Detect and orient the ID document in camera frame |
| `DlScanFieldDetector` | YOLOv8n (axis-aligned) | Locate individual text fields on the rectified document |
| `DlScanFieldDisambig` | Keras per-char LSTM | Correct OCR substitution errors |

All training is **local on an M3 Ultra Mac Studio**. There is no cloud fallback budget.

---

## Prerequisites

### Python version

`tensorflow-macos` requires **Python 3.11 or 3.12**. The current Homebrew
default may be 3.14 which is not compatible. Use pyenv:

```bash
pyenv install 3.12.9
pyenv local 3.12.9
python --version   # should print Python 3.12.x
```

### Virtual environment + dependencies

```bash
python -m venv model-training/.venv
source model-training/.venv/bin/activate
pip install -r model-training/requirements.txt
```

The requirements include `pyobjc>=10.0` for VisionKit OCR (step 5 below).
This requires macOS 14 (Sonoma) or later.

### IDNet dataset

All 20 `.zip` files are already downloaded and verified at:

```
/Volumes/Work4TB/dev/iotashan/idnet-data/zips/   (388 GB total)
/Volumes/Work4TB/dev/iotashan/idnet-data/manifest.tsv
```

**Do not modify these files.** The manifest contains md5 checksums.

### Disk space

Estimated additional space needed:

| Stage | Size |
|---|---|
| Extracted JPEGs (525K) | ~250 GB |
| YOLO OBB dataset (symlinks + labels) | ~2 GB |
| YOLO fields dataset (rectified images) | ~30 GB |
| Training runs (checkpoints) | ~5 GB |
| Final models | ~50 MB |

Total: ~290 GB free space required. The 4 TB external drive has plenty.

---

## Order of operations

### Stage 1 — Data preparation (~2 hours)

**Subset strategy:** `extract_subsets.py` draws up to 25K samples per doc type
from three subdirectories inside each IDNet zip:

- `<ZIP_STEM>/positive/`  (~6K images per zip)
- `<ZIP_STEM>/fraud5_inpaint_and_rewrite/`  (~12K images per zip, fraud variants)
- `<ZIP_STEM>/fraud6_crop_and_replace/`  (~13K images per zip, fraud variants)

Fraud variants are **included by default** (`--include-fraud` is True).  The
fraud images have identical geometric layout to positives (same corners, same
field bboxes); only textual content differs — a separate, out-of-scope
workstream handles fraud detection.  Including them adds ~700K additional
training samples at no cost to geometric accuracy, making the 25K target per
type achievable.  Pass `--no-include-fraud` to extract positive-only.

```bash
# Extract stratified 525K samples (25K per doc type, fraud variants included)
python model-training/idnet/extract_subsets.py

# Verify extraction
python -c "
from pathlib import Path
root = Path('/Volumes/Work4TB/dev/iotashan/idnet-data/extracted')
for d in sorted(root.iterdir()):
    n = len(list(d.glob('*.jpg')))
    print(f'{d.name:40s} {n:6d} images')
"

# Generate Ultralytics OBB dataset (symlinks + label .txt files)
python model-training/idnet/prepare_yolo_obb.py

# Generate rectified field detector dataset
python model-training/idnet/prepare_yolo_fields.py
```

Each script is **resume-friendly** — re-running it skips already-processed samples.

### Stage 2 — MPS OBB smoke test (~30 minutes)

```bash
python model-training/smoke_test_obb.py
```

This runs 2 epochs on 10K images, once on MPS and once on CPU, then compares
loss curves and angle distributions.

**If PASS**: proceed to Stage 3.

**If FAIL**: two remediation paths:
- **Option A — CPU training**: `python model-training/train_doc_detector.py --device cpu`
  Wall time: ~7-10 days. Accurate. Set and forget.
- **Option B — Axis-aligned + rotation aug**: edit `train_doc_detector.py` to use
  `yolov8n.pt` (not OBB) and add `degrees=30` augmentation. Wall time: ~10-15 hrs.
  Slightly lower accuracy for extreme card tilts (>30°), but MPS-safe.

See `smoke_test_obb.py` output for the exact failure reason and Ultralytics
issue references (#10181, #13081).

### Stage 3 — Doc detector training (~20-30 hours)

```bash
python model-training/train_doc_detector.py
```

- YOLOv8n-OBB, imgsz=320, batch=128, 80 epochs, MPS FP16
- Checkpoints every 10 epochs: `runs/doc_detector/run/weights/`
- Best weights: `runs/doc_detector/run/weights/best.pt`

Monitor thermals during this stage:

```bash
sudo powermetrics --samplers smc,gpu_power,thermal -i 1000
```

If the first epoch is significantly faster than subsequent ones, suspect thermal
throttling. Allow 30 min warmup before drawing conclusions.

### Stage 4 — Field detector training (~15-25 hours)

```bash
python model-training/train_field_detector.py
```

- YOLOv8n (axis-aligned), imgsz=640, batch=64, 60 epochs, MPS FP16
- No OBB operations — safe to run regardless of smoke test result
- Checkpoints every 10 epochs: `runs/field_detector/run/weights/`

**Can run while Stage 5 runs** — the field detector uses the GPU, and OCR pair
generation runs on the Neural Engine (a separate physical chip).

### Stage 5 — OCR pair generation (~4-6 hours)

Generates training data for the disambig model. Uses VisionKit text recognition
via the Neural Engine — **does not use the GPU**.

```bash
# Generate 50K (image, OCR output, ground truth) triples
python model-training/disambig/render_ocr_pairs.py

# Analyze error type distribution and determine architecture
python model-training/disambig/measure_error_types.py
```

`measure_error_types.py` prints one of:

```
ARCHITECTURE: per-char-classification    ← default; substitutions dominate
ARCHITECTURE: seq2seq                    ← if insertion/deletion errors >= 20%
```

The `train_disambig.py` script reads this output automatically.

### Stage 6 — Disambig model training (~2 hours)

```bash
python model-training/disambig/train_disambig.py
```

- Keras 3 (TensorFlow backend), 30 epochs, batch=64
- Auto-detects architecture from `measure_error_types.py` output
- Best model: `runs/disambig/best.keras`
- Training history: `runs/disambig/history.csv`

### Stage 7 — Export (~4-6 hours total)

```bash
# Export doc detector (Core ML int8 + TFLite int8)
python model-training/export/export_doc_detector.py

# Export field detector (Core ML int8 + TFLite int8)
python model-training/export/export_field_detector.py

# Export disambig (Core ML + TFLite float16)
python model-training/export/export_disambig.py

# Validate quantization accuracy vs FP32 baseline
python model-training/export/validate_quantization.py
```

`validate_quantization.py` prints `VALIDATION: PASS` or `VALIDATION: FAIL`.
Threshold: mAP@0.5 delta < 1 % absolute.

---

## Hardware notes for M3 Ultra

### Memory

- 256 GB unified memory. `cache='ram'` in YOLO training would need ~257 GB
  for 525K images at imgsz=320 — do not enable. Use `cache=False` (default).
- If GPU memory pressure shows up in powermetrics, reduce batch size.

### Concurrency

| Chip | Used by |
|---|---|
| GPU (80-core) | Doc detector training, field detector training |
| Neural Engine (32-core) | VisionKit OCR pair generation, Core ML export/inference |
| CPU (32-core) | DataLoader workers, TFLite conversion |

**Sequential GPU**: never run `train_doc_detector.py` and `train_field_detector.py`
at the same time. GPU training jobs serialize at the kernel level on MPS; two
processes compete and both degrade.

**Overlapping GPU + Neural Engine is fine**: run `render_ocr_pairs.py` while the
GPU runs Stage 3 or 4.

### Thermal management

```bash
# Monitor GPU power, CPU die temperature, fan speed
sudo powermetrics --samplers smc,gpu_power,thermal -i 1000

# Quick thermal snapshot
sudo powermetrics --samplers smc -i 1 -n 1 | grep -E 'die|Fan|GPU Power'
```

The M3 Ultra sustains high GPU loads well, but 20+ hour continuous training
is unusual. If you see GPU power dropping from ~200W to ~140W after 30 min,
ensure the system has adequate airflow.

---

## Quantization rationale

### Quantization validation scope

**`validate_quantization.py` only regression-tests TFLite (Android) models**
via Ultralytics' built-in `YOLO.val()` TFLite inference path.

**Core ML (iOS) quantization quality must be validated manually on-device.**
Running a Core ML `.mlmodelc` through `coremltools` inference on macOS does
not exercise the Neural Engine path and does not give a reliable mAP estimate.
After running `export_doc_detector.py` / `export_field_detector.py`, load the
`.mlpackage` on a real iPhone, run inference against a held-out image set, and
verify that detection boxes match the FP32 reference within your mAP threshold.

### Core ML (iOS)

Weight-only int8 quantization via
`coremltools.optimize.coreml.linear_quantize_weights`.

- **No calibration data required**: only weight tensors are quantized;
  activations remain float16/float32.
- ~4x file size reduction vs float32; typically < 0.5 % mAP drop.
- Runs primarily on Neural Engine with some CPU float operations.
- **mAP validation: manual on-device only** (see note above).

### TFLite (Android)

Full int8 quantization with a `representative_dataset` of 300-500 stratified
images from the training distribution.

- **Calibration data required**: both weights AND activations are quantized.
- More aggressive compression; requires accurate calibration data.
- Android v1 ships a heuristic disambig fallback (no TFLite disambig);
  v2 adds ML Kit-tuned disambig.

### OBB NMS

Rotated (OBB) non-maximum suppression is **NOT** in the exported graph.
Swift handles rotated NMS in the iOS consumer wrapper code.
Android does the same in Kotlin.

Both Core ML and TFLite in-graph NMS support only axis-aligned boxes.

---

## Disambig architecture

The architecture is selected by `measure_error_types.py` based on the
error distribution in `ocr_pairs.jsonl`.

**Per-character classification** (default):
- Input: one-hot OCR string padded to 24 chars + field-type embedding
- 1D conv × 2 → Bidirectional LSTM (64 units) → per-position softmax
- TFLite-trivial, quantization-friendly
- Works well when OCR errors are mostly substitutions (same position, wrong char)

**Seq2seq fallback** (if insertion/deletion errors >= 20%):
- Encoder: 1D conv + LSTM(128)
- Decoder: fixed max-output-length LSTM(128) + Bahdanau attention
- Fixed output length preserves TFLite export compatibility
- Slightly higher complexity; ~3x training time

---

## Output files

After export, the `models/` directory at repo root contains:

```
models/
  DlScanDocDetector.mlpackage/     Core ML OBB detector (int8)
  DlScanDocDetector.mlmodelc/      Compiled for on-device deployment
  DlScanFieldDetector.mlpackage/   Core ML field detector (int8)
  DlScanFieldDetector.mlmodelc/    Compiled
  DlScanFieldDisambig.mlpackage/   Core ML disambig
  DlScanFieldDisambig.mlmodelc/    Compiled
  dl_scan_doc_detector.tflite      Android doc detector (int8)
  dl_scan_field_detector.tflite    Android field detector (int8)
  dl_scan_field_disambig.tflite    Android disambig (float16)
  version.json                     Training metadata + export timestamps
```

These files will be committed to the repo via Git LFS once they pass
`validate_quantization.py`.

---

## Known risks

### MPS OBB correctness bugs

PyTorch MPS has had silent correctness bugs in rotated bounding-box operations.
Relevant Ultralytics issues: [#10181](https://github.com/ultralytics/ultralytics/issues/10181),
[#13081](https://github.com/ultralytics/ultralytics/issues/13081).

The smoke test (`smoke_test_obb.py`) guards against this. If it fails on your
specific PyTorch + macOS combination, use the CPU or axis-aligned fallback.

### Thermal throttling on 20+ hour runs

The M3 Ultra can sustain high GPU loads, but extended training is unusual for
consumer Macs. Monitor with `powermetrics` and ensure the machine has good
airflow. An unexpected drop in throughput after the first 30-60 min usually
indicates thermal throttling.

### Android v1 disambig coverage

Android v1 ships without an ML Kit-trained disambig. The C++ layer falls back
to heuristic character correction (AAMVA date format normalization, common
OCR substitution tables). The Keras/TFLite disambig model targets v2+.

### tensorflow-macos compatibility

`tensorflow-macos` must be used instead of plain `tensorflow` on Apple Silicon.
The `metal` plugin is bundled in the macOS wheel.

```bash
# Verify TF sees the GPU
python -c "import tensorflow as tf; print(tf.config.list_physical_devices())"
# Should include PhysicalDevice(name='/physical_device:GPU:0', device_type='GPU')
```

---

## Quick-reference: all scripts

| Script | Full/Skeleton | Purpose |
|---|---|---|
| `idnet/extract_subsets.py` | Full | IDNet zips → 525K extracted JPEGs + metadata |
| `idnet/prepare_yolo_obb.py` | Full | Metadata → YOLO OBB labels + data.yaml |
| `idnet/prepare_yolo_fields.py` | Full | Metadata → rectified field labels + data.yaml |
| `smoke_test_obb.py` | Full | 2-epoch MPS-vs-CPU OBB correctness check |
| `train_doc_detector.py` | Full | 80-epoch YOLOv8n-OBB training |
| `train_field_detector.py` | Full | 60-epoch YOLOv8n field training |
| `disambig/render_ocr_pairs.py` | Full | VisionKit OCR → pairs.jsonl |
| `disambig/measure_error_types.py` | Full | Error analysis → architecture flag |
| `disambig/train_disambig.py` | Full | Keras per-char / seq2seq training |
| `export/export_doc_detector.py` | Full | Core ML int8 + TFLite int8 export |
| `export/export_field_detector.py` | Full | Core ML int8 + TFLite int8 export |
| `export/export_disambig.py` | Full | Core ML + TFLite float16 export |
| `export/validate_quantization.py` | Full | mAP delta + latency regression check |
| `utils/paths.py` | Full | Canonical path constants |
| `utils/benchmarks.py` | Skeleton | GPU/CPU/ANE throughput benchmarks (fill in) |

---

## Dry-run mode

Every script supports `--dry-run`. This prints what it would do without
reading/writing any data or starting any training:

```bash
python model-training/idnet/extract_subsets.py --dry-run
python model-training/train_doc_detector.py --dry-run
python model-training/export/export_doc_detector.py --dry-run
# etc.
```

Dry-run is safe to run at any time to inspect configuration.
