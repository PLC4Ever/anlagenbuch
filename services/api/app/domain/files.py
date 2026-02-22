from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status


def ensure_path(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def save_upload(file: UploadFile, target_dir: Path, max_bytes: int) -> dict[str, str | int]:
    ensure_path(target_dir)
    payload = file.file.read()
    size = len(payload)
    if size > max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="file too large")

    ext = os.path.splitext(file.filename or "")[1]
    storage_name = f"{uuid.uuid4().hex}{ext}"
    dest = target_dir / storage_name
    dest.write_bytes(payload)

    return {
        "storage_name": storage_name,
        "size_bytes": size,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "path": str(dest),
        "filename_original": file.filename or storage_name,
        "mime": file.content_type or "application/octet-stream",
    }
