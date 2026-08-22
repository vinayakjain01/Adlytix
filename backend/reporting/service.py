# ╔══════════════════════════════════════════════════════════════════════╗
# ║  reporting/service.py  —  Unified Shopify revenue + Meta spend        ║
# ║                                                                      ║
# ║  Grain: one row per (client, date) — see docs/DATABASE_SCHEMA.md.     ║
# ║                                                                      ║
# ║  Deliberately date-level, not product-level. The existing CSV         ║
# ║  engine (analytics.py) merges Meta spend and Shopify revenue by       ║
# ║  Product ID, but that only works because that CSV is a Meta Catalog   ║
# ║  Sales export — spend already attributed per product. The live        ║
# ║  Marketing API data synced into meta_insights_daily is campaign/ad/   ║
# ║  day level, not product level, unless the advertiser runs Dynamic     ║
# ║  Product Ads with a product-id breakdown, which nothing here          ║
# ║  assumes. Claiming product-level ROAS from data that structurally     ║
# ║  can't support it would be worse than not offering it — date-level    ║
# ║  is what this data honestly supports today.                          ║
# ║                                                                      ║
# ║  SQL aggregation, not Pandas (Section 24 of the architecture brief:   ║
# ║  use SQL for DB-level rollups, Pandas only where it adds real value —║
# ║  there is no per-row transformation here that needs it).              ║
# ╚══════════════════════════════════════════════════════════════════════╝

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from meta.models import MetaInsightDaily
from shopify.models import ShopifyOrder

DEFAULT_RANGE_DAYS = 30


def get_unified_overview(db: Session, client_id: str, *, since: date | None = None, until: date | None = None) -> dict:
    until = until or date.today()
    since = since or (until - timedelta(days=DEFAULT_RANGE_DAYS - 1))

    revenue_rows = db.execute(
        select(
            func.date(ShopifyOrder.shopify_created_at).label("day"),
            func.sum(ShopifyOrder.total_price).label("revenue"),
            func.count(ShopifyOrder.id).label("orders"),
        )
        .where(
            ShopifyOrder.client_id == client_id,
            ShopifyOrder.cancelled_at.is_(None),
            func.date(ShopifyOrder.shopify_created_at) >= since,
            func.date(ShopifyOrder.shopify_created_at) <= until,
        )
        .group_by(func.date(ShopifyOrder.shopify_created_at))
    ).all()

    spend_rows = db.execute(
        select(
            MetaInsightDaily.date.label("day"),
            func.sum(MetaInsightDaily.spend).label("spend"),
            func.sum(MetaInsightDaily.impressions).label("impressions"),
            func.sum(MetaInsightDaily.clicks).label("clicks"),
        )
        .where(
            MetaInsightDaily.client_id == client_id,
            MetaInsightDaily.date >= since,
            MetaInsightDaily.date <= until,
        )
        .group_by(MetaInsightDaily.date)
    ).all()

    by_day: dict[date, dict] = {}
    for row in revenue_rows:
        by_day.setdefault(row.day, {}).update(
            revenue=float(row.revenue or 0), orders=int(row.orders or 0)
        )
    for row in spend_rows:
        by_day.setdefault(row.day, {}).update(
            spend=float(row.spend or 0), impressions=int(row.impressions or 0), clicks=int(row.clicks or 0),
        )

    daily = []
    total_revenue = total_spend = 0.0
    total_orders = total_impressions = total_clicks = 0
    for day in sorted(by_day):
        entry = by_day[day]
        revenue = entry.get("revenue", 0.0)
        spend = entry.get("spend", 0.0)
        orders = entry.get("orders", 0)
        impressions = entry.get("impressions", 0)
        clicks = entry.get("clicks", 0)
        total_revenue += revenue
        total_spend += spend
        total_orders += orders
        total_impressions += impressions
        total_clicks += clicks
        daily.append({
            "date": day.isoformat(),
            "revenue": round(revenue, 2),
            "spend": round(spend, 2),
            "roas": round(revenue / spend, 4) if spend > 0 else None,
            "orders": orders,
            "impressions": impressions,
            "clicks": clicks,
        })

    return {
        "since": since.isoformat(),
        "until": until.isoformat(),
        "daily": daily,
        "totals": {
            "revenue": round(total_revenue, 2),
            "spend": round(total_spend, 2),
            "roas": round(total_revenue / total_spend, 4) if total_spend > 0 else None,
            "orders": total_orders,
            "impressions": total_impressions,
            "clicks": total_clicks,
        },
        "hasShopifyData": bool(revenue_rows),
        "hasMetaData": bool(spend_rows),
    }
