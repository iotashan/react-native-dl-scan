#!/usr/bin/env bash
source "$(dirname "$0")/_lib.sh"
env_sync train
assert_versions train torch ultralytics
exec caffeinate -dimsu uv run --project envs/train python -u train_field_detector_mps_patched.py "$@"
