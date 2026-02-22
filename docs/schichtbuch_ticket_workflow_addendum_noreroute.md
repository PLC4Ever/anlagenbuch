# Addendum: Kein Re-Routing (Plant/Prefix ist unveränderlich)

Diese Ergänzung gilt für das Ticket-System-Konzept (v2/v3).

## Grundregel
- `plant_id` / `anlage_slug` wird **ausschließlich aus dem Link** bestimmt und ist **immutable**.
- Routing zum Dispatcher erfolgt **deterministisch** aus dem Anlagen-Präfix (MS_/T_/KS_/SV_) bzw. aus `plant_id`.
- Es gibt **keine** Funktion/Action, um ein Ticket nachträglich in einen anderen Dispatcher-Bereich zu verschieben.

## Konsequenz (operativ)
Ein Ticket kann nur in dem Bereich bearbeitet werden, in dem es erstellt wurde. Fehlzuordnungen müssen **ohne Verschieben** gehandhabt werden.

## Prävention (Zero-Hürde beibehalten)
- Create-Seite zeigt ganz oben groß: **„Du meldest für Anlage: <PLANT>“** (rein informativ, kein Pflichtklick).
- Link-Erzeugung/Verteilung so gestalten, dass der Anlagenfahrer praktisch nur den **richtigen** Link bekommt:
  - HMI/SCADA Button pro Anlage
  - QR-Code/Shortcut an der Anlage
  - Favoriten/Startseite je Anlage
- Optional (aber nicht verpflichtend): Button „Falsche Anlage?“ → öffnet eine Suche/Liste; nur nutzen, wenn wirklich nötig.

## Behandlung von Fehlzuordnungen (ohne Re-Routing)
Wenn doch ein falscher Link genutzt wurde:

### Variante A (empfohlen): „Neu anlegen, altes sauber schließen“
- Dispatcher setzt Status auf `CANCELLED` mit Reason: `WRONG_PLANT_LINK` (Event, Ticket-Text bleibt unverändert).
- System zeigt dem Anlagenfahrer auf der Public-Statusseite:
  - Hinweis „Ticket wurde wegen falscher Anlage geschlossen.“
  - **Direktlink** „Neues Ticket für richtige Anlage erstellen“ (optional vorbefüllt mit Betreff/Text; Anlagenfahrer bestätigt nur Absenden).
- Optional: Dispatcher/Bearbeiter kann (internal) referenzieren, welcher neue Ticket-Token/ID genutzt werden soll.

### Variante B (minimal): „Requester muss neu erstellen“
- Dispatcher schließt als `CANCELLED/WRONG_PLANT_LINK`
- Anlagenfahrer erstellt neu über richtigen Link (höhere Reibung, deshalb nicht bevorzugt)

## Datenmodell / Events
- Kein Feld für Routing-Override.
- Neues Audit Event:
  - `TicketCancelledWrongPlant` (payload: reason, suggested_create_url, optional copied_fields)
- Optional: „prefill“ wird als **Copy-Helper** implementiert (kein Verschieben, kein Ändern des Originals).

## UI/UX (Public)
- Public Timeline zeigt:
  - Statuswechsel (public)
  - ausgewählte öffentliche Kommentare/Updates
- Interne Notizen bleiben unsichtbar.
- Bei `WRONG_PLANT_LINK`: prominenter CTA „Neues Ticket für richtige Anlage erstellen“.

