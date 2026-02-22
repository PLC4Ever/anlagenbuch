from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import File as DbFile
from app.db.models import FileLink, Plant, Role, Ticket, TicketAssignment, TicketEvent, TicketGroup, TicketGroupMember, TicketGroupRoute, User, UserRole
from app.db.session import get_db
from app.deps import get_user_roles, require_roles
from app.domain.audit_hashchain import append_ticket_event
from app.domain.files import save_upload
from app.domain.outbox import enqueue_outbox
from app.settings import get_settings


router = APIRouter(tags=["tickets-internal"])
STARTED_TICKET_STATUSES = {"IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED", "CANCELLED_WRONG_PLANT"}


class TriageIn(BaseModel):
    department: str | None = None
    group_id: int | None = None
    priority: int
    ticket_type: str


class AssignIn(BaseModel):
    assignee_username: str


class StatusIn(BaseModel):
    status: str
    reason: str | None = None
    public_comment: str | None = None


class GroupRouteTargetIn(BaseModel):
    group_id: int
    reason: str | None = None
    comment: str | None = None
    priority: int | None = 3
    note: str | None = None


class GroupRouteIn(BaseModel):
    targets: list[GroupRouteTargetIn]


def _pack_route_payload(comment: str | None, priority: int | None, note: str | None) -> str | None:
    payload: dict[str, object] = {"v": 1}
    cleaned_comment = (comment or "").strip()
    cleaned_note = (note or "").strip()
    if cleaned_comment:
        payload["comment"] = cleaned_comment
    if priority is not None:
        payload["priority"] = int(priority)
    if cleaned_note:
        payload["note"] = cleaned_note
    if len(payload) == 1:
        return None
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _unpack_route_payload(raw: str | None) -> dict:
    result = {"comment": None, "priority": None, "note": None}
    if not raw:
        return result
    text = raw.strip()
    if text.startswith("{"):
        try:
            decoded = json.loads(text)
            if isinstance(decoded, dict):
                comment = decoded.get("comment")
                priority = decoded.get("priority")
                note = decoded.get("note")
                if isinstance(comment, str):
                    result["comment"] = comment
                if isinstance(priority, int):
                    result["priority"] = priority
                if isinstance(note, str):
                    result["note"] = note
                return result
        except json.JSONDecodeError:
            pass
    result["comment"] = raw
    return result


def _serialize_group(db: Session, row: TicketGroup) -> dict:
    member_rows = db.execute(
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
        "members": [r[0] for r in member_rows],
    }


@router.get("/tickets/groups")
def list_ticket_groups(
    active_only: bool = True,
    _: User = Depends(require_roles("Admin", "Dispatcher", "Agent")),
    db: Session = Depends(get_db),
):
    stmt = select(TicketGroup).order_by(TicketGroup.active.desc(), TicketGroup.name.asc())
    if active_only:
        stmt = stmt.where(TicketGroup.active.is_(True))
    rows = db.scalars(stmt).all()
    return [_serialize_group(db, row) for row in rows]


@router.get("/tickets/agents")
def list_ticket_agents(
    group_id: int | None = None,
    _: User = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    stmt = (
        select(User)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.name == "Agent")
        .order_by(User.username.asc())
    )
    if group_id is not None:
        stmt = (
            stmt.join(TicketGroupMember, TicketGroupMember.user_id == User.id)
            .where(TicketGroupMember.group_id == group_id)
        )
    users = db.scalars(stmt).all()
    result: list[dict] = []
    for user in users:
        group_rows = db.execute(
            select(TicketGroup.id, TicketGroup.code, TicketGroup.name)
            .select_from(TicketGroupMember)
            .join(TicketGroup, TicketGroup.id == TicketGroupMember.group_id)
            .where(TicketGroupMember.user_id == user.id)
            .order_by(TicketGroup.name.asc())
        ).all()
        result.append(
            {
                "id": user.id,
                "username": user.username,
                "groups": [{"id": gid, "code": gcode, "name": gname} for gid, gcode, gname in group_rows],
            }
        )
    return result


