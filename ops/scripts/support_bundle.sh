#!/usr/bin/env bash
set -euo pipefail

DAYS="${1:-7}"
OUT_DIR="/srv/anlagenserver/backups"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/support_bundle_$(date +%Y%m%d_%H%M%S).zip"

curl -fsS "http://127.0.0.1:8080/api/ops/logs/download?days=${DAYS}" -o "$OUT_FILE"
echo "$OUT_FILE"
