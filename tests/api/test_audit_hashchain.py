from __future__ import annotations

from app.domain.audit_hashchain import compute_hash

from helpers import create_entry


def test_api_10_hash_chain(client, author_token):
    entry_id = create_entry(client, author_token)

    files = {"file": ("small.txt", b"hello", "text/plain")}
    data = {"author_token": author_token, "kind": "FILE"}
    assert client.post(f"/api/entries/{entry_id}/attachments", data=data, files=files).status_code == 201

    assert (
        client.patch(
            f"/api/entries/{entry_id}",
            json={
                "client_request_id": "req-upd-1",
                "author_token": author_token,
                "subject": "Updated Subject",
                "body": "Updated body",
            },
        ).status_code
        == 200
    )

    r = client.get(f"/api/entries/{entry_id}/events")
    assert r.status_code == 200
    events = r.json()
    assert len(events) >= 3
    assert events[0]["prev_hash"] == "GENESIS"

    prev_hash = "GENESIS"
    for event in events:
        payload = {
            "event_type": event["event_type"],
            "payload": event["payload"],
            "actor_ref": event["actor_ref"],
        }
        assert event["prev_hash"] == prev_hash
        expected = compute_hash(prev_hash, payload)
        assert event["hash"] == expected
        prev_hash = event["hash"]


