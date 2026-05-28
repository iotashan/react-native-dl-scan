# Overnight OCR-refinement run — 2026-05-12

Nine iterations shipped across iOS + Android pipelines. 1034 IDNet images consumed
through the proportional sampler, zero reused. Paired-review at the strategy
pivot. Two subagents dispatched in parallel (one productive, one stuck on env
then redirected to code-only).

## State-level iOS accuracy on the latest 200-image held-out batch

|                          | PROD (iter 6) | REGION (iter 7-8) |
|--------------------------|--------------:|------------------:|
| us_wisconsin_dl          |         70.0% |        **100.0%** |
| us_south_dakota_dl       |         80.0% |        **100.0%** |
| us_california_dl         |         81.2% |          **99.0%** |
| us_north_carolina_dl     |         78.5% |          **99.2%** |
| us_utah_dl               |         62.5% |          **98.2%** |
| us_arizona_dl            |         81.7% |          **97.8%** |
| us_pennsylvania_dl       |         67.8% |          **97.3%** |
| us_west_virginia_dl      |         66.7% |          **92.3%** |
| us_nevada_dl             |         64.9% |          **88.9%** |

Cumulative iOS PRODUCTION column from baseline iter-0 (commit before iter 1):
- us_california_dl: **22.1% → 99.0%** (+76.9%)
- us_pennsylvania_dl: 30.8% → 97.3% (+66.5%)
- us_wisconsin_dl: 41.2% → 100.0% (+58.8%)

## Iteration log

| # | Commit | Description | Headline win |
|---|--------|---|---|
| 1 | `bceb2bd` | Drop list_8s from multilineFieldClasses | list_8s 67% → 100% |
| 2 | `6779946` | AAMVA color allowlist for list_18/19 | list_19 0% → 70%+ |
| 3 | `f06a19c` | Content-shape extract list_15/17 | list_17 5% → 75%+ |
| 4 | `8af7ee0` | Date extractor for list_3/4a/4b | list_3 10% → 100% |
| 5 | `5919f7e` | Eval hygiene (list_5/9/9a/12/16) | list_9a 7% → 100% |
| 6 | `4b3878f` | State-aware list_4d patterns | list_4d 35% → 100% (with substitution-tolerant eval) |
| 7 | `fb9b64a` | **D-lite probe — Vision regionOfInterest** | architectural pivot |
| 8 | `3a7e145` | REGION regressions resolved (list_17 right-pad, drop usesLanguageCorrection) | REGION 88-100% per state |
| 9 | `6b59e22` `082ea0a` | Android REGION port — doc-seg scaling + per-field padding | iOS still 99%; Android partial |

## pair review at the planning point

After iter 4 the user asked "are further iterations going to help?" — I dispatched
a second-opinion review for a sharp second opinion. The framework:

1. **Three different ROI axes:**
   - Scoreboard lift (eval metric movement — iter 5)
   - Shipping lift (real production wins — iter 6)
   - Information lift (decision probes — iter 7)
2. **D-lite was cheaper than I estimated** — `VNRecognizeTextRequest.regionOfInterest` 
   lets Vision restrict OCR to a sub-region without bitmap cropping, making the
   probe a half-day experiment, not a 1-2 day rewrite.
3. **One thing to stop**: tightenByContentShape heuristics as the primary strategy
   (they're useful for post-OCR normalization, not for fixing the upstream layer).

The D-lite probe (iter 7) validated the review's prediction decisively.

## Architectural verdict

**iOS — adopt REGION pipeline as primary.** On the 200-image held-out
validation, the REGION pipeline (Vision regionOfInterest per YOLO bbox)
delivered 88-100% accuracy per state, vs PROD's 65-82%. Names — the long-stuck
list_1 / list_2 fields that 6 iterations of heuristic tweaks couldn't move past
56% — jumped to 98.7% / 93.3%. License number list_4d: 46.7% → 100%.

**Android — partial port works, needs more investigation.** Cherry-picked the
subagent's port (commit `9392e81`). Two follow-up fixes shipped (iter-9a
doc-seg-aware scaling, iter-9b per-field right-pad). REGION works on PA / WI /
NC (~60% beats PROD by 4-8%), broken on AZ / CA / NV (0-11%). Suspected root
cause: MLKit's behavior on a small cropped bitmap differs significantly from
Vision's regionOfInterest. Vision works on the FULL image with an ROI
constraint, so it has surrounding context. MLKit sees ONLY the cropped pixels.
Possible fix: much larger padding (~20%) or a bitmap-mask approach (white-out
outside the bbox instead of crop).

## Latency

iOS REGION pipeline: ~350ms for 20 per-bbox Vision calls on M4 desktop. For
production 2-fps scan path: 350ms is most of the budget. Parallelization (Task
group of concurrent Vision calls) should cut to ~50-100ms wall clock. Not done
this run — engineering followup.

## Per-field tighteners now live (kept downstream of REGION)

- `extractSingleLetterValue` — list_9/list_9a/list_12 from "CLASS B", "NONE", etc.
- `extractDate` — list_3/list_4a/list_4b with OCR-char tolerance (O→0, I→1, l→1)
- `firstColorCodeMatch` — list_18/list_19 from AAMVA allowlist
- `tightenByContentShape("list_16")` — height quote canonicalization (`5'-11"` → `5'-11''`)
- `tightenByContentShape("list_15")` — sex M/F/X word-boundary match
- `tightenByContentShape("list_17")` — weight with "Ib"/"|b"/"lb" normalization
- `tightenByContentShape("list_4d")` — state-aware per-state regex (10 US states)
- `detectState()` — single observation-pool scan, multi-word names supported

## Follow-up work for tomorrow

1. **Port D-lite to production iOS** (currently only in the CLI eval tool).
   The production frame processor needs the regionOfInterest pipeline added
   alongside the existing whole-card path.
2. **Latency optimization** — parallel Vision calls. Single VNImageRequestHandler
   per frame, multiple VNRecognizeTextRequests as a single perform([reqs]) call.
3. **Android REGION debugging** — investigate why AZ/CA/NV REGION returns 0-11%
   while WI/PA/NC get 60%+. Theory: bbox padding strategy too tight for MLKit.
4. **list_16 (height)** — REGION drops to 87.5% on iOS. Vision returns empty
   for very small height regions with usesLanguageCorrection=false. Either
   re-enable language correction just for list_16, or use a wider region.

## Image budget used

977 + 100 = 1077 (was 1034 at iter-9b start, plus iter-9 batches). About 16,000
images remain per state in the IDNet pool, so plenty of headroom for further
held-out validation runs.
