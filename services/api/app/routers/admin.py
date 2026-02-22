from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Area,
    Delivery,
    OpsErrorIndex,
    OpsHealthSnapshot,
    Permission,
    Plant,
    Role,
    RolePermission,
    ShiftEntry,
    Ticket,
    TicketGroup,
    TicketGroupMember,
    TicketGroupRoute,
    User,
    UserDepartment,
    UserDepartmentMembership,
    UserRole,
)
from app.db.session import get_db
from app.deps import hash_password, require_roles
from app.domain.email_service import load_email_settings, save_email_settings, sanitize_email_settings, test_connection
from app.settings import get_settings


router = APIRouter(tags=["admin-internal"])

DEFAULT_MODULE_SETTINGS = {
    "anlagenbuch": {
        "upload_limit_mb": 50,
        "shift_config": "3-shifts-8h",
    },
    "tickets": {
        "public_reply_enabled": True,
        "auto_close_policy_days": 14,
        "department_options": [
            "Mechanik",
            "Elektrik",
            "Automation/PLC",
            "Hydraulik/Pneumatik",
            "IT/Netzwerk",
            "Produktion/Prozess",
            "Qualitaet",
            "Sicherheit",
            "Instandhaltung Allgemein",
            "Fremdfirma",
        ],
        "ticket_type_options": [
            "Stoerung",
            "Wartung",
            "Pruefung",
            "Sicherheit",
            "Info",
        ],
    },
    "reporting": {
        "enabled": True,
    },
}


class AreaIn(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=100)


class AreaPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)


class UserIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)
    roles: list[str] = Field(default_factory=list)
    force_password_change: bool = True


class UserRolesPatch(BaseModel):
    roles: list[str] = Field(default_factory=list)


class UserPasswordResetIn(BaseModel):
    new_password: str = Field(min_length=8, max_length=200)
    force_password_change: bool = True


class UserAdminSettingsPatch(BaseModel):
    roles: list[str] | None = None
    group_ids: list[int] | None = None
    departments: list[str] | None = None
    department: str | None = Field(default=None, max_length=16)


class EmailSettingsPatch(BaseModel):
    enabled: bool | None = None
    host: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    security: str | None = Field(default=None, max_length=32)
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=255)
    from_address: str | None = Field(default=None, max_length=255)
    timeout_seconds: int | None = Field(default=None, ge=3, le=60)
    reset_password: bool = False


class EmailSettingsTestIn(BaseModel):
    recipient: str | None = Field(default=None, max_length=255)
    send_test_mail: bool = False


class ModuleSettingsPatch(BaseModel):
    anlagenbuch: dict | None = None
    tickets: dict | None = None
    reporting: dict | None = None


