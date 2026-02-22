from __future__ import annotations

import os
import uuid

import httpx

PLANT_SLUG = os.getenv("PLANT_SLUG", "MS_DEMO_ANLAGE_01")


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

