# Anlagenbuch Server (Debian Native)

Anlagenbuch + Tickets + Reporting mit FastAPI, React SPAs, PostgreSQL, systemd und Caddy.

Ziel dieses Repos: Betrieb auf Debian ohne Podman.

## Projektstatus

- Aktueller Stand: `v0.0.1`
- Hinweis: Das ist eine **nicht vollstaendige Vorabversion**.

## Voraussetzungen

- Debian mit `systemd`
- Offener TCP-Port `8080` (oder `80`, wenn Caddy auf Port 80 konfiguriert ist)
- `sudo` Rechte fuer Installation

## Schnellstart (Debian, vollautomatisch)

```bash
git clone <repo-url> anlagenbuch-server
cd anlagenbuch-server
sudo bash ops/debian/scripts/install_native.sh
```

Danach erreichbar unter:

- Startseite: `http://SERVER:8080/` (oder `http://SERVER/` bei Port 80)
- Schichtbuch: `http://SERVER:8080/Schichtbuch/MS_DEMO_ANLAGE_01`
- Tickets: `http://SERVER:8080/Tickets/MS_DEMO_ANLAGE_01`
- Admin: `http://SERVER:8080/admin/`
- Dispatcher: `http://SERVER:8080/dispatcher/`
- Endbearbeiter: `http://SERVER:8080/endbearbeiter/`
- Ops: `http://SERVER:8080/ops`
- API Docs: `http://SERVER:8080/api/docs` (oder `http://SERVER/api/docs` bei Port 80)
- REST API Dokumentation: `docs/REST_API_Dokumentation.md`

## Wichtige Skripte

- `ops/debian/scripts/install_native.sh`:
  Komplettinstallation (Pakete, PostgreSQL, venv, UI-Build, systemd, Caddy)
- `ops/debian/scripts/prepare_native.sh`:
  Runtime vorbereiten (venv + Python deps + UI build)
- `ops/debian/scripts/smoke_native.sh`:
  Smoke-Test gegen laufendes System
- `ops/debian/scripts/reset_state.sh`:
  Datenbank + Storage auf Erststart zuruecksetzen

## Manuelles Setup (ohne Vollscript)

```bash
bash ops/debian/scripts/prepare_native.sh
bash ops/debian/scripts/run_api.sh
```

## systemd Services

- `anlagen-api.service` (FastAPI/Uvicorn)
- `caddy.service` (Reverse Proxy auf `:8080`)
- `anlagen-logrotate.timer` + `anlagen-logrotate.service` (taeglich)

Die Log/Trace-Aufbewahrung ist auf 30 Tage ausgelegt via `ops/scripts/rotate_logs.sh`.

## Backup / Support

- Backup: `bash ops/scripts/backup_copy.sh`
- Support-Bundle: `bash ops/scripts/support_bundle.sh`

## Default Admin

- User: `admin_1`
- Passwort: `admin_demo_pw_change`

## Lizenz

Dieses Projekt steht unter der **Unlicense** (Public Domain).  
Jeder darf den Code frei nutzen, aendern, weitergeben und kommerziell verwenden.

