# ╔══════════════════════════════════════════════════════════════════════╗
# ║  sync/router.py  —  /api/v1/sync                                     ║
# ║                                                                      ║
# ║  Read-only polling for the frontend's sync-progress UI. Jobs         ║
# ║  themselves are only ever created by a provider's /sync trigger      ║
# ║  endpoint (shopify_router.py, meta_router.py) and processed by       ║
# ║  sync/worker.py — this just lets the browser watch them.             ║
# ╚══════════════════════════════════════════════════════════════════════╝

import hmac
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import require_client_scope
from db import SessionLocal, get_db
from models import User
from sync import service as sync_service
from sync.models import SyncJob, SyncStatus

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


class SyncJobOut(BaseModel):
    id: str
    provider: str
    syncType: str
    status: str
    recordsFetched: int
    attempt: int
    maxAttempts: int
    error: str | None = None


@router.get("/jobs", response_model=list[SyncJobOut])
def get_jobs(
    ids: str = Query(..., description="Comma-separated sync_job ids"),
    user: User = Depends(require_client_scope),
    db: Session = Depends(get_db),
) -> list[SyncJobOut]:
    """
    Status for a set of job ids the caller already knows about (returned by
    a /sync trigger call) — never a listing endpoint, and always filtered to
    the caller's own tenant regardless of which ids were requested, so one
    client can never poll another's job ids into existence.
    """
    job_ids = [j.strip() for j in ids.split(",") if j.strip()]
    if not job_ids:
        return []

    jobs = db.execute(
        select(SyncJob).where(SyncJob.client_id == user.client_id, SyncJob.id.in_(job_ids))
    ).scalars().all()

    return [
        SyncJobOut(
            id=j.id, provider=j.provider, syncType=j.sync_type, status=j.status.value,
            recordsFetched=j.records_fetched, attempt=j.attempt, maxAttempts=j.max_attempts,
            error=j.error,
        )
        for j in jobs
    ]


# ── Serverless job processing ───────────────────────────────────────────
# On Vercel there is no always-on `python -m sync.worker` process, so jobs are
# processed inside a request instead: by the user's own "sync" action (POST
# /process) and by a daily Vercel cron (GET /cron). Both run the same loop as
# the worker, claim jobs with SKIP LOCKED, and stop starting new work once the
# time budget is spent — so they are safe to run alongside a real worker.

log = logging.getLogger("adlytix.sync")

# Stay under the platform's function time limit. A single job that runs longer
# than this can still be cut off; it is re-queued by _requeue_stuck_jobs.
RUN_BUDGET_SECONDS = float(os.getenv("SYNC_RUN_BUDGET_SECONDS", "45"))
STUCK_AFTER = timedelta(minutes=10)


def _requeue_stuck_jobs(db: Session) -> int:
    """
    A job whose function was killed mid-run stays RUNNING forever. Anything
    RUNNING for longer than STUCK_AFTER goes back through the normal retry /
    give-up path.
    """
    cutoff = datetime.now(timezone.utc) - STUCK_AFTER
    stuck = db.execute(
        select(SyncJob).where(SyncJob.status == SyncStatus.RUNNING, SyncJob.started_at < cutoff)
    ).scalars().all()
    for job in stuck:
        sync_service.mark_failed(db, job, "Interrupted (the function was stopped before this job finished).")
    db.commit()
    return len(stuck)


async def _process_pending(budget: float = RUN_BUDGET_SECONDS) -> dict:
    # Imported here: the worker pulls in every provider's sync module.
    from sync.worker import process_one_cycle

    with SessionLocal() as db:
        requeued = _requeue_stuck_jobs(db)

    started = time.monotonic()
    processed = 0
    while time.monotonic() - started < budget:
        try:
            if not await process_one_cycle():
                break
        except Exception:  # one bad job must not stop the loop
            log.exception("sync cycle failed")
            break
        processed += 1
    return {"processed": processed, "requeued": requeued}


@router.post("/process")
async def process_now(user: User = Depends(require_client_scope)) -> dict:
    """Runs pending sync jobs now. Called by the app right after a sync is queued."""
    return await _process_pending()


@router.get("/cron")
async def cron(authorization: str | None = Header(default=None)) -> dict:
    """
    Daily Vercel cron: queues a fresh sync for every connected Meta/Shopify
    integration, then processes what it can. Vercel sends
    `Authorization: Bearer $CRON_SECRET`; with no CRON_SECRET set the endpoint
    is closed rather than open.
    """
    secret = os.getenv("CRON_SECRET", "")
    expected = f"Bearer {secret}"
    if not secret or not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    from integrations.meta_router import SYNC_TYPES as META_TYPES
    from integrations.models import Integration, IntegrationStatus, Provider
    from integrations.shopify_router import SYNC_TYPES as SHOPIFY_TYPES

    plan = {Provider.META: ("meta", META_TYPES), Provider.SHOPIFY: ("shopify", SHOPIFY_TYPES)}
    queued = 0
    with SessionLocal() as db:
        rows = db.execute(
            select(Integration).where(Integration.status == IntegrationStatus.CONNECTED)
        ).scalars().all()
        for integration in rows:
            if integration.provider not in plan:
                continue
            if integration.provider == Provider.META and not integration.external_account_id:
                continue
            provider, types = plan[integration.provider]
            for sync_type in types:
                sync_service.create_job(
                    db, client_id=integration.client_id, integration_id=integration.id,
                    provider=provider, sync_type=sync_type,
                )
                queued += 1
        db.commit()

    return {"queued": queued, **await _process_pending()}
