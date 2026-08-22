# ╔══════════════════════════════════════════════════════════════════════╗
# ║  sync/service.py  —  Job lifecycle and idempotent webhook recording  ║
# ╚══════════════════════════════════════════════════════════════════════╝

import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from sync.models import SyncJob, SyncStatus, WebhookEvent, WebhookEventStatus


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _backoff(attempt: int) -> datetime:
    """Exponential backoff with jitter: ~30s, 60s, 120s, 240s, ... capped at 1h."""
    base = min(30 * (2 ** attempt), 3600)
    jitter = random.uniform(0, base * 0.2)
    return _utcnow() + timedelta(seconds=base + jitter)


# ── Sync jobs ────────────────────────────────────────────────────────
def create_job(
    db: Session, *, client_id: str, integration_id: str, provider: str, sync_type: str,
    cursor: str | None = None,
) -> SyncJob:
    job = SyncJob(
        client_id=client_id, integration_id=integration_id, provider=provider,
        sync_type=sync_type, status=SyncStatus.PENDING, cursor=cursor,
    )
    db.add(job)
    db.flush()
    return job


def claim_next_job(db: Session) -> SyncJob | None:
    """
    Atomically claims one eligible job for this worker. `SKIP LOCKED` is what
    makes this safe with multiple worker processes polling concurrently — a
    row already locked by another worker's transaction is simply skipped,
    not waited on. Caller must commit promptly to release the lock.
    """
    job = db.execute(
        select(SyncJob)
        .where(
            SyncJob.status == SyncStatus.PENDING,
            (SyncJob.next_attempt_at.is_(None)) | (SyncJob.next_attempt_at <= _utcnow()),
        )
        .order_by(SyncJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()

    if job is not None:
        job.status = SyncStatus.RUNNING
        job.started_at = _utcnow()
        job.attempt += 1
    return job


def mark_completed(
    db: Session, job: SyncJob, *, records_fetched: int = 0, records_created: int = 0,
    records_updated: int = 0, records_failed: int = 0,
) -> SyncJob:
    job.status = SyncStatus.COMPLETED
    job.completed_at = _utcnow()
    job.records_fetched = records_fetched
    job.records_created = records_created
    job.records_updated = records_updated
    job.records_failed = records_failed
    job.error = None
    return job


def mark_failed(db: Session, job: SyncJob, error: str) -> SyncJob:
    """
    Retries with backoff while attempts remain, otherwise marks the job
    terminally failed. Never retries indefinitely (Section 32 of the
    architecture brief).
    """
    job.error = error[:2000]
    if job.attempt < job.max_attempts:
        job.status = SyncStatus.PENDING
        job.next_attempt_at = _backoff(job.attempt)
    else:
        job.status = SyncStatus.FAILED
        job.completed_at = _utcnow()
    return job


# ── Webhook events ───────────────────────────────────────────────────
def record_webhook_event(
    db: Session, *, provider: str, topic: str, payload: dict,
    integration_id: str | None, client_id: str | None, external_event_id: str | None,
) -> WebhookEvent | None:
    """
    Idempotent insert: if `external_event_id` was already recorded for this
    provider, returns None instead of a duplicate row (Section 14 — a
    redelivered event must be safely ignored, not reprocessed). Uses
    INSERT ... ON CONFLICT DO NOTHING so this is atomic even under concurrent
    deliveries, not a check-then-insert race.
    """
    stmt = (
        pg_insert(WebhookEvent)
        .values(
            provider=provider, topic=topic, payload=payload,
            integration_id=integration_id, client_id=client_id,
            external_event_id=external_event_id, status=WebhookEventStatus.RECEIVED,
        )
        .on_conflict_do_nothing(constraint="uq_webhook_events_provider_event")
        .returning(WebhookEvent.id)
    )
    row_id = db.execute(stmt).scalar_one_or_none()
    db.flush()
    if row_id is None:
        return None
    return db.get(WebhookEvent, row_id)


def claim_next_webhook_event(db: Session, *, known_topics: set[str]) -> WebhookEvent | None:
    """
    Only claims topics this worker actually has a handler for
    (`known_topics`) — everything else stays `received` indefinitely,
    durably queued rather than falsely marked processed, until a later
    phase adds its handler. See sync/worker.py.
    """
    if not known_topics:
        return None
    event = db.execute(
        select(WebhookEvent)
        .where(WebhookEvent.status == WebhookEventStatus.RECEIVED, WebhookEvent.topic.in_(known_topics))
        .order_by(WebhookEvent.received_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if event is not None:
        event.status = WebhookEventStatus.PROCESSING
    return event


def mark_webhook_processed(db: Session, event: WebhookEvent) -> WebhookEvent:
    event.status = WebhookEventStatus.PROCESSED
    event.processed_at = _utcnow()
    event.error = None
    return event


def mark_webhook_failed(db: Session, event: WebhookEvent, error: str) -> WebhookEvent:
    event.status = WebhookEventStatus.FAILED
    event.retry_count += 1
    event.error = error[:2000]
    return event
