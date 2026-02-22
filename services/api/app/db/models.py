from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


UTC_NOW = lambda: datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Plant(Base):
    __tablename__ = "plants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    area_prefix: Mapped[str] = mapped_column(String(8), default="MS")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class Area(Base):
    __tablename__ = "areas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(100))


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    force_password_change: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class UserDepartment(Base):
    __tablename__ = "user_departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    area_code: Mapped[str] = mapped_column(String(16))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class UserDepartmentMembership(Base):
    __tablename__ = "user_department_memberships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    area_code: Mapped[str] = mapped_column(String(16), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)

    __table_args__ = (UniqueConstraint("user_id", "area_code", name="uq_user_department_membership"),)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(120), unique=True)


class UserRole(Base):
    __tablename__ = "user_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))

    __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_role"),)


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    permission_id: Mapped[int] = mapped_column(ForeignKey("permissions.id", ondelete="CASCADE"))

    __table_args__ = (UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),)


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(120), unique=True)
    scope: Mapped[str] = mapped_column(String(120))
    response_body: Mapped[str] = mapped_column(Text)
    status_code: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class ShiftEntry(Base):
    __tablename__ = "shift_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), index=True)
    author_name: Mapped[str] = mapped_column(String(200))
    author_token_hash: Mapped[str] = mapped_column(String(128), index=True)
    subject: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(60), default="ACTIVE")
    shift_id: Mapped[str] = mapped_column(String(64), index=True)
    editable_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)

    plant: Mapped[Plant] = relationship()


class ShiftEntryEvent(Base):
    __tablename__ = "shift_entry_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("shift_entries.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(120))
    event_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    actor_ref: Mapped[str] = mapped_column(String(255))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class File(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    storage_name: Mapped[str] = mapped_column(String(255), unique=True)
    filename_original: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    path: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class FileLink(Base):
    __tablename__ = "file_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    scope_type: Mapped[str] = mapped_column(String(60))
    scope_id: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(60), default="FILE")


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), index=True)
    requester_name: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(60), default="NEW", index=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    priority_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ticket_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    area: Mapped[str] = mapped_column(String(16), index=True)
    assignee_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    wrong_plant_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class TicketGroup(Base):
    __tablename__ = "ticket_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class TicketGroupMember(Base):
    __tablename__ = "ticket_group_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("ticket_groups.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)

    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_ticket_group_member"),)


class TicketGroupRoute(Base):
    __tablename__ = "ticket_group_routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("ticket_groups.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="OPEN")
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)

    __table_args__ = (UniqueConstraint("ticket_id", "group_id", name="uq_ticket_group_route"),)


class TicketEvent(Base):
    __tablename__ = "ticket_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(120))
    event_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    actor_ref: Mapped[str] = mapped_column(String(255))
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class TicketPublicToken(Base):
    __tablename__ = "ticket_public_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), unique=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class TicketAssignment(Base):
    __tablename__ = "ticket_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    aggregate_type: Mapped[str] = mapped_column(String(60))
    aggregate_id: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(120))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class Delivery(Base):
    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outbox_event_id: Mapped[int] = mapped_column(ForeignKey("outbox_events.id", ondelete="CASCADE"), index=True)
    target: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class DeadLetterDelivery(Base):
    __tablename__ = "dead_letter_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    delivery_id: Mapped[int] = mapped_column(Integer)
    target: Mapped[str] = mapped_column(String(300))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class ReportRun(Base):
    __tablename__ = "report_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    requested_by: Mapped[str] = mapped_column(String(120))
    plant_slug: Mapped[str] = mapped_column(String(120))
    range_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    range_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReportArtifact(Base):
    __tablename__ = "report_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_run_id: Mapped[int] = mapped_column(ForeignKey("report_runs.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(16))
    mime_type: Mapped[str] = mapped_column(String(120))
    path: Mapped[str] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class ReportSchedule(Base):
    __tablename__ = "report_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    cron_type: Mapped[str] = mapped_column(String(16))
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Berlin")
    plant_slug: Mapped[str] = mapped_column(String(120))
    formats_json: Mapped[list] = mapped_column(JSON, default=list)
    recipients_json: Mapped[list] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class ReportScheduleFilter(Base):
    __tablename__ = "report_schedule_filters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("report_schedules.id", ondelete="CASCADE"), unique=True, index=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ticket_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    report_kind: Mapped[str] = mapped_column(String(32), default="tickets")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class ReportDelivery(Base):
    __tablename__ = "report_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_run_id: Mapped[int] = mapped_column(ForeignKey("report_runs.id", ondelete="CASCADE"), index=True)
    recipient: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)


class OpsHealthSnapshot(Base):
    __tablename__ = "ops_health_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)
    db_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    disk_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    backlog: Mapped[int] = mapped_column(Integer, default=0)
    response_ms: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class OpsErrorIndex(Base):
    __tablename__ = "ops_error_index"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=UTC_NOW)
    route: Mapped[str] = mapped_column(String(255))
    trace_id: Mapped[str] = mapped_column(String(64), index=True)
    exception_type: Mapped[str] = mapped_column(String(120))
    message: Mapped[str] = mapped_column(Text)
    file_ref: Mapped[str] = mapped_column(String(255), default="")
    status_code: Mapped[int] = mapped_column(Integer, default=500)
