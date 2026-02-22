from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import DeadLetterDelivery, Delivery, OutboxEvent
from app.settings import get_settings


def enqueue_outbox(db: Session, aggregate_type: str, aggregate_id: int, event_type: str, payload: dict, target: str = "local://noop") -> OutboxEvent:
    evt = OutboxEvent(
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        event_type=event_type,
        payload=payload,
        status="PENDING",
    )
    db.add(evt)
    db.flush()

    delivery = Delivery(outbox_event_id=evt.id, target=target, status="PENDING", attempts=0)
    db.add(delivery)
    return evt


def process_outbox_once(db: Session) -> dict[str, int]:
    settings = get_settings()
    processed = 0
    failed = 0

    pending_deliveries = db.scalars(select(Delivery).where(Delivery.status.in_(["PENDING", "FAILED_RETRY"])).limit(100)).all()
    for delivery in pending_deliveries:
        processed += 1
        delivery.attempts += 1
        delivery.last_attempt_at = datetime.now(timezone.utc)

        if "fail" in delivery.target.lower():
            delivery.status = "FAILED_RETRY"
            delivery.last_error = "simulated target failure"
            failed += 1
            if delivery.attempts >= settings.outbox_max_attempts:
                delivery.status = "DEAD"
                dead = DeadLetterDelivery(
                    delivery_id=delivery.id,
                    target=delivery.target,
                    payload={"outbox_event_id": delivery.outbox_event_id},
                    last_error=delivery.last_error,
                )
                db.add(dead)
            continue

        delivery.status = "DELIVERED"
        delivery.last_error = None
        event = db.get(OutboxEvent, delivery.outbox_event_id)
        if event:
            event.status = "PUBLISHED"
            event.published_at = datetime.now(timezone.utc)

    db.commit()
    return {"processed": processed, "failed": failed}
