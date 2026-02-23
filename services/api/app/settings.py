from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP__", env_nested_delimiter="__", extra="ignore")

    app_name: str = "anlagenbuch-api"
    env: str = Field(default="dev", validation_alias=AliasChoices("ENV", "APP__ENV"))
    root_path: str = "/api"
    host: str = "0.0.0.0"
    port: int = 8000

    database_url: str = Field(
        default="postgresql+psycopg://postgres:replace_me@postgres:5432/anlagen",
        validation_alias=AliasChoices("DB__CONNECTIONSTRING", "DATABASE_URL", "APP__DATABASE_URL"),
    )

    session_secret: str = Field(
        default="session-secret-replace-me",
        validation_alias=AliasChoices("SESSION__SECRET", "APP__SESSION_SECRET"),
    )
    session_cookie_name: str = "anlagen_session"
    session_max_age_seconds: int = 60 * 60 * 8

    upload_max_bytes: int = 50 * 1024 * 1024

    storage_root: Path = Field(
        default=Path("/srv/anlagenserver"),
        validation_alias=AliasChoices("STORAGE__ROOT", "APP__STORAGE_ROOT"),
    )

    email_mode: str = Field(default="FAKE", validation_alias=AliasChoices("EMAIL__MODE", "APP__EMAIL__MODE"))
    smtp_host: str = Field(default="mailpit", validation_alias=AliasChoices("EMAIL__SMTP_HOST", "APP__EMAIL__SMTP_HOST"))
    smtp_port: int = Field(default=1025, validation_alias=AliasChoices("EMAIL__SMTP_PORT", "APP__EMAIL__SMTP_PORT"))

    outbox_max_attempts: int = 3
    watchdog_interval_seconds: int = 60
    cert_monitor_host: str | None = Field(
        default=None,
        validation_alias=AliasChoices("CERT__HOST", "APP__CERT__HOST"),
    )
    cert_monitor_port: int = Field(
        default=443,
        validation_alias=AliasChoices("CERT__PORT", "APP__CERT__PORT"),
    )
    cert_renew_command: str = Field(
        default="/usr/local/sbin/anlagen-renew-cert",
        validation_alias=AliasChoices("CERT__RENEW_COMMAND", "APP__CERT__RENEW_COMMAND"),
    )
    cert_domain_command: str = Field(
        default="/usr/local/sbin/anlagen-domain-cert",
        validation_alias=AliasChoices("CERT__DOMAIN_COMMAND", "APP__CERT__DOMAIN_COMMAND"),
    )

    @property
    def files_dir(self) -> Path:
        return self.storage_root / "files"

    @property
    def reports_dir(self) -> Path:
        return self.storage_root / "reports"

    @property
    def logs_dir(self) -> Path:
        return self.storage_root / "logs"

    @property
    def backups_dir(self) -> Path:
        return self.storage_root / "backups"

    @property
    def config_dir(self) -> Path:
        return self.storage_root / "config"


@lru_cache
def get_settings() -> Settings:
    return Settings()

