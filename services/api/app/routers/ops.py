from __future__ import annotations

import json
import os
import shutil
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import DeadLetterDelivery, Delivery, OpsErrorIndex, OpsHealthSnapshot, OutboxEvent
from app.db.session import get_db
from app.deps import require_roles
from app.domain.email_service import load_email_settings, sanitize_email_settings
from app.domain.outbox import process_outbox_once
from app.domain.request_meter import requests_per_minute
from app.settings import get_settings
from app.workers.health_watchdog import snapshot_once


router = APIRouter(tags=["ops"])


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _tail_lines(path: Path, lines: int) -> list[str]:
    if not path.exists():
        return []
    max_lines = max(1, min(lines, 1000))
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return content[-max_lines:]


def _mem_metrics() -> dict[str, int | float]:
    meminfo_path = Path("/proc/meminfo")
    if not meminfo_path.exists():
        return {
            "memory_total_bytes": 0,
            "memory_used_bytes": 0,
            "memory_free_bytes": 0,
            "memory_used_percent": 0.0,
        }
    data: dict[str, int] = {}
    for line in meminfo_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        parts = value.strip().split()
        if not parts:
            continue
        try:
            data[key.strip()] = int(parts[0]) * 1024
        except ValueError:
            continue
    total = int(data.get("MemTotal", 0))
    available = int(data.get("MemAvailable", data.get("MemFree", 0)))
    used = max(0, total - available)
    used_percent = round((used / total) * 100, 1) if total > 0 else 0.0
    return {
        "memory_total_bytes": total,
        "memory_used_bytes": used,
        "memory_free_bytes": max(0, available),
        "memory_used_percent": used_percent,
    }


def _disk_metrics() -> dict[str, int | float]:
    settings = get_settings()
    usage = shutil.disk_usage(settings.storage_root)
    used_percent = round((usage.used / usage.total) * 100, 1) if usage.total > 0 else 0.0
    return {
        "disk_total_bytes": int(usage.total),
        "disk_used_bytes": int(usage.used),
        "disk_free_bytes": int(usage.free),
        "disk_used_percent": used_percent,
    }


def _cpu_percent_estimate() -> float:
    try:
        load_1m = os.getloadavg()[0]
        cores = max(1, os.cpu_count() or 1)
        return round(max(0.0, min(100.0, (load_1m / cores) * 100.0)), 1)
    except OSError:
        return 0.0


def _module_states() -> dict[str, bool]:
    settings = get_settings()
    path = settings.config_dir / "module_settings.json"
    if not path.exists():
        return {
            "anlagenbuch_enabled": True,
            "tickets_enabled": True,
            "reporting_enabled": True,
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = {}
    reporting_enabled = True
    if isinstance(payload, dict):
        reporting = payload.get("reporting")
        if isinstance(reporting, dict):
            reporting_enabled = bool(reporting.get("enabled", True))
    return {
        "anlagenbuch_enabled": True,
        "tickets_enabled": True,
        "reporting_enabled": reporting_enabled,
    }


@router.get("/ops/status")
def ops_status(
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    latest = db.scalar(select(OpsHealthSnapshot).order_by(OpsHealthSnapshot.id.desc()).limit(1))
    if latest is None:
        snapshot_once()
        latest = db.scalar(select(OpsHealthSnapshot).order_by(OpsHealthSnapshot.id.desc()).limit(1))

    backlog = db.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.status == "PENDING")) or 0
    pending = (
        db.scalar(select(func.count()).select_from(Delivery).where(Delivery.status.in_(["PENDING", "FAILED_RETRY"]))) or 0
    )
    disk = _disk_metrics()
    memory = _mem_metrics()
    email_settings = load_email_settings()
    email_info = sanitize_email_settings(email_settings)
    email_info["configured"] = bool(email_info["host"]) and (email_info["has_password"] or bool(email_info["username"]))
    return {
        "health": {
            "db_ok": latest.db_ok if latest else False,
            "disk_ok": latest.disk_ok if latest else False,
            "backlog": latest.backlog if latest else 0,
            "response_ms": latest.response_ms if latest else 0,
            "last_error": latest.last_error if latest else None,
        },
        "pending_deliveries": pending,
        "pending_outbox": backlog,
        "system": {
            **disk,
            **memory,
            "cpu_load_percent": _cpu_percent_estimate(),
            "requests_per_minute": requests_per_minute(),
        },
        "modules": _module_states(),
        "email_server": email_info,
    }


