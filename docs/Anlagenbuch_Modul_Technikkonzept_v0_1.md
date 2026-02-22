# Mini-Pflichtenheft / Technikkonzept: Anlagenbuch-Modul (v0.1)

Dieses Dokument beschreibt ein **Anlagenbuch** als Web-Modul, das in einen bestehenden Server eingebunden wird und **direkt per Link** (z. B. HMI/SCADA Button) pro Anlage geÃ¶ffnet werden kann.

Der Fokus liegt auf:
- **Zero-HÃ¼rde** fÃ¼r Anlagenfahrer (ohne Login im MVP)
- **Entwurfsmodus** mit lokaler Speicherung im Browser (Seitenwechsel/Reload Ã¼berleben)
- **Offline-FÃ¤higkeit** mit Upload-Queue (Sync bei wieder verfÃ¼gbarer Verbindung)
- **Screenshot-Erstellung** mit â€žEinrahmenâ€œ (Crop/Markup) und Ablage am Server
- **Revisionssicherheit** durch Append-only Audit-Events + Hash-Kette
- **Bearbeitungsfenster**: nur eigene Schicht + max. 15 Minuten nach Schichtende

---

## 1. Begriffe / Rollen

### Rollen
- **Anlagenfahrer (Public UI)**  
  Kann EintrÃ¤ge fÃ¼r eine Anlage erstellen (Betreff, Text, Name) sowie AnhÃ¤nge/Screenshot hinzufÃ¼gen.  
  Darf *eigene EintrÃ¤ge* nur innerhalb eines definierten Zeitfensters bearbeiten.
- **Schichtleiter / Dispatcher (Internal UI, optional spÃ¤ter)**  
  Kann EintrÃ¤ge sichten/auswerten, ggf. kommentieren oder als â€žfalsche Anlageâ€œ markieren (ohne UmhÃ¤ngen).
- **Admin (Internal)**  
  Konfiguration (Anlagenliste, Schichtzeiten), Betrieb, Export, Retention.

### Kernbegriffe
- **plant_slug**: Anlagenkennung aus der URL (z. B. `MS_DEMO_ANLAGE_01`)
- **author_token**: lokal erzeugte UUID (MVP), bindet Eintrag an â€ždiesen Browserâ€œ
- **shift_id**: vom Server berechnete Schicht-Instanz (z. B. 2026-02-21 / FrÃ¼h)
- **editable_until**: `Schichtende + 15 Minuten`

---

## 2. Grundregeln

### 2.1 Immutable Kontext aus dem Link
- `plant_slug` wird **ausschlieÃŸlich aus der URL** bestimmt und ist **immutable**.
- EintrÃ¤ge gehÃ¶ren immer genau zu **einer** Anlage.

### 2.2 Keine nachtrÃ¤gliche Umlenkung (â€žkein Re-Routingâ€œ)
- Es gibt **keine** Aktion, die einen bestehenden Eintrag nachtrÃ¤glich in eine andere Anlage â€žverschiebtâ€œ.
- Fehlzuordnungen werden **ohne Move** behandelt (siehe Abschnitt 7).

---

## 3. Ziele / Nicht-Ziele

### Ziele (MVP)
- Direktlink pro Anlage: `https://SERVER:PORT/Schichtbuch/<plant_slug>`
- Eintrag erfassen: Betreff, Text, Name
- AnhÃ¤nge hochladen (max. 50 MB pro Datei)
- Screenshot erstellen + Einrahmen (Crop) + Upload
- Entwurf lokal speichern + Wiederherstellung beim erneuten Ã–ffnen
- Offline weiterarbeiten, spÃ¤terer Sync
- Revisionslog (Append-only) + Hash-Kette
- Bearbeitung nur innerhalb: eigene Schicht + 15 Minuten

### Nicht-Ziele (MVP, spÃ¤ter mÃ¶glich)
- USB-Authentifizierung / Benutzerkonto
- Client-Agent (PC-Name, Hardwaredaten etc.)
- VollstÃ¤ndige Betriebs-/Auswertungs-UI (Dashboard) â€“ optional separat

---

## 4. Aufruf / Routing

### 4.1 URL-Schema
- Public:  
  `GET /Schichtbuch/<plant_slug>` â†’ lÃ¤dt SPA (Web-Modul)
- API-Basis:  
  `/api/...`

### 4.2 Plant-AuflÃ¶sung
- Frontend lÃ¤dt beim Start:  
  `GET /api/plants/<plant_slug>`  
  Antwort enthÃ¤lt:
  - `plant_id`, `plant_slug`, `display_name`
  - Schichtzeit-Konfiguration (oder Referenz)
  - Uploadregeln (z. B. max 50 MB)

