#!/usr/bin/env bash
# Run the parity smoke test using the export-android env (which has all
# three runtimes available — torch + ultralytics + coremltools + tflite).
source "$(dirname "$0")/_lib.sh"
env_sync export-android
exec uv run --project envs/export-android python -u parity_check.py "$@"