@router.get("/ops/errors")
def ops_errors(
    from_ts: str | None = None,
    to_ts: str | None = None,
    trace_id: str | None = None,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    stmt = select(OpsErrorIndex)
    dt_from = _parse_ts(from_ts)
    dt_to = _parse_ts(to_ts)
    if dt_from:
        stmt = stmt.where(OpsErrorIndex.created_at >= dt_from)
    if dt_to:
        stmt = stmt.where(OpsErrorIndex.created_at <= dt_to)
    if trace_id:
        stmt = stmt.where(OpsErrorIndex.trace_id == trace_id.strip())
    stmt = stmt.order_by(OpsErrorIndex.created_at.desc()).limit(200)
    rows = db.scalars(stmt).all()
    return [
        {
            "id": r.id,
            "created_at": r.created_at,
            "route": r.route,
            "trace_id": r.trace_id,
            "exception_type": r.exception_type,
            "message": r.message,
            "status_code": r.status_code,
        }
        for r in rows
    ]


@router.get("/ops/deliveries")
def list_deliveries(
    status: str | None = None,
    limit: int = 200,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    stmt = select(Delivery)
    if status:
        stmt = stmt.where(Delivery.status == status.upper())
    rows = db.scalars(stmt.order_by(Delivery.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [
        {
            "id": d.id,
            "outbox_event_id": d.outbox_event_id,
            "target": d.target,
            "status": d.status,
            "attempts": d.attempts,
            "last_error": d.last_error,
            "next_retry_at": d.next_retry_at,
            "last_attempt_at": d.last_attempt_at,
            "created_at": d.created_at,
            "updated_at": d.updated_at,
        }
        for d in rows
    ]


@router.get("/ops/dead-letters")
def list_dead_letters(
    limit: int = 200,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(DeadLetterDelivery).order_by(DeadLetterDelivery.id.desc()).limit(max(1, min(limit, 500)))
    ).all()
    return [
        {
            "id": row.id,
            "delivery_id": row.delivery_id,
            "target": row.target,
            "payload": row.payload,
            "last_error": row.last_error,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/ops/deliveries/{delivery_id}/retry")
def retry_delivery(delivery_id: int, _: object = Depends(require_roles("Admin", "Dispatcher")), db: Session = Depends(get_db)):
    delivery = db.get(Delivery, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="delivery not found")
    delivery.status = "PENDING"
    delivery.last_error = None
    db.commit()
    process_outbox_once(db)
    db.refresh(delivery)
    return {"id": delivery.id, "status": delivery.status, "attempts": delivery.attempts}


@router.get("/ops/logs/tail")
def logs_tail(
    stream: str = "app",
    lines: int = 120,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
):
    settings = get_settings()
    mapping = {
        "app": settings.logs_dir / "app.log",
        "error": settings.logs_dir / "error.log",
        "trace": settings.logs_dir / "trace.log",
    }
    key = stream.strip().lower()
    if key not in mapping:
        raise HTTPException(status_code=400, detail="invalid stream")
    path = mapping[key]
    return {
        "stream": key,
        "path": str(path),
        "lines": _tail_lines(path, lines),
    }


@router.get("/ops/traces")
def list_traces(
    limit: int = 100,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
):
    settings = get_settings()
    traces_dir = settings.logs_dir / "traces"
    traces_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(traces_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    rows = []
    for file in files[: max(1, min(limit, 500))]:
        rows.append(
            {
                "trace_id": file.stem,
                "file": file.name,
                "modified_at": datetime.fromtimestamp(file.stat().st_mtime, tz=timezone.utc),
                "size_bytes": file.stat().st_size,
            }
        )
    return rows


@router.get("/ops/traces/{trace_id}")
def get_trace(
    trace_id: str,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
):
    if not trace_id.replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="invalid trace_id")
    settings = get_settings()
    path = settings.logs_dir / "traces" / f"{trace_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="trace not found")
    return json.loads(path.read_text(encoding="utf-8", errors="replace"))


@router.get("/ops/logs/download")
def support_bundle(
    days: int = 7,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    bundle_dir = settings.backups_dir / "support"
    bundle_dir.mkdir(parents=True, exist_ok=True)

    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 30)))
    snapshots = db.scalars(select(OpsHealthSnapshot).where(OpsHealthSnapshot.created_at >= cutoff)).all()

    zip_path = bundle_dir / f"support_bundle_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in ("error.log", "trace.log", "app.log"):
            fp = settings.logs_dir / name
            if fp.exists():
                zf.write(fp, arcname=name)
        zf.writestr("ops_health_snapshots.json", json.dumps([
            {
                "created_at": s.created_at.isoformat(),
                "db_ok": s.db_ok,
                "disk_ok": s.disk_ok,
                "backlog": s.backlog,
                "response_ms": s.response_ms,
                "last_error": s.last_error,
            }
            for s in snapshots
        ], indent=2))

    return FileResponse(zip_path, media_type="application/zip", filename=zip_path.name)
