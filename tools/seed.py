from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API_PATH = ROOT / "services" / "api"
if str(API_PATH) not in sys.path:
    sys.path.insert(0, str(API_PATH))

from app.db.session import SessionLocal
from app.seed_data import seed


def main() -> None:
    with SessionLocal() as db:
        seed(db)
    print("seed complete")


if __name__ == "__main__":
    main()