---

## 5. Seiten / Wireframes (Public UI)

> Hinweis: Als SPA gedacht. â€žSeitenwechselâ€œ meint Routing innerhalb der SPA oder Browser-Reload.

### 5.1 Start / Liste (EintrÃ¤ge der Anlage)
**Zweck:** Ãœbersicht, Suche, neuer Eintrag.

```
+-------------------------------------------------------------+
| Anlagenbuch â€“ Anlage: MS_DEMO_ANLAGE_01              |
| [Neu]  Suche: [.................]  Zeitraum: [Heute v]      |
| Status: Online / Offline (Banner bei Offline)               |
+-------------------------------------------------------------+
| 21.02.2026  13:05  Betreff: ...     Autor: ...   [Ã–ffnen]   |
| 21.02.2026  11:22  Betreff: ...     Autor: ...   [Ã–ffnen]   |
| ...                                                         |
+-------------------------------------------------------------+
| Draft-Hinweis (falls vorhanden): [Wiederherstellen] [LÃ¶schen]|
+-------------------------------------------------------------+
```

### 5.2 Neuer Eintrag (Create)
**Zweck:** Eingabe + AnhÃ¤nge + Screenshot.

```
+-------------------------------------------------------------+
| Neuer Eintrag â€“ Anlage: <display_name>                      |
| Bearbeitbar bis: (nach Erstellung) <editable_until>         |
+-------------------------------------------------------------+
| Name:    [..........................]                      |
| Betreff: [..........................]                      |
| Text:                                                     |
| [.....................................................]    |
| [.....................................................]    |
+-------------------------------------------------------------+
| AnhÃ¤nge: [Datei hinzufÃ¼gen]  (max 50 MB je Datei)           |
| Screenshot: [Screenshot aufnehmen]                          |
|  - Vorschau / Crop / Markup                                 |
+-------------------------------------------------------------+
| [Als Entwurf behalten]   [Absenden]                         |
+-------------------------------------------------------------+
```

### 5.3 Detailansicht (Read)
**Zweck:** Inhalt, AnhÃ¤nge, Audit-Auszug, Bearbeiten (wenn erlaubt).

```
+-------------------------------------------------------------+
| Eintrag #123 â€“ Anlage: <display_name>                       |
| Erstellt: 21.02.2026 13:05  Autor: <Name>                   |
| Bearbeitbar bis: 21.02.2026 14:15  (Countdown)              |
+-------------------------------------------------------------+
| Betreff                                                     |
| Text                                                        |
+-------------------------------------------------------------+
| AnhÃ¤nge:                                                    |
| - screenshot_2026-02-21.png [Download] [Vorschau]           |
| - bericht.pdf                [Download]                     |
+-------------------------------------------------------------+
| [Bearbeiten] (nur wenn allowed)                             |
| Audit (kurz): Created, AttachmentAdded, Updated ...         |
+-------------------------------------------------------------+
```

### 5.4 Bearbeiten (Edit)
**Zweck:** Nur eigene EintrÃ¤ge, nur innerhalb Fenster.

```
+-------------------------------------------------------------+
| Eintrag bearbeiten â€“ (noch 08:12 min mÃ¶glich)               |
+-------------------------------------------------------------+
| Name / Betreff / Text editierbar                             |
| AnhÃ¤nge: hinzufÃ¼gen erlaubt (optional)                       |
| Hinweis: Nach Ablauf ist Eintrag gesperrt.                   |
+-------------------------------------------------------------+
| [Ã„nderungen speichern]  [Abbrechen]                          |
+-------------------------------------------------------------+
```

---

## 6. Entwurfsmodus + Wiederherstellung

### 6.1 Speicherung
- Speichern in **IndexedDB** (empfohlen) unter Key:
  - `draft:{plant_slug}:{author_token}`
- Auto-Save:
  - debounced (z. B. 500â€“1000 ms)
  - bei unload/visibilitychange zusÃ¤tzlich flush

### 6.2 Wiederherstellung
Beim Ã–ffnen von `/Schichtbuch/<plant_slug>`:
- wenn Draft vorhanden: Dialog/Box  
  **â€žLetzten Entwurf wiederherstellen?â€œ**  
  Buttons: **Wiederherstellen** / **Verwerfen**

### 6.3 Draft-Inhalt
- Felder: Name, Betreff, Text
- AnhÃ¤nge:
  - kleine Dateien/Screenshots optional als Blob in IndexedDB
  - groÃŸe Dateien: bevorzugt als serverseitiger Draft-Upload (Phase 1b) oder UI-Hinweis, dass diese offline ggf. nicht gehalten werden

