from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.db.models import File as DbFile
from app.db.models import FileLink, IdempotencyKey, Plant, ShiftEntry, ShiftEntryEvent
from app.db.session import get_db
from app.deps import hash_text
from app.domain.audit_hashchain import append_shift_event
from app.domain.files import save_upload
from app.domain.outbox import enqueue_outbox
from app.domain.shift import resolve_shift
from app.settings import get_settings


router = APIRouter(tags=["schichtbuch"])


class EntryCreateIn(BaseModel):
    client_request_id: str = Field(min_length=8)
    author_name: str = Field(min_length=1)
    author_token: str = Field(min_length=8)
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)


class EntryPatchIn(BaseModel):
    client_request_id: str = Field(min_length=8)
    author_token: str = Field(min_length=8)
    author_name: str | None = Field(default=None, min_length=1)
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)


class EntryDeleteIn(BaseModel):
    client_request_id: str = Field(min_length=8)
    author_token: str = Field(min_length=8)
    author_name: str | None = Field(default=None, min_length=1)


class EventIn(BaseModel):
    event_type: str
    payload: dict
    actor_ref: str = "public"


def _can_edit_entry(entry: ShiftEntry, author_token: str, author_name: str | None = None) -> bool:
    if entry.author_token_hash == hash_text(author_token):
        return True
    if author_name and author_name.strip().casefold() == entry.author_name.strip().casefold():
        return True
    return False


@router.get("/plants/{plant_slug}/entries")
def list_entries(
    plant_slug: str,
    q: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_slug))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")

    stmt = (
        select(ShiftEntry)
        .where(ShiftEntry.plant_id == plant.id, ShiftEntry.status != "DELETED")
        .order_by(ShiftEntry.created_at.desc())
        .limit(max(1, min(limit, 200)))
    )
    if q:
        stmt = stmt.where(and_(ShiftEntry.subject.ilike(f"%{q}%")))

    rows = db.scalars(stmt).all()
    return [
        {
            "entry_id": e.id,
            "subject": e.subject,
            "body": e.body,
            "author_name": e.author_name,
            "status": e.status,
            "editable_until": e.editable_until,
            "created_at": e.created_at,
        }
        for e in rows
    ]


