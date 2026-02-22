# Anlagenbuch â€“ Automatisierte Tests (Codex CLI Runbook & Testkatalog) (v0.1)

Dieses Dokument definiert **automatisierbare Tests** (API + UI) fÃ¼r das Anlagenbuch-Modul.
Es ist so geschrieben, dass es spÃ¤ter von **Codex CLI** als Grundlage genutzt werden kann, um
Testcode zu erzeugen, auszufÃ¼hren und die wichtigsten Funktionen regressionssicher zu prÃ¼fen. îˆ€citeîˆ‚turn0search0îˆ‚turn0search1îˆ

---

## 0. Zielbild

### Was soll mit den Tests abgedeckt werden?
1. **Direktlink / Routing**: Anlage wird ausschlieÃŸlich aus der URL (plant_slug) bestimmt.
2. **Eintrag erstellen**: Name, Betreff, Text.
3. **AnhÃ¤nge**: Upload (max. 50 MB), Metadaten, Download.
4. **Screenshot als Anhang**: technisch als PNG-Upload (Capture-UI separat).
5. **Entwurf / Wiederherstellung**: Draft lokal, Restore-Dialog.
6. **Offline-Queue**: offline weiterarbeiten, beim Online werden Requests nachgeholt.
7. **Bearbeitungsfenster**: nur eigener Author + nur bis editable_until (Schichtende + 15 min).
8. **Revision**: Append-only Audit + Hash-Kette (tamper-evident).
9. **Security-Basics**: Token-Mismatch, Upload-HÃ¤rtung, CORS (falls relevant), Rate limits.

### Testarten
- **API-Integrationstests**: Blackbox Ã¼ber HTTP (stabil, schnell, CI-tauglich).
- **UI-E2E-Tests**: Browserautomation (Playwright) fÃ¼r Draft/Offline/UX.
- **Manuelle Smoke-Checks** (nur wo Browser-Sicherheitsdialoge echte Automatisierung erschweren, z. B. Screen-Capture).

---

## 1. Voraussetzungen / Testumgebung

### 1.1 Konfiguration via Environment
Diese Variablen werden von Tests verwendet:

- `BASE_URL`  
  Beispiel: `https://SERVER:PORT`
- `PLANT_SLUG`  
  Beispiel: `MS_DEMO_ANLAGE_01`
- `API_PREFIX` (optional, Default `/api`)
- `TEST_AUTHOR_NAME` (Default `Testfahrer`)
- `TEST_AUTHOR_TOKEN` (wird pro Testlauf generiert)

### 1.2 Testdaten / Isolation
- Tests sollen **nicht** gegen Produktivdaten laufen.
- Empfehlung: **eigene Test-Plant** (z. B. `ZZ_TESTANLAGE`) oder Namespacing im plant_slug.
- Idempotenz: Client sendet `client_request_id` (UUID) fÃ¼r mutierende Requests.

### 1.3 ZeitabhÃ¤ngige Tests (Schichtfenster)
FÃ¼r echte Automatisierung braucht es eine TestmÃ¶glichkeit, die Serverzeit zu steuern.
Mindestens eine der folgenden Optionen:

**Option A (empfohlen): Test-Clock im Test-Environment**
- Server im Testmodus akzeptiert:
  - `X-Test-Now: <iso8601>` Header *oder*
  - `POST /api/test/clock` (nur in Testumgebung) um â€œnowâ€ zu setzen.

**Option B: feste Schichtzeiten + kurze Fenster**
- Nur in dedizierter Testanlage mit Mini-Schichten (z. B. 5 min), damit Tests ohne lange Wartezeit laufen.
- Weniger stabil, da abhÃ¤ngig von Realzeit.

---

## 2. Repo-Struktur (Vorschlag)

```
/docs
  Anlagenbuch_Modul_Technikkonzept_v0_1.md
  Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md
/tests
  /api
    test_entries.py
    test_attachments.py
    test_audit_hashchain.py
    test_edit_window.py
  /ui
    test_draft_restore.spec.ts
    test_offline_queue.spec.ts
  requirements.txt (falls Python)
  package.json (falls Playwright/Node)
```

> Die konkrete Sprache (Python/Node/.NET) legen wir spÃ¤ter fest. Dieses Dokument definiert die **Szenarien**.

---

## 3. Codex CLI: AusfÃ¼hrungs-Runbook (spÃ¤ter)

> Ziel: Codex bekommt dieses Dokument und erzeugt/aktualisiert daraus Testcode.

### 3.1 Beispiel-Prompt fÃ¼r Codex CLI
```bash
codex "Lies docs/Anlagenbuch_Modul_AutoTests_CodexCLI_v0_1.md. Erzeuge automatisierte Tests (API + UI) gemÃ¤ÃŸ Testkatalog. Nutze BASE_URL und PLANT_SLUG aus env. Erzeuge robuste Assertions und saubere Testdaten. Danach fÃ¼hre die Tests aus und liefere einen kurzen Report."
```

