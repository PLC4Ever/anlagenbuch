from __future__ import annotations

from datetime import datetime, timedelta


def due_in_hours(priority_rank: int | None) -> int:
    if priority_rank is None:
        return 24
    mapping = {1: 2, 2: 8, 3: 24, 4: 72}
    return mapping.get(priority_rank, 24)


def compute_sla_deadline(created_at: datetime, priority_rank: int | None) -> datetime:
    return created_at + timedelta(hours=due_in_hours(priority_rank))
