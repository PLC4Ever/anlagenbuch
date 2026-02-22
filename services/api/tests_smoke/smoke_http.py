from __future__ import annotations

import os
import uuid
import json
import urllib.request
import urllib.error
from urllib.parse import urlencode

BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8080")


def _request(
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
    form_body: dict | None = None,
    file_tuple: tuple[str, bytes, str] | None = None,
    headers: dict | None = None,
    cookies: dict | None = None,
):
    body = None
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)

    if cookies:
        req_headers["Cookie"] = "; ".join([f"{k}={v}" for k, v in cookies.items()])

    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    elif file_tuple is not None and form_body is not None:
        boundary = "----SmokeBoundary7MA4YWxkTrZu0gW"
        req_headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        file_name, file_data, mime = file_tuple
        lines = []
        for k, v in form_body.items():
            lines.extend(
                [
                    f"--{boundary}",
                    f'Content-Disposition: form-data; name="{k}"',
                    "",
                    str(v),
                ]
            )
        lines.extend(
            [
                f"--{boundary}",
                f'Content-Disposition: form-data; name="file"; filename="{file_name}"',
                f"Content-Type: {mime}",
                "",
            ]
        )
        payload = "\r\n".join(lines).encode("utf-8") + b"\r\n" + file_data + b"\r\n" + f"--{boundary}--\r\n".encode("utf-8")
        body = payload
    elif form_body is not None:
        body = urlencode(form_body).encode("utf-8")
        req_headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.status
            content = resp.read()
            resp_headers = dict(resp.headers.items())
    except urllib.error.HTTPError as exc:
        status = exc.code
        content = exc.read()
        resp_headers = dict(exc.headers.items()) if exc.headers else {}
    return status, content, resp_headers


def main() -> None:
    cookies: dict[str, str] = {}

    def check(status: int, expected: int, label: str, body: bytes) -> None:
        if status != expected:
            raise SystemExit(f"{label} failed: {status} {body[:400]!r}")

    status, body, _ = _request("GET", "/healthz")
    check(status, 200, "healthz", body)
    status, body, _ = _request("GET", "/readyz")
    check(status, 200, "readyz", body)

    plant_slug = "MS_DEMO_ANLAGE_01"
    status, body, _ = _request("GET", f"/api/plants/{plant_slug}")
    check(status, 200, "plant lookup", body)

    author_token = str(uuid.uuid4())
    create_payload = {
        "client_request_id": str(uuid.uuid4()),
        "author_name": "Smoke Fahrer",
        "author_token": author_token,
        "subject": "Smoke Entry",
        "body": "Smoke body",
    }
    status, body, _ = _request("POST", f"/api/plants/{plant_slug}/entries", json_body=create_payload)
    check(status, 201, "entry create", body)
    entry_id = json.loads(body.decode("utf-8"))["entry_id"]

    status, body, _ = _request("GET", f"/api/plants/{plant_slug}/entries")
    check(status, 200, "entry list", body)

    status, body, _ = _request(
        "POST",
        f"/api/entries/{entry_id}/attachments",
        form_body={"author_token": author_token, "kind": "FILE"},
        file_tuple=("smoke.txt", b"hello", "text/plain"),
    )
    check(status, 201, "entry attachment", body)

    ticket_payload = {"requester_name": "Smoke", "subject": "Smoke Ticket", "description": "Ticket body"}
    status, body, _ = _request(
        "POST",
        f"/api/public/tickets?{urlencode({'plantId': plant_slug})}",
        json_body=ticket_payload,
    )
    check(status, 201, "ticket create", body)
    token = json.loads(body.decode("utf-8"))["public_token"]

    status, body, _ = _request("GET", f"/api/public/tickets/{token}")
    check(status, 200, "ticket status", body)

    status, body, headers = _request(
        "POST",
        "/api/auth/login",
        json_body={"username": "admin_1", "password": "admin_demo_pw_change"},
    )
    check(status, 200, "admin login", body)

    set_cookie = headers.get("Set-Cookie", "")
    if set_cookie:
        cookie_token = set_cookie.split(";", 1)[0]
        key, value = cookie_token.split("=", 1)
        cookies[key] = value

    status, body, _ = _request("GET", "/api/ops/status", cookies=cookies)
    check(status, 200, "ops status", body)
    print("SMOKE_OK")


if __name__ == "__main__":
    main()

