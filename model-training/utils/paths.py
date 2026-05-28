"""
Canonical paths for the react-native-dl-scan training pipeline.

All scripts import from here — never hard-code paths elsewhere.
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# IDNet source data (downloaded; do NOT modify)
# ---------------------------------------------------------------------------

# 20 .zip files, 388 GB total, md5-verified.
IDNET_ZIPS = Path('/Volumes/Work4TB/dev/iotashan/idnet-data/zips')

# TSV columns: record_id, filename, size_bytes, md5, url
IDNET_MANIFEST = Path('/Volumes/Work4TB/dev/iotashan/idnet-data/manifest.tsv')

# ---------------------------------------------------------------------------
# Extracted / derived data (created by pipeline scripts)
# ---------------------------------------------------------------------------

# Stratified 525K JPEGs + per-image .json metadata.
# Layout: EXTRACTED_ROOT/<doc_type>/<sample_id>.jpg  (+ .json)
EXTRACTED_ROOT = Path('/Volumes/Work4TB/dev/iotashan/idnet-data/extracted')

# YOLO OBB dataset root (created by prepare_yolo_obb.py).
# Layout: {images,labels}/<sample_id>.{jpg,txt}  +  data.yaml
YOLO_OBB_ROOT = Path('/Volumes/Work4TB/dev/iotashan/idnet-data/yolo_doc_obb')

# YOLO axis-aligned field dataset root (created by prepare_yolo_fields.py).
# Layout: {images,labels}/<sample_id>.{jpg,txt}  +  data.yaml
YOLO_FIELDS_ROOT = Path('/Volumes/Work4TB/dev/iotashan/idnet-data/yolo_fields')

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

OCR_PAIRS_PATH = Path('/Volumes/Work4TB/dev/iotashan/idnet-data/ocr_pairs.jsonl')
