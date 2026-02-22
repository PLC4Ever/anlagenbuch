# AnlagenbuchServer â€“ Build & Test Runbook (Codex CLI / Podman Standalone) (v0.3)
Stand: 2026-02-21 (Europe/Berlin)

> Zweck: Dieses Dokument ist die **einzige** Arbeitsanweisung, damit ein CLI/Codex-Lauf ohne RÃ¼ckfragen ein vollstÃ¤ndiges, lauffÃ¤higes Standalone-System erzeugt:
> - **2 Module**: Anlagenbuch/Schichtbuch + Tickets (inkl. Reporting)
> - **Admin-Portal** (voll administrierbar)
> - **Podman Standalone** (Quadlet/systemd), inkl. Volumes, Reverse Proxy, Healthchecks
> - **Ops/Debug Service** inkl. Log/Trace-Dateien (Rotation 30 Tage) + Support-Bundle
> - **Automatisierte Tests** (â€œSmokeâ€ + â€œGunâ€), die Funktionen prÃ¼fen und Regressionen finden

---

## 0) Quellen, die 1:1 umzusetzen sind (nicht neu interpretieren)
Diese Repo-Dateien sind maÃŸgeblich und werden in `/docs` abgelegt und als Requirements umgesetzt:

- `docs/Anlagenbuch_Modul_Technikkonzept_v0_1.md`
- `docs/schichtbuch_ticket_workflow_addendum_noreroute.md`
- `docs/Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md`
- `docs/schichtbuch_ticket_reporting_test_instructions.md`

---

## 1) Harte Regeln / Non-Negotiables

### 1.1 Immutable Kontext aus Link (beide Module)
- `plant_slug` / `plantId` wird **ausschlieÃŸlich aus URL/Query** bestimmt und ist **immutable**.
- **Kein Re-Routing / kein Move**: Weder EintrÃ¤ge noch Tickets dÃ¼rfen nachtrÃ¤glich zu einer anderen Anlage/Bereich verschoben werden.
- Fehlzuordnung wird ausschlieÃŸlich Ã¼ber **Status/Event** gelÃ¶st (`CANCELLED_WRONG_PLANT`, Reason `WRONG_PLANT_LINK`) + CTA â€žneu anlegenâ€œ.

### 1.2 Anlagenbuch (Schichtbuch)
- Public Link: `/Schichtbuch/<plant_slug>` (SPA)
- Zero-HÃ¼rde (MVP): Name, Betreff, Text (kein Login im Public)
- AnhÃ¤nge: **max 50 MB pro Datei** (HTTP 413)
- Offline-Queue + Draft Restore (IndexedDB)
- Bearbeitungsfenster: **Schichtende + 15 Minuten** (`editable_until`)
- Revisionssicher: Append-only Events + **Hash-Kette** (tamper-evident)

### 1.3 Tickets + Reporting
- Public Ticket Create ohne HÃ¼rden: `POST /api/public/tickets?plantId=...`
- Public Status/Timeline ohne interne Notizen
- Dispatcher Routing deterministisch aus Prefix `MS_/T_/KS_/SV_`
- Outbox/Deliveries/Dead-letter + Retry per Ops API
- Reporting: Exporte (CSV/JSON/XML/XLSX/PDF/DOCX) + Schedules + Email-Verteilung (Fake-Sink)

---

## 2) Festgelegte Tech-Entscheidungen (damit keine RÃ¼ckfragen entstehen)

### 2.1 Backend
- Sprache: **Python 3.12**
- Framework: **FastAPI**
- ORM: **SQLAlchemy 2.x**
- Migrations: **Alembic**
- Auth (Internal/Admin): **Session Cookie** (HttpOnly) + RBAC
- Public: Tokens (author/public) werden **nur gehasht** gespeichert

### 2.2 Frontends (3 SPAs)
- `apps/ui-schichtbuch` (Public)
- `apps/ui-tickets` (Public)
- `apps/ui-admin` (Internal)
- Tech: React + Vite + TypeScript
- E2E: Playwright (UI tests)

