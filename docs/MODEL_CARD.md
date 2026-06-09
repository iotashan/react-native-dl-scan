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
| Trained sub-models | DLScanFieldDetector; DocAligner (Android only) |
| Doc segmentation | Apple Vision `VNDetectDocumentSegmentationRequest` on iOS (vendor); DocAligner `lcnet100` TFLite FP16 on Android (bundled — Android has no equivalent free Vision API for corner-based rectification, see [ADR 001](ARCHITECTURE_DECISIONS.md)) |
| Training date | 2026-05-30 |
| Model version | NanoDet-Plus-m field detector (`nanodet_field_416.tflite`) |
| Training framework | [RangiLyu/nanodet](https://github.com/RangiLyu/nanodet) (Apache-2.0), PyTorch on Apple M3 Ultra MPS (field detector) |
| Export formats | LiteRT / TFLite via [litert-torch](https://github.com/google-ai-edge/ai-edge-torch) (fp32 default; a dynamic-int8 variant exists but is not shipped) |
| License (code) | MIT |
| License (model weights) | Apache 2.0 (see [License](#license) section) |
| Contact | Shannon Hicks — https://github.com/iotashan/react-native-dl-scan |

### Trained sub-model summary

| Model | Architecture | Task | Input | Output |
|---|---|---|---|---|
| `DLScanFieldDetector` (NanoDet) | NanoDet-Plus-m (ShuffleNetV2 1.0x + GhostPAN + GFL/DFL head, reg_max=7) | Locate individual text fields on a rectified document crop | 416×416 NHWC RGB8 | `[1, 3598, 62]` anchor-major (30 sigmoid class scores + 4×8 DFL logits) |

---

## Document Segmentation (Platform-Vendor)

Document segmentation — detecting the ID card in the camera frame and producing
the corner points needed to rectify it — uses a platform-vendor API on iOS and
a bundled trained model on Android (Android has no equivalent free Vision API
for corner-based rectification).

| Platform | Method | Notes |
|---|---|---|
| iOS | [`VNDetectDocumentSegmentationRequest`](https://developer.apple.com/documentation/vision/vndetectdocumentsegmentationrequest) | Apple Vision framework (vendor, not bundled); iOS 15+; ANE-accelerated |
| Android | DocAligner `lcnet100` TFLite FP16 (`android/src/main/assets/docaligner_lcnet100.tflite`, ~2.4 MB) | Bundled trained model loaded at runtime; Apache-2.0 from [DocsaidLab](https://github.com/DocsaidLab/DocAligner). See [THIRD_PARTY_MODELS.md](THIRD_PARTY_MODELS.md) |

### Rationale

A trained YOLOv8n-OBB document detector was originally planned for this role.
Training was abandoned after the MPS smoke test revealed a silent correctness
bug (KL divergence on predicted angle distribution > 0.10) matching the
documented Ultralytics MPS-OBB issues
[#10181](https://github.com/ultralytics/ultralytics/issues/10181) and
[#13081](https://github.com/ultralytics/ultralytics/issues/13081). With no
cloud compute available, Apple's Vision API was chosen on iOS, and the
pre-trained DocAligner `lcnet100` TFLite model was bundled on Android (Android
has no equivalent free Vision API for corner-based rectification).

Benefits of this approach:

- On iOS, the Apple Vision API is ANE-accelerated with no bundle-size cost.
- On Android, the bundled DocAligner model (~2.4 MB) is a small, pre-trained
  TFLite model — far cheaper to ship than training and bundling our own
  OBB doc detector, and Apple/DocsaidLab maintain these independently.
- No OBB NMS implementation required in Swift/Kotlin consumer wrappers.
- No custom doc-detector training was needed (Stage 3 training was eliminated).

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
a fully synthetic identity document corpus. The NanoDet field detector was
trained in COCO format on 95,490 train / 12,055 val images. All data is
computer-generated; no real personally identifiable information is present
anywhere in the training pipeline.

Full provenance, splits, license, and ethics statement: [DATA_CARD.md](DATA_CARD.md).

---

## Training Procedure

Single-node training on an Apple Mac Studio M3 Ultra (2025), 256 GB unified
memory, macOS 26.4. No cloud compute. No distributed training.

Full hardware specification, software versions, hyperparameters, random seeds,
and quantization rationale: [TRAINING_DETAILS.md](TRAINING_DETAILS.md).

---

## Evaluation Results

The NanoDet field detector is evaluated on the IDNet validation split (12,055
images), never seen during training. The shipped `nanodet_field_416.tflite` is
fp32; a dynamic-int8 variant exists but is not shipped and requires on-device
accuracy validation before use.

Full methodology and per-jurisdiction breakdown: [EVALUATION.md](EVALUATION.md).

### Summary metrics

Evaluated on the held-out synthetic validation split (see [EVALUATION.md](EVALUATION.md)).
Source of record: [`models/version.json`](../models/version.json).

| Model | Metric | Value (fp32 .tflite) |
|---|---|---|
| DLScanFieldDetector (NanoDet) | mAP@0.5:0.95 | 0.967 |
| DLScanFieldDetector (NanoDet) | AP@0.5 | 0.9996 |
| DLScanFieldDetector (NanoDet) | AP@0.75 | 0.994 |
| Document segmentation | — | iOS: Apple Vision (vendor-evaluated) · Android: DocAligner (bundled) |

Target thresholds based on IDNet paper baselines:

- Field detector: ≥0.85 mAP@0.5 — comfortably exceeded (AP@0.5 = 0.9996)
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
  author    = {Guan, Hong and Wang, Yancheng and Xie, Lulu and Nag, Soham and Goel, Rajeev and Erappa Narayana Swamy, Niranjan and Yang, Yingzhen and Xiao, Chaowei and Prisby, Jonathan and Maciejewski, Ross and Zou, Jia},
  booktitle = {2024 IEEE International Conference on Big Data (BigData)},
  year      = {2024},
  publisher = {IEEE},
  note      = {arXiv preprint arXiv:2408.01690}
}
```

```bibtex
@misc{guan2024idnetpreprint,
  title         = {{IDNet}: A Novel Dataset for Identity Document Analysis and Fraud Detection},
  author        = {Guan, Hong and Wang, Yancheng and Xie, Lulu and Nag, Soham and Goel, Rajeev and Erappa Narayana Swamy, Niranjan and Yang, Yingzhen and Xiao, Chaowei and Prisby, Jonathan and Maciejewski, Ross and Zou, Jia},
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

**Model weights** (`DLScanFieldDetector`, NanoDet-Plus-m): Apache 2.0.

Rationale for Apache 2.0 for weights:
- The field detector is **fully Apache-2.0**: the NanoDet-Plus-m architecture,
  the [RangiLyu/nanodet](https://github.com/RangiLyu/nanodet) training code, and
  the trained weights are all Apache/permissive.
- This **eliminates the prior AGPL ambiguity**. The detector was previously
  YOLOv8n trained and exported with Ultralytics, whose AGPL-3.0 license
  arguably attached to the YOLO-derived weights. NanoDet shares none of that
  lineage, so there is **no longer any AGPL-licensed dependency anywhere in the
  field-detection path**.
- Apache 2.0 is OSS-community-friendly and commercially permissive.
- It is compatible with the CC-BY-4.0 license of the IDNet training data
  (attribution is provided in this model card and in [DATA_CARD.md](DATA_CARD.md)).
- It is compatible with the MIT license of the surrounding code.
- The explicit patent grant in Apache 2.0 provides additional clarity for
  downstream commercial use.

**Document segmentation**: Handled differently per platform.

- **iOS** uses Apple's `VNDetectDocumentSegmentationRequest` (Apple Vision),
  a platform-vendor API governed by the Apple SDK license. It is not bundled
  with this package.
- **Android** bundles the pre-trained DocAligner `lcnet100` TFLite FP16 model
  (`android/src/main/assets/docaligner_lcnet100.tflite`), licensed Apache-2.0
  by [DocsaidLab](https://github.com/DocsaidLab/DocAligner). Full attribution
  for this third-party model is in [THIRD_PARTY_MODELS.md](THIRD_PARTY_MODELS.md).

**Note:** IDNet is licensed CC-BY-4.0. Models derived by training on
CC-BY-4.0 data inherit an attribution requirement. The attribution provided
in this card and in DATA_CARD.md satisfies that requirement. If you
redistribute model weights, you must preserve this attribution.
