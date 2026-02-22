#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${APP_ENV_FILE:-/etc/anlagenbuch/app.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ ! -x "$ROOT/.venv/bin/uvicorn" ]]; then
  echo "missing python runtime, run: bash ops/debian/scripts/prepare_native.sh" >&2
  exit 1
fi

export PYTHONPATH="$ROOT/services/api:${PYTHONPATH:-}"
exec "$ROOT/.venv/bin/uvicorn" app.main:app --host "${APP_HOST:-127.0.0.1}" --port "${APP_PORT:-8000}"
