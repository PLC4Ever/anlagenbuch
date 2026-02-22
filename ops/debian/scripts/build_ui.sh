#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

build_one() {
  local app="$1"
  echo "[ui] build ${app}"
  pushd "$ROOT/apps/${app}" >/dev/null
  npm ci
  npm run build
  popd >/dev/null
}

sync_one() {
  local app="$1"
  local src="$ROOT/apps/${app}/dist"
  local dst="$ROOT/services/api/static/${app}"
  if [[ ! -d "$src" ]]; then
    echo "missing dist output for ${app}: ${src}" >&2
    exit 1
  fi
  rm -rf "$dst"
  mkdir -p "$dst"
  cp -a "$src"/. "$dst"/
}

build_one "ui-schichtbuch"
build_one "ui-tickets"
build_one "ui-admin"

sync_one "ui-schichtbuch"
sync_one "ui-tickets"
sync_one "ui-admin"

echo "[ui] copied dist assets to services/api/static"