class TicketGroupIn(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    active: bool = True


class TicketGroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    active: bool | None = None


class TicketGroupMembersPatch(BaseModel):
    usernames: list[str] = Field(default_factory=list)


def _settings_file() -> Path:
    settings = get_settings()
    settings.config_dir.mkdir(parents=True, exist_ok=True)
    return settings.config_dir / "module_settings.json"


def _load_module_settings() -> dict:
    path = _settings_file()
    if not path.exists():
        return json.loads(json.dumps(DEFAULT_MODULE_SETTINGS))
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return json.loads(json.dumps(DEFAULT_MODULE_SETTINGS))
    except json.JSONDecodeError:
        return json.loads(json.dumps(DEFAULT_MODULE_SETTINGS))
    merged = json.loads(json.dumps(DEFAULT_MODULE_SETTINGS))
    for key in ("anlagenbuch", "tickets", "reporting"):
        if isinstance(data.get(key), dict):
            merged[key].update(data[key])
    return merged


def _save_module_settings(payload: dict) -> dict:
    path = _settings_file()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def _user_roles(db: Session, user_id: int) -> list[str]:
    rows = db.execute(
        select(Role.name)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
        .order_by(Role.name.asc())
    ).all()
    return [row[0] for row in rows]


def _normalize_role_names(values: list[str] | None) -> list[str]:
    return sorted({name.strip() for name in (values or []) if isinstance(name, str) and name.strip()})


def _resolve_roles_or_404(db: Session, role_names: list[str]) -> list[Role]:
    if not role_names:
        return []
    found = db.scalars(select(Role).where(Role.name.in_(role_names))).all()
    found_names = {row.name for row in found}
    missing = [name for name in role_names if name not in found_names]
    if missing:
        raise HTTPException(status_code=404, detail=f"unknown roles: {', '.join(missing)}")
    return found


def _user_ticket_groups(db: Session, user_id: int) -> list[dict]:
    rows = db.execute(
        select(TicketGroup.id, TicketGroup.code, TicketGroup.name, TicketGroup.active)
        .select_from(TicketGroupMember)
        .join(TicketGroup, TicketGroup.id == TicketGroupMember.group_id)
        .where(TicketGroupMember.user_id == user_id)
        .order_by(TicketGroup.name.asc())
    ).all()
    return [
        {"id": row[0], "code": row[1], "name": row[2], "active": row[3]}
        for row in rows
    ]


def _normalize_department_codes(values: list[str] | None) -> list[str]:
    return sorted({str(value).strip().upper() for value in (values or []) if str(value).strip()})


def _legacy_user_department(db: Session, user_id: int) -> str | None:
    row = db.scalar(select(UserDepartment).where(UserDepartment.user_id == user_id))
    if not row:
        return None
    return str(row.area_code).strip().upper() or None


def _user_departments(db: Session, user_id: int) -> list[str]:
    rows = db.scalars(
        select(UserDepartmentMembership)
        .where(UserDepartmentMembership.user_id == user_id)
        .order_by(UserDepartmentMembership.area_code.asc())
    ).all()
    codes = [str(row.area_code).strip().upper() for row in rows if str(row.area_code).strip()]
    if codes:
        return sorted(set(codes))
    legacy = _legacy_user_department(db, user_id)
    return [legacy] if legacy else []


def _apply_user_roles(db: Session, user_id: int, role_names: list[str]) -> None:
    roles = _resolve_roles_or_404(db, role_names)
    db.execute(delete(UserRole).where(UserRole.user_id == user_id))
    for role in roles:
        db.add(UserRole(user_id=user_id, role_id=role.id))
    if "Agent" not in role_names:
        db.execute(delete(TicketGroupMember).where(TicketGroupMember.user_id == user_id))


def _apply_user_departments(db: Session, user_id: int, departments: list[str]) -> None:
    department_codes = _normalize_department_codes(departments)
    if department_codes:
        existing_areas = db.scalars(select(Area).where(Area.code.in_(department_codes))).all()
        found = {row.code for row in existing_areas}
        missing = [code for code in department_codes if code not in found]
        if missing:
            raise HTTPException(status_code=404, detail=f"unknown areas: {', '.join(missing)}")
    db.execute(delete(UserDepartmentMembership).where(UserDepartmentMembership.user_id == user_id))
    for code in department_codes:
        db.add(UserDepartmentMembership(user_id=user_id, area_code=code))
    # Keep legacy mapping synchronized with the first selected department.
    legacy = db.scalar(select(UserDepartment).where(UserDepartment.user_id == user_id))
    if not department_codes:
        if legacy:
            db.delete(legacy)
        return
    first = department_codes[0]
    now = datetime.now(timezone.utc)
    if not legacy:
        db.add(UserDepartment(user_id=user_id, area_code=first, updated_at=now))
        return
    legacy.area_code = first
    legacy.updated_at = now


def _normalize_group_ids(values: list[int] | None) -> list[int]:
    cleaned: set[int] = set()
    for raw in values or []:
        if raw is None:
            continue
        gid = int(raw)
        if gid > 0:
            cleaned.add(gid)
    return sorted(cleaned)


def _apply_user_groups(db: Session, user_id: int, group_ids: list[int], role_names: list[str]) -> None:
    if group_ids and "Agent" not in role_names:
        raise HTTPException(status_code=400, detail="ticket groups require Agent role")
    groups = db.scalars(select(TicketGroup).where(TicketGroup.id.in_(group_ids))).all() if group_ids else []
    found_ids = {row.id for row in groups}
    missing = [str(gid) for gid in group_ids if gid not in found_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"unknown ticket group ids: {', '.join(missing)}")
    db.execute(delete(TicketGroupMember).where(TicketGroupMember.user_id == user_id))
    for group in groups:
        db.add(TicketGroupMember(group_id=group.id, user_id=user_id))


def _serialize_user(db: Session, user: User) -> dict:
    departments = _user_departments(db, user.id)
    return {
        "id": user.id,
        "username": user.username,
        "force_password_change": user.force_password_change,
        "roles": _user_roles(db, user.id),
        "department": departments[0] if departments else None,
        "departments": departments,
        "ticket_groups": _user_ticket_groups(db, user.id),
    }


def _serialize_ticket_group(db: Session, row: TicketGroup) -> dict:
    members = db.execute(
        select(User.username)
        .select_from(TicketGroupMember)
        .join(User, User.id == TicketGroupMember.user_id)
        .where(TicketGroupMember.group_id == row.id)
        .order_by(User.username.asc())
    ).all()
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "active": row.active,
        "members": [member[0] for member in members],
    }