### 2.3 Datenbank + Storage
- DB: PostgreSQL 16
- Files/Reports: Host Volume (kein S3 nÃ¶tig)
- Upload outside webroot, random storage names

### 2.4 Reverse Proxy
- **Caddy** (einfach, robust)
- Fix: **HTTP auf 8080** (MVP, â€œBrowser-Link eingeben und losâ€)
- TLS/HTTPS ist **nicht Teil des MVP** und wird bewusst weggelassen (kann spÃ¤ter im Proxy ergÃ¤nzt werden)

### 2.5 SMTP Fake-Sink (fÃ¼r Reporting Tests)
- **Mailpit** Container (SMTP + Web UI)

---

## 3) Ziel-URLs (Dokumentation fÃ¼r Nutzer)

> Hostname/IPv4 des Servers sei `SERVER`.

### 3.1 Public: Anlagenbuch
- Liste: `http://SERVER:8080/Schichtbuch/<plant_slug>`
- Beispiele:
  - `http://SERVER:8080/Schichtbuch/MS_DEMO_ANLAGE_01`
  - `http://SERVER:8080/Schichtbuch/T_DEMO_ANLAGE_03`

### 3.2 Public: Tickets
- Create/Status UI: `http://SERVER:8080/Tickets/<plant_slug>`
- Ticket-Statusseite (token-basiert): `http://SERVER:8080/Tickets/status/<public_token>`

### 3.3 Admin
- Admin UI: `http://SERVER:8080/admin`
- Default Seed Admin:
  - user: `admin_1`
  - pass: `admin_demo_pw_change` (MUSS beim ersten Login geÃ¤ndert werden)

### 3.4 Ops / Debug
- Ops UI: `http://SERVER:8080/ops`
- Mailpit UI (nur Intranet, optional zusÃ¤tzlich hinter Proxy): `http://SERVER:8080/ops/mail`

### 3.5 API
- API Base: `http://SERVER:8080/api`
- Swagger UI: `http://SERVER:8080/api/docs`
- OpenAPI JSON: `http://SERVER:8080/api/openapi.json`
- Health (root, nicht unter /api):
  - `GET /healthz` (liveness)
  - `GET /readyz` (readiness)

---

## 4) Git Repo Struktur (lokales Git, ohne Remote)

### 4.1 Repo Name
- Ordner/Repo: `anlagenbuch-server`

### 4.2 Initialisierung (lokal)
```bash
mkdir -p anlagenbuch-server
cd anlagenbuch-server
git init
git checkout -b main
```

### 4.3 Struktur (muss exakt so entstehen)
```
anlagenbuch-server/
  README.md
  .editorconfig
  .gitignore
  Makefile

  docs/
    Anlagenbuch_Modul_Technikkonzept_v0_1.md
    schichtbuch_ticket_workflow_addendum_noreroute.md
    Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md
    schichtbuch_ticket_reporting_test_instructions.md

  services/
    api/
      app/
        main.py
        settings.py
        deps.py
        routers/
          plants.py
          schichtbuch.py
          tickets_public.py
          tickets_internal.py
          reporting.py
          ops.py
          auth.py
        domain/
          audit_hashchain.py
          outbox.py
          files.py
          shift.py
          reporting_engine.py
          sla.py
        db/
          models.py
          migrations/ (alembic)
        workers/
          outbox_publisher.py
          reporting_scheduler.py
          health_watchdog.py
        logging/
          logging_config.py   # json logs + trace logs (30d)
      tests_smoke/
        smoke_http.py         # minimal smoke checks (no pytest)
      pyproject.toml
      Dockerfile

  apps/
    ui-schichtbuch/ (React+Vite)
    ui-tickets/ (React+Vite)
    ui-admin/ (React+Vite)

  tests/
    api/ (pytest)
    ui/  (playwright)
    data/ (test fixtures)

  ops/
    caddy/
      Caddyfile
    podman/
      quadlet/
        anlagen-postgres.container
        anlagen-app.container
        anlagen-caddy.container
        anlagen-mailpit.container
      env/
        app.env
        postgres.env
    scripts/
      install_quadlets.sh
      backup_copy.sh
      rotate_logs.sh
      support_bundle.sh

  tools/
    sb_agent.py     # â€œone commandâ€ runner: up/down/test/smoke/bundle
    seed.py         # DB seed (plants/users/roles/config)
    webhook_stub.py # fake endpoint for outbox failure tests
```

