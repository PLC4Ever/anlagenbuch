#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT_DIR/ops/podman/quadlet"
DEST="/etc/containers/systemd"
CFG="/srv/anlagenserver/config"

sudo mkdir -p /srv/anlagenserver/pgdata /srv/anlagenserver/files /srv/anlagenserver/reports \
  /srv/anlagenserver/logs /srv/anlagenserver/backups "$CFG" "$DEST"
sudo chmod -R 777 /srv/anlagenserver

sudo cp "$SRC"/*.container "$DEST"/
sudo cp "$ROOT_DIR/ops/caddy/Caddyfile" "$CFG/Caddyfile"
sudo cp "$ROOT_DIR/ops/podman/env/app.env" "$CFG/app.env"
sudo cp "$ROOT_DIR/ops/podman/env/postgres.env" "$CFG/postgres.env"
sudo podman network exists anlagen-net || sudo podman network create anlagen-net

sudo systemctl daemon-reload
if ! sudo systemctl enable --now anlagen-postgres.service anlagen-app.service anlagen-mailpit.service anlagen-caddy.service; then
  sudo systemctl stop anlagen-postgres.service anlagen-app.service anlagen-mailpit.service anlagen-caddy.service || true
  sudo systemctl start anlagen-postgres.service anlagen-app.service anlagen-mailpit.service anlagen-caddy.service
fi
