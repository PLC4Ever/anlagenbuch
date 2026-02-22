from __future__ import annotations

import gzip
import json
import logging
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from app.settings import get_settings


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
        }
        trace_id = getattr(record, "trace_id", None)
        if trace_id:
            payload["trace_id"] = trace_id
        return json.dumps(payload, ensure_ascii=False)


def _rotator(source: str, dest: str) -> None:
    with open(source, "rb") as src, gzip.open(f"{dest}.gz", "wb") as target:
        target.write(src.read())
    Path(source).unlink(missing_ok=True)


def _handler(path: Path, level: int) -> TimedRotatingFileHandler:
    h = TimedRotatingFileHandler(path, when="midnight", backupCount=30, encoding="utf-8")
    h.level = level
    h.formatter = JsonFormatter()
    h.rotator = _rotator
    return h


def configure_logging() -> None:
    settings = get_settings()
    settings.logs_dir.mkdir(parents=True, exist_ok=True)

    app_logger = logging.getLogger("anlagen")
    error_logger = logging.getLogger("anlagen.error")
    trace_logger = logging.getLogger("anlagen.trace")

    for logger in (app_logger, error_logger, trace_logger):
        logger.handlers.clear()
        logger.propagate = False
        logger.setLevel(logging.INFO)

    app_logger.addHandler(_handler(settings.logs_dir / "app.log", logging.INFO))
    error_logger.addHandler(_handler(settings.logs_dir / "error.log", logging.ERROR))
    trace_logger.addHandler(_handler(settings.logs_dir / "trace.log", logging.INFO))