### 4.4 Git Commits
- Commit 1: â€œchore: repo scaffold + docsâ€
- Commit 2: â€œfeat: backend core + db schema + seedâ€
- Commit 3: â€œfeat: public UIs + admin UIâ€
- Commit 4: â€œfeat: podman quadlets + opsâ€
- Commit 5: â€œtest: api + ui test suitesâ€

---

## 5) Datenbank-Schema (MVP + Tickets + Reporting + Ops)

> Umsetzung: SQLAlchemy Models + Alembic Migrationen. ZusÃ¤tzlich `docs/db_schema.sql` automatisch generieren lassen (aus Models).

### 5.1 Kern
- `plants` (slug unique)
- `areas` (MS/T/KS/SV)
- `users`, `roles`, `permissions`, `user_roles`, `role_permissions`
- `idempotency_keys` (request de-dup)

### 5.2 Anlagenbuch
- `shift_entries`
- `shift_entry_events` (append-only) inkl. `prev_hash`, `hash`
- `files`, `file_links` (scope_type/scope_id)

### 5.3 Tickets
- `tickets`
- `ticket_events` (append-only) inkl. Hash-Kette
- `ticket_public_tokens` (nur hash)
- `ticket_assignments` (optional, oder in tickets)

### 5.4 Outbox / Deliveries / Dead-letter
- `outbox_events` (transactional)
- `deliveries` (target, attempts, last_error)
- `dead_letter_deliveries`

### 5.5 Reporting
- `report_runs` (queued/running/done/failed)
- `report_artifacts` (format, path, size, sha256)
- `report_schedules` (weekly/monthly/yearly + recipients)
- `report_deliveries` (email fake + status)

### 5.6 Ops / Monitoring
- `ops_health_snapshots` (timestamp, db_ok, disk_ok, backlog, last_error)
- `ops_error_index` (timestamp, route, trace_id, exception_type, message, file_ref)

---

## 6) API â€“ Endpoint-Liste (OpenAPI muss vollstÃ¤ndig generiert werden)

### 6.1 Plants
- `GET /api/plants/{plant_slug}` (public)
- `GET /api/plants` (admin)
- `POST /api/plants` (admin)
- `PATCH /api/plants/{plant_slug}` (admin)

### 6.2 Anlagenbuch (Schichtbuch)
- `GET /api/plants/{plant_slug}/entries?from&to&q&limit&cursor`
- `POST /api/plants/{plant_slug}/entries` (idempotent via `client_request_id`)
- `GET /api/entries/{entry_id}`
- `PATCH /api/entries/{entry_id}` (403 wenn token falsch oder editable_until Ã¼berschritten)
- `POST /api/entries/{entry_id}/attachments` (multipart, 50MB limit, 413)
- `GET /api/entries/{entry_id}/events` (audit)
- `POST /api/entries/{entry_id}/events` (append-only)

### 6.3 Tickets (Public)
- `POST /api/public/tickets?plantId=<plant_slug>`
- `GET /api/public/tickets/{token}`
- `POST /api/public/tickets/{token}/reply` (optional, wenn aktiviert)
- `POST /api/public/tickets/{token}/attachments` (optional)

### 6.4 Tickets (Internal)
- `GET /api/tickets?status&department&area`
- `GET /api/tickets/{id}`
- `POST /api/tickets/{id}/triage`
- `POST /api/tickets/{id}/assign`
- `POST /api/tickets/{id}/status`
- `POST /api/tickets/{id}/attachments`
- **KEIN** Endpoint existiert, um `plant_id` zu Ã¤ndern.

