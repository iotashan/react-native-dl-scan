# Data Card: IDNet Training Dataset

This card documents the training data used to develop the ML models in
`react-native-dl-scan`. It follows the Google Data Cards format and the
Hugging Face dataset card specification.

---

## Dataset Identification

| Property | Value |
|---|---|
| Dataset name | IDNet (IDNet-2025 edition) |
| Hugging Face repository | [`cactuslab/IDNet-2025`](https://huggingface.co/datasets/cactuslab/IDNet-2025) |
| Zenodo archive | https://zenodo.org/records/13852734 (and related DOIs) |
| Paper (conference) | Guan et al., "IDNet: A Novel Dataset for Identity Document Analysis and Fraud Detection," *IEEE BigData 2024* |
| Paper (preprint) | arXiv:2408.01690 — https://arxiv.org/abs/2408.01690 |
| Dataset license | CC-BY-4.0 (Hugging Face / cactuslab); CC0 (Zenodo archive) |
| Data type | Fully synthetic identity document images (JPEG) + per-image field metadata (JSON) |

---

## Privacy and Ethics

**All data in IDNet is computer-generated. No real personally identifiable
information (PII) is present in any training, validation, or test sample.**

The synthetic ID images are generated from procedural templates using
algorithmically-generated placeholder names, addresses, dates, and document
numbers. No real individuals are represented.

The "fraud variant" subdirectories (`fraud5_inpaint_and_rewrite`,
`fraud6_crop_and_replace`) contain synthetic textual mutations applied to
synthetic documents. These are not real fraudulent documents and do not
represent any attempt to create or distribute counterfeit identity materials.
Fraud variants are included in training to increase geometric diversity;
fraud detection is explicitly out of scope for these models.

The OCR pair generation step applies Apple VisionKit text recognition to
synthetic images. No real-world images are processed.

**Note on OBB labels:** The `prepare_yolo_obb.py` script generates oriented
bounding-box (OBB) labels for all 20 document types. These labels are
preserved in the pipeline scaffolding (`model-training/idnet/prepare_yolo_obb.py`)
but are not trained against in the current pipeline — the YOLOv8n-OBB doc
detector was dropped after the MPS smoke test failure (see
[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)). If a future
contributor wants to train an OBB model (e.g., on a CUDA instance), the OBB
labels are ready to use without regeneration.

---

## Dataset Composition

### Document types

The IDNet dataset covers 20 document types across two geographic groups:

**US state driver's licenses / ID cards (10 types):**

| Short code | Doc type label | Notes |
|---|---|---|
| AZ | `us_arizona_dl` | |
| CA | `us_california_dl` | |
| DC | `us_dc_dl` | District of Columbia |
| NC | `us_north_carolina_dl` | |
| NV | `us_nevada_dl` | |
| PA | `us_pennsylvania_dl` | |
| SD | `us_south_dakota_dl` | |
| UT | `us_utah_dl` | |
| WI | `us_wisconsin_dl` | See known issues below |
| WV | `us_west_virginia_dl` | |

**European / international identity cards (10 types):**

| Short code | Doc type label | Country |
|---|---|---|
| ALB | `albania_id` | Albania |
| AZE | `azerbaijan_id` | Azerbaijan |
| ESP | `spain_id` | Spain |
| EST | `estonia_id` | Estonia |
| FIN | `finland_id` | Finland |
| GRC | `greece_id` | Greece |
| LVA | `latvia_id` | Latvia |
| RUS | `russia_id` | Russia |
| SRB | `serbia_id` | Serbia |
| SVK | `slovakia_id` | Slovakia |

### Sub-directories per document type

Each document type ZIP contains three subdirectories:

| Subdirectory | Contents | Approx. count per type |
|---|---|---|
| `positive/` | Clean synthetic IDs | ~6,000 images |
| `fraud5_inpaint_and_rewrite/` | Synthetic textual mutations (inpaint + rewrite) | ~12,000 images |
| `fraud6_crop_and_replace/` | Synthetic textual mutations (crop + replace) | ~13,000 images |

**Total original IDNet dataset:** ~837,000 samples (per the IDNet paper).

### Realized training subset

The `extract_subsets.py` script draws up to **25,000 samples per document type**
from the three subdirectories above using stratified random selection with
seed 42. Fraud variants are included by default because they have identical
geometric layout to positives (same corner coordinates, same field bounding
boxes) and increase the effective training set size at no cost to geometric
accuracy.

**Realized subset size:** ~358,000–525,000 samples across 20 document types
(exact count depends on available samples per type after filtering; see
`extract_subsets.py` output for the authoritative count).

---

## Data Splits

| Split | Fraction | Use |
|---|---|---|
| Train | 80% | Model training |
| Validation | 10% | Hyperparameter selection and early stopping |
| Test | 10% | Held-out evaluation (never seen during training) |

Splits are stratified by document type. Random seed: **42**.

The train/val/test split is applied by `prepare_yolo_obb.py` and
`prepare_yolo_fields.py`; the same split boundary files are reused for all
three models so the test set is identical across models.

---

## Known Issues and Preprocessing Notes

### PNG images with .jpg file extensions (9 of 10 US types)

Nine of the ten US document-type ZIP files contain images that are actually
PNG-encoded but carry `.jpg` file extensions. Older versions of the data
preparation script treated these as corrupt and skipped them, discarding
approximately 40% of images from those types.

The current `extract_subsets.py` detects the actual file format via magic
bytes and handles them correctly. If you use a different data loading pipeline,
verify that you are not silently discarding these PNG-disguised-as-JPEG files.

### Wisconsin DL: extraneous image file

The `us_wisconsin_dl/` directory contains at least one file matching the
pattern `generated.photos_v3_*.jpg` that appears to originate from a
separate photo-ID dataset rather than the IDNet synthetic generator. This
file was filtered out before extraction using filename pattern matching in
`extract_subsets.py`. If you reproduce the pipeline with a different
extraction script, apply an equivalent filter.

### No geometric background variation in IDNet

IDNet positive and fraud images ARE the document — the entire raster is the
identity card with no camera background. For the document detector, this means
the model learns document type classification and orientation from the card
content, but sees no variation in perspective, scale, occlusion, or background
clutter during training.

Real-world camera frames will contain a document floating in a varied
background. Data augmentation (random crop, affine, color jitter, mosaic —
all enabled in the YOLO training config) partially compensates, but
performance on documents at extreme angles or with significant background
complexity may be lower than held-out test metrics suggest.

---

## Dataset Access

### Hugging Face

```
Dataset: cactuslab/IDNet-2025
URL:     https://huggingface.co/datasets/cactuslab/IDNet-2025
License: CC-BY-4.0
```

### Zenodo

```
Primary record: https://zenodo.org/records/13852734
License:        CC0
Format:         ZIP archives, one per document type (~388 GB total)
```

The local download manifest used in this project is at:
```
/Volumes/Work4TB/dev/iotashan/idnet-data/manifest.tsv
```
This file contains file names, byte sizes, and MD5 checksums for all 20 ZIP
archives. It is the canonical reference for verifying download integrity.

To download IDNet (~388 GB, approximately 12 hours on a fast connection), use
`huggingface-hub` or the Zenodo download API. See
[REPRODUCIBILITY.md](REPRODUCIBILITY.md) for the exact download commands.

---

## Citation

If you use IDNet in your work, please cite both the conference paper and the
preprint:

```bibtex
@inproceedings{guan2024idnet,
  title     = {{IDNet}: A Novel Dataset for Identity Document Analysis and Fraud Detection},
  author    = {Guan, Bingyu and Coleman, Sriram and Bhanu, Bir and others},
  booktitle = {2024 IEEE International Conference on Big Data (BigData)},
  year      = {2024},
  publisher = {IEEE},
  note      = {arXiv preprint arXiv:2408.01690}
}
```

```bibtex
@misc{guan2024idnetpreprint,
  title         = {{IDNet}: A Novel Dataset for Identity Document Analysis and Fraud Detection},
  author        = {Guan, Bingyu and Coleman, Sriram and Bhanu, Bir and others},
  year          = {2024},
  eprint        = {2408.01690},
  archivePrefix = {arXiv},
  primaryClass  = {cs.CV},
  url           = {https://arxiv.org/abs/2408.01690}
}
```

---

## License and Attribution

**Dataset license:** CC-BY-4.0 (Hugging Face / cactuslab), CC0 (Zenodo).

The CC-BY-4.0 license requires attribution when the dataset (or derivatives
such as trained model weights) is redistributed. Attribution is provided
in this data card, in [MODEL_CARD.md](MODEL_CARD.md), and in
[CITATION.cff](../CITATION.cff).

Model weights trained on CC-BY-4.0 data are distributed under Apache 2.0,
which is compatible with the CC-BY-4.0 attribution requirement. See
[MODEL_CARD.md](MODEL_CARD.md) for the license rationale.
