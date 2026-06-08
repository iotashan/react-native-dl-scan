# Limitations and Known Failure Modes

This document provides an honest account of what `react-native-dl-scan` and
its bundled ML models can and cannot do. Read this before integrating the
library into a production application.

---

## Jurisdictional Coverage

### In scope (trained jurisdictions)

**US state driver's licenses and ID cards:**

| State | Code |
|---|---|
| Arizona | AZ |
| California | CA |
| District of Columbia | DC |
| Nevada | NV |
| North Carolina | NC |
| Pennsylvania | PA |
| South Dakota | SD |
| Utah | UT |
| West Virginia | WV |
| Wisconsin | WI |

**International identity documents:**

| Country | ISO code |
|---|---|
| Albania | ALB |
| Azerbaijan | AZE |
| Spain | ESP |
| Estonia | EST |
| Finland | FIN |
| Greece | GRC |
| Latvia | LVA |
| Russia | RUS |
| Serbia | SRB |
| Slovakia | SVK |

**MRZ (Machine Readable Zone):** TD1, TD2, TD3 formats per ICAO 9303.
MRZ parsing is handled by the C++ parser (`cpp/`), not by the ML models,
so it works for any ICAO-compliant document regardless of jurisdiction.

**Document segmentation coverage:** The field detector covers all 20 trained
document types. However, the document segmentation step — detecting and
rectifying the card in the camera frame — is performed by
`VNDetectDocumentSegmentationRequest` (a vendor API on iOS) and the bundled
DocAligner `lcnet100` TFLite model (on Android). Neither was trained by us on
IDNet, so each may have different per-jurisdiction accuracy characteristics
than our field detector; we do not benchmark their corner-detection accuracy
per document type.

### Out of scope (not covered)

- **40 other US states and territories.** Documents from states not listed
  above may produce partial results, incorrect field boundaries, or no
  detection at all.
- **All Canadian provinces and territories.** Despite the AAMVA specification
  covering Canada, Canadian documents are not in the IDNet training set. The
  barcode-scan path (PDF417 AAMVA parsing) works for Canadian licenses; the
  ML-based front-of-license OCR path does not.
- **US Passports and Passport Cards.** MRZ is parsed; ML field detection on
  the biographical data page is not supported.
- **Commercial Driver's Licenses (CDL) — CDL-specific fields.** AAMVA barcode
  fields for CDL endorsements and hazmat credentials are parsed by the C++
  parser. CDL-specific visual layouts are not in the field detector training set.
