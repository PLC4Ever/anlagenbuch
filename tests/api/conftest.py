from __future__ import annotations

import os
import uuid

import httpx
import pytest

from sqlalchemy import select

from app.db.models import User
from app.db.session import SessionLocal
from app.deps import hash_password


BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8080")
PLANT_SLUG = os.getenv("PLANT_SLUG", "MS_DEMO_ANLAGE_01")


@pytest.fixture(scope="session")
def client() -> httpx.Client:
    with httpx.Client(base_url=BASE_URL, timeout=30.0, follow_redirects=True) as c:
        yield c


@pytest.fixture(scope="session")
def admin_client(client: httpx.Client) -> httpx.Client:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "admin_1"))
        if user:
            user.password_hash = hash_password("admin_demo_pw_change")
            user.force_password_change = True
            db.commit()
    resp = client.post("/api/auth/login", json={"username": "admin_1", "password": "admin_demo_pw_change"})
    assert resp.status_code == 200, resp.text
    return client


@pytest.fixture()
def author_token() -> str:
    return str(uuid.uuid4())


def create_entry(client: httpx.Client, author_token: str, subject: str = "Test Subject") -> int:
    payload = {
        "client_request_id": str(uuid.uuid4()),
        "author_name": "Testfahrer",
        "author_token": author_token,
        "subject": subject,
        "body": "Text",
    }
    resp = client.post(f"/api/plants/{PLANT_SLUG}/entries", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["entry_id"]


def create_ticket(client: httpx.Client, subject: str = "Ticket Subject") -> dict:
    payload = {"requester_name": "Requester", "subject": subject, "description": "desc"}
    resp = client.post("/api/public/tickets", params={"plantId": PLANT_SLUG}, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()

