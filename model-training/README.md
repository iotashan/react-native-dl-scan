# react-native-dl-scan — Model Training Pipeline

> **Doc detector training was deliberately skipped after MPS smoke test failure.**
> Document segmentation at runtime uses Apple Vision's
> `VNDetectDocumentSegmentationRequest` (iOS) and a bundled DocAligner lcnet100
> TFLite model (Android, `android/src/main/assets/docaligner_lcnet100.tflite`).
> See [docs/TRAINING_DETAILS.md](../docs/TRAINING_DETAILS.md) for the rationale
> and [docs/ARCHITECTURE_DECISIONS.md](../docs/ARCHITECTURE_DECISIONS.md) for
> the full decision record.

> For the one-command retrain walkthrough and reproducibility checklist, see
> [docs/REPRODUCIBILITY.md](../docs/REPRODUCIBILITY.md).
>
> For dataset provenance, privacy statement, and license, see
> [docs/DATA_CARD.md](../docs/DATA_CARD.md).
>
> For the full model card (architecture, evaluation, limitations, citation), see
> [docs/MODEL_CARD.md](../docs/MODEL_CARD.md).

Local training pipeline for the single trained on-device ML model that powers
`react-native-dl-scan`:

| Model | Architecture | Purpose |
|---|---|---|
| `DlScanFieldDetector` | YOLOv8n (axis-aligned) | Locate individual text fields on the rectified document |

A Keras OCR-disambiguation model (`DlScanFieldDisambig`) was attempted and
**removed from the product** after a held-out diagnostic showed it was
net-negative on accuracy. v1 ships **no ML disambig**: platform-vendor OCR
(VisionKit / ML Kit) feeds the shared C++ field extractor directly. The full
postmortem is at [idnet/DISAMBIG_POSTMORTEM.md](idnet/DISAMBIG_POSTMORTEM.md);
the disambig training code has been removed and the stages below are marked
inactive.

Document segmentation (formerly `DlScanDocDetector`, YOLOv8n-OBB) is handled
at runtime by `VNDetectDocumentSegmentationRequest` (iOS) and a bundled
DocAligner TFLite model (Android) — see the note above.

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

Point the pipeline at your downloaded copy of the dataset with the
`IDNET_DATA_ROOT` environment variable (defaults to `./idnet-data` if unset):

```bash
export IDNET_DATA_ROOT=/path/to/idnet-data
```

All 20 `.zip` files must be downloaded and verified at:

```
$IDNET_DATA_ROOT/zips/   (388 GB total)
$IDNET_DATA_ROOT/manifest.tsv
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
import os
from pathlib import Path
root = Path(os.environ.get('IDNET_DATA_ROOT', 'idnet-data')) / 'extracted'
for d in sorted(root.iterdir()):
    n = len(list(d.glob('*.jpg')))
    print(f'{d.name:40s} {n:6d} images')
"

# Generate rectified field detector dataset
python model-training/idnet/prepare_yolo_fields.py
```

Each script is **resume-friendly** — re-running it skips already-processed samples.

Note: `prepare_yolo_obb.py` is preserved in the repo but is not invoked by the
pipeline — OBB training was dropped (see repo-level note above). The OBB labels
it generates remain valid for future CUDA-based training if needed.

### Stage 2 — Field detector training (~15-25 hours)

```bash
python model-training/train_field_detector.py
```

- YOLOv8n (axis-aligned), imgsz=640, batch=64, 60 epochs, MPS FP16
- No OBB operations — safe on MPS
- Checkpoints every 10 epochs: `runs/field_detector/run/weights/`

Monitor thermals during this stage:

```bash
sudo powermetrics --samplers smc,gpu_power,thermal -i 1000
```

### Stage 3 — OCR pair generation — **REMOVED** (was disambig data prep)

