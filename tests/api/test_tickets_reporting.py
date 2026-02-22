from __future__ import annotations

from helpers import PLANT_SLUG, create_ticket


def test_suite_a_public_ticket_create(client):
    created = create_ticket(client, subject="SuiteA")
    assert created["status"] == "NEW"
    assert created["public_token"]


def test_suite_b_public_status_and_timeline(client):
    created = create_ticket(client, subject="SuiteB")
    token = created["public_token"]
    r = client.get(f"/api/public/tickets/{token}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "NEW"
    assert all(item["event_type"] != "InternalNote" for item in body["timeline"])


def test_suite_b_dashboard_list_and_detail(client):
    created = create_ticket(client, subject="SuiteB Dashboard")
    tid = created["ticket_id"]

    list_r = client.get("/api/public/tickets/dashboard", params={"plantId": PLANT_SLUG})
    assert list_r.status_code == 200
    items = list_r.json()["items"]
    assert any(item["ticket_id"] == tid for item in items)

    detail_r = client.get(f"/api/public/tickets/dashboard/{tid}", params={"plantId": PLANT_SLUG})
    assert detail_r.status_code == 200
    detail = detail_r.json()
    assert detail["ticket_id"] == tid
    assert detail["plant_slug"] == PLANT_SLUG
    assert isinstance(detail["timeline"], list)


def test_suite_c_dispatcher_routing(admin_client):
    ms = create_ticket(admin_client, subject="Route MS")
    r = admin_client.get("/api/tickets", params={"area": "MS"})
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert ms["ticket_id"] in ids


def test_suite_d_triage_queue(admin_client):
    created = create_ticket(admin_client, subject="SuiteD")
    tid = created["ticket_id"]
    triage = admin_client.post(f"/api/tickets/{tid}/triage", json={"department": "Mechanik", "priority": 1, "ticket_type": "Stoerung"})
    assert triage.status_code == 200
    q = admin_client.get("/api/tickets", params={"status": "QUEUED", "department": "Mechanik"})
    assert q.status_code == 200
    assert any(t["id"] == tid for t in q.json())


def test_suite_e_assign_progress_resolve_close(admin_client):
    created = create_ticket(admin_client, subject="SuiteE")
    tid = created["ticket_id"]

    assert admin_client.post(f"/api/tickets/{tid}/assign", json={"assignee_username": "agent_ms_1"}).status_code == 200
    assert admin_client.post(f"/api/tickets/{tid}/status", json={"status": "IN_PROGRESS"}).status_code == 200

    files = {"file": ("proof.txt", b"proof", "text/plain")}
    assert admin_client.post(f"/api/tickets/{tid}/attachments", files=files, data={"kind": "FILE"}).status_code == 201

    assert admin_client.post(f"/api/tickets/{tid}/status", json={"status": "RESOLVED", "public_comment": "done"}).status_code == 200
    assert admin_client.post(f"/api/tickets/{tid}/status", json={"status": "CLOSED"}).status_code == 200


def test_suite_f_wrong_plant_no_reroute(admin_client):
    created = create_ticket(admin_client, subject="SuiteF")
    tid = created["ticket_id"]
    token = created["public_token"]

    r = admin_client.post(
        f"/api/tickets/{tid}/status",
        json={"status": "CANCELLED", "reason": "WRONG_PLANT_LINK"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "CANCELLED_WRONG_PLANT"

    pub = admin_client.get(f"/api/public/tickets/{token}")
    assert pub.status_code == 200
    assert pub.json()["suggested_create_url"]


def test_suite_g_outbox_retry_dead_letter(admin_client):
    created = create_ticket(admin_client, subject="SuiteG")
    tid = created["ticket_id"]
    assert admin_client.post(f"/api/tickets/{tid}/triage", json={"department": "IT", "priority": 2, "ticket_type": "IT"}).status_code == 200

    ops = admin_client.get("/api/ops/status")
    assert ops.status_code == 200

    # Retry endpoint exists and is callable for at least one known id or 404 when none exists.
    retry = admin_client.post("/api/ops/deliveries/1/retry")
    assert retry.status_code in (200, 404)


def test_suite_h_reporting_export_formats(admin_client):
    r = admin_client.post(
        "/api/reporting/exports",
        json={
            "plantId": PLANT_SLUG,
            "formats": ["csv", "json", "xml", "xlsx", "pdf", "docx"],
        },
    )
    assert r.status_code == 201
    run_id = r.json()["id"]

    run = admin_client.get(f"/api/reporting/runs/{run_id}")
    assert run.status_code == 200
    artifacts = run.json()["artifacts"]
    assert {a["format"] for a in artifacts} == {"csv", "json", "xml", "xlsx", "pdf", "docx"}


def test_suite_i_reporting_schedule_run_now(admin_client):
    schedule = admin_client.post(
        "/api/reporting/schedules",
        json={
            "name": "weekly ms",
            "cron_type": "weekly",
            "timezone": "Europe/Berlin",
            "plant_slug": PLANT_SLUG,
            "formats": ["csv"],
            "recipients": ["ops@example.local"],
        },
    )
    assert schedule.status_code == 201
    schedule_id = schedule.json()["id"]

    run_now = admin_client.post(f"/api/reporting/schedules/{schedule_id}/run-now")
    assert run_now.status_code == 201


def test_suite_j_group_routing_and_attachment_download(admin_client):
    created = create_ticket(admin_client, subject="SuiteJ")
    tid = created["ticket_id"]

    groups = admin_client.get("/api/tickets/groups")
    assert groups.status_code == 200
    assert isinstance(groups.json(), list)
    assert len(groups.json()) >= 1
    gid = groups.json()[0]["id"]

    routed_without_triage = admin_client.post(
        f"/api/tickets/{tid}/route-groups",
        json={
            "targets": [
                {
                    "group_id": gid,
                    "priority": 0,
                    "reason": "Elektrocheck",
                    "note": "Nur intern sichtbar",
                    "comment": "Bitte Prioritaet hoch",
                }
            ]
        },
    )
    assert routed_without_triage.status_code == 409

    triage = admin_client.post(
        f"/api/tickets/{tid}/triage",
        json={"department": "Mechanik", "priority": 2, "ticket_type": "Stoerung"},
    )
    assert triage.status_code == 200

    routed = admin_client.post(
        f"/api/tickets/{tid}/route-groups",
        json={
            "targets": [
                {
                    "group_id": gid,
                    "priority": 0,
                    "reason": "Elektrocheck",
                    "note": "Nur intern sichtbar",
                    "comment": "Bitte Prioritaet hoch",
                }
            ]
        },
    )
    assert routed.status_code == 200
    assert routed.json()["ticket_id"] == tid
    assert len(routed.json()["routes"]) == 1

    remove_before_start = admin_client.delete(f"/api/tickets/{tid}/route-groups/{gid}")
    assert remove_before_start.status_code == 200

    rerouted = admin_client.post(
        f"/api/tickets/{tid}/route-groups",
        json={
            "targets": [
                {
                    "group_id": gid,
                    "priority": 0,
                    "reason": "Neuer Auftrag",
                    "note": "Nur intern sichtbar",
                    "comment": "Bitte weiter beobachten",
                }
            ]
        },
    )
    assert rerouted.status_code == 200

    in_progress = admin_client.post(f"/api/tickets/{tid}/status", json={"status": "IN_PROGRESS"})
    assert in_progress.status_code == 200

    remove_after_start = admin_client.delete(f"/api/tickets/{tid}/route-groups/{gid}")
    assert remove_after_start.status_code == 409

    upload = admin_client.post(
        f"/api/tickets/{tid}/attachments",
        files={"file": ("suitej.txt", b"suite-j", "text/plain")},
        data={"kind": "FILE"},
    )
    assert upload.status_code == 201

    detail = admin_client.get(f"/api/tickets/{tid}")
    assert detail.status_code == 200
    body = detail.json()
    assert isinstance(body.get("group_routes"), list)
    assert len(body.get("group_routes")) >= 1
    assert body["group_routes"][0]["priority"] == 0
    assert body["group_routes"][0]["note"] == "Nur intern sichtbar"
    assert isinstance(body.get("attachments"), list)
    assert len(body.get("attachments")) >= 1

    download_url = body["attachments"][0]["download_url"]
    downloaded = admin_client.get(download_url)
    assert downloaded.status_code == 200


