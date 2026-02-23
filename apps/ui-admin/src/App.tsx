import React, { useEffect, useMemo, useState } from "react";

type Section = "dashboard" | "modules" | "plants" | "tickets" | "reporting" | "users" | "ops";
type Me = { username: string; roles: string[]; force_password_change: boolean; email?: string | null };
type Profile = { username: string; email: string | null; roles: string[]; force_password_change: boolean };
type AdminUserGroup = { id: number; code: string; name: string; active: boolean };
type AdminUser = {
  id: number;
  username: string;
  force_password_change: boolean;
  roles: string[];
  department?: string | null;
  departments?: string[];
  ticket_groups?: AdminUserGroup[];
};
type UserEditorDraft = {
  username: string;
  roles: string[];
  departments: string[];
  groupIds: number[];
  newPassword: string;
  forcePasswordChange: boolean;
};
type Mod = {
  anlagenbuch: { upload_limit_mb: number; shift_config: string };
  tickets: {
    public_reply_enabled: boolean;
    auto_close_policy_days: number;
    department_options: string[];
    ticket_type_options: string[];
  };
  reporting: { enabled: boolean };
};
type Plant = { id: number; slug: string; display_name: string; area_prefix: string; active: boolean };
type Area = { id: number; code: string; name: string };
type Ticket = {
  id: number;
  status: string;
  department: string | null;
  priority_rank: number | null;
  ticket_type: string | null;
  area: string;
  plant_slug?: string | null;
  subject?: string | null;
  description?: string | null;
  requester_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  group_routes?: Array<{ id: number; code: string; name: string }>;
};
type TicketGroup = { id: number; code: string; name: string; active: boolean; members?: string[] };
type TicketAgent = { id: number; username: string; groups?: Array<{ id: number; code: string; name: string }> };
type RouteDraft = { group_id: string; priority: number; reason: string; note: string; comment: string };
type TicketAttachmentView = { file_id: number; kind: string; filename_original: string; mime: string; size_bytes: number; download_url: string; created_at?: string | null };
type ReportPreview = { summary: Record<string, unknown>; columns: string[]; rows: Record<string, unknown>[] };
type DispatcherPane = "tickets" | "konto" | "report_builder" | "auto_reports";
type AgentPane = "tickets" | "konto";
type HelpTopic = { title: string; items: string[] };
type HelpContent = { title: string; intro: string; topics: HelpTopic[] };

type OpsStatus = {
  health: { db_ok: boolean; disk_ok: boolean; backlog: number; response_ms: number; last_error: string | null };
  pending_deliveries: number;
  pending_outbox: number;
  system?: {
    disk_total_bytes: number;
    disk_used_bytes: number;
    disk_free_bytes: number;
    disk_used_percent: number;
    memory_total_bytes: number;
    memory_used_bytes: number;
    memory_free_bytes: number;
    memory_used_percent: number;
    cpu_load_percent: number;
    requests_per_minute: number;
  };
  modules?: {
    anlagenbuch_enabled: boolean;
    tickets_enabled: boolean;
    reporting_enabled: boolean;
  };
  email_server?: {
    enabled: boolean;
    host: string;
    port: number;
    security: string;
    username: string;
    from_address: string;
    timeout_seconds: number;
    has_password: boolean;
    configured?: boolean;
  };
};
type CertificateStatus = {
  host: string;
  port: number;
  subject_cn: string | null;
  issuer_cn: string | null;
  serial_number: string | null;
  not_before: string | null;
  not_after: string | null;
  seconds_remaining: number | null;
  days_remaining: number | null;
  valid_now: boolean;
  checked_at: string;
};
type CertificateDomainCsr = {
  host: string;
  san_ip: string | null;
  csr_path?: string | null;
  key_path?: string | null;
  csr_pem: string;
};
type EmailSettingsDraft = {
  enabled: boolean;
  host: string;
  port: number;
  security: string;
  username: string;
  password: string;
  from_address: string;
  timeout_seconds: number;
  has_password: boolean;
};

const NAV: Array<{ key: Section; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "modules", label: "Module" },
  { key: "plants", label: "Anlagen & Bereiche" },
  { key: "tickets", label: "Tickets Backoffice" },
  { key: "users", label: "Benutzer & Rollen" },
  { key: "ops", label: "Ops" },
];

const CLOSED_TICKET_STATUSES = new Set(["CLOSED", "CANCELLED", "CANCELLED_WRONG_PLANT"]);
const STARTED_TICKET_STATUSES = new Set(["IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED", "CANCELLED_WRONG_PLANT"]);

function ticketStatusLabel(status: string): string {
  const map: Record<string, string> = {
    NEW: "Neu",
    TRIAGE: "Neu",
    QUEUED: "Eingeordnet",
    IN_PROGRESS: "In Bearbeitung",
    RESOLVED: "Geloest",
    CLOSED: "Geschlossen",
    CANCELLED: "Storniert",
    CANCELLED_WRONG_PLANT: "Falsche Anlage",
  };
  return map[status] || status;
}

function ticketStatusClass(status: string): string {
  if (status === "NEW" || status === "TRIAGE") return "d-new";
  if (status === "QUEUED" || status === "IN_PROGRESS") return "d-work";
  if (status === "RESOLVED") return "d-resolved";
  if (CLOSED_TICKET_STATUSES.has(status)) return "d-closed";
  return "d-new";
}

const PRIORITY_LEVELS = [0, 1, 2, 3, 4, 5, 6] as const;
const PRIORITY_SHORT: Record<number, string> = {
  0: "Sofort",
  1: "Sehr hoch",
  2: "Hoch",
  3: "Mittel",
  4: "Normal",
  5: "Niedrig",
  6: "Sehr niedrig",
};
const PRIORITY_HINT: Record<number, string> = {
  0: "Sofort (Anlage steht/Gefahr)",
  1: "Sehr hoch (kritisch)",
  2: "Hoch (zeitnah)",
  3: "Mittel (heute)",
  4: "Normal (naechste Schicht)",
  5: "Niedrig (bei Gelegenheit)",
  6: "Sehr niedrig (Beobachtung)",
};

function clampPriority(value: number, fallback = 3): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.max(0, Math.min(6, rounded));
}

function priorityLabel(priority: number | null | undefined): string {
  if (priority === null || priority === undefined || !Number.isFinite(priority)) return "Nicht gesetzt";
  const level = clampPriority(priority);
  return PRIORITY_SHORT[level] || "Nicht gesetzt";
}

function priorityOptionLabel(priority: number): string {
  const level = clampPriority(priority);
  return `${level} - ${PRIORITY_HINT[level]}`;
}

