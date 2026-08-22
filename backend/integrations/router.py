# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/router.py  —  /api/v1/integrations                     ║
# ║                                                                      ║
# ║  Read/status/disconnect only in this phase. There is deliberately no ║
# ║  "connect" endpoint that starts a real OAuth flow yet — Shopify and   ║
# ║  Meta app credentials have not been provisioned (Phase 3/4). Adding   ║
# ║  one now would either do nothing or pretend to work; neither is      ║
# ║  acceptable, so the create-pending capability in integrations/       ║
# ║  service.py is exercised by Phase 3/4's real OAuth-start endpoint,    ║
# ║  not exposed generically here.                                       ║
# ╚══════════════════════════════════════════════════════════════════════╝

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_client_scope
from db import get_db
from integrations import service
from integrations.models import IntegrationStatus, Provider
from models import User

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])


class IntegrationOut(BaseModel):
    id: str
    provider: str
    status: str
    displayName: str | None
    externalAccountId: str | None
    lastSyncAt: datetime | None
    lastError: str | None
    createdAt: datetime


def _to_out(integration) -> IntegrationOut:
    return IntegrationOut(
        id=integration.id,
        provider=integration.provider.value,
        status=integration.status.value,
        displayName=integration.display_name,
        externalAccountId=integration.external_account_id,
        lastSyncAt=integration.last_sync_at,
        lastError=integration.last_error,
        createdAt=integration.created_at,
    )


@router.get("", response_model=list[IntegrationOut])
def list_integrations(
    user: User = Depends(require_client_scope), db: Session = Depends(get_db)
) -> list[IntegrationOut]:
    """
    Every provider the client could connect, one row each — including
    providers with no integration row yet, shown as `status: "available"`,
    so the frontend can render "Connect" vs "Coming soon" without a second
    endpoint. Real rows (pending/connected/error/disconnected) come from the
    database; the rest are synthesized from the Provider enum.
    """
    existing = {i.provider: i for i in service.list_for_client(db, user.client_id)}

    out: list[IntegrationOut] = []
    for provider in Provider:
        if provider in existing:
            out.append(_to_out(existing[provider]))
        else:
            out.append(
                IntegrationOut(
                    id="",
                    provider=provider.value,
                    status="available",
                    displayName=None,
                    externalAccountId=None,
                    lastSyncAt=None,
                    lastError=None,
                    createdAt=datetime.now(),
                )
            )
    return out


@router.post("/{integration_id}/disconnect", response_model=IntegrationOut)
def disconnect_integration(
    integration_id: str,
    user: User = Depends(require_client_scope),
    db: Session = Depends(get_db),
) -> IntegrationOut:
    try:
        integration = service.get_for_client(db, user.client_id, integration_id)
    except service.IntegrationNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found.")

    if integration.status == IntegrationStatus.DISCONNECTED:
        return _to_out(integration)

    service.disconnect(db, integration, user_id=user.id)
    db.commit()
    db.refresh(integration)
    return _to_out(integration)
