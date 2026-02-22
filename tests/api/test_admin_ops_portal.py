from __future__ import annotations

import uuid

from helpers import create_ticket


def test_admin_module_settings_read_write(admin_client):
    get_r = admin_client.get("/api/admin/module-settings")
    assert get_r.status_code == 200
    body = get_r.json()
    assert "anlagenbuch" in body
    assert "tickets" in body
    assert "reporting" in body

    patch_r = admin_client.patch(
        "/api/admin/module-settings",
        json={"tickets": {"public_reply_enabled": True, "auto_close_policy_days": 10}},
    )
    assert patch_r.status_code == 200
    assert patch_r.json()["tickets"]["auto_close_policy_days"] == 10


def test_admin_areas_crud_like(admin_client):
    code = f"QA{uuid.uuid4().hex[:4]}".upper()

    create_r = admin_client.post("/api/admin/areas", json={"code": code, "name": "Quality Area"})
    assert create_r.status_code == 201

    list_r = admin_client.get("/api/admin/areas")
    assert list_r.status_code == 200
    assert any(row["code"] == code for row in list_r.json())

    patch_r = admin_client.patch(f"/api/admin/areas/{code}", json={"name": "Quality Area Updated"})
    assert patch_r.status_code == 200
    assert patch_r.json()["name"] == "Quality Area Updated"


def test_admin_users_roles_reset_delete(admin_client):
    username = f"qa_user_{uuid.uuid4().hex[:6]}"

    create_r = admin_client.post(
        "/api/admin/users",
        json={
            "username": username,
            "password": "qa_user_password_123",
            "roles": ["Agent"],
            "force_password_change": True,
        },
    )
    assert create_r.status_code == 201
    assert create_r.json()["username"] == username

    roles_r = admin_client.patch(
        f"/api/admin/users/{username}/roles",
        json={"roles": ["Dispatcher"]},
    )
    assert roles_r.status_code == 200
    assert "Dispatcher" in roles_r.json()["roles"]

    reset_r = admin_client.post(
        f"/api/admin/users/{username}/reset-password",
        json={"new_password": "qa_user_password_456", "force_password_change": True},
    )
    assert reset_r.status_code == 200

    list_roles = admin_client.get("/api/admin/roles")
    assert list_roles.status_code == 200
    assert any(row["name"] == "Admin" for row in list_roles.json())

    delete_r = admin_client.delete(f"/api/admin/users/{username}")
    assert delete_r.status_code == 200


def test_reporting_extended_endpoints(admin_client):
    schedule = admin_client.post(
        "/api/reporting/schedules",
        json={
            "name": "portal schedule",
            "cron_type": "weekly",
            "timezone": "Europe/Berlin",
            "plant_slug": "MS_DEMO_ANLAGE_01",
            "formats": ["csv"],
            "recipients": ["ops@example.local"],
        },
    )
    assert schedule.status_code == 201
    schedule_id = schedule.json()["id"]

    patch = admin_client.patch(f"/api/reporting/schedules/{schedule_id}", json={"enabled": False})
    assert patch.status_code == 200
    assert patch.json()["enabled"] is False

    run_now = admin_client.post(f"/api/reporting/schedules/{schedule_id}/run-now")
    assert run_now.status_code == 201

    runs = admin_client.get("/api/reporting/runs")
    assert runs.status_code == 200
    assert isinstance(runs.json(), list)

    deliveries = admin_client.get("/api/reporting/deliveries")
    assert deliveries.status_code == 200
    assert isinstance(deliveries.json(), list)

    delete_r = admin_client.delete(f"/api/reporting/schedules/{schedule_id}")
    assert delete_r.status_code == 200


def test_ops_extended_endpoints(admin_client):
    created = create_ticket(admin_client, subject="Ops portal seed")
    assert created["ticket_id"] > 0

    status = admin_client.get("/api/ops/status")
    assert status.status_code == 200

    errors = admin_client.get("/api/ops/errors")
    assert errors.status_code == 200
    assert isinstance(errors.json(), list)

    deliveries = admin_client.get("/api/ops/deliveries")
    assert deliveries.status_code == 200
    assert isinstance(deliveries.json(), list)

    dead = admin_client.get("/api/ops/dead-letters")
    assert dead.status_code == 200
    assert isinstance(dead.json(), list)

    tail = admin_client.get("/api/ops/logs/tail", params={"stream": "app", "lines": 40})
    assert tail.status_code == 200
    assert "lines" in tail.json()

    traces = admin_client.get("/api/ops/traces")
    assert traces.status_code == 200
    assert isinstance(traces.json(), list)

    status_payload = status.json()
    assert "system" in status_payload
    assert "requests_per_minute" in status_payload["system"]
    assert "email_server" in status_payload


