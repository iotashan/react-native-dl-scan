#!/usr/bin/env bash
source "$(dirname "$0")/_lib.sh"
env_sync export-ios
assert_versions export-ios torch ultralytics coremltools
exec caffeinate -i uv run --project envs/export-ios python -u export/export_field_detector.py --skip-tflite "$@"