- **ID cards (non-driver's-license).** US state-issued non-DL ID cards may
  share visual layouts with driver's licenses for covered states, but are not
  explicitly in the training set.
- **Most international documents.** Only the 10 countries listed above are
  covered. Documents from unlisted countries may not be detected or correctly
  classified.

---

## Compliance Disclaimer

**These models are NOT certified for KYC, AML, identity fraud detection, or
any regulatory compliance use case.**

Accuracy metrics reported in [EVALUATION.md](EVALUATION.md) are measured
against a held-out synthetic test set. Synthetic test performance cannot
substitute for real-world validation against physical documents across the
demographic, photographic, and condition distributions encountered in
production KYC/identity verification scenarios.

**Do not use these models as the sole basis for legal identification
decisions.**

---

## Known Failure Modes

### Document segmentation accuracy depends on the segmentation model/API

Document segmentation (locating the card in the camera frame and computing
rectification corners) is performed by `VNDetectDocumentSegmentationRequest`
(a vendor API on iOS) and the bundled DocAligner `lcnet100` TFLite model
(on Android). We did not train either on IDNet; their accuracy varies by
lighting, viewing angle, and document contrast against the background.

Known segmentation limitations:

- Documents held at angles > ~30° from frontal may be missed or produce
  incorrect corner estimates.
- Poor contrast between the card edge and the background (e.g., white card on
  white table) degrades detection.
- Extreme perspective distortion (near edge-on viewing angle) will cause the
  segmentation step to fail or produce a poor rectification, which then degrades
  field detection accuracy downstream.

Because we do not run our own per-jurisdiction benchmarks against the iOS
Vision API or the bundled DocAligner model, per-jurisdiction segmentation
accuracy is not characterized. See
[EVALUATION.md](EVALUATION.md#document-segmentation-evaluation-vendor-apis)
for the evaluation rationale.

### Document angle and perspective (field detector)

The IDNet training images have no background: the synthetic document fills the
entire frame. This means the field detector operates on a rectified crop
produced by the segmentation step (iOS Vision API / Android DocAligner).

If the rectification is poor (e.g., due to extreme angle or glare defeating
the segmentation step), field detection quality will degrade accordingly. Data
augmentation (affine, mosaic, color jitter) partially compensates for
rectification imprecision.

### Partial occlusion and physical damage

Documents with:
- Fingers covering key fields
- Physical damage (tears, creases, fading)
- Stickers or laminate bubbles
- Water damage

...may produce partial results. The field detector may silently miss occluded
fields rather than reporting an error. Check the per-field `dataConfidence`
entries on the returned `LicenseData` to see which fields reached which
validation tier — fields whose tier is `cross_validated` or
`all_gates_passed` are trustworthy enough to auto-fill a form; `shape_matched`
is good for display; `extracted_raw` should be reviewed. See the **Confidence
Tiers** section in [README.md](../README.md) for the full ladder.

### Glare and lighting conditions

Synthetic training data does not model specular reflections from laminated
ID surfaces under real-world lighting. Glare on the holographic overlay
common in modern driver's licenses is a known failure mode for front-of-license
OCR.

Mitigation: the barcode (`'barcode'` mode) scan path is largely unaffected
by front-face glare because it reads the back of the license.

### OCR accuracy variation by jurisdiction

The OCR + field extraction path (`'ocr'` mode) accuracy varies significantly
by jurisdiction. Factors include:
- Font selection in the synthetic template (some fonts OCR better than others)
- Field layout density (crowded layouts produce more OCR confusion)
- Character-level confusables produced by platform-vendor OCR (`B/D`,
  `I/L`, `O/0`, lost diacritics, dates with `/` read as `1`)

Expect higher accuracy for US documents from covered states and lower accuracy
for international documents with non-Latin character sets. Non-Latin field
values (Cyrillic, Greek) in the Russian, Serbian, and Greek templates may
fail to OCR cleanly on either platform-vendor OCR engine.

### Front-OCR field extraction: layout coverage and remaining variance

The `'ocr'` mode's field parser anchors primarily on the **numeric AAMVA D20
visible-field markers** most US licenses print beside each field (`1` last name,
`2` first/middle, `4d` license number, `8` address, `15` sex, `16` height, …),
with an **alphabetic-label fallback** for layouts that label fields with letters
instead (California-style `DL` / `LN` / `FN` / `DOB` / `EXP` / `HGT`). Both
layout families are exercised by our test corpus.

**Scope of the cross-jurisdiction guardrail — what is and isn't validated.** The
guardrail (`cpp/eval/parser_eval_vision`) runs our own Vision OCR + parser over
IDNet images for **10 of the 51 US DL jurisdictions** — AZ, CA, NV, NC, PA, SD,
UT, WV, WI, DC — in a **single OCR reading order** (the reading order macOS
Vision produced for those synthetic images). Within that set, every state
returns a result, and the guardrail runs on every parser change to prevent any
state's accuracy from being improved at another's expense. It does **not**
establish US-wide generalization: the **other 41 jurisdictions are unvalidated**,
and the parser has only been exercised against one reading order per card. Real
devices, alternate OCR engines (Android ML Kit), and unusual layouts can produce
field orderings the 10-state corpus never showed.

> **Known limitation — multi-column OCR ordering.** The marker-anchored parser
> uses a one-step look-ahead that assumes a field's value follows its label in
> reading order. When the OCR engine instead groups left-column field *labels*
> into one block and the *values* into another
> (`[1.FAMILY NAME][2.GIVEN NAMES][GARCIA][EMMA]`), the look-ahead can bind the
> wrong value into a slot — e.g. a surname into the first-name field. A
> positional / block-matching fix (pairing labels to values by column geometry
> rather than reading order) is tracked but **not yet implemented**.

Per-field accuracy still varies by jurisdiction; the honest current limits:

- **License number** is the most variable field. Hyphenated, bare all-digit, and
  alpha-prefixed formats all parse, but where the platform OCR drops or misreads
  a character (e.g. a leading `I` read as `1`, or omitted), the value is emitted
  **as read** — we do not fabricate the missing character — so it scores
  edit-distance-1 rather than exact. Bare 4-digit values that collide with an
  adjacent date year are rejected rather than mis-emitted.
- **Heavy-OCR-noise layouts** (dense rows, decorative fonts, or — in the
  synthetic IDNet corpus — non-Latin glyph rendering) still lose individual
  fields. Where a name or license number can't be anchored, the parser returns
  the fields it *did* recover (DOB, address, sex, …) rather than discarding the
  whole result.

These are parser/OCR-coverage characteristics, not a hard cutoff; coverage is
tracked against the cross-jurisdiction harness so additions can't silently
regress a covered state.

### No ML-based per-character OCR correction

The `'ocr'` mode in v1 does **not** apply an ML model to correct per-character
OCR errors. Errors made by VisionKit (iOS) or ML Kit Text Recognition
(Android) flow through to the C++ field extractor as-is, which absorbs some
common patterns (date separators, simple confusables) via regex / format
normalization but cannot correct arbitrary substitutions inside e.g. names
or addresses.

A trained Keras disambiguation model was attempted and failed; see
[`model-training/idnet/DISAMBIG_POSTMORTEM.md`](../model-training/idnet/DISAMBIG_POSTMORTEM.md)
for the failure mode and what would need to change for any future attempt.
A possible v2 path is runtime fuzzy matching (Levenshtein + per-field
dictionaries) inside the C++ extractor — no ML model required.

#### Heuristic fallback chains the C++ extractor already applies

The library does ship a small number of regex-based fallbacks that recover
specific OCR-fusion patterns observed on real WI / IL / NY licenses:

- **Apostrophe-loss height recovery** — when OCR drops the foot mark
  (`5'-04"` → `5-04`), `normalize_height_field` accepts the dash-form when
  feet ∈ [4,7] and inches ∈ [0,11] and reformats to canonical `F'II"`.
- **Trailing-noise eye/hair color recovery** — when OCR appends a stray
  character (`BLK` → `BLKO`), the lexer's anchored allowlist regex tolerates
  one trailing letter/digit and the normalizer strips it back to the
  canonical 3-letter code.
- **Chronological-date scanner** — when index tokens for DOB / issue /
  expire are too garbled to lex, every observation is scanned for
  `MM/DD/YYYY` tokens and the three distinct dates are assigned by
  chronology (oldest = DOB).
- **CLASS-from-DLN suffix** — when OCR fuses the vehicle-class onto the
  DLN row (`4d H200-... CLASS D`), the C++ extractor peels off the trailing
  `(CLASS|CLAS|GLASS) X` into `vehicleClass` before canonicalizing the DLN.
- **scanForClass text-pool** — when even the DLN's index prefix gets
  misread (e.g. `4d` → `46`), every observation is searched for
  `(CLASS|CLAS|GLASS) X` as a last-resort source.

These are bounded, deterministic, and tested in
[`cpp/tests/ocr_shape_gates_test.cpp`](../cpp/tests/ocr_shape_gates_test.cpp)
and [`android/src/test/.../TightenersTest.kt`](../android/src/test/java/com/margelo/nitro/dlscan/TightenersTest.kt).

### Expired document detection

The models do not detect or flag expired documents. The expiration date field
is extracted and returned in `LicenseData.expirationDate`; date validation
is the responsibility of the calling application.

### Fraud and forgery detection

Fraud detection is **explicitly out of scope.** IDNet contains synthetic fraud
variants that were included in training for geometric augmentation only. The
models are not designed or evaluated for genuine vs. fraudulent document
classification. Do not use these models to make fraud determinations.

---

## Bias Notes

### Synthetic vs. real distribution gap

All training, validation, and test data is computer-generated from fixed
procedural templates. The synthetic data:

- Does not represent the full range of physical printing quality across
  issuing authorities and over time
- Does not model progressive wear, yellowing, or format variations across
  multi-year issuance runs of the same document type
- Uses algorithmically-generated names and photos that do not represent real
  demographic distributions

Real-world performance may differ from held-out synthetic test metrics.
Demographic bias (e.g., differential accuracy by name length, character set,
or photo contrast) has not been characterized.

### Geographic coverage imbalance

10 of 20 covered document types are US documents; 10 are European. No
African, South American, East Asian, or South Asian identity document types
are in the training set. Detection and field extraction accuracy for documents
from these regions is expected to be poor to nonexistent.

---

## Summary Table

| Limitation | Severity | Workaround |
|---|---|---|
| 40 US states not covered (OCR) | High | Use barcode (`'barcode'` mode) for AAMVA PDF417 |
| Canada not covered (OCR) | High | Use barcode mode for Canadian licenses |
| Segmentation accuracy (iOS Vision / Android DocAligner) varies by jurisdiction/lighting | Medium | UX guidance: instruct user to hold card flat against a contrasting surface |
| >30° angle or poor contrast may defeat doc segmentation | Medium | UX guidance; prompt user to reposition if null result |
| No ML per-char OCR correction (either platform) | Medium | Vendor OCR errors flow through to the C++ extractor; runtime fuzzy matching is a possible v2 enhancement |
| Glare on laminated surface | Medium | Suggest diffuse lighting in UX |
| No fraud detection | N/A | Out of scope by design |
| Not certified for KYC/compliance | Critical | Do not use for regulatory decisions |
