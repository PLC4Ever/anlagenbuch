from __future__ import annotations

import time

from app.db.session import SessionLocal
from app.domain.outbox import process_outbox_once


def run_forever(interval_seconds: int = 5) -> None:
    while True:
        with SessionLocal() as db:
            process_outbox_once(db)
        time.sleep(interval_seconds)


if __name__ == "__main__":
    run_forever()
