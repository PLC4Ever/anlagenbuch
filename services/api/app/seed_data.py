from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Area, Permission, Plant, Role, TicketGroup, TicketGroupMember, User, UserRole
from app.deps import hash_password


PLANTS = [
    "MS_DEMO_ANLAGE_01",
    "MS_DEMO_ANLAGE_02",
    "T_DEMO_ANLAGE_03",
    "KS_DEMO_ANLAGE_04",
    "SV_DEMO_ANLAGE_05",
    "ZZ_TESTANLAGE",
]

AREAS = [("MS", "MS"), ("T", "T"), ("KS", "KS"), ("SV", "SV")]
USERS = [
    ("admin_1", "admin_demo_pw_change", "Admin"),
    ("dispatcher_ms", "dispatcher_demo_pw_change", "Dispatcher"),
    ("agent_ms_1", "agent_ms_1_change_me", "Agent"),
    ("auditor_1", "auditor_1_change_me", "Auditor"),
]
ROLES = ["Admin", "Dispatcher", "Agent", "Auditor"]
PERMISSIONS = [
    "plants.read",
    "plants.write",
    "tickets.read",
    "tickets.write",
    "reporting.read",
    "reporting.write",
    "ops.read",
    "ops.write",
]
DEFAULT_TICKET_GROUPS = [
    ("MECH", "Mechanik"),
    ("ELEK", "Elektrik"),
    ("IT", "IT"),
]


def _ensure_role(db: Session, name: str) -> Role:
    role = db.scalar(select(Role).where(Role.name == name))
    if role:
        return role
    role = Role(name=name)
    db.add(role)
    db.flush()
    return role


def _ensure_user(db: Session, username: str, password: str, role_name: str) -> None:
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        user = User(username=username, password_hash=hash_password(password), force_password_change=True)
        db.add(user)
        db.flush()
    role = _ensure_role(db, role_name)
    if not db.scalar(select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == role.id)):
        db.add(UserRole(user_id=user.id, role_id=role.id))


def _ensure_ticket_groups(db: Session) -> None:
    groups_by_code: dict[str, TicketGroup] = {}
    for code, name in DEFAULT_TICKET_GROUPS:
        row = db.scalar(select(TicketGroup).where(TicketGroup.code == code))
        if not row:
            row = TicketGroup(code=code, name=name, active=True)
            db.add(row)
            db.flush()
        groups_by_code[code] = row

    # Minimal default assignment to keep Agent visibility useful after startup.
    agent = db.scalar(select(User).where(User.username == "agent_ms_1"))
    mech = groups_by_code.get("MECH")
    if agent and mech and not db.scalar(
        select(TicketGroupMember).where(TicketGroupMember.group_id == mech.id, TicketGroupMember.user_id == agent.id)
    ):
        db.add(TicketGroupMember(group_id=mech.id, user_id=agent.id))


def seed(db: Session) -> None:
    for code, name in AREAS:
        if not db.scalar(select(Area).where(Area.code == code)):
            db.add(Area(code=code, name=name))

    for role_name in ROLES:
        _ensure_role(db, role_name)

    for code in PERMISSIONS:
        if not db.scalar(select(Permission).where(Permission.code == code)):
            db.add(Permission(code=code))

    for slug in PLANTS:
        if not db.scalar(select(Plant).where(Plant.slug == slug)):
            area = "MS"
            if slug.startswith("T_"):
                area = "T"
            elif slug.startswith("KS_"):
                area = "KS"
            elif slug.startswith("SV_"):
                area = "SV"
            db.add(Plant(slug=slug, display_name=slug.replace("_", " "), area_prefix=area))

    for username, password, role_name in USERS:
        _ensure_user(db, username, password, role_name)

    _ensure_ticket_groups(db)
    db.commit()


def seed_if_empty(db: Session) -> None:
    if db.scalar(select(Plant).limit(1)):
        _ensure_ticket_groups(db)
        db.commit()
        return
    seed(db)

