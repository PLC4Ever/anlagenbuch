from __future__ import annotations

from helpers import create_entry


def test_api_05_attachment_under_limit(client, author_token):
    entry_id = create_entry(client, author_token)
    files = {"file": ("small.txt", b"hello", "text/plain")}
    data = {"author_token": author_token, "kind": "FILE"}
    r = client.post(f"/api/entries/{entry_id}/attachments", data=data, files=files)
    assert r.status_code == 201
    body = r.json()
    assert body["size_bytes"] == 5


def test_api_06_attachment_50mb_limit(client, author_token):
    entry_id = create_entry(client, author_token)
    payload = b"a" * (50 * 1024 * 1024 + 1)
    files = {"file": ("large.bin", payload, "application/octet-stream")}
    data = {"author_token": author_token, "kind": "FILE"}
    r = client.post(f"/api/entries/{entry_id}/attachments", data=data, files=files)
    assert r.status_code == 413


def test_api_08_screenshot_kind(client, author_token):
    entry_id = create_entry(client, author_token)
    files = {"file": ("shot.png", b"\x89PNG\r\n", "image/png")}
    data = {"author_token": author_token, "kind": "SCREENSHOT"}
    r = client.post(f"/api/entries/{entry_id}/attachments", data=data, files=files)
    assert r.status_code == 201
    assert r.json()["kind"] == "SCREENSHOT"


