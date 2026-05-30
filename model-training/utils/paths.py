"""
Canonical paths for the react-native-dl-scan training pipeline.

All scripts import from here — never hard-code paths elsewhere.

The dataset lives wherever you downloaded it. Point the pipeline at it with
the ``IDNET_DATA_ROOT`` environment variable, e.g.::

    export IDNET_DATA_ROOT=/path/to/idnet-data

If unset, it defaults to ``./idnet-data`` (relative to the current working
directory) so the repo carries no machine-specific absolute path.
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Dataset root — configurable via the IDNET_DATA_ROOT environment variable.
# ---------------------------------------------------------------------------

# Override with `export IDNET_DATA_ROOT=/path/to/idnet-data`. The documented
# default is a relative `./idnet-data` so nothing machine-specific is baked in.
IDNET_DATA_ROOT = Path(os.environ.get('IDNET_DATA_ROOT', 'idnet-data'))

# ---------------------------------------------------------------------------
# IDNet source data (downloaded; do NOT modify)
# ---------------------------------------------------------------------------

# 20 .zip files, 388 GB total, md5-verified.
IDNET_ZIPS = IDNET_DATA_ROOT / 'zips'

# TSV columns: record_id, filename, size_bytes, md5, url
IDNET_MANIFEST = IDNET_DATA_ROOT / 'manifest.tsv'

# ---------------------------------------------------------------------------
# Extracted / derived data (created by pipeline scripts)
# ---------------------------------------------------------------------------

# Stratified 525K JPEGs + per-image .json metadata.
# Layout: EXTRACTED_ROOT/<doc_type>/<sample_id>.jpg  (+ .json)
EXTRACTED_ROOT = IDNET_DATA_ROOT / 'extracted'

# YOLO OBB dataset root (created by prepare_yolo_obb.py).
# Layout: {images,labels}/<sample_id>.{jpg,txt}  +  data.yaml
YOLO_OBB_ROOT = IDNET_DATA_ROOT / 'yolo_doc_obb'

# YOLO axis-aligned field dataset root (created by prepare_yolo_fields.py).
# Layout: {images,labels}/<sample_id>.{jpg,txt}  +  data.yaml
YOLO_FIELDS_ROOT = IDNET_DATA_ROOT / 'yolo_fields'

# ---------------------------------------------------------------------------
# Training runs + checkpoints  (gitignored in model-training/.gitignore)
# ---------------------------------------------------------------------------

# All Ultralytics + Keras training artefacts land under RUNS_ROOT.
RUNS_ROOT = Path(__file__).resolve().parent.parent / 'runs'

# ---------------------------------------------------------------------------
# Output models (to be committed via Git LFS after export)
# ---------------------------------------------------------------------------

MODELS_OUTPUT = Path(__file__).resolve().parent.parent.parent / 'models'

# ---------------------------------------------------------------------------
# OCR pairs for disambig training (created by render_ocr_pairs.py)
# ---------------------------------------------------------------------------

OCR_PAIRS_PATH = IDNET_DATA_ROOT / 'ocr_pairs.jsonl'
