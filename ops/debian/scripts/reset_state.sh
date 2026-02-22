#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash ops/debian/scripts/reset_state.sh" >&2
  exit 1
fi

DB_NAME="${DB_NAME:-anlagen}"
DB_USER="${DB_USER:-anlagen}"

echo "[reset] stop app service"
systemctl stop anlagen-api.service || true

echo "[reset] postgres database"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${DB_NAME};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

echo "[reset] storage directories"
rm -rf /srv/anlagenserver/files/* /srv/anlagenserver/reports/* /srv/anlagenserver/logs/* /srv/anlagenserver/backups/*

echo "[reset] start app service"
systemctl start anlagen-api.service
sleep 2
curl -fsS http://127.0.0.1:8080/readyz >/dev/null

echo "[reset] completed"
