#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

HOST=""
PORT="443"
WARM_PATH="/readyz"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-443}"
      shift 2
      ;;
    --warm-path)
      WARM_PATH="${2:-/readyz}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "--host is required" >&2
  exit 2
fi

if [[ ! "$HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,253}[A-Za-z0-9]$ ]]; then
  echo "invalid host" >&2
  exit 2
fi

CERT_BASE="/var/lib/caddy/.local/share/caddy/certificates"
removed=0
if [[ -d "$CERT_BASE" ]]; then
  while IFS= read -r -d '' dir; do
    rm -rf "$dir"
    removed=$((removed + 1))
  done < <(find "$CERT_BASE" -mindepth 2 -maxdepth 2 -type d -name "$HOST" -print0)
fi

systemctl reload caddy

# Trigger immediate certificate re-issue and cache fill on localhost.
curl --silent --fail --insecure --max-time 20 \
  --resolve "${HOST}:${PORT}:127.0.0.1" \
  "https://${HOST}:${PORT}${WARM_PATH}" >/dev/null || true

echo "renew-triggered host=${HOST} removed_cache_dirs=${removed}"
