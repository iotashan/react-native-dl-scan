# Evaluation

This document describes the held-out test methodology for the trained ML
model in `react-native-dl-scan` (`DlScanFieldDetector`) and provides
placeholder metrics filled post-training by
`model-training/export/validate_quantization.py`.

Document segmentation (the step that locates the card in the camera frame) is
handled by platform-vendor APIs. See the
[Document Segmentation Evaluation](#document-segmentation-evaluation-vendor-apis)
section for details.

---

## Test Set Construction

The test set is the **held-out 10% split** drawn during dataset preparation:

- Stratified by document type (equal representation of all 20 doc types in the
  test set relative to their frequency in the full subset).
- Random seed: 42.
- **Never seen during training or validation.**
- The same split boundary (sample IDs) is shared across all training stages.

Test set size: `<TBD: exact count from prepare_yolo_obb.py output>` images.

All test images are synthetic (from IDNet). No real identity documents are
included in any evaluation.

---

## Metrics

### DlScanFieldDetector

Primary metric: **mAP@0.5** over all field classes on rectified 640×640 crops.

Additional reported metrics:

| Metric | Description |
|---|---|
| mAP@0.5 | Primary metric. FP32 and int8. |
| Per-field AP@0.5 | Per-field-class breakdown. |
| Recall@0.5 | Field detection recall (important for OCR coverage). |

---

## Target Thresholds

Targets are based on IDNet paper baselines and adjusted for int8 quantization:

| Model | Metric | FP32 target | int8 target |
|---|---|---|---|
| DlScanFieldDetector | mAP@0.5 | ≥0.85 | ≥0.84 |

Quantization regression gate: **int8 mAP must be within 1% absolute of FP32
baseline**. This gate is enforced by `validate_quantization.py`; the pipeline
fails if the threshold is not met.

---

## Results (Placeholders)

All metrics below are filled post-training by `validate_quantization.py`.
The authoritative source for all measured numbers is **`models/version.json`**.

### DlScanFieldDetector

| Metric | FP32 | Core ML int8 | TFLite int8 |
|---|---|---|---|
| mAP@0.5 (overall) | 0.9950 | 0.9950 | 0.9554 |
| Recall@0.5 | 1.0000 | 1.0000 | 0.9962 |
| Quantization delta vs FP32 | — | 0.000 (within tolerance — head-protected weight-only int8) | 0.040 (full-int8; flagged but within product tolerance) |

#### Per-field AP@0.5 (FP32) — selected fields

| Field class | AP@0.5 |
|---|---|
| First name | `<TBD>` |
| Last name | `<TBD>` |
| Date of birth | `<TBD>` |
| License number | `<TBD>` |
| Expiration date | `<TBD>` |
| Address | `<TBD>` |
| Sex | `<TBD>` |
| Eye color | `<TBD>` |
| Height | `<TBD>` |
| Vehicle class | `<TBD>` |
| (full list from data.yaml) | `<TBD>` |

---

## Document Segmentation Evaluation (Vendor APIs)

Document segmentation — detecting the ID card in the camera frame and
computing the rectification corners — is performed by platform-vendor APIs:

- **iOS:** `VNDetectDocumentSegmentationRequest` (Apple Vision framework)
- **Android:** ML Kit Document Scanner (`com.google.mlkit.vision.documentscanner`)

We do not run our own benchmarks against these APIs. Apple and Google publish
their own quality assessments; accuracy is expected to vary by lighting, viewing
angle, and document contrast against the background (see
[LIMITATIONS.md](LIMITATIONS.md) for the failure mode description).

If the vendor API fails to detect the document (e.g., extreme angle or poor
lighting), the field detector is not invoked. The runtime surfaces this as
a `null` result to the JavaScript layer, which the calling application
should handle by prompting the user to reposition the card.

---

## Filling These Metrics Post-Training

After a successful training and export run:

```bash
source model-training/.venv/bin/activate
python model-training/export/validate_quantization.py
```

`validate_quantization.py` writes measured mAP, quantization deltas, and
model metadata to `models/version.json`. The `<TBD>` placeholders in this
file should be updated from that JSON after training is complete.

For Core ML (iOS) models, on-device validation against the test set on a
physical iPhone is required to obtain reliable mAP estimates. macOS-side
Core ML inference does not exercise the Neural Engine path.

---

## Evaluation Caveats

- All evaluation is performed on **synthetic** test data. Real-world
  performance on physical identity documents may differ.
- Core ML mAP reported here is estimated from macOS inference; actual on-device
  Neural Engine results should be validated separately.
- Platform-vendor OCR (VisionKit on iOS, ML Kit on Android) produces
  systematic per-character substitution errors that this package does not
  attempt to correct with an ML model in v1. See
  [`model-training/idnet/DISAMBIG_POSTMORTEM.md`](../model-training/idnet/DISAMBIG_POSTMORTEM.md)
  for why a Keras disambiguation model was tried, why it failed, and what
  would need to change for any future attempt.

For a full discussion of known failure modes see [LIMITATIONS.md](LIMITATIONS.md).
