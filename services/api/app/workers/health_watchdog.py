from __future__ import annotations

import shutil
from pathlib import Path
from time import perf_counter

from sqlalchemy import func, select

from app.db.models import OpsHealthSnapshot, OutboxEvent
from app.db.session import SessionLocal
from app.settings import get_settings


def snapshot_once() -> dict:
    settings = get_settings()
    start = perf_counter()

    db_ok = True
    disk_ok = True
    backlog = 0
    last_error = ""

    try:
        with SessionLocal() as db:
            backlog = db.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.status == "PENDING")) or 0
            db.scalar(select(func.count()).select_from(OpsHealthSnapshot))
    except Exception as exc:  # pragma: no cover
        db_ok = False
        last_error = f"db_error:{exc}"

    try:
        usage = shutil.disk_usage(Path(settings.storage_root))
        free_ratio = usage.free / usage.total if usage.total else 0
        disk_ok = free_ratio > 0.05
        if not disk_ok:
            last_error = f"disk_low:{free_ratio:.4f}"
    except Exception as exc:  # pragma: no cover
        disk_ok = False
        last_error = f"disk_error:{exc}"

    elapsed_ms = int((perf_counter() - start) * 1000)

    with SessionLocal() as db:
        db.add(
            OpsHealthSnapshot(
                db_ok=db_ok,
                disk_ok=disk_ok,
                backlog=backlog,
                response_ms=elapsed_ms,
                last_error=last_error or None,
            )
        )
        db.commit()

    return {
        "db_ok": db_ok,
        "disk_ok": disk_ok,
        "backlog": backlog,
        "response_ms": elapsed_ms,
        "last_error": last_error,
    }


if __name__ == "__main__":
    print(snapshot_once())
