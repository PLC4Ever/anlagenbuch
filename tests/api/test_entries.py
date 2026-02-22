from __future__ import annotations

import uuid

from helpers import PLANT_SLUG, create_entry


def test_api_01_plant_lookup(client):
    r = client.get(f"/api/plants/{PLANT_SLUG}")
    assert r.status_code == 200
    body = r.json()
    assert body["plant_slug"] == PLANT_SLUG
    assert body["upload_rules"]["max_file_size_mb"] == 50


def test_api_01_n_unknown_plant(client):
    r = client.get("/api/plants/UNKNOWN_PLANT")
    assert r.status_code == 404


def test_api_02_create_entry_and_read(client, author_token):
    entry_id = create_entry(client, author_token)
    r = client.get(f"/api/entries/{entry_id}")
    assert r.status_code == 200
    assert r.json()["entry_id"] == entry_id


def test_api_03_validation_missing_subject(client, author_token):
    payload = {
        "client_request_id": str(uuid.uuid4()),
        "author_name": "x",
        "author_token": author_token,
        "subject": "",
        "body": "text",
    }
    r = client.post(f"/api/plants/{PLANT_SLUG}/entries", json=payload)
    assert r.status_code in (400, 422)


def test_api_04_patch_entry_happy(client, author_token):
    entry_id = create_entry(client, author_token)
    r = client.patch(
        f"/api/entries/{entry_id}",
        json={
            "client_request_id": str(uuid.uuid4()),
            "author_token": author_token,
            "subject": "updated",
            "body": "updated body",
        },
    )
    assert r.status_code == 200


def test_api_04_n1_patch_token_mismatch(client, author_token):
    entry_id = create_entry(client, author_token)
    r = client.patch(
        f"/api/entries/{entry_id}",
        json={
            "client_request_id": str(uuid.uuid4()),
            "author_token": str(uuid.uuid4()),
            "subject": "bad",
            "body": "bad",
        },
    )
    assert r.status_code == 403


def test_api_09_list_search(client, author_token):
    create_entry(client, author_token, subject="FindMeSubject")
    r = client.get(f"/api/plants/{PLANT_SLUG}/entries", params={"q": "FindMeSubject"})
    assert r.status_code == 200
    subjects = [x["subject"] for x in r.json()]
    assert any("FindMeSubject" in s for s in subjects)


def test_api_11_idempotency(client, author_token):
    req_id = str(uuid.uuid4())
    payload = {
        "client_request_id": req_id,
        "author_name": "Idem",
        "author_token": author_token,
        "subject": "idem",
        "body": "idem",
    }
    r1 = client.post(f"/api/plants/{PLANT_SLUG}/entries", json=payload)
    r2 = client.post(f"/api/plants/{PLANT_SLUG}/entries", json=payload)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["entry_id"] == r2.json()["entry_id"]


