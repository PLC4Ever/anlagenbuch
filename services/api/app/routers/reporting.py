from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ReportArtifact, ReportDelivery, ReportRun, ReportSchedule, ReportScheduleFilter
from app.db.session import get_db
from app.deps import require_roles
from app.domain.email_service import load_email_settings, send_email
from app.domain.outbox import enqueue_outbox
from app.domain.reporting_engine import build_report_dataset, normalize_report_kind, run_report


router = APIRouter(tags=["reporting"])


class ExportIn(BaseModel):
    plantId: str
    from_dt: datetime | None = Field(default=None, alias="from")
    to_dt: datetime | None = Field(default=None, alias="to")
    department: str | None = None
    ticket_id: int | None = Field(default=None, ge=1)
    report_kind: str = "tickets"
    formats: list[str] = Field(default_factory=lambda: ["csv"])


class ScheduleIn(BaseModel):
    name: str
    cron_type: str
    timezone: str = "Europe/Berlin"
    plant_slug: str
    department: str | None = None
    ticket_id: int | None = Field(default=None, ge=1)
    report_kind: str = "tickets"
    formats: list[str] = Field(default_factory=lambda: ["csv"])
    recipients: list[str] = Field(default_factory=list)


class SchedulePatch(BaseModel):
    name: str | None = None
    cron_type: str | None = None
    timezone: str | None = None
    plant_slug: str | None = None
    department: str | None = None
    ticket_id: int | None = Field(default=None, ge=1)
    report_kind: str | None = None
    formats: list[str] | None = None
    recipients: list[str] | None = None
    enabled: bool | None = None


class PreviewIn(BaseModel):
    plantId: str
    from_dt: datetime | None = Field(default=None, alias="from")
    to_dt: datetime | None = Field(default=None, alias="to")
    department: str | None = None
    ticket_id: int | None = Field(default=None, ge=1)
    report_kind: str = "tickets"
    limit: int = Field(default=60, ge=1, le=500)


def _schedule_filter_map(db: Session) -> dict[int, ReportScheduleFilter]:
    rows = db.scalars(select(ReportScheduleFilter)).all()
    return {row.schedule_id: row for row in rows}


def _upsert_schedule_filter(
    db: Session,
    schedule_id: int,
    *,
    department: str | None,
    ticket_id: int | None,
    report_kind: str | None,
) -> ReportScheduleFilter:
    row = db.scalar(select(ReportScheduleFilter).where(ReportScheduleFilter.schedule_id == schedule_id))
    if not row:
        row = ReportScheduleFilter(schedule_id=schedule_id)
        db.add(row)
    row.department = (department or "").strip() or None
    row.ticket_id = ticket_id
    row.report_kind = normalize_report_kind(report_kind)
    return row


def _create_report_deliveries(
    db: Session,
    run_id: int,
    recipients: list[str],
    artifacts: list[ReportArtifact],
) -> list[ReportDelivery]:
    created: list[ReportDelivery] = []
    email_settings = load_email_settings()
    attachments: list[dict] = []
    for artifact in artifacts:
        path = Path(artifact.path)
        if not path.exists():
            continue
        attachments.append(
            {
                "filename": path.name,
                "mime_type": artifact.mime_type,
                "payload": path.read_bytes(),
            }
        )
    for recipient in recipients:
        normalized_recipient = (recipient or "").strip()
        if not normalized_recipient:
            continue
        row = ReportDelivery(
            report_run_id=run_id,
            recipient=normalized_recipient,
            status="queued",
            attempts=0,
            last_error=None,
        )
        row.attempts = 1
        if not email_settings.get("enabled"):
            row.status = "queued"
            row.last_error = "email server disabled"
        else:
            try:
                send_email(
                    email_settings,
                    recipient=normalized_recipient,
                    subject=f"Anlagenserver Report #{run_id}",
                    body="Der angeforderte Report wurde erzeugt und ist im Anhang enthalten.",
                    attachments=attachments,
                )
                row.status = "delivered"
                row.last_error = None
            except Exception as exc:  # pragma: no cover - depends on smtp environment
                row.status = "failed"
                row.last_error = str(exc)[:500]
        db.add(row)
        created.append(row)
    return created


