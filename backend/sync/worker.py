# ╔══════════════════════════════════════════════════════════════════════╗
# ║  sync/worker.py  —  Polling worker over sync_jobs / webhook_events    ║
# ║                                                                      ║
# ║  Run continuously with `python -m sync.worker` (production), or once  ║
# ║  with `--once` (local testing / cron-triggered environments). No      ║
# ║  queue infrastructure beyond Postgres itself — see sync/models.py.    ║
# ║                                                                      ║
# ║  Provider sync handlers do real (async, httpx-based) network I/O, so  ║
# ║  the whole cycle is async; only argparse/entrypoint stays sync.       ║
# ╚══════════════════════════════════════════════════════════════════════╝

import argparse
import asyncio
import logging
import os
import sys

# Loads backend/.env before `from db import ...` resolves DATABASE_URL — same
# requirement as main.py (see its comment). Run as a separate process from
# the API, so it needs this independently; nothing else loads it for it.
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from db import SessionLocal  # noqa: E402
from integrations import service as integration_service
from integrations.models import Integration
from meta import sync as meta_sync
from shopify import sync as shopify_sync
from sync import service as sync_service
from sync.models import SyncJob, WebhookEvent

log = logging.getLogger("adlytix.worker")

# ── Webhook topic handlers ──────────────────────────────────────────
TOPIC_HANDLERS = {}


def topic_handler(topic: str):
    def register(fn):
        TOPIC_HANDLERS[topic] = fn
        return fn
    return register


@topic_handler("app/uninstalled")
def handle_app_uninstalled(db, event: WebhookEvent) -> None:
    """
    Shopify fires this when a merchant removes the app from their admin —
    the access token is already invalid on Shopify's side at that point.
    Mirrors Section 54 of the architecture brief: disconnect, keep history.
    """
    if not event.integration_id:
        log.info("app/uninstalled for an unrecognised shop — nothing to disconnect.")
        return
    integration = db.get(Integration, event.integration_id)
    if integration is not None and integration.status.value != "disconnected":
        integration_service.disconnect(db, integration)


# ── sync_jobs handlers ──────────────────────────────────────────────
# sync_type -> async fn(db, job, integration, credentials) -> counts dict
SYNC_HANDLERS = {
    "products_sync": shopify_sync.run_products_sync,
    "orders_sync": shopify_sync.run_orders_sync,
    "campaigns_sync": meta_sync.run_campaigns_sync,
    "insights_sync": meta_sync.run_insights_sync,
    "product_insights_sync": meta_sync.run_product_insights_sync,
}


async def _handle_webhook_event(event_id: str) -> None:
    with SessionLocal() as db:
        event = db.get(WebhookEvent, event_id)
        if event is None:
            return
        try:
            TOPIC_HANDLERS[event.topic](db, event)
            sync_service.mark_webhook_processed(db, event)
            db.commit()
        except Exception as exc:
            db.rollback()
            log.exception("webhook event %s (%s) failed", event_id, event.topic)
            with SessionLocal() as db2:
                failed = db2.get(WebhookEvent, event_id)
                if failed is not None:
                    sync_service.mark_webhook_failed(db2, failed, str(exc))
                    db2.commit()


async def _handle_job(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(SyncJob, job_id)
        if job is None:
            return
        handler = SYNC_HANDLERS.get(job.sync_type)
        integration = db.get(Integration, job.integration_id)

        if handler is None:
            sync_service.mark_failed(db, job, f"No handler implemented for sync_type={job.sync_type!r}.")
            db.commit()
            return
        if integration is None:
            sync_service.mark_failed(db, job, "The integration for this job no longer exists.")
            db.commit()
            return

        try:
            credentials = integration_service.get_credentials(integration)
            counts = await handler(db, job, integration, credentials)
            sync_service.mark_completed(db, job, **counts)
            integration.last_sync_at = job.completed_at
            db.commit()
        except Exception as exc:
            db.rollback()
            log.exception("sync job %s (%s) failed", job_id, job.sync_type)
            with SessionLocal() as db2:
                failed = db2.get(SyncJob, job_id)
                if failed is not None:
                    sync_service.mark_failed(db2, failed, str(exc))
                    db2.commit()


async def process_one_cycle() -> bool:
    """Claims and processes at most one unit of work. Returns whether it found one."""
    with SessionLocal() as db:
        event = sync_service.claim_next_webhook_event(db, known_topics=set(TOPIC_HANDLERS))
        if event is not None:
            event_id = event.id
            db.commit()  # release the claim before the (possibly slow) handler runs
            await _handle_webhook_event(event_id)
            return True

        job = sync_service.claim_next_job(db)
        if job is not None:
            job_id = job.id
            db.commit()
            await _handle_job(job_id)
            return True

    return False


async def run_forever(poll_interval: float = 5.0) -> None:
    log.info(
        "worker started, polling every %ss (webhook topics: %s, sync types: %s)",
        poll_interval, list(TOPIC_HANDLERS), list(SYNC_HANDLERS),
    )
    while True:
        try:
            processed = await process_one_cycle()
        except Exception:
            log.exception("worker cycle failed")
            processed = False
        if not processed:
            await asyncio.sleep(poll_interval)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    # httpx logs each request's full URL at INFO level. Meta's Graph API
    # takes the access_token as a query parameter (Shopify's Admin API uses
    # a header instead), so at INFO level every Meta call wrote a live
    # access token straight into this process's logs — confirmed happening
    # in practice. WARNING leaves error-level httpx logging intact while
    # dropping the per-request URL line entirely.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(description="Adlytix background sync/webhook worker")
    parser.add_argument(
        "--once", action="store_true",
        help="process a single job/event and exit, instead of polling forever",
    )
    args = parser.parse_args()

    if args.once:
        found = asyncio.run(process_one_cycle())
        print("processed one item" if found else "nothing to do")
    else:
        asyncio.run(run_forever())
