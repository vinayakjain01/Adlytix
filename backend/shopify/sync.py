# ╔══════════════════════════════════════════════════════════════════════╗
# ║  shopify/sync.py  —  products_sync / orders_sync job handlers        ║
# ║                                                                      ║
# ║  Every write is INSERT ... ON CONFLICT DO UPDATE against the unique   ║
# ║  constraints in shopify/models.py — running the same sync twice (a    ║
# ║  retry after a crash, or a scheduled incremental run) upserts, never  ║
# ║  duplicates (Section 21 of the architecture brief).                   ║
# ║                                                                      ║
# ║  Registered into sync/worker.py's SYNC_HANDLERS via the              ║
# ║  @sync.worker.sync_handler decorator — importing this module is what  ║
# ║  makes the worker able to process products_sync/orders_sync jobs.     ║
# ╚══════════════════════════════════════════════════════════════════════╝

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from integrations.models import Integration

log = logging.getLogger("adlytix.shopify.sync")
from integrations.providers.shopify import ShopifyProvider
from shopify.models import ShopifyOrder, ShopifyOrderItem, ShopifyProduct, ShopifyStore, ShopifyVariant
from sync.models import SyncJob


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _num(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _upsert_store(db: Session, *, integration: Integration, shop_data: dict) -> None:
    stmt = pg_insert(ShopifyStore).values(
        integration_id=integration.id,
        client_id=integration.client_id,
        shop_domain=integration.external_account_id,
        shopify_shop_id=str(shop_data["id"]) if shop_data.get("id") is not None else None,
        name=shop_data.get("name"),
        email=shop_data.get("email"),
        currency=shop_data.get("currency"),
        timezone=shop_data.get("iana_timezone") or shop_data.get("timezone"),
        plan_name=shop_data.get("plan_name"),
        raw_data=shop_data,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["integration_id"],
        set_={
            "shopify_shop_id": stmt.excluded.shopify_shop_id,
            "name": stmt.excluded.name,
            "email": stmt.excluded.email,
            "currency": stmt.excluded.currency,
            "timezone": stmt.excluded.timezone,
            "plan_name": stmt.excluded.plan_name,
            "raw_data": stmt.excluded.raw_data,
        },
    )
    db.execute(stmt)


def _upsert_product(db: Session, *, integration: Integration, product_data: dict) -> str:
    stmt = pg_insert(ShopifyProduct).values(
        integration_id=integration.id,
        client_id=integration.client_id,
        shopify_product_id=str(product_data["id"]),
        title=product_data.get("title"),
        product_type=product_data.get("product_type"),
        vendor=product_data.get("vendor"),
        status=product_data.get("status"),
        raw_data=product_data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_shopify_products_client_product",
        set_={
            "title": stmt.excluded.title,
            "product_type": stmt.excluded.product_type,
            "vendor": stmt.excluded.vendor,
            "status": stmt.excluded.status,
            "raw_data": stmt.excluded.raw_data,
        },
    ).returning(ShopifyProduct.id)
    return db.execute(stmt).scalar_one()


def _upsert_variant(db: Session, *, client_id: str, product_id: str, variant_data: dict) -> None:
    stmt = pg_insert(ShopifyVariant).values(
        product_id=product_id,
        client_id=client_id,
        shopify_variant_id=str(variant_data["id"]),
        sku=variant_data.get("sku"),
        title=variant_data.get("title"),
        price=_num(variant_data.get("price")),
        compare_at_price=_num(variant_data.get("compare_at_price")),
        inventory_quantity=variant_data.get("inventory_quantity"),
        raw_data=variant_data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_shopify_variants_client_variant",
        set_={
            "product_id": stmt.excluded.product_id,
            "sku": stmt.excluded.sku,
            "title": stmt.excluded.title,
            "price": stmt.excluded.price,
            "compare_at_price": stmt.excluded.compare_at_price,
            "inventory_quantity": stmt.excluded.inventory_quantity,
            "raw_data": stmt.excluded.raw_data,
        },
    )
    db.execute(stmt)


async def run_products_sync(db: Session, job: SyncJob, integration: Integration, credentials: dict) -> dict:
    provider = ShopifyProvider()
    shop = integration.external_account_id

    shop_data = await provider.get_shop(credentials, shop)
    _upsert_store(db, integration=integration, shop_data=shop_data)

    fetched = 0
    async for product in provider.list_products(credentials, shop):
        product_id = _upsert_product(db, integration=integration, product_data=product)
        for variant in product.get("variants", []) or []:
            _upsert_variant(
                db, client_id=integration.client_id, product_id=product_id, variant_data=variant
            )
        fetched += 1
        if fetched % 50 == 0:
            # A real COMMIT, not just flush() — a single transaction holding
            # thousands of uncommitted rows measurably slows down over the
            # course of a large sync (confirmed against a 2,000+ order dev
            # store: throughput dropped from ~1.5/s to ~0.4/s as the
            # transaction grew). Committing in small batches keeps each
            # transaction cheap regardless of total volume. Safe to do here
            # because every write is an idempotent upsert — a crash between
            # batches just means the next run re-upserts a few already-synced
            # rows, not a correctness problem.
            db.commit()

    db.flush()
    # created-vs-updated isn't distinguished by a plain ON CONFLICT upsert
    # without an extra round-trip per row; not worth that cost for a count
    # that's purely informational, so it's reported as fetched only.
    return {"records_fetched": fetched, "records_created": 0, "records_updated": 0, "records_failed": 0}


def _upsert_order(db: Session, *, integration: Integration, order_data: dict) -> str:
    stmt = pg_insert(ShopifyOrder).values(
        integration_id=integration.id,
        client_id=integration.client_id,
        shopify_order_id=str(order_data["id"]),
        order_number=str(order_data.get("order_number") or order_data.get("name") or ""),
        email=order_data.get("email"),
        financial_status=order_data.get("financial_status"),
        fulfillment_status=order_data.get("fulfillment_status"),
        currency=order_data.get("currency"),
        total_price=_num(order_data.get("total_price")),
        subtotal_price=_num(order_data.get("subtotal_price")),
        total_discounts=_num(order_data.get("total_discounts")),
        shopify_created_at=_parse_dt(order_data.get("created_at")),
        processed_at=_parse_dt(order_data.get("processed_at")),
        cancelled_at=_parse_dt(order_data.get("cancelled_at")),
        raw_data=order_data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_shopify_orders_client_order",
        set_={
            "order_number": stmt.excluded.order_number,
            "email": stmt.excluded.email,
            "financial_status": stmt.excluded.financial_status,
            "fulfillment_status": stmt.excluded.fulfillment_status,
            "currency": stmt.excluded.currency,
            "total_price": stmt.excluded.total_price,
            "subtotal_price": stmt.excluded.subtotal_price,
            "total_discounts": stmt.excluded.total_discounts,
            "processed_at": stmt.excluded.processed_at,
            "cancelled_at": stmt.excluded.cancelled_at,
            "raw_data": stmt.excluded.raw_data,
        },
    ).returning(ShopifyOrder.id)
    return db.execute(stmt).scalar_one()


def _upsert_order_item(
    db: Session, *, client_id: str, order_id: str, item_data: dict,
    product_lookup: dict[str, str | None], variant_lookup: dict[str, str | None],
) -> None:
    def _resolve_product(shopify_product_id) -> str | None:
        if shopify_product_id is None:
            return None
        key = str(shopify_product_id)
        if key not in product_lookup:
            product_lookup[key] = db.execute(
                select(ShopifyProduct.id).where(
                    ShopifyProduct.client_id == client_id, ShopifyProduct.shopify_product_id == key
                )
            ).scalar_one_or_none()
        return product_lookup[key]

    def _resolve_variant(shopify_variant_id) -> str | None:
        if shopify_variant_id is None:
            return None
        key = str(shopify_variant_id)
        if key not in variant_lookup:
            variant_lookup[key] = db.execute(
                select(ShopifyVariant.id).where(
                    ShopifyVariant.client_id == client_id, ShopifyVariant.shopify_variant_id == key
                )
            ).scalar_one_or_none()
        return variant_lookup[key]

    stmt = pg_insert(ShopifyOrderItem).values(
        order_id=order_id,
        client_id=client_id,
        shopify_line_item_id=str(item_data["id"]),
        product_id=_resolve_product(item_data.get("product_id")),
        variant_id=_resolve_variant(item_data.get("variant_id")),
        title=item_data.get("title"),
        sku=item_data.get("sku"),
        quantity=item_data.get("quantity"),
        price=_num(item_data.get("price")),
        total_discount=_num(item_data.get("total_discount")),
        raw_data=item_data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_shopify_order_items_client_item",
        set_={
            "order_id": stmt.excluded.order_id,
            "product_id": stmt.excluded.product_id,
            "variant_id": stmt.excluded.variant_id,
            "title": stmt.excluded.title,
            "sku": stmt.excluded.sku,
            "quantity": stmt.excluded.quantity,
            "price": stmt.excluded.price,
            "total_discount": stmt.excluded.total_discount,
            "raw_data": stmt.excluded.raw_data,
        },
    )
    db.execute(stmt)


async def run_orders_sync(db: Session, job: SyncJob, integration: Integration, credentials: dict) -> dict:
    provider = ShopifyProvider()
    shop = integration.external_account_id
    # job.cursor doubles as the incremental-sync checkpoint here (an ISO
    # timestamp passed as `updated_at_min`), not a page cursor — Shopify's
    # own Link-header pagination is handled inside list_orders per page.
    since = job.cursor
    run_started_at = datetime.now(timezone.utc)

    product_lookup: dict[str, str | None] = {}
    variant_lookup: dict[str, str | None] = {}
    fetched = 0
    log.info("orders_sync: starting fetch for %s (since=%s)", shop, since)
    async for order in provider.list_orders(credentials, shop, since=since):
        order_id = _upsert_order(db, integration=integration, order_data=order)
        for item in order.get("line_items", []) or []:
            _upsert_order_item(
                db, client_id=integration.client_id, order_id=order_id, item_data=item,
                product_lookup=product_lookup, variant_lookup=variant_lookup,
            )
        fetched += 1
        if fetched % 10 == 0:
            log.info("orders_sync: processed %d orders so far", fetched)
        if fetched % 50 == 0:
            db.commit()  # see the comment on the equivalent line in run_products_sync
    log.info("orders_sync: fetch loop finished, %d orders total", fetched)

    job.cursor = run_started_at.isoformat()
    db.flush()
    return {"records_fetched": fetched, "records_created": 0, "records_updated": 0, "records_failed": 0}
