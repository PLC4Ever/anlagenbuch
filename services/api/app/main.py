from __future__ import annotations

import json
import logging
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from time import sleep

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.db.models import Base, OpsErrorIndex
from app.db.session import SessionLocal, engine
from app.domain.request_meter import record_request
from app.logging.logging_config import configure_logging
from app.routers import admin, auth, ops, plants, reporting, schichtbuch, tickets_internal, tickets_public
from app.seed_data import seed_if_empty
from app.settings import get_settings
from app.workers.health_watchdog import snapshot_once


settings = get_settings()

OPENAPI_TAGS = [
    {
        "name": "system",
        "description": "Systemchecks fuer Betrieb und Monitoring.",
    },
    {
        "name": "auth",
        "description": "Anmeldung, Session, Profil und Passwortwechsel.",
    },
    {
        "name": "admin-internal",
        "description": "Administration fuer Benutzer, Rollen, Gruppen, Module und E-Mail.",
    },
    {
        "name": "plants",
        "description": "Anlagen-Stammdaten (Anlage anlegen, lesen, aendern).",
    },
    {
        "name": "schichtbuch",
        "description": "Schichtbuch-Eintraege, Verlauf, Dateianhaenge und Events.",
    },
    {
        "name": "tickets-public",
        "description": "Oeffentliche Ticket-Endpunkte fuer Anlagenfahrer (ohne Login).",
    },
    {
        "name": "tickets-internal",
        "description": "Interne Ticketsteuerung fuer Dispatcher, Agent und Admin.",
    },
    {
        "name": "reporting",
        "description": "Manuelle und geplante Reports inkl. Artefakt-Download.",
    },
    {
        "name": "ops",
        "description": "Betriebsdaten, Fehlerlisten, Traces, Logs und Support-Bundles.",
    },
]

API_DESCRIPTION = """
REST-API fuer Anlagenbuch, Tickets, Reporting und Betrieb.

## Authentifizierung
- Interne Endpunkte nutzen Session-Cookie-Authentifizierung.
- Login ueber `POST /auth/login`.
- Cookie-Name: `anlagen_session`.

## Rollenmodell
- `Admin`: volle Administration und Betrieb.
- `Dispatcher`: Ticket-Einordnung, Routing, Statuspflege, Reporting.
- `Agent`: Bearbeitung zugewiesener Tickets.
- Oeffentliche Ticket-Endpunkte (`/public/*`) sind ohne Login erreichbar.

## Basis-Pfad
Die API laeuft hinter dem Reverse-Proxy unter `/api`.
In Swagger sind alle Pfade relativ zu diesem Basis-Pfad.
"""

app = FastAPI(
    title="Anlagenbuch API",
    version="0.1.0",
    description=API_DESCRIPTION,
    openapi_tags=OPENAPI_TAGS,
    contact={"name": "Anlagenbuch Team"},
    license_info={"name": "Unlicense"},
    root_path=settings.root_path,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("anlagen")
error_logger = logging.getLogger("anlagen.error")
trace_logger = logging.getLogger("anlagen.trace")


def _trace_snapshot(trace_id: str, request: Request, status_code: int, exc: Exception) -> None:
    traces_dir = settings.logs_dir / "traces"
    traces_dir.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "trace_id": trace_id,
        "route": str(request.url.path),
        "status": status_code,
        "exception_type": exc.__class__.__name__,
        "message": str(exc),
        "method": request.method,
    }
    path = traces_dir / f"{trace_id}.json"
    path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")


def _serve_index(root: Path) -> FileResponse:
    index = root / "index.html"
    if not index.exists():
        return FileResponse(root / "missing.html") if (root / "missing.html").exists() else FileResponse(__file__)
    return FileResponse(index)


def _serve_asset(root: Path, asset_path: str) -> FileResponse:
    assets_root = (root / "assets").resolve()
    file_path = (assets_root / asset_path).resolve()
    if not str(file_path).startswith(str(assets_root)) or not file_path.exists() or not file_path.is_file():
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    return FileResponse(file_path)


@app.middleware("http")
async def trace_middleware(request: Request, call_next):
    record_request()
    trace_id = str(uuid.uuid4())
    request.state.trace_id = trace_id
    start = datetime.now(timezone.utc)

    try:
        response = await call_next(request)
    except Exception as exc:
        _trace_snapshot(trace_id, request, 500, exc)
        with SessionLocal() as db:
            db.add(
                OpsErrorIndex(
                    route=request.url.path,
                    trace_id=trace_id,
                    exception_type=exc.__class__.__name__,
                    message=str(exc),
                    file_ref="",
                    status_code=500,
                )
            )
            db.commit()
        error_logger.exception("request failed", extra={"trace_id": trace_id})
        response = JSONResponse(status_code=500, content={"detail": "internal error", "trace_id": trace_id})

    elapsed = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
    response.headers["X-Trace-Id"] = trace_id
    trace_logger.info(
        "request",
        extra={"trace_id": trace_id},
    )
    logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({elapsed}ms)", extra={"trace_id": trace_id})
    return response


