# SchichtbuchSuite â€“ Test-Anweisung (Automation) fÃ¼r Ticket- & Reporting-Funktionen

Stand: 2026-02-21  
Ziel: Diese Datei beschreibt **wie** und **was** automatisiert getestet werden soll, damit spÃ¤tere CLI/Codex-LÃ¤ufe (z.â€¯B. `python tools/sb_agent.py test`) die Ticket- und Reporting-Funktionen zuverlÃ¤ssig prÃ¼fen kÃ¶nnen.

> Fokus: **Integration-Tests** (API + DB + Worker) mit klaren, wiederholbaren AblÃ¤ufen.  
> Hinweis: Diese Anweisung ist absichtlich tool-agnostisch, passt aber zu eurer Struktur (services + agent script).

---

## 1) Grundprinzipien fÃ¼r die Tests

1. **Deterministisch**: Tests mÃ¼ssen ohne manuelle Schritte laufen.
2. **Isoliert**: Jede Test-Suite nutzt eine frische DB (oder schema/transaction rollback).
3. **Blackbox zuerst**: API-Endpunkte Ã¼ber HTTP testen, nicht nur Unit-Tests.
4. **Event-First**: Jede relevante Aktion muss auch im **AuditLedger** und (falls vorgesehen) in der **Outbox** sichtbar sein.
5. **Keine externen AbhÃ¤ngigkeiten**: Email/Webhooks werden Ã¼ber **Fake-Sinks** getestet (SMTP sink / webhook stub).
6. **Immutable Ticket Request**: Originaldaten (RequesterName/Subject/Text + plant_id aus Link) bleiben unverÃ¤ndert; alles Weitere Ã¼ber Events.

---

## 2) Test-Setup / Voraussetzungen

### 2.1 Infrastruktur (lokal/CI)
- DB: PostgreSQL (oder euer Standard)
- Storage fÃ¼r Attachments/Reports: lokaler Pfad (z.â€¯B. `./data/storage-test`) oder MinIO (optional)
- Email: SMTP sink (z.â€¯B. MailHog/Mailpit) **oder** internes Fake-Interface
- Zeit: â€žFake Clockâ€œ oder eingefrorene Zeit per Test-Helper (wichtig fÃ¼r SLA + Schedules)

### 2.2 Konfiguration (Test ENV)
Empfohlene Umgebungsvariablen:
- `ASPNETCORE_ENVIRONMENT=Test`
- `DB__CONNECTIONSTRING=...`
- `STORAGE__ROOT=.../storage-test`
- `EMAIL__MODE=FAKE` (oder SMTP sink)
- `OUTBOX__PUBLISHER=INPROCESS` (oder disabled + assertion auf outbox table)
- `REPORTS__ENABLE=true`
- `SLA__ENABLE=true`

### 2.3 Start/Stop
Der Test-Runner soll:
1) DB starten / Migrations ausfÃ¼hren  
2) Services starten (tickets-service + schichtbuch-service falls nÃ¶tig)  
3) Tests ausfÃ¼hren  
4) Services stoppen  
5) DB/Storage aufrÃ¤umen (oder behalten bei Debug)

---

## 3) Seed-Daten (MUSS vor Tests existieren)

### 3.1 Plants / Anlagen-Slugs (immutable aus Link)
- Prefixe: `MS_`, `T_`, `KS_`, `SV_`
- Beispiele:
  - `MS_DEMO_ANLAGE_01`
  - `MS_DEMO_ANLAGE_02`
  - `T_DEMO_ANLAGE_03`
  - `KS_DEMO_ANLAGE_04`
  - `SV_DEMO_ANLAGE_05`

### 3.2 Dispatcher-Bereiche (Routing)
Mapping Prefix â†’ Dispatcher Bereich:
- `MS_` â†’ Bereich â€žMSâ€œ
- `T_`  â†’ Bereich â€žTâ€œ
- `KS_` â†’ Bereich â€žKSâ€œ
- `SV_` â†’ Bereich â€žSVâ€œ

### 3.3 Users/Rollen
- `dispatcher_ms` (ROLE: Dispatcher, scope: MS)
- `agent_ms_1` (ROLE: Agent, scope: MS)
- `admin_1` (ROLE: Admin)
- optional: `auditor_1`, `teamlead_ms`

