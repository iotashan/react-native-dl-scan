# Reproducibility Guide

This document provides the complete, from-scratch instructions to reproduce
the two trained ML models bundled with `react-native-dl-scan`.

**Note on document segmentation:** A third trained model (YOLOv8n-OBB doc
detector) was originally planned but was dropped after the MPS smoke test
failed with a KL divergence >0.10 on predicted angle distributions (Ultralytics
issues [#10181](https://github.com/ultralytics/ultralytics/issues/10181) and
[#13081](https://github.com/ultralytics/ultralytics/issues/13081)). Runtime
document segmentation uses `VNDetectDocumentSegmentationRequest` (iOS, a
platform vendor API, not bundled) and the bundled DocAligner `lcnet100` TFLite
model (Android, shipped at `android/src/main/assets/docaligner_lcnet100.tflite`).
Neither is trained by this repo's pipeline — the Apple Vision request is part
of the OS, and the DocAligner weights are a pre-trained third-party model (see
[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)). The pipeline runner
script no longer includes Stage 2 (MPS smoke test) or Stage 3 (doc detector
training). See [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) for the
full record.

For background on the training procedure and hyperparameters see
[TRAINING_DETAILS.md](TRAINING_DETAILS.md). For dataset provenance see
[DATA_CARD.md](DATA_CARD.md).

---

## Determinism Expectations

**Reproducing these models to within ~1–2% mAP is achievable on the same
hardware (Apple M3 Ultra + macOS 26.4 + identical package versions).**

Exact bit-for-bit reproduction is not guaranteed because:

1. PyTorch MPS GPU kernel scheduling is non-deterministic even with fixed seeds.
2. TensorFlow-macos Metal backend has non-deterministic GPU kernel ordering
   by default (mitigated by `TF_DETERMINISTIC_OPS=1` at ~20% training-time cost).
3. The smoke test for MPS OBB correctness may select a different fallback
   path (CPU training or axis-aligned architecture) depending on the specific
   PyTorch + macOS patch combination.

**Reproducing on a CUDA GPU** (any platform) is possible with the same
hyperparameters, but **expect ~1–2% mAP variance** due to CUDA vs. MPS
numerical differences.

---

## Requirements

### Hardware

Minimum hardware for reasonable wall times:
- **Apple M3 Ultra or equivalent**: NanoDet field detector ~1 day on MPS
  (~5 h/epoch, early-stop when val mAP@0.5 saturates)
- **NVIDIA GPU (≥24 GB VRAM)**: similar or faster wall times with CUDA backend
- **Apple M2 Ultra or M1 Ultra**: ~2–4× longer training wall time
- **CPU-only**: many days; not recommended

Disk space required:
- IDNet ZIPs: ~388 GB
- Extracted JPEGs: ~250 GB
- YOLO datasets (labels + symlinks): ~32 GB
- Training checkpoints: ~5 GB
- Final models: ~50 MB

Total: ~670 GB free space. Ensure the drive has at least 700 GB free before
starting.

### Software

- macOS 14 (Sonoma) or later, OR Linux with CUDA for non-Apple training
- Python 3.11 or 3.12 (required by tensorflow-macos; Python 3.13+ not compatible)
- Homebrew (macOS) or equivalent package manager
- Git LFS (for post-training model artifact commits)

---

## Step-by-Step Instructions

### Step 1: Clone the repository at the trained-model commit

```bash
git clone https://github.com/iotashan/react-native-dl-scan.git
cd react-native-dl-scan

# Pin to the exact commit used for the shipped models
# <COMMIT_SHA_OF_TRAINED_MODELS> is recorded in models/version.json
git checkout <COMMIT_SHA_OF_TRAINED_MODELS>
```

The trained-model commit SHA is recorded in `models/version.json` under the
key `"source_commit"` after training completes.

### Step 2: Download IDNet (~388 GB)

Estimated download time: ~12 hours on a 100 Mbps connection.

Set `IDNET_DATA_ROOT` to wherever you want the IDNet data to live (it needs
several hundred GB free — see the disk-space requirements above). The
remaining commands reference this variable; the default below uses
`~/idnet-data`.

```bash
# Choose where IDNet data lives (default: ~/idnet-data)
export IDNET_DATA_ROOT="${IDNET_DATA_ROOT:-$HOME/idnet-data}"

# Install huggingface-hub if not already present
pip install huggingface-hub

# Create the data directory
mkdir -p "$IDNET_DATA_ROOT/zips"

# Download all 20 ZIP archives via Hugging Face Hub
python - <<'EOF'
from huggingface_hub import hf_hub_download, list_repo_files
import os

REPO_ID = "cactuslab/IDNet-2025"
OUT_DIR = os.path.join(os.environ["IDNET_DATA_ROOT"], "zips")
os.makedirs(OUT_DIR, exist_ok=True)

for fname in list_repo_files(REPO_ID, repo_type="dataset"):
    if fname.endswith(".zip"):
        print(f"Downloading {fname}...")
        hf_hub_download(
            repo_id=REPO_ID,
            repo_type="dataset",
            filename=fname,
            local_dir=OUT_DIR,
        )
print("Download complete.")
EOF
```

Alternatively, download directly from Zenodo:
https://zenodo.org/records/13852734

Verify integrity after download using the checksums in
`$IDNET_DATA_ROOT/manifest.tsv`:

```bash
cd "$IDNET_DATA_ROOT/zips"
md5sum -c ../manifest.tsv
```

### Step 3: Set up the Python environment

```bash
# Install Python 3.12 via Homebrew (macOS)
brew install python@3.12

# Or via pyenv (any platform)
pyenv install 3.12.9
pyenv local 3.12.9

# Verify Python version
python3.12 --version  # should print Python 3.12.x

# Create and activate the virtual environment
cd model-training
python3.12 -m venv .venv
source .venv/bin/activate

# Install all dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Verify TensorFlow sees the GPU (macOS Apple Silicon)
python -c "import tensorflow as tf; print(tf.config.list_physical_devices())"
# Expected: [..., PhysicalDevice(name='/physical_device:GPU:0', device_type='GPU')]

# Verify PyTorch MPS is available
python -c "import torch; print(torch.backends.mps.is_available())"
# Expected: True
```

### Step 4: Run the full pipeline

```bash
# Activate the environment if not already active
source model-training/.venv/bin/activate

# Run all stages sequentially (~25 hours total on M3 Ultra)
bash model-training/run_full_pipeline.sh
```

The pipeline runs stages in this order:
1. IDNet ZIP extraction (stratified ~525K samples, fraud variants included)
2. Field detector dataset preparation (rectified crops; YOLO-fields labels
   converted to COCO via `model-training/nanodet/yolo_to_coco.py` →
   95,490 train / 12,055 val)
3. Field detector training (NanoDet-Plus-m via RangiLyu/nanodet on MPS, ~1 day;
   early-stop when val mAP@0.5 saturates)
4. Export: PyTorch → LiteRT/TFLite via litert-torch
   (`model-training/nanodet/export_tflite/export_internal.py`) →
   `models/nanodet_field_416.tflite`
5. Parity check vs PyTorch (`export_tflite/parity_check.py`)

Note: a Keras OCR-disambiguation model was attempted in earlier iterations
and removed. See
[`../model-training/idnet/DISAMBIG_POSTMORTEM.md`](../model-training/idnet/DISAMBIG_POSTMORTEM.md)
for the failure analysis and the surviving training data.

The MPS smoke test (formerly Stage 2) and doc detector training (formerly
Stage 3) are permanently skipped. Document segmentation at runtime uses
`VNDetectDocumentSegmentationRequest` (iOS) and the bundled DocAligner
`lcnet100` TFLite model (Android) — see
[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md).

### Step 5: Verify outputs

```bash
ls -lh models/
```

Expected outputs after a successful run:

```
models/
  nanodet_field_416.tflite         # NanoDet field detector (LiteRT/TFLite, fp32, ~4.99 MB)
  version.json                     # Measured mAP, export metadata, model facts
```

The single `.tflite` is loaded in JS via react-native-fast-tflite on both
platforms; there is no per-platform Core ML / native-TFLite split anymore. A
3×-smaller dynamic-int8 variant is produced under
`model-training/nanodet/export_tflite/` but is not shipped (validate on-device
first).

Note: no self-trained `DlScanDocDetector.mlmodelc` or
`dl_scan_doc_detector.tflite` is produced by this pipeline. At runtime, iOS
document segmentation uses `VNDetectDocumentSegmentationRequest` (a platform
vendor API, not bundled), and Android uses the pre-trained, third-party
DocAligner `lcnet100` TFLite model, which IS bundled with this package at
`android/src/main/assets/docaligner_lcnet100.tflite` but is not generated by
this training pipeline.

`version.json` is the authoritative source for all measured metrics. The
`<TBD>` placeholders in [EVALUATION.md](EVALUATION.md) should be updated
from this file after training completes.

### Step 6: Run the test suite

```bash
# Verify the JS/TS test suite still passes (should not be affected by training)
yarn test

# Verify the C++ parser tests still pass
yarn test:cpp

# Verify TypeScript types
yarn typecheck

# Verify linting
yarn lint
```

---

## Running Individual Stages

Each script supports `--dry-run` to preview what it would do without
modifying any data:

```bash
source model-training/.venv/bin/activate

# Preview data extraction
python model-training/idnet/extract_subsets.py --dry-run

# Preview OBB dataset preparation
python model-training/idnet/prepare_yolo_obb.py --dry-run

# Preview doc detector training
python model-training/train_doc_detector.py --dry-run

# Preview export
python model-training/export/export_doc_detector.py --dry-run
```

All scripts are resume-friendly — re-running after a partial failure skips
already-completed work.

---

## Random Seeds

For reference, all fixed seeds used in the pipeline:

| Stage | Seed |
|---|---|
| Stratified subset extraction | 42 |
| Train/val/test split | 42 |
| YOLO-fields → COCO conversion | 42 (split inherited from `prepare_yolo_fields.py`) |
| NanoDet field detector training | per `configs/dlscan-nanodet-plus-m_416.yml` |

---

## Reproducing on CUDA (non-Apple hardware)

To reproduce on a CUDA GPU, make the following changes:

1. In the NanoDet training env (`model-training/envs/nanodet/`), replace the
   `torch` pin with the appropriate CUDA wheel index for your driver. (The
   NanoDet torch-2 MPS patches in `model-training/nanodet/PATCHES.md` — the
   `torch._six` shim and the DFL `Integral` matmul→multiply-sum rewrite — are
   MPS workarounds and are not needed on CUDA.)
2. Set the NanoDet config's `device.gpu_ids` to your CUDA device and run
   `model-training/nanodet/train_nanodet.py` with the 416 config.
3. If you also want to train the (dropped) OBB doc detector on CUDA, the
   `smoke_test_obb.py` MPS smoke test is not needed — the MPS-OBB correctness
   bug does not affect CUDA.

**Expected outcome:** functionally equivalent field detector with ~1–2% mAP
variance due to CUDA vs. MPS numerical differences.

---

## Troubleshooting

### `tensorflow-macos` import fails

Verify you are using Python 3.11 or 3.12 (not 3.13+) and that you are on
Apple Silicon macOS 14+.

### MPS OBB smoke test

The smoke test script (`smoke_test_obb.py`) is preserved in the repo but is no
longer invoked by `run_full_pipeline.sh`. The MPS-OBB correctness bug it
detects caused us to drop the doc detector entirely. If you run the smoke test
manually, a FAIL result (KL divergence >0.10) confirms the documented
Ultralytics issues [#10181](https://github.com/ultralytics/ultralytics/issues/10181)
and [#13081](https://github.com/ultralytics/ultralytics/issues/13081) on your
current PyTorch + macOS combination.

### Out-of-memory during doc detector training

Reduce batch size: edit `train_doc_detector.py` and decrease `batch=128` to
`batch=64` or `batch=32`. Do not enable `cache='ram'` on any system with
less than ~300 GB of RAM dedicated to Python.

### Thermal throttling

Monitor with:
```bash
sudo powermetrics --samplers smc,gpu_power,thermal -i 1000
```
If GPU power drops from ~200W to ~140W after 30 minutes, ensure adequate
airflow around the machine. A sudden drop in training throughput is the
primary symptom.
