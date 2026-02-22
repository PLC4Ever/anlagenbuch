from __future__ import annotations

import json
import socket
import ssl
from email.message import EmailMessage
from pathlib import Path
import smtplib

from app.settings import get_settings


DEFAULT_EMAIL_SETTINGS = {
    "enabled": False,
    "host": "smtp.office365.com",
    "port": 587,
    "security": "starttls",
    "username": "",
    "password": "",
    "from_address": "",
    "timeout_seconds": 10,
}
SECURITY_VALUES = {"none", "starttls", "ssl"}


def _settings_path() -> Path:
    settings = get_settings()
    settings.config_dir.mkdir(parents=True, exist_ok=True)
    return settings.config_dir / "email_settings.json"


def load_email_settings() -> dict:
    path = _settings_path()
    if not path.exists():
        return dict(DEFAULT_EMAIL_SETTINGS)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return dict(DEFAULT_EMAIL_SETTINGS)
    merged = dict(DEFAULT_EMAIL_SETTINGS)
    if isinstance(raw, dict):
        for key in merged.keys():
            if key in raw:
                merged[key] = raw[key]
    merged["enabled"] = bool(merged.get("enabled"))
    merged["host"] = str(merged.get("host") or "").strip()
    merged["port"] = int(merged.get("port") or DEFAULT_EMAIL_SETTINGS["port"])
    security = str(merged.get("security") or "starttls").strip().lower()
    merged["security"] = security if security in SECURITY_VALUES else "starttls"
    merged["username"] = str(merged.get("username") or "").strip()
    merged["password"] = str(merged.get("password") or "")
    merged["from_address"] = str(merged.get("from_address") or "").strip()
    merged["timeout_seconds"] = max(3, min(60, int(merged.get("timeout_seconds") or 10)))
    return merged


def save_email_settings(settings_data: dict) -> dict:
    merged = load_email_settings()
    merged.update(settings_data)
    path = _settings_path()
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def sanitize_email_settings(settings_data: dict) -> dict:
    return {
        "enabled": bool(settings_data.get("enabled")),
        "host": str(settings_data.get("host") or ""),
        "port": int(settings_data.get("port") or 0),
        "security": str(settings_data.get("security") or "starttls"),
        "username": str(settings_data.get("username") or ""),
        "from_address": str(settings_data.get("from_address") or ""),
        "timeout_seconds": int(settings_data.get("timeout_seconds") or 10),
        "has_password": bool(str(settings_data.get("password") or "").strip()),
    }


def _sender(settings_data: dict) -> str:
    sender = str(settings_data.get("from_address") or "").strip()
    if sender:
        return sender
    username = str(settings_data.get("username") or "").strip()
    if username:
        return username
    raise ValueError("from_address or username required")


def _connect_client(settings_data: dict):
    host = str(settings_data.get("host") or "").strip()
    if not host:
        raise ValueError("smtp host missing")
    port = int(settings_data.get("port") or 0)
    if port <= 0:
        raise ValueError("smtp port invalid")
    timeout_seconds = max(3, min(60, int(settings_data.get("timeout_seconds") or 10)))
    security = str(settings_data.get("security") or "starttls").strip().lower()
    if security == "ssl":
        client = smtplib.SMTP_SSL(host=host, port=port, timeout=timeout_seconds, context=ssl.create_default_context())
    else:
        client = smtplib.SMTP(host=host, port=port, timeout=timeout_seconds)
        client.ehlo()
        if security == "starttls":
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
    username = str(settings_data.get("username") or "").strip()
    password = str(settings_data.get("password") or "")
    if username:
        client.login(username, password)
    return client


def _candidate_hosts(host: str) -> list[str]:
    cleaned = host.strip()
    if not cleaned:
        return []
    variants = [cleaned]
    if cleaned == "mailpit":
        variants.append("anlagen-mailpit")
    elif cleaned == "anlagen-mailpit":
        variants.append("mailpit")
    return variants


def _connect_with_fallback(settings_data: dict) -> tuple[smtplib.SMTP, str]:
    host = str(settings_data.get("host") or "").strip()
    candidates = _candidate_hosts(host)
    if not candidates:
        raise ValueError("smtp host missing")
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            merged = dict(settings_data)
            merged["host"] = candidate
            return _connect_client(merged), candidate
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise ValueError("smtp connection failed")


def _tcp_probe(settings_data: dict) -> str:
    host = str(settings_data.get("host") or "").strip()
    candidates = _candidate_hosts(host)
    if not candidates:
        raise ValueError("smtp host missing")
    port = int(settings_data.get("port") or 0)
    if port <= 0:
        raise ValueError("smtp port invalid")
    timeout_seconds = max(3, min(60, int(settings_data.get("timeout_seconds") or 10)))
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            with socket.create_connection((candidate, port), timeout=timeout_seconds):
                return candidate
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise ValueError("smtp tcp probe failed")


def test_connection(settings_data: dict, recipient: str | None = None, send_test_mail: bool = False) -> dict:
    recipient_value = (recipient or "").strip()
    if not send_test_mail:
        resolved_host = _tcp_probe(settings_data)
        return {
            "ok": True,
            "mode": "tcp",
            "send_test_mail": False,
            "recipient": None,
            "resolved_host": resolved_host,
        }

    if not recipient_value:
        raise ValueError("recipient missing for test mail")

    client, resolved_host = _connect_with_fallback(settings_data)
    with client:
        msg = EmailMessage()
        msg["Subject"] = "Anlagenserver SMTP Test"
        msg["From"] = _sender(settings_data)
        msg["To"] = recipient_value
        msg.set_content("Dies ist eine Testmail aus dem Anlagenserver-Admin.")
        client.send_message(msg)

    return {
        "ok": True,
        "mode": "smtp",
        "send_test_mail": True,
        "recipient": recipient_value,
        "resolved_host": resolved_host,
    }


def send_email(
    settings_data: dict,
    *,
    recipient: str,
    subject: str,
    body: str,
    attachments: list[dict] | None = None,
) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _sender(settings_data)
    msg["To"] = recipient
    msg.set_content(body)

    for attachment in attachments or []:
        payload = attachment.get("payload")
        filename = str(attachment.get("filename") or "attachment.bin")
        mime_type = str(attachment.get("mime_type") or "application/octet-stream")
        maintype, subtype = mime_type.split("/", 1) if "/" in mime_type else ("application", "octet-stream")
        if isinstance(payload, bytes):
            msg.add_attachment(payload, maintype=maintype, subtype=subtype, filename=filename)

    client, _ = _connect_with_fallback(settings_data)
    with client:
        client.send_message(msg)
