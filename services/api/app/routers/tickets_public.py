from __future__ import annotations

from datetime import datetime, timezone
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import File as DbFile
from app.db.models import FileLink, Plant, Ticket, TicketEvent, TicketPublicToken
from app.db.session import get_db
from app.deps import hash_text
from app.domain.audit_hashchain import append_ticket_event
from app.domain.files import save_upload
from app.domain.outbox import enqueue_outbox
from app.settings import get_settings


router = APIRouter(tags=["tickets-public"])


class TicketCreateIn(BaseModel):
    requester_name: str = Field(min_length=1)
    subject: str = Field(min_length=1)
    description: str = Field(min_length=1)


class TicketReplyIn(BaseModel):
    message: str = Field(min_length=1)


def area_from_slug(plant_slug: str) -> str:
    for prefix in ("MS_", "T_", "KS_", "SV_"):
        if plant_slug.startswith(prefix):
            return prefix.rstrip("_")
    return "MS"


def _lookup_ticket_by_token(db: Session, token: str) -> Ticket:
    token_hash = hash_text(token)
    stored = db.scalar(select(TicketPublicToken).where(TicketPublicToken.token_hash == token_hash))
    if not stored:
        raise HTTPException(status_code=404, detail="ticket token not found")
    ticket = db.get(Ticket, stored.ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")
    return ticket


def _public_ticket_timeline(db: Session, ticket_id: int) -> list[dict]:
    events = db.scalars(
        select(TicketEvent)
        .where(TicketEvent.ticket_id == ticket_id, TicketEvent.is_public == True)  # noqa: E712
        .order_by(TicketEvent.id.asc())
    ).all()
    return [
        {
            "event_type": e.event_type,
            "payload": e.event_payload,
            "created_at": e.created_at,
        }
        for e in events
    ]


@router.post("/public/tickets", status_code=201)
def create_public_ticket(
    payload: TicketCreateIn,
    plant_id: str = Query(..., alias="plantId"),
    db: Session = Depends(get_db),
):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_id))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")

    ticket = Ticket(
        plant_id=plant.id,
        requester_name=payload.requester_name,
        subject=payload.subject,
        description=payload.description,
        status="NEW",
        area=area_from_slug(plant.slug),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(ticket)
    db.flush()

    token = token_urlsafe(24)
    token_row = TicketPublicToken(ticket_id=ticket.id, token_hash=hash_text(token))
    db.add(token_row)

    append_ticket_event(db, ticket.id, "TicketCreated", {"subject": payload.subject, "plant_slug": plant.slug}, actor_ref="public")
    enqueue_outbox(db, "ticket", ticket.id, "TicketCreated", {"ticket_id": ticket.id, "plant_slug": plant.slug})
    db.commit()

    return {
        "ticket_id": ticket.id,
        "status": ticket.status,
        "public_token": token,
        "public_status_url": f"/Tickets/status/{token}",
    }


@router.get("/public/tickets/dashboard")
def public_ticket_dashboard_list(
    plant_id: str = Query(..., alias="plantId"),
    limit: int = Query(80, ge=1, le=300),
    db: Session = Depends(get_db),
):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_id))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")

    tickets = db.scalars(
        select(Ticket).where(Ticket.plant_id == plant.id).order_by(Ticket.created_at.desc()).limit(limit)
    ).all()
    return {
        "plant_slug": plant.slug,
        "items": [
            {
                "ticket_id": t.id,
                "subject": t.subject,
                "description": t.description,
                "status": t.status,
                "requester_name": t.requester_name,
                "department": t.department,
                "priority_rank": t.priority_rank,
                "ticket_type": t.ticket_type,
                "created_at": t.created_at,
                "updated_at": t.updated_at,
            }
            for t in tickets
        ],
    }


@router.get("/public/tickets/dashboard/{ticket_id}")
def public_ticket_dashboard_detail(
    ticket_id: int,
    plant_id: str = Query(..., alias="plantId"),
    db: Session = Depends(get_db),
):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_id))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")

    ticket = db.scalar(select(Ticket).where(Ticket.id == ticket_id, Ticket.plant_id == plant.id))
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found for plant")

    suggested_create_url = None
    if ticket.status == "CANCELLED_WRONG_PLANT":
        suggested_create_url = "/Tickets/MS_DEMO_ANLAGE_01"

    return {
        "ticket_id": ticket.id,
        "plant_slug": plant.slug,
        "subject": ticket.subject,
        "description": ticket.description,
        "status": ticket.status,
        "requester_name": ticket.requester_name,
        "department": ticket.department,
        "priority_rank": ticket.priority_rank,
        "ticket_type": ticket.ticket_type,
        "wrong_plant_reason": ticket.wrong_plant_reason,
        "suggested_create_url": suggested_create_url,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "timeline": _public_ticket_timeline(db, ticket.id),
    }


@router.get("/public/tickets/{token}")
def public_ticket_status(token: str, db: Session = Depends(get_db)):
    ticket = _lookup_ticket_by_token(db, token)
    plant = db.get(Plant, ticket.plant_id)

    suggested_create_url = None
    if ticket.status == "CANCELLED_WRONG_PLANT":
        suggested_create_url = "/Tickets/MS_DEMO_ANLAGE_01"

    return {
        "ticket_id": ticket.id,
        "plant_slug": plant.slug if plant else None,
        "subject": ticket.subject,
        "description": ticket.description,
        "status": ticket.status,
        "wrong_plant_reason": ticket.wrong_plant_reason,
        "suggested_create_url": suggested_create_url,
        "timeline": _public_ticket_timeline(db, ticket.id),
    }


@router.post("/public/tickets/{token}/reply", status_code=201)
def public_ticket_reply(token: str, payload: TicketReplyIn, db: Session = Depends(get_db)):
    ticket = _lookup_ticket_by_token(db, token)
    append_ticket_event(db, ticket.id, "TicketCommentAdded", {"message": payload.message, "visibility": "public"}, actor_ref="public")
    enqueue_outbox(db, "ticket", ticket.id, "TicketCommentAdded", {"ticket_id": ticket.id})
    db.commit()
    return {"ok": True}


@router.post("/public/tickets/{token}/attachments", status_code=201)
def public_ticket_attachment(
    token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    ticket = _lookup_ticket_by_token(db, token)
    settings = get_settings()

    saved = save_upload(file, settings.files_dir / "tickets" / str(ticket.id), settings.upload_max_bytes)
    record = DbFile(
        storage_name=str(saved["storage_name"]),
        filename_original=str(saved["filename_original"]),
        mime=str(saved["mime"]),
        size_bytes=int(saved["size_bytes"]),
        sha256=str(saved["sha256"]),
        path=str(saved["path"]),
    )
    db.add(record)
    db.flush()
    db.add(FileLink(file_id=record.id, scope_type="ticket", scope_id=ticket.id, kind="FILE"))

    append_ticket_event(db, ticket.id, "TicketAttachmentAdded", {"file_id": record.id}, actor_ref="public")
    enqueue_outbox(db, "ticket", ticket.id, "TicketAttachmentAdded", {"ticket_id": ticket.id, "file_id": record.id})
    db.commit()
    return {"attachment_id": record.id, "size_bytes": record.size_bytes}

