# ╔══════════════════════════════════════════════════════════════════════╗
# ║  shopify/models.py  —  Normalized Shopify data (Phase 3 continued)   ║
# ║                                                                      ║
# ║  Grain and idempotency: every table is unique on (client_id,          ║
# ║  shopify_*_id) — Shopify IDs are not globally unique across tenants,  ║
# ║  so client_id must always be part of the key (Section 11 of the       ║
# ║  architecture brief). Sync writes use INSERT ... ON CONFLICT DO       ║
# ║  UPDATE against these constraints (see shopify/sync.py), which is     ║
# ║  what makes a retried/interrupted sync safe to simply run again.      ║
# ║                                                                      ║
# ║  Soft delete only (Section 52/53): a product Shopify reports deleted  ║
# ║  is marked `deleted_at`, never removed — historical order line items  ║
# ║  and analytics must keep referencing it.                              ║
# ╚══════════════════════════════════════════════════════════════════════╝

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ShopifyStore(Base):
    """One row per connected Shopify store — 1:1 with its `integrations` row."""

    __tablename__ = "shopify_stores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shop_domain: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    shopify_shop_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    plan_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class ShopifyProduct(Base):
    __tablename__ = "shopify_products"
    __table_args__ = (
        UniqueConstraint("client_id", "shopify_product_id", name="uq_shopify_products_client_product"),
        Index("ix_shopify_products_integration", "integration_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shopify_product_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    product_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class ShopifyVariant(Base):
    __tablename__ = "shopify_variants"
    __table_args__ = (
        UniqueConstraint("client_id", "shopify_variant_id", name="uq_shopify_variants_client_variant"),
        Index("ix_shopify_variants_product", "product_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("shopify_products.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shopify_variant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    compare_at_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    inventory_quantity: Mapped[int | None] = mapped_column(nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class ShopifyOrder(Base):
    __tablename__ = "shopify_orders"
    __table_args__ = (
        UniqueConstraint("client_id", "shopify_order_id", name="uq_shopify_orders_client_order"),
        Index("ix_shopify_orders_client_created", "client_id", "shopify_created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    integration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shopify_order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    order_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    financial_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fulfillment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    total_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    subtotal_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    total_discounts: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    # Shopify's own order timestamp — distinct from created_at below (when we
    # first synced it). Analytics/date-range queries must use this one.
    shopify_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )


class ShopifyOrderItem(Base):
    __tablename__ = "shopify_order_items"
    __table_args__ = (
        UniqueConstraint("client_id", "shopify_line_item_id", name="uq_shopify_order_items_client_item"),
        Index("ix_shopify_order_items_order", "order_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    order_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("shopify_orders.id", ondelete="CASCADE"), nullable=False
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shopify_line_item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Nullable: the referenced product may not exist in shopify_products
    # (deleted before its first sync, or not yet synced) — an order line
    # item must never be dropped just because the product lookup failed.
    product_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("shopify_products.id", ondelete="SET NULL"), nullable=True
    )
    variant_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("shopify_variants.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sku: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantity: Mapped[int | None] = mapped_column(nullable=True)
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_discount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
