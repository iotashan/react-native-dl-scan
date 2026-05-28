# Disambig Model Postmortem

**Status: failed — removed from product plan on 2026-05-09.**

This document records why a planned per-character OCR disambiguation model was
trained, why it failed, and what would need to change before any future
attempt. The training data it produced is preserved (see "Data assets retained"
below) and may be useful for future research, but the model itself is **not
shipped** and the supporting code has been removed.

The shipped product uses **only** the field detector (`DlScanFieldDetector`,
YOLOv8n) plus platform-vendor OCR (VisionKit on iOS, ML Kit Text Recognition
on Android) feeding the shared C++17 field extractor. There is no ML
post-processing of OCR output.

## Why it was attempted

Apple VisionKit and Google ML Kit both make systematic per-character OCR
errors on driver's license fields — substitutions like `B → D`, `I → L`,
`O → 0`, plus loss of diacritics and field-specific separators (e.g., dates
`/` getting read as `1`). The hypothesis was that a small Keras model
conditioned on the OCR output string and the predicted field type could learn
to correct these errors before the C++ extractor parsed them.

Two architectures were planned in `train_disambig.py`:

- **Per-char classification** (default): 1D conv × 2 → BiLSTM(64) → per-position
  softmax. Picked when most errors are substitutions (same length, different
  chars).
- **Seq2seq with attention** (fallback): encoder-decoder LSTM(128) + Bahdanau
  attention. Picked when insertion + deletion errors ≥ 20% of all errors.

`measure_error_types.py` analyzed the OCR pair distribution and dispatched to
one or the other.

## What was built

| Stage | Status |
|---|---|
| 50 000 IDNet images → VisionKit OCR pairs | ✅ 14 min on M3 Ultra ANE (~58 img/s), 111 897 pairs at `idnet-data/ocr_pairs.jsonl` |
| Error-type analysis (`measure_error_types.py`) | ✅ Architecture: seq2seq (61.2% indel) |
| Seq2seq training (Keras 3 + tensorflow-metal) | ✅ 11 epochs, early-stopped, `runs/disambig/best.keras` saved (2.7 MB) |
| Held-out diagnostic (5 000 unseen pairs) | ✅ Showed model is harmful — see below |
| Core ML export | ❌ `coremltools 9.0` doesn't support TF 2.18 / Keras 3 functional models |
| TFLite export | ❌ `tf.CudnnRNNV3` op not convertible without `LSTM(implementation=1)` |
| Production integration | ❌ Cancelled per diagnostic |

## Why it failed: mode collapse

Per-character validation accuracy plateaued at **0.7383** from epoch 0
onward — a strong early warning. A held-out diagnostic on 5 000 randomly
sampled OCR pairs (mix of correct and error) confirmed the model was **net
negative**:

| | Baseline (raw OCR) | Disambig output |
|---|---|---|
| Whole-string accuracy | **10.74%** | **4.76%** |
| Avg edit distance to ground truth | 4.49 chars | **6.48 chars** |
| Correct OCR outputs preserved | 100% | **11.2%** |

Inspecting per-prediction examples made the failure mode obvious. The model
had learned to produce the most common training-set output for each
`field_id` regardless of input:

| Field | OCR input | Disambig output | Ground truth |
|---|---|---|---|
| `list_4b` | `0312812029` | `02/11/2027` | `03/28/2029` |
| `list_4b` | `1110612026` | `02/11/2027` | `11/06/2026` |
| `list_4a` | `0111012024` | `02/11/2021` | `01/10/2024` |
| `list_8s` | `SPEARFISH.` | `CARTON, ,     5` | `SPEARFISH, SD 57783` |
| `country_code` | `EAIVGRC` | `0` | `ΕΛΛ/GRC` |
| `surname` | `DE` | `SALI` | `TEŠIĆ` |

Every date became `02/11/2027` or `02/11/2021`. Addresses became fragments of
random training addresses. Greek script became `0`. The model was not learning
to correct OCR errors — it was learning a per-field prior over the most
common training outputs and ignoring the input string.

## Why this happened (architectural, not training)

Three compounding issues, in approximate order of severity:

1. **Loss did not mask PAD positions.** The training loss
   (`sparse_categorical_crossentropy` over all 24 positions) rewarded
   predicting `<PAD>` on padding positions. Most fields are short — average
   length ~8 chars — so 60–70% of every label sequence is PAD. The model
   could trivially achieve 0.7+ accuracy by predicting PAD on most positions
   and the most common content character on the rest, while completely
   ignoring the OCR input.
