#!/usr/bin/env bash
# Export the trained NanoDet field detector -> TFLite for react-native-fast-tflite.
#
# Run from model-training/nanodet/ AFTER a model_best checkpoint exists. Produces
# nanodet_field_416.tflite whose I/O matches what the shared C++ decode
# (cpp/detect/nanodet_decode + detect_c) and src/detector.ts expect:
#   input  [1, 416, 416, 3] NHWC float32   (native preprocess emits NHWC BGR mean/std)
#   output [1, 3598, 62]    anchor-major    (30 already-sigmoid cls + 4*8 DFL logits;
#                                            decode reads output[a*62 + c])
#
# Usage:
#   ./export_field_detector.sh [path/to/nanodet_model_best.pth]
set -euo pipefail
cd "$(dirname "$0")"

VENV="../envs/nanodet/.venv/bin/python"
NANODET_TOOLS="../envs/nanodet/nanodet/tools/export_onnx.py"
CFG="configs/dlscan-nanodet-plus-m_416.yml"
CKPT="${1:-workspace/dlscan-nanodet-416/model_best/nanodet_model_best.pth}"
ONNX="nanodet_field_416.onnx"
OUTDIR="export_tflite"

echo "==> [1/3] checkpoint -> ONNX  ($CKPT)"
# NanoDet's exporter. opset 11, single concatenated [1,A,62] tensor (gate-confirmed).
IDNET_DATA_ROOT="${IDNET_DATA_ROOT:-/Volumes/Work4TB/dev/iotashan/idnet-data}" \
  "$VENV" "$NANODET_TOOLS" --cfg_path "$CFG" --model_path "$CKPT" \
  --out_path "$ONNX" --input_shape "416,416"

echo "==> [2/3] ONNX -> TFLite"
# !!! IMPORTANT — onnx2tf does NOT work for this graph !!!
# Verified 2026-05-31 on the probe export: onnx2tf (BOTH 1.26.3 and 1.27.4, with and
# without static-shape override / onnxsim) crashes in the NanoDet-Plus head with
#   ValueError: Number of groups must not be 0 ... input shapes: [0,58,0,0]
# — a shape-inference bug where a 1x1 head conv loses its spatial dims. The conversion
# reaches the final /head/Transpose (output [1,3598,62]) but aborts at that conv.
#
# CONFIRMED from the conversion graph trace (this is the payoff): the output is
# anchor-major [1, 3598, 62] (the /head/Transpose perm is identity), and the input is
# NHWC [1,416,416,3] — i.e. exactly what cpp/detect/nanodet_decode (reads output[a*62+c])
# and src/detector.ts assume. So the C++/JS decode does NOT need to become layout-aware.
#
# SOLVED 2026-06-02 — the working tflite step lives in export_tflite/export_internal.py
# (committed). Path: litert-torch (the renamed ai-edge-torch; `import litert_torch`,
# `litert_torch.convert`), run in a FRESH env on INTERNAL storage (NOT ../envs/nanodet).
# It converts the torch model DIRECTLY (bypassing ONNX/onnx2tf), wrapping forward() to
# permute NHWC->NCHW so the tflite input is NHWC [1,416,416,3]. Load weights with a bare
# model.load_state_dict(ck["state_dict"]) — the .pth already holds clean EMA keys.
# Validated (parity_check.py): tflite vs pytorch max abs diff 1.07e-5, corr ~1.0,
# output [1,3598,62] anchor-major. A dynamic-int8 variant (quant_int8.py) is 3x smaller
# but shows cls-head deviation on OOD input — validate on-device before shipping int8.
echo "    -> run export_tflite/export_internal.py (litert-torch). onnx2tf is a dead end here."
exit 0  # this script stops at ONNX; the tflite conversion lives in export_internal.py.

echo "==> [3/3] verify TFLite I/O layout"
uv run --no-project --with ai-edge-litert python3 - "$OUTDIR" <<'PY'
import glob, sys
from ai_edge_litert.interpreter import Interpreter
tfl = sorted(glob.glob(sys.argv[1] + "/*_float32.tflite")) or sorted(glob.glob(sys.argv[1] + "/*.tflite"))
assert tfl, "no .tflite produced"
it = Interpreter(model_path=tfl[0]); it.allocate_tensors()
i = it.get_input_details()[0]; o = it.get_output_details()[0]
print("model:", tfl[0])
print("INPUT :", i["shape"], i["dtype"], "(expect [1 416 416 3] float32, NHWC)")
print("OUTPUT:", o["shape"], o["dtype"], "(expect [1 3598 62], anchor-major)")
# If OUTPUT is [1,62,3598] it's channel-major -> make dlscan_decode_field layout-aware.
PY

echo "==> done. Copy ${OUTDIR}/*_float32.tflite (or the int8/fp16 variant) to the app"
echo "    assets and load it from JS via loadDetectorModels() (src/detector.ts)."
