from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.models import ShiftEntryEvent, TicketEvent


GENESIS = "GENESIS"


def canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_hash(prev_hash: str, payload: dict[str, Any]) -> str:
    blob = f"{prev_hash}{canonical_json(payload)}"
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def append_shift_event(
    db: Session,
    entry_id: int,
    event_type: str,
    payload: dict[str, Any],
    actor_ref: str,
) -> ShiftEntryEvent:
    prev = db.scalar(select(ShiftEntryEvent).where(ShiftEntryEvent.entry_id == entry_id).order_by(desc(ShiftEntryEvent.id)).limit(1))
    prev_hash = prev.hash if prev else GENESIS
    hash_value = compute_hash(prev_hash, {"event_type": event_type, "payload": payload, "actor_ref": actor_ref})
    event = ShiftEntryEvent(
        entry_id=entry_id,
        event_type=event_type,
        event_payload=payload,
        actor_ref=actor_ref,
        prev_hash=prev_hash,
        hash=hash_value,
    )
    db.add(event)
    return event


def append_ticket_event(
    db: Session,
    ticket_id: int,
    event_type: str,
    payload: dict[str, Any],
    actor_ref: str,
    is_public: bool = True,
) -> TicketEvent:
    prev = db.scalar(select(TicketEvent).where(TicketEvent.ticket_id == ticket_id).order_by(desc(TicketEvent.id)).limit(1))
    prev_hash = prev.hash if prev else GENESIS
    hash_value = compute_hash(prev_hash, {"event_type": event_type, "payload": payload, "actor_ref": actor_ref, "public": is_public})
    event = TicketEvent(
        ticket_id=ticket_id,
        event_type=event_type,
        event_payload=payload,
        actor_ref=actor_ref,
        is_public=is_public,
        prev_hash=prev_hash,
        hash=hash_value,
    )
    db.add(event)
    return event
