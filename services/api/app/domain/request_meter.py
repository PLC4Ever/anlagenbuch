from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
from threading import Lock


_LOCK = Lock()
_REQUEST_TS: deque[datetime] = deque()


def _trim(now: datetime) -> None:
    cutoff = now - timedelta(minutes=1)
    while _REQUEST_TS and _REQUEST_TS[0] < cutoff:
        _REQUEST_TS.popleft()


def record_request(ts: datetime | None = None) -> None:
    now = ts or datetime.now(timezone.utc)
    with _LOCK:
        _REQUEST_TS.append(now)
        _trim(now)


def requests_per_minute(now: datetime | None = None) -> int:
    current = now or datetime.now(timezone.utc)
    with _LOCK:
        _trim(current)
        return len(_REQUEST_TS)
