#!/usr/bin/env bash
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-14}"
TARGET_BASE="/srv/anlagenserver/backups/backup-copy"
DATE_DIR="$TARGET_BASE/$(date +%F)"
mkdir -p "$DATE_DIR"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-anlagen}"
DB_USER="${DB_USER:-anlagen}"
DB_PASSWORD="${DB_PASSWORD:-anlagen_change_me}"

export PGPASSWORD="$DB_PASSWORD"
pg_dump --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" "$DB_NAME" > "$DATE_DIR/db.sql"
unset PGPASSWORD

tar -czf "$DATE_DIR/files.tar.gz" -C /srv/anlagenserver files reports config

find "$TARGET_BASE" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

echo "backup written to $DATE_DIR"