2. **No copy mechanism.** A pointer-network or copy attention would let the
   model fall back to "use OCR character as-is" when uncertain. Without it,
   the model has no architectural pressure to preserve correct OCR output —
   so it doesn't.
3. **"Correct" pairs filtered out of training.** `load_pairs()` in
   `train_disambig.py` discarded pairs where `error_type == "correct"`,
   removing the 10% of training data that would have taught the model that
   identity-mapping the OCR is acceptable when the OCR is right.

The 73.8% per-character validation accuracy was a **misleading metric**. It
masked complete content collapse because PAD positions, which the model
trivially gets right, dominate the average. Per-field whole-string accuracy
during training would have caught this in epoch 1.

## What would have to change for a v2 attempt

If the project ever revisits OCR post-processing:

1. **Mask PAD from the loss.** Use `sample_weight` per position or switch
   to a CTC loss that handles variable-length output.
2. **Add a copy mechanism.** Pointer-generator network, or train with a
   strong identity-mapping prior so "output = input" is the default behavior.
3. **Re-include `correct` pairs in training** at a high fraction (≥30%)
   so the model sees identity mapping as a valid output.
4. **Validate with per-field whole-string accuracy each epoch**, not
   per-position character accuracy. Reject any architecture that can't beat
   the "use OCR as-is" baseline of ~10.7% on held-out data.
5. **Run the diagnostic in `runs/disambig/eval_baseline.log`** as a CI gate
   before exporting any disambig artifact in the future.

The export issues (`coremltools 9.0` + Keras 3 functional, TF 2.18
`CudnnRNNV3`) are real but secondary — they only become worth fixing once
the model itself is actually useful, which the architecture above is not.

## What replaced it

The shipped product accepts that platform-vendor OCR will make some errors
and handles them downstream:

- **Field detector** (`DlScanFieldDetector`) crops tight per-field regions
  before OCR, which substantially reduces text-recognition errors compared
  to running OCR on a whole-card image.
- **C++17 field extractor** (`cpp/`) does line-pattern matching against
  AAMVA-style field definitions, with regex fallbacks for dates / heights /
  postal codes that absorb common substitution errors at the parse step
  rather than at the character level.
- **Future runtime fuzzy matching** (Levenshtein + per-field dictionaries)
  is documented as a possible v2 path in the C++ extractor, sidestepping the
  ML model entirely.

## Data assets retained

The training data is **preserved** even though the model is not. It may be
useful for future OCR research, dataset audits, or any v2 disambig attempt.

| Asset | Path | Notes |
|---|---|---|
| Raw OCR pairs (full 50K run) | `/Volumes/Work4TB/dev/iotashan/idnet-data/ocr_pairs.jsonl` | 111 897 lines, ~30 MB. Generated from 50 000 stratified IDNet images via VisionKit on M3 Ultra ANE. |
| Trained (broken) Keras model | `model-training/runs/disambig/best.keras` | 2.7 MB. Kept for reference — runs but produces the mode-collapse outputs documented above. |
| Per-epoch training history | `model-training/runs/disambig/history.csv` | 11 epochs of loss + accuracy. |

The OCR pair format is documented at the top of the (now-deleted)
`render_ocr_pairs.py` and at the top of the JSONL itself — each line is:

```json
{
  "sample_id": "<stem>",
  "doc_type": "us_california_dl",
  "field_id": "list_1",
  "gt_string": "WANG",
  "ocr_string": "WAMG",
  "error_type": "substitution",
  "gt_len": 4,
  "ocr_len": 4,
  "edit_distance": 1
}
```

To regenerate from scratch (e.g., on a different OCR engine), the script
that produced this is recoverable from git history at the commit prior to
this postmortem: `git log --diff-filter=D --all -- model-training/disambig/`.

## Carbon and time cost of the failed attempt

- ~14 min M3 Ultra ANE for OCR pair rendering (negligible energy).
- ~5 min M3 Ultra GPU (Metal) for 11 epochs of training.
- Roughly 2 hours of investigator time (this session) including diagnosis.

In retrospect, the failure was diagnosable from the epoch-0 plateau alone if
we had tracked per-field whole-string accuracy. Total wasted compute is
small; the postmortem is mostly about preserving the lesson, not the cost.
