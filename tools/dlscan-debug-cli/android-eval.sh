#!/usr/bin/env bash
# Run the IDNet batch eval against the connected Android device using the
# production HybridDLScanAndroid.ocrPipelineForEval pipeline via an
# instrumented test (IdnetBatchEvalTest).
#
# Usage:
#   tools/dlscan-debug-cli/android-eval.sh [--samples N] [--states "a b c"]
#
# Output: tools/dlscan-debug-cli/android-results.tsv
#
# Workflow:
#   1. (Re)install the test app on the device  — once per code change.
#   2. For each state dir under idnet-data/extracted/us_*_dl, sample N
#      images and push them to the test app's external files dir.
#   3. Invoke IdnetBatchEvalTest, wait for completion.
#   4. Pull results.tsv and append/rename per-state.
#
# Pre-reqs:
#   - adb sees exactly one device.
#   - You ran `./gradlew :react-native-dl-scan:packageDebugAndroidTest` at
#     least once after the most recent code change.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${IDNET_DATA_ROOT:?set IDNET_DATA_ROOT to your idnet-data directory}"
IDNET_ROOT="${IDNET_DATA_ROOT}/extracted"
OUT="$REPO_ROOT/tools/dlscan-debug-cli/android-results.tsv"
OUT_REGION="$REPO_ROOT/tools/dlscan-debug-cli/android-results-region.tsv"
APP_PKG="com.iotashan.dlscanexample"
TEST_PKG="$APP_PKG.test"
TEST_RUNNER="$TEST_PKG/androidx.test.runner.AndroidJUnitRunner"
DEVICE_DIR="/sdcard/Android/data/$APP_PKG/files"

SAMPLES="${SAMPLES:-20}"
SEED="${SEED:-42}"
STATES="${STATES:-us_arizona_dl us_california_dl us_dc_dl us_nevada_dl us_north_carolina_dl us_pennsylvania_dl us_south_dakota_dl us_utah_dl us_west_virginia_dl us_wisconsin_dl}"
BATCH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --samples) SAMPLES="$2"; shift 2;;
        --states) STATES="$2"; shift 2;;
        --seed) SEED="$2"; shift 2;;
        --batch) BATCH="$2"; shift 2;;
        *) echo "unknown arg: $1" >&2; exit 1;;
    esac
done

# --batch mode: take the per-state subset from the batch file instead of
# seeded random sampling. Derives the STATES list from the file itself
# so we only iterate states that have at least one image queued.
if [[ -n "$BATCH" ]]; then
    if [[ ! -f "$BATCH" ]]; then
        echo "ERROR: --batch file not found: $BATCH" >&2
        exit 1
    fi
    STATES="$(awk -F/ '{print $1}' "$BATCH" | sort -u | tr '\n' ' ')"
    echo "BATCH mode: $(grep -c . "$BATCH") images across states: $STATES"
fi

devices="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
n="$(echo "$devices" | wc -l | tr -d ' ')"
if [[ "$n" != "1" || -z "$devices" ]]; then
    echo "ERROR: expected exactly one device, got: '$devices'" >&2
    exit 1
fi
echo "Device: $devices"

# Sync the tracked instrumented test source into the gitignored example/
# prebuild output. The test lives under tools/dlscan-debug-cli/android-test/
# so it survives `expo prebuild` regenerating example/android/.
TEST_SRC="$REPO_ROOT/tools/dlscan-debug-cli/android-test/IdnetBatchEvalTest.kt"
TEST_DST="$REPO_ROOT/example/android/app/src/androidTest/java/com/dlscan/IdnetBatchEvalTest.kt"
if [[ -f "$TEST_SRC" ]]; then
    mkdir -p "$(dirname "$TEST_DST")"
    cp "$TEST_SRC" "$TEST_DST"
fi

echo "Installing test APK..."
(cd "$REPO_ROOT/example/android" && ./gradlew :app:installDebug :app:installDebugAndroidTest -q)

# Test app's external files dir is created by the install above.
adb shell mkdir -p "$DEVICE_DIR/idnet"

echo "" > "$OUT"
echo "" > "$OUT_REGION"
TOTAL_HOST_START="$(date +%s)"

