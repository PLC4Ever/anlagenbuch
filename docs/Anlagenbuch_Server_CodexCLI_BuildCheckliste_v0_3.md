# AnlagenbuchServer â€“ Build-Checkliste (Codex CLI / ohne RÃ¼ckfragen) (v0.3)
Stand: 2026-02-21 (Europe/Berlin)

> Ziel: Diese Checkliste ist die **ausfÃ¼hrbare â€œToâ€‘Do + Expected Outcomeâ€** Version des Runbooks.  
> Codex/CLI soll sie **linear** abarbeiten: Repo erzeugen â†’ implementieren â†’ Podman starten â†’ Tests â†’ fixes bis grÃ¼n.  
> Ergebnis: Du gibst im Browser nur noch den Link ein und kannst sofort arbeiten.

---

## 1) Inputs / Requirements (mÃ¼ssen ins Repo unter `/docs`)
Kopiere unverÃ¤ndert:
- `Anlagenbuch_Modul_Technikkonzept_v0_1.md`
- `schichtbuch_ticket_workflow_addendum_noreroute.md`
- `Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md`
- `schichtbuch_ticket_reporting_test_instructions.md`

**Expected outcome:** `/docs` enthÃ¤lt exakt diese 4 Dateien.

---

## 2) Fixed Decisions (nicht diskutieren, nicht nachfragen)
- Backend: **FastAPI (Python 3.12)** + SQLAlchemy + Alembic
- DB: PostgreSQL 16 (Container)
- Reverse Proxy: **Caddy**
- Frontends: React+Vite (3 SPAs: Schichtbuch, Tickets, Admin)
- Email-Sink: **Mailpit** (Container) fÃ¼r Reporting-Tests
- Storage: Host-Volumes `/srv/anlagenserver/*`
- Auth intern: Session Cookie + RBAC; Public: token-basiert (nur hash speichern)
- Kein Move/Re-Routing: `plant_slug` ist immutable, Tickets/Entries nie verschieben

**Expected outcome:** Keine offenen Architekturfragen â€“ alles ist entschieden.

---

## 3) Ziel-Links (Dokumentation / spÃ¤ter im README wiederholen)
- Schichtbuch: `http://SERVER:8080/Schichtbuch/<plant_slug>`
- Tickets: `http://SERVER:8080/Tickets/<plant_slug>`
- Admin: `http://SERVER:8080/admin`
- Ops: `http://SERVER:8080/ops`
- API: `http://SERVER:8080/api` (+ Swagger: `/api/docs`)

**Wichtig (damit Swagger sicher lÃ¤uft):**
- Caddy nutzt `handle_path /api/*` (strippt `/api` vor dem Proxy)
- FastAPI startet mit `root_path="/api"`
- ZusÃ¤tzlich werden `/healthz`, `/readyz` und `/ops/*` direkt an die App reverse-proxied (nicht unter `/api`)

**Expected outcome:** Nach `up` sind alle Links erreichbar (Statuscode 200).

---

## 4) Repo erzeugen (lokales Git, keine Remote-AbhÃ¤ngigkeit)

### 4.1 Git Init
```bash
mkdir -p anlagenbuch-server
cd anlagenbuch-server
git init
git checkout -b main
```
**Expected outcome:** Repo existiert, Branch `main` aktiv.

### 4.2 Scaffold-Struktur anlegen
Erzeuge exakt diese Struktur (siehe Runbook fÃ¼r vollstÃ¤ndige Tree-Ansicht):
- `/services/api` (FastAPI)
- `/apps/ui-schichtbuch`, `/apps/ui-tickets`, `/apps/ui-admin` (React SPAs)
- `/ops/caddy`, `/ops/podman/quadlet`, `/ops/scripts`
- `/tools` (`sb_agent.py`, `seed.py`, `webhook_stub.py`)
- `/tests/api`, `/tests/ui`, `/tests/data`

**Expected outcome:** Tree entspricht Runbook; `git status` zeigt neue Dateien.

### 4.3 Commit 1
Commit-Message: `chore: repo scaffold + docs`

---

## 5) Backend implementieren (FastAPI)

### 5.1 Core (Settings/DI/DB)
- `settings.py`: ENV-Konfiguration (App/DB/Paths/Auth/TestClock)
- `deps.py`: DB Session + Auth deps
- `db/models.py`: alle Tabellen (siehe Runbook Abschnitt DB Schema)
- Alembic initialisieren + erste Migration

**Expected outcome:**
- `uvicorn app.main:app` startet lokal (dev)
- DB Migration lÃ¤uft durch (container oder local)

