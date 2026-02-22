from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime
from typing import Callable

from fastapi import Cookie, Depends, HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Role, User, UserRole
from app.db.session import get_db
from app.settings import get_settings


settings = get_settings()


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt="anlagenbuch-session")


def hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), settings.session_secret.encode("utf-8"), 120_000)
    return digest.hex()


def verify_password(password: str, password_hash: str) -> bool:
    return hmac.compare_digest(hash_password(password), password_hash)


def create_session_token(user_id: int) -> str:
    return _serializer().dumps({"user_id": user_id})


def parse_session_token(token: str) -> dict:
    return _serializer().loads(token, max_age=settings.session_max_age_seconds)


def get_current_user(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> User:
    if not session_cookie:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = parse_session_token(session_cookie)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    user = db.get(User, payload.get("user_id"))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    return user


def get_user_roles(db: Session, user_id: int) -> set[str]:
    stmt = (
        select(Role.name)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
    )
    return {row[0] for row in db.execute(stmt).all()}


def require_roles(*allowed: str) -> Callable:
    def _dep(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        roles = get_user_roles(db, user.id)
        if not roles.intersection(set(allowed)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return _dep


def json_dumps(value: dict) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def utc_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"