@router.post("/reporting/exports", status_code=201)
def create_export(
    payload: ExportIn,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    department = (payload.department or "").strip() or None
    kind = normalize_report_kind(payload.report_kind)
    run = ReportRun(
        requested_by="internal",
        plant_slug=payload.plantId,
        range_from=payload.from_dt,
        range_to=payload.to_dt,
        status="queued",
    )
    db.add(run)
    db.flush()

    artifacts = run_report(
        db,
        run,
        payload.formats,
        context={
            "department": department,
            "ticket_id": payload.ticket_id,
            "report_kind": kind,
            "from_dt": payload.from_dt,
            "to_dt": payload.to_dt,
        },
    )
    _create_report_deliveries(db, run.id, [], artifacts)
    enqueue_outbox(db, "report", run.id, "ReportGenerated", {"run_id": run.id})
    db.commit()

    return {"id": run.id, "status": run.status}


@router.get("/reporting/runs")
def list_runs(
    limit: int = 200,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(ReportRun).order_by(ReportRun.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [
        {
            "id": run.id,
            "requested_by": run.requested_by,
            "plant_slug": run.plant_slug,
            "status": run.status,
            "created_at": run.created_at,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
        }
        for run in rows
    ]


@router.get("/reporting/runs/{run_id}")
def get_run(run_id: int, _: object = Depends(require_roles("Admin", "Dispatcher")), db: Session = Depends(get_db)):
    run = db.get(ReportRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    artifacts = db.scalars(select(ReportArtifact).where(ReportArtifact.report_run_id == run_id)).all()
    return {
        "id": run.id,
        "status": run.status,
        "plant_slug": run.plant_slug,
        "range_from": run.range_from,
        "range_to": run.range_to,
        "artifacts": [
            {
                "artifact_id": a.id,
                "format": a.format,
                "mime_type": a.mime_type,
                "size_bytes": a.size_bytes,
            }
            for a in artifacts
        ],
    }


@router.post("/reporting/preview")
def preview_report(
    payload: PreviewIn,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    dataset = build_report_dataset(
        db,
        plant_slug=payload.plantId,
        from_dt=payload.from_dt,
        to_dt=payload.to_dt,
        department=(payload.department or "").strip() or None,
        ticket_id=payload.ticket_id,
        report_kind=payload.report_kind,
        limit=payload.limit,
    )
    return dataset


@router.get("/reporting/runs/{run_id}/artifacts/{artifact_id}")
def download_artifact(
    run_id: int,
    artifact_id: int,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    artifact = db.get(ReportArtifact, artifact_id)
    if not artifact or artifact.report_run_id != run_id:
        raise HTTPException(status_code=404, detail="artifact not found")
    path = Path(artifact.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="file missing")
    return FileResponse(path, media_type=artifact.mime_type, filename=path.name)


@router.post("/reporting/schedules", status_code=201)
def create_schedule(
    payload: ScheduleIn,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    department = (payload.department or "").strip() or None
    kind = normalize_report_kind(payload.report_kind)
    row = ReportSchedule(
        name=payload.name,
        cron_type=payload.cron_type,
        timezone=payload.timezone,
        plant_slug=payload.plant_slug,
        formats_json=payload.formats,
        recipients_json=payload.recipients,
        enabled=True,
    )
    db.add(row)
    db.flush()
    _upsert_schedule_filter(
        db,
        row.id,
        department=department,
        ticket_id=payload.ticket_id,
        report_kind=kind,
    )
    db.commit()
    db.refresh(row)
    return {"id": row.id}


@router.get("/reporting/schedules")
def list_schedules(
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(ReportSchedule).order_by(ReportSchedule.id.asc())).all()
    filters = _schedule_filter_map(db)
    return [
        {
            "id": r.id,
            "name": r.name,
            "cron_type": r.cron_type,
            "timezone": r.timezone,
            "plant_slug": r.plant_slug,
            "department": filters[r.id].department if r.id in filters else None,
            "ticket_id": filters[r.id].ticket_id if r.id in filters else None,
            "report_kind": filters[r.id].report_kind if r.id in filters else "tickets",
            "formats": r.formats_json,
            "recipients": r.recipients_json,
            "enabled": r.enabled,
        }
        for r in rows
    ]


@router.patch("/reporting/schedules/{schedule_id}")
def patch_schedule(
    schedule_id: int,
    payload: SchedulePatch,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    row = db.get(ReportSchedule, schedule_id)
    if not row:
        raise HTTPException(status_code=404, detail="schedule not found")
    input_patch = payload.model_dump(exclude_none=True)
    patch = dict(input_patch)
    filter_department = patch.pop("department", None) if "department" in patch else None
    filter_ticket_id = patch.pop("ticket_id", None) if "ticket_id" in patch else None
    filter_kind = patch.pop("report_kind", None) if "report_kind" in patch else None
    if "formats" in patch:
        patch["formats_json"] = patch.pop("formats")
    if "recipients" in patch:
        patch["recipients_json"] = patch.pop("recipients")
    for key, value in patch.items():
        setattr(row, key, value)
    if "department" in input_patch or "ticket_id" in input_patch or "report_kind" in input_patch:
        current = db.scalar(select(ReportScheduleFilter).where(ReportScheduleFilter.schedule_id == schedule_id))
        _upsert_schedule_filter(
            db,
            schedule_id,
            department=filter_department if "department" in input_patch else (current.department if current else None),
            ticket_id=filter_ticket_id if "ticket_id" in input_patch else (current.ticket_id if current else None),
            report_kind=filter_kind if "report_kind" in input_patch else (current.report_kind if current else "tickets"),
        )
    db.commit()
    db.refresh(row)
    filter_row = db.scalar(select(ReportScheduleFilter).where(ReportScheduleFilter.schedule_id == schedule_id))
    return {
        "id": row.id,
        "name": row.name,
        "cron_type": row.cron_type,
        "timezone": row.timezone,
        "plant_slug": row.plant_slug,
        "department": filter_row.department if filter_row else None,
        "ticket_id": filter_row.ticket_id if filter_row else None,
        "report_kind": filter_row.report_kind if filter_row else "tickets",
        "formats": row.formats_json,
        "recipients": row.recipients_json,
        "enabled": row.enabled,
    }


@router.delete("/reporting/schedules/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    row = db.get(ReportSchedule, schedule_id)
    if not row:
        raise HTTPException(status_code=404, detail="schedule not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/reporting/deliveries")
def list_deliveries(
    limit: int = 200,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(ReportDelivery).order_by(ReportDelivery.id.desc()).limit(max(1, min(limit, 500)))
    ).all()
    return [
        {
            "id": row.id,
            "report_run_id": row.report_run_id,
            "recipient": row.recipient,
            "status": row.status,
            "attempts": row.attempts,
            "last_error": row.last_error,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/reporting/schedules/{schedule_id}/run-now", status_code=201)
def run_now(
    schedule_id: int,
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    schedule = db.get(ReportSchedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="schedule not found")

    run = ReportRun(requested_by="run-now", plant_slug=schedule.plant_slug, status="queued")
    db.add(run)
    db.flush()
    schedule_filter = db.scalar(select(ReportScheduleFilter).where(ReportScheduleFilter.schedule_id == schedule.id))
    artifacts = run_report(
        db,
        run,
        list(schedule.formats_json),
        context={
            "department": schedule_filter.department if schedule_filter else None,
            "ticket_id": schedule_filter.ticket_id if schedule_filter else None,
            "report_kind": schedule_filter.report_kind if schedule_filter else "tickets",
        },
    )
    _create_report_deliveries(db, run.id, list(schedule.recipients_json), artifacts)
    enqueue_outbox(db, "report", run.id, "ReportGenerated", {"run_id": run.id})
    db.commit()
    return {"id": run.id, "status": run.status}
