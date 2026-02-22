from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.db.models import ReportSchedule, ReportRun
from app.db.session import SessionLocal
from app.domain.reporting_engine import run_report


def run_due_once() -> int:
    executed = 0
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        schedules = db.scalars(select(ReportSchedule).where(ReportSchedule.enabled == True)).all()  # noqa: E712
        for schedule in schedules:
            if schedule.last_run_at and (now - schedule.last_run_at).total_seconds() < 60:
                continue
            run = ReportRun(requested_by="scheduler", plant_slug=schedule.plant_slug, status="queued")
            db.add(run)
            db.flush()
            run_report(db, run, list(schedule.formats_json))
            schedule.last_run_at = now
            executed += 1
        db.commit()
    return executed


if __name__ == "__main__":
    print(run_due_once())