> **Inactive.** These stages produced training data for the OCR-disambiguation
> model, which was removed from the product (net-negative accuracy — see
> [idnet/DISAMBIG_POSTMORTEM.md](idnet/DISAMBIG_POSTMORTEM.md)). The disambig
> scripts (`render_ocr_pairs.py`, `measure_error_types.py`, `train_disambig.py`,
> `export_disambig.py`) have been removed from the repo and are no longer
> invoked by `run_full_pipeline.sh`. The raw OCR-pair training data it generated
> is retained for reference (see the postmortem's "Data assets retained").

### Stage 4 — Disambig model training — **REMOVED**

> **Inactive.** See Stage 3 above and the postmortem. v1 ships no ML disambig;
> platform-vendor OCR feeds the shared C++ field extractor directly.

### Stage 5 — Export (~5 min)

```bash
# Export field detector (Core ML int8 + TFLite int8)
python model-training/export/export_field_detector.py

# Validate quantization accuracy vs FP32 baseline
python model-training/export/validate_quantization.py
```

`validate_quantization.py` prints `VALIDATION: PASS` or `VALIDATION: FAIL`.
Threshold: mAP@0.5 delta < 1 % absolute.

Note: `export_doc_detector.py` is preserved in the repo but is not invoked —
there is no doc detector to export in the current pipeline.

---

## Hardware notes for M3 Ultra

### Memory

- 256 GB unified memory. `cache='ram'` in YOLO training would need ~257 GB
  for 525K images at imgsz=320 — do not enable. Use `cache=False` (default).
- If GPU memory pressure shows up in powermetrics, reduce batch size.

### Concurrency

| Chip | Used by |
|---|---|
| GPU (80-core) | Field detector training |
| Neural Engine (32-core) | Core ML export/inference |
| CPU (32-core) | DataLoader workers, TFLite conversion |

**Sequential GPU**: do not run multiple GPU training jobs simultaneously. GPU
training jobs serialize at the kernel level on MPS; two processes compete and
both degrade.

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
After running `export_field_detector.py`, load the `.mlpackage` on a real
iPhone, run inference against a held-out image set, and verify that detection
boxes match the FP32 reference within your mAP threshold.

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
- v1 ships **no ML disambig** on either platform — OCR output is parsed
  directly by the shared C++ field extractor (see the postmortem).

### OBB NMS

The OBB doc detector is not trained in the current pipeline; there is no OBB
NMS to handle at export time. The field detector uses axis-aligned operations
compatible with standard Core ML and TFLite NMS. If a future contributor
re-enables the OBB doc detector, note that rotated NMS would need to be
implemented in the Swift / Kotlin consumer wrappers (Core ML and TFLite only
support axis-aligned NMS natively).

---

## Disambig architecture — **REMOVED**

> The OCR-disambiguation model was trained, evaluated, and dropped from the
> product. The two candidate architectures (per-character classification and a
> seq2seq fallback), why the trained model collapsed, and what a future v2
> attempt would need to change are all documented in
> [idnet/DISAMBIG_POSTMORTEM.md](idnet/DISAMBIG_POSTMORTEM.md). v1 ships no ML
> disambig.

---

## Output files

After export, the `models/` directory at repo root contains:

```
models/
  DlScanFieldDetector.mlpackage/   Core ML field detector (int8)
  DlScanFieldDetector.mlmodelc/    Compiled for on-device deployment
  dl_scan_field_detector.tflite    Android field detector (int8)
  version.json                     Training metadata + export timestamps
```

Note: the disambig artifacts (`DlScanFieldDisambig.*`, `dl_scan_field_disambig.tflite`)
are NOT produced — the disambig model was removed from the product.

Note: `DlScanDocDetector.*` and `dl_scan_doc_detector.tflite` are NOT produced.
Document segmentation is handled at runtime by `VNDetectDocumentSegmentationRequest`
(iOS) and a bundled DocAligner lcnet100 TFLite model on Android
(`android/src/main/assets/docaligner_lcnet100.tflite`, loaded at runtime).

These files will be committed to the repo via Git LFS once they pass
`validate_quantization.py`.

---

## Known risks

### MPS OBB correctness bugs (doc detector not trained)

PyTorch MPS has documented silent correctness bugs in rotated bounding-box
(OBB) operations. The smoke test (`smoke_test_obb.py`) confirmed this with a
KL divergence >0.10 on the M3 Ultra / PyTorch 2.11.0 / Ultralytics 8.4.47
combination. Relevant issues:
[#10181](https://github.com/ultralytics/ultralytics/issues/10181),
[#13081](https://github.com/ultralytics/ultralytics/issues/13081).

As a result, OBB training was dropped entirely. The scaffolding scripts
(`smoke_test_obb.py`, `train_doc_detector.py`, `export_doc_detector.py`,
`prepare_yolo_obb.py`) are preserved for future CUDA-based resumption.

### Thermal throttling on 20+ hour runs

The M3 Ultra can sustain high GPU loads, but extended training is unusual for
consumer Macs. Monitor with `powermetrics` and ensure the machine has good
airflow. An unexpected drop in throughput after the first 30-60 min usually
indicates thermal throttling.

### No ML disambig (removed)

The product ships without any ML OCR-disambiguation model on either platform.
The shared C++ layer handles OCR errors at parse time — AAMVA date-format
normalization, height/postal-code regex fallbacks, and common substitution
tables — rather than at the character level. The Keras disambig model was
attempted and removed after it proved net-negative; revisiting it is a
possible v2 path documented in the
[postmortem](idnet/DISAMBIG_POSTMORTEM.md).

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

Scripts marked **[inactive]** are preserved for future CUDA-based resumption
but are not invoked by `run_full_pipeline.sh`. The disambig scripts have been
**removed** (see [idnet/DISAMBIG_POSTMORTEM.md](idnet/DISAMBIG_POSTMORTEM.md)).

| Script | Full/Skeleton | Purpose |
|---|---|---|
| `idnet/extract_subsets.py` | Full | IDNet zips → 525K extracted JPEGs + metadata |
| `idnet/prepare_yolo_obb.py` | Full | **[inactive]** Metadata → YOLO OBB labels + data.yaml |
| `idnet/prepare_yolo_fields.py` | Full | Metadata → rectified field labels + data.yaml |
| `smoke_test_obb.py` | Full | **[inactive]** 2-epoch MPS-vs-CPU OBB correctness check |
| `train_doc_detector.py` | Full | **[inactive]** 80-epoch YOLOv8n-OBB training |
| `train_field_detector.py` | Full | 60-epoch YOLOv8n field training |
| `export/export_doc_detector.py` | Full | **[inactive]** Core ML int8 + TFLite int8 export |
| `export/export_field_detector.py` | Full | Core ML int8 + TFLite int8 export |
| `export/validate_quantization.py` | Full | mAP delta + latency regression check |
| `utils/paths.py` | Full | Canonical path constants |
| `utils/benchmarks.py` | Skeleton | GPU/CPU/ANE throughput benchmarks (fill in) |
| `disambig/*.py`, `export/export_disambig.py` | **[removed]** | OCR disambig (net-negative; see postmortem) |

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