function priorityDisplay(priority: unknown): string {
  if (typeof priority === "number" && Number.isFinite(priority)) return priorityOptionLabel(priority);
  if (typeof priority === "string" && priority.trim()) {
    const parsed = Number(priority);
    if (Number.isFinite(parsed)) return priorityOptionLabel(parsed);
  }
  return "Nicht gesetzt";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isTicketTriaged(detail: Record<string, unknown> | null): boolean {
  if (!detail) return false;
  const status = readString(detail.status);
  if (!status || status === "NEW" || status === "TRIAGE") return false;
  const department = readString(detail.department);
  const ticketType = readString(detail.ticket_type);
  const priority = readNumber(detail.priority_rank);
  return Boolean(department && ticketType) && priority !== null;
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("de-DE");
}

function formatBytes(value: number | null | undefined): string {
  if (!Number.isFinite(value || 0) || (value || 0) <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Number(value);
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[idx]}`;
}

function ticketEventLabel(eventType: string): string {
  const map: Record<string, string> = {
    TicketCreated: "Ticket wurde erstellt",
    TicketTriaged: "Ticket wurde eingeordnet",
    TicketAssigned: "Ticket wurde zugewiesen",
    TicketStatusChanged: "Status wurde geaendert",
    TicketAttachmentAdded: "Anhang wurde hinzugefuegt",
    TicketCommentAdded: "Kommentar wurde hinzugefuegt",
    TicketCancelledWrongPlant: "Ticket wurde als falsche Anlage markiert",
    TicketGroupRouted: "An Gruppe weitergeleitet",
    TicketGroupRouteRemoved: "Gruppen-Zuordnung entfernt",
  };
  return map[eventType] || eventType;
}

function ticketEventSummary(eventType: string, payload: unknown): string {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const status = typeof p.status === "string" ? ticketStatusLabel(p.status) : "";
  const assignee = typeof p.assignee === "string" ? p.assignee : "";
  const message = typeof p.message === "string" ? p.message : "";
  const reason = typeof p.reason === "string" ? p.reason : "";
  if (eventType === "TicketAssigned" && assignee) return `Bearbeiter: ${assignee}`;
  if (eventType === "TicketStatusChanged" && status) return `Neuer Status: ${status}`;
  if (eventType === "TicketTriaged") {
    const dep = typeof p.department === "string" ? p.department : "-";
    const pri = typeof p.priority === "number" ? priorityLabel(p.priority) : "Nicht gesetzt";
    const tt = typeof p.ticket_type === "string" ? p.ticket_type : "-";
    return `Bereich: ${dep} | Prioritaet: ${pri} | Typ: ${tt}`;
  }
  if (eventType === "TicketCommentAdded" && message) return `Kommentar: ${message}`;
  if (eventType === "TicketGroupRouted") {
    const group = typeof p.group_name === "string" ? p.group_name : (typeof p.group_code === "string" ? p.group_code : "Unbekannt");
    const priority = typeof p.priority === "number" ? priorityLabel(p.priority) : "Nicht gesetzt";
    const comment = typeof p.comment === "string" && p.comment.trim() ? p.comment.trim() : "-";
    const note = typeof p.note === "string" && p.note.trim() ? p.note.trim() : "-";
    const why = typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : "-";
    return `Gruppe: ${group} | Prioritaet: ${priority} | Grund: ${why} | Notiz: ${note} | Kommentar: ${comment}`;
  }
  if (eventType === "TicketGroupRouteRemoved") {
    const group = typeof p.group_name === "string" ? p.group_name : (typeof p.group_code === "string" ? p.group_code : "Unbekannt");
    return `Gruppe: ${group} wurde aus dem Ticket entfernt`;
  }
  if (reason) return `Grund: ${reason}`;
  return "Details im Systemprotokoll gespeichert.";
}

function isImageAttachment(file: TicketAttachmentView): boolean {
  return file.mime.toLowerCase().startsWith("image/") || file.kind === "IMAGE" || file.kind === "SCREENSHOT";
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", ...init });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`${r.status} ${r.statusText}${txt ? `: ${txt.slice(0, 220)}` : ""}`);
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await r.json()) as T;
  return (await r.text()) as T;
}

const csv = (v: string) => Array.from(new Set(v.split(",").map((x) => x.trim()).filter(Boolean)));
const normalizeOptions = (values: string[]) => Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "de"));
const REPORT_FORMATS = ["pdf", "docx", "xlsx", "csv", "json", "xml"] as const;
const REPORT_FORMAT_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "Word (DOCX)",
  xlsx: "Excel (XLSX)",
  csv: "CSV",
  json: "JSON",
  xml: "XML",
};
const CRON_TYPE_LABEL: Record<string, string> = {
  daily: "Taeglich",
  weekly: "Woechentlich",
  monthly: "Monatlich",
  yearly: "Jaehrlich",
};
const REPORT_KIND_LABEL: Record<string, string> = {
  tickets: "Tickets",
  schichtbuch: "Schichtbuch",
  kombiniert: "Kombiniert",
};
const DISPATCHER_TIMEZONES = ["Europe/Berlin", "UTC"] as const;

function toIsoLocalStart(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function toIsoLocalEnd(date: Date): string {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

type PortalKind = "admin" | "dispatcher" | "agent";

function detectPortalKind(): PortalKind {
  const p = (typeof window !== "undefined" ? window.location.pathname : "/admin").toLowerCase();
  if (p.startsWith("/dispatcher")) return "dispatcher";
  if (p.startsWith("/endbearbeiter") || p.startsWith("/endarbeiter") || p.startsWith("/agent")) return "agent";
  return "admin";
}

function detectAreaFromUsername(username: string | null | undefined): string {
  if (!username) return "";
  const parts = username
    .split("_")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  for (const part of parts) {
    if (part === "AGENT" || part === "DISPATCHER" || part === "ADMIN") continue;
    if (/^[A-Z]{2,4}$/.test(part)) return part;
  }
  return "";
}

const DISPATCHER_HELP: Record<DispatcherPane, HelpContent> = {
  tickets: {
    title: "Dispatcher Hilfe: Tickets Leitstand",
    intro: "Hier ordnest du Tickets ein, verteilst sie an passende Gruppen und verfolgst den Verlauf.",
    topics: [
      {
        title: "Filter und Liste",
        items: [
          "Freitextsuche: durchsucht Ticketnummer, Betreff, Beschreibung und Melder.",
          "Statusfilter: zeigt nur neue, offene, bearbeitete oder geschlossene Tickets.",
          "Bereich: schraenkt Tickets auf ein Gewerk/einen Fachbereich ein.",
          "Ticket oeffnen: startet die eigentliche Bearbeitung im Popup.",
        ],
      },
      {
        title: "1) Ticket einordnen",
        items: [
          "Bereich: fachliche Zuordnung (z.B. Mechanik, Elektrik, IT).",
          "Prioritaet 0-6: 0 = sofort kritisch, 6 = sehr niedrig.",
          "Ticket-Typ: Art des Falls (Stoerung, Wartung, Pruefung ...).",
          "Erst nach Einordnung wird die Gruppensteuerung freigeschaltet.",
        ],
      },
      {
        title: "2) An Gruppen senden",
        items: [
          "Ein Ticket kann gleichzeitig an mehrere Gruppen gehen.",
          "Pro Gruppe setzt du Prioritaet, Grund, Notiz und Kommentar.",
          "Gruppen nach Arbeitsbeginn nicht mehr entfernen, nur ergaenzen.",
          "So sieht jedes Gewerk genau die fuer es relevanten Infos.",
        ],
      },
      {
        title: "Status, Dateien, Verlauf",
        items: [
          "Status steuert den Gesamtfortschritt des Tickets.",
          "Dateien/Screenshots dienen als Nachweis fuer Analyse und Loesung.",
          "Verlauf zeigt chronologisch alle Aktionen und Kommentare.",
          "Bilder kannst du direkt ansehen und optional herunterladen.",
        ],
      },
    ],
  },
  konto: {
    title: "Dispatcher Hilfe: Mein Konto",
    intro: "Hier pflegst du deine persoenlichen Zugangsdaten fuer Benachrichtigungen und Login.",
    topics: [
      {
        title: "E-Mail",
        items: [
          "Die hinterlegte E-Mail wird fuer automatische Reports genutzt.",
          "Ohne E-Mail koennen geplante Reports nicht an dich versendet werden.",
        ],
      },
      {
        title: "Passwort",
        items: [
          "Passwort regelmaessig aendern und sicher aufbewahren.",
          "Nach dem Speichern gilt das neue Passwort sofort.",
        ],
      },
    ],
  },
  report_builder: {
    title: "Dispatcher Hilfe: Report Builder",
    intro: "Hier erstellst du manuelle Auswertungen und kannst sie als Datei exportieren.",
    topics: [
      {
        title: "Grundfelder",
        items: [
          "Report-Typ: Tickets, Schichtbuch oder kombiniert.",
          "Zeitraum: heute, Woche, Monat oder eigener Zeitraum.",
          "Anlage/Bereich/Ticket-ID: optionales Feintuning der Datenmenge.",
        ],
      },
      {
        title: "Ausgabe",
        items: [
          "Webvorschau zeigt vorab, welche Daten enthalten sind.",
          "Formate: PDF/Word/Excel/CSV/JSON/XML je nach Bedarf.",
          "Bericht erstellen startet den Lauf und erzeugt Artefakte zum Download.",
        ],
      },
    ],
  },
  auto_reports: {
    title: "Dispatcher Hilfe: Automatische Reports",
    intro: "Hier baust du wiederkehrende Reportjobs auf, die ohne manuelles Starten laufen.",
    topics: [
      {
        title: "Planung",
        items: [
          "Name: sprechender Titel, damit Jobs klar unterscheidbar sind.",
          "Intervall: taeglich, woechentlich, monatlich oder jaehrlich.",
          "Zeitzone: bestimmt die exakte Ausfuehrungszeit.",
        ],
      },
      {
        title: "Inhalt und Versand",
        items: [
          "Typ/Anlage/Bereich/Ticket-ID bestimmen, was im Report landet.",
          "Formate legen fest, in welchen Dateitypen geliefert wird.",
          "Empfaenger ist dein Konto-Postfach (E-Mail aus 'Mein Konto').",
          "Aktiv/Inaktiv zeigt visuell, ob ein Plan gerade laeuft.",
        ],
      },
    ],
  },
};

const AGENT_HELP: Record<AgentPane, HelpContent> = {
  tickets: {
    title: "Endbearbeiter Hilfe: Meine Tickets",
    intro: "Hier bearbeitest du zugewiesene Tickets und dokumentierst den Arbeitsfortschritt.",
    topics: [
      {
        title: "Filter und Auswahl",
        items: [
          "Freitextsuche findet Tickets nach Inhalt, Nummer oder Anlage.",
          "Statusfilter hilft beim Fokus: neu, in Arbeit, geloest, geschlossen.",
          "Bereich grenzt auf deinen Fachbereich ein.",
        ],
      },
      {
        title: "Ticket bearbeiten",
        items: [
          "Status 'In Bearbeitung': setzen, wenn du startest.",
          "Status 'Abgeschlossen': setzen, wenn die Arbeit erledigt ist.",
          "Grund und Kommentar erklaeren kurz, was getan wurde.",
        ],
      },
      {
        title: "Nachweise",
        items: [
          "Dateien/Bilder/Screenshots als Beleg fuer Analyse oder Loesung hochladen.",
          "Anhaenge sind im Verlauf fuer Dispatcher und andere Beteiligte sichtbar.",
          "Bilder koennen im Browser angezeigt und heruntergeladen werden.",
        ],
      },
    ],
  },
  konto: {
    title: "Endbearbeiter Hilfe: Mein Konto",
    intro: "Hier verwaltest du dein Profil fuer Kommunikation und Sicherheit.",
    topics: [
      {
        title: "E-Mail und Passwort",
        items: [
          "E-Mail aktuell halten, damit Rueckmeldungen dich erreichen.",
          "Passwort sicher halten und bei Bedarf direkt aendern.",
        ],
      },
    ],
  },
};

const ADMIN_HELP: Record<Section, HelpContent> = {
  dashboard: {
    title: "Admin Hilfe: Dashboard",
    intro: "Das Dashboard ist die Startansicht fuer den Systemzustand.",
    topics: [
      {
        title: "Kennzahlen",
        items: [
          "Zeigt Anlagen, Bereiche, Gruppen und aktuelle Betriebsindikatoren.",
          "Schnellzugriffe fuehren direkt zu Anlagen, Tickets, Benutzern und Ops.",
        ],
      },
      {
        title: "Systemwerte",
        items: [
          "Partition, RAM, CPU und Requests/min dienen der Lastbeobachtung.",
          "Modul- und Mailstatus zeigen, ob Kernfunktionen verfuegbar sind.",
        ],
      },
    ],
  },
  modules: {
    title: "Admin Hilfe: Module",
    intro: "Hier pflegst du globale Einstellungen fuer Anlagenbuch, Tickets und Reporting.",
    topics: [
      {
        title: "Ticket-Optionen",
        items: [
          "Bereichs- und Ticket-Typ-Listen steuern auswählbare Werte im Dispatcher.",
          "Aenderungen wirken direkt auf Eingabeformulare und Filter.",
        ],
      },
      {
        title: "Reporting",
        items: [
          "Aktivierung steuert, ob Reportfunktionen im System verfuegbar sind.",
          "Nach Aenderungen immer speichern und kurz pruefen.",
        ],
      },
    ],
  },
  plants: {
    title: "Admin Hilfe: Anlagen & Bereiche",
    intro: "Hier verwaltest du die Struktur der Anlage und Organisationsbereiche.",
    topics: [
      {
        title: "Anlagen",
        items: [
          "Slug ist der technische Schluessel und Teil der Schichtbuch-/Ticket-Links.",
          "Display-Name ist die benutzerfreundliche Bezeichnung im UI.",
          "Aktiv/Deaktivieren steuert Sichtbarkeit ohne Loeschung.",
        ],
      },
      {
        title: "Bereiche",
        items: [
          "Bereichscode bildet den organisatorischen Rahmen (z.B. MS, KS).",
          "Bereiche koennen nur geloescht werden, wenn keine Referenzen bestehen.",
        ],
      },
    ],
  },
  tickets: {
    title: "Admin Hilfe: Tickets Backoffice",
    intro: "Hier steuerst du Ticket-Gruppen, Prozesse und Detaildaten.",
    topics: [
      {
        title: "Gruppen",
        items: [
          "Gruppen bilden Gewerke/Teams fuer Routing durch den Dispatcher.",
          "Mitglieder muessen Agent-Rolle haben, sonst keine Gruppenzuweisung.",
        ],
      },
      {
        title: "Ticketdetails",
        items: [
          "Statuswechsel, Kommentare und Anhaenge sind im Verlauf nachvollziehbar.",
          "Bilder/Dateien koennen direkt angesehen oder heruntergeladen werden.",
        ],
      },
    ],
  },
  reporting: {
    title: "Admin Hilfe: Reporting",
    intro: "Hier steuerst du Reportlaeufe und Zeitplaene auf Systemebene.",
    topics: [
      {
        title: "Manuell und geplant",
        items: [
          "Manuelle Exporte fuer ad-hoc Auswertungen.",
          "Zeitplaene fuer regelmaessige Reportzustellung.",
        ],
      },
    ],
  },
  users: {
    title: "Admin Hilfe: Benutzer & Rollen",
    intro: "Hier verwaltest du Nutzer, Rollen, Gruppen und Abteilungen.",
    topics: [
      {
        title: "Benutzeranlage",
        items: [
          "Rollen bestimmen Rechte (Admin, Dispatcher, Agent).",
          "Mehrere Abteilungen pro Benutzer sind moeglich.",
          "Ticket-Gruppen nur sinnvoll bei Rolle Agent.",
        ],
      },
      {
        title: "Popup Bearbeiten",
        items: [
          "Passwort-Reset setzt Zugang neu und kann Passwortwechsel erzwingen.",
          "Rolle, Gruppe und Abteilung direkt im gleichen Dialog pflegen.",
        ],
      },
    ],
  },
  ops: {
    title: "Admin Hilfe: Ops",
    intro: "Hier ueberwachst du Betrieb, Logs, Traces und Mailanbindung.",
    topics: [
      {
        title: "Betrieb",
        items: [
          "Health, Fehler, Deliveries und Traces helfen bei Stoerungsanalyse.",
          "Retry-Aktionen starten fehlgeschlagene Zustellungen neu.",
        ],
      },
      {
        title: "Mailserver",
        items: [
          "SMTP/Exchange-Daten hier hinterlegen und Verbindung testen.",
          "Testmail prueft, ob Versand fuer Reports wirklich funktioniert.",
        ],
      },
    ],
  },
};

function HelpModal(props: { open: boolean; content: HelpContent; onClose: () => void }) {
  const { open, content, onClose } = props;
  if (!open) return null;
  return (
    <div className="d-modal-bg" onClick={onClose}>
      <div className="d-modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="header">
          <h2>{content.title}</h2>
          <button className="secondary" onClick={onClose}>Schliessen</button>
        </div>
        <p className="muted">{content.intro}</p>
        <div className="help-grid">
          {content.topics.map((topic) => (
            <article key={topic.title} className="help-topic">
              <h3>{topic.title}</h3>
              <ul>
                {topic.items.map((item, idx) => (
                  <li key={`${topic.title}-${idx}`}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const portalKind = detectPortalKind();
  const [section, setSection] = useState<Section>(portalKind === "admin" ? "dashboard" : "tickets");
  const [me, setMe] = useState<Me | null>(null);
  const [login, setLogin] = useState(() => {
    if (portalKind === "dispatcher") return { username: "dispatcher_ms", password: "dispatcher_demo_pw_change" };
    if (portalKind === "agent") return { username: "agent_ms_1", password: "agent_ms_1_change_me" };
    return { username: "admin_1", password: "admin_demo_pw_change" };
  });
  const [newPass, setNewPass] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);

  const [mods, setMods] = useState<Mod | null>(null);
  const [modsDraft, setModsDraft] = useState<Mod | null>(null);

  const [plants, setPlants] = useState<Plant[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [np, setNp] = useState({ slug: "", display_name: "", area_prefix: "MS" });
  const [na, setNa] = useState({ code: "", name: "" });

  const [ticketFilter, setTicketFilter] = useState({ status: "", area: "", department: "" });
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [ticketDetail, setTicketDetail] = useState<Record<string, unknown> | null>(null);
  const [ticketGroups, setTicketGroups] = useState<TicketGroup[]>([]);
  const [ticketAgents, setTicketAgents] = useState<TicketAgent[]>([]);
  const [dispatcherModalOpen, setDispatcherModalOpen] = useState(false);
  const [dispatcherPane, setDispatcherPane] = useState<DispatcherPane>("tickets");
  const [dispatcherFilter, setDispatcherFilter] = useState({ search: "", status: "open", department: "" });
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentPane, setAgentPane] = useState<AgentPane>("tickets");
  const [agentFilter, setAgentFilter] = useState({ search: "", status: "open", department: "" });
  const [triage, setTriage] = useState({ department: "", priority: 3, ticket_type: "Stoerung" });
  const [assignTo, setAssignTo] = useState("");
  const [routeDrafts, setRouteDrafts] = useState<RouteDraft[]>([{ group_id: "", priority: 3, reason: "", note: "", comment: "" }]);
  const [st, setSt] = useState({ status: "IN_PROGRESS", reason: "", public_comment: "" });
  const [ticketAttachment, setTicketAttachment] = useState<File | null>(null);
  const [ticketAttachmentKind, setTicketAttachmentKind] = useState("FILE");
  const [imagePreview, setImagePreview] = useState<TicketAttachmentView | null>(null);
  const [dispatcherActionNotice, setDispatcherActionNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [agentActionNotice, setAgentActionNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [newTicketGroup, setNewTicketGroup] = useState({ code: "", name: "", active: true });
  const [groupMemberDrafts, setGroupMemberDrafts] = useState<Record<number, string>>({});
  const [newDepartmentOption, setNewDepartmentOption] = useState("");
  const [newTicketTypeOption, setNewTicketTypeOption] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [dispatcherReport, setDispatcherReport] = useState({
    report_kind: "tickets",
    period: "today",
    from: "",
    to: "",
    plantId: "MS_DEMO_ANLAGE_01",
    department: "",
    ticket_id: "",
  });
  const [dispatcherFormats, setDispatcherFormats] = useState<string[]>(["pdf", "xlsx", "csv"]);
  const [dispatcherPreview, setDispatcherPreview] = useState<ReportPreview | null>(null);
  const [dispatcherRunDetail, setDispatcherRunDetail] = useState<Record<string, unknown> | null>(null);
  const [dispatcherSchedule, setDispatcherSchedule] = useState({
    name: "Tagesbericht Dispatcher",
    cron_type: "daily",
    timezone: "Europe/Berlin",
    report_kind: "tickets",
    plant_slug: "MS_DEMO_ANLAGE_01",
    department: "",
    ticket_id: "",
  });
  const [dispatcherScheduleFormats, setDispatcherScheduleFormats] = useState<string[]>(["pdf", "xlsx", "csv"]);

  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [runDetail, setRunDetail] = useState<Record<string, unknown> | null>(null);
  const [schedules, setSchedules] = useState<Record<string, unknown>[]>([]);
  const [repDel, setRepDel] = useState<Record<string, unknown>[]>([]);
  const [exp, setExp] = useState({ plantId: "MS_DEMO_ANLAGE_01", formats: "csv,json,xml" });
  const [sch, setSch] = useState({ name: "weekly ms", cron_type: "weekly", timezone: "Europe/Berlin", plant_slug: "MS_DEMO_ANLAGE_01", formats: "csv", recipients: "ops@example.local" });

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Record<string, unknown>[]>([]);
  const [nu, setNu] = useState({ username: "", password: "", roles: "Agent", force_password_change: true });
  const [userEditor, setUserEditor] = useState<UserEditorDraft | null>(null);
  const [userEditorOpen, setUserEditorOpen] = useState(false);

  const [opsStatus, setOpsStatus] = useState<OpsStatus | null>(null);
  const [opsErrors, setOpsErrors] = useState<Record<string, unknown>[]>([]);
  const [opsDel, setOpsDel] = useState<Record<string, unknown>[]>([]);
  const [dead, setDead] = useState<Record<string, unknown>[]>([]);
  const [certStatus, setCertStatus] = useState<CertificateStatus | null>(null);
  const [certBusy, setCertBusy] = useState(false);
  const [certHostDraft, setCertHostDraft] = useState("");
  const [certSanIpDraft, setCertSanIpDraft] = useState("");
  const [certCsrPem, setCertCsrPem] = useState("");
  const [certSignedPem, setCertSignedPem] = useState("");
  const [opf, setOpf] = useState({ trace_id: "", from_ts: "", to_ts: "" });
  const [logCfg, setLogCfg] = useState({ stream: "app", lines: 80 });
  const [logs, setLogs] = useState<Record<string, unknown> | null>(null);
  const [traces, setTraces] = useState<Record<string, unknown>[]>([]);
  const [traceDetail, setTraceDetail] = useState<Record<string, unknown> | null>(null);
  const [emailSettings, setEmailSettings] = useState<EmailSettingsDraft>({
    enabled: false,
    host: "",
    port: 587,
    security: "starttls",
    username: "",
    password: "",
    from_address: "",
    timeout_seconds: 10,
    has_password: false,
  });
  const [emailTestRecipient, setEmailTestRecipient] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const helpContent = useMemo<HelpContent>(() => {
    if (portalKind === "dispatcher") return DISPATCHER_HELP[dispatcherPane];
    if (portalKind === "agent") return AGENT_HELP[agentPane];
    return ADMIN_HELP[section] || ADMIN_HELP.dashboard;
  }, [portalKind, dispatcherPane, agentPane, section]);
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const isAdmin = useMemo(() => me?.roles.includes("Admin") ?? false, [me]);
  const visibleNav = useMemo(() => {
    if (!me) return NAV;
    if (me.roles.includes("Admin")) return NAV;
    if (me.roles.includes("Dispatcher")) return NAV.filter((x) => ["dashboard", "tickets", "ops"].includes(x.key));
    if (me.roles.includes("Agent")) return NAV.filter((x) => ["tickets"].includes(x.key));
    return NAV.filter((x) => ["tickets"].includes(x.key));
  }, [me]);
  const dispatcherTickets = useMemo(() => {
    const q = dispatcherFilter.search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (dispatcherFilter.department && (t.department || "") !== dispatcherFilter.department) return false;
      if (dispatcherFilter.status === "open" && CLOSED_TICKET_STATUSES.has(t.status)) return false;
      if (dispatcherFilter.status === "new" && !(t.status === "NEW" || t.status === "TRIAGE")) return false;
      if (dispatcherFilter.status === "work" && !(t.status === "QUEUED" || t.status === "IN_PROGRESS" || t.status === "RESOLVED")) return false;
      if (dispatcherFilter.status === "closed" && !CLOSED_TICKET_STATUSES.has(t.status)) return false;
      if (!q) return true;
      const haystack = `${t.id} ${t.subject || ""} ${t.description || ""} ${t.requester_name || ""} ${t.plant_slug || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [tickets, dispatcherFilter]);
  const dispatcherStats = useMemo(() => {
    const open = tickets.filter((t) => !CLOSED_TICKET_STATUSES.has(t.status)).length;
    const fresh = tickets.filter((t) => t.status === "NEW" || t.status === "TRIAGE").length;
    const work = tickets.filter((t) => t.status === "QUEUED" || t.status === "IN_PROGRESS").length;
    const closed = tickets.filter((t) => CLOSED_TICKET_STATUSES.has(t.status)).length;
    return { open, fresh, work, closed };
  }, [tickets]);
  const agentGroupScope = useMemo(() => {
    const username = me?.username || "";
    if (!username || !me?.roles.includes("Agent")) return { groupIds: [] as number[], groupCodes: [] as string[], groupNames: [] as string[] };
    const ownGroups = ticketGroups.filter((g) => (g.members || []).includes(username));
    return {
      groupIds: ownGroups.map((g) => g.id),
      groupCodes: ownGroups.map((g) => g.code),
      groupNames: ownGroups.map((g) => g.name),
    };
  }, [me, ticketGroups]);
  const agentAreaScope = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      const area = readString(t.area);
      if (area) set.add(area);
    });
    const guessed = detectAreaFromUsername(me?.username);
    if (guessed) set.add(guessed);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  }, [tickets, me]);
  const agentTickets = useMemo(() => {
    const q = agentFilter.search.trim().toLowerCase();
    return tickets.filter((t) => {
      const routeList = Array.isArray(t.group_routes) ? t.group_routes : [];
      if (agentGroupScope.groupIds.length) {
        const byDepartment = Boolean(t.department && agentGroupScope.groupNames.includes(t.department));
        const byRoute = routeList.some((route) => (
          agentGroupScope.groupIds.includes(route.id)
          || agentGroupScope.groupCodes.includes(route.code)
          || agentGroupScope.groupNames.includes(route.name)
        ));
        if (!byDepartment && !byRoute) return false;
      }
      if (agentFilter.department && (t.department || "") !== agentFilter.department) return false;
      if (agentFilter.status === "open" && CLOSED_TICKET_STATUSES.has(t.status)) return false;
      if (agentFilter.status === "new" && !(t.status === "NEW" || t.status === "TRIAGE")) return false;
      if (agentFilter.status === "work" && !(t.status === "QUEUED" || t.status === "IN_PROGRESS")) return false;
      if (agentFilter.status === "resolved" && t.status !== "RESOLVED") return false;
      if (agentFilter.status === "closed" && !CLOSED_TICKET_STATUSES.has(t.status)) return false;
      if (!q) return true;
      const haystack = `${t.id} ${t.subject || ""} ${t.description || ""} ${t.requester_name || ""} ${t.plant_slug || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [tickets, agentFilter, agentGroupScope]);
  const agentStats = useMemo(() => {
    const open = tickets.filter((t) => !CLOSED_TICKET_STATUSES.has(t.status)).length;
    const fresh = tickets.filter((t) => t.status === "NEW" || t.status === "TRIAGE").length;
    const work = tickets.filter((t) => t.status === "QUEUED" || t.status === "IN_PROGRESS").length;
    const resolved = tickets.filter((t) => t.status === "RESOLVED").length;
    const closed = tickets.filter((t) => CLOSED_TICKET_STATUSES.has(t.status)).length;
    return { open, fresh, work, resolved, closed };
  }, [tickets]);
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    const moduleValues = modsDraft?.tickets.department_options || mods?.tickets.department_options || [];
    moduleValues.forEach((v) => {
      const cleaned = v.trim();
      if (cleaned) set.add(cleaned);
    });
    ticketGroups.forEach((g) => set.add(g.name));
    tickets.forEach((t) => { if (t.department) set.add(t.department); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  }, [ticketGroups, tickets, mods, modsDraft]);
  const ticketTypeOptions = useMemo(() => {
    const set = new Set<string>();
    const moduleValues = modsDraft?.tickets.ticket_type_options || mods?.tickets.ticket_type_options || [];
    moduleValues.forEach((v) => {
      const cleaned = v.trim();
      if (cleaned) set.add(cleaned);
    });
    if (triage.ticket_type.trim()) set.add(triage.ticket_type.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  }, [mods, modsDraft, triage.ticket_type]);
  const roleOptions = useMemo(() => (
    roles
      .map((row) => (typeof row.name === "string" ? row.name.trim() : ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "de"))
  ), [roles]);
  const userDepartmentOptions = useMemo(() => (
    [...areas].sort((a, b) => a.code.localeCompare(b.code, "de"))
  ), [areas]);
  const dispatcherPlantOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => { if (t.plant_slug) set.add(t.plant_slug); });
    schedules.forEach((s) => {
      const slug = typeof s.plant_slug === "string" ? s.plant_slug : "";
      if (slug.trim()) set.add(slug.trim());
    });
    if (dispatcherReport.plantId.trim()) set.add(dispatcherReport.plantId.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  }, [tickets, schedules, dispatcherReport.plantId]);
  const ok = (m: string) => {
    setErr("");
    setMsg(m);
    if (portalKind === "dispatcher") setDispatcherActionNotice({ tone: "success", text: m });
    if (portalKind === "agent") setAgentActionNotice({ tone: "success", text: m });
  };
  const fail = (e: unknown) => {
    const text = e instanceof Error ? e.message : String(e);
    setMsg("");
    setErr(text);
    if (portalKind === "dispatcher") setDispatcherActionNotice({ tone: "error", text });
    if (portalKind === "agent") setAgentActionNotice({ tone: "error", text });
  };

  async function loadMe(silent: boolean) {
    try { setMe(await api<Me>("/api/auth/me")); } catch (e) { setMe(null); if (!silent) fail(e); }
  }

  async function doLogin() {
    try {
      await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(login) });
      await loadMe(true); ok("Login erfolgreich.");
    } catch (e) { fail(e); }
  }

  async function doLogout() { try { await api("/api/auth/logout", { method: "POST" }); setMe(null); } catch (e) { fail(e); } }

  async function doOwnPw() {
    if (newPass.trim().length < 8) return fail(new Error("Neues Passwort mindestens 8 Zeichen."));
    try { await api("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_password: newPass }) }); setNewPass(""); await loadMe(true); ok("Passwort geaendert."); } catch (e) { fail(e); }
  }
  async function loadProfile() {
    const profile = await api<Profile>("/api/auth/profile");
    setProfileEmail(profile.email || "");
  }
  async function saveProfileEmail() {
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: profileEmail }),
      });
      await Promise.all([loadMe(true), loadProfile()]);
      ok("E-Mail-Adresse wurde gespeichert.");
    } catch (e) {
      fail(e);
    }
  }
  function resolveDispatcherRange() {
    if (dispatcherReport.period === "custom") {
      const from = dispatcherReport.from.trim();
      const to = dispatcherReport.to.trim();
      return { from: from || null, to: to || null };
    }
    const now = new Date();
    if (dispatcherReport.period === "today") {
      return { from: toIsoLocalStart(now), to: toIsoLocalEnd(now) };
    }
    if (dispatcherReport.period === "week") {
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const start = new Date(now);
      start.setDate(now.getDate() + diff);
      return { from: toIsoLocalStart(start), to: toIsoLocalEnd(now) };
    }
    if (dispatcherReport.period === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toIsoLocalStart(start), to: toIsoLocalEnd(now) };
    }
    if (dispatcherReport.period === "year") {
      const start = new Date(now.getFullYear(), 0, 1);
      return { from: toIsoLocalStart(start), to: toIsoLocalEnd(now) };
    }
    return { from: null, to: null };
  }
  function dispatcherReportPayload(includeFormats: boolean) {
    const plantId = dispatcherReport.plantId.trim();
    if (!plantId) throw new Error("Bitte eine Anlage waehlen.");
    const range = resolveDispatcherRange();
    const ticketRaw = dispatcherReport.ticket_id.trim();
    const ticketId = ticketRaw ? Number(ticketRaw) : null;
    if (ticketRaw && (!Number.isFinite(ticketId) || ticketId < 1)) throw new Error("Ticket-ID muss eine positive Zahl sein.");
    const payload: Record<string, unknown> = {
      plantId,
      report_kind: dispatcherReport.report_kind,
      department: dispatcherReport.department.trim() || null,
      ticket_id: ticketId,
      from: range.from,
      to: range.to,
    };
    if (includeFormats) {
      if (!dispatcherFormats.length) throw new Error("Bitte mindestens ein Exportformat waehlen.");
      payload.formats = dispatcherFormats;
    }
    return payload;
  }
  function toggleDispatcherFormat(fmt: string) {
    if (dispatcherFormats.includes(fmt)) {
      setDispatcherFormats(dispatcherFormats.filter((x) => x !== fmt));
      return;
    }
    setDispatcherFormats([...dispatcherFormats, fmt]);
  }
  function toggleDispatcherScheduleFormat(fmt: string) {
    if (dispatcherScheduleFormats.includes(fmt)) {
      setDispatcherScheduleFormats(dispatcherScheduleFormats.filter((x) => x !== fmt));
      return;
    }
    setDispatcherScheduleFormats([...dispatcherScheduleFormats, fmt]);
  }
  async function loadDispatcherPreview() {
    try {
      const payload = dispatcherReportPayload(false);
      const preview = await api<ReportPreview>("/api/reporting/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, limit: 120 }),
      });
      setDispatcherPreview(preview);
      ok("Webvorschau wurde aktualisiert.");
    } catch (e) {
      fail(e);
    }
  }
  async function createDispatcherExport() {
    try {
      const payload = dispatcherReportPayload(true);
      const run = await api<{ id: number }>("/api/reporting/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const detail = await api<Record<string, unknown>>(`/api/reporting/runs/${run.id}`);
      setDispatcherRunDetail(detail);
      await loadReporting();
      ok(`Report ${run.id} wurde erstellt und steht zum Download bereit.`);
    } catch (e) {
      fail(e);
    }
  }
  async function createDispatcherSchedule() {
    try {
      const ownEmail = profileEmail.trim();
      if (!ownEmail) throw new Error("Bitte hinterlege zuerst unter 'Mein Konto' eine E-Mail-Adresse.");
      if (!dispatcherScheduleFormats.length) throw new Error("Bitte mindestens ein Exportformat fuer den automatischen Report waehlen.");
      const plantSlug = dispatcherSchedule.plant_slug.trim();
      if (!plantSlug) throw new Error("Bitte eine Anlage waehlen.");
      const ticketRaw = dispatcherSchedule.ticket_id.trim();
      const ticketId = ticketRaw ? Number(ticketRaw) : null;
      if (ticketRaw && (!Number.isFinite(ticketId) || ticketId < 1)) throw new Error("Ticket-ID muss eine positive Zahl sein.");
      await api("/api/reporting/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dispatcherSchedule.name.trim() || "Dispatcher Report",
          cron_type: dispatcherSchedule.cron_type,
          timezone: dispatcherSchedule.timezone.trim() || "Europe/Berlin",
          plant_slug: plantSlug,
          department: dispatcherSchedule.department.trim() || null,
          ticket_id: ticketId,
          report_kind: dispatcherSchedule.report_kind,
          formats: dispatcherScheduleFormats,
          recipients: [ownEmail],
        }),
      });
      await loadReporting();
      ok(`Automatischer Report wurde gespeichert und wird an ${ownEmail} gesendet.`);
    } catch (e) {
      fail(e);
    }
  }

  async function loadDashboard() { setDashboard(await api<Record<string, unknown>>("/api/admin/dashboard")); }
  async function loadCertificateStatus() {
    const status = await api<CertificateStatus>("/api/admin/certificate/status");
    setCertStatus(status);
    setCertHostDraft((prev) => {
      if (prev.trim()) return prev;
      if (status.host && status.host.trim()) return status.host.trim();
      if (typeof window !== "undefined") return (window.location.hostname || "").trim();
      return "";
    });
    setCertSanIpDraft((prev) => {
      if (prev.trim()) return prev;
      const candidate = (status.host || "").trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) return candidate;
      return "";
    });
  }
  async function renewCertificate() {
    try {
      setCertBusy(true);
      const result = await api<{ certificate: CertificateStatus }>("/api/admin/certificate/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setCertStatus(result.certificate);
      ok("TLS-Zertifikat wurde neu erzeugt und eingespielt.");
    } catch (e) {
      fail(e);
    } finally {
      setCertBusy(false);
    }
  }
  async function createDomainCertificateCsr() {
    try {
      setCertBusy(true);
      const host = certHostDraft.trim() || certStatus?.host || (typeof window !== "undefined" ? window.location.hostname : "");
      if (!host) throw new Error("Bitte zuerst einen TLS-Host eintragen.");
      const result = await api<CertificateDomainCsr>("/api/admin/certificate/domain/csr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          san_ip: certSanIpDraft.trim() || null,
        }),
      });
      setCertHostDraft(result.host || host);
      setCertCsrPem(result.csr_pem || "");
      ok("CSR wurde erzeugt. Bitte bei der Domaenen-CA signieren und unten einspielen.");
    } catch (e) {
      fail(e);
    } finally {
      setCertBusy(false);
    }
  }
  async function installDomainCertificate() {
    try {
      setCertBusy(true);
      const host = certHostDraft.trim() || certStatus?.host || (typeof window !== "undefined" ? window.location.hostname : "");
      if (!host) throw new Error("Bitte zuerst einen TLS-Host eintragen.");
      const pem = certSignedPem.trim();
      if (!pem.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Bitte ein signiertes PEM-Zertifikat einfuegen.");
      const result = await api<{ certificate: CertificateStatus }>("/api/admin/certificate/domain/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          certificate_pem: pem,
        }),
      });
      setCertStatus(result.certificate);
      await loadDashboard();
      ok("Signiertes Zertifikat wurde eingespielt und TLS wurde neu geladen.");
    } catch (e) {
      fail(e);
    } finally {
      setCertBusy(false);
    }
  }
  async function loadModules() { const m = await api<Mod>("/api/admin/module-settings"); setMods(m); setModsDraft(m); }
  async function saveModules() { if (!modsDraft) return; try { const m = await api<Mod>("/api/admin/module-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modsDraft) }); setMods(m); setModsDraft(m); ok("Module gespeichert."); } catch (e) { fail(e); } }
  function updateTicketOptions(key: "department_options" | "ticket_type_options", values: string[]) {
    if (!modsDraft) return;
    setModsDraft({
      ...modsDraft,
      tickets: {
        ...modsDraft.tickets,
        [key]: normalizeOptions(values),
      },
    });
  }
  function addTicketOption(key: "department_options" | "ticket_type_options", value: string) {
    if (!modsDraft) return;
    const cleaned = value.trim();
    if (!cleaned) return;
    updateTicketOptions(key, [...(modsDraft.tickets[key] || []), cleaned]);
  }
  function removeTicketOption(key: "department_options" | "ticket_type_options", value: string) {
    if (!modsDraft) return;
    updateTicketOptions(key, (modsDraft.tickets[key] || []).filter((item) => item !== value));
  }

  async function loadPlantsAreas() { const [p, a] = await Promise.all([api<Plant[]>("/api/plants"), api<Area[]>("/api/admin/areas")]); setPlants(p); setAreas(a); }
  async function createPlant() { try { await api("/api/plants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(np) }); setNp({ slug: "", display_name: "", area_prefix: "MS" }); await loadPlantsAreas(); ok("Anlage erstellt."); } catch (e) { fail(e); } }
  async function togglePlant(slug: string, active: boolean) { try { await api(`/api/plants/${encodeURIComponent(slug)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active }) }); await loadPlantsAreas(); } catch (e) { fail(e); } }
  async function deletePlant(slug: string) { if (!window.confirm(`Anlage ${slug} loeschen?`)) return; try { await api(`/api/admin/plants/${encodeURIComponent(slug)}`, { method: "DELETE" }); await loadPlantsAreas(); ok(`Anlage ${slug} geloescht.`); } catch (e) { fail(e); } }
  async function createArea() { try { await api("/api/admin/areas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(na) }); setNa({ code: "", name: "" }); await loadPlantsAreas(); } catch (e) { fail(e); } }
  async function renameArea(code: string, oldName: string) { const n = window.prompt(`Neuer Name fuer ${code}`, oldName); if (!n || n.trim() === oldName) return; try { await api(`/api/admin/areas/${encodeURIComponent(code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n.trim() }) }); await loadPlantsAreas(); } catch (e) { fail(e); } }
  async function deleteArea(code: string) { if (!window.confirm(`Bereich ${code} loeschen?`)) return; try { await api(`/api/admin/areas/${encodeURIComponent(code)}`, { method: "DELETE" }); await loadPlantsAreas(); ok(`Bereich ${code} geloescht.`); } catch (e) { fail(e); } }
  async function loadTicketGroups() {
    if (isAdmin) {
      const groups = await api<TicketGroup[]>("/api/admin/ticket-groups");
      setTicketGroups(groups);
      const nextDrafts: Record<number, string> = {};
      groups.forEach((group) => { nextDrafts[group.id] = (group.members || []).join(","); });
      setGroupMemberDrafts(nextDrafts);
      return;
    }
    setTicketGroups(await api<TicketGroup[]>("/api/tickets/groups"));
  }
  async function loadTicketAgents() {
    if (!me || (!me.roles.includes("Dispatcher") && !me.roles.includes("Admin"))) {
      setTicketAgents([]);
      return;
    }
    setTicketAgents(await api<TicketAgent[]>("/api/tickets/agents"));
  }
  async function createTicketGroup() {
    try {
      await api("/api/admin/ticket-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newTicketGroup.code.toUpperCase(),
          name: newTicketGroup.name,
          active: newTicketGroup.active,
        }),
      });
      setNewTicketGroup({ code: "", name: "", active: true });
      await loadTicketGroups();
      ok("Ticket-Gruppe erstellt.");
    } catch (e) {
      fail(e);
    }
  }
  async function toggleTicketGroup(group: TicketGroup) {
    try {
      await api(`/api/admin/ticket-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !group.active }),
      });
      await loadTicketGroups();
      ok(`Gruppe ${group.name} wurde ${group.active ? "deaktiviert" : "aktiviert"}.`);
    } catch (e) {
      fail(e);
    }
  }
  async function deleteTicketGroup(group: TicketGroup) {
    if (!window.confirm(`Ticket-Gruppe ${group.name} loeschen?`)) return;
    try {
      await api(`/api/admin/ticket-groups/${group.id}`, { method: "DELETE" });
      await loadTicketGroups();
      ok(`Gruppe ${group.name} geloescht.`);
    } catch (e) {
      fail(e);
    }
  }
  async function saveGroupMembers(group: TicketGroup) {
    try {
      const raw = groupMemberDrafts[group.id] ?? (group.members || []).join(",");
      const usernames = csv(raw);
      await api(`/api/admin/ticket-groups/${group.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames }),
      });
      await Promise.all([loadTicketGroups(), loadTicketAgents()]);
      ok(`Mitglieder fuer ${group.name} gespeichert.`);
    } catch (e) {
      fail(e);
    }
  }

  async function loadTickets() {
    const q = new URLSearchParams(); if (ticketFilter.status) q.set("status", ticketFilter.status.toUpperCase()); if (ticketFilter.area) q.set("area", ticketFilter.area.toUpperCase()); if (ticketFilter.department) q.set("department", ticketFilter.department);
    setTickets(await api<Ticket[]>(`/api/tickets${q.toString() ? `?${q}` : ""}`));
  }
  async function loadDispatcherTickets() {
    const area = detectAreaFromUsername(me?.username);
    const q = new URLSearchParams();
    if (area) q.set("area", area);
    if (dispatcherFilter.department) q.set("department", dispatcherFilter.department);
    const search = dispatcherFilter.search.trim();
    if (search.length >= 2) q.set("q", search);
    setTickets(await api<Ticket[]>(`/api/tickets${q.toString() ? `?${q}` : ""}`));
  }
  async function loadAgentTickets() {
    const area = detectAreaFromUsername(me?.username);
    const q = new URLSearchParams();
    if (area) q.set("area", area);
    if (agentFilter.department) q.set("department", agentFilter.department);
    const search = agentFilter.search.trim();
    if (search.length >= 2) q.set("q", search);
    setTickets(await api<Ticket[]>(`/api/tickets${q.toString() ? `?${q}` : ""}`));
  }
  async function openTicket(id: number) {
    setTicketId(id);
    const detail = await api<Record<string, unknown>>(`/api/tickets/${id}`);
    setTicketDetail(detail);
    const dep = readString(detail.department);
    const typ = readString(detail.ticket_type);
    const prio = readNumber(detail.priority_rank);
    setTriage((prev) => ({
      ...prev,
      department: dep || prev.department,
      ticket_type: typ || prev.ticket_type,
      priority: clampPriority(prio ?? prev.priority, 3),
    }));
  }
  async function openDispatcherTicket(id: number) {
    try {
      await openTicket(id);
      const current = tickets.find((t) => t.id === id);
      const groupName = current?.department || "";
      const group = ticketGroups.find((g) => g.name === groupName || g.code === groupName);
      setTriage((prev) => ({
        ...prev,
        department: groupName,
        priority: clampPriority(prev.priority, 3),
      }));
      setRouteDrafts([{ group_id: group ? String(group.id) : "", priority: 3, reason: "", note: "", comment: "" }]);
      setImagePreview(null);
      setDispatcherActionNotice(null);
      setDispatcherModalOpen(true);
    } catch (e) {
      fail(e);
    }
  }
  async function openAgentTicket(id: number) {
    try {
      await openTicket(id);
      const detail = await api<Record<string, unknown>>(`/api/tickets/${id}`);
      const currentStatus = readString(detail.status);
      setSt((prev) => ({
        ...prev,
        status: currentStatus === "CLOSED" ? "CLOSED" : "IN_PROGRESS",
        reason: "",
        public_comment: "",
      }));
      setImagePreview(null);
      setAgentActionNotice(null);
      setAgentModalOpen(true);
    } catch (e) {
      fail(e);
    }
  }
  async function submitTriage() {
    if (!triage.department.trim()) return fail(new Error("Bitte Bereich auswaehlen."));
    if (!triage.ticket_type.trim()) return fail(new Error("Bitte Ticket-Typ auswaehlen."));
    await tkAction("triage", {
      department: triage.department.trim(),
      priority: clampPriority(triage.priority, 3),
      ticket_type: triage.ticket_type.trim(),
    });
  }
  async function tkAction(path: string, body: Record<string, unknown>) {
    if (!ticketId) return fail(new Error("Bitte Ticket auswaehlen."));
    try {
      await api(`/api/tickets/${ticketId}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (portalKind === "dispatcher") {
        await Promise.all([loadDispatcherTickets(), openTicket(ticketId)]);
      } else {
        await Promise.all([loadTickets(), openTicket(ticketId)]);
      }
      if (path === "triage") {
        ok(`Ticket ${ticketId} wurde eingeordnet. Schritt 2 ist jetzt freigegeben.`);
      } else if (path === "status") {
        ok(`Status fuer Ticket ${ticketId} wurde gespeichert.`);
      } else {
        ok(`Ticket ${ticketId} wurde aktualisiert.`);
      }
    } catch (e) {
      fail(e);
    }
  }
  async function uploadTicketAttachment() {
    if (!ticketId) return fail(new Error("Bitte Ticket auswaehlen."));
    if (!ticketAttachment) return fail(new Error("Bitte Datei auswaehlen."));
    try {
      const fd = new FormData();
      fd.append("kind", ticketAttachmentKind);
      fd.append("file", ticketAttachment);
      await api(`/api/tickets/${ticketId}/attachments`, { method: "POST", body: fd });
      setTicketAttachment(null);
      await Promise.all([openTicket(ticketId), portalKind === "dispatcher" ? loadDispatcherTickets() : Promise.resolve()]);
      ok(`Anhang zu Ticket ${ticketId} hochgeladen.`);
    } catch (e) {
      fail(e);
    }
  }
  async function routeTicketToGroups() {
    if (!ticketId) return fail(new Error("Bitte Ticket auswaehlen."));
    if (!isTicketTriaged(ticketDetail as Record<string, unknown> | null)) {
      return fail(new Error("Bitte zuerst Ticket einordnen."));
    }
    const targets = routeDrafts
      .map((row) => ({
        group_id: Number(row.group_id),
        priority: clampPriority(Number(row.priority), 3),
        reason: row.reason.trim(),
        note: row.note.trim(),
        comment: row.comment.trim(),
      }))
      .filter((row) => row.group_id > 0);
    if (targets.length === 0) return fail(new Error("Bitte mindestens eine Gruppe auswaehlen."));
    try {
      await api(`/api/tickets/${ticketId}/route-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      await Promise.all([loadDispatcherTickets(), openTicket(ticketId)]);
      ok(`Ticket ${ticketId} wurde an ${targets.length} Gruppe(n) weitergeleitet.`);
    } catch (e) {
      fail(e);
    }
  }
  async function removeTicketRoute(groupId: number, groupName: string) {
    if (!ticketId) return fail(new Error("Bitte Ticket auswaehlen."));
    if (!window.confirm(`Zuordnung zu ${groupName} wirklich entfernen?`)) return;
    try {
      await api(`/api/tickets/${ticketId}/route-groups/${groupId}`, { method: "DELETE" });
      await Promise.all([loadDispatcherTickets(), openTicket(ticketId)]);
      ok(`Gruppe ${groupName} wurde aus Ticket ${ticketId} entfernt.`);
    } catch (e) {
      fail(e);
    }
  }

  async function loadReporting() { const [r, s, d] = await Promise.all([api<Record<string, unknown>[]>("/api/reporting/runs?limit=120"), api<Record<string, unknown>[]>("/api/reporting/schedules"), api<Record<string, unknown>[]>("/api/reporting/deliveries?limit=120")]); setRuns(r); setSchedules(s); setRepDel(d); }
  async function createExport() { try { const run = await api<{ id: number }>("/api/reporting/exports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...exp, formats: csv(exp.formats) }) }); setRunDetail(await api(`/api/reporting/runs/${run.id}`)); await loadReporting(); } catch (e) { fail(e); } }
  async function createSchedule() { try { await api("/api/reporting/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...sch, formats: csv(sch.formats), recipients: csv(sch.recipients) }) }); await loadReporting(); } catch (e) { fail(e); } }
  async function scheduleRun(id: number) {
    try {
      const run = await api<{ id: number }>(`/api/reporting/schedules/${id}/run-now`, { method: "POST" });
      const detail = await api<Record<string, unknown>>(`/api/reporting/runs/${run.id}`);
      setRunDetail(detail);
      if (portalKind === "dispatcher") setDispatcherRunDetail(detail);
      await loadReporting();
      ok(`Automatischer Report ${run.id} wurde gestartet.`);
    } catch (e) { fail(e); }
  }
  async function scheduleToggle(id: number, enabled: boolean) { try { await api(`/api/reporting/schedules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) }); await loadReporting(); } catch (e) { fail(e); } }
  async function scheduleDelete(id: number) { if (!window.confirm(`Schedule ${id} loeschen?`)) return; try { await api(`/api/reporting/schedules/${id}`, { method: "DELETE" }); await loadReporting(); } catch (e) { fail(e); } }

  function openUserEditor(user: AdminUser) {
    const groups = Array.isArray(user.ticket_groups) ? user.ticket_groups : [];
    const departments = Array.isArray(user.departments) && user.departments.length
      ? user.departments.map((entry) => entry.trim().toUpperCase()).filter(Boolean)
      : (user.department ? [user.department.trim().toUpperCase()] : []);
    setUserEditor({
      username: user.username,
      roles: Array.isArray(user.roles) ? [...user.roles] : [],
      departments,
      groupIds: groups.map((entry) => entry.id),
      newPassword: "",
      forcePasswordChange: Boolean(user.force_password_change),
    });
    setUserEditorOpen(true);
  }
  function toggleUserEditorRole(roleName: string) {
    if (!userEditor) return;
    if (userEditor.roles.includes(roleName)) {
      const nextRoles = userEditor.roles.filter((entry) => entry !== roleName);
      const nextGroupIds = roleName === "Agent" ? [] : userEditor.groupIds;
      setUserEditor({ ...userEditor, roles: nextRoles, groupIds: nextGroupIds });
      return;
    }
    setUserEditor({ ...userEditor, roles: [...userEditor.roles, roleName] });
  }
  function toggleUserEditorGroup(groupId: number) {
    if (!userEditor) return;
    if (userEditor.groupIds.includes(groupId)) {
      setUserEditor({ ...userEditor, groupIds: userEditor.groupIds.filter((entry) => entry !== groupId) });
      return;
    }
    setUserEditor({ ...userEditor, groupIds: [...userEditor.groupIds, groupId] });
  }
  function toggleUserEditorDepartment(areaCode: string) {
    if (!userEditor) return;
    const code = areaCode.trim().toUpperCase();
    if (!code) return;
    if (userEditor.departments.includes(code)) {
      setUserEditor({ ...userEditor, departments: userEditor.departments.filter((entry) => entry !== code) });
      return;
    }
    setUserEditor({ ...userEditor, departments: [...userEditor.departments, code] });
  }
  async function loadUsers() {
    const [u, r, g, a] = await Promise.all([
      api<AdminUser[]>("/api/admin/users"),
      api<Record<string, unknown>[]>("/api/admin/roles"),
      api<TicketGroup[]>("/api/admin/ticket-groups"),
      api<Area[]>("/api/admin/areas"),
    ]);
    setUsers(u);
    setRoles(r);
    setTicketGroups(g);
    setAreas(a);
    return u;
  }
  async function createUser() {
    try {
      await api("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...nu, roles: csv(nu.roles) }) });
      setNu({ username: "", password: "", roles: "Agent", force_password_change: true });
      await loadUsers();
      ok("Benutzer wurde erstellt.");
    } catch (e) {
      fail(e);
    }
  }
  async function saveUserEditor() {
    if (!userEditor) return;
    const password = userEditor.newPassword.trim();
    if (password && password.length < 8) return fail(new Error("Neues Passwort muss mindestens 8 Zeichen haben."));
    try {
      await api(`/api/admin/users/${encodeURIComponent(userEditor.username)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roles: userEditor.roles,
          departments: userEditor.departments.map((entry) => entry.trim().toUpperCase()).filter(Boolean),
          group_ids: userEditor.groupIds,
        }),
      });
      if (password) {
        await api(`/api/admin/users/${encodeURIComponent(userEditor.username)}/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_password: password, force_password_change: userEditor.forcePasswordChange }),
        });
      }
      const updatedUsers = await loadUsers();
      const refreshed = updatedUsers.find((entry) => entry.username === userEditor.username);
      if (refreshed) {
        const refreshedGroups = Array.isArray(refreshed.ticket_groups) ? refreshed.ticket_groups : [];
        setUserEditor({
          username: refreshed.username,
          roles: Array.isArray(refreshed.roles) ? [...refreshed.roles] : [],
          departments: Array.isArray(refreshed.departments)
            ? refreshed.departments.map((entry) => entry.trim().toUpperCase()).filter(Boolean)
            : ((refreshed.department || "").trim() ? [String(refreshed.department).trim().toUpperCase()] : []),
          groupIds: refreshedGroups.map((entry) => entry.id),
          newPassword: "",
          forcePasswordChange: Boolean(refreshed.force_password_change),
        });
      }
      ok(`Benutzerdaten fuer ${userEditor.username} wurden gespeichert.`);
    } catch (e) {
      fail(e);
    }
  }
  async function userDelete(username: string) {
    if (!window.confirm(`Benutzer ${username} loeschen?`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
      await loadUsers();
      if (userEditor?.username === username) {
        setUserEditor(null);
        setUserEditorOpen(false);
      }
      ok(`Benutzer ${username} wurde geloescht.`);
    } catch (e) {
      fail(e);
    }
  }

  async function loadEmailSettings() {
    const data = await api<Record<string, unknown>>("/api/admin/email-settings");
    setEmailSettings({
      enabled: Boolean(data.enabled),
      host: readString(data.host),
      port: Number(data.port || 587) || 587,
      security: readString(data.security) || "starttls",
      username: readString(data.username),
      password: "",
      from_address: readString(data.from_address),
      timeout_seconds: Number(data.timeout_seconds || 10) || 10,
      has_password: Boolean(data.has_password),
    });
  }

  async function saveEmailSettings() {
    try {
      const saved = await api<Record<string, unknown>>("/api/admin/email-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: emailSettings.enabled,
          host: emailSettings.host.trim(),
          port: Number(emailSettings.port || 0),
          security: emailSettings.security,
          username: emailSettings.username.trim(),
          password: emailSettings.password,
          from_address: emailSettings.from_address.trim(),
          timeout_seconds: Number(emailSettings.timeout_seconds || 10),
        }),
      });
      setEmailSettings({
        enabled: Boolean(saved.enabled),
        host: readString(saved.host),
        port: Number(saved.port || 587) || 587,
        security: readString(saved.security) || "starttls",
        username: readString(saved.username),
        password: "",
        from_address: readString(saved.from_address),
        timeout_seconds: Number(saved.timeout_seconds || 10) || 10,
        has_password: Boolean(saved.has_password),
      });
      await loadOps();
      ok("E-Mail-Server Konfiguration wurde gespeichert.");
    } catch (e) {
      fail(e);
    }
  }

  async function testEmailSettings(sendTestMail: boolean) {
    try {
      const payload: Record<string, unknown> = { send_test_mail: sendTestMail };
      const recipient = emailTestRecipient.trim();
      if (recipient) payload.recipient = recipient;
      await api("/api/admin/email-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadOps();
      ok(sendTestMail ? "Testmail wurde erfolgreich gesendet." : "SMTP-Verbindung erfolgreich getestet.");
    } catch (e) {
      fail(e);
    }
  }

  async function loadOps() {
    const q = new URLSearchParams(); if (opf.trace_id) q.set("trace_id", opf.trace_id); if (opf.from_ts) q.set("from_ts", opf.from_ts); if (opf.to_ts) q.set("to_ts", opf.to_ts);
    const [s, e, d, de, l, t] = await Promise.all([
      api<OpsStatus>("/api/ops/status"),
      api<Record<string, unknown>[]>(`/api/ops/errors${q.toString() ? `?${q}` : ""}`),
      api<Record<string, unknown>[]>("/api/ops/deliveries?limit=120"),
      api<Record<string, unknown>[]>("/api/ops/dead-letters?limit=120"),
      api<Record<string, unknown>>(`/api/ops/logs/tail?stream=${encodeURIComponent(logCfg.stream)}&lines=${Math.max(20, Math.min(500, logCfg.lines))}`),
      api<Record<string, unknown>[]>("/api/ops/traces?limit=120"),
    ]);
    setOpsStatus(s); setOpsErrors(e); setOpsDel(d); setDead(de); setLogs(l); setTraces(t);
  }
  async function opsRetry(id: number) { try { await api(`/api/ops/deliveries/${id}/retry`, { method: "POST" }); await loadOps(); } catch (e) { fail(e); } }
  async function showTrace(id: string) { try { setTraceDetail(await api(`/api/ops/traces/${encodeURIComponent(id)}`)); } catch (e) { fail(e); } }

  async function refresh() {
    try {
      if (portalKind === "dispatcher") {
        await Promise.all([loadDispatcherTickets(), loadTicketGroups(), loadTicketAgents(), loadModules(), loadReporting(), loadProfile()]);
        return;
      }
      if (portalKind === "agent") {
        await Promise.all([loadAgentTickets(), loadTicketGroups(), loadProfile()]);
        return;
      }
      if (section === "dashboard") await Promise.all([loadDashboard(), loadOps(), loadModules(), loadPlantsAreas(), loadTicketGroups(), loadEmailSettings(), loadCertificateStatus()]);
      if (section === "modules") await loadModules();
      if (section === "plants") await loadPlantsAreas();
      if (section === "tickets") await Promise.all([loadTickets(), loadTicketGroups(), loadTicketAgents()]);
      if (section === "users") await loadUsers();
      if (section === "ops") await Promise.all([loadOps(), loadEmailSettings()]);
    } catch (e) { fail(e); }
  }

  useEffect(() => { void loadMe(true); }, []);
  useEffect(() => { if (me) void refresh(); }, [me, section]);
  useEffect(() => {
    if (me && portalKind === "dispatcher") {
      void Promise.all([loadDispatcherTickets(), loadTicketGroups(), loadTicketAgents()]);
    }
  }, [me, dispatcherFilter.department, dispatcherFilter.search]);
  useEffect(() => {
    if (me && portalKind === "agent") {
      void loadAgentTickets();
    }
  }, [me, portalKind, agentFilter.department, agentFilter.search]);
  useEffect(() => {
    if (!me) return;
    if (portalKind === "dispatcher") {
      void Promise.all([loadReporting(), loadProfile()]);
      return;
    }
    if (portalKind === "agent") {
      void Promise.all([loadProfile(), loadTicketGroups()]);
    }
  }, [me, portalKind]);
  useEffect(() => {
    if (!me) return;
    if (portalKind === "dispatcher" || portalKind === "agent") {
      if (section !== "tickets") setSection("tickets");
      return;
    }
    const allowed = visibleNav.map((v) => v.key);
    if (!allowed.includes(section) && allowed.length > 0) {
      setSection(allowed[0]);
    }
  }, [me, section, visibleNav, portalKind]);
  useEffect(() => {
    if (!ticketTypeOptions.length) return;
    if (!ticketTypeOptions.includes(triage.ticket_type)) {
      setTriage((prev) => ({ ...prev, ticket_type: ticketTypeOptions[0] }));
    }
  }, [ticketTypeOptions, triage.ticket_type]);
  useEffect(() => {
    if (portalKind !== "dispatcher") return;
    if (dispatcherPane !== "tickets" && dispatcherModalOpen) {
      setDispatcherModalOpen(false);
    }
  }, [portalKind, dispatcherPane, dispatcherModalOpen]);
  useEffect(() => {
    if (portalKind !== "agent") return;
    if (agentPane !== "tickets" && agentModalOpen) {
      setAgentModalOpen(false);
    }
  }, [portalKind, agentPane, agentModalOpen]);

  if (!me) {
    const loginTitle = portalKind === "dispatcher" ? "Dispatcher Anmeldung" : portalKind === "agent" ? "Endbearbeiter Anmeldung" : "Admin Anmeldung";
    return (
      <div className="container login">
        <div className="panel stack">
          <h1>{loginTitle}</h1>
          <input placeholder="username" value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} />
          <input type="password" placeholder="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
          <button onClick={doLogin}>Anmelden</button>
          {err ? <p className="error">{err}</p> : null}
        </div>
      </div>
    );
  }

  if (portalKind === "dispatcher") {
    const detail = ticketDetail as Record<string, unknown> | null;
    const detailEvents = detail && Array.isArray(detail.events) ? detail.events as Array<Record<string, unknown>> : [];
    const detailRoutes = detail && Array.isArray(detail.group_routes) ? detail.group_routes as Array<Record<string, unknown>> : [];
    const detailAttachments = detail && Array.isArray(detail.attachments) ? detail.attachments as TicketAttachmentView[] : [];
    const detailStatus = String(detail?.status || "");
    const detailSubject = String(detail?.subject || "Ticket ohne Betreff");
    const detailDescription = String(detail?.description || "");
    const detailPlant = String(detail?.plant_slug || "-");
    const detailRequester = String(detail?.requester_name || "-");
    const detailAssignee = String(detail?.assignee_username || "-");
    const detailCreatedAt = typeof detail?.created_at === "string" ? detail.created_at : null;
    const detailIsTriaged = isTicketTriaged(detail);
    const routeRemovalBlocked = STARTED_TICKET_STATUSES.has(detailStatus);
    const previewRows = dispatcherPreview?.rows || [];
    const previewColumns = dispatcherPreview?.columns || [];
    const previewSummary = dispatcherPreview?.summary || null;
    const dispatcherRunArtifacts = dispatcherRunDetail && Array.isArray(dispatcherRunDetail.artifacts)
      ? dispatcherRunDetail.artifacts as Array<Record<string, unknown>>
      : [];
    const dispatcherRecipientEmail = profileEmail.trim();
    const schedulePlantOptions = Array.from(new Set([
      ...dispatcherPlantOptions,
      dispatcherSchedule.plant_slug.trim(),
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "de"));
    return (
      <div className="container dispatcher-page">
        <div className="dispatcher-shell">
          <aside className="panel dispatcher-sidebar">
            <h2>Dispatcher</h2>
            <p className="muted">{me.username}</p>
            <div className="stack dispatcher-nav">
              <button className={`dispatcher-nav-btn ${dispatcherPane === "tickets" ? "active" : ""}`} onClick={() => setDispatcherPane("tickets")}>Tickets Leitstand</button>
              <button className={`dispatcher-nav-btn ${dispatcherPane === "konto" ? "active" : ""}`} onClick={() => setDispatcherPane("konto")}>Mein Konto</button>
              <button className={`dispatcher-nav-btn ${dispatcherPane === "report_builder" ? "active" : ""}`} onClick={() => setDispatcherPane("report_builder")}>Report Builder</button>
              <button className={`dispatcher-nav-btn ${dispatcherPane === "auto_reports" ? "active" : ""}`} onClick={() => setDispatcherPane("auto_reports")}>Automatische Reports</button>
            </div>
            <div className="stack dispatcher-sidebar-actions">
              <button className="secondary" onClick={() => void refresh()}>Aktualisieren</button>
              <button className="secondary" onClick={() => setHelpOpen(true)}>Hilfe</button>
              <button className="danger" onClick={doLogout}>Abmelden</button>
            </div>
          </aside>

          <div className="dispatcher-main stack">
            {dispatcherPane === "tickets" ? (
              <>
        <section className="panel dispatcher-hero">
          <div className="header">
            <div>
              <h2>Dispatcher Leitstand</h2>
              <p className="sub">Hier steuerst du alle Tickets deiner Anlage in drei einfachen Schritten.</p>
            </div>
            <div className="toolbar">
              <button className="secondary" onClick={() => void loadDispatcherTickets()}>Liste aktualisieren</button>
            </div>
          </div>
          <div className="dispatcher-steps">
            <article className="step-card">
              <div className="step-no">1</div>
              <h3>Ticket auswaehlen</h3>
              <p>Suche dir ein offenes Ticket aus der Liste aus und oeffne die Details.</p>
            </article>
            <article className="step-card">
              <div className="step-no">2</div>
              <h3>Einordnen</h3>
              <p>Lege Bereich, Prioritaet und Typ fest. So weiss jeder sofort, was wichtig ist.</p>
            </article>
            <article className="step-card">
              <div className="step-no">3</div>
              <h3>Gruppen steuern</h3>
              <p>An ein oder mehrere Gewerke senden und den Status zentral steuern.</p>
            </article>
          </div>
          {msg ? <p className="ok">{msg}</p> : null}
          {err ? <p className="error">{err}</p> : null}
        </section>

        <section className="panel">
          <div className="header">
            <h2>Uebersicht</h2>
            <span className="badge">Aktive Tickets im Bereich: {dispatcherStats.open}</span>
          </div>
          <div className="stats dispatcher-stats">
            <div className="stat stat-open"><div className="k">Offen</div><div className="v">{dispatcherStats.open}</div></div>
            <div className="stat stat-new"><div className="k">Neu</div><div className="v">{dispatcherStats.fresh}</div></div>
            <div className="stat stat-work"><div className="k">In Arbeit</div><div className="v">{dispatcherStats.work}</div></div>
            <div className="stat stat-closed"><div className="k">Geschlossen</div><div className="v">{dispatcherStats.closed}</div></div>
          </div>
          <div className="dispatcher-filters">
            <div className="field">
              <label>Freitextsuche</label>
              <input
                placeholder="z.B. Foerderband, Druck, Sensor"
                value={dispatcherFilter.search}
                onChange={(e) => setDispatcherFilter({ ...dispatcherFilter, search: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Statusfilter</label>
              <select value={dispatcherFilter.status} onChange={(e) => setDispatcherFilter({ ...dispatcherFilter, status: e.target.value })}>
                <option value="open">Nur offene Tickets</option>
                <option value="new">Nur neue Tickets</option>
                <option value="work">In Bearbeitung</option>
                <option value="closed">Geschlossen / storniert</option>
                <option value="all">Alle Tickets</option>
              </select>
            </div>
            <div className="field">
              <label>Bereich</label>
              <select value={dispatcherFilter.department} onChange={(e) => setDispatcherFilter({ ...dispatcherFilter, department: e.target.value })}>
                <option value="">Alle Bereiche</option>
                {departmentOptions.map((dep) => <option key={dep} value={dep}>{dep}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="header">
            <h2>Ticketliste</h2>
            <span className="muted">{dispatcherTickets.length} Treffer</span>
          </div>
          {dispatcherTickets.length === 0 ? <p className="muted">Keine Tickets fuer den aktuellen Filter gefunden.</p> : null}
          <div className="dispatcher-ticket-list">
            {dispatcherTickets.map((t) => (
              <article key={t.id} className="dispatcher-ticket-card">
                <div className="header">
                  <h3>#{t.id} {t.subject || "Ticket ohne Betreff"}</h3>
                  <span className={`badge ${ticketStatusClass(t.status)}`}>{ticketStatusLabel(t.status)}</span>
                </div>
                <p className="muted">{t.description ? `${t.description.slice(0, 170)}${t.description.length > 170 ? "..." : ""}` : "Keine Beschreibung vorhanden."}</p>
                <div className="toolbar">
                  <span className="badge">Anlage: {t.plant_slug || "-"}</span>
                  <span className="badge">Bereich: {t.department || "-"}</span>
                  <span className="badge">Prioritaet: {priorityLabel(t.priority_rank)}</span>
                  <span className="badge">Melder: {t.requester_name || "-"}</span>
                  <span className="badge">Aktualisiert: {formatTs(t.updated_at || t.created_at || null)}</span>
                </div>
                <div className="dispatcher-ticket-actions">
                  <button onClick={() => void openDispatcherTicket(t.id)}>Ticket oeffnen</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {dispatcherModalOpen ? (
          <div className="d-modal-bg" onClick={() => setDispatcherModalOpen(false)}>
            <div className="d-modal" onClick={(e) => e.stopPropagation()}>
              <div className="header">
                <h2>Ticket bearbeiten</h2>
                <button className="secondary" onClick={() => setDispatcherModalOpen(false)}>Schliessen</button>
              </div>
              {dispatcherActionNotice ? (
                <div className={`dispatcher-feedback ${dispatcherActionNotice.tone}`}>
                  <strong>{dispatcherActionNotice.tone === "success" ? "Erfolg:" : dispatcherActionNotice.tone === "error" ? "Hinweis:" : "Info:"}</strong> {dispatcherActionNotice.text}
                </div>
              ) : null}
              {!detail ? <p>Lade Ticket-Details...</p> : (
                <div className="stack">
                  <section className="panel dispatcher-focus">
                    <div className="header">
                      <h3>#{String(detail.id)} {detailSubject}</h3>
                      <span className={`badge ${ticketStatusClass(detailStatus)}`}>{ticketStatusLabel(detailStatus)}</span>
                    </div>
                    <p className="muted">{detailDescription || "Keine Beschreibung vorhanden."}</p>
                    <div className="dispatcher-meta">
                      <span className="badge">Anlage: {detailPlant}</span>
                      <span className="badge">Melder: {detailRequester}</span>
                      <span className="badge">Bearbeiter: {detailAssignee}</span>
                      <span className="badge">Erstellt: {formatTs(detailCreatedAt)}</span>
                    </div>
                  </section>

                  <section className="panel dispatcher-action-card">
                    <h3>Ausloeser-Meldung</h3>
                    <p className="muted">Das ist die originale Meldung vom Anlagenfahrer.</p>
                    <details open className="dispatcher-source">
                      <summary>Meldedaten anzeigen</summary>
                      <div className="stack" style={{ marginTop: 8 }}>
                        <div className="field">
                          <label>Wer hat das Ticket ausgeloest?</label>
                          <input value={detailRequester} readOnly />
                        </div>
                        <div className="field">
                          <label>Betreff</label>
                          <input value={detailSubject} readOnly />
                        </div>
                        <div className="field">
                          <label>Beschreibung</label>
                          <textarea value={detailDescription} readOnly />
                        </div>
                      </div>
                    </details>
                  </section>

                  <div className="cols-2">
                    <section className={`panel dispatcher-action-card ${detailIsTriaged ? "is-ready" : "is-disabled"}`}>
                      <div className="header">
                        <h3>1) Ticket einordnen</h3>
                        <span className={`dispatcher-state ${detailIsTriaged ? "done" : "wait"}`}>{detailIsTriaged ? "Eingeordnet" : "Noch offen"}</span>
                      </div>
                      <p className="muted">Damit das Ticket im richtigen Team landet.</p>
                      <div className="field">
                        <label>Bereich</label>
                        <select value={triage.department} onChange={(e) => setTriage({ ...triage, department: e.target.value })}>
                          <option value="">Bitte Bereich waehlen</option>
                          {departmentOptions.map((dep) => <option key={dep} value={dep}>{dep}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>Prioritaet (0-6)</label>
                        <select value={String(clampPriority(triage.priority, 3))} onChange={(e) => setTriage({ ...triage, priority: clampPriority(Number(e.target.value), 3) })}>
                          {PRIORITY_LEVELS.map((level) => <option key={level} value={String(level)}>{priorityOptionLabel(level)}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>Ticket-Typ</label>
                        <select value={triage.ticket_type} onChange={(e) => setTriage({ ...triage, ticket_type: e.target.value })}>
                          <option value="">Bitte Ticket-Typ waehlen</option>
                          {ticketTypeOptions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                        </select>
                      </div>
                      <button onClick={() => void submitTriage()}>Einordnen</button>
                    </section>

                    <section className={`panel dispatcher-action-card ${detailIsTriaged ? "is-ready" : "is-disabled"}`}>
                      <div className="header">
                        <h3>2) An Gruppen senden</h3>
                        <span className={`dispatcher-state ${detailIsTriaged ? "done" : "wait"}`}>{detailIsTriaged ? "Freigegeben" : "Gesperrt bis Einordnung"}</span>
                      </div>
                      <p className="muted">Das Ticket kann gleichzeitig an mehrere Gruppen gehen, jeweils mit eigenem Grund und Kommentar. Spaeteres Weiterleiten ist jederzeit moeglich.</p>
                      {!detailIsTriaged ? <p className="warn-text">Bitte zuerst Schritt 1 abschliessen, dann werden Gruppen freigeschaltet.</p> : null}
                      <fieldset className="dispatcher-fieldset" disabled={!detailIsTriaged}>
                        <div className="stack">
                          {routeDrafts.map((row, idx) => (
                            <article key={`route-${idx}`} className="dispatcher-event">
                              <div className="field">
                                <label>Gruppe</label>
                                <select value={row.group_id} onChange={(e) => {
                                  const next = [...routeDrafts];
                                  next[idx] = { ...next[idx], group_id: e.target.value };
                                  setRouteDrafts(next);
                                }}>
                                  <option value="">Bitte waehlen</option>
                                  {ticketGroups.filter((g) => g.active).map((g) => <option key={g.id} value={String(g.id)}>{g.name} ({g.code})</option>)}
                                </select>
                              </div>
                              <div className="field">
                                <label>Grund fuer diese Gruppe</label>
                                <input value={row.reason} onChange={(e) => {
                                  const next = [...routeDrafts];
                                  next[idx] = { ...next[idx], reason: e.target.value };
                                  setRouteDrafts(next);
                                }} placeholder="z.B. Elektrik pruefen Stromversorgung" />
                              </div>
                              <div className="field">
                                <label>Prioritaet fuer diese Gruppe</label>
                                <select value={String(row.priority)} onChange={(e) => {
                                  const next = [...routeDrafts];
                                  next[idx] = { ...next[idx], priority: clampPriority(Number(e.target.value), 3) };
                                  setRouteDrafts(next);
                                }}>
                                  {PRIORITY_LEVELS.map((level) => <option key={level} value={String(level)}>{priorityOptionLabel(level)}</option>)}
                                </select>
                              </div>
                              <div className="field">
                                <label>Interne Notiz (nur intern)</label>
                                <textarea value={row.note} onChange={(e) => {
                                  const next = [...routeDrafts];
                                  next[idx] = { ...next[idx], note: e.target.value };
                                  setRouteDrafts(next);
                                }} placeholder="z.B. Zugang nur mit Freigabe Schichtleiter" />
                              </div>
                              <div className="field">
                                <label>Kommentar an diese Gruppe</label>
                                <textarea value={row.comment} onChange={(e) => {
                                  const next = [...routeDrafts];
                                  next[idx] = { ...next[idx], comment: e.target.value };
                                  setRouteDrafts(next);
                                }} placeholder="z.B. Bitte Rueckmeldung bis Schichtende" />
                              </div>
                              {routeDrafts.length > 1 ? <button className="danger" onClick={() => setRouteDrafts(routeDrafts.filter((_, i) => i !== idx))}>Zeile entfernen</button> : null}
                            </article>
                          ))}
                        </div>
                        <div className="toolbar">
                          <button className="secondary" onClick={() => setRouteDrafts([...routeDrafts, { group_id: "", priority: 3, reason: "", note: "", comment: "" }])}>Weitere Gruppe</button>
                          <button onClick={() => void routeTicketToGroups()}>An Gruppen senden</button>
                        </div>
                      </fieldset>
                    </section>
                  </div>

                  <section className="panel dispatcher-action-card">
                    <h3>3) Status steuern</h3>
                    <p className="muted">Hier steuerst du den Gesamtstatus des Tickets. Einzel-Agent-Zuweisung ist im Dispatcher nicht erforderlich.</p>
                    <div className="field">
                      <label>Status</label>
                      <select value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })}>
                        <option value="IN_PROGRESS">In Bearbeitung</option>
                        <option value="RESOLVED">Geloest</option>
                        <option value="CLOSED">Geschlossen</option>
                        <option value="CANCELLED">Storniert</option>
                      </select>
                    </div>
                    <div className="cols-2">
                      <div className="field">
                        <label>Grund (optional)</label>
                        <input value={st.reason} onChange={(e) => setSt({ ...st, reason: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Kommentar fuer den Melder</label>
                        <textarea value={st.public_comment} onChange={(e) => setSt({ ...st, public_comment: e.target.value })} />
                      </div>
                    </div>
                    <div className="toolbar">
                      <button className="warn" onClick={() => void tkAction("status", st)}>Status speichern</button>
                    </div>
                  </section>

                  <section className="panel dispatcher-action-card">
                    <h3>4) Anhaenge</h3>
                    <p className="muted">Hier koennen Bilder, Screenshots oder Dateien angehaengt werden.</p>
                    <div className="cols-2">
                      <div className="field">
                        <label>Dateityp</label>
                        <select value={ticketAttachmentKind} onChange={(e) => setTicketAttachmentKind(e.target.value)}>
                          <option value="FILE">Datei</option>
                          <option value="IMAGE">Bild</option>
                          <option value="SCREENSHOT">Screenshot</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Datei auswaehlen</label>
                        <input type="file" onChange={(e) => setTicketAttachment(e.target.files?.[0] ?? null)} />
                      </div>
                    </div>
                    <button className="secondary" onClick={() => void uploadTicketAttachment()}>Anhang hochladen</button>
                    {detailAttachments.length === 0 ? <p className="muted">Keine Anhaenge vorhanden.</p> : (
                      <div className="dispatcher-events">
                        {detailAttachments.map((file) => (
                          <article key={`file-${file.file_id}`} className="dispatcher-event">
                            <div className="header">
                              <strong>{file.filename_original}</strong>
                              <span className="badge">{file.kind}</span>
                            </div>
                            <p className="muted">{file.mime} | {Math.round((file.size_bytes || 0) / 1024)} KB | {formatTs(file.created_at || null)}</p>
                            <div className="toolbar">
                              {isImageAttachment(file) ? (
                                <button className="secondary" onClick={() => setImagePreview(file)}>Bild ansehen</button>
                              ) : (
                                <a className="inline-link" href={file.download_url} target="_blank" rel="noreferrer">Ansehen</a>
                              )}
                              <a className="inline-link" href={`${file.download_url}?download=1`} target="_blank" rel="noreferrer">Herunterladen</a>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="panel dispatcher-action-card">
                    <h3>Aktuelle Gruppenrouten</h3>
                    {detailRoutes.length === 0 ? <p className="muted">Noch keine Gruppenrouten vorhanden.</p> : (
                      <div className="dispatcher-events">
                        {detailRoutes.map((route, idx) => (
                          <article key={`route-view-${idx}`} className="dispatcher-event">
                            <div className="header">
                              <strong>{String(route.group_name || route.group_code || "-")}</strong>
                              <span className="badge">{String(route.status || "-")}</span>
                            </div>
                            <p className="muted">Prioritaet: {priorityDisplay(route.priority)}</p>
                            <p className="muted">Grund: {String(route.reason || "-")}</p>
                            <p className="muted">Notiz intern: {String(route.note || "-")}</p>
                            <p className="muted">Kommentar: {String(route.comment || "-")}</p>
                            <div className="toolbar">
                              <button
                                className="danger"
                                disabled={routeRemovalBlocked || Number(route.group_id || 0) <= 0}
                                onClick={() => void removeTicketRoute(Number(route.group_id || 0), String(route.group_name || route.group_code || "Gruppe"))}
                              >
                                Zuordnung entfernen
                              </button>
                              <span className="muted">{routeRemovalBlocked ? "Entfernen gesperrt: Bearbeitung hat bereits begonnen." : "Entfernen ist nur vor Bearbeitungsstart moeglich."}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="panel dispatcher-action-card">
                    <h3>Bearbeitungsverlauf</h3>
                    {detailEvents.length === 0 ? <p className="muted">Noch keine Eintraege vorhanden.</p> : (
                      <div className="dispatcher-events">
                        {detailEvents.map((ev, idx) => (
                          <article key={`${String(ev.event_type)}-${idx}`} className="dispatcher-event">
                            <div className="header">
                              <strong>{ticketEventLabel(String(ev.event_type || ""))}</strong>
                              <span className="badge">{formatTs(typeof ev.created_at === "string" ? ev.created_at : null)}</span>
                            </div>
                            <p className="muted">{ticketEventSummary(String(ev.event_type || ""), ev.payload)}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        ) : null}
              </>
            ) : null}

        {dispatcherPane === "konto" ? (
        <section className="panel dispatcher-action-card">
          <h3>Mein Konto</h3>
          <p className="muted">Hier kannst du deine E-Mail-Adresse pflegen und dein Passwort aendern.</p>
          <div className="cols-2">
            <div className="field">
              <label>E-Mail-Adresse</label>
              <input
                type="email"
                placeholder="name@firma.de"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Neues Passwort</label>
              <input
                type="password"
                placeholder="mindestens 8 Zeichen"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
            </div>
          </div>
          <div className="toolbar">
            <button className="secondary" onClick={() => void saveProfileEmail()}>E-Mail speichern</button>
            <button className="secondary" onClick={() => void doOwnPw()}>Passwort aendern</button>
          </div>
        </section>
        ) : null}

        {dispatcherPane === "report_builder" ? (
        <section className="panel dispatcher-action-card">
          <h3>Report Builder</h3>
          <p className="muted">Berichte manuell erzeugen, in der Webvorschau ansehen und danach herunterladen.</p>
          <div className="cols-3">
            <div className="field">
              <label>Report-Typ</label>
              <select value={dispatcherReport.report_kind} onChange={(e) => setDispatcherReport({ ...dispatcherReport, report_kind: e.target.value })}>
                <option value="tickets">Tickets</option>
                <option value="schichtbuch">Schichtbuch</option>
                <option value="kombiniert">Kombiniert</option>
              </select>
            </div>
            <div className="field">
              <label>Zeitraum</label>
              <select value={dispatcherReport.period} onChange={(e) => setDispatcherReport({ ...dispatcherReport, period: e.target.value })}>
                <option value="today">Heute</option>
                <option value="week">Diese Woche</option>
                <option value="month">Dieser Monat</option>
                <option value="year">Dieses Jahr</option>
                <option value="custom">Freie Zeitspanne</option>
              </select>
            </div>
            <div className="field">
              <label>Anlage</label>
              <input
                list="dispatcher-plant-list"
                value={dispatcherReport.plantId}
                onChange={(e) => setDispatcherReport({ ...dispatcherReport, plantId: e.target.value })}
                placeholder="z.B. MS_DEMO_ANLAGE_01"
              />
              <datalist id="dispatcher-plant-list">
                {dispatcherPlantOptions.map((slug) => <option key={slug} value={slug} />)}
              </datalist>
            </div>
          </div>
          <div className="cols-3">
            <div className="field">
              <label>Bereich (optional)</label>
              <select value={dispatcherReport.department} onChange={(e) => setDispatcherReport({ ...dispatcherReport, department: e.target.value })}>
                <option value="">Alle Bereiche</option>
                {departmentOptions.map((dep) => <option key={dep} value={dep}>{dep}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Ticket-ID (optional)</label>
              <input
                value={dispatcherReport.ticket_id}
                onChange={(e) => setDispatcherReport({ ...dispatcherReport, ticket_id: e.target.value })}
                placeholder="z.B. 123"
              />
            </div>
            {dispatcherReport.period === "custom" ? (
              <div className="field">
                <label>Von/Bis</label>
                <div className="cols-2">
                  <input type="datetime-local" value={dispatcherReport.from} onChange={(e) => setDispatcherReport({ ...dispatcherReport, from: e.target.value })} />
                  <input type="datetime-local" value={dispatcherReport.to} onChange={(e) => setDispatcherReport({ ...dispatcherReport, to: e.target.value })} />
                </div>
              </div>
            ) : <div className="field"><label>Zeitraum-Info</label><input readOnly value="Wird automatisch aus der Auswahl berechnet." /></div>}
          </div>
          <div className="field">
            <label>Download-Formate</label>
            <div className="toolbar">
              {REPORT_FORMATS.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className={`secondary format-chip ${dispatcherFormats.includes(fmt) ? "active" : ""}`}
                  onClick={() => toggleDispatcherFormat(fmt)}
                >
                  {REPORT_FORMAT_LABEL[fmt]}
                </button>
              ))}
            </div>
          </div>
          <div className="toolbar">
            <button className="secondary" onClick={() => void loadDispatcherPreview()}>Webvorschau laden</button>
            <button onClick={() => void createDispatcherExport()}>Bericht erstellen</button>
          </div>

          {previewSummary ? (
            <div className="stats" style={{ marginTop: 10 }}>
              <div className="stat"><div className="k">Gesamt</div><div className="v">{String(previewSummary.total_rows ?? 0)}</div></div>
              <div className="stat"><div className="k">Tickets</div><div className="v">{String(previewSummary.ticket_rows ?? 0)}</div></div>
              <div className="stat"><div className="k">Schichtbuch</div><div className="v">{String(previewSummary.schichtbuch_rows ?? 0)}</div></div>
              <div className="stat"><div className="k">Offene Tickets</div><div className="v">{String(previewSummary.offene_tickets ?? 0)}</div></div>
            </div>
          ) : null}

          {previewRows.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>{previewColumns.map((col) => <th key={`col-${col}`}>{col}</th>)}</tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 20).map((row, idx) => (
                    <tr key={`preview-row-${idx}`}>
                      {previewColumns.map((col) => <td key={`preview-${idx}-${col}`}>{String(row[col] ?? "")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {dispatcherRunDetail ? (
            <div style={{ marginTop: 10 }}>
              <h4 style={{ marginBottom: 6 }}>Letzter erzeugter Report #{String(dispatcherRunDetail.id || "-")}</h4>
              <div className="toolbar">
                {dispatcherRunArtifacts.map((artifact) => (
                  <a
                    key={`artifact-${String(artifact.artifact_id)}`}
                    className="inline-link"
                    href={`/api/reporting/runs/${String(dispatcherRunDetail.id)}/artifacts/${String(artifact.artifact_id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {REPORT_FORMAT_LABEL[String(artifact.format || "").toLowerCase()] || String(artifact.format || "Download")}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </section>
        ) : null}

        {dispatcherPane === "auto_reports" ? (
        <section className="panel dispatcher-action-card">
          <h3>Automatische Reports</h3>
          <p className="muted">Stelle oben den Report per Pulldown zusammen und fuege ihn mit einem Klick zur Liste hinzu.</p>
          <div className={`dispatcher-feedback ${dispatcherRecipientEmail ? "info" : "error"}`}>
            {dispatcherRecipientEmail
              ? `Empfaenger fest gesetzt: ${dispatcherRecipientEmail}`
              : "Kein Empfaenger gesetzt. Bitte zuerst unter 'Mein Konto' eine E-Mail hinterlegen."}
          </div>

          <div className="auto-report-builder">
            <div className="cols-3">
              <div className="field">
                <label>Name</label>
                <input
                  value={dispatcherSchedule.name}
                  onChange={(e) => setDispatcherSchedule({ ...dispatcherSchedule, name: e.target.value })}
                  placeholder="z.B. Tagesbericht Mechanik"
                />
              </div>
              <div className="field">
                <label>Intervall</label>
                <select value={dispatcherSchedule.cron_type} onChange={(e) => setDispatcherSchedule({ ...dispatcherSchedule, cron_type: e.target.value })}>
                  {Object.entries(CRON_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Berichtstyp</label>
                <select value={dispatcherSchedule.report_kind} onChange={(e) => setDispatcherSchedule({ ...dispatcherSchedule, report_kind: e.target.value })}>
                  {Object.entries(REPORT_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
            <div className="cols-3">
              <div className="field">
                <label>Anlage</label>
                <select value={dispatcherSchedule.plant_slug} onChange={(e) => setDispatcherSchedule({ ...dispatcherSchedule, plant_slug: e.target.value })}>
                  {schedulePlantOptions.map((slug) => <option key={`schedule-plant-${slug}`} value={slug}>{slug}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Bereich</label>
                <select value={dispatcherSchedule.department} onChange={(e) => setDispatcherSchedule({ ...dispatcherSchedule, department: e.target.value })}>
                  <option value="">Alle Bereiche</option>
                  {departmentOptions.map((dep) => <option key={`schedule-dep-${dep}`} value={dep}>{dep}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Zeitzone</label>
                <select value={dispatcherSchedule.timezone} onChange={(e) => setDispatcherSchedule({ ...dispatcherSchedule, timezone: e.target.value })}>
                  {DISPATCHER_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>
            <div className="cols-2">
              <div className="field">
                <label>Ticket-ID (optional)</label>
                <input
                  value={dispatcherSchedule.ticket_id}
                  onChange={(e) => setDispatcherSchedule({ ...dispatcherSchedule, ticket_id: e.target.value })}
                  placeholder="Nur fuer ein bestimmtes Ticket, z.B. 123"
                />
              </div>
              <div className="field">
                <label>Export-Formate</label>
                <div className="toolbar">
                  {REPORT_FORMATS.map((fmt) => (
                    <button
                      key={`schedule-format-${fmt}`}
                      type="button"
                      className={`secondary format-chip ${dispatcherScheduleFormats.includes(fmt) ? "active" : ""}`}
                      onClick={() => toggleDispatcherScheduleFormat(fmt)}
                    >
                      {REPORT_FORMAT_LABEL[fmt]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="toolbar">
              <button disabled={!dispatcherRecipientEmail} onClick={() => void createDispatcherSchedule()}>Zur Liste hinzufuegen</button>
            </div>
          </div>

          <div className="header" style={{ marginTop: 12 }}>
            <h4 style={{ margin: 0 }}>Gespeicherte Zeitplaene</h4>
            <span className="badge">{schedules.length} Eintraege</span>
          </div>
          {schedules.length === 0 ? <p className="muted">Noch keine automatischen Reports vorhanden.</p> : null}
          <div className="dispatcher-events dispatcher-schedule-list" style={{ marginTop: 10 }}>
            {schedules
              .slice()
              .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
              .map((entry) => {
                const enabled = Boolean(entry.enabled);
                const scheduleId = Number(entry.id || 0);
                const recipients = readStringArray(entry.recipients);
                const formatList = readStringArray(entry.formats)
                  .map((fmt) => REPORT_FORMAT_LABEL[fmt.toLowerCase()] || fmt.toUpperCase())
                  .join(", ") || "-";
                return (
                  <article key={`schedule-${String(entry.id)}`} className={`dispatcher-event dispatcher-schedule-card ${enabled ? "enabled" : "disabled"}`}>
                    <div className="header">
                      <strong>{String(entry.name || `Schedule ${String(entry.id)}`)}</strong>
                      <span className={`dispatcher-schedule-state ${enabled ? "enabled" : "disabled"}`}>{enabled ? "Aktiv" : "Inaktiv"}</span>
                    </div>
                    <p className="muted">
                      Intervall: {CRON_TYPE_LABEL[readString(entry.cron_type)] || String(entry.cron_type || "-")} | Typ: {REPORT_KIND_LABEL[readString(entry.report_kind)] || String(entry.report_kind || "-")}
                    </p>
                    <p className="muted">
                      Anlage: {String(entry.plant_slug || "-")} | Bereich: {String(entry.department || "Alle")}
                    </p>
                    <p className="muted">
                      Formate: {formatList}
                    </p>
                    <p className="muted">
                      Empfaenger: {recipients.join(", ") || "-"}
                    </p>
                    <div className="toolbar">
                      <button className="secondary" disabled={scheduleId <= 0} onClick={() => void scheduleRun(scheduleId)}>Jetzt starten</button>
                      <button className="secondary" disabled={scheduleId <= 0} onClick={() => void scheduleToggle(scheduleId, enabled)}>{enabled ? "Deaktivieren" : "Aktivieren"}</button>
                      <button className="danger" disabled={scheduleId <= 0} onClick={() => void scheduleDelete(scheduleId)}>Loeschen</button>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
        ) : null}
          </div>
        </div>

        {imagePreview ? (
          <div className="image-lightbox-bg" onClick={() => setImagePreview(null)}>
            <div className="image-lightbox" onClick={(e) => e.stopPropagation()}>
              <div className="header">
                <h3>{imagePreview.filename_original}</h3>
                <button className="secondary" onClick={() => setImagePreview(null)}>Schliessen</button>
              </div>
              <img src={imagePreview.download_url} alt={imagePreview.filename_original} />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <a className="inline-link" href={`${imagePreview.download_url}?download=1`} target="_blank" rel="noreferrer">Bild herunterladen</a>
              </div>
            </div>
          </div>
        ) : null}
        <HelpModal open={helpOpen} content={helpContent} onClose={() => setHelpOpen(false)} />
      </div>
    );
  }

  if (portalKind === "agent") {
    const detail = ticketDetail as Record<string, unknown> | null;
    const detailEvents = detail && Array.isArray(detail.events) ? detail.events as Array<Record<string, unknown>> : [];
    const detailRoutes = detail && Array.isArray(detail.group_routes) ? detail.group_routes as Array<Record<string, unknown>> : [];
    const detailAttachments = detail && Array.isArray(detail.attachments) ? detail.attachments as TicketAttachmentView[] : [];
    const detailStatus = String(detail?.status || "");
    const detailSubject = String(detail?.subject || "Ticket ohne Betreff");
    const detailDescription = String(detail?.description || "");
    const detailPlant = String(detail?.plant_slug || "-");
    const detailRequester = String(detail?.requester_name || "-");
    const detailAssignee = String(detail?.assignee_username || "-");
    const detailCreatedAt = typeof detail?.created_at === "string" ? detail.created_at : null;
    const agentAreaLabel = agentAreaScope.join(", ") || "-";
    const agentDepartmentLabel = agentGroupScope.groupNames.join(", ") || "-";
    return (
      <div className="container dispatcher-page">
        <div className="dispatcher-shell">
          <aside className="panel dispatcher-sidebar">
            <h2>Endbearbeiter</h2>
            <p className="muted">{me.username}</p>
            <p className="muted">Abteilung: <strong>{agentAreaLabel}</strong></p>
            <p className="muted">Bereiche: <strong>{agentDepartmentLabel}</strong></p>
            <div className="stack dispatcher-nav">
              <button className={`dispatcher-nav-btn ${agentPane === "tickets" ? "active" : ""}`} onClick={() => setAgentPane("tickets")}>Meine Tickets</button>
              <button className={`dispatcher-nav-btn ${agentPane === "konto" ? "active" : ""}`} onClick={() => setAgentPane("konto")}>Mein Konto</button>
            </div>
            <div className="stack dispatcher-sidebar-actions">
              <button className="secondary" onClick={() => void refresh()}>Aktualisieren</button>
              <button className="secondary" onClick={() => setHelpOpen(true)}>Hilfe</button>
              <button className="danger" onClick={doLogout}>Abmelden</button>
            </div>
          </aside>

          <div className="dispatcher-main stack">
            {agentPane === "tickets" ? (
              <>
                <section className="panel dispatcher-hero">
                  <div className="header">
                    <div>
                      <h2>Ticket-Arbeitsbereich</h2>
                      <p className="sub">Hier siehst du nur deine relevanten Tickets und arbeitest sie Schritt fuer Schritt ab.</p>
                    </div>
                    <div className="toolbar">
                      <button className="secondary" onClick={() => void loadAgentTickets()}>Liste aktualisieren</button>
                    </div>
                  </div>
                  <div className="dispatcher-steps">
                    <article className="step-card">
                      <div className="step-no">1</div>
                      <h3>Ticket oeffnen</h3>
                      <p>Waehle ein Ticket aus der Liste und lies die Meldung.</p>
                    </article>
                    <article className="step-card">
                      <div className="step-no">2</div>
                      <h3>Status setzen</h3>
                      <p>Trage ein, ob du begonnen hast, fertig bist oder abschliesst.</p>
                    </article>
                    <article className="step-card">
                      <div className="step-no">3</div>
                      <h3>Nachweis anhaengen</h3>
                      <p>Lade bei Bedarf ein Bild oder eine Datei hoch.</p>
                    </article>
                  </div>
                  {msg ? <p className="ok">{msg}</p> : null}
                  {err ? <p className="error">{err}</p> : null}
                </section>

                <section className="panel">
                  <div className="header">
                    <h2>Uebersicht</h2>
                    <span className="badge">Aktive Tickets: {agentStats.open}</span>
                  </div>
                  <div className="stats dispatcher-stats">
                    <div className="stat stat-open"><div className="k">Offen</div><div className="v">{agentStats.open}</div></div>
                    <div className="stat stat-new"><div className="k">Neu</div><div className="v">{agentStats.fresh}</div></div>
                    <div className="stat stat-work"><div className="k">In Arbeit</div><div className="v">{agentStats.work}</div></div>
                    <div className="stat stat-closed"><div className="k">Erledigt</div><div className="v">{agentStats.resolved + agentStats.closed}</div></div>
                  </div>
                  <div className="dispatcher-filters">
                    <div className="field">
                      <label>Freitextsuche</label>
                      <input
                        placeholder="z.B. Motor, Sensor, Druck"
                        value={agentFilter.search}
                        onChange={(e) => setAgentFilter({ ...agentFilter, search: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Statusfilter</label>
                      <select value={agentFilter.status} onChange={(e) => setAgentFilter({ ...agentFilter, status: e.target.value })}>
                        <option value="open">Nur offene Tickets</option>
                        <option value="new">Nur neue Tickets</option>
                        <option value="work">In Bearbeitung</option>
                        <option value="resolved">Geloest</option>
                        <option value="closed">Geschlossen / storniert</option>
                        <option value="all">Alle Tickets</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Bereich</label>
                      <select value={agentFilter.department} onChange={(e) => setAgentFilter({ ...agentFilter, department: e.target.value })}>
                        <option value="">Alle Bereiche</option>
                        {departmentOptions.map((dep) => <option key={`agent-dep-${dep}`} value={dep}>{dep}</option>)}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="header">
                    <h2>Meine Ticketliste</h2>
                    <span className="muted">{agentTickets.length} Treffer</span>
                  </div>
                  {agentTickets.length === 0 ? <p className="muted">Keine Tickets fuer den aktuellen Filter gefunden.</p> : null}
                  <div className="dispatcher-ticket-list">
                    {agentTickets.map((t) => (
                      <article key={t.id} className="dispatcher-ticket-card">
                        <div className="header">
                          <h3>#{t.id} {t.subject || "Ticket ohne Betreff"}</h3>
                          <span className={`badge ${ticketStatusClass(t.status)}`}>{ticketStatusLabel(t.status)}</span>
                        </div>
                        <p className="muted">{t.description ? `${t.description.slice(0, 170)}${t.description.length > 170 ? "..." : ""}` : "Keine Beschreibung vorhanden."}</p>
                        <div className="toolbar">
                          <span className="badge">Anlage: {t.plant_slug || "-"}</span>
                          <span className="badge">Bereich: {t.department || "-"}</span>
                          <span className="badge">Prioritaet: {priorityLabel(t.priority_rank)}</span>
                          <span className="badge">Aktualisiert: {formatTs(t.updated_at || t.created_at || null)}</span>
                        </div>
                        <div className="dispatcher-ticket-actions">
                          <button onClick={() => void openAgentTicket(t.id)}>Ticket bearbeiten</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                {agentModalOpen ? (
                  <div className="d-modal-bg" onClick={() => setAgentModalOpen(false)}>
                    <div className="d-modal" onClick={(e) => e.stopPropagation()}>
                      <div className="header">
                        <h2>Ticket bearbeiten</h2>
                        <button className="secondary" onClick={() => setAgentModalOpen(false)}>Schliessen</button>
                      </div>
                      {agentActionNotice ? (
                        <div className={`dispatcher-feedback ${agentActionNotice.tone}`}>
                          <strong>{agentActionNotice.tone === "success" ? "Erfolg:" : agentActionNotice.tone === "error" ? "Hinweis:" : "Info:"}</strong> {agentActionNotice.text}
                        </div>
                      ) : null}
                      {!detail ? <p>Lade Ticket-Details...</p> : (
                        <div className="stack">
                          <section className="panel dispatcher-focus">
                            <div className="header">
                              <h3>#{String(detail.id)} {detailSubject}</h3>
                              <span className={`badge ${ticketStatusClass(detailStatus)}`}>{ticketStatusLabel(detailStatus)}</span>
                            </div>
                            <p className="muted">{detailDescription || "Keine Beschreibung vorhanden."}</p>
                            <div className="dispatcher-meta">
                              <span className="badge">Anlage: {detailPlant}</span>
                              <span className="badge">Melder: {detailRequester}</span>
                              <span className="badge">Bearbeiter: {detailAssignee}</span>
                              <span className="badge">Erstellt: {formatTs(detailCreatedAt)}</span>
                            </div>
                            <div className="toolbar" style={{ marginTop: 8 }}>
                              {detailRoutes.map((route, idx) => <span key={`agent-route-${idx}`} className="badge">{String(route.group_name || route.group_code || "Gruppe")}</span>)}
                            </div>
                          </section>

                          <section className="panel dispatcher-action-card">
                            <h3>1) Status aktualisieren</h3>
                            <p className="muted">Als Endbearbeiter kannst du nur starten oder abschliessen.</p>
                            <div className="field">
                              <label>Status</label>
                              <select value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })}>
                                <option value="IN_PROGRESS">In Bearbeitung (ich starte jetzt)</option>
                                <option value="CLOSED">Abgeschlossen (ich bin fertig)</option>
                              </select>
                            </div>
                            <div className="cols-2">
                              <div className="field">
                                <label>Grund (optional)</label>
                                <input value={st.reason} onChange={(e) => setSt({ ...st, reason: e.target.value })} placeholder="z.B. Ersatzteil bestellt" />
                              </div>
                              <div className="field">
                                <label>Kommentar fuer Melder</label>
                                <textarea value={st.public_comment} onChange={(e) => setSt({ ...st, public_comment: e.target.value })} placeholder="Kurze, klare Rueckmeldung" />
                              </div>
                            </div>
                            <div className="toolbar">
                              <button className="warn" onClick={() => void tkAction("status", st)}>Status speichern</button>
                            </div>
                          </section>

                          <section className="panel dispatcher-action-card">
                            <h3>2) Bild oder Datei anhaengen</h3>
                            <p className="muted">Damit der aktuelle Stand eindeutig dokumentiert ist.</p>
                            <div className="cols-2">
                              <div className="field">
                                <label>Dateityp</label>
                                <select value={ticketAttachmentKind} onChange={(e) => setTicketAttachmentKind(e.target.value)}>
                                  <option value="FILE">Datei</option>
                                  <option value="IMAGE">Bild</option>
                                  <option value="SCREENSHOT">Screenshot</option>
                                </select>
                              </div>
                              <div className="field">
                                <label>Datei auswaehlen</label>
                                <input type="file" onChange={(e) => setTicketAttachment(e.target.files?.[0] ?? null)} />
                              </div>
                            </div>
                            <button className="secondary" onClick={() => void uploadTicketAttachment()}>Anhang hochladen</button>
                            {detailAttachments.length === 0 ? <p className="muted">Keine Anhaenge vorhanden.</p> : (
                              <div className="dispatcher-events" style={{ marginTop: 8 }}>
                                {detailAttachments.map((file) => (
                                  <article key={`agent-file-${file.file_id}`} className="dispatcher-event">
                                    <div className="header">
                                      <strong>{file.filename_original}</strong>
                                      <span className="badge">{file.kind}</span>
                                    </div>
                                    <p className="muted">{file.mime} | {Math.round((file.size_bytes || 0) / 1024)} KB | {formatTs(file.created_at || null)}</p>
                                    <div className="toolbar">
                                      {isImageAttachment(file) ? (
                                        <button className="secondary" onClick={() => setImagePreview(file)}>Bild ansehen</button>
                                      ) : (
                                        <a className="inline-link" href={file.download_url} target="_blank" rel="noreferrer">Ansehen</a>
                                      )}
                                      <a className="inline-link" href={`${file.download_url}?download=1`} target="_blank" rel="noreferrer">Herunterladen</a>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            )}
                          </section>

                          <section className="panel dispatcher-action-card">
                            <h3>3) Bearbeitungsverlauf</h3>
                            {detailEvents.length === 0 ? <p className="muted">Noch keine Eintraege vorhanden.</p> : (
                              <div className="dispatcher-events">
                                {detailEvents.map((ev, idx) => (
                                  <article key={`agent-event-${String(ev.event_type)}-${idx}`} className="dispatcher-event">
                                    <div className="header">
                                      <strong>{ticketEventLabel(String(ev.event_type || ""))}</strong>
                                      <span className="badge">{formatTs(typeof ev.created_at === "string" ? ev.created_at : null)}</span>
                                    </div>
                                    <p className="muted">{ticketEventSummary(String(ev.event_type || ""), ev.payload)}</p>
                                  </article>
                                ))}
                              </div>
                            )}
                          </section>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {agentPane === "konto" ? (
              <section className="panel dispatcher-action-card">
                <h3>Mein Konto</h3>
                <p className="muted">Hier kannst du deine E-Mail-Adresse pflegen und dein Passwort aendern.</p>
                <div className="cols-2">
                  <div className="field">
                    <label>E-Mail-Adresse</label>
                    <input
                      type="email"
                      placeholder="name@firma.de"
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Neues Passwort</label>
                    <input
                      type="password"
                      placeholder="mindestens 8 Zeichen"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                    />
                  </div>
                </div>
                <div className="toolbar">
                  <button className="secondary" onClick={() => void saveProfileEmail()}>E-Mail speichern</button>
                  <button className="secondary" onClick={() => void doOwnPw()}>Passwort aendern</button>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        {imagePreview ? (
          <div className="image-lightbox-bg" onClick={() => setImagePreview(null)}>
            <div className="image-lightbox" onClick={(e) => e.stopPropagation()}>
              <div className="header">
                <h3>{imagePreview.filename_original}</h3>
                <button className="secondary" onClick={() => setImagePreview(null)}>Schliessen</button>
              </div>
              <img src={imagePreview.download_url} alt={imagePreview.filename_original} />
              <div className="toolbar" style={{ marginTop: 10 }}>
                <a className="inline-link" href={`${imagePreview.download_url}?download=1`} target="_blank" rel="noreferrer">Bild herunterladen</a>
              </div>
            </div>
          </div>
        ) : null}
        <HelpModal open={helpOpen} content={helpContent} onClose={() => setHelpOpen(false)} />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="app-shell">
        <aside className="panel sidebar">
          <h1>Anlagen Admin</h1>
          <p>{me.username} ({me.roles.join(", ")})</p>
          <div className="nav">{visibleNav.map((n) => <button key={n.key} className={`nav-btn ${section === n.key ? "active" : ""}`} onClick={() => setSection(n.key)}>{n.label}</button>)}</div>
          <div className="stack" style={{ marginTop: 12 }}>
            <input type="password" placeholder="Neues Passwort" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            <button className="secondary" onClick={doOwnPw}>Passwort speichern</button>
            <button className="secondary" onClick={() => setHelpOpen(true)}>Hilfe</button>
            <button className="danger" onClick={doLogout}>Logout</button>
          </div>
        </aside>

        <main className="stack">
          <section className="panel">
            <div className="header"><h2>{visibleNav.find((n) => n.key === section)?.label || NAV.find((n) => n.key === section)?.label}</h2><button onClick={() => void refresh()}>Aktualisieren</button></div>
            <p className="sub">{isAdmin ? "Admin Rechte aktiv." : "Eingeschraenkte Rechte."}</p>
            {me.force_password_change ? <p className="warn-text">Passwortwechsel erforderlich.</p> : null}
            {msg ? <p className="ok">{msg}</p> : null}
            {err ? <p className="error">{err}</p> : null}
          </section>

          {section === "dashboard" ? (
            <div className="stack">
              <section className="panel">
                <h2>Gesamtuebersicht</h2>
                <p className="muted">Schneller Einstieg in die wichtigsten Bereiche.</p>
                <div className="stats">
                  <div className="stat"><div className="k">Anlagen</div><div className="v">{plants.length}</div></div>
                  <div className="stat"><div className="k">Bereiche</div><div className="v">{areas.length}</div></div>
                  <div className="stat"><div className="k">Ticket-Gruppen</div><div className="v">{ticketGroups.length}</div></div>
                  <div className="stat"><div className="k">Offene Ops-Fehler</div><div className="v">{opsErrors.length}</div></div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="secondary" onClick={() => setSection("plants")}>Anlagen pflegen</button>
                  <button className="secondary" onClick={() => setSection("tickets")}>Ticket-Backoffice</button>
                  <button className="secondary" onClick={() => setSection("users")}>Benutzer verwalten</button>
                  <button className="secondary" onClick={() => setSection("ops")}>Betrieb ansehen</button>
                </div>
              </section>

              <section className="panel">
                <h2>Systemzustand</h2>
                <div className="stats">
                  <div className="stat">
                    <div className="k">Datenbank</div>
                    <div className="v">{opsStatus?.health?.db_ok ? "OK" : "Pruefen"}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Speicherplatz</div>
                    <div className="v">{opsStatus?.health?.disk_ok ? "OK" : "Pruefen"}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Outbox offen</div>
                    <div className="v">{String(opsStatus?.pending_outbox ?? 0)}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Delivery offen</div>
                    <div className="v">{String(opsStatus?.pending_deliveries ?? 0)}</div>
                  </div>
                </div>
                <div className="stats" style={{ marginTop: 8 }}>
                  <div className="stat">
                    <div className="k">Partition (gesamt)</div>
                    <div className="v">{formatBytes(opsStatus?.system?.disk_total_bytes)}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Partition (belegt)</div>
                    <div className="v">{formatBytes(opsStatus?.system?.disk_used_bytes)} / {String(opsStatus?.system?.disk_used_percent ?? 0)}%</div>
                  </div>
                  <div className="stat">
                    <div className="k">RAM (gesamt)</div>
                    <div className="v">{formatBytes(opsStatus?.system?.memory_total_bytes)}</div>
                  </div>
                  <div className="stat">
                    <div className="k">RAM (belegt)</div>
                    <div className="v">{formatBytes(opsStatus?.system?.memory_used_bytes)} / {String(opsStatus?.system?.memory_used_percent ?? 0)}%</div>
                  </div>
                  <div className="stat">
                    <div className="k">CPU Last</div>
                    <div className="v">{String(opsStatus?.system?.cpu_load_percent ?? 0)}%</div>
                  </div>
                  <div className="stat">
                    <div className="k">Anfragen / Minute</div>
                    <div className="v">{String(opsStatus?.system?.requests_per_minute ?? 0)}</div>
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <span className="badge">Module Anlagenbuch: {mods?.anlagenbuch ? "Aktiv" : "Unbekannt"}</span>
                  <span className="badge">Module Tickets: {mods?.tickets ? "Aktiv" : "Unbekannt"}</span>
                  <span className="badge">Module Reporting: {mods?.reporting?.enabled ? "Aktiv" : "Inaktiv"}</span>
                </div>
                <div className="toolbar" style={{ marginTop: 6 }}>
                  <span className="badge">Mailserver: {opsStatus?.email_server?.enabled ? "Aktiv" : "Inaktiv"}</span>
                  <span className="badge">SMTP Host: {opsStatus?.email_server?.host || "-"}</span>
                  <span className="badge">SMTP Port: {String(opsStatus?.email_server?.port ?? "-")}</span>
                </div>
                <div className="stats" style={{ marginTop: 8 }}>
                  <div className="stat">
                    <div className="k">TLS Host</div>
                    <div className="v">{certStatus?.host || "-"}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Gueltig bis</div>
                    <div className="v">{formatTs(certStatus?.not_after || null)}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Restlaufzeit</div>
                    <div className="v">
                      {certStatus?.days_remaining !== null && certStatus?.days_remaining !== undefined
                        ? `${certStatus.days_remaining.toFixed(1)} Tage`
                        : "-"}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="k">Aussteller</div>
                    <div className="v">{certStatus?.issuer_cn || "-"}</div>
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <span className="badge">TLS Status: {certStatus?.valid_now ? "Gueltig" : "Pruefen"}</span>
                  <span className="badge">Geprueft: {formatTs(certStatus?.checked_at || null)}</span>
                  {isAdmin ? (
                    <button onClick={() => void renewCertificate()} disabled={certBusy}>
                      {certBusy ? "Erneuere Zertifikat..." : "Zertifikat neu erzeugen"}
                    </button>
                  ) : null}
                </div>
                {isAdmin ? (
                  <div className="stack" style={{ marginTop: 10 }}>
                    <h3>Domaenen-CA (ohne Browser-Warnung in der Firma)</h3>
                    <div className="cols-2">
                      <div className="field">
                        <label>TLS Hostname</label>
                        <input
                          placeholder="z.B. anlagendesk.firma.local"
                          value={certHostDraft}
                          onChange={(e) => setCertHostDraft(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>SAN IP (optional)</label>
                        <input
                          placeholder="z.B. 10.0.0.5"
                          value={certSanIpDraft}
                          onChange={(e) => setCertSanIpDraft(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="toolbar">
                      <button className="secondary" onClick={() => void createDomainCertificateCsr()} disabled={certBusy}>
                        CSR fuer Domaenen-CA erzeugen
                      </button>
                    </div>
                    <div className="field">
                      <label>CSR (bei Domaenen-CA einreichen)</label>
                      <textarea
                        rows={8}
                        value={certCsrPem}
                        readOnly
                        placeholder="Hier erscheint die CSR nach Klick auf 'CSR fuer Domaenen-CA erzeugen'."
                      />
                    </div>
                    <div className="field">
                      <label>Signiertes PEM-Zertifikat (inkl. Kette, falls vorhanden)</label>
                      <textarea
                        rows={8}
                        value={certSignedPem}
                        onChange={(e) => setCertSignedPem(e.target.value)}
                        placeholder="-----BEGIN CERTIFICATE----- ..."
                      />
                    </div>
                    <div className="toolbar">
                      <button onClick={() => void installDomainCertificate()} disabled={certBusy}>
                        Signiertes Zertifikat einspielen
                      </button>
                    </div>
                  </div>
                ) : null}
                <p className="muted" style={{ marginTop: 8 }}>
                  Letzter Fehler: {opsStatus?.health?.last_error || "-"}
                </p>
              </section>

              <section className="panel">
                <h2>Technikdetails</h2>
                <details>
                  <summary>Dashboard-JSON anzeigen</summary>
                  <pre>{JSON.stringify(dashboard, null, 2)}</pre>
                </details>
                <details style={{ marginTop: 8 }}>
                  <summary>Ops-Status-JSON anzeigen</summary>
                  <pre>{JSON.stringify(opsStatus, null, 2)}</pre>
                </details>
                <details style={{ marginTop: 8 }}>
                  <summary>TLS-Zertifikat-JSON anzeigen</summary>
                  <pre>{JSON.stringify(certStatus, null, 2)}</pre>
                </details>
              </section>
            </div>
          ) : null}

          {section === "modules" ? (
            <section className="panel">
              <h2>Moduleinstellungen</h2>
              <p className="muted">Hier steuerst du die wichtigsten Grundregeln des Systems.</p>
              {!modsDraft ? <p className="muted">Moduleinstellungen werden geladen...</p> : (
                <div className="stack">
                  <div className="cols-3">
                    <div className="field">
                      <label>Upload-Limit in MB (Anlagenbuch)</label>
                      <input
                        type="number"
                        value={modsDraft.anlagenbuch.upload_limit_mb}
                        onChange={(e) => setModsDraft({ ...modsDraft, anlagenbuch: { ...modsDraft.anlagenbuch, upload_limit_mb: Number(e.target.value || 50) } })}
                      />
                    </div>
                    <div className="field">
                      <label>Schicht-Konfiguration</label>
                      <input
                        value={modsDraft.anlagenbuch.shift_config}
                        onChange={(e) => setModsDraft({ ...modsDraft, anlagenbuch: { ...modsDraft.anlagenbuch, shift_config: e.target.value } })}
                      />
                    </div>
                    <div className="field">
                      <label>Reporting-Modul</label>
                      <select
                        value={modsDraft.reporting.enabled ? "true" : "false"}
                        onChange={(e) => setModsDraft({ ...modsDraft, reporting: { enabled: e.target.value === "true" } })}
                      >
                        <option value="true">Aktiv</option>
                        <option value="false">Inaktiv</option>
                      </select>
                    </div>
                  </div>
                  <div className="cols-2">
                    <div className="field">
                      <label>Oeffentliche Ticket-Rueckmeldungen</label>
                      <select
                        value={modsDraft.tickets.public_reply_enabled ? "true" : "false"}
                        onChange={(e) => setModsDraft({ ...modsDraft, tickets: { ...modsDraft.tickets, public_reply_enabled: e.target.value === "true" } })}
                      >
                        <option value="true">Erlaubt</option>
                        <option value="false">Gesperrt</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Auto-Close nach Tagen (Tickets)</label>
                      <input
                        type="number"
                        value={modsDraft.tickets.auto_close_policy_days}
                        onChange={(e) => setModsDraft({ ...modsDraft, tickets: { ...modsDraft.tickets, auto_close_policy_days: Number(e.target.value || 14) } })}
                      />
                    </div>
                  </div>
                  <div className="toolbar">
                    <button className="secondary" onClick={saveModules} disabled={!isAdmin}>Aenderungen speichern</button>
                  </div>
                </div>
              )}
              <details style={{ marginTop: 10 }}>
                <summary>Rohdaten anzeigen</summary>
                <pre>{JSON.stringify(mods, null, 2)}</pre>
              </details>
            </section>
          ) : null}

          {section === "plants" ? (
            <div className="stack">
              <div className="cols-2">
                <section className="panel">
                  <h2>Anlage anlegen</h2>
                  <div className="field">
                    <label>Slug</label>
                    <input placeholder="slug" value={np.slug} onChange={(e) => setNp({ ...np, slug: e.target.value.toUpperCase() })} />
                  </div>
                  <div className="field">
                    <label>Anzeigename</label>
                    <input placeholder="display_name" value={np.display_name} onChange={(e) => setNp({ ...np, display_name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Abteilungs-Prefix</label>
                    <input placeholder="area_prefix" value={np.area_prefix} onChange={(e) => setNp({ ...np, area_prefix: e.target.value.toUpperCase() })} />
                  </div>
                  <button onClick={createPlant} disabled={!isAdmin}>Create</button>
                </section>

                <section className="panel">
                  <h2>Bereich anlegen</h2>
                  <div className="field">
                    <label>Bereichs-Code</label>
                    <input placeholder="z.B. ELEKTRIK" value={na.code} onChange={(e) => setNa({ ...na, code: e.target.value.toUpperCase() })} />
                  </div>
                  <div className="field">
                    <label>Bereichsname</label>
                    <input placeholder="z.B. Elektrik" value={na.name} onChange={(e) => setNa({ ...na, name: e.target.value })} />
                  </div>
                  <button onClick={createArea} disabled={!isAdmin}>Bereich erstellen</button>
                </section>
              </div>

              <section className="panel">
                <h2>Anlagenliste</h2>
                {plants.length === 0 ? <p className="muted">Keine Anlagen vorhanden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Slug</th>
                          <th>Name</th>
                          <th>Prefix</th>
                          <th>Status</th>
                          <th>Aktion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plants.map((p) => {
                          const encodedSlug = encodeURIComponent(p.slug);
                          const schichtbuchPath = `/Schichtbuch/${encodedSlug}`;
                          const ticketsPath = `/Tickets/${encodedSlug}`;
                          const schichtbuchUrl = `${appOrigin}${schichtbuchPath}`;
                          const ticketsUrl = `${appOrigin}${ticketsPath}`;
                          return (
                            <tr key={`plant-${p.id}`}>
                              <td>{p.slug}</td>
                              <td>
                                <div className="stack">
                                  <strong>{p.display_name}</strong>
                                  <div className="field">
                                    <a className="inline-link" href={schichtbuchPath} target="_blank" rel="noreferrer">Schichtbuch</a>
                                    <small className="muted">{schichtbuchUrl}</small>
                                  </div>
                                  <div className="field">
                                    <a className="inline-link" href={ticketsPath} target="_blank" rel="noreferrer">Ticketsystem</a>
                                    <small className="muted">{ticketsUrl}</small>
                                  </div>
                                </div>
                              </td>
                              <td>{p.area_prefix}</td>
                              <td>{p.active ? "Aktiv" : "Inaktiv"}</td>
                              <td>
                                <div className="toolbar">
                                  <button className="secondary" onClick={() => void togglePlant(p.slug, p.active)} disabled={!isAdmin}>{p.active ? "Deaktivieren" : "Aktivieren"}</button>
                                  <button className="danger" onClick={() => void deletePlant(p.slug)} disabled={!isAdmin}>Loeschen</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel">
                <h2>Bereichsliste</h2>
                {areas.length === 0 ? <p className="muted">Keine Bereiche vorhanden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Aktion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {areas.map((a) => (
                          <tr key={`area-${a.id}`}>
                            <td>{a.code}</td>
                            <td>{a.name}</td>
                            <td>
                              <div className="toolbar">
                                <button className="secondary" onClick={() => void renameArea(a.code, a.name)} disabled={!isAdmin}>Umbenennen</button>
                                <button className="danger" onClick={() => void deleteArea(a.code)} disabled={!isAdmin}>Loeschen</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {section === "tickets" && isAdmin ? (
            <section className="panel">
              <h2>Pulldown-Felder pflegen</h2>
              <p className="muted">Diese Listen nutzt der Dispatcher beim Ticket einordnen.</p>
              {!modsDraft ? <p className="muted">Moduleinstellungen werden geladen...</p> : (
                <div className="cols-2">
                  <div className="stack">
                    <h3>Bereich</h3>
                    <div className="toolbar">
                      <input placeholder="z.B. Mechanik" value={newDepartmentOption} onChange={(e) => setNewDepartmentOption(e.target.value)} />
                      <button className="secondary" onClick={() => { addTicketOption("department_options", newDepartmentOption); setNewDepartmentOption(""); }}>Hinzufuegen</button>
                    </div>
                    <div className="toolbar">
                      {(modsDraft.tickets.department_options || []).map((entry) => (
                        <button key={`dep-${entry}`} className="secondary" onClick={() => removeTicketOption("department_options", entry)}>{entry} x</button>
                      ))}
                    </div>
                  </div>
                  <div className="stack">
                    <h3>Ticket-Typ</h3>
                    <div className="toolbar">
                      <input placeholder="z.B. Stoerung" value={newTicketTypeOption} onChange={(e) => setNewTicketTypeOption(e.target.value)} />
                      <button className="secondary" onClick={() => { addTicketOption("ticket_type_options", newTicketTypeOption); setNewTicketTypeOption(""); }}>Hinzufuegen</button>
                    </div>
                    <div className="toolbar">
                      {(modsDraft.tickets.ticket_type_options || []).map((entry) => (
                        <button key={`type-${entry}`} className="secondary" onClick={() => removeTicketOption("ticket_type_options", entry)}>{entry} x</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="secondary" onClick={() => void saveModules()}>Auswahllisten speichern</button>
              </div>
            </section>
          ) : null}

          {section === "tickets" && isAdmin ? (
            <section className="panel">
              <h2>Ticket-Gruppen verwalten</h2>
              <div className="cols-3">
                <div className="field">
                  <label>Code</label>
                  <input value={newTicketGroup.code} onChange={(e) => setNewTicketGroup({ ...newTicketGroup, code: e.target.value.toUpperCase() })} placeholder="z.B. MECH" />
                </div>
                <div className="field">
                  <label>Name</label>
                  <input value={newTicketGroup.name} onChange={(e) => setNewTicketGroup({ ...newTicketGroup, name: e.target.value })} placeholder="z.B. Mechanik" />
                </div>
                <div className="field">
                  <label>Aktiv</label>
                  <select value={newTicketGroup.active ? "true" : "false"} onChange={(e) => setNewTicketGroup({ ...newTicketGroup, active: e.target.value === "true" })}>
                    <option value="true">Aktiv</option>
                    <option value="false">Inaktiv</option>
                  </select>
                </div>
              </div>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button onClick={() => void createTicketGroup()}>Gruppe erstellen</button>
              </div>

              <div className="stack" style={{ marginTop: 12 }}>
                {ticketGroups.map((group) => (
                  <article key={group.id} className="panel" style={{ boxShadow: "none" }}>
                    <div className="header">
                      <h3 style={{ margin: 0 }}>{group.name} ({group.code})</h3>
                      <span className="badge">{group.active ? "Aktiv" : "Inaktiv"}</span>
                    </div>
                    <div className="field">
                      <label>Mitglieder (Agent Usernames, Komma-getrennt)</label>
                      <input
                        value={groupMemberDrafts[group.id] ?? ""}
                        onChange={(e) => setGroupMemberDrafts({ ...groupMemberDrafts, [group.id]: e.target.value })}
                        placeholder="z.B. agent_ms_1,agent_ms_2"
                      />
                    </div>
                    <div className="toolbar" style={{ marginTop: 8 }}>
                      <button className="secondary" onClick={() => void saveGroupMembers(group)}>Mitglieder speichern</button>
                      <button className="secondary" onClick={() => void toggleTicketGroup(group)}>{group.active ? "Deaktivieren" : "Aktivieren"}</button>
                      <button className="danger" onClick={() => void deleteTicketGroup(group)}>Gruppe loeschen</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {section === "tickets" ? (
            <div className="stack">
              <section className="panel">
                <h2>Ticket-Suche</h2>
                <div className="cols-3">
                  <div className="field">
                    <label>Status</label>
                    <input placeholder="z.B. NEW oder IN_PROGRESS" value={ticketFilter.status} onChange={(e) => setTicketFilter({ ...ticketFilter, status: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Abteilung</label>
                    <input placeholder="z.B. MS" value={ticketFilter.area} onChange={(e) => setTicketFilter({ ...ticketFilter, area: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Bereich</label>
                    <input placeholder="z.B. Elektrik" value={ticketFilter.department} onChange={(e) => setTicketFilter({ ...ticketFilter, department: e.target.value })} />
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="secondary" onClick={() => void loadTickets()}>Ticketliste laden</button>
                </div>
              </section>

              <section className="panel">
                <div className="header">
                  <h2>Ticketliste</h2>
                  <span className="badge">{tickets.length} Eintraege</span>
                </div>
                {tickets.length === 0 ? <p className="muted">Keine Tickets gefunden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Status</th>
                          <th>Anlage</th>
                          <th>Bereich</th>
                          <th>Betreff</th>
                          <th>Aktion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((t) => (
                          <tr key={`admin-ticket-row-${t.id}`}>
                            <td>#{t.id}</td>
                            <td>{ticketStatusLabel(t.status)}</td>
                            <td>{t.plant_slug || "-"}</td>
                            <td>{t.department || "-"}</td>
                            <td>{t.subject || "-"}</td>
                            <td><button className="secondary" onClick={() => void openTicket(t.id)}>Oeffnen</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <div className="cols-2">
                <section className="panel">
                  <h2>Ticket-Details</h2>
                  {!ticketDetail ? <p className="muted">Bitte zuerst ein Ticket aus der Liste oeffnen.</p> : (
                    <div className="stack">
                      <div className="toolbar">
                        <span className="badge">Ticket #{String(ticketDetail.id || "-")}</span>
                        <span className="badge">{ticketStatusLabel(String(ticketDetail.status || ""))}</span>
                        <span className="badge">Anlage: {String(ticketDetail.plant_slug || "-")}</span>
                        <span className="badge">Bereich: {String(ticketDetail.department || "-")}</span>
                      </div>
                      <div className="field">
                        <label>Betreff</label>
                        <input readOnly value={String(ticketDetail.subject || "")} />
                      </div>
                      <div className="field">
                        <label>Beschreibung</label>
                        <textarea readOnly value={String(ticketDetail.description || "")} />
                      </div>
                      <details>
                        <summary>Rohdaten anzeigen</summary>
                        <pre>{JSON.stringify(ticketDetail, null, 2)}</pre>
                      </details>
                    </div>
                  )}
                </section>

                <section className="panel">
                  <h2>Ticket-Aktionen</h2>
                  <div className="stack">
                    <div className="field">
                      <label>Bereich</label>
                      <input placeholder="z.B. Mechanik" value={triage.department} onChange={(e) => setTriage({ ...triage, department: e.target.value })} />
                    </div>
                    <div className="cols-2">
                      <div className="field">
                        <label>Prioritaet</label>
                        <input type="number" min={0} max={6} value={triage.priority} onChange={(e) => setTriage({ ...triage, priority: Number(e.target.value) })} />
                      </div>
                      <div className="field">
                        <label>Ticket-Typ</label>
                        <input placeholder="z.B. Stoerung" value={triage.ticket_type} onChange={(e) => setTriage({ ...triage, ticket_type: e.target.value })} />
                      </div>
                    </div>
                    <button onClick={() => void tkAction("triage", triage)}>Ticket einordnen</button>

                    <div className="field">
                      <label>Bearbeiter-Username</label>
                      <input placeholder="z.B. agent_ms_1" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} />
                    </div>
                    <button className="secondary" onClick={() => void tkAction("assign", { assignee_username: assignTo })}>Bearbeiter zuweisen</button>

                    <div className="field">
                      <label>Status</label>
                      <select value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })}>
                        <option>IN_PROGRESS</option>
                        <option>RESOLVED</option>
                        <option>CLOSED</option>
                        <option>CANCELLED</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Grund</label>
                      <input placeholder="optional" value={st.reason} onChange={(e) => setSt({ ...st, reason: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Kommentar fuer Melder</label>
                      <textarea placeholder="kurze Rueckmeldung" value={st.public_comment} onChange={(e) => setSt({ ...st, public_comment: e.target.value })} />
                    </div>
                    <button className="warn" onClick={() => void tkAction("status", st)}>Status speichern</button>

                    <div className="cols-2">
                      <div className="field">
                        <label>Anhangstyp</label>
                        <select value={ticketAttachmentKind} onChange={(e) => setTicketAttachmentKind(e.target.value)}>
                          <option value="FILE">Datei</option>
                          <option value="IMAGE">Bild</option>
                          <option value="SCREENSHOT">Screenshot</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Datei</label>
                        <input type="file" onChange={(e) => setTicketAttachment(e.target.files?.[0] ?? null)} />
                      </div>
                    </div>
                    <button className="secondary" onClick={() => void uploadTicketAttachment()}>Anhang hochladen</button>
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {section === "reporting" ? (
            <div className="stack">
              <div className="cols-2">
                <section className="panel">
                  <h2>Manuellen Report erzeugen</h2>
                  <div className="field">
                    <label>Anlage</label>
                    <input placeholder="z.B. MS_DEMO_ANLAGE_01" value={exp.plantId} onChange={(e) => setExp({ ...exp, plantId: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Formate (Komma-getrennt)</label>
                    <input placeholder="csv,json,xml" value={exp.formats} onChange={(e) => setExp({ ...exp, formats: e.target.value })} />
                  </div>
                  <button onClick={createExport}>Report starten</button>
                </section>

                <section className="panel">
                  <h2>Automatischen Report anlegen</h2>
                  <div className="field">
                    <label>Name</label>
                    <input placeholder="z.B. Wochenbericht MS" value={sch.name} onChange={(e) => setSch({ ...sch, name: e.target.value })} />
                  </div>
                  <div className="cols-2">
                    <div className="field">
                      <label>Intervall</label>
                      <input placeholder="daily, weekly, monthly" value={sch.cron_type} onChange={(e) => setSch({ ...sch, cron_type: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Zeitzone</label>
                      <input placeholder="Europe/Berlin" value={sch.timezone} onChange={(e) => setSch({ ...sch, timezone: e.target.value })} />
                    </div>
                  </div>
                  <div className="cols-2">
                    <div className="field">
                      <label>Anlage</label>
                      <input placeholder="MS_DEMO_ANLAGE_01" value={sch.plant_slug} onChange={(e) => setSch({ ...sch, plant_slug: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Formate</label>
                      <input placeholder="csv,pdf" value={sch.formats} onChange={(e) => setSch({ ...sch, formats: e.target.value })} />
                    </div>
                  </div>
                  <div className="field">
                    <label>Empfaenger</label>
                    <input placeholder="team@firma.de,leitung@firma.de" value={sch.recipients} onChange={(e) => setSch({ ...sch, recipients: e.target.value })} />
                  </div>
                  <button onClick={createSchedule} disabled={!isAdmin}>Zeitplan speichern</button>
                </section>
              </div>

              <section className="panel">
                <h2>Report-Laeufe</h2>
                {runs.length === 0 ? <p className="muted">Noch keine Report-Laeufe vorhanden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Status</th>
                          <th>Anlage</th>
                          <th>Zeitpunkt</th>
                          <th>Aktion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((r) => (
                          <tr key={`run-${String(r.id)}`}>
                            <td>{String(r.id)}</td>
                            <td>{String(r.status || "-")}</td>
                            <td>{String(r.plant_slug || "-")}</td>
                            <td>{formatTs(typeof r.created_at === "string" ? r.created_at : null)}</td>
                            <td><button className="secondary" onClick={async () => setRunDetail(await api(`/api/reporting/runs/${String(r.id)}`))}>Details</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {runDetail ? (
                  <details style={{ marginTop: 8 }} open>
                    <summary>Gewaehlter Lauf: #{String(runDetail.id || "-")}</summary>
                    <pre>{JSON.stringify(runDetail, null, 2)}</pre>
                  </details>
                ) : null}
              </section>

              <section className="panel">
                <h2>Zeitplaene</h2>
                {schedules.length === 0 ? <p className="muted">Keine Zeitplaene vorhanden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Name</th>
                          <th>Intervall</th>
                          <th>Anlage</th>
                          <th>Status</th>
                          <th>Aktion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedules.map((s) => (
                          <tr key={`schedule-admin-${String(s.id)}`}>
                            <td>{String(s.id)}</td>
                            <td>{String(s.name || "-")}</td>
                            <td>{String(s.cron_type || "-")}</td>
                            <td>{String(s.plant_slug || "-")}</td>
                            <td>{Boolean(s.enabled) ? "Aktiv" : "Inaktiv"}</td>
                            <td>
                              <div className="toolbar">
                                <button className="secondary" onClick={() => void scheduleRun(Number(s.id))}>Jetzt starten</button>
                                <button className="secondary" onClick={() => void scheduleToggle(Number(s.id), Boolean(s.enabled))} disabled={!isAdmin}>{Boolean(s.enabled) ? "Deaktivieren" : "Aktivieren"}</button>
                                <button className="danger" onClick={() => void scheduleDelete(Number(s.id))} disabled={!isAdmin}>Loeschen</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel">
                <h2>Report-Auslieferungen</h2>
                {repDel.length === 0 ? <p className="muted">Noch keine Auslieferungen vorhanden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Run</th>
                          <th>Empfaenger</th>
                          <th>Status</th>
                          <th>Zeitpunkt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repDel.map((d) => (
                          <tr key={`delivery-${String(d.id)}`}>
                            <td>{String(d.id)}</td>
                            <td>{String(d.report_run_id || "-")}</td>
                            <td>{String(d.recipient || "-")}</td>
                            <td>{String(d.status || "-")}</td>
                            <td>{formatTs(typeof d.created_at === "string" ? d.created_at : null)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {section === "users" ? (
            <div className="stack">
              <section className="panel">
                <h2>Benutzer anlegen</h2>
                <div className="cols-2">
                  <div className="field">
                    <label>Username</label>
                    <input placeholder="z.B. agent_ms_3" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Passwort</label>
                    <input type="password" placeholder="mindestens 8 Zeichen" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
                  </div>
                </div>
                <div className="cols-2">
                  <div className="field">
                    <label>Rollen (Komma-getrennt)</label>
                    <input placeholder="z.B. Agent oder Dispatcher" value={nu.roles} onChange={(e) => setNu({ ...nu, roles: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Passwortwechsel beim ersten Login</label>
                    <select value={nu.force_password_change ? "true" : "false"} onChange={(e) => setNu({ ...nu, force_password_change: e.target.value === "true" })}>
                      <option value="true">Ja</option>
                      <option value="false">Nein</option>
                    </select>
                  </div>
                </div>
                <button onClick={createUser} disabled={!isAdmin}>Benutzer erstellen</button>
              </section>

              <section className="panel">
                <div className="header">
                  <h2>Benutzerliste</h2>
                  <span className="badge">{users.length} Benutzer</span>
                </div>
                <p className="muted">Auf einen Benutzer klicken, um Passwort, Rolle, Ticket-Gruppen und mehrere Abteilungen in einem Popup zu verwalten.</p>
                {users.length === 0 ? <p className="muted">Keine Benutzer gefunden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Username</th>
                          <th>Rollen</th>
                          <th>Abteilungen</th>
                          <th>Ticket-Gruppen</th>
                          <th>Aktion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={`user-${String(u.username)}`}>
                            <td>{String(u.username || "-")}</td>
                            <td>{Array.isArray(u.roles) ? (u.roles as string[]).join(", ") : "-"}</td>
                            <td>{Array.isArray(u.departments) && u.departments.length ? u.departments.join(", ") : String(u.department || "-")}</td>
                            <td>{(u.ticket_groups || []).map((entry) => entry.name).join(", ") || "-"}</td>
                            <td>
                              <div className="toolbar">
                                <button className="secondary" onClick={() => openUserEditor(u)} disabled={!isAdmin}>Bearbeiten</button>
                                <button className="danger" onClick={() => void userDelete(String(u.username))} disabled={!isAdmin}>Loeschen</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel">
                <h2>Rollen und Berechtigungen</h2>
                {roleOptions.length === 0 ? <p className="muted">Keine Rollen geladen.</p> : (
                  <div className="toolbar">
                    {roleOptions.map((roleName) => <span className="badge" key={`role-${roleName}`}>{roleName}</span>)}
                  </div>
                )}
                <details style={{ marginTop: 10 }}>
                  <summary>Rohdaten anzeigen</summary>
                  <pre>{JSON.stringify(roles, null, 2)}</pre>
                </details>
              </section>

              {userEditorOpen && userEditor ? (
                <div className="d-modal-bg" onClick={() => setUserEditorOpen(false)}>
                  <div className="d-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="header">
                      <h2>Benutzer bearbeiten: {userEditor.username}</h2>
                      <button className="secondary" onClick={() => setUserEditorOpen(false)}>Schliessen</button>
                    </div>
                    <p className="muted">Hier kannst du Passwort zuruecksetzen, Rollen, Ticket-Gruppen und mehrere Abteilungen einstellen.</p>
                    <div className="cols-2">
                      <div className="field">
                        <label>Neues Passwort (optional)</label>
                        <input
                          type="password"
                          placeholder="mindestens 8 Zeichen"
                          value={userEditor.newPassword}
                          onChange={(e) => setUserEditor({ ...userEditor, newPassword: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label>Passwortwechsel beim naechsten Login</label>
                        <select
                          value={userEditor.forcePasswordChange ? "true" : "false"}
                          onChange={(e) => setUserEditor({ ...userEditor, forcePasswordChange: e.target.value === "true" })}
                        >
                          <option value="true">Ja</option>
                          <option value="false">Nein</option>
                        </select>
                      </div>
                    </div>
                    <div className="cols-2">
                      <div className="field">
                        <label>Abteilungen (Mehrfachauswahl)</label>
                        <div className="toolbar">
                          {userDepartmentOptions.map((area) => (
                            <button
                              key={`dept-${area.code}`}
                              type="button"
                              className={`secondary format-chip ${userEditor.departments.includes(area.code) ? "active" : ""}`}
                              onClick={() => toggleUserEditorDepartment(area.code)}
                            >
                              {area.code} - {area.name}
                            </button>
                          ))}
                        </div>
                        {userEditor.departments.length === 0 ? <p className="muted">Keine Abteilung ausgewaehlt.</p> : null}
                      </div>
                      <div className="field">
                        <label>Rollen</label>
                        <div className="toolbar">
                          {roleOptions.map((roleName) => (
                            <button
                              key={`edit-role-${roleName}`}
                              type="button"
                              className={`secondary format-chip ${userEditor.roles.includes(roleName) ? "active" : ""}`}
                              onClick={() => toggleUserEditorRole(roleName)}
                            >
                              {roleName}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="field">
                      <label>Ticket-Gruppen (Mehrfachauswahl)</label>
                      <div className="toolbar">
                        {ticketGroups.map((group) => (
                          <button
                            key={`edit-group-${group.id}`}
                            type="button"
                            className={`secondary format-chip ${userEditor.groupIds.includes(group.id) ? "active" : ""}`}
                            onClick={() => toggleUserEditorGroup(group.id)}
                            disabled={!userEditor.roles.includes("Agent")}
                          >
                            {group.name} ({group.code})
                          </button>
                        ))}
                      </div>
                      {!userEditor.roles.includes("Agent") ? <p className="muted">Ticket-Gruppen sind nur fuer die Rolle Agent aktiv.</p> : null}
                    </div>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <button onClick={() => void saveUserEditor()}>Aenderungen speichern</button>
                      <button className="danger" onClick={() => void userDelete(userEditor.username)}>Benutzer loeschen</button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {section === "ops" ? (
            <div className="stack">
              <section className="panel">
                <h2>Ops-Filter und Werkzeuge</h2>
                <div className="cols-3">
                  <div className="field">
                    <label>Trace-ID</label>
                    <input placeholder="optional" value={opf.trace_id} onChange={(e) => setOpf({ ...opf, trace_id: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Von (ISO)</label>
                    <input placeholder="2026-02-21T00:00:00Z" value={opf.from_ts} onChange={(e) => setOpf({ ...opf, from_ts: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Bis (ISO)</label>
                    <input placeholder="2026-02-21T23:59:59Z" value={opf.to_ts} onChange={(e) => setOpf({ ...opf, to_ts: e.target.value })} />
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <select value={logCfg.stream} onChange={(e) => setLogCfg({ ...logCfg, stream: e.target.value })}>
                    <option value="app">App-Log</option>
                    <option value="error">Error-Log</option>
                    <option value="trace">Trace-Log</option>
                  </select>
                  <input type="number" value={logCfg.lines} onChange={(e) => setLogCfg({ ...logCfg, lines: Number(e.target.value) })} />
                  <button onClick={() => void loadOps()}>Load ops</button>
                  <a className="inline-link" href="/api/ops/logs/download?days=7" target="_blank" rel="noreferrer">Support Bundle</a>
                  <a className="inline-link" href="/ops/mail" target="_blank" rel="noreferrer">Mailpit</a>
                </div>
              </section>

              <section className="panel">
                <h2>Status + errors</h2>
                <div className="stats">
                  <div className="stat"><div className="k">DB</div><div className="v">{opsStatus?.health?.db_ok ? "OK" : "Fehler"}</div></div>
                  <div className="stat"><div className="k">Disk</div><div className="v">{opsStatus?.health?.disk_ok ? "OK" : "Fehler"}</div></div>
                  <div className="stat"><div className="k">Backlog</div><div className="v">{String(opsStatus?.health?.backlog ?? 0)}</div></div>
                  <div className="stat"><div className="k">Antwortzeit</div><div className="v">{String(opsStatus?.health?.response_ms ?? 0)} ms</div></div>
                  <div className="stat"><div className="k">CPU Last</div><div className="v">{String(opsStatus?.system?.cpu_load_percent ?? 0)}%</div></div>
                  <div className="stat"><div className="k">Requests/min</div><div className="v">{String(opsStatus?.system?.requests_per_minute ?? 0)}</div></div>
                  <div className="stat"><div className="k">RAM</div><div className="v">{formatBytes(opsStatus?.system?.memory_used_bytes)} / {formatBytes(opsStatus?.system?.memory_total_bytes)}</div></div>
                  <div className="stat"><div className="k">Partition</div><div className="v">{formatBytes(opsStatus?.system?.disk_used_bytes)} / {formatBytes(opsStatus?.system?.disk_total_bytes)}</div></div>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>Letzter Fehler: {opsStatus?.health?.last_error || "-"}</p>
              </section>

              <section className="panel">
                <h2>E-Mail Server (Exchange/SMTP)</h2>
                <p className="muted">Hier konfigurierst du den SMTP-Zugang (z.B. Outlook Exchange) und testest die Verbindung.</p>
                <div className="cols-3">
                  <div className="field">
                    <label>Aktiv</label>
                    <select value={emailSettings.enabled ? "true" : "false"} onChange={(e) => setEmailSettings({ ...emailSettings, enabled: e.target.value === "true" })}>
                      <option value="true">Ja</option>
                      <option value="false">Nein</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>SMTP Host</label>
                    <input value={emailSettings.host} onChange={(e) => setEmailSettings({ ...emailSettings, host: e.target.value })} placeholder="z.B. smtp.office365.com" />
                  </div>
                  <div className="field">
                    <label>Port</label>
                    <input type="number" value={emailSettings.port} onChange={(e) => setEmailSettings({ ...emailSettings, port: Number(e.target.value || 587) })} />
                  </div>
                </div>
                <div className="cols-3">
                  <div className="field">
                    <label>Sicherheit</label>
                    <select value={emailSettings.security} onChange={(e) => setEmailSettings({ ...emailSettings, security: e.target.value })}>
                      <option value="starttls">STARTTLS</option>
                      <option value="ssl">SSL/TLS</option>
                      <option value="none">Keine</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Benutzername</label>
                    <input value={emailSettings.username} onChange={(e) => setEmailSettings({ ...emailSettings, username: e.target.value })} placeholder="z.B. service@firma.de" />
                  </div>
                  <div className="field">
                    <label>Absenderadresse</label>
                    <input value={emailSettings.from_address} onChange={(e) => setEmailSettings({ ...emailSettings, from_address: e.target.value })} placeholder="z.B. service@firma.de" />
                  </div>
                </div>
                <div className="cols-3">
                  <div className="field">
                    <label>Passwort ({emailSettings.has_password ? "gesetzt" : "nicht gesetzt"})</label>
                    <input type="password" value={emailSettings.password} onChange={(e) => setEmailSettings({ ...emailSettings, password: e.target.value })} placeholder="leer lassen = unveraendert" />
                  </div>
                  <div className="field">
                    <label>Timeout Sekunden</label>
                    <input type="number" value={emailSettings.timeout_seconds} onChange={(e) => setEmailSettings({ ...emailSettings, timeout_seconds: Number(e.target.value || 10) })} />
                  </div>
                  <div className="field">
                    <label>Test-Empfaenger</label>
                    <input value={emailTestRecipient} onChange={(e) => setEmailTestRecipient(e.target.value)} placeholder="z.B. dispatcher@firma.de" />
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="secondary" onClick={() => void saveEmailSettings()} disabled={!isAdmin}>Konfiguration speichern</button>
                  <button className="secondary" onClick={() => void testEmailSettings(false)} disabled={!isAdmin}>Verbindung testen</button>
                  <button onClick={() => void testEmailSettings(true)} disabled={!isAdmin || !emailTestRecipient.trim()}>Testmail senden</button>
                </div>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <span className="badge">Server konfiguriert: {opsStatus?.email_server?.configured ? "Ja" : "Nein"}</span>
                  <span className="badge">Live Host: {opsStatus?.email_server?.host || "-"}</span>
                  <span className="badge">Live Port: {String(opsStatus?.email_server?.port ?? "-")}</span>
                </div>
              </section>

              <section className="panel">
                <h2>Fehlerliste</h2>
                {opsErrors.length === 0 ? <p className="muted">Keine Fehler gefunden.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Zeit</th>
                          <th>Typ</th>
                          <th>Nachricht</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opsErrors.slice(0, 20).map((e, idx) => (
                          <tr key={`ops-error-${idx}`}>
                            <td>{formatTs(typeof e.created_at === "string" ? e.created_at : null)}</td>
                            <td>{String(e.event_type || e.type || "-")}</td>
                            <td>{String(e.message || e.error || "-")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel">
                <h2>Deliveries und Dead Letters</h2>
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  {opsDel.filter((d) => String(d.status) !== "DELIVERED").slice(0, 10).map((d) => (
                    <button key={`retry-${String(d.id)}`} className="secondary" onClick={() => void opsRetry(Number(d.id))}>Retry #{String(d.id)}</button>
                  ))}
                </div>
                <details open>
                  <summary>Deliveries ({opsDel.length})</summary>
                  <pre>{JSON.stringify(opsDel, null, 2)}</pre>
                </details>
                <details style={{ marginTop: 8 }}>
                  <summary>Dead Letters ({dead.length})</summary>
                  <pre>{JSON.stringify(dead, null, 2)}</pre>
                </details>
              </section>

              <div className="cols-2">
                <section className="panel">
                  <h2>Logs</h2>
                  <pre>{JSON.stringify(logs, null, 2)}</pre>
                </section>
                <section className="panel">
                  <h2>Traces</h2>
                  <div className="toolbar">
                    {traces.slice(0, 20).map((t) => (
                      <button key={`trace-${String(t.trace_id)}`} className="secondary" onClick={() => void showTrace(String(t.trace_id))}>
                        {String(t.trace_id)}
                      </button>
                    ))}
                  </div>
                  {traceDetail ? <pre>{JSON.stringify(traceDetail, null, 2)}</pre> : <p className="muted">Bitte Trace auswaehlen.</p>}
                </section>
              </div>
            </div>
          ) : null}
        </main>
        <HelpModal open={helpOpen} content={helpContent} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}

