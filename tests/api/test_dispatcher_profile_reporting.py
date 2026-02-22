import os
import uuid
import io
import zipfile

import httpx
from sqlalchemy import select

from app.db.models import User
from app.db.session import SessionLocal
from app.deps import hash_password
from helpers import PLANT_SLUG, create_ticket


BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8080")
DISPATCHER_USER = "dispatcher_ms"
DISPATCHER_DEFAULT_PASSWORD = "dispatcher_demo_pw_change"


def _reset_dispatcher_password(password: str) -> None:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == DISPATCHER_USER))
        assert user is not None
        user.password_hash = hash_password(password)
        user.force_password_change = True
        db.commit()


def _login_dispatcher(password: str = DISPATCHER_DEFAULT_PASSWORD) -> httpx.Client:
    client = httpx.Client(base_url=BASE_URL, timeout=30.0, follow_redirects=True)
    login = client.post("/api/auth/login", json={"username": DISPATCHER_USER, "password": password})
    assert login.status_code == 200, login.text
    return client


def test_dispatcher_profile_email_and_password_change():
    _reset_dispatcher_password(DISPATCHER_DEFAULT_PASSWORD)
    client = _login_dispatcher()
    new_password = "dispatcher_ms_new_pw_123"
    try:
        profile = client.get("/api/auth/profile")
        assert profile.status_code == 200
        assert profile.json()["username"] == DISPATCHER_USER

        patch = client.patch("/api/auth/profile", json={"email": "dispatcher.ms@example.local"})
        assert patch.status_code == 200
        assert patch.json()["email"] == "dispatcher.ms@example.local"

        me = client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == "dispatcher.ms@example.local"

        pw = client.post("/api/auth/change-password", json={"new_password": new_password})
        assert pw.status_code == 200

        assert client.post("/api/auth/logout").status_code == 200
        relogin = client.post("/api/auth/login", json={"username": DISPATCHER_USER, "password": new_password})
        assert relogin.status_code == 200
    finally:
        client.close()
        _reset_dispatcher_password(DISPATCHER_DEFAULT_PASSWORD)


def test_dispatcher_reporting_preview_and_export():
    _reset_dispatcher_password(DISPATCHER_DEFAULT_PASSWORD)
    client = _login_dispatcher()
    try:
        create_ticket(client, subject=f"Dispatcher Report {uuid.uuid4().hex[:6]}")

        preview = client.post(
            "/api/reporting/preview",
            json={
                "plantId": PLANT_SLUG,
                "report_kind": "tickets",
                "limit": 40,
                "formats": ["csv"],
            },
        )
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert "summary" in body
        assert "rows" in body
        assert isinstance(body["rows"], list)

        export = client.post(
            "/api/reporting/exports",
            json={
                "plantId": PLANT_SLUG,
                "report_kind": "tickets",
                "formats": ["csv", "json", "xml", "xlsx", "pdf", "docx"],
            },
        )
        assert export.status_code == 201, export.text
        run_id = export.json()["id"]

        run = client.get(f"/api/reporting/runs/{run_id}")
        assert run.status_code == 200
        artifacts = run.json()["artifacts"]
        assert {a["format"] for a in artifacts} == {"csv", "json", "xml", "xlsx", "pdf", "docx"}

        by_format = {a["format"]: a["artifact_id"] for a in artifacts}

        pdf = client.get(f"/api/reporting/runs/{run_id}/artifacts/{by_format['pdf']}")
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")

        xlsx = client.get(f"/api/reporting/runs/{run_id}/artifacts/{by_format['xlsx']}")
        assert xlsx.status_code == 200
        with zipfile.ZipFile(io.BytesIO(xlsx.content)) as zf:
            assert "xl/workbook.xml" in zf.namelist()

        docx = client.get(f"/api/reporting/runs/{run_id}/artifacts/{by_format['docx']}")
        assert docx.status_code == 200
        with zipfile.ZipFile(io.BytesIO(docx.content)) as zf:
            assert "word/document.xml" in zf.namelist()
    finally:
        client.close()


def test_dispatcher_reporting_schedule_crud_and_run_now():
    _reset_dispatcher_password(DISPATCHER_DEFAULT_PASSWORD)
    client = _login_dispatcher()
    try:
        name = f"dispatcher schedule {uuid.uuid4().hex[:6]}"
        create_schedule = client.post(
            "/api/reporting/schedules",
            json={
                "name": name,
                "cron_type": "daily",
                "timezone": "Europe/Berlin",
                "plant_slug": PLANT_SLUG,
                "department": "Mechanik",
                "report_kind": "tickets",
                "formats": ["pdf", "csv"],
                "recipients": ["dispatcher.ms@example.local"],
            },
        )
        assert create_schedule.status_code == 201, create_schedule.text
        schedule_id = create_schedule.json()["id"]

        listed = client.get("/api/reporting/schedules")
        assert listed.status_code == 200
        row = next((x for x in listed.json() if x["id"] == schedule_id), None)
        assert row is not None
        assert row["department"] == "Mechanik"
        assert row["report_kind"] == "tickets"

        patch = client.patch(
            f"/api/reporting/schedules/{schedule_id}",
            json={"enabled": False, "department": "Elektrik", "report_kind": "kombiniert"},
        )
        assert patch.status_code == 200
        assert patch.json()["enabled"] is False
        assert patch.json()["department"] == "Elektrik"
        assert patch.json()["report_kind"] == "kombiniert"

        run_now = client.post(f"/api/reporting/schedules/{schedule_id}/run-now")
        assert run_now.status_code == 201

        delete = client.delete(f"/api/reporting/schedules/{schedule_id}")
        assert delete.status_code == 200
    finally:
        client.close()