---

## 7. Offline-States & Queue-Logik

### 7.1 Offline-States (UI)
- **Online**: Normalbetrieb
- **Offline**: Banner â€žOffline â€“ Ã„nderungen werden spÃ¤ter Ã¼bertragenâ€œ
- **Syncing**: Banner â€žÃœbertragung lÃ¤uftâ€¦â€œ
- **Sync error**: Banner â€žÃœbertragung fehlgeschlagen â€“ wird erneut versuchtâ€œ + Details-Button

### 7.2 Outbox / Queue
In IndexedDB wird eine Queue gefÃ¼hrt:
- `queue_item`:
  - id, type (`CREATE_ENTRY`, `UPDATE_ENTRY`, `UPLOAD_ATTACHMENT`)
  - payload (JSON + ggf. Blob-Referenzen)
  - status (`PENDING`, `IN_PROGRESS`, `FAILED_RETRY`, `DONE`)
  - attempts, last_error, created_at

### 7.3 Synchronisations-Trigger
- `window.online` Event
- periodischer Timer (z. B. alle 30â€“60s) solange Pending existiert
- optional Background Sync API (wenn verfÃ¼gbar)

### 7.4 Idempotenz
- Client sendet `client_request_id` (UUID) bei mutierenden Requests:
  - Server speichert Mapping, damit Wiederholungen keine Duplikate erzeugen.
- FÃ¼r Uploads: chunking ist nicht erforderlich (intranet), aber mÃ¶glich spÃ¤ter.

---

## 8. Datenmodell (konzeptionell)

### 8.1 Plant
- `plant_id` (PK)
- `plant_slug` (unique, aus URL)
- `display_name`
- `shift_config_id` oder Felder fÃ¼r Schichtzeiten

### 8.2 LogEntry (aktueller Stand)
- `entry_id` (PK)
- `plant_id` (FK)
- `author_name` (MVP Freitext)
- `author_token` (MVP, nicht in UI anzeigen)
- `subject`
- `body`
- `created_at`
- `updated_at`
- `shift_id`
- `editable_until`
- `status` (z. B. `ACTIVE`, `CANCELLED_WRONG_PLANT`, `LOCKED`)

### 8.3 Attachment
- `attachment_id` (PK)
- `entry_id` (FK)
- `kind` (`FILE`, `SCREENSHOT`)
- `filename_original`
- `mime`
- `size_bytes`
- `storage_path` (serverseitig)
- `created_at`
- optional: `sha256` des Inhalts

### 8.4 Audit / Events (Append-only)
- `entry_event_id` (PK)
- `entry_id` (FK)
- `event_type` (z. B. `EntryCreated`, `EntryUpdated`, `AttachmentAdded`, `EntryCancelledWrongPlant`)
- `event_payload_json`
- `created_at`
- `actor_ref` (MVP: author_token; spÃ¤ter: user_id/usb_id + pc_name)
- Hash-Kette:
  - `prev_hash`
  - `hash`

---

## 9. Audit Hash-Kette (tamper-evident)

### 9.1 Berechnung
- Canonical JSON (stabil sortiert, ohne Whitespace)
- `hash = SHA256(prev_hash + canonical_json(event_meta + event_payload))`
- `prev_hash` des ersten Events: `"GENESIS"` (konstant)

### 9.2 Zweck
- Manipulation von Events wird erkennbar (Hash-Kette bricht).
- Optional spÃ¤ter: Signaturen, Export als revisionssichere Datei.

---

## 10. API-Spezifikation (MVP)

> Prefix: `/api` (Beispiel). JSON UTF-8. Zeiten in ISO 8601, Zeitzone Europe/Berlin.

### 10.1 Plant
**GET** `/api/plants/{plant_slug}`
- 200: plant info + upload rules + shift config
- 404: unknown plant

### 10.2 EintrÃ¤ge (Liste)
**GET** `/api/plants/{plant_slug}/entries?from=&to=&q=&limit=&cursor=`
- 200: paginated list
- 400: invalid params

### 10.3 Eintrag anlegen
**POST** `/api/plants/{plant_slug}/entries`
Body:
```json
{
  "client_request_id": "uuid",
  "author_name": "Max",
  "author_token": "uuid",
  "subject": "â€¦",
  "body": "â€¦"
}
```
Antwort 201:
```json
{
  "entry_id": 123,
  "editable_until": "2026-02-21T14:15:00+01:00",
  "shift_id": "2026-02-21-EARLY"
}
```