@router.get("/tickets")
def list_tickets(
    status: str | None = None,
    department: str | None = None,
    area: str | None = None,
    q: str | None = None,
    user: User = Depends(require_roles("Admin", "Dispatcher", "Agent")),
    db: Session = Depends(get_db),
):
    roles = get_user_roles(db, user.id)

    stmt = select(Ticket, Plant.slug).join(Plant, Plant.id == Ticket.plant_id)
    if "Agent" in roles and "Admin" not in roles:
        routed_ids = (
            select(TicketGroupRoute.ticket_id)
            .join(TicketGroupMember, TicketGroupMember.group_id == TicketGroupRoute.group_id)
            .where(TicketGroupMember.user_id == user.id)
        )
        stmt = stmt.where(or_(Ticket.assignee_user_id == user.id, Ticket.id.in_(routed_ids)))
    if status:
        stmt = stmt.where(Ticket.status == status)
    if department:
        stmt = stmt.where(Ticket.department == department)
    if area:
        stmt = stmt.where(Ticket.area == area)
    if q:
        qq = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Ticket.subject).like(qq),
                func.lower(Ticket.description).like(qq),
                func.lower(Ticket.requester_name).like(qq),
            )
        )

    rows = db.execute(stmt.order_by(Ticket.priority_rank.asc().nulls_last(), Ticket.created_at.asc())).all()
    ticket_ids = [ticket.id for ticket, _ in rows]
    group_map: dict[int, list[dict]] = {}
    if ticket_ids:
        group_rows = db.execute(
            select(TicketGroupRoute.ticket_id, TicketGroup.id, TicketGroup.code, TicketGroup.name)
            .join(TicketGroup, TicketGroup.id == TicketGroupRoute.group_id)
            .where(TicketGroupRoute.ticket_id.in_(ticket_ids))
            .order_by(TicketGroup.name.asc())
        ).all()
        for ticket_id, group_id, code, name in group_rows:
            group_map.setdefault(ticket_id, []).append({"id": group_id, "code": code, "name": name})
    return [
        {
            "id": ticket.id,
            "status": ticket.status,
            "department": ticket.department,
            "priority_rank": ticket.priority_rank,
            "ticket_type": ticket.ticket_type,
            "area": ticket.area,
            "plant_slug": plant_slug,
            "subject": ticket.subject,
            "description": ticket.description,
            "requester_name": ticket.requester_name,
            "created_at": ticket.created_at,
            "updated_at": ticket.updated_at,
            "group_routes": group_map.get(ticket.id, []),
        }
        for ticket, plant_slug in rows
    ]


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, _: User = Depends(require_roles("Admin", "Dispatcher", "Agent")), db: Session = Depends(get_db)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")
    plant = db.get(Plant, ticket.plant_id)
    assignee = db.get(User, ticket.assignee_user_id) if ticket.assignee_user_id else None
    events = db.scalars(select(TicketEvent).where(TicketEvent.ticket_id == ticket_id).order_by(TicketEvent.id.asc())).all()
    attachments = db.execute(
        select(FileLink, DbFile)
        .join(DbFile, DbFile.id == FileLink.file_id)
        .where(FileLink.scope_type == "ticket", FileLink.scope_id == ticket_id)
        .order_by(FileLink.id.desc())
    ).all()
    routed_groups = db.execute(
        select(TicketGroupRoute, TicketGroup)
        .join(TicketGroup, TicketGroup.id == TicketGroupRoute.group_id)
        .where(TicketGroupRoute.ticket_id == ticket_id)
        .order_by(TicketGroup.name.asc())
    ).all()
    return {
        "id": ticket.id,
        "plant_slug": plant.slug if plant else None,
        "requester_name": ticket.requester_name,
        "assignee_username": assignee.username if assignee else None,
        "subject": ticket.subject,
        "description": ticket.description,
        "status": ticket.status,
        "department": ticket.department,
        "priority_rank": ticket.priority_rank,
        "ticket_type": ticket.ticket_type,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "events": [
            {
                "event_type": e.event_type,
                "payload": e.event_payload,
                "is_public": e.is_public,
                "prev_hash": e.prev_hash,
                "hash": e.hash,
                "created_at": e.created_at,
            }
            for e in events
        ],
        "group_routes": [
            {
                "id": route.id,
                "group_id": group.id,
                "group_code": group.code,
                "group_name": group.name,
                "reason": route.reason,
                "comment": (meta := _unpack_route_payload(route.comment)).get("comment"),
                "priority": meta.get("priority"),
                "note": meta.get("note"),
                "status": route.status,
                "created_at": route.created_at,
                "updated_at": route.updated_at,
            }
            for route, group in routed_groups
        ],
        "attachments": [
            {
                "file_id": file.id,
                "kind": link.kind,
                "filename_original": file.filename_original,
                "mime": file.mime,
                "size_bytes": file.size_bytes,
                "download_url": f"/api/files/{file.id}/download",
                "created_at": file.created_at,
            }
            for link, file in attachments
        ],
    }