### 6.5 Reporting
- `POST /api/reporting/exports`
- `GET /api/reporting/runs/{id}`
- `GET /api/reporting/runs/{id}/artifacts/{artifact_id}`
- `POST /api/reporting/schedules`
- `GET /api/reporting/schedules`
- `POST /api/reporting/schedules/{id}/run-now`

### 6.6 Ops / Debug
- `GET /healthz`, `GET /readyz`
- `GET /api/ops/status`
- `GET /api/ops/errors?from&to`
- `GET /api/ops/logs/download?days=7` (Support-Bundle ZIP)
- `POST /api/ops/deliveries/{id}/retry`

### 6.7 Test Clock (nur Test-ENV, zwingend fÃ¼r deterministische Schichtfenster-Tests)
- `POST /api/test/clock` (setzt â€œnowâ€)
- oder alternativ Header `X-Test-Now: <iso8601>` (nur wenn ENV=Test)

---

## 7) Logging, Fehlererkennung, Trace-Dateien (Rotation 30 Tage)

### 7.1 Anforderungen
- Server soll Fehler/Probleme erkennbar machen (Admin/Ops UI)
- Trace-Dateien sollen sich nach 30 Tagen â€œÃ¼berschreibenâ€ (praktisch: **tÃ¤glich rotieren, 30 Tage behalten, Ã¤ltere lÃ¶schen**)
- Debug-Hilfe: Support-Bundle zum Download

### 7.2 Umsetzung (Pflicht)
- Jeder Request bekommt `trace_id` (UUIDv4) â†’ in Response Header `X-Trace-Id`
- Logs als JSON Lines in `/srv/anlagenserver/logs/` (Host Volume)
  - `app.log` (info)
  - `error.log` (exceptions + stack)
  - `trace.log` (request spans / latency / key events)
- Rotation **in-app** via Python `TimedRotatingFileHandler`: daily, `backupCount=30`, Ã¤ltere automatisch lÃ¶schen; alte Files werden zusÃ¤tzlich gzip-komprimiert (rotator)
- ZusÃ¤tzlich: bei 5xx schreibt Server einen **Trace-Snapshot** (sanitized) in `traces/`:
  - enthÃ¤lt trace_id, route, status, exception class, short request meta (ohne tokens)
  - keine sensitiven Inhalte (Tokens/PasswÃ¶rter) in Logs

### 7.3 Ops Watchdog (Pflicht)
Worker `health_watchdog.py` lÃ¤uft alle 60s:
- DB connectivity
- Disk free (files/logs)
- Outbox backlog + failed deliveries
- Antwortzeiten Rolling Window (optional)
Ergebnis in `ops_health_snapshots`, sichtbar in `/ops` und `/api/ops/status`.

### 7.4 Support-Bundle (Pflicht)
Admin Button â€œSupport-Bundle erstellenâ€:
- packt: letzte 7 Tage `error.log`, `trace.log`, `ops_health_snapshots` export, config dump (ohne secrets)
- erzeugt ZIP zum Download: `/api/ops/logs/download?days=7`

---

## 8) Backup (einfach: â€œKopieâ€)

### 8.1 Scope
- DB Dump + Files + minimal Config

### 8.2 Script
- `ops/scripts/backup_copy.sh`:
  1) `pg_dump` aus dem Postgres Container
  2) tar der Files + Reports
  3) legt Ergebnis unter `/srv/anlagenserver/backups/backup-copy/YYYY-MM-DD/`
  4) lÃ¶scht Backup-Ordner Ã¤lter als 14 Tage (Retention konfigurierbar)

> Offsite-Kopie auf anderen Firmenserver ist out-of-scope hier, aber â€œcopy to shareâ€ kann ergÃ¤nzt werden.

---

## 9) Podman Standalone (Quadlet + Volumes)

### 9.0 Fixe Proxy-Regel (wichtig fÃ¼r /api/docs)
**Caddy MUSS** `/api/*` als `handle_path` konfigurieren (Prefix wird gestripped), und FastAPI wird mit `root_path="/api"` gestartet.
Dadurch funktioniert Swagger zuverlÃ¤ssig unter `http://SERVER:8080/api/docs` (OpenAPI URL zeigt korrekt auf `/api/openapi.json`).