@router.post("/plants/{plant_slug}/entries", status_code=201)
def create_entry(plant_slug: str, payload: EntryCreateIn, db: Session = Depends(get_db)):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_slug))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")

    idem_key = f"entry-create:{plant_slug}:{payload.client_request_id}"
    existing = db.scalar(select(IdempotencyKey).where(IdempotencyKey.key == idem_key))
    if existing:
        body = json.loads(existing.response_body)
        return JSONResponse(status_code=existing.status_code, content=body)

    shift = resolve_shift()
    entry = ShiftEntry(
        plant_id=plant.id,
        author_name=payload.author_name,
        author_token_hash=hash_text(payload.author_token),
        subject=payload.subject,
        body=payload.body,
        shift_id=shift["shift_id"],
        editable_until=shift["editable_until"],
        updated_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()

    append_shift_event(db, entry.id, "EntryCreated", {"subject": payload.subject}, actor_ref=payload.author_name)
    enqueue_outbox(db, "shift_entry", entry.id, "EntryCreated", {"plant_slug": plant_slug, "entry_id": entry.id})

    response = {
        "entry_id": entry.id,
        "editable_until": entry.editable_until.isoformat(),
        "shift_id": entry.shift_id,
    }
    db.add(IdempotencyKey(key=idem_key, scope="entries", response_body=json.dumps(response), status_code=201))
    db.commit()
    return response


@router.get("/entries/{entry_id}")
def get_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(ShiftEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="entry not found")
    if entry.status == "DELETED":
        raise HTTPException(status_code=404, detail="entry not found")

    links = db.scalars(select(FileLink).where(FileLink.scope_type == "entry", FileLink.scope_id == entry_id)).all()
    file_ids = [l.file_id for l in links]
    files = db.scalars(select(DbFile).where(DbFile.id.in_(file_ids))).all() if file_ids else []

    return {
        "entry_id": entry.id,
        "plant_id": entry.plant_id,
        "author_name": entry.author_name,
        "subject": entry.subject,
        "body": entry.body,
        "status": entry.status,
        "editable_until": entry.editable_until,
        "attachments": [
            {
                "attachment_id": f.id,
                "filename_original": f.filename_original,
                "mime": f.mime,
                "size_bytes": f.size_bytes,
                "kind": next((l.kind for l in links if l.file_id == f.id), "FILE"),
            }
            for f in files
        ],
    }


@router.patch("/entries/{entry_id}")
def patch_entry(entry_id: int, payload: EntryPatchIn, db: Session = Depends(get_db)):
    entry = db.get(ShiftEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="entry not found")
    if entry.status == "DELETED":
        raise HTTPException(status_code=404, detail="entry not found")

    if not _can_edit_entry(entry, payload.author_token, payload.author_name):
        raise HTTPException(status_code=403, detail="token mismatch")
    if datetime.now(timezone.utc) > entry.editable_until.astimezone(timezone.utc):
        raise HTTPException(status_code=403, detail="edit window elapsed")

    entry.subject = payload.subject
    entry.body = payload.body
    entry.updated_at = datetime.now(timezone.utc)

    append_shift_event(db, entry.id, "EntryUpdated", {"subject": payload.subject}, actor_ref=payload.author_token)
    enqueue_outbox(db, "shift_entry", entry.id, "EntryUpdated", {"entry_id": entry.id})
    db.commit()
    return {"entry_id": entry.id, "updated_at": entry.updated_at}


@router.post("/entries/{entry_id}/delete")
def delete_entry(entry_id: int, payload: EntryDeleteIn, db: Session = Depends(get_db)):
    entry = db.get(ShiftEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="entry not found")
    if entry.status == "DELETED":
        return {"entry_id": entry.id, "deleted": True, "updated_at": entry.updated_at}

    if not _can_edit_entry(entry, payload.author_token, payload.author_name):
        raise HTTPException(status_code=403, detail="token mismatch")
    if datetime.now(timezone.utc) > entry.editable_until.astimezone(timezone.utc):
        raise HTTPException(status_code=403, detail="edit window elapsed")

    entry.status = "DELETED"
    entry.updated_at = datetime.now(timezone.utc)

    append_shift_event(db, entry.id, "EntryDeleted", {"reason": "author_request"}, actor_ref=payload.author_token)
    enqueue_outbox(db, "shift_entry", entry.id, "EntryDeleted", {"entry_id": entry.id})
    db.commit()
    return {"entry_id": entry.id, "deleted": True, "updated_at": entry.updated_at}


@router.post("/entries/{entry_id}/attachments", status_code=201)
def add_attachment(
    entry_id: int,
    author_token: str = Form(...),
    kind: str = Form("FILE"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    entry = db.get(ShiftEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="entry not found")
    if entry.status == "DELETED":
        raise HTTPException(status_code=404, detail="entry not found")
    if entry.author_token_hash != hash_text(author_token):
        raise HTTPException(status_code=403, detail="token mismatch")

    saved = save_upload(file, settings.files_dir / "entries" / str(entry_id), settings.upload_max_bytes)

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

    link = FileLink(file_id=record.id, scope_type="entry", scope_id=entry_id, kind=kind.upper())
    db.add(link)

    append_shift_event(db, entry.id, "AttachmentAdded", {"file_id": record.id, "kind": kind.upper()}, actor_ref=author_token)
    enqueue_outbox(db, "shift_entry", entry.id, "AttachmentAdded", {"entry_id": entry.id, "file_id": record.id})
    db.commit()

    return {
        "attachment_id": record.id,
        "filename_original": record.filename_original,
        "mime": record.mime,
        "size_bytes": record.size_bytes,
        "kind": kind.upper(),
    }


@router.get("/entries/{entry_id}/attachments/{attachment_id}")
def get_attachment_file(
    entry_id: int,
    attachment_id: int,
    download: bool = Query(False),
    db: Session = Depends(get_db),
):
    _ = db.get(ShiftEntry, entry_id) or (_ for _ in ()).throw(HTTPException(status_code=404, detail="entry not found"))
    link = db.scalar(
        select(FileLink).where(
            FileLink.scope_type == "entry",
            FileLink.scope_id == entry_id,
            FileLink.file_id == attachment_id,
        )
    )
    if not link:
        raise HTTPException(status_code=404, detail="attachment not found")

    file_row = db.get(DbFile, attachment_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="attachment not found")

    path = Path(file_row.path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="file missing")

    media_type = file_row.mime or "application/octet-stream"
    disposition = "attachment" if download else "inline"
    response = FileResponse(path=path, media_type=media_type, filename=file_row.filename_original)
    response.headers["Content-Disposition"] = f'{disposition}; filename="{file_row.filename_original}"'
    return response


@router.get("/entries/{entry_id}/events")
def list_entry_events(entry_id: int, db: Session = Depends(get_db)):
    _ = db.get(ShiftEntry, entry_id) or (_ for _ in ()).throw(HTTPException(status_code=404, detail="entry not found"))
    events = db.scalars(select(ShiftEntryEvent).where(ShiftEntryEvent.entry_id == entry_id).order_by(ShiftEntryEvent.id.asc())).all()
    return [
        {
            "id": e.id,
            "event_type": e.event_type,
            "payload": e.event_payload,
            "actor_ref": e.actor_ref,
            "prev_hash": e.prev_hash,
            "hash": e.hash,
            "created_at": e.created_at,
        }
        for e in events
    ]


@router.post("/entries/{entry_id}/events", status_code=201)
def append_entry_event(entry_id: int, payload: EventIn, db: Session = Depends(get_db)):
    _ = db.get(ShiftEntry, entry_id) or (_ for _ in ()).throw(HTTPException(status_code=404, detail="entry not found"))
    event = append_shift_event(db, entry_id, payload.event_type, payload.payload, actor_ref=payload.actor_ref)
    db.commit()
    db.refresh(event)
    return {
        "id": event.id,
        "event_type": event.event_type,
        "payload": event.event_payload,
        "prev_hash": event.prev_hash,
        "hash": event.hash,
    }
