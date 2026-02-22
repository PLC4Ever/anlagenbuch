# Debian Native Betrieb (ohne Podman)

Dieses Verzeichnis enthaelt alles fuer den Betrieb auf einem Debian-Host ohne Container:

- `scripts/install_native.sh`: Vollinstallation (Pakete, PostgreSQL, venv, UI-Build, systemd, Caddy)
- `scripts/prepare_native.sh`: Runtime + UI-Build im bestehenden Checkout
- `scripts/smoke_native.sh`: Smoke-Test gegen laufenden Host
- `scripts/reset_state.sh`: Datenbank + Storage auf Erststart-Zustand zuruecksetzen
- `systemd/anlagen-api.service.template`: systemd-Service fuer FastAPI/Uvicorn
- `systemd/anlagen-logrotate.*`: taegliche Rotation fuer Logs/Traces (30 Tage Aufbewahrung)
- `caddy/Caddyfile`: Reverse Proxy auf Port `8080`
- `env/app.env.example`: Beispiel fuer `/etc/anlagenbuch/app.env`
