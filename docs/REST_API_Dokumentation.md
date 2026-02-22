# REST API Dokumentation (v0.1)

## 1) Einstieg

- Swagger UI: `http://SERVER/api/docs`
- OpenAPI JSON: `http://SERVER/api/openapi.json`

Basis-URL:

- Standard (wenn Caddy auf `:8080` laeuft): `http://SERVER:8080/api`
- Optional (wenn Caddy auf `:80` laeuft): `http://SERVER/api`

## 2) Authentifizierung und Rollen

Die internen Endpunkte sind rollenbasiert und nutzen Session-Cookie-Login.

Login:

- `POST /auth/login`
- setzt Cookie `anlagen_session`

Logout:

- `POST /auth/logout`

Session pruefen:

- `GET /auth/me`

Rollen:

- `Admin`: Vollzugriff (Benutzer, Rollen, Gruppen, Module, Ops, Reporting)
- `Dispatcher`: Tickets einordnen/routen, Status pflegen, Reporting/Ops lesen
- `Agent`: Zugewiesene Tickets bearbeiten und abschliessen

Oeffentliche Endpunkte:

- Alle Routen unter `/public/*` sind ohne Login erreichbar

## 3) Fehlerformat

Ueblich sind JSON-Fehler vom Typ:

```json
{
  "detail": "beschreibung"
}
```

Typische Statuscodes:

- `400` ungueltige Eingabe
- `401` nicht angemeldet
- `403` keine Berechtigung / Token mismatch
- `404` Objekt nicht gefunden
- `409` Konflikt (z. B. Dublette, ungueltiger Zustand)
- `500` interner Fehler

## 4) API Gruppen und Endpunkte

### 4.1 System

- `GET /healthz`: Liveness-Check
- `GET /readyz`: Readiness-Check inkl. DB-Verbindung

### 4.2 Auth

- `POST /auth/login`: Benutzer anmelden
- `POST /auth/logout`: Session beenden
- `GET /auth/me`: aktuelle Session inkl. Rollen lesen
- `GET /auth/profile`: Profil lesen
- `PATCH /auth/profile`: Profil (z. B. E-Mail) aendern
- `POST /auth/change-password`: Passwort aendern

### 4.3 Anlagen (Plants)

- `GET /plants/{plant_slug}`: Anlage lesen
- `GET /plants`: Anlagenliste (Admin)
- `POST /plants`: Anlage anlegen (Admin)
- `PATCH /plants/{plant_slug}`: Anlage aendern (Admin)

### 4.4 Schichtbuch

- `GET /plants/{plant_slug}/entries`: Eintraege pro Anlage listen
- `POST /plants/{plant_slug}/entries`: Eintrag erstellen
- `GET /entries/{entry_id}`: Eintrag mit Anhaengen lesen
- `PATCH /entries/{entry_id}`: Eintrag aendern (innerhalb Edit-Fenster)
- `POST /entries/{entry_id}/delete`: Eintrag loeschen (soft delete)
- `POST /entries/{entry_id}/attachments`: Datei/Bild an Eintrag anhaengen (multipart)
- `GET /entries/{entry_id}/attachments/{attachment_id}`: Anhang anzeigen/download
- `GET /entries/{entry_id}/events`: Hash-Chain Events zum Eintrag
- `POST /entries/{entry_id}/events`: Event manuell anhaengen

### 4.5 Tickets (oeffentlich)

- `POST /public/tickets`: Ticket erstellen (Anlagenfahrer)
- `GET /public/tickets/dashboard`: Dashboard-Liste je Anlage
- `GET /public/tickets/dashboard/{ticket_id}`: Dashboard-Detail je Ticket
- `GET /public/tickets/{token}`: Ticketstatus per oeffentlichem Token
- `POST /public/tickets/{token}/reply`: Rueckfrage/Kommentar durch Anlagenfahrer
- `POST /public/tickets/{token}/attachments`: Anhang hochladen (multipart)

### 4.6 Tickets (intern)

- `GET /tickets/groups`: Ticketgruppen lesen
- `GET /tickets/agents`: Agenten lesen (optional pro Gruppe)
- `GET /tickets`: Ticketliste mit Filtern
- `GET /tickets/{ticket_id}`: Ticketdetail inkl. Verlauf/Anhaenge
- `POST /tickets/{ticket_id}/triage`: Ticket einordnen (Abteilung/Prioritaet/Typ)
- `POST /tickets/{ticket_id}/route-groups`: Ticket an eine/mehrere Gruppen routen
- `DELETE /tickets/{ticket_id}/route-groups/{group_id}`: Gruppenrouting entfernen (nur vor Start)
- `POST /tickets/{ticket_id}/assign`: Ticket einem Agenten zuweisen
- `POST /tickets/{ticket_id}/status`: Ticketstatus aendern
- `POST /tickets/{ticket_id}/attachments`: internen Anhang hochladen (multipart)
- `GET /files/{file_id}/download`: interne Datei herunterladen

