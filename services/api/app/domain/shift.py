from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
_TEST_NOW: datetime | None = None


class ShiftInfo(dict):
    shift_id: str
    editable_until: datetime


def set_test_now(value: str | datetime | None) -> None:
    global _TEST_NOW
    if value is None:
        _TEST_NOW = None
        return
    if isinstance(value, datetime):
        _TEST_NOW = value
        return
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    _TEST_NOW = parsed


def current_time(now: datetime | None = None) -> datetime:
    if now is not None:
        return now
    if _TEST_NOW is not None:
        return _TEST_NOW
    return datetime.now(BERLIN)


def resolve_shift(now: datetime | None = None) -> ShiftInfo:
    now = current_time(now)
    local_now = now.astimezone(BERLIN)
    day = local_now.date()

    early_start = datetime.combine(day, time(6, 0), BERLIN)
    late_start = datetime.combine(day, time(14, 0), BERLIN)
    night_start = datetime.combine(day, time(22, 0), BERLIN)

    if early_start <= local_now < late_start:
        shift = "EARLY"
        shift_end = late_start
        shift_day = day
    elif late_start <= local_now < night_start:
        shift = "LATE"
        shift_end = night_start
        shift_day = day
    else:
        shift = "NIGHT"
        if local_now >= night_start:
            shift_day = day
            shift_end = datetime.combine(day + timedelta(days=1), time(6, 0), BERLIN)
        else:
            shift_day = day - timedelta(days=1)
            shift_end = datetime.combine(day, time(6, 0), BERLIN)

    editable_until = shift_end + timedelta(minutes=15)
    return ShiftInfo(shift_id=f"{shift_day.isoformat()}-{shift}", editable_until=editable_until)
