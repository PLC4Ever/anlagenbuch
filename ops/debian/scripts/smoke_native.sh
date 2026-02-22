#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"

if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  echo "missing venv runtime, run: bash ops/debian/scripts/prepare_native.sh" >&2
  exit 1
fi

BASE_URL="$BASE_URL" "$ROOT/.venv/bin/python" "$ROOT/services/api/tests_smoke/smoke_http.py"