def test_admin_email_settings_and_connection(admin_client):
    get_r = admin_client.get("/api/admin/email-settings")
    assert get_r.status_code == 200
    assert "host" in get_r.json()

    patch_r = admin_client.patch(
        "/api/admin/email-settings",
        json={
            "enabled": True,
            "host": "mailpit",
            "port": 1025,
            "security": "none",
            "username": "",
            "password": "",
            "from_address": "reports@example.local",
            "timeout_seconds": 10,
        },
    )
    assert patch_r.status_code == 200
    assert patch_r.json()["host"] == "mailpit"

    test_conn = admin_client.post("/api/admin/email-settings/test", json={"send_test_mail": False})
    assert test_conn.status_code == 200
    assert test_conn.json()["ok"] is True


def test_admin_ticket_groups_crud_and_members(admin_client):
    code = f"TG{uuid.uuid4().hex[:5]}".upper()
    username = f"qa_agent_{uuid.uuid4().hex[:6]}"

    user_create = admin_client.post(
        "/api/admin/users",
        json={
            "username": username,
            "password": "qa_user_password_123",
            "roles": ["Agent"],
            "force_password_change": True,
        },
    )
    assert user_create.status_code == 201

    create_group = admin_client.post(
        "/api/admin/ticket-groups",
        json={"code": code, "name": "Qualitaetsgruppe", "active": True},
    )
    assert create_group.status_code == 201
    gid = create_group.json()["id"]

    members = admin_client.patch(
        f"/api/admin/ticket-groups/{gid}/members",
        json={"usernames": [username]},
    )
    assert members.status_code == 200
    assert username in members.json()["members"]

    listed = admin_client.get("/api/admin/ticket-groups")
    assert listed.status_code == 200
    assert any(row["id"] == gid for row in listed.json())

    patched = admin_client.patch(
        f"/api/admin/ticket-groups/{gid}",
        json={"active": False},
    )
    assert patched.status_code == 200
    assert patched.json()["active"] is False

    delete_user = admin_client.delete(f"/api/admin/users/{username}")
    assert delete_user.status_code == 200

    delete_group = admin_client.delete(f"/api/admin/ticket-groups/{gid}")
    assert delete_group.status_code == 200


def test_admin_user_settings_patch_department_and_groups(admin_client):
    username = f"qa_settings_{uuid.uuid4().hex[:6]}"
    group_code = f"TG{uuid.uuid4().hex[:5]}".upper()

    areas = admin_client.get("/api/admin/areas")
    assert areas.status_code == 200
    area_code = areas.json()[0]["code"]
    area_code_2 = areas.json()[1]["code"] if len(areas.json()) > 1 else area_code

    user_create = admin_client.post(
        "/api/admin/users",
        json={
            "username": username,
            "password": "qa_user_password_123",
            "roles": ["Agent"],
            "force_password_change": True,
        },
    )
    assert user_create.status_code == 201

    group_create = admin_client.post(
        "/api/admin/ticket-groups",
        json={"code": group_code, "name": "Settings Gruppe", "active": True},
    )
    assert group_create.status_code == 201
    group_id = group_create.json()["id"]

    patched = admin_client.patch(
        f"/api/admin/users/{username}/settings",
        json={
            "roles": ["Agent"],
            "departments": [area_code, area_code_2],
            "group_ids": [group_id],
        },
    )
    assert patched.status_code == 200
    body = patched.json()
    assert area_code in body["departments"]
    assert area_code_2 in body["departments"]
    assert "Agent" in body["roles"]
    assert any(entry["id"] == group_id for entry in body["ticket_groups"])

    wrong = admin_client.patch(
        f"/api/admin/users/{username}/settings",
        json={
            "roles": ["Dispatcher"],
            "group_ids": [group_id],
        },
    )
    assert wrong.status_code == 400

    reset = admin_client.patch(
        f"/api/admin/users/{username}/settings",
        json={
            "roles": ["Dispatcher"],
            "departments": [],
            "group_ids": [],
        },
    )
    assert reset.status_code == 200
    reset_body = reset.json()
    assert "Dispatcher" in reset_body["roles"]
    assert reset_body["departments"] == []
    assert reset_body["ticket_groups"] == []

    delete_user = admin_client.delete(f"/api/admin/users/{username}")
    assert delete_user.status_code == 200
    delete_group = admin_client.delete(f"/api/admin/ticket-groups/{group_id}")
    assert delete_group.status_code == 200

