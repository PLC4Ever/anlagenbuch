# Debian Native Runbook

## 1) Erstinstallation

```bash
sudo bash ops/debian/scripts/install_native.sh
```

Optional mit eigenen DB-Werten:

```bash
sudo DB_NAME=anlagen DB_USER=anlagen DB_PASSWORD='anlagen_change_me' bash ops/debian/scripts/install_native.sh
```

## 2) Service-Status

```bash
sudo systemctl status anlagen-api.service caddy.service anlagen-logrotate.timer
curl -fsS http://127.0.0.1:8080/readyz
```

## 3) Manuelles Update nach Code-Änderungen

```bash
sudo rsync -a --delete --exclude '.git' --exclude '.venv' ./ /opt/anlagenbuch-server/
sudo -u anlagen bash -lc 'cd /opt/anlagenbuch-server && .venv/bin/pip install -r services/api/requirements.txt && bash ops/debian/scripts/build_ui.sh'
sudo systemctl restart anlagen-api.service
```

## 4) Smoke-Test

```bash
bash ops/debian/scripts/smoke_native.sh
```

## 5) Vollständiger Reset (Erststart-Zustand)

```bash
sudo bash ops/debian/scripts/reset_state.sh
```

## 6) Backup / Support

```bash
bash ops/scripts/backup_copy.sh
bash ops/scripts/support_bundle.sh 7
```
