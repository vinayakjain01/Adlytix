# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/shopify_router.py  —  /api/v1/shopify/*                ║
# ║                                                                      ║
# ║  /connect requires a signed-in, client-scoped user (it starts the     ║
# ║  flow). /callback does not — Shopify's redirect back to us is a       ║
# ║  fresh top-level browser navigation from a different origin; tenant   ║
# ║  identity for it comes from the signed `state` token minted at        ║
# ║  /connect, not from re-checking the session cookie (see               ║
# ║  integrations/oauth_state.py for why).                                ║
# ╚══════════════════════════════════════════════════════════════════════╝

import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import require_client_scope
from db import get_db, SessionLocal
from integrations import oauth_state, service
from integrations.models import Integration, IntegrationStatus, Provider
from integrations.providers.shopify import (
    InvalidShopDomain, ShopifyOAuthError, ShopifyProvider, normalise_shop_domain,
)
from models import User
from sync import service as sync_service

SYNC_TYPES = ("products_sync", "orders_sync")

router = APIRouter(prefix="/api/v1/shopify", tags=["shopify"])
log = logging.getLogger("adlytix.shopify")


def _redirect_uri() -> str:
    base = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/shopify/callback"


def _frontend_redirect(status_: str, *, message: str | None = None) -> str:
    base = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    url = f"{base}/integrations?integration=shopify&status={status_}"
    if message:
        from urllib.parse import quote
        url += f"&message={quote(message)}"
    return url


@router.get("/connect")
def connect(
    shop: str,
    user: User = Depends(require_client_scope),
) -> RedirectResponse:
    try:
        provider = ShopifyProvider()
        normalised_shop = normalise_shop_domain(shop)
    except InvalidShopDomain as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    state = oauth_state.create_state(
        provider="shopify", client_id=user.client_id, user_id=user.id,
        extra={"shop": normalised_shop},
    )
    url = provider.get_authorization_url(
        state=state, redirect_uri=_redirect_uri(), shop=normalised_shop
    )
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND)


@router.get("/callback")
async def callback(request: Request) -> RedirectResponse:
    params = dict(request.query_params)
    shop = params.get("shop", "")
    code = params.get("code", "")
    state_token = params.get("state", "")

    try:
        provider = ShopifyProvider()

        if not provider.verify_authorize_callback(params):
            raise ShopifyOAuthError("Callback signature (hmac) did not verify.")

        # The state JWT (signed, tied to this tenant) plus Shopify's own HMAC
        # signature on this callback together already prove the callback is
        # both genuine and started by this tenant — that's the real security
        # boundary. Shopify's own `shop` param is trusted as-is for *which*
        # store to connect, not compared against what the user typed at
        # /connect: Shopify silently renames a requested store handle on
        # collision (e.g. "my-store" -> "my-store-1"), which used to make a
        # perfectly legitimate install fail here with a false mismatch error.
        state_payload = oauth_state.verify_state(state_token, provider="shopify")
        normalised_shop = normalise_shop_domain(shop)
        expected_shop = state_payload.get("extra", {}).get("shop")
        if expected_shop and expected_shop != normalised_shop:
            log.info(
                "Shopify renamed the requested store on install: typed %r, actual %r.",
                expected_shop, normalised_shop,
            )

        client_id = state_payload["client_id"]
        user_id = state_payload.get("user_id")

        credentials = await provider.exchange_code_for_token(
            code=code, redirect_uri=_redirect_uri(), shop=normalised_shop
        )
    except (InvalidShopDomain, ShopifyOAuthError, oauth_state.InvalidOAuthState) as exc:
        log.warning("Shopify OAuth callback rejected: %s", exc)
        return RedirectResponse(_frontend_redirect("error", message=str(exc)))
    except RuntimeError as exc:
        return RedirectResponse(_frontend_redirect("error", message=str(exc)))
    except Exception:
        log.exception("Shopify OAuth callback failed unexpectedly")
        return RedirectResponse(_frontend_redirect("error", message="Connection failed. Try again."))

    # A fresh DB session — this handler runs outside any request that carries
    # the FastAPI get_db dependency, since it's reached by browser redirect.
    with SessionLocal() as db:
        integration = service.find_existing(db, client_id, Provider.SHOPIFY, normalised_shop)
        if integration is None:
            integration = service.create_pending(
                db, client_id, Provider.SHOPIFY, user_id=user_id
            )
        service.mark_connected(
            db, integration, credentials=credentials,
            external_account_id=normalised_shop, display_name=normalised_shop,
            user_id=user_id,
        )
        db.commit()

    return RedirectResponse(_frontend_redirect("connected"))


@router.post("/sync")
def trigger_sync(
    user: User = Depends(require_client_scope), db: Session = Depends(get_db)
) -> dict:
    """
    Queues products_sync + orders_sync for the caller's connected Shopify
    store. Actual work happens in sync/worker.py, not this request — this
    only creates the job rows (Section 7 of the architecture brief: never
    synchronize inside the HTTP request/response cycle).
    """
    # Same reasoning as the equivalent Meta query (meta_router.py::trigger_sync):
    # filter to CONNECTED and take .first(), never assume there's exactly one
    # row for this provider — a stale disconnected row would otherwise make
    # this throw MultipleResultsFound instead of just finding the live one.
    integration = db.execute(
        select(Integration)
        .where(
            Integration.client_id == user.client_id,
            Integration.provider == Provider.SHOPIFY,
            Integration.status == IntegrationStatus.CONNECTED,
        )
        .order_by(Integration.updated_at.desc())
    ).scalars().first()
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No connected Shopify store. Connect one first.",
        )

    job_ids = []
    for sync_type in SYNC_TYPES:
        job = sync_service.create_job(
            db, client_id=user.client_id, integration_id=integration.id,
            provider="shopify", sync_type=sync_type,
        )
        job_ids.append(job.id)
    db.commit()
    return {"jobIds": job_ids}


@router.post("/webhooks")
async def webhooks(request: Request, db: Session = Depends(get_db)):
    """
    Public — Shopify calls this directly, there is no browser session.
    Authenticity comes entirely from the HMAC signature, not from auth.
    Does the minimum required before returning (Section 13 of the
    architecture brief): verify, resolve tenant, record, return. Actual
    processing happens in sync/worker.py, not here.
    """
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}

    try:
        provider = ShopifyProvider()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    if not provider.verify_webhook(headers=headers, body=body):
        log.warning("Shopify webhook rejected: signature did not verify.")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.")

    topic = headers.get("x-shopify-topic", "")
    shop = headers.get("x-shopify-shop-domain", "")
    event_id = headers.get("x-shopify-webhook-id") or headers.get("x-shopify-event-id")

    try:
        payload = json.loads(body) if body else {}
    except json.JSONDecodeError:
        payload = {}

    integration = None
    if shop:
        # .first() rather than scalar_one_or_none(): external_account_id is
        # only unique in combination with client_id, not on its own, so a
        # shop disconnected and later reconnected under a different client
        # could in principle leave more than one matching row here.
        integration = db.execute(
            select(Integration)
            .where(Integration.provider == Provider.SHOPIFY, Integration.external_account_id == shop)
            .order_by(Integration.updated_at.desc())
        ).scalars().first()

    sync_service.record_webhook_event(
        db, provider="shopify", topic=topic, payload=payload,
        integration_id=integration.id if integration else None,
        client_id=integration.client_id if integration else None,
        external_event_id=event_id,
    )
    db.commit()
    return {"ok": True}
