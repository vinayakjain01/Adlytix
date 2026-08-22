# ╔══════════════════════════════════════════════════════════════════════╗
# ║  mapping/models.py  —  Meta catalog product ↔ Shopify product/variant ║
# ║                                                                      ║
# ║  A persistent identity mapping (Section 22 of the architecture       ║
# ║  brief), kept separate from the daily insight rows that reference    ║
# ║  it: resolving a Meta product_id to a Shopify product is expensive   ║
# ║  (a Graph API call per unknown id) and stable over time, so it is    ║
# ║  looked up once and reused by every subsequent sync, not re-resolved ║
# ║  per row per day.                                                    ║
# ╚══════════════════════════════════════════════════════════════════════╝

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from models import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MatchType(str, enum.Enum):
    VARIANT_ID = "variant_id"
    SKU = "sku"
    RETAILER_ID = "retailer_id"
    MANUAL = "manual"
    UNMATCHED = "unmatched"


class ProductMapping(Base):
    """
    One row per distinct Meta catalog product this client's ads have ever
    referenced. `shopify_product_id`/`shopify_variant_id` stay NULL until a
    match is found — an unmatched row is not an error, it means this
    product's Meta spend is genuinely unattributable to a Shopify product
    (Section 11 of this phase's brief: never fabricate an attribution).
    """

    __tablename__ = "product_mappings"
    __table_args__ = (
        UniqueConstraint("client_id", "meta_product_id", name="uq_product_mappings_client_meta_product"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    meta_product_id: Mapped[str] = mapped_column(String(128), nullable=False)
    meta_retailer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    meta_product_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    shopify_product_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("shopify_products.id", ondelete="SET NULL"), nullable=True
    )
    shopify_variant_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("shopify_variants.id", ondelete="SET NULL"), nullable=True
    )

    match_type: Mapped[MatchType] = mapped_column(
        SAEnum(MatchType, name="product_mapping_match_type", native_enum=False, length=20),
        nullable=False, default=MatchType.UNMATCHED,
    )
    confidence: Mapped[float | None] = mapped_column(nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow, nullable=False
    )
