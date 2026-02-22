#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VENV="$ROOT/.venv"

if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install -r "$ROOT/services/api/requirements.txt"

bash "$ROOT/ops/debian/scripts/build_ui.sh"

echo "[native] runtime prepared at $ROOT"