### 5.2 Harte Regeln implementieren
- **Immutable** `plant_slug` aus URL/Query
- **Kein Endpoint** fÃ¼r Ã„nderung von `plant_id` bei Entry/Ticket
- Falsche Anlage: Status/Event `CANCELLED_WRONG_PLANT` + Reason `WRONG_PLANT_LINK`

**Expected outcome:** Tests kÃ¶nnen nicht â€œverschiebenâ€; API lehnt ab.

### 5.3 Audit Hashâ€‘Chain (Entry + Ticket Events)
- Append-only event tables (`*_events`)
- `prev_hash` + canonical JSON + SHA256 â†’ `hash`
- API liefert Timeline/Events; Admin/Ops kann Hash-Chain prÃ¼fen

**Expected outcome:** `test_audit_hashchain.py` (aus Testkatalog) ist grÃ¼n.

### 5.4 Uploads (Files)
- Multipart Upload
- Max 50MB â†’ HTTP 413
- Storage auÃŸerhalb Webroot, random filename
- Metadaten + Link-Tabelle `file_links`

**Expected outcome:** Upload >50MB ergibt 413; Upload <50MB geht, Datei abrufbar.

### 5.5 Test Clock (nur Test-ENV)
- `POST /api/test/clock` oder `X-Test-Now` Header (nur wenn `ENV=test`)

**Expected outcome:** Bearbeitungsfenster-Tests sind deterministisch.

### 5.6 Outbox / Deliveries / Dead-letter
- Transactional outbox table
- Publisher Worker: publish â†’ mark `published_at`
- Delivery tracking: attempts, last_error
- Dead-letter nach max attempts
- Ops Retry: `POST /api/ops/deliveries/{id}/retry`

**Expected outcome:** Ticket/Reporting Tests Suite G (Outbox/Dead-letter) ist grÃ¼n.

### 5.7 Reporting Engine (exports + schedules)
- Exporte: CSV/JSON/XML/XLSX/PDF/DOCX (mind. stub-bytes fÃ¼r PDF/DOCX ok, solange Tests â€œfile exists + mimeâ€ akzeptieren)
- Runs: queued/running/done/failed
- Schedules: weekly/monthly/yearly + run-now
- Email: via Mailpit (SMTP) oder Fake-Mode (`EMAIL__MODE=FAKE`)

**Expected outcome:** Reporting Tests (Suite C/D/E/F) sind grÃ¼n.

### 5.8 Ops / Debug Service (Pflicht)
- `trace_id` pro Request â†’ Response Header `X-Trace-Id`
- JSON Logs: `app.log`, `error.log`, `trace.log` in `/srv/anlagenserver/logs`
- Rotation: daily, keep 30 days, compress, delete older
- Watchdog Worker alle 60s â†’ `ops_health_snapshots`
- Support-Bundle: ZIP der letzten 7 Tage + health snapshots (ohne secrets)

**Expected outcome:**
- `/ops` zeigt Health + Errors
- Trace snapshots werden bei 5xx geschrieben
- Ã„ltere Logs >30 Tage werden entfernt (Rotation Script/Timer)

### 5.9 Commit 2
Commit-Message: `feat: backend core + db schema + ops`

---

## 6) Frontends implementieren (3 SPAs)

### 6.1 UI-Schichtbuch (Public)
- Direktlink pro Anlage
- Create Entry (Name/Betreff/Text)
- Draft (IndexedDB) + Offline Queue (Retry when online)
- Timeline/Events sichtbar (ohne interne Notizen)

**Expected outcome:** Playwright `test_offline_queue.spec.ts` grÃ¼n.

### 6.2 UI-Tickets (Public)
- Ticket erstellen (Name/Betreff/Text)
- Status/Timeline sehen (token-basiert)
- Wrong plant: â€œcancelled wrong plantâ€ sichtbar + CTA â€œneu anlegenâ€

**Expected outcome:** E2E Ticket Create + View grÃ¼n.

### 6.3 UI-Admin (Internal)
- Login + Password change
- Plants/Areas CRUD + Prefix mapping
- Tickets Backoffice: Queue, Detail, assign/status/events
- Reporting: runs, schedules, artifacts
- Ops: errors, deliveries retry, support bundle download

**Expected outcome:** Admin Flows in UI Tests grÃ¼n.

### 6.4 Commit 3
Commit-Message: `feat: public uis + admin ui`

---

## 7) Podman Standalone (Quadlet) + Reverse Proxy

