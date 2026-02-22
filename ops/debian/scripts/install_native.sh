#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash ops/debian/scripts/install_native.sh" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/anlagenbuch-server}"
APP_USER="${APP_USER:-anlagen}"
APP_GROUP="${APP_GROUP:-anlagen}"
APP_ENV_DIR="/etc/anlagenbuch"
APP_ENV_FILE="${APP_ENV_DIR}/app.env"

DB_NAME="${DB_NAME:-anlagen}"
DB_USER="${DB_USER:-anlagen}"
DB_PASSWORD="${DB_PASSWORD:-anlagen_change_me}"

echo "[install] packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  python3 python3-venv python3-pip \
  nodejs npm \
  postgresql postgresql-client \
  caddy curl rsync ca-certificates

echo "[install] system user"
if ! getent group "$APP_GROUP" >/dev/null; then
  groupadd --system "$APP_GROUP"
fi
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --home "$INSTALL_ROOT" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

echo "[install] sync repository to ${INSTALL_ROOT}"
mkdir -p "$INSTALL_ROOT"
rsync -a --delete \
  --exclude ".git" \
  --exclude ".venv" \
  --exclude "node_modules" \
  --exclude "apps/ui-admin/dist" \
  --exclude "apps/ui-schichtbuch/dist" \
  --exclude "apps/ui-tickets/dist" \
  "$ROOT"/ "$INSTALL_ROOT"/

echo "[install] storage directories"
mkdir -p /srv/anlagenserver/{files,reports,logs,backups,config}
chown -R "$APP_USER:$APP_GROUP" /srv/anlagenserver
chown -R "$APP_USER:$APP_GROUP" "$INSTALL_ROOT"

echo "[install] app env"
install -d -m 0750 "$APP_ENV_DIR"
if [[ ! -f "$APP_ENV_FILE" ]]; then
  cp "$INSTALL_ROOT/ops/debian/env/app.env.example" "$APP_ENV_FILE"
  sed -i \
    -e "s|__DB_USER__|$DB_USER|g" \
    -e "s|__DB_PASSWORD__|$DB_PASSWORD|g" \
    -e "s|__DB_NAME__|$DB_NAME|g" \
    "$APP_ENV_FILE"
fi
chown root:"$APP_GROUP" "$APP_ENV_FILE"
chmod 0640 "$APP_ENV_FILE"

echo "[install] postgres bootstrap"
systemctl enable --now postgresql
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

echo "[install] python + ui build"
sudo -u "$APP_USER" bash -lc "cd '$INSTALL_ROOT' && bash ops/debian/scripts/prepare_native.sh"

echo "[install] systemd + caddy"
sed \
  -e "s|__INSTALL_ROOT__|$INSTALL_ROOT|g" \
  -e "s|__APP_USER__|$APP_USER|g" \
  -e "s|__APP_GROUP__|$APP_GROUP|g" \
  "$INSTALL_ROOT/ops/debian/systemd/anlagen-api.service.template" \
  > /etc/systemd/system/anlagen-api.service

sed \
  -e "s|__INSTALL_ROOT__|$INSTALL_ROOT|g" \
  "$INSTALL_ROOT/ops/debian/systemd/anlagen-logrotate.service.template" \
  > /etc/systemd/system/anlagen-logrotate.service

cp "$INSTALL_ROOT/ops/debian/systemd/anlagen-logrotate.timer" /etc/systemd/system/anlagen-logrotate.timer
cp "$INSTALL_ROOT/ops/debian/caddy/Caddyfile" /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now anlagen-api.service anlagen-logrotate.timer caddy.service

echo "[install] health checks"
sleep 2
curl -fsS http://127.0.0.1:8080/readyz >/dev/null

echo
echo "Debian native install complete."
echo "Links:"
echo "  http://SERVER:8080/"
echo "  http://SERVER:8080/admin/"
echo "  http://SERVER:8080/dispatcher/"
echo "  http://SERVER:8080/endbearbeiter/"