@router.get("/admin/dashboard")
def dashboard(
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    module_settings = _load_module_settings()
    email_settings = load_email_settings()
    latest_health = db.scalar(select(OpsHealthSnapshot).order_by(OpsHealthSnapshot.id.desc()).limit(1))
    recent_errors = db.scalars(select(OpsErrorIndex).order_by(OpsErrorIndex.id.desc()).limit(10)).all()

    backup_root = settings.backups_dir
    backup_root.mkdir(parents=True, exist_ok=True)
    files = sorted((fp for fp in backup_root.rglob("*") if fp.is_file()), key=lambda fp: fp.stat().st_mtime, reverse=True)
    recent_backups = [
        {
            "name": fp.name,
            "path": str(fp),
            "size_bytes": fp.stat().st_size,
            "modified_at": datetime.fromtimestamp(fp.stat().st_mtime, tz=timezone.utc),
        }
        for fp in files[:20]
    ]

    pending_deliveries = db.scalar(
        select(func.count()).select_from(Delivery).where(Delivery.status.in_(["PENDING", "FAILED_RETRY"]))
    ) or 0

    return {
        "app": {
            "name": settings.app_name,
            "version": "0.1.0",
            "env": settings.env,
            "root_path": settings.root_path,
        },
        "health": {
            "db_ok": latest_health.db_ok if latest_health else False,
            "disk_ok": latest_health.disk_ok if latest_health else False,
            "backlog": latest_health.backlog if latest_health else 0,
            "response_ms": latest_health.response_ms if latest_health else 0,
            "last_error": latest_health.last_error if latest_health else None,
        },
        "pending_deliveries": pending_deliveries,
        "module_status": {
            "anlagenbuch_enabled": True,
            "tickets_enabled": True,
            "reporting_enabled": bool(module_settings.get("reporting", {}).get("enabled", True)),
        },
        "email_server": {
            **sanitize_email_settings(email_settings),
            "configured": bool(str(email_settings.get("host") or "").strip())
            and (bool(str(email_settings.get("password") or "").strip()) or bool(str(email_settings.get("username") or "").strip())),
        },
        "recent_backups": recent_backups,
        "recent_errors": [
            {
                "id": row.id,
                "created_at": row.created_at,
                "route": row.route,
                "trace_id": row.trace_id,
                "exception_type": row.exception_type,
                "message": row.message,
                "status_code": row.status_code,
            }
            for row in recent_errors
        ],
    }


@router.get("/admin/module-settings")
def get_module_settings(
    _: object = Depends(require_roles("Admin", "Dispatcher")),
):
    return _load_module_settings()


@router.patch("/admin/module-settings")
def patch_module_settings(
    payload: ModuleSettingsPatch,
    _: object = Depends(require_roles("Admin")),
):
    current = _load_module_settings()
    patch = payload.model_dump(exclude_none=True)
    for key, value in patch.items():
        if isinstance(value, dict) and key in current:
            current[key].update(value)
    return _save_module_settings(current)


@router.get("/admin/email-settings")
def get_email_settings(_: object = Depends(require_roles("Admin"))):
    settings = load_email_settings()
    return sanitize_email_settings(settings)


@router.patch("/admin/email-settings")
def patch_email_settings(
    payload: EmailSettingsPatch,
    _: object = Depends(require_roles("Admin")),
):
    current = load_email_settings()
    patch = payload.model_dump(exclude_none=True)
    reset_password = bool(patch.pop("reset_password", False))
    if "security" in patch:
        normalized = str(patch["security"]).strip().lower()
        if normalized not in {"none", "starttls", "ssl"}:
            raise HTTPException(status_code=400, detail="invalid security mode")
        patch["security"] = normalized
    if "host" in patch:
        patch["host"] = str(patch["host"]).strip()
    if "username" in patch:
        patch["username"] = str(patch["username"]).strip()
    if "from_address" in patch:
        patch["from_address"] = str(patch["from_address"]).strip()
    if "password" in patch:
        incoming_password = str(patch["password"])
        if incoming_password:
            patch["password"] = incoming_password
        else:
            patch.pop("password")
    if reset_password:
        patch["password"] = ""
    current.update(patch)
    saved = save_email_settings(current)
    result = sanitize_email_settings(saved)
    result["configured"] = bool(result["host"]) and (bool(saved.get("password")) or bool(result["username"]))
    return result


@router.post("/admin/email-settings/test")
def test_email_settings(
    payload: EmailSettingsTestIn,
    _: object = Depends(require_roles("Admin")),
):
    settings_data = load_email_settings()
    try:
        result = test_connection(
            settings_data,
            recipient=(payload.recipient or "").strip() or None,
            send_test_mail=payload.send_test_mail,
        )
        return {"ok": True, "result": result}
    except Exception as exc:
        return {"ok": False, "error": f"email test failed: {exc}"}


@router.get("/admin/areas")
def list_areas(
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(Area).order_by(Area.code.asc())).all()
    return [{"id": row.id, "code": row.code, "name": row.name} for row in rows]


@router.post("/admin/areas", status_code=201)
def create_area(
    payload: AreaIn,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    code = payload.code.strip().upper()
    existing = db.scalar(select(Area).where(Area.code == code))
    if existing:
        raise HTTPException(status_code=409, detail="area code already exists")
    row = Area(code=code, name=payload.name.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "code": row.code, "name": row.name}


@router.patch("/admin/areas/{area_code}")
def patch_area(
    area_code: str,
    payload: AreaPatch,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    code = area_code.strip().upper()
    row = db.scalar(select(Area).where(Area.code == code))
    if not row:
        raise HTTPException(status_code=404, detail="area not found")
    patch = payload.model_dump(exclude_none=True)
    if "name" in patch:
        row.name = patch["name"].strip()
    db.commit()
    db.refresh(row)
    return {"id": row.id, "code": row.code, "name": row.name}


@router.delete("/admin/areas/{area_code}")
def delete_area(
    area_code: str,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    code = area_code.strip().upper()
    row = db.scalar(select(Area).where(Area.code == code))
    if not row:
        raise HTTPException(status_code=404, detail="area not found")
    used = db.scalar(select(func.count()).select_from(Plant).where(Plant.area_prefix == code)) or 0
    if used > 0:
        raise HTTPException(status_code=409, detail="area is referenced by plants")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.delete("/admin/plants/{plant_slug}")
def delete_plant(
    plant_slug: str,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_slug))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")

    entry_refs = db.scalar(select(func.count()).select_from(ShiftEntry).where(ShiftEntry.plant_id == plant.id)) or 0
    ticket_refs = db.scalar(select(func.count()).select_from(Ticket).where(Ticket.plant_id == plant.id)) or 0
    if entry_refs > 0 or ticket_refs > 0:
        raise HTTPException(status_code=409, detail="plant has references and cannot be deleted")

    db.delete(plant)
    db.commit()
    return {"ok": True}


@router.get("/admin/users")
def list_users(
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    users = db.scalars(select(User).order_by(User.username.asc())).all()
    return [_serialize_user(db, row) for row in users]


@router.post("/admin/users", status_code=201)
def create_user(
    payload: UserIn,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    username = payload.username.strip()
    existing = db.scalar(select(User).where(User.username == username))
    if existing:
        raise HTTPException(status_code=409, detail="username already exists")

    role_names = _normalize_role_names(payload.roles)
    found = _resolve_roles_or_404(db, role_names)

    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        force_password_change=payload.force_password_change,
    )
    db.add(user)
    db.flush()

    for role in found:
        db.add(UserRole(user_id=user.id, role_id=role.id))

    db.commit()
    db.refresh(user)
    return _serialize_user(db, user)


@router.patch("/admin/users/{username}/roles")
def patch_user_roles(
    username: str,
    payload: UserRolesPatch,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    role_names = _normalize_role_names(payload.roles)
    _apply_user_roles(db, user.id, role_names)
    db.commit()
    db.refresh(user)
    return _serialize_user(db, user)


@router.patch("/admin/users/{username}/settings")
def patch_user_settings(
    username: str,
    payload: UserAdminSettingsPatch,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    fields = payload.model_fields_set
    if not fields:
        return _serialize_user(db, user)

    role_names = _user_roles(db, user.id)
    requested_group_ids = _normalize_group_ids(payload.group_ids if "group_ids" in fields else None)
    requested_departments: list[str] | None = None
    if "departments" in fields:
        requested_departments = _normalize_department_codes(payload.departments)
    elif "department" in fields:
        requested_departments = _normalize_department_codes([payload.department or ""])
    if "roles" in fields:
        role_names = _normalize_role_names(payload.roles)
    if requested_group_ids and "Agent" not in role_names:
        raise HTTPException(status_code=400, detail="ticket groups require Agent role")

    if "roles" in fields:
        _apply_user_roles(db, user.id, role_names)
    if requested_departments is not None:
        _apply_user_departments(db, user.id, requested_departments)
    if "group_ids" in fields:
        _apply_user_groups(db, user.id, requested_group_ids, role_names)

    db.commit()
    db.refresh(user)
    return _serialize_user(db, user)


@router.post("/admin/users/{username}/reset-password")
def reset_user_password(
    username: str,
    payload: UserPasswordResetIn,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    user.password_hash = hash_password(payload.new_password)
    user.force_password_change = payload.force_password_change
    db.commit()
    return {"ok": True, "username": user.username}


@router.delete("/admin/users/{username}")
def delete_user(
    username: str,
    current_user: User = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="cannot delete own user")
    db.execute(delete(UserRole).where(UserRole.user_id == user.id))
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.get("/admin/roles")
def list_roles(
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    permissions = {row.id: row.code for row in db.scalars(select(Permission)).all()}
    roles = db.scalars(select(Role).order_by(Role.name.asc())).all()

    result = []
    for role in roles:
        links = db.scalars(select(RolePermission).where(RolePermission.role_id == role.id)).all()
        codes = sorted({permissions.get(link.permission_id, "") for link in links if permissions.get(link.permission_id)})
        result.append({"id": role.id, "name": role.name, "permissions": codes})
    return result


@router.get("/admin/ticket-groups")
def list_ticket_groups(
    _: object = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(TicketGroup).order_by(TicketGroup.active.desc(), TicketGroup.name.asc())).all()
    return [_serialize_ticket_group(db, row) for row in rows]


@router.post("/admin/ticket-groups", status_code=201)
def create_ticket_group(
    payload: TicketGroupIn,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    code = payload.code.strip().upper()
    existing = db.scalar(select(TicketGroup).where(TicketGroup.code == code))
    if existing:
        raise HTTPException(status_code=409, detail="ticket group code already exists")
    row = TicketGroup(code=code, name=payload.name.strip(), active=payload.active)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_ticket_group(db, row)


@router.patch("/admin/ticket-groups/{group_id}")
def patch_ticket_group(
    group_id: int,
    payload: TicketGroupPatch,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    row = db.get(TicketGroup, group_id)
    if not row:
        raise HTTPException(status_code=404, detail="ticket group not found")
    patch = payload.model_dump(exclude_none=True)
    if "name" in patch:
        row.name = patch["name"].strip()
    if "active" in patch:
        row.active = bool(patch["active"])
    db.commit()
    db.refresh(row)
    return _serialize_ticket_group(db, row)


@router.patch("/admin/ticket-groups/{group_id}/members")
def patch_ticket_group_members(
    group_id: int,
    payload: TicketGroupMembersPatch,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    row = db.get(TicketGroup, group_id)
    if not row:
        raise HTTPException(status_code=404, detail="ticket group not found")

    wanted = sorted({username.strip() for username in payload.usernames if username.strip()})
    users = db.scalars(select(User).where(User.username.in_(wanted))).all() if wanted else []
    found = {user.username for user in users}
    missing = [username for username in wanted if username not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"unknown users: {', '.join(missing)}")

    agent_role = db.scalar(select(Role).where(Role.name == "Agent"))
    if agent_role:
        agent_ids = {
            row[0]
            for row in db.execute(
                select(UserRole.user_id).where(UserRole.role_id == agent_role.id, UserRole.user_id.in_([user.id for user in users]))
            ).all()
        }
        non_agents = sorted([user.username for user in users if user.id not in agent_ids])
        if non_agents:
            raise HTTPException(status_code=400, detail=f"users without Agent role: {', '.join(non_agents)}")

    db.execute(delete(TicketGroupMember).where(TicketGroupMember.group_id == group_id))
    for user in users:
        db.add(TicketGroupMember(group_id=group_id, user_id=user.id))
    db.commit()
    db.refresh(row)
    return _serialize_ticket_group(db, row)


@router.delete("/admin/ticket-groups/{group_id}")
def delete_ticket_group(
    group_id: int,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    row = db.get(TicketGroup, group_id)
    if not row:
        raise HTTPException(status_code=404, detail="ticket group not found")
    refs = db.scalar(select(func.count()).select_from(TicketGroupRoute).where(TicketGroupRoute.group_id == group_id)) or 0
    if refs > 0:
        raise HTTPException(status_code=409, detail="ticket group is referenced by routes")
    db.execute(delete(TicketGroupMember).where(TicketGroupMember.group_id == group_id))
    db.delete(row)
    db.commit()
    return {"ok": True}