### 7.1 Host Volumes (fix)
Erzeuge:
- `/srv/anlagenserver/pgdata`
- `/srv/anlagenserver/files`
- `/srv/anlagenserver/reports`
- `/srv/anlagenserver/logs`
- `/srv/anlagenserver/backups`
- `/srv/anlagenserver/config`

**Expected outcome:** Pfade existieren und sind schreibbar fÃ¼r Container.

### 7.2 Quadlets erstellen
Unter `ops/podman/quadlet/`:
- `anlagen-postgres.container`
- `anlagen-app.container`
- `anlagen-caddy.container`
- `anlagen-mailpit.container`

Caddy Routings:
- `/api/*` â†’ app
- `/admin` â†’ ui-admin
- `/Schichtbuch/*` â†’ ui-schichtbuch
- `/Tickets/*` â†’ ui-tickets
- `/ops/*` â†’ ops ui (aus app) + optional `/ops/mail` â†’ mailpit

**Expected outcome:** `systemctl enable --now anlagen-*.service` startet alles.

### 7.3 Install Script
`ops/scripts/install_quadlets.sh`:
- kopiert nach `/etc/containers/systemd/`
- `systemctl daemon-reload`
- enabled + start

**Expected outcome:** One-shot install ohne Interaktion.

### 7.4 Commit 4
Commit-Message: `feat: podman quadlets + caddy + mailpit`

---

## 8) â€œOne commandâ€ Tooling (`tools/sb_agent.py`)
Implementiere Befehle:
- `up` (install quadlets + start)
- `down` (stop)
- `seed` (DB seed)
- `smoke` (smoke_http)
- `test` (pytest + playwright)
- `bundle` (Support-Bundle)

**Expected outcome:**
```bash
python tools/sb_agent.py up
python tools/sb_agent.py seed
python tools/sb_agent.py smoke
python tools/sb_agent.py test
```
laufen ohne Nachfragen.

---

## 9) Tests implementieren (Smoke + Gun)

### 9.1 Smoke (schnell, ohne pytest)
- `services/api/tests_smoke/smoke_http.py`
- PrÃ¼ft mindestens:
  - `/healthz`, `/readyz`
  - Plant lookup
  - Schichtbuch create/list
  - Ticket create/public view
  - Admin login
  - Ops status

**Expected outcome:** `python tools/sb_agent.py smoke` grÃ¼n.

### 9.2 Gun (voller Katalog)
- API: pytest (Blackbox HTTP) â€“ vollstÃ¤ndig gemÃ¤ÃŸ `docs/Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md`
- Tickets/Reporting: vollstÃ¤ndig gemÃ¤ÃŸ `docs/schichtbuch_ticket_reporting_test_instructions.md`
- UI: Playwright E2E fÃ¼r Draft/Offline/UX

**Expected outcome:** `python tools/sb_agent.py test` grÃ¼n.

### 9.3 Commit 5
Commit-Message: `test: api + ui suites (smoke+gun)`

---

## 10) â€œFix until greenâ€ (Codex Arbeitsmodus)
Schleife:
1) `smoke` + `test` laufen lassen
2) bei Fehlern: Trace-ID aus Header/Logs finden
3) Fix + Commit
4) Wiederholen bis alles grÃ¼n

**Expected outcome:** Endzustand â€œgrÃ¼nâ€ ohne manuelle Workarounds.

---

## 11) Abnahme (Definition of Done)
Erst fertig, wenn:
- `python tools/sb_agent.py up` â†’ Stack lÃ¤uft
- Browser Links:
  - `http://SERVER:8080/Schichtbuch/MS_DEMO_ANLAGE_01`
  - `http://SERVER:8080/Tickets/MS_DEMO_ANLAGE_01`
  - `http://SERVER:8080/admin`
  - `http://SERVER:8080/ops`
- Uploadlimit 50MB enforced (413)
- Hash-Kette korrekt
- Kein Re-Routing (kein plant change)
- Logs/Traces rotieren (30 Tage)
- Smoke + Gun komplett grÃ¼n

---

## 12) Codex CLI â€“ Copy/Paste Prompt
```bash
codex "Arbeite strikt nach: docs/Anlagenbuch_Server_CodexCLI_Runbook_v0_3.md und docs/Anlagenbuch_Server_CodexCLI_BuildCheckliste_v0_3.md. Erzeuge Repo + Implementierung + Quadlets + Tests. Starte via Podman. FÃ¼hre smoke+gun aus. Fixe iterativ bis alles grÃ¼n ist. Ergebnis: Links unter http://SERVER:8080 funktionieren sofort."
```