**Caddy (Prinzip):**
- `handle_path /api/* { reverse_proxy app:8000 }`
- `handle /healthz { reverse_proxy app:8000 }`
- `handle /readyz { reverse_proxy app:8000 }`
- `handle /ops/* { reverse_proxy app:8000 }`


### 9.1 Host-Pfade (fix, keine Fragen)
- `/srv/anlagenserver/pgdata`
- `/srv/anlagenserver/files`
- `/srv/anlagenserver/reports`
- `/srv/anlagenserver/logs`
- `/srv/anlagenserver/backups`
- `/srv/anlagenserver/config`

### 9.2 Quadlets (systemd)
- `anlagen-postgres.container`
- `anlagen-app.container`
- `anlagen-caddy.container`
- `anlagen-mailpit.container`

### 9.3 Ports (fix)
- Caddy: 8080 (http)
- Postgres: **nicht** nach auÃŸen exposen
- Mailpit: intern, optional via `/ops/mail` proxied

### 9.4 Healthchecks
- App Container HEALTHCHECK: `GET /readyz`
- Caddy Container: upstream check auf `/readyz`

### 9.5 Install/Start
- `ops/scripts/install_quadlets.sh`:
  - kopiert Quadlets nach `/etc/containers/systemd/`
  - `systemctl daemon-reload`
  - `systemctl enable --now anlagen-*.service`
- `tools/sb_agent.py up` muss das gleiche leisten (fÃ¼r â€œone commandâ€).

### 9.6 Rechte / AusfÃ¼hrung (fix)
- Quadlet-Installation und `systemctl enable --now ...` erfordern **root** oder **sudo**.
- `tools/sb_agent.py up` MUSS intern `sudo` nutzen (oder sauber abbrechen mit Hinweis), damit der Ablauf ohne RÃ¼ckfragen funktioniert.

---

## 10) Tests: â€œSmokeâ€ + â€œGunâ€ (Automatisiert, reproduzierbar)

### 10.1 Smoke Tests (sehr schnell)
Ziel: â€œStack lÃ¤uft, Links funktionieren, Basic Create klapptâ€.
- Script: `services/api/tests_smoke/smoke_http.py`
- Checks:
  - `/healthz` & `/readyz`
  - `GET /api/plants/MS_DEMO_ANLAGE_01`
  - Schichtbuch: create entry + list + attach small file
  - Ticket: create public ticket + public status page
  - Admin login (seed admin)
  - Ops status reachable

CLI:
```bash
python tools/sb_agent.py smoke
```

### 10.2 Gun Tests (voller Testkatalog)
Ziel: vollstÃ¤ndige FunktionsprÃ¼fung beider Module inkl. Offline/Draft/Reporting/Outbox.
- API: pytest suite in `tests/api/`
  - Muss den Katalog aus `docs/Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md` vollstÃ¤ndig abdecken.
  - Muss den Katalog aus `docs/schichtbuch_ticket_reporting_test_instructions.md` vollstÃ¤ndig abdecken.
- UI: Playwright suite in `tests/ui/`
  - Direktlink, Draft Restore, Offline Queue, Submit
  - Ticket public create + timeline
- Determinismus:
  - Test-Clock muss aktiv sein (ENV=Test)

CLI:
```bash
python tools/sb_agent.py test
```

### 10.3 â€œFix until greenâ€ Regel (fÃ¼r Codex CLI)
Codex muss nach jedem Lauf:
1) Tests ausfÃ¼hren
2) Fehler analysieren (Logs + traces)
3) Fix einchecken
4) Wiederholen, bis **Smoke** und **Gun** komplett grÃ¼n sind

---

## 11) Seed-Daten (muss automatisch erstellt werden)

### 11.1 Plants (mindestens)
- `MS_DEMO_ANLAGE_01`
- `MS_DEMO_ANLAGE_02`
- `T_DEMO_ANLAGE_03`
- `KS_DEMO_ANLAGE_04`
- `SV_DEMO_ANLAGE_05`
- `ZZ_TESTANLAGE` (fÃ¼r Tests)