@router.post("/tickets/{ticket_id}/triage")
def triage_ticket(
    ticket_id: int,
    payload: TriageIn,
    _: User = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")

    group_payload: dict | None = None
    department = (payload.department or "").strip()
    if payload.group_id is not None:
        group = db.get(TicketGroup, payload.group_id)
        if not group or not group.active:
            raise HTTPException(status_code=404, detail="ticket group not found")
        group_payload = {"group_id": group.id, "group_code": group.code, "group_name": group.name}
        if not department:
            department = group.name
    if not department:
        raise HTTPException(status_code=400, detail="department or group is required")
    if payload.priority < 0 or payload.priority > 6:
        raise HTTPException(status_code=400, detail="priority must be between 0 and 6")

    ticket.department = department
    ticket.priority_rank = payload.priority
    ticket.ticket_type = payload.ticket_type
    ticket.status = "QUEUED"
    ticket.updated_at = datetime.now(timezone.utc)

    event_payload = payload.model_dump()
    event_payload["department"] = department
    if group_payload:
        event_payload.update(group_payload)
    append_ticket_event(db, ticket.id, "TicketTriaged", event_payload, actor_ref="internal", is_public=False)
    append_ticket_event(db, ticket.id, "TicketStatusChanged", {"status": "QUEUED"}, actor_ref="internal")
    enqueue_outbox(db, "ticket", ticket.id, "TicketTriaged", {"ticket_id": ticket.id})
    db.commit()
    return {"id": ticket.id, "status": ticket.status}


@router.post("/tickets/{ticket_id}/route-groups")
def route_ticket_groups(
    ticket_id: int,
    payload: GroupRouteIn,
    user: User = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")
    if not payload.targets:
        raise HTTPException(status_code=400, detail="targets required")
    if ticket.status in {"NEW", "TRIAGE"} or not ticket.department or ticket.priority_rank is None or not ticket.ticket_type:
        raise HTTPException(status_code=409, detail="ticket must be triaged before routing groups")

    routed: list[dict] = []
    now = datetime.now(timezone.utc)
    for target in payload.targets:
        group = db.get(TicketGroup, target.group_id)
        if not group or not group.active:
            raise HTTPException(status_code=404, detail=f"ticket group {target.group_id} not found")
        priority = target.priority if target.priority is not None else 3
        if priority < 0 or priority > 6:
            raise HTTPException(status_code=400, detail="priority must be between 0 and 6")

        route = db.scalar(
            select(TicketGroupRoute).where(TicketGroupRoute.ticket_id == ticket_id, TicketGroupRoute.group_id == group.id)
        )
        if not route:
            route = TicketGroupRoute(
                ticket_id=ticket_id,
                group_id=group.id,
                reason=(target.reason or "").strip() or None,
                comment=_pack_route_payload(target.comment, priority, target.note),
                status="OPEN",
                created_by_user_id=user.id,
                created_at=now,
                updated_at=now,
            )
            db.add(route)
        else:
            route.reason = (target.reason or "").strip() or None
            route.comment = _pack_route_payload(target.comment, priority, target.note)
            route.status = "OPEN"
            route.updated_at = now

        route_meta = _unpack_route_payload(route.comment)
        append_ticket_event(
            db,
            ticket.id,
            "TicketGroupRouted",
            {
                "group_id": group.id,
                "group_code": group.code,
                "group_name": group.name,
                "reason": route.reason,
                "comment": route_meta.get("comment"),
                "priority": route_meta.get("priority"),
                "note": route_meta.get("note"),
            },
            actor_ref="internal",
            is_public=False,
        )
        enqueue_outbox(
            db,
            "ticket",
            ticket.id,
            "TicketGroupRouted",
            {"ticket_id": ticket.id, "group_id": group.id, "group_code": group.code},
        )
        routed.append(
            {
                "group_id": group.id,
                "group_code": group.code,
                "group_name": group.name,
                "reason": route.reason,
                "comment": route_meta.get("comment"),
                "priority": route_meta.get("priority"),
                "note": route_meta.get("note"),
                "status": route.status,
            }
        )

    ticket.updated_at = now
    db.commit()
    return {"ticket_id": ticket.id, "routes": routed}


@router.delete("/tickets/{ticket_id}/route-groups/{group_id}")
def remove_ticket_group_route(
    ticket_id: int,
    group_id: int,
    _: User = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")
    route = db.scalar(
        select(TicketGroupRoute).where(TicketGroupRoute.ticket_id == ticket_id, TicketGroupRoute.group_id == group_id)
    )
    if not route:
        raise HTTPException(status_code=404, detail="group route not found")
    if ticket.status in STARTED_TICKET_STATUSES:
        raise HTTPException(status_code=409, detail="group route cannot be removed after work has started")

    group = db.get(TicketGroup, group_id)
    db.delete(route)
    ticket.updated_at = datetime.now(timezone.utc)
    append_ticket_event(
        db,
        ticket.id,
        "TicketGroupRouteRemoved",
        {
            "group_id": group_id,
            "group_code": group.code if group else None,
            "group_name": group.name if group else None,
        },
        actor_ref="internal",
        is_public=False,
    )
    enqueue_outbox(db, "ticket", ticket.id, "TicketGroupRouteRemoved", {"ticket_id": ticket.id, "group_id": group_id})
    db.commit()
    return {"ticket_id": ticket.id, "removed_group_id": group_id}


@router.post("/tickets/{ticket_id}/assign")
def assign_ticket(
    ticket_id: int,
    payload: AssignIn,
    _: User = Depends(require_roles("Admin", "Dispatcher")),
    db: Session = Depends(get_db),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")

    assignee = db.scalar(select(User).where(User.username == payload.assignee_username))
    if not assignee:
        raise HTTPException(status_code=404, detail="assignee not found")

    ticket.assignee_user_id = assignee.id
    ticket.updated_at = datetime.now(timezone.utc)
    db.add(TicketAssignment(ticket_id=ticket.id, user_id=assignee.id))
    append_ticket_event(db, ticket.id, "TicketAssigned", {"assignee": assignee.username}, actor_ref="internal", is_public=False)
    enqueue_outbox(db, "ticket", ticket.id, "TicketAssigned", {"ticket_id": ticket.id})
    db.commit()
    return {"id": ticket.id, "assignee": assignee.username}


@router.post("/tickets/{ticket_id}/status")
def change_status(
    ticket_id: int,
    payload: StatusIn,
    user: User = Depends(require_roles("Admin", "Dispatcher", "Agent")),
    db: Session = Depends(get_db),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")

    roles = get_user_roles(db, user.id)
    status_new = payload.status.upper()
    if "Agent" in roles and "Admin" not in roles and "Dispatcher" not in roles:
        if status_new not in {"IN_PROGRESS", "CLOSED"}:
            raise HTTPException(status_code=403, detail="agents may only set IN_PROGRESS or CLOSED")
    if ticket.status == "CLOSED" and status_new == "IN_PROGRESS":
        raise HTTPException(status_code=400, detail="forbidden transition")

    ticket.status = status_new
    ticket.updated_at = datetime.now(timezone.utc)

    event_payload = {"status": status_new}
    if payload.reason:
        event_payload["reason"] = payload.reason
    if status_new == "CANCELLED" and payload.reason == "WRONG_PLANT_LINK":
        status_new = "CANCELLED_WRONG_PLANT"
        ticket.status = status_new
        ticket.wrong_plant_reason = "WRONG_PLANT_LINK"
        event_payload["suggested_create_url"] = "/Tickets/MS_DEMO_ANLAGE_01"
        append_ticket_event(db, ticket.id, "TicketCancelledWrongPlant", event_payload, actor_ref="internal")
    else:
        append_ticket_event(db, ticket.id, "TicketStatusChanged", event_payload, actor_ref="internal")

    if payload.public_comment:
        append_ticket_event(db, ticket.id, "TicketCommentAdded", {"message": payload.public_comment}, actor_ref="internal")

    enqueue_outbox(db, "ticket", ticket.id, "TicketStatusChanged", {"ticket_id": ticket.id, "status": ticket.status})
    db.commit()
    return {"id": ticket.id, "status": ticket.status}


@router.post("/tickets/{ticket_id}/attachments", status_code=201)
def internal_ticket_attachment(
    ticket_id: int,
    _: User = Depends(require_roles("Admin", "Dispatcher", "Agent")),
    kind: str = Form("FILE"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")

    settings = get_settings()
    saved = save_upload(file, settings.files_dir / "tickets" / str(ticket_id), settings.upload_max_bytes)
    record = DbFile(
        storage_name=str(saved["storage_name"]),
        filename_original=str(saved["filename_original"]),
        mime=str(saved["mime"]),
        size_bytes=int(saved["size_bytes"]),
        sha256=str(saved["sha256"]),
        path=str(saved["path"]),
    )
    db.add(record)
    db.flush()
    db.add(FileLink(file_id=record.id, scope_type="ticket", scope_id=ticket_id, kind=kind.upper()))

    append_ticket_event(db, ticket.id, "TicketAttachmentAdded", {"file_id": record.id}, actor_ref="internal", is_public=False)
    enqueue_outbox(db, "ticket", ticket.id, "TicketAttachmentAdded", {"ticket_id": ticket.id, "file_id": record.id})
    db.commit()
    return {"attachment_id": record.id}


@router.get("/files/{file_id}/download")
def download_internal_file(
    file_id: int,
    user: User = Depends(require_roles("Admin", "Dispatcher", "Agent")),
    db: Session = Depends(get_db),
):
    record = db.get(DbFile, file_id)
    if not record:
        raise HTTPException(status_code=404, detail="file not found")

    roles = get_user_roles(db, user.id)
    if "Agent" in roles and "Admin" not in roles and "Dispatcher" not in roles:
        links = db.scalars(select(FileLink).where(FileLink.file_id == file_id)).all()
        ticket_ids = [link.scope_id for link in links if link.scope_type == "ticket"]
        if not ticket_ids:
            raise HTTPException(status_code=403, detail="file access denied")
        routed_ids = (
            select(TicketGroupRoute.ticket_id)
            .join(TicketGroupMember, TicketGroupMember.group_id == TicketGroupRoute.group_id)
            .where(TicketGroupMember.user_id == user.id)
        )
        allowed = db.scalar(
            select(func.count())
            .select_from(Ticket)
            .where(Ticket.id.in_(ticket_ids))
            .where(or_(Ticket.assignee_user_id == user.id, Ticket.id.in_(routed_ids)))
        ) or 0
        if allowed < 1:
            raise HTTPException(status_code=403, detail="file access denied")

    settings = get_settings()
    file_path = Path(record.path).resolve()
    files_root = settings.files_dir.resolve()
    if not str(file_path).startswith(str(files_root)):
        raise HTTPException(status_code=404, detail="file not found")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    return FileResponse(path=file_path, media_type=record.mime, filename=record.filename_original)