for STATE in $STATES; do
    STATE_DIR="$IDNET_ROOT/$STATE"
    if [[ ! -d "$STATE_DIR" ]]; then
        echo "SKIP $STATE (no dir at $STATE_DIR)"
        continue
    fi
    echo "===  $STATE  ==="
    if [[ -n "$BATCH" ]]; then
        SAMPLE_LIST="$(awk -F/ -v s="$STATE" '$1==s {print $2}' "$BATCH")"
    else
        SAMPLE_LIST="$(python3 -c "
import os, random, sys
d = '$STATE_DIR'; seed = $SEED; n = $SAMPLES
rng = random.Random(seed)
imgs = sorted(p for p in os.listdir(d)
              if p.lower().endswith(('.jpg', '.jpeg', '.png')))
rng.shuffle(imgs)
picked = []
for p in imgs:
    j = os.path.join(d, os.path.splitext(p)[0] + '.json')
    if os.path.exists(j):
        picked.append(p)
    if len(picked) >= n:
        break
print('\n'.join(picked))
")"
    fi
    cnt="$(echo "$SAMPLE_LIST" | grep -c . || true)"
    echo "  pushing $cnt sample(s)..."

    # Clear stale samples + results, then push the new batch.
    adb shell "rm -rf '$DEVICE_DIR/idnet'; mkdir -p '$DEVICE_DIR/idnet'" > /dev/null
    adb shell "rm -f '$DEVICE_DIR/results.tsv' '$DEVICE_DIR/results-region.tsv'" > /dev/null
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        adb push -q "$STATE_DIR/$f" "$DEVICE_DIR/idnet/" > /dev/null
    done <<< "$SAMPLE_LIST"

    echo "  running IdnetBatchEvalTest (PROD + REGION)..."
    T0="$(date +%s)"
    # Runs every @Test method in IdnetBatchEvalTest — currently:
    #   - batchEval_runsPipelineOnEveryImage_writesTsv         (writes results.tsv)
    #   - batchEval_region_runsPipelineOnEveryImage_writesTsv  (writes results-region.tsv)
    adb shell am instrument -w -r \
        -e class com.dlscan.IdnetBatchEvalTest \
        "$TEST_RUNNER" > /tmp/dlscan-android-eval-last.log 2>&1 || true
    DT=$(( $(date +%s) - T0 ))
    echo "  done in ${DT}s"

    # Pull PROD results, prefix every line with state name, append to OUT.
    LOCAL_TMP="$(mktemp)"
    adb pull "$DEVICE_DIR/results.tsv" "$LOCAL_TMP" 2>/dev/null
    if [[ -s "$LOCAL_TMP" ]]; then
        awk -v s="$STATE" '{print s "\t" $0}' "$LOCAL_TMP" >> "$OUT"
        echo "  wrote $(wc -l < "$LOCAL_TMP" | tr -d ' ') PROD rows from $STATE"
    else
        echo "  WARNING: empty / missing results.tsv for $STATE"
        echo "  test log (tail): /tmp/dlscan-android-eval-last.log"
        tail -20 /tmp/dlscan-android-eval-last.log >&2 || true
    fi
    rm -f "$LOCAL_TMP"

    # Pull REGION results (iter 7 D-lite probe) into a parallel TSV.
    LOCAL_TMP_REGION="$(mktemp)"
    adb pull "$DEVICE_DIR/results-region.tsv" "$LOCAL_TMP_REGION" 2>/dev/null
    if [[ -s "$LOCAL_TMP_REGION" ]]; then
        awk -v s="$STATE" '{print s "\t" $0}' "$LOCAL_TMP_REGION" >> "$OUT_REGION"
        echo "  wrote $(wc -l < "$LOCAL_TMP_REGION" | tr -d ' ') REGION rows from $STATE"
    else
        echo "  NOTE: empty / missing results-region.tsv for $STATE — REGION test may have failed"
    fi
    rm -f "$LOCAL_TMP_REGION"
done

TOTAL_DT=$(( $(date +%s) - TOTAL_HOST_START ))
echo
echo "=== Done in ${TOTAL_DT}s ==="
echo "PROD results:   $OUT"
echo "  Row count: $(grep -c . "$OUT" || true)"
echo "REGION results: $OUT_REGION"
echo "  Row count: $(grep -c . "$OUT_REGION" || true)"
