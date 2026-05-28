#!/usr/bin/env bash
# Shared launcher helpers. Source this from each scripts/<task>.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[1]}")/.." && pwd)"
export YOLO_AUTOINSTALL=False
cd "$HERE"

env_sync() {
  local env="$1"
  uv sync --frozen --quiet --project "envs/$env"
}

env_run() {
  local env="$1"
  shift
  uv run --project "envs/$env" "$@"
}

assert_versions() {
  local env="$1"; shift
  local mods="$*"
  env_run "$env" python -c "
import importlib, sys
mods = '''$mods'''.split()
print(f'[env-$env] python={sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}', end='')
for m in mods:
    try:
        v = importlib.import_module(m).__version__
    except Exception as e:
        v = f'ERR:{e.__class__.__name__}'
    print(f' {m}={v}', end='')
print()
"
}