### 3.4 Config
- Departments: Mechanik, Elektrik, IT (minimal 3)
- Priorities: P1..P4 (rank 1..4)
- TicketTypes: StÃ¶rung/Wunsch/Wartung/IT/Safety (wie in v3)
- SLA-Regeln: mindestens 1 pro (plant/prefix oder department+priority)

---

## 4) Test-Suites (Pflicht)

### Suite A â€“ Public Ticket Create (Zero-HÃ¼rde)
**Ziel:** Anlagenfahrer kann ohne HÃ¼rden Ticket erstellen; plant_id kommt aus Link/Query; Original bleibt immutable.

**TestfÃ¤lle:**
1. `POST /api/public/tickets?plantId=MS_DEMO_ANLAGE_01`
   - body: requester_name, subject, description (optional attachment)
   - Erwartung:
     - 201 Created, enthÃ¤lt public token (oder status link)
     - Ticket status = NEW
     - Ticket.plant_id = aus Query (nicht aus Body)
     - AuditLedger enthÃ¤lt `TicketCreated`
     - Outbox enthÃ¤lt `TicketCreated` (falls aktiv)
2. Token-Sicherheit:
   - DB speichert `public_token_hash` (kein Klartext-Token)
3. Validation minimal:
   - Name/Betreff/Text mandatory (konfigurierbar, aber â€žleichtâ€œ)

### Suite B â€“ Public Status + Public Timeline
**Ziel:** Anlagenfahrer sieht Status und Ã¶ffentliche Updates; keine internen Notizen.

**TestfÃ¤lle:**
1. `GET /api/public/tickets/{token}` â†’ 200
   - enthÃ¤lt status, subject, public comments/timeline (ohne internal)
2. ungÃ¼ltiger token â†’ 404 (oder 401/404 nach Design)
3. Public Reply (wenn aktiviert):
   - `POST /api/public/tickets/{token}/reply`
   - erzeugt `TicketCommentAdded` (PUBLIC)
4. Sichtbarkeit:
   - Internal comment darf im public view nicht erscheinen

### Suite C â€“ Dispatcher Routing (Prefix-Bereich)
**Ziel:** Dispatcher sieht Tickets nur aus seinem Bereich (Prefix).

**TestfÃ¤lle:**
1. Ticket in `MS_...` erstellt â†’ `dispatcher_ms` sieht es in Triage/Queue
2. `dispatcher_ms` sieht **keine** Tickets von `T_/KS_/SV_`
3. Routing ist deterministisch aus `plant_id`/Prefix (kein re-routing mÃ¶glich)

### Suite D â€“ Triage & Queue (Auth)
**Ziel:** Klassifizieren (dept+priority+type), anschlieÃŸend Queue korrekt sortiert.

**TestfÃ¤lle:**
1. Dispatcher triagiert Ticket:
   - `POST /api/tickets/{id}/triage` setzt department + priority + ticketType (+ custom fields)
   - Status Transition: NEW/TRIAGE â†’ QUEUED (oder TRIAGE â†’ QUEUED)
   - AuditLedger: `TicketTriaged` + `TicketStatusChanged`
2. Queue Sortierung:
   - mehrere Tickets mit P1/P2/P3 + Alter + SLA deadline
   - `GET /api/tickets?status=QUEUED&department=...` ist sortiert nach:
     1) priority rank
     2) SLA deadline
     3) created_at

### Suite E â€“ Bearbeitung (Assign â†’ In Progress â†’ Resolve â†’ Close)
**Ziel:** Endbearbeiter arbeitet Ticket Ã¼ber Statuswechsel ab; Tickettext unverÃ¤ndert; Events wachsen.

**TestfÃ¤lle:**
1. Assign:
   - `POST /api/tickets/{id}/assign` â†’ assignee gesetzt
   - AuditLedger: `TicketAssigned`
2. IN_PROGRESS:
   - `POST /api/tickets/{id}/status` to IN_PROGRESS
3. Add Attachment:
   - `POST /api/tickets/{id}/attachments` (auth) â†’ artifact gespeichert
   - Event `TicketAttachmentAdded`
4. Resolve:
   - `POST /api/tickets/{id}/status` to RESOLVED + public resolution comment
5. Close (auto oder manuell):
   - `POST /api/tickets/{id}/status` to CLOSED (oder background auto-close job)
6. Public view zeigt:
   - Statuswechsel & public comments, aber keine internals

