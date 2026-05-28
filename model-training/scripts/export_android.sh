#!/usr/bin/env bash
source "$(dirname "$0")/_lib.sh"
env_sync export-android
assert_versions export-android tensorflow tf_keras onnx onnx2tf ml_dtypes ai_edge_litert ultralytics
exec caffeinate -i uv run --project envs/export-android python -u export/export_field_detector.py --skip-coreml "$@"
