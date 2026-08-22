# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/models.py  —  Provider-agnostic integration record     ║
# ║                                                                      ║
# ║  One row per external account a client has connected (or attempted   ║
# ║  to connect) — a Shopify store, a Meta business, and later a Google  ║
# ║  Ads account, etc. This table never stores provider-specific         ║
# ║  business data (products, orders, campaigns): those get their own    ║
# ║  normalized tables in Phase 3/4, each with an `integration_id`       ║
# ║  foreign key pointing back here. This table only tracks the          ║
# ║  connection itself — status, credentials, sync bookkeeping.          ║
# ╚══════════════════════════════════════════════════════════════════════╝

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime, Enum as SAEnum, ForeignKey, Index, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Provider(str, enum.Enum):
    """
    Stored as a plain VARCHAR (native_enum=False, matching Role/UserStatus in
    models.py) rather than a native Postgres ENUM, so adding "google" or
    "tiktok" later is an application-level change, not an ALTER TYPE migration.
    """
    SHOPIFY = "shopify"
    META = "meta"
    GOOGLE = "google"       # not yet implemented — reserved
    TIKTOK = "tiktok"       # not yet implemented — reserved


class IntegrationStatus(str, enum.Enum):
    PENDING = "pending"          # created, OAuth not yet completed
    CONNECTED = "connected"      # OAuth complete, credentials valid
    ERROR = "error"              # last refresh/use failed (e.g. token revoked)
    DISCONNECTED = "disconnected"  # user-initiated disconnect; historical data retained


class Integration(Base):
    """
    A client's connection to one external account on one provider.

    `external_account_id` is the provider's identifier for the account itself
    (a shop domain for Shopify, a business/ad-account id for Meta) — distinct
    from any OAuth state or credential. It is nullable because it is often
    not known until the OAuth callback completes; the unique constraint below
    still protects against a second *fully connected* duplicate, since
    Postgres treats each NULL as distinct.

    Credentials are stored only as `credentials_encrypted` (see
    integrations/crypto.py) — never as plaintext columns. `config` is for
    non-secret, provider-specific settings (e.g. selected ad account IDs,
    enabled webhook topics) that later phases need to read without touching
    the encrypted blob.
    """

    __tablename__ = "integrations"
    __table_args__ = (
        UniqueConstraint(
            "client_id", "provider", "external_account_id",
            name="uq_integrations_client_provider_account",
        ),
        Index("ix_integrations_client_provider", "client_id", "provider"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[Provider] = mapped_column(
        SAEnum(Provider, name="integration_provider", native_enum=False, length=20),
        nullable=False,
    )
    status: Mapped[IntegrationStatus] = mapped_column(
        SAEnum(IntegrationStatus, name="integration_status", native_enum=False, length=20),
        nullable=False, default=IntegrationStatus.PENDING,
    )
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Provider's own identifier for the connected account (shop domain, business id, ...).
    external_account_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Opaque ciphertext produced by integrations/crypto.py — never plaintext tokens.
    credentials_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Non-secret provider settings/state. Safe to log; never put tokens here.
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )

    client = relationship("Client")
