#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="/srv/anlagenserver/logs"
find "$LOG_DIR" -type f -name "*.log.*" -mtime +30 -delete
find "$LOG_DIR" -type f -name "trace*.json" -mtime +30 -delete

echo "rotation done"
