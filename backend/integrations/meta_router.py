# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/meta_router.py  —  /api/v1/meta/*                      ║
# ║                                                                      ║
# ║  Meta's OAuth authenticates the user before any specific ad account   ║
# ║  is known — account discovery/selection is a separate step after      ║
# ║  the callback (Section 16 of the architecture brief), unlike          ║
# ║  Shopify where the shop is chosen up front.                           ║
# ╚══════════════════════════════════════════════════════════════════════╝

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import require_client_scope
from db import get_db, SessionLocal
from integrations import oauth_state, service
from integrations.models import Integration, IntegrationStatus, Provider
from integrations.providers.meta import MetaOAuthError, MetaProvider
from models import User
from sync import service as sync_service

router = APIRouter(prefix="/api/v1/meta", tags=["meta"])
SYNC_TYPES = ("campaigns_sync", "insights_sync", "product_insights_sync")
log = logging.getLogger("adlytix.meta")


def _redirect_uri() -> str:
    base = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/meta/callback"


def _frontend_redirect(status_: str, *, message: str | None = None) -> str:
    base = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    url = f"{base}/integrations?integration=meta&status={status_}"
    if message:
        from urllib.parse import quote
        url += f"&message={quote(message)}"
    return url


@router.get("/connect")
def connect(user: User = Depends(require_client_scope)) -> RedirectResponse:
    try:
        provider = MetaProvider()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    state = oauth_state.create_state(provider="meta", client_id=user.client_id, user_id=user.id)
    url = provider.get_authorization_url(state=state, redirect_uri=_redirect_uri())
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND)


@router.get("/callback")
async def callback(request: Request) -> RedirectResponse:
    params = dict(request.query_params)
    if params.get("error"):
        # The user declined consent on Meta's side — not a bug, just decline.
        return RedirectResponse(_frontend_redirect("cancelled"))

    code = params.get("code", "")
    state_token = params.get("state", "")

    try:
        provider = MetaProvider()
        state_payload = oauth_state.verify_state(state_token, provider="meta")
        client_id = state_payload["client_id"]
        user_id = state_payload.get("user_id")
        credentials = await provider.exchange_code_for_token(code=code, redirect_uri=_redirect_uri())
    except (MetaOAuthError, oauth_state.InvalidOAuthState) as exc:
        log.warning("Meta OAuth callback rejected: %s", exc)
        return RedirectResponse(_frontend_redirect("error", message=str(exc)))
    except RuntimeError as exc:
        return RedirectResponse(_frontend_redirect("error", message=str(exc)))
    except Exception:
        log.exception("Meta OAuth callback failed unexpectedly")
        return RedirectResponse(_frontend_redirect("error", message="Connection failed. Try again."))

    with SessionLocal() as db:
        integration = service.find_awaiting_account_selection(db, client_id, Provider.META)
        if integration is None:
            integration = service.create_pending(db, client_id, Provider.META, user_id=user_id)
        service.mark_connected(db, integration, credentials=credentials, user_id=user_id)
        db.commit()

    # Not fully "connected" from the product's point of view until an ad
    # account is selected — the frontend should route this status to the
    # account-picker, not treat it as done.
    return RedirectResponse(_frontend_redirect("needs-account-selection"))


class MetaAccountOut(BaseModel):
    id: str
    name: str | None = None
    accountStatus: int | None = None
    currency: str | None = None
    businessName: str | None = None


@router.get("/accounts", response_model=list[MetaAccountOut])
async def list_accounts(
    user: User = Depends(require_client_scope), db: Session = Depends(get_db)
) -> list[MetaAccountOut]:
    integration = service.find_awaiting_account_selection(db, user.client_id, Provider.META)
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Meta connection is awaiting account selection. Connect Meta first.",
        )
    provider = MetaProvider()
    credentials = service.get_credentials(integration)
    accounts = await provider.list_accounts(credentials)
    return [
        MetaAccountOut(
            id=a["id"], name=a.get("name"), accountStatus=a.get("account_status"),
            currency=a.get("currency"), businessName=a.get("business_name"),
        )
        for a in accounts
    ]


class SelectAccountIn(BaseModel):
    accountId: str
    accountName: str | None = None


@router.post("/accounts/select")
def select_account(
    body: SelectAccountIn,
    user: User = Depends(require_client_scope),
    db: Session = Depends(get_db),
):
    pending = service.find_awaiting_account_selection(db, user.client_id, Provider.META)
    if pending is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Meta connection is awaiting account selection. Connect Meta first.",
        )

    existing = service.find_existing(db, user.client_id, Provider.META, body.accountId)
    if existing is not None and existing.status.value == "connected":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Meta ad account is already connected.",
        )

    if existing is not None:
        # Reconnecting a previously disconnected/error'd account (Section 55):
        # reuse that row, so historical data tied to its integration_id
        # stays attached to the same id, and the unique constraint on
        # (client_id, provider, external_account_id) isn't hit by having
        # two rows target the same account.
        existing.credentials_encrypted = pending.credentials_encrypted
        existing.display_name = body.accountName or body.accountId
        existing.status = pending.status
        existing.last_error = None
        db.delete(pending)
    else:
        pending.external_account_id = body.accountId
        pending.display_name = body.accountName or body.accountId

    db.commit()
    return {"ok": True}


@router.post("/sync")
def trigger_sync(
    user: User = Depends(require_client_scope), db: Session = Depends(get_db)
) -> dict:
    """Queues campaigns_sync + insights_sync for the caller's connected Meta ad account."""
    # Filtered to CONNECTED (not just provider=META) and .first() rather than
    # scalar_one_or_none(): a client can accumulate more than one Meta
    # integration row over time (a disconnected test connection plus a real
    # one, for example) — the query must not assume there is ever exactly
    # one, or a second row throws MultipleResultsFound instead of just
    # picking the live one.
    integration = db.execute(
        select(Integration)
        .where(
            Integration.client_id == user.client_id,
            Integration.provider == Provider.META,
            Integration.status == IntegrationStatus.CONNECTED,
        )
        .order_by(Integration.updated_at.desc())
    ).scalars().first()
    if integration is None or not integration.external_account_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No connected Meta ad account. Connect Meta and select an account first.",
        )

    job_ids = []
    for sync_type in SYNC_TYPES:
        job = sync_service.create_job(
            db, client_id=user.client_id, integration_id=integration.id,
            provider="meta", sync_type=sync_type,
        )
        job_ids.append(job.id)
    db.commit()
    return {"jobIds": job_ids}
