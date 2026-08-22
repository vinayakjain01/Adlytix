# ╔══════════════════════════════════════════════════════════════════════╗
# ║  meta/models.py  —  Normalized Meta Ads data (Phase 4 continued)     ║
# ║                                                                      ║
# ║  Same idempotency shape as shopify/models.py: every table unique on   ║
# ║  (client_id, meta_*_id), written via ON CONFLICT DO UPDATE.           ║
# ║                                                                      ║
# ║  No meta_businesses table — this integration's OAuth flow (Phase 4)   ║
# ║  goes straight from login to ad-account selection with no separate    ║
# ║  "business" step, so there is nothing to normalize there yet.         ║
# ║                                                                      ║
# ║  No full meta_catalogs table either — confirmed against the real      ║
# ║  connected account that product-level ad attribution exists, but      ║
# ║  nothing here needs the catalog's own metadata (name, feed status,    ║
# ║  etc.), only individual products' identity — see MetaProductInsight-  ║
# ║  Daily below and mapping/models.py::ProductMapping.                   ║
# ╚══════════════════════════════════════════════════════════════════════╝

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MetaAdAccount(Base):
    """One row per connected ad account — 1:1 with its `integrations` row."""

    __tablename__ = "meta_ad_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    meta_account_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    account_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    business_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class MetaCampaign(Base):
    __tablename__ = "meta_campaigns"
    __table_args__ = (UniqueConstraint("client_id", "meta_campaign_id", name="uq_meta_campaigns_client_campaign"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    meta_campaign_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    objective: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class MetaAdSet(Base):
    __tablename__ = "meta_ad_sets"
    __table_args__ = (
        UniqueConstraint("client_id", "meta_ad_set_id", name="uq_meta_ad_sets_client_ad_set"),
        Index("ix_meta_ad_sets_campaign", "campaign_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meta_campaigns.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    meta_ad_set_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    daily_budget: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    lifetime_budget: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class MetaAd(Base):
    __tablename__ = "meta_ads"
    __table_args__ = (
        UniqueConstraint("client_id", "meta_ad_id", name="uq_meta_ads_client_ad"),
        Index("ix_meta_ads_ad_set", "ad_set_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    ad_set_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("meta_ad_sets.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    meta_ad_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class MetaInsightDaily(Base):
    """
    Grain: one row per (client, ad, date) — matches the brief's Section 23
    example exactly ("tenant + ad_account + date + campaign + ad_set + ad").
    `meta_campaign_id`/`meta_ad_set_id`/`meta_ad_id` are stored as plain
    strings (not just FKs) because insights_sync can run before or
    independently of campaigns_sync — the FK columns resolve opportunistically
    when the hierarchy has been synced, but the string ids are always present
    and are what the unique constraint actually keys on.
    """

    __tablename__ = "meta_insights_daily"
    __table_args__ = (
        UniqueConstraint("client_id", "meta_ad_id", "date", name="uq_meta_insights_client_ad_date"),
        Index("ix_meta_insights_client_date", "client_id", "date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campaign_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("meta_campaigns.id", ondelete="SET NULL"), nullable=True
    )
    ad_set_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("meta_ad_sets.id", ondelete="SET NULL"), nullable=True
    )
    ad_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("meta_ads.id", ondelete="SET NULL"), nullable=True
    )
    meta_campaign_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta_ad_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta_ad_id: Mapped[str] = mapped_column(String(64), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    spend: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    impressions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Meta's raw "actions" array (purchases, add-to-cart, etc.) — kept as
    # JSONB rather than normalized columns per action type, since the set of
    # action types is provider-defined and open-ended (Section 9 of the brief).
    actions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class MetaProductInsightDaily(Base):
    """
    Grain: one row per (client, ad, meta product, date) — the actual grain
    Meta's API returns for `level=ad&breakdowns=product_id&time_increment=1`,
    confirmed live against a real catalog-sales account (2026-08-22): this is
    genuine per-product spend attribution, not an estimate. `shopify_product_id`
    / `shopify_variant_id` are resolved from `mapping.ProductMapping` at write
    time and stay NULL when no match exists yet — spend on an unmatched row is
    real Meta spend that just isn't attributable to a Shopify product, and
    must never be redistributed across matched products to make the numbers
    look complete (see reporting's unattributed-spend handling).
    """

    __tablename__ = "meta_product_insights_daily"
    __table_args__ = (
        UniqueConstraint(
            "client_id", "meta_ad_id", "meta_product_id", "date",
            name="uq_meta_product_insights_client_ad_product_date",
        ),
        Index("ix_meta_product_insights_client_date", "client_id", "date"),
        Index("ix_meta_product_insights_shopify_product", "shopify_product_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )

    meta_campaign_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta_ad_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta_ad_id: Mapped[str] = mapped_column(String(64), nullable=False)

    # Meta's own catalog product id — the breakdown value's id portion, split
    # from the "{id}, {name}" string the API actually returns.
    meta_product_id: Mapped[str] = mapped_column(String(128), nullable=False)
    meta_product_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Denormalized from ProductMapping at write time (Section 4 of this
    # phase's brief) — resolved once per product id, reused by every day's
    # row for it, not re-looked-up per row.
    shopify_product_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("shopify_products.id", ondelete="SET NULL"), nullable=True
    )
    shopify_variant_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("shopify_variants.id", ondelete="SET NULL"), nullable=True
    )

    date: Mapped[date] = mapped_column(Date, nullable=False)
    spend: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    impressions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reach: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    action_values: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )
