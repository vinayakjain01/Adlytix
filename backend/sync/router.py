# ╔══════════════════════════════════════════════════════════════════════╗
# ║  sync/router.py  —  /api/v1/sync                                     ║
# ║                                                                      ║
# ║  Read-only polling for the frontend's sync-progress UI. Jobs         ║
# ║  themselves are only ever created by a provider's /sync trigger      ║
# ║  endpoint (shopify_router.py, meta_router.py) and processed by       ║
# ║  sync/worker.py — this just lets the browser watch them.             ║
# ╚══════════════════════════════════════════════════════════════════════╝

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import require_client_scope
from db import get_db
from models import User
from sync.models import SyncJob

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
