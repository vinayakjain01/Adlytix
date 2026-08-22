# ╔══════════════════════════════════════════════════════════════════════╗
# ║  reporting/merge_adapter.py  —  DB data → the existing analytics       ║
# ║  engine, unchanged                                                    ║
# ║                                                                      ║
# ║  Builds the exact same DataFrame shapes data_cleaner.clean_shopify()/  ║
# ║  clean_meta() produce from an upload, but sourced from the synced      ║
# ║  database tables instead of a file. analytics.run_overall_view() and   ║
# ║  run_product_analysis() are called completely unmodified — this is    ║
# ║  the reuse the architecture brief asked for, not a parallel engine.   ║
# ║                                                                      ║
# ║  Meta spend here is ONLY what meta_product_insights_daily attributes  ║
# ║  to a matched Shopify product (real catalog-ads attribution, see      ║
# ║  meta/sync.py::run_product_insights_sync) — never estimated or        ║
# ║  redistributed. Whatever Meta spend for the period isn't attributed   ║
# ║  to any product is returned separately as `unattributed_meta_spend`,  ║
# ║  and must be shown as its own figure, never folded into a product row.║
# ╚══════════════════════════════════════════════════════════════════════╝

from datetime import date, timedelta

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from data_cleaner import META_KEEP_COLS, SHOPIFY_KEEP_COLS
from meta.models import MetaInsightDaily, MetaProductInsightDaily
from shopify.models import ShopifyOrder, ShopifyOrderItem, ShopifyProduct, ShopifyStore
from meta.models import MetaAdAccount

DEFAULT_RANGE_DAYS = 30


def default_range(since: date | None, until: date | None) -> tuple[date, date]:
    until = until or date.today()
    since = since or (until - timedelta(days=DEFAULT_RANGE_DAYS - 1))
    return since, until


def source_currencies(db: Session, client_id: str) -> dict[str, str | None]:
    """
    What each connected source's own data is actually denominated in —
    read from what was captured at sync time (shopify_stores.currency,
    meta_ad_accounts.currency), so the frontend can pre-fill the currency
    step instead of asking the operator to already know it.
    """
    shopify_currency = db.execute(
        select(ShopifyStore.currency).where(ShopifyStore.client_id == client_id)
    ).scalar()
    meta_currency = db.execute(
        select(MetaAdAccount.currency).where(MetaAdAccount.client_id == client_id)
    ).scalar()
    return {"shopify": shopify_currency, "meta": meta_currency}


def build_shopify_dataframe(db: Session, client_id: str, since: date, until: date) -> pd.DataFrame:
    """One row per (product, month) — real revenue/units from synced orders."""
    month = func.date_trunc("month", ShopifyOrder.shopify_created_at)
    rows = db.execute(
        select(
            ShopifyProduct.shopify_product_id.label("product_id"),
            ShopifyProduct.title.label("product_title"),
            month.label("month"),
            func.sum(ShopifyOrderItem.price * ShopifyOrderItem.quantity).label("total_sales"),
            func.sum(ShopifyOrderItem.quantity).label("net_items_sold"),
        )
        .select_from(ShopifyOrderItem)
        .join(ShopifyOrder, ShopifyOrderItem.order_id == ShopifyOrder.id)
        .join(ShopifyProduct, ShopifyOrderItem.product_id == ShopifyProduct.id)
        .where(
            ShopifyOrderItem.client_id == client_id,
            ShopifyOrder.cancelled_at.is_(None),
            ShopifyOrder.shopify_created_at >= since,
            ShopifyOrder.shopify_created_at < until + timedelta(days=1),
        )
        .group_by(ShopifyProduct.shopify_product_id, ShopifyProduct.title, month)
    ).all()

    return pd.DataFrame(
        [
            {
                "Product ID": r.product_id,
                "Product Title": r.product_title or "Unknown",
                "Product variant title": "",
                "Month": r.month.date().isoformat(),
                "Total sales": float(r.total_sales or 0),
                "Net items sold": int(r.net_items_sold or 0),
            }
            for r in rows
        ],
        columns=SHOPIFY_KEEP_COLS,
    )


def build_meta_dataframe(
    db: Session, client_id: str, since: date, until: date
) -> tuple[pd.DataFrame, float]:
    """
    Returns (per-product Meta spend shaped like clean_meta()'s output,
    unattributed_meta_spend). See the module docstring for why the second
    value is never distributed into the DataFrame's rows.
    """
    until_exclusive = until + timedelta(days=1)
    month = func.date_trunc("month", MetaProductInsightDaily.date)
    rows = db.execute(
        select(
            ShopifyProduct.shopify_product_id.label("product_id"),
            ShopifyProduct.title.label("product_title"),
            month.label("month"),
            func.sum(MetaProductInsightDaily.spend).label("spend"),
            func.sum(MetaProductInsightDaily.impressions).label("impressions"),
            func.sum(MetaProductInsightDaily.clicks).label("clicks"),
        )
        .select_from(MetaProductInsightDaily)
        .join(ShopifyProduct, MetaProductInsightDaily.shopify_product_id == ShopifyProduct.id)
        .where(
            MetaProductInsightDaily.client_id == client_id,
            MetaProductInsightDaily.date >= since,
            MetaProductInsightDaily.date < until_exclusive,
        )
        .group_by(ShopifyProduct.shopify_product_id, ShopifyProduct.title, month)
    ).all()

    total_attributed = sum(float(r.spend or 0) for r in rows)

    account_total = db.execute(
        select(func.coalesce(func.sum(MetaInsightDaily.spend), 0)).where(
            MetaInsightDaily.client_id == client_id,
            MetaInsightDaily.date >= since,
            MetaInsightDaily.date < until_exclusive,
        )
    ).scalar_one()
    # Clamped at 0: Meta's account-level and product-level breakdown totals
    # can differ by small reporting/rounding amounts, occasionally putting
    # attributed spend a hair above the account total for the same range —
    # that is not "negative unattributed spend", it is reporting noise.
    unattributed = max(float(account_total) - total_attributed, 0.0)

    def _rate(numer: float, denom: float | None, scale: float = 1.0) -> float:
        return (numer / denom * scale) if denom else 0.0

    df = pd.DataFrame(
        [
            {
                "Product ID": r.product_id,
                "Product Title": r.product_title or "Unknown",
                "Month": r.month.date().isoformat(),
                "Amount spent (INR)": float(r.spend or 0),
                "Landing page views": 0,
                "CTR (all)": _rate(r.clicks or 0, r.impressions),
                "CPM (cost per 1,000 impressions)": _rate(float(r.spend or 0), r.impressions, 1000.0),
            }
            for r in rows
        ],
        columns=META_KEEP_COLS,
    )
    return df, unattributed