### Suite F â€“ â€žWrong Plant Linkâ€œ ohne Re-Routing
**Ziel:** Es darf nicht verschoben werden; stattdessen CANCELLED mit Reason + Link zum Neu-Erstellen.

**TestfÃ¤lle:**
1. Dispatcher setzt `CANCELLED` mit reason `WRONG_PLANT_LINK`
2. Public status view zeigt:
   - Hinweis + optionaler `suggested_create_url` (wenn implementiert)
3. AuditLedger enthÃ¤lt `TicketCancelledWrongPlant` oder StatusChanged + reason payload
4. Kein API existiert, um plant_id zu Ã¤ndern (negative test)

### Suite G â€“ Outbox / Deliveries / Dead-letter
**Ziel:** Event-Pipeline zuverlÃ¤ssig.

**TestfÃ¤lle:**
1. Nach create/triage/status: Outbox enthÃ¤lt Events (transactional)
2. Publisher Job:
   - verarbeitet outbox â†’ markiert published_at
3. Delivery failure:
   - Fake endpoint returns 500 â†’ attempts erhÃ¶ht, last_error gesetzt
4. Dead-letter nach max attempts:
   - Eintrag in `dead_letter_deliveries`
5. Admin retry:
   - `POST /api/ops/deliveries/{id}/retry` setzt status zurÃ¼ck / erzeugt neuen attempt

### Suite H â€“ Reporting: Manuelle Exporte (Woche/Monat/Jahr + Custom Range)
**Ziel:** ReportRun â†’ Artifacts in allen Formaten.

**TestfÃ¤lle:**
1. `POST /api/reporting/exports` mit:
   - plantId, from/to, formats: CSV, JSON, XML, XLSX, PDF, DOCX
2. ReportRun lifecycle:
   - status queued â†’ running â†’ done
   - Artifacts existieren, Storage Key valid, size_bytes > 0
3. Zugriff:
   - nur auth + RBAC; kein public access
4. AuditLedger:
   - `ReportRequested`, `ReportGenerated`

### Suite I â€“ Reporting: Schedules + Email-Verteilung
**Ziel:** Scheduled Reports laufen automatisch und werden per Email verteilt (Fake).

**TestfÃ¤lle:**
1. Schedule anlegen:
   - weekly/monthly/yearly (timezone Europe/Berlin)
2. Run-now:
   - `POST /api/reporting/schedules/{id}/run-now` erzeugt report_run
3. Distributor:
   - erzeugt `report_deliveries`, markiert sent
   - bei Failure: retry/dead-letter
4. Email Content (Fake):
   - subject enthÃ¤lt Zeitraum + plantId
   - body enthÃ¤lt KPI summary + Links (keine Tokens, keine sensitiven Daten)

---

## 5) Negativ-Tests (Pflicht)

- Forbidden transitions:
  - CLOSED â†’ IN_PROGRESS ohne REOPENED
- RBAC:
  - Agent kann nicht fremde Bereiche triagieren (wenn scope aktiv)
  - Public kann keine internal notes lesen
- Input limits:
  - Attachment size/type limits
- Token leakage:
  - Logs enthalten kein token

---

## 6) CLI-Runbook (fÃ¼r Codex/Agent)

### 6.1 Standardlauf
1) Start infra (db + fake smtp/webhook)  
2) Run migrations  
3) Start services  
4) Run tests  
5) Stop services

Beispiel (anpassen an Repo):
- `python tools/sb_agent.py test`
- `python tools/sb_agent.py` (smoke / e2e demo run)

### 6.2 Debugging
- `KEEP_TEST_DB=1` lÃ¤sst DB/Storage stehen
- Report artifacts bleiben in `STORAGE__ROOT` (zur Sichtkontrolle)

---

## 7) Akzeptanz-Kriterien (kurz)

- Anlagenfahrer: **zero-hÃ¼rde** Create + Status jederzeit sichtbar + public Timeline
- Dispatcher: Routing nach Prefix, Triage/Queue effizient, keine Re-Routing Funktion
- Bearbeiter: saubere Statuswechsel + Ereignisse/AnhÃ¤nge + LÃ¶sung
- AuditLedger: vollstÃ¤ndig, append-only
- Reporting: Exporte in allen Formaten, ZeitrÃ¤ume Woche/Monat/Jahr, Schedules + Email-Verteilung
- Ops: Jobs sichtbar, retries/dead-letter vorhanden


