from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User, UserProfile
from app.db.session import get_db
from app.deps import create_session_token, get_current_user, get_user_roles, hash_password, verify_password
from app.settings import get_settings


router = APIRouter(tags=["auth"])
settings = get_settings()


class LoginIn(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class PasswordChangeIn(BaseModel):
    new_password: str = Field(min_length=8)


class ProfilePatchIn(BaseModel):
    email: str | None = Field(default=None, max_length=255)


def _normalize_email(value: str | None) -> str | None:
    if value is None:
        return None
    email = value.strip()
    if not email:
        return None
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="invalid email")
    return email


def _get_profile_email(db: Session, user_id: int) -> str | None:
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return profile.email if profile else None


@router.post("/auth/login")
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")

    token = create_session_token(user.id)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.session_max_age_seconds,
        path="/",
    )
    return {"username": user.username, "force_password_change": user.force_password_change}


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = sorted(get_user_roles(db, user.id))
    email = _get_profile_email(db, user.id)
    return {
        "id": user.id,
        "username": user.username,
        "email": email,
        "roles": roles,
        "force_password_change": user.force_password_change,
    }


@router.get("/auth/profile")
def get_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = sorted(get_user_roles(db, user.id))
    email = _get_profile_email(db, user.id)
    return {
        "id": user.id,
        "username": user.username,
        "email": email,
        "roles": roles,
        "force_password_change": user.force_password_change,
    }


@router.patch("/auth/profile")
def patch_profile(payload: ProfilePatchIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    email = _normalize_email(payload.email)
    row = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    if not row:
        row = UserProfile(user_id=user.id, email=email, updated_at=datetime.now(timezone.utc))
        db.add(row)
    else:
        row.email = email
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "email": email}


@router.post("/auth/change-password")
def change_password(payload: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.password_hash = hash_password(payload.new_password)
    user.force_password_change = False
    db.commit()
    return {"ok": True}
