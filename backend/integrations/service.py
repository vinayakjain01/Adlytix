# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/service.py  —  Tenant-scoped integration lifecycle     ║
# ║                                                                      ║
# ║  Every function here takes client_id explicitly rather than reading  ║
# ║  it from a request parameter — callers must resolve it from the      ║
# ║  authenticated user first (see current_user in auth.py). This is the  ║
# ║  application-level half of tenant isolation described in Section 27   ║
# ║  of the architecture brief: nothing in this module trusts a          ║
# ║  caller-supplied tenant id.                                          ║
# ╚══════════════════════════════════════════════════════════════════════╝

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from audit import service as audit_service
from integrations.crypto import decrypt_credentials, encrypt_credentials
from integrations.models import Integration, IntegrationStatus, Provider


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IntegrationNotFound(Exception):
    pass


def list_for_client(db: Session, client_id: str) -> list[Integration]:
    return list(
        db.execute(
            select(Integration)
            .where(Integration.client_id == client_id)
            .order_by(Integration.provider, Integration.created_at)
        ).scalars()
    )


def find_existing(
    db: Session, client_id: str, provider: Provider, external_account_id: str
) -> Integration | None:
    """
    Looks up a specific (client, provider, account) row regardless of status
    — used by an OAuth callback to decide reuse-and-reconnect vs. create-new
    (Section 55: reconnecting the same store must not duplicate it).
    """
    return db.execute(
        select(Integration).where(
            Integration.client_id == client_id,
            Integration.provider == provider,
            Integration.external_account_id == external_account_id,
        )
    ).scalar_one_or_none()


def find_awaiting_account_selection(
    db: Session, client_id: str, provider: Provider
) -> Integration | None:
    """
    For providers where the OAuth callback authenticates before the specific
    account is known (Meta: business login happens before ad-account
    selection). Reuses the same in-progress row across a callback retry
    instead of accumulating orphaned ones.
    """
    return db.execute(
        select(Integration)
        .where(
            Integration.client_id == client_id,
            Integration.provider == provider,
            Integration.external_account_id.is_(None),
        )
        .order_by(Integration.created_at.desc())
    ).scalars().first()


def get_for_client(db: Session, client_id: str, integration_id: str) -> Integration:
    """
    Scoped by client_id in the WHERE clause itself — not fetched by id and
    then checked — so a not-found and a belongs-to-another-tenant row are
    indistinguishable to the caller. Tenant A can never learn tenant B's
    integration exists this way.
    """
    integration = db.execute(
        select(Integration).where(
            Integration.id == integration_id, Integration.client_id == client_id
        )
    ).scalar_one_or_none()
    if integration is None:
        raise IntegrationNotFound(integration_id)
    return integration


def create_pending(
    db: Session, client_id: str, provider: Provider, *, user_id: str | None = None
) -> Integration:
    """
    Registers the intent to connect a provider before OAuth starts. The real
    OAuth authorization-URL/callback endpoints are added in Phase 3 (Shopify)
    and Phase 4 (Meta) once app credentials exist; this only creates the row
    those phases will attach credentials to.
    """
    integration = Integration(
        client_id=client_id, provider=provider, status=IntegrationStatus.PENDING,
    )
    db.add(integration)
    audit_service.record(
        db, action="integration_connect_started", client_id=client_id, user_id=user_id,
        resource_type="integration", metadata={"provider": provider.value},
    )
    db.flush()
    return integration


def mark_connected(
    db: Session,
    integration: Integration,
    *,
    credentials: dict,
    external_account_id: str | None = None,
    display_name: str | None = None,
    user_id: str | None = None,
) -> Integration:
    """Called by a provider's OAuth callback once token exchange succeeds."""
    integration.credentials_encrypted = encrypt_credentials(credentials)
    integration.status = IntegrationStatus.CONNECTED
    integration.last_error = None
    if external_account_id is not None:
        integration.external_account_id = external_account_id
    if display_name is not None:
        integration.display_name = display_name
    audit_service.record(
        db, action="integration_connected", client_id=integration.client_id, user_id=user_id,
        resource_type="integration", resource_id=integration.id,
        metadata={"provider": integration.provider.value},
    )
    return integration


def mark_error(db: Session, integration: Integration, error: str) -> Integration:
    integration.status = IntegrationStatus.ERROR
    integration.last_error = error[:2000]
    audit_service.record(
        db, action="integration_error", client_id=integration.client_id,
        resource_type="integration", resource_id=integration.id,
        metadata={"provider": integration.provider.value, "error": error[:500]},
    )
    return integration


def get_credentials(integration: Integration) -> dict:
    """
    Decrypts the stored credentials for a connected integration. Raises
    integrations.crypto.EncryptionNotConfigured if they can't be decrypted
    (e.g. ENCRYPTION_KEY rotated) — callers must surface that as "reconnect
    this integration", never treat it as empty credentials.
    """
    if not integration.credentials_encrypted:
        raise IntegrationNotFound(
            f"Integration {integration.id} has no stored credentials (status={integration.status.value})."
        )
    return decrypt_credentials(integration.credentials_encrypted)


def disconnect(db: Session, integration: Integration, *, user_id: str | None = None) -> Integration:
    """
    Per Section 54 of the architecture brief: disconnecting stops sync and
    invalidates credentials, but never deletes the row or any historical
    data a later phase's sync tables hold against integration_id. Reconnect
    (Section 55) can then reuse this same row rather than creating a
    duplicate.
    """
    integration.status = IntegrationStatus.DISCONNECTED
    integration.credentials_encrypted = None
    audit_service.record(
        db, action="integration_disconnected", client_id=integration.client_id, user_id=user_id,
        resource_type="integration", resource_id=integration.id,
        metadata={"provider": integration.provider.value},
    )
    return integration