@app.on_event("startup")
def on_startup() -> None:
    configure_logging()
    for path in (settings.storage_root, settings.files_dir, settings.reports_dir, settings.logs_dir, settings.backups_dir, settings.config_dir):
        path.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for _ in range(30):
        try:
            Base.metadata.create_all(bind=engine)
            with SessionLocal() as db:
                seed_if_empty(db)
            last_error = None
            break
        except Exception as exc:  # pragma: no cover
            last_error = exc
            sleep(2)
    if last_error:
        raise last_error
    snapshot_once()


ROLE_ENTRY_HTML = """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anlagenserver Einstieg</title>
<style>
  :root {
    --bg: #edf3f1;
    --ink: #163033;
    --muted: #4b6267;
    --card: #ffffff;
    --line: #c7d7d4;
    --admin: #1d4ed8;
    --disp: #0f766e;
    --agent: #b45309;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    color: var(--ink);
    background: radial-gradient(circle at 15% 10%, #dceceb, var(--bg));
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: min(980px, 100%);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 16px 42px rgba(22, 48, 51, 0.1);
    padding: 24px;
  }
  h1 {
    margin: 0 0 8px;
    font-size: clamp(1.5rem, 3vw, 2rem);
  }
  p {
    margin: 0 0 18px;
    color: var(--muted);
  }
  .grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  a.tile {
    text-decoration: none;
    color: #fff;
    border-radius: 12px;
    padding: 16px;
    display: grid;
    gap: 8px;
    min-height: 120px;
  }
  .admin { background: linear-gradient(135deg, #1d4ed8, #1e40af); }
  .dispatcher { background: linear-gradient(135deg, #0f766e, #115e59); }
  .agent { background: linear-gradient(135deg, #b45309, #92400e); }
  .kicker {
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.85;
  }
  .title {
    font-size: 1.2rem;
    font-weight: 700;
  }
  .desc {
    font-size: 0.95rem;
    opacity: 0.95;
  }
</style>
</head>
<body>
  <main class="card">
    <h1>Anlagenserver Startseite</h1>
    <p>Waehle den passenden Bereich fuer deine Rolle.</p>
    <section class="grid">
      <a class="tile admin" href="/admin/">
        <span class="kicker">Portal</span>
        <span class="title">Admin</span>
        <span class="desc">System, Benutzer, Gruppen und Einstellungen</span>
      </a>
      <a class="tile dispatcher" href="/dispatcher/">
        <span class="kicker">Portal</span>
        <span class="title">Dispatcher</span>
        <span class="desc">Tickets einordnen, zuweisen und Reports steuern</span>
      </a>
      <a class="tile agent" href="/endbearbeiter/">
        <span class="kicker">Portal</span>
        <span class="title">Endbearbeiter</span>
        <span class="desc">Tickets bearbeiten und abschliessen</span>
      </a>
    </section>
  </main>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
@app.get("/start", response_class=HTMLResponse, include_in_schema=False)
def role_entry_page() -> str:
    return ROLE_ENTRY_HTML


@app.get("/healthz", tags=["system"], summary="Liveness-Check")
def healthz():
    return {"status": "ok"}


@app.get("/readyz", tags=["system"], summary="Readiness-Check")
def readyz():
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        return {"status": "ready"}
    except SQLAlchemyError as exc:
        return JSONResponse(status_code=503, content={"status": "not-ready", "error": str(exc)})


@app.get("/ops", response_class=HTMLResponse, include_in_schema=False)
def ops_page() -> str:
    return """
<!doctype html>
<html>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<title>Ops Console</title>
<style>
  :root {
    --bg: #eef7f5;
    --panel: #ffffff;
    --ink: #113436;
    --muted: #4b6a6d;
    --line: #c4d8d8;
    --brand: #0f766e;
    --danger: #9f1239;
  }
  body {
    margin: 0;
    font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    background: radial-gradient(circle at top left, #dbefe9, var(--bg));
    color: var(--ink);
  }
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px;
    display: grid;
    gap: 14px;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 10px 26px rgba(17, 52, 54, 0.08);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }
  h1, h2, h3 {
    margin: 0 0 10px 0;
  }
  h1 {
    font-size: 1.5rem;
  }
  h2 {
    font-size: 1.1rem;
  }
  .toolbar {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 10px;
  }
  input, select, button {
    font: inherit;
  }
  input, select {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
    min-width: 150px;
  }
  button, .link-btn {
    background: var(--brand);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }
  button.secondary {
    background: #3f5f63;
  }
  button.danger {
    background: var(--danger);
  }
  pre {
    background: #0e2325;
    color: #d6f8f3;
    border-radius: 10px;
    padding: 10px;
    overflow: auto;
    max-height: 250px;
    margin: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    text-align: left;
    border-bottom: 1px solid var(--line);
    padding: 6px 4px;
    vertical-align: top;
    font-size: 0.92rem;
  }
  .muted {
    color: var(--muted);
  }
  .msg {
    font-size: 0.95rem;
    color: var(--danger);
  }