### 10.4 Eintrag lesen
**GET** `/api/entries/{entry_id}`
- 200: entry + attachments + (optional) audit preview
- 404

### 10.5 Eintrag bearbeiten
**PATCH** `/api/entries/{entry_id}`
Body:
```json
{
  "client_request_id": "uuid",
  "author_token": "uuid",
  "subject": "â€¦",
  "body": "â€¦"
}
```
- 200: updated entry
- 403: not allowed (token mismatch oder editable_until abgelaufen)
- 409: conflict (optional, z. B. optimistic locking)
- 404

### 10.6 Attachment hinzufÃ¼gen
**POST** `/api/entries/{entry_id}/attachments` (multipart/form-data)
Form fields:
- `author_token` (uuid)
- `file` (binary)
- optional `kind` (`FILE`/`SCREENSHOT`)

Antwort 201: attachment metadata

**Uploadlimits**
- max **50 MB pro Datei** (hart)

---

## 11. Fehlercodes (Beispiele)

- **400 Bad Request**: ungÃ¼ltige Parameter / JSON
- **401 Unauthorized**: (spÃ¤ter bei echter Auth)
- **403 Forbidden**: Editfenster abgelaufen / author_token falsch
- **404 Not Found**: plant_slug/entry_id unbekannt
- **409 Conflict**: optional bei Versionskonflikt
- **413 Payload Too Large**: Datei > 50 MB
- **415 Unsupported Media Type**: Dateityp nicht erlaubt (falls Whitelist aktiv)
- **429 Too Many Requests**: Rate limit
- **500**: Serverfehler

---

## 12. Security-Basics (MVP + Domain)

### 12.1 Token (MVP)
- `author_token` wird clientseitig erzeugt und in IndexedDB gespeichert.
- Server nutzt `author_token` zur Bindung â€ždieser Eintrag gehÃ¶rt zu diesem Browserâ€œ.
- `author_name` ist **Anzeige**, aber nicht Auth.

### 12.2 CORS
- Standard: gleiche Origin (kein CORS nÃ¶tig).
- Falls getrennt: CORS nur fÃ¼r erlaubte Origins, keine Wildcards.

### 12.3 Upload-Speicher
- Speichern auÃŸerhalb des Web-Roots (kein direktes AusfÃ¼hren)
- Dateiname serverseitig randomisieren (GUID), Originalname nur als Metadatum
- Pfadstruktur z. B.: `/data/anlagenbuch/{plant_slug}/{entry_id}/{attachment_id}.bin`
- Optional: PrÃ¼fung/Normalisierung der MIME Types

### 12.4 Rate Limits (minimal)
- z. B. pro IP:
  - Create Entry: X/min
  - Upload: X/min
- Schutz vor unbeabsichtigten Schleifen durch Offline-Retry

### 12.5 Transport
- Intranet trotzdem bevorzugt TLS (HTTPS), wenn mÃ¶glich.

---

## 13. Behandlung â€žFalsche Anlageâ€œ (ohne Move)

Wenn ein Eintrag Ã¼ber den falschen Direktlink erstellt wurde:
- Keine Verschiebung.
- Variante (empfohlen):
  - Eintrag erhÃ¤lt Status `CANCELLED_WRONG_PLANT` als Event
  - UI zeigt CTA: â€žNeuen Eintrag fÃ¼r richtige Anlage erstellenâ€œ (optional vorbefÃ¼llt)
- Originaltext bleibt unverÃ¤ndert im Audit.

---

## 14. Phase 2 (Ausblick): USB-Auth + Client-Agent

### Ziel
- eindeutige User-ID statt `author_token`
- PC-Name und weitere Clientdaten automatisch mitschreiben

### Prinzip
- Agent lÃ¤uft auf Clients, meldet sich am Server an
- Browser erhÃ¤lt kurzlebiges Token (z. B. Ã¼ber localhost bridge oder signiertes JWT)
- Audit `actor_ref` erweitert um: `user_id`, `pc_name`, ggf. Windows-User, Standort

---

## 15. Offene Punkte (fÃ¼r das spÃ¤tere â€žAufrÃ¤umenâ€œ)
- Schichtdefinition: Zeiten pro Anlage/Standort? Feiertage? DST-Regeln?
- Retention: Aufbewahrungsfristen fÃ¼r EintrÃ¤ge/AnhÃ¤nge
- Export/Reporting: PDF/CSV/BI-Schnittstellen
- Internal UI: Moderation/Kommentare/Statuswechsel