### 11.2 Dispatcher Areas (Prefix-Mapping)
- `MS_` â†’ Area â€œMSâ€
- `T_`  â†’ Area â€œTâ€
- `KS_` â†’ Area â€œKSâ€
- `SV_` â†’ Area â€œSVâ€

### 11.3 Users/Rollen (mindestens)
- `admin_1` (Admin)
- `dispatcher_ms` (Dispatcher scope MS)
- `agent_ms_1` (Agent scope MS)
- optional: `auditor_1`, `teamlead_ms`

PasswÃ¶rter (initial, mÃ¼ssen beim ersten Login wechselbar sein):
- `admin_demo_pw_change`
- `dispatcher_demo_pw_change`
- `agent_ms_1_change_me`

### 11.4 Ticket Config
- Departments: Mechanik, Elektrik, IT
- Priorities: P1..P4 (rank 1..4)
- TicketTypes: StÃ¶rung, Wunsch, Wartung, IT, Safety
- SLA: mindestens 1 Regel (prefix oder department+priority)

---

## 12) Admin UI Sitemap (Pflichtseiten)

### Dashboard
- Health (DB/Disk/Outbox), Version, letzte Backups, letzte Errors

### Module
- Anlagenbuch settings (shift config, upload limit read-only=50MB)
- Tickets settings (public reply on/off, auto-close policy)
- Reporting settings (enable, schedules)

### Anlagen & Bereiche
- Plants CRUD
- Areas CRUD + Prefix mapping

### Tickets Backoffice
- Queue (Filter: status/area/department)
- Ticket Detail: timeline, triage, assign, status, attachments
- Wrong Plant: Cancelled with Reason + suggested_create_url

### Reporting
- Export erstellen (from/to + formats)
- Runs list + artifacts download
- Schedules CRUD + run-now
- Deliveries list + status

### Benutzer & Rollen
- Users CRUD, reset password
- Roles/Permissions view

### Ops
- Errors (filter by date, search by trace_id)
- Deliveries retry + dead-letter view
- Support-Bundle download
- Log Viewer (last N lines) + trace snapshots

---

## 13) Codex CLI â€“ â€œOne Promptâ€ Arbeitsauftrag

> Ziel: Codex liest dieses Dokument + die Dateien in `/docs` und baut alles.

Beispiel-Prompt:
```bash
codex "Lies RUNBOOK: AnlagenbuchServer â€“ Build & Test Runbook (v0.1). Erzeuge das Repo gemÃ¤ÃŸ Git-Struktur. Implementiere FastAPI Backend + React UIs + PostgreSQL Schema + Outbox/Reporting + Ops/Tracing (30 Tage Rotation). Erzeuge Podman Quadlets + Caddy Reverse Proxy. Implementiere Smoke+Gun Tests entsprechend docs/Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md und docs/schichtbuch_ticket_reporting_test_instructions.md. Starte Stack per Podman und fÃ¼hre alle Tests aus. Fixe Fehler iterativ bis alles grÃ¼n ist. Ergebnis: Browser-Aufruf der Links funktioniert sofort."
```

---

## 14) Definition of Done (Abnahme)
Erst â€œfertigâ€, wenn:
1) `python tools/sb_agent.py up` startet den Stack ohne manuelle Schritte
2) Links funktionieren:
   - `/Schichtbuch/MS_DEMO_ANLAGE_01`
   - `/Tickets/MS_DEMO_ANLAGE_01`
   - `/admin`
3) Uploadlimit 50MB enforced (413)
4) Hash-Kette in Audit Events korrekt
5) Kein Re-Routing (kein plant_id change endpoint)
6) Ops zeigt Fehler/Health; Logs/Traces rotieren (30 Tage)
7) `python tools/sb_agent.py smoke` ist grÃ¼n
8) `python tools/sb_agent.py test` ist grÃ¼n (API+UI+Reporting+Outbox)