</style>
</head>
<body>
<div class='wrap'>
  <div class='panel'>
    <h1>Ops Console</h1>
    <p class='muted'>Health, Errors, Deliveries, Logs und Traces. Interne API benötigt Login-Session.</p>
    <div class='toolbar'>
      <button onclick='loadAll()'>Aktualisieren</button>
      <a class='link-btn secondary' href='/admin'>Zum Admin Login</a>
      <a class='link-btn secondary' href='/api/ops/logs/download?days=7'>Support-Bundle</a>
      <a class='link-btn secondary' href='/ops/mail'>Mailpit</a>
    </div>
    <p id='msg' class='msg'></p>
  </div>

  <div class='row'>
    <section class='panel'>
      <h2>Health</h2>
      <pre id='health'>lädt ...</pre>
    </section>
    <section class='panel'>
      <h2>Log Viewer</h2>
      <div class='toolbar'>
        <select id='logStream'>
          <option value='app'>app</option>
          <option value='error'>error</option>
          <option value='trace'>trace</option>
        </select>
        <input id='logLines' type='number' min='20' max='500' value='80'>
        <button class='secondary' onclick='loadLogs()'>Laden</button>
      </div>
      <pre id='logs'></pre>
    </section>
  </div>

  <section class='panel'>
    <h2>Errors</h2>
    <div class='toolbar'>
      <input id='traceFilter' placeholder='trace_id (optional)'>
      <button class='secondary' onclick='loadErrors()'>Filter anwenden</button>
    </div>
    <table>
      <thead><tr><th>Zeit</th><th>Route</th><th>Trace</th><th>Typ</th><th>Status</th></tr></thead>
      <tbody id='errorsBody'></tbody>
    </table>
  </section>

  <section class='panel'>
    <h2>Deliveries</h2>
    <table>
      <thead><tr><th>ID</th><th>Status</th><th>Attempts</th><th>Target</th><th>Aktion</th></tr></thead>
      <tbody id='deliveriesBody'></tbody>
    </table>
    <h3 style='margin-top:16px'>Dead Letters</h3>
    <pre id='deadLetters'>lädt ...</pre>
  </section>

  <section class='panel'>
    <h2>Trace Snapshots</h2>
    <div class='toolbar'>
      <button class='secondary' onclick='loadTraces()'>Neu laden</button>
    </div>
    <table>
      <thead><tr><th>Trace</th><th>Geändert</th><th>Größe</th><th>Detail</th></tr></thead>
      <tbody id='tracesBody'></tbody>
    </table>
    <pre id='traceDetail'></pre>
  </section>
</div>

<script>
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    const body = await r.text();
    const suffix = body ? `: ${body.slice(0, 180)}` : "";
    throw new Error(`${r.status} ${r.statusText}${suffix}`);
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return r.text();
}

function showError(err) {
  document.getElementById("msg").textContent = err.message || String(err);
}

async function loadHealth() {
  const status = await api("/api/ops/status");
  document.getElementById("health").textContent = JSON.stringify(status, null, 2);
}

