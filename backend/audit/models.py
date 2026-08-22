# ╔══════════════════════════════════════════════════════════════════════╗
# ║  audit/models.py  —  Append-only record of important actions         ║
# ╚══════════════════════════════════════════════════════════════════════╝

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditLog(Base):
    """
    One row per notable action (Section 37 of the architecture brief):
    integration_connected, integration_disconnected, sync_started,
    sync_completed, sync_failed, user_created, role_changed, etc.

    `client_id` is nullable because a few actions are platform-level (an
    administrator creating a client has no client of its own yet at the
    moment of that action). `metadata_json` never contains secrets — it is
    written by application code that must not put tokens/passwords in it.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_client_created", "client_id", "created_at"),
        Index("ix_audit_logs_action", "action"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    client_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