### 3.2 Erwartete Test-Kommandos (Beispiele)
Python/pytest:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r tests/requirements.txt
pytest -q
```

Playwright (Node):
```bash
npm ci
npx playwright install
npx playwright test
```

> Codex CLI ist ein lokaler Coding-Agent, der Aufgaben im Repo ausfÃ¼hren kann. îˆ€citeîˆ‚turn0search0îˆ‚turn0search1îˆ

---

## 4. API-Testkatalog (Blackbox)

### Notation
- **Given / When / Then** (BDD-Stil)
- Jeder Test erzeugt eigene Ressourcen und speichert IDs im Testkontext.

---

### API-01: Plant-AuflÃ¶sung (plant_slug)
**Given** `PLANT_SLUG` existiert  
**When** `GET {BASE_URL}{API_PREFIX}/plants/{PLANT_SLUG}`  
**Then**
- Status `200`
- Response enthÃ¤lt `plant_slug == PLANT_SLUG`
- Response enthÃ¤lt Uploadregeln: `max_file_size_mb == 50` (oder analog)

Negativ:
- **API-01-N1**: unknown slug â†’ `404`

---

### API-02: Eintrag erstellen (happy path)
**When** `POST /plants/{PLANT_SLUG}/entries`
```json
{
  "client_request_id": "<uuid>",
  "author_name": "<TEST_AUTHOR_NAME>",
  "author_token": "<uuid>",
  "subject": "Test-Betreff",
  "body": "Test-Text"
}
```
**Then**
- Status `201`
- Response enthÃ¤lt `entry_id`
- Response enthÃ¤lt `editable_until` (ISO)
- **GET /entries/{entry_id}** liefert Felder konsistent zurÃ¼ck

---

### API-03: Eintrag erstellen â€“ Validation
- **API-03-N1**: fehlender `subject` â†’ `400`
- **API-03-N2**: subject zu lang (falls Limit) â†’ `400`
- **API-03-N3**: body leer (falls nicht erlaubt) â†’ erwartetes Verhalten definieren

---

### API-04: Eintrag bearbeiten (nur author_token + Zeitfenster)
**Given** Eintrag aus API-02  
**When** `PATCH /entries/{id}` mit korrektem `author_token` innerhalb Fenster  
**Then**
- Status `200`
- `updated_at` geÃ¤ndert
- Audit enthÃ¤lt Event `EntryUpdated` (siehe API-10)

Negativ:
- **API-04-N1** falscher token â†’ `403`
- **API-04-N2** nach `editable_until` â†’ `403`

> FÃ¼r **API-04-N2** wird Test-Clock empfohlen (Abschnitt 1.3).

---

### API-05: Attachment Upload (<= 50 MB)
**Given** Eintrag aus API-02  
**When** `POST /entries/{id}/attachments` (multipart) mit Datei 1â€“5 MB  
**Then**
- Status `201`
- Response enthÃ¤lt `attachment_id`, `size_bytes`, `mime`, `filename_original`
- **GET /entries/{id}** listet Attachment

---

### API-06: Attachment Upload â€“ 50 MB Limit (413)
**Given** Eintrag aus API-02  
**When** Upload einer Datei > 50 MB  
**Then**
- Status `413 Payload Too Large`
- Keine Attachment-Resource erzeugt

---

### API-07: Attachment Upload â€“ Medien-Typ (optional Whitelist)
Falls Whitelist aktiv:
- Upload `.exe` oder `application/x-msdownload` â†’ `415 Unsupported Media Type`

---

### API-08: Screenshot als Attachment (serverseitig identisch)
**Given** Eintrag aus API-02  
**When** Upload einer PNG-Datei mit `kind=SCREENSHOT`  
**Then**
- Status `201`
- Attachment `kind == SCREENSHOT`

> Der **Browser-Capture** selbst ist UI/Manual (siehe UI-06), aber die Speicherung ist API-testbar.

---

### API-09: Liste / Suche
**When** `GET /plants/{PLANT_SLUG}/entries?from=...&to=...&q=Test-Betreff`  
**Then**
- Status `200`
- Eintrag aus API-02 ist enthalten

---

### API-10: Audit / Events + Hash-Kette validieren
> Voraussetzung: Endpoint vorhanden, z. B. `GET /entries/{id}/events`
oder Audit-Auszug in `GET /entries/{id}`.

**Given** Eintrag erzeugt + Attachment hinzugefÃ¼gt + Update durchgefÃ¼hrt  
**When** Audit-Events abgerufen  
**Then**
- Events sind **append-only** (keine LÃ¶sch/Rewrite-Operationen)
- Reihenfolge ist chronologisch
- FÃ¼r jedes Event gilt:
  - `hash == SHA256(prev_hash + canonical_json(meta+payload))`
  - Erstes Event hat `prev_hash == "GENESIS"` (oder definierter Wert)

**Negativ/Robustheit:**
- **API-10-N1**: Wenn Eventliste leer â†’ Fehler, da mindestens `EntryCreated` erwartet.

---

### API-11: Idempotenz (client_request_id)
**Given** POST aus API-02 mit `client_request_id = X`  
**When** gleicher POST erneut mit gleicher ID  
**Then**
- Kein Duplikat: Server liefert entweder denselben `entry_id` oder `200/201` mit Hinweis
- Liste enthÃ¤lt nur **einen** Eintrag fÃ¼r diese Anfrage

---

### API-12: Rate Limiting (429)
Wenn Rate limit aktiv:
- **When** N schnelle POST-Requests (z. B. 100 in kurzer Zeit)  
- **Then** zumindest ab Schwelle: `429 Too Many Requests`

> Wenn ihr Rate-Limits erst spÃ¤ter aktiviert, kann API-12 vorerst â€œoptionalâ€ markiert sein.

---

## 5. UI-E2E-Testkatalog (Playwright oder vergleichbar)

> Ziel: Draft/Offline/UX-Funktionen regressionssicher prÃ¼fen.
> UI-Tests benÃ¶tigen stabile Selectors (data-testid), z. B.:
> - `data-testid="subject"`, `"body"`, `"author-name"`, `"save-draft"`, `"submit-entry"`, `"offline-banner"`

### UI-01: Direktlink zeigt Anlage und Liste
**When** Browser Ã¶ffnet `/Schichtbuch/{PLANT_SLUG}`  
**Then**
- Titel enthÃ¤lt Anlagenname/slug
- Liste ist sichtbar
- â€œNeuâ€-Button sichtbar

---

### UI-02: Draft Autosave (lokal) + Restore-Dialog
**Given** Seite offen  
**When** Nutzer tippt Name/Betreff/Text, navigiert weg oder reloadet  
**Then**
- Beim erneuten Ã–ffnen erscheint Dialog: â€žLetzten Entwurf wiederherstellen?â€œ
- Restore fÃ¼llt Felder korrekt
- Verwerfen leert Draft

---

### UI-03: Eintrag absenden online
**When** Felder fÃ¼llen + Absenden  
**Then**
- UI zeigt â€œGespeichertâ€
- Eintrag erscheint in Liste
- Detailansicht zeigt Daten korrekt

---

### UI-04: Offline-Banner + lokale Erfassung
**When** Netzwerk in Browserautomation deaktiviert (offline)  
**Then**
- Offline-Banner sichtbar
- Nutzer kann weiter tippen (Draft bleibt erhalten)
- Absenden erzeugt â€žlokalen Pending-Statusâ€œ (z. B. â€œWird Ã¼bertragenâ€¦â€)

---

### UI-05: Offline â†’ Online Sync (Queue)
**Given** Offline erzeugter Pending-Eintrag  
**When** Netzwerk wieder online  
**Then**
- Queue wird abgearbeitet
- Pending-Status verschwindet
- Eintrag hat echte `entry_id` vom Server
- AnhÃ¤nge (falls offline erzeugt) werden nachgeladen

---

### UI-06 (optional/manual): Screenshot-Capture UI
> Automatisierung ist je nach Browser/Policy eingeschrÃ¤nkt, da Screen-Capture User-Prompt erfordert.

Manuell (Smoke):
1. Klick â€žScreenshot aufnehmenâ€œ
2. Bildschirm/Tab wÃ¤hlen
3. Crop setzen, bestÃ¤tigen
4. PNG erscheint als Attachment in UI
5. Nach Absenden ist Attachment im Server sichtbar

---

## 6. Nichtfunktionale Checks (kurz)

### NF-01: GroÃŸe AnhÃ¤nge
- Upload 49 MB: OK
- Upload 51 MB: 413

### NF-02: Robustheit Offline
- Browser schlieÃŸen wÃ¤hrend offline â†’ erneut Ã¶ffnen â†’ Draft/Queue bleibt erhalten

### NF-03: Performance (Intranet)
- Liste 500 EintrÃ¤ge: Paging funktioniert, UI bleibt nutzbar

---

## 7. Reporting / Ergebnisformat (fÃ¼r CI)

Empfohlen:
- JUnit XML Output (pytest `--junitxml`, Playwright reporter junit)
- ZusÃ¤tzlich: kurzer Textreport
  - Anzahl Tests, passed/failed
  - Liste fehlgeschlagener Tests mit Request/Response Snippets (gekÃ¼rzt)
  - Screenshots/Traces bei UI-Fehlern

---

## 8. â€žDefinition of Doneâ€œ fÃ¼r Test-Suite

Die Test-Suite gilt als einsatzbereit, wenn:
- API-01â€¦API-11 laufen stabil in Testumgebung
- UI-01â€¦UI-05 laufen stabil (headless)
- Zeitfenster-Test (API-04-N2) ist deterministisch (Test-Clock oder Mini-Schichten)
- 50 MB Limit ist serverseitig abgesichert (413)
- Audit Hash-Kette wird mindestens fÃ¼r 3 Events korrekt geprÃ¼ft


