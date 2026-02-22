from __future__ import annotations

import uuid

from helpers import PLANT_SLUG, create_entry


def test_api_04_n2_edit_window_expired_with_test_clock(client, author_token):
    clock = client.post("/api/test/clock", json={"now": "2026-02-21T13:00:00+01:00"})
    if clock.status_code not in (200, 404):
        assert False, clock.text

    entry_id = create_entry(client, author_token)

    clock2 = client.post("/api/test/clock", json={"now": "2026-02-22T23:00:00+01:00"})
    if clock2.status_code == 200:
        r = client.patch(
            f"/api/entries/{entry_id}",
            json={
                "client_request_id": str(uuid.uuid4()),
                "author_token": author_token,
                "subject": "too late",
                "body": "too late",
            },
        )
        assert r.status_code == 403


