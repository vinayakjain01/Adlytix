# ╔══════════════════════════════════════════════════════════════════════╗
# ║  sync/models.py  —  Postgres-backed job queue (Phase 7)              ║
# ║                                                                      ║
# ║  Confirmed design: no Redis. A worker claims a row with              ║
# ║  `SELECT ... FOR UPDATE SKIP LOCKED`, which is what makes a plain     ║
# ║  Postgres table safe for multiple worker processes to poll            ║
# ║  concurrently without double-processing the same job — see            ║
# ║  sync/service.py::claim_next_job.                                     ║
# ╚══════════════════════════════════════════════════════════════════════╝

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SyncStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SyncJob(Base):
    """
    One independently retryable unit of work (Section 19 of the architecture
    brief — never one "sync everything" job). `sync_type` values are defined
    by whichever phase creates them (e.g. "products_sync", "orders_sync" in
    Phase 3); this table itself is provider- and sync-type-agnostic.
    """

    __tablename__ = "sync_jobs"
    __table_args__ = (
        Index("ix_sync_jobs_claim", "status", "next_attempt_at"),
        Index("ix_sync_jobs_client_created", "client_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    sync_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[SyncStatus] = mapped_column(
        SAEnum(SyncStatus, name="sync_job_status", native_enum=False, length=20),
        nullable=False, default=SyncStatus.PENDING,
    )
    # Resumable pagination checkpoint (e.g. a Shopify page_info cursor or a
    # Meta Graph API `after` token) — set by the worker mid-job so a retry
    # after a crash resumes instead of restarting from page one.
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)

    records_fetched: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    # NULL = eligible to be claimed now. Set to a future time on retry
    # (exponential backoff) so a failing job doesn't spin the worker loop.
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class WebhookEventStatus(str, enum.Enum):
    RECEIVED = "received"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"


class WebhookEvent(Base):
    """
    Inbound provider webhooks. The HTTP handler that receives one does the
    absolute minimum — verify signature, resolve tenant, insert this row,
    return 200 (Section 13) — and a worker processes it later. `integration_id`
    is nullable because a webhook for a shop/account we don't recognise
    (e.g. arriving after a stale registration) is still recorded for
    debugging rather than silently dropped.
    """

    __tablename__ = "webhook_events"
    __table_args__ = (
        UniqueConstraint("provider", "external_event_id", name="uq_webhook_events_provider_event"),
        Index("ix_webhook_events_status", "status"),
        Index("ix_webhook_events_client_received", "client_id", "received_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="SET NULL"), nullable=True
    )
    client_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    topic: Mapped[str] = mapped_column(String(100), nullable=False)
    # Provider's own event/delivery id (e.g. Shopify's X-Shopify-Webhook-Id).
    # NULL is allowed — Postgres treats each NULL as distinct in the unique
    # constraint above, so undeduped events without a provider id simply
    # aren't deduplicated, which is an acceptable edge case, not a silent bug.
    external_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[WebhookEventStatus] = mapped_column(
        SAEnum(WebhookEventStatus, name="webhook_event_status", native_enum=False, length=20),
        nullable=False, default=WebhookEventStatus.RECEIVED,
    )
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )
