# Model Card: react-native-dl-scan On-Device ML Models

This card covers the two trained on-device machine learning models bundled with
`react-native-dl-scan`, plus the platform-vendor APIs used for document
segmentation. Trained models run on fully synthetic data and are designed for
real-time inference on iOS and Android mobile devices.

For the full dataset provenance and ethics statement see [DATA_CARD.md](DATA_CARD.md).
For training procedure and hyperparameters see [TRAINING_DETAILS.md](TRAINING_DETAILS.md).
For evaluation methodology and results see [EVALUATION.md](EVALUATION.md).
For known failure modes and jurisdictions not covered see [LIMITATIONS.md](LIMITATIONS.md).
For the architectural decision that dropped the doc detector see [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md).

---

## Model Details

| Property | Value |
|---|---|
| Model family | `react-native-dl-scan` v0.x |
| Trained sub-models | DlScanFieldDetector; DocAligner (Android only) |
| Doc segmentation | Apple Vision `VNDetectDocumentSegmentationRequest` on iOS (vendor); DocAligner `lcnet100` TFLite FP16 on Android (bundled — Android has no equivalent free Vision API for corner-based rectification, see [ADR 001](ARCHITECTURE_DECISIONS.md)) |
| Training date | `<TBD: filled post-training from models/version.json>` |
| Model version | `<TBD: see models/version.json>` |
| Training framework | PyTorch 2.6+ / Ultralytics ≥8.3.0 (field detector) |
| Export formats | Core ML (iOS, weight-only int8); TFLite (Android, full int8) |
| License (code) | MIT |
| License (model weights) | Apache 2.0 (see [License](#license) section) |
| Contact | Shannon Hicks — https://github.com/iotashan/react-native-dl-scan |

### Trained sub-model summary

| Model | Architecture | Task | Input | Output |
|---|---|---|---|---|
| `DlScanFieldDetector` | YOLOv8n (axis-aligned) | Locate individual text fields on a rectified document crop | 640×640 RGB | Per-field bounding boxes |

---

## Document Segmentation (Platform-Vendor)

Document segmentation — detecting the ID card in the camera frame and producing
the corner points needed to rectify it — is handled by platform-vendor APIs
rather than a bundled trained model.

| Platform | API | Notes |
|---|---|---|
| iOS | [`VNDetectDocumentSegmentationRequest`](https://developer.apple.com/documentation/vision/vndetectdocumentsegmentationrequest) | Apple Vision framework; iOS 15+; ANE-accelerated |
| Android | [ML Kit Document Scanner](https://developers.google.com/ml-kit/vision/doc-scanner) (`com.google.mlkit.vision.documentscanner`) | Play Services-backed; ANE-friendly |

### Rationale

A trained YOLOv8n-OBB document detector was originally planned for this role.
Training was abandoned after the MPS smoke test revealed a silent correctness
bug (KL divergence on predicted angle distribution > 0.10) matching the
documented Ultralytics MPS-OBB issues
[#10181](https://github.com/ultralytics/ultralytics/issues/10181) and
[#13081](https://github.com/ultralytics/ultralytics/issues/13081). With no
cloud compute available, the vendor API path was chosen instead.

Benefits of the vendor approach:

- Both APIs are ANE-accelerated with no bundle-size cost.
- Apple and Google maintain and improve these APIs independently; accuracy
  typically exceeds what a small bundled model would achieve.
- No OBB NMS implementation required in Swift/Kotlin consumer wrappers.
- Bundle size is ~2 MB smaller (no `.mlmodelc` / `.tflite` doc detector files).

The full architectural decision record is in
[docs/ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md).

---

## Intended Use

### In scope

- Real-time, on-device scanning of US driver's licenses and state ID cards
  from the 10 jurisdictions covered by the IDNet training data (AZ, CA, DC,
  NV, NC, PA, SD, UT, WV, WI). The field detector covers all 20 trained doc
  types; document segmentation accuracy for each jurisdiction depends on the
  platform vendor API, which we do not control.
- Real-time, on-device scanning of international identity documents from the
  10 non-US jurisdictions covered (ALB, AZE, ESP, EST, FIN, GRC, LVA, RUS,
  SRB, SVK).
- ICAO 9303 Machine Readable Zone (TD1/TD2/TD3) parsing for passports and
  travel documents — handled by the C++ MRZ parser, not by these ML models.
- Integration into iOS and Android mobile applications via the
  `react-native-dl-scan` npm package.

### Out of scope

**These models are NOT certified for KYC, AML, identity fraud detection, or
any regulatory compliance use case.** Accuracy claims derived from held-out
synthetic test data cannot substitute for real-world compliance validation.

Do not use these models as the sole basis for legal identification decisions.

Additional out-of-scope uses:

- Jurisdictions not in the training set (40 US states, all Canadian
  provinces, most international documents — see [LIMITATIONS.md](LIMITATIONS.md)).
- Fraud or forgery detection. The training data includes synthetic fraud
  variants for geometric augmentation only; the models are not trained to
  classify genuine vs. fraudulent documents.
- Server-side or batch inference. These models are quantized for on-device
  mobile inference; their accuracy on server-side float32 inference pipelines
  is not characterized.

---

## Training Data

Training data is the IDNet dataset (Hugging Face `cactuslab/IDNet-2025`),
a fully synthetic identity document corpus. All data is computer-generated;
no real personally identifiable information is present anywhere in the
training pipeline.

Full provenance, splits, license, and ethics statement: [DATA_CARD.md](DATA_CARD.md).

---

## Training Procedure

Single-node training on an Apple Mac Studio M3 Ultra (2025), 256 GB unified
memory, macOS 26.4. No cloud compute. No distributed training.

Full hardware specification, software versions, hyperparameters, random seeds,
and quantization rationale: [TRAINING_DETAILS.md](TRAINING_DETAILS.md).

---

## Evaluation Results

All models are evaluated on a held-out 10% test split stratified by document
type, never seen during training or validation. Quantization regression testing
verifies that int8 mAP is within 1% absolute of the FP32 baseline.

Full methodology and per-jurisdiction breakdown: [EVALUATION.md](EVALUATION.md).

### Summary metrics (placeholders — filled post-training)

| Model | Metric | FP32 | int8 (quantized) |
|---|---|---|---|
| DlScanFieldDetector | mAP@0.5 | `<TBD: see models/version.json>` | `<TBD: see models/version.json>` |
| Document segmentation | — | Vendor-evaluated (Apple / Google) | — |

Target thresholds based on IDNet paper baselines:

- Field detector: ≥0.85 mAP@0.5 (FP32); ≥0.84 mAP@0.5 (int8)
- Document segmentation: vendor-evaluated; not benchmarked separately by this project

---

## Limitations and Bias

See [LIMITATIONS.md](LIMITATIONS.md) for the full statement. Summary:

- Coverage limited to 10 US states and 10 international document types.
- Training data is fully synthetic; real-world photographic conditions (glare,
  motion blur, extreme angles, partial occlusion) are not fully represented.
- v1 does not apply an ML model to correct per-character OCR errors from
  platform-vendor OCR. A Keras disambiguation model was attempted and failed;
  see [`model-training/idnet/DISAMBIG_POSTMORTEM.md`](../model-training/idnet/DISAMBIG_POSTMORTEM.md).
- Models are not evaluated against real identity documents due to privacy
  constraints. All test metrics are synthetic.

---

## Carbon Footprint

Training hardware: Apple Mac Studio M3 Ultra (2025).  
Approximate thermal design power (TDP): ~285 W (GPU + CPU + Neural Engine combined peak).  
Estimated total training wall time: ~25 hours (one-time cost; doc detector
training was skipped — see [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)).  
US average grid carbon intensity: ~0.4 kg CO₂/kWh.

**Estimated one-time training carbon cost: ~3 kg CO₂**
(285 W × 25 h × 0.4 kg CO₂/kWh × 10⁻³ ≈ 2.85 kg CO₂, rounded to ~3 kg)

This is roughly half the original ~5.7 kg CO₂ estimate, because the ~25 hours
of doc detector training (Stage 3) was eliminated in favour of vendor APIs.

On-device inference carbon cost: negligible — the Neural Engine on A-series
and M-series chips runs these model sizes in single-digit milliseconds with
sub-100 mW power draw per inference.

---

## Citation

If these models are useful in academic work, please cite both the IDNet dataset
and this repository.

### IDNet dataset (primary training data)

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

### This repository

```bibtex
@software{hicks2025dlscan,
  title   = {react-native-dl-scan: On-Device Driver's License Scanning for React Native},
  author  = {Hicks, Shannon},
  year    = {2025},
  url     = {https://github.com/iotashan/react-native-dl-scan},
  license = {MIT}
}
```

---

## License

**Code** (npm package, training scripts, C++ parser): MIT. See [LICENSE](../LICENSE).

**Model weights** (`DlScanFieldDetector`): Apache 2.0.

Rationale for Apache 2.0 for weights:
- Apache 2.0 is OSS-community-friendly and commercially permissive.
- It is compatible with the CC-BY-4.0 license of the IDNet training data
  (attribution is provided in this model card and in [DATA_CARD.md](DATA_CARD.md)).
- It is compatible with the MIT license of the surrounding code.
- The explicit patent grant in Apache 2.0 provides additional clarity for
  downstream commercial use.

**Document segmentation** (VisionKit / ML Kit): These are platform-vendor
APIs. Apple's `VNDetectDocumentSegmentationRequest` is governed by the Apple
SDK license; ML Kit Document Scanner is governed by Google's ML Kit Terms of
Service. Neither is bundled with this package.

**Note:** IDNet is licensed CC-BY-4.0. Models derived by training on
CC-BY-4.0 data inherit an attribution requirement. The attribution provided
in this card and in DATA_CARD.md satisfies that requirement. If you
redistribute model weights, you must preserve this attribution.