async function loadErrors() {
  const traceId = document.getElementById("traceFilter").value.trim();
  const q = traceId ? `?trace_id=${encodeURIComponent(traceId)}` : "";
  const rows = await api(`/api/ops/errors${q}`);
  const body = document.getElementById("errorsBody");
  body.innerHTML = "";
  rows.slice(0, 60).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.created_at || ""}</td><td>${row.route || ""}</td><td>${row.trace_id || ""}</td><td>${row.exception_type || ""}</td><td>${row.status_code || ""}</td>`;
    body.appendChild(tr);
  });
}

async function loadDeliveries() {
  const rows = await api("/api/ops/deliveries?limit=80");
  const body = document.getElementById("deliveriesBody");
  body.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const retryable = row.status !== "DELIVERED";
    tr.innerHTML = `<td>${row.id}</td><td>${row.status}</td><td>${row.attempts}</td><td>${row.target}</td><td>${retryable ? `<button data-id="${row.id}" class="secondary">Retry</button>` : "-"}</td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/ops/deliveries/${btn.dataset.id}/retry`, { method: "POST" });
        await loadDeliveries();
      } catch (err) {
        showError(err);
      }
    });
  });
  const dead = await api("/api/ops/dead-letters?limit=40");
  document.getElementById("deadLetters").textContent = JSON.stringify(dead, null, 2);
}

async function loadLogs() {
  const stream = document.getElementById("logStream").value;
  const lines = parseInt(document.getElementById("logLines").value || "80", 10);
  const row = await api(`/api/ops/logs/tail?stream=${encodeURIComponent(stream)}&lines=${Math.max(20, Math.min(lines, 500))}`);
  document.getElementById("logs").textContent = (row.lines || []).join("\\n");
}

async function loadTraces() {
  const rows = await api("/api/ops/traces?limit=60");
  const body = document.getElementById("tracesBody");
  body.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.trace_id}</td><td>${row.modified_at || ""}</td><td>${row.size_bytes}</td><td><button class="secondary" data-trace="${row.trace_id}">Anzeigen</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll("button[data-trace]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const detail = await api(`/api/ops/traces/${encodeURIComponent(btn.dataset.trace)}`);
        document.getElementById("traceDetail").textContent = JSON.stringify(detail, null, 2);
      } catch (err) {
        showError(err);
      }
    });
  });
}

async function loadAll() {
  document.getElementById("msg").textContent = "";
  try {
    await Promise.all([loadHealth(), loadErrors(), loadDeliveries(), loadLogs(), loadTraces()]);
  } catch (err) {
    showError(err);
  }
}

loadAll();
</script>
</body>
</html>
"""


@app.post("/test/clock", include_in_schema=False)
def test_clock(payload: dict):
    if settings.env.lower() != "test":
        return JSONResponse(status_code=404, content={"detail": "not enabled"})
    from app.domain import shift

    value = payload.get("now")
    shift.set_test_now(value)
    return {"now": value}


def _ui_path_candidates() -> dict[str, list[Path]]:
    app_root = Path(__file__).resolve().parents[1]
    repo_root = Path(__file__).resolve().parents[3]
    return {
        "ui-schichtbuch": [
            app_root / "static" / "ui-schichtbuch",
            repo_root / "apps" / "ui-schichtbuch" / "dist",
        ],
        "ui-tickets": [
            app_root / "static" / "ui-tickets",
            repo_root / "apps" / "ui-tickets" / "dist",
        ],
        "ui-admin": [
            app_root / "static" / "ui-admin",
            repo_root / "apps" / "ui-admin" / "dist",
        ],
    }


_UI_CANDIDATES = _ui_path_candidates()


def _ui_root(name: str) -> Path:
    candidates = _UI_CANDIDATES.get(name, [])
    for candidate in candidates:
        if (candidate / "index.html").exists():
            return candidate
    return candidates[0] if candidates else Path(__file__).resolve().parents[1] / "static" / name


@app.get("/Schichtbuch/assets/{asset_path:path}", include_in_schema=False)
def schichtbuch_asset(asset_path: str):
    return _serve_asset(_ui_root("ui-schichtbuch"), asset_path)


@app.get("/Tickets/assets/{asset_path:path}", include_in_schema=False)
def tickets_asset(asset_path: str):
    return _serve_asset(_ui_root("ui-tickets"), asset_path)


@app.get("/admin/assets/{asset_path:path}", include_in_schema=False)
def admin_asset(asset_path: str):
    return _serve_asset(_ui_root("ui-admin"), asset_path)


@app.get("/Schichtbuch/{path:path}", include_in_schema=False)
def schichtbuch_ui(path: str):
    return _serve_index(_ui_root("ui-schichtbuch"))


@app.get("/Tickets/{path:path}", include_in_schema=False)
def tickets_ui(path: str):
    return _serve_index(_ui_root("ui-tickets"))


@app.get("/admin", include_in_schema=False)
@app.get("/admin/", include_in_schema=False)
def admin_ui():
    return _serve_index(_ui_root("ui-admin"))


@app.get("/dispatcher", include_in_schema=False)
@app.get("/dispatcher/", include_in_schema=False)
@app.get("/dispatcher/{path:path}", include_in_schema=False)
def dispatcher_ui(path: str = ""):
    return _serve_index(_ui_root("ui-admin"))


@app.get("/endbearbeiter", include_in_schema=False)
@app.get("/endbearbeiter/", include_in_schema=False)
@app.get("/endbearbeiter/{path:path}", include_in_schema=False)
@app.get("/endarbeiter", include_in_schema=False)
@app.get("/endarbeiter/", include_in_schema=False)
@app.get("/endarbeiter/{path:path}", include_in_schema=False)
@app.get("/agent", include_in_schema=False)
@app.get("/agent/", include_in_schema=False)
@app.get("/agent/{path:path}", include_in_schema=False)
def agent_ui(path: str = ""):
    return _serve_index(_ui_root("ui-admin"))


app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(plants.router)
app.include_router(schichtbuch.router)
app.include_router(tickets_public.router)
app.include_router(tickets_internal.router)
app.include_router(reporting.router)
app.include_router(ops.router)