### 4.7 Reporting

- `POST /reporting/exports`: Export erzeugen
- `GET /reporting/runs`: Export-Laeufe listen
- `GET /reporting/runs/{run_id}`: Lauf-Details inkl. Artefakte
- `POST /reporting/preview`: Vorschau-Datensatz lesen
- `GET /reporting/runs/{run_id}/artifacts/{artifact_id}`: Artefakt herunterladen
- `POST /reporting/schedules`: Automatik-Report anlegen
- `GET /reporting/schedules`: Automatik-Reports listen
- `PATCH /reporting/schedules/{schedule_id}`: Automatik-Report aendern
- `DELETE /reporting/schedules/{schedule_id}`: Automatik-Report loeschen
- `GET /reporting/deliveries`: Report-Zustellungen lesen
- `POST /reporting/schedules/{schedule_id}/run-now`: Zeitplan sofort starten

### 4.8 Admin intern

- `GET /admin/dashboard`: Admin Dashboard-Daten
- `GET /admin/module-settings`: Modul-Einstellungen lesen
- `PATCH /admin/module-settings`: Modul-Einstellungen aendern
- `GET /admin/email-settings`: Mailserver-Einstellungen lesen
- `PATCH /admin/email-settings`: Mailserver-Einstellungen aendern
- `POST /admin/email-settings/test`: Mailserver testen
- `GET /admin/areas`: Bereiche lesen
- `POST /admin/areas`: Bereich anlegen
- `PATCH /admin/areas/{area_code}`: Bereich aendern
- `DELETE /admin/areas/{area_code}`: Bereich loeschen
- `DELETE /admin/plants/{plant_slug}`: Anlage loeschen (nur ohne Referenzen)
- `GET /admin/users`: Benutzer lesen
- `POST /admin/users`: Benutzer anlegen
- `PATCH /admin/users/{username}/roles`: Rollen aendern
- `PATCH /admin/users/{username}/settings`: Rollen/Gruppen/Bereiche aendern
- `POST /admin/users/{username}/reset-password`: Passwort resetten
- `DELETE /admin/users/{username}`: Benutzer loeschen
- `GET /admin/roles`: Rollen inkl. Rechte lesen
- `GET /admin/ticket-groups`: Ticketgruppen lesen
- `POST /admin/ticket-groups`: Ticketgruppe anlegen
- `PATCH /admin/ticket-groups/{group_id}`: Ticketgruppe aendern
- `PATCH /admin/ticket-groups/{group_id}/members`: Mitglieder pflegen
- `DELETE /admin/ticket-groups/{group_id}`: Ticketgruppe loeschen

### 4.9 Ops

- `GET /ops/status`: Betriebszustand, Last, Module, E-Mail-Konfiguration
- `GET /ops/errors`: Fehlerliste (filterbar)
- `GET /ops/deliveries`: Outbox-Zustellungen lesen
- `GET /ops/dead-letters`: Dead-Letter lesen
- `POST /ops/deliveries/{delivery_id}/retry`: Zustellung erneut senden
- `GET /ops/logs/tail`: Live-Logauszug lesen
- `GET /ops/traces`: Trace-Dateien listen
- `GET /ops/traces/{trace_id}`: Einzelnen Trace lesen
- `GET /ops/logs/download`: Support-Bundle herunterladen

## 5) Beispiele (curl)

Login:

```bash
curl -i -X POST "http://SERVER/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin_1","password":"admin_demo_pw_change"}'
```

Oeffentliches Ticket erstellen:

```bash
curl -X POST "http://SERVER/api/public/tickets?plantId=MS_DEMO_ANLAGE_01" \
  -H "Content-Type: application/json" \
  -d '{"requester_name":"Max","subject":"Pumpe stoppt","description":"Linie steht"}'
```

Schichtbuch-Anhang hochladen:

```bash
curl -X POST "http://SERVER/api/entries/123/attachments" \
  -F "author_token=mein-token" \
  -F "kind=SCREENSHOT" \
  -F "file=@bild.png"
```

Report-Vorschau:

```bash
curl -X POST "http://SERVER/api/reporting/preview" \
  -H "Content-Type: application/json" \
  -d '{"plantId":"MS_DEMO_ANLAGE_01","report_kind":"tickets","limit":50}'
```

## 6) Hinweise fuer Integrationen

- Fuer internen Zugriff zuerst anmelden und Cookie speichern.
- Datumswerte werden als ISO-8601 verarbeitet.
- Datei-Uploads sind `multipart/form-data`.
- Die OpenAPI in `/api/openapi.json` ist die verbindliche Schnittstellenquelle fuer Clients.

