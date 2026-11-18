# ╔══════════════════════════════════════════════════════════════════════╗
# ║  reporting/product_intelligence.py  —  Product Analysis upgrade       ║
# ║  (Section 16): campaign/ad counts, best performers, trend, and an     ║
# ║  explainable Product Opportunity Score.                              ║
# ║                                                                      ║
# ║  Integration-mode only — a CSV upload has no campaign/ad entities to  ║
# ║  count or rank, so Data Source Upload's Product Analysis is           ║
# ║  untouched; this is served from a separate endpoint the frontend      ║
# ║  only calls in Integration mode.                                      ║
# ║                                                                      ║
# ║  Reuses campaign_ad_analytics' purchase-metric/rate helpers rather     ║
# ║  than redefining them (Section 10: no duplicate business logic).      ║
# ╚══════════════════════════════════════════════════════════════════════╝

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from meta.models import MetaProductInsightDaily
from reporting.campaign_ad_analytics import _pick_purchase_metric, _rate, previous_period
from shopify.models import ShopifyOrder, ShopifyOrderItem, ShopifyProduct


def _shopify_totals(db: Session, client_id: str, since: date, until: date) -> dict[str, dict]:
    rows = db.execute(
        select(
            ShopifyProduct.shopify_product_id.label("product_id"),
            ShopifyProduct.id.label("pk"),
            ShopifyProduct.title,
            func.sum(ShopifyOrderItem.price * ShopifyOrderItem.quantity).label("revenue"),
            func.sum(ShopifyOrderItem.quantity).label("units"),
            func.count(func.distinct(ShopifyOrder.id)).label("orders"),
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
        .group_by(ShopifyProduct.shopify_product_id, ShopifyProduct.id, ShopifyProduct.title)
    ).all()
    return {
        r.pk: {
            "title": r.title or "Unknown", "revenue": float(r.revenue or 0),
            "units": int(r.units or 0), "orders": int(r.orders or 0),
        }
        for r in rows
    }


def _meta_product_rows(db: Session, client_id: str, since: date, until: date):
    return db.execute(
        select(
            MetaProductInsightDaily.shopify_product_id, MetaProductInsightDaily.meta_campaign_id,
            MetaProductInsightDaily.meta_ad_id, MetaProductInsightDaily.spend,
            MetaProductInsightDaily.action_values,
        ).where(
            MetaProductInsightDaily.client_id == client_id,
            MetaProductInsightDaily.date >= since, MetaProductInsightDaily.date <= until,
            MetaProductInsightDaily.shopify_product_id.isnot(None),
        )
    ).all()


def build_product_intelligence(db: Session, client_id: str, since: date, until: date) -> dict:
    shopify_now = _shopify_totals(db, client_id, since, until)
    prev_since, prev_until = previous_period(since, until)
    shopify_prev = _shopify_totals(db, client_id, prev_since, prev_until)

    meta_rows = _meta_product_rows(db, client_id, since, until)
    meta_prev_rows = _meta_product_rows(db, client_id, prev_since, prev_until)
    conversions_available = any(_pick_purchase_metric(r.action_values) > 0 for r in meta_rows)

    def aggregate_meta(rows) -> dict[str, dict]:
        by_product: dict[str, dict] = {}
        for row in rows:
            pid = row.shopify_product_id
            entry = by_product.setdefault(pid, {
                "spend": 0.0, "campaigns": {}, "ads": {},
            })
            entry["spend"] += float(row.spend or 0)
            if row.meta_campaign_id:
                c = entry["campaigns"].setdefault(row.meta_campaign_id, {"spend": 0.0, "value": 0.0})
                c["spend"] += float(row.spend or 0)
                c["value"] += _pick_purchase_metric(row.action_values)
            if row.meta_ad_id:
                a = entry["ads"].setdefault(row.meta_ad_id, {"spend": 0.0, "value": 0.0})
                a["spend"] += float(row.spend or 0)
                a["value"] += _pick_purchase_metric(row.action_values)
        return by_product

    meta_now = aggregate_meta(meta_rows)
    meta_prev = aggregate_meta(meta_prev_rows)

    all_product_ids = set(shopify_now) | set(meta_now)
    if not all_product_ids:
        return {"products": [], "accountAverages": {"roi": 0.0}, "productLevelConversionsAvailable": conversions_available}

    # Pooled ROI (sum revenue / sum spend), not a mean of per-product ratios —
    # averaging ROI directly lets a product with near-zero spend and any
    # revenue produce an astronomical ratio that dominates the mean, making
    # genuinely strong products (e.g. real 25-50x ROI) look "below average."
    # This matches how ROI is computed everywhere else in this codebase
    # (total revenue / total spend), never an average-of-ratios.
    spends_now = [meta_now.get(pid, {}).get("spend", 0.0) for pid in all_product_ids]
    revenues_now = [shopify_now.get(pid, {}).get("revenue", 0.0) for pid in all_product_ids]
    total_spend_now, total_revenue_now = sum(spends_now), sum(revenues_now)
    avg_roi = _rate(total_revenue_now, total_spend_now) or 0.0
    spending_products = [s for s in spends_now if s > 0]
    avg_spend = sum(spending_products) / len(spending_products) if spending_products else 0.0
    avg_revenue = sum(revenues_now) / len(revenues_now) if revenues_now else 0.0

    def best_entity(entities: dict[str, dict]) -> tuple[str | None, float | None]:
        """Ranks by platform ROAS when Meta reports it here, else by spend (labelled accordingly by the caller)."""
        if not entities:
            return None, None
        if conversions_available:
            best_id = max(entities, key=lambda k: _rate(entities[k]["value"], entities[k]["spend"]) or -1)
            return best_id, _rate(entities[best_id]["value"], entities[best_id]["spend"])
        best_id = max(entities, key=lambda k: entities[k]["spend"])
        return best_id, None

    products = []
    for pid in all_product_ids:
        s_now = shopify_now.get(pid, {"title": "Unknown", "revenue": 0.0, "units": 0, "orders": 0})
        s_prev = shopify_prev.get(pid, {"revenue": 0.0})
        m_now = meta_now.get(pid, {"spend": 0.0, "campaigns": {}, "ads": {}})
        m_prev = meta_prev.get(pid, {"spend": 0.0})

        revenue, spend = s_now["revenue"], m_now["spend"]
        # None (not 0) when there's no ad spend to measure against — a
        # product with real revenue and zero measured spend has an
        # undefined ROI, not a "zero return."
        roi = _rate(revenue, spend)
        revenue_trend = _rate(revenue - s_prev["revenue"], s_prev["revenue"]) if s_prev["revenue"] else None
        spend_trend = _rate(spend - m_prev["spend"], m_prev["spend"]) if m_prev["spend"] else None

        best_campaign_id, best_campaign_roas = best_entity(m_now["campaigns"])
        best_ad_id, best_ad_roas = best_entity(m_now["ads"])

        score, tag, reasons = _score_product(
            revenue=revenue, spend=spend, roi=roi, revenue_trend=revenue_trend,
            avg_roi=avg_roi, avg_spend=avg_spend, avg_revenue=avg_revenue,
        )

        products.append({
            "productId": pid,
            "title": s_now["title"],
            "revenue": round(revenue, 2), "units": s_now["units"], "orders": s_now["orders"],
            "metaSpend": round(spend, 2),
            "roi": round(roi, 4) if roi is not None else None,
            "revenueTrendPct": round(revenue_trend * 100, 1) if revenue_trend is not None else None,
            "spendTrendPct": round(spend_trend * 100, 1) if spend_trend is not None else None,
            "campaignCount": len(m_now["campaigns"]),
            "adCount": len(m_now["ads"]),
            "bestCampaignId": best_campaign_id, "bestCampaignRoas": best_campaign_roas,
            "bestAdId": best_ad_id, "bestAdRoas": best_ad_roas,
            "opportunityScore": score,
            "opportunityTag": tag,
            "opportunityReasons": reasons,
        })

    products.sort(key=lambda p: p["revenue"], reverse=True)
    return {
        "products": products,
        "accountAverages": {"roi": round(avg_roi, 4), "spend": round(avg_spend, 2), "revenue": round(avg_revenue, 2)},
        "productLevelConversionsAvailable": conversions_available,
        "bestEntityRankedBy": "platformRoas" if conversions_available else "spend",
    }


def _score_product(
    *, revenue: float, spend: float, roi: float | None, revenue_trend: float | None,
    avg_roi: float, avg_spend: float, avg_revenue: float,
) -> tuple[int, str, list[str]]:
    """
    Deterministic, explainable 0-100 score and a single primary tag — same
    contract as campaign_ad_analytics._score_ad: every point ties to a real
    number already computed above, nothing invented. Tag rules are checked
    in priority order (most actionable first); a product can plausibly fit
    more than one, but only the highest-priority match is shown.

    `roi=None` means no measured ad spend on this product at all — that's
    "no ad data to judge," not "zero return," so it's tagged separately
    ("no-ad-spend") rather than run through the efficiency comparisons.
    """
    reasons: list[str] = []
    score = 50

    if roi is not None and avg_roi > 0:
        if roi >= avg_roi * 1.2:
            score += 20; reasons.append("ROI is well above the average product in this view.")
        elif roi < avg_roi * 0.8:
            score -= 20; reasons.append("ROI is below the average product in this view.")

    if revenue_trend is not None:
        if revenue_trend >= 0.2:
            score += 15; reasons.append(f"Revenue is up {revenue_trend * 100:.0f}% vs. the prior period.")
        elif revenue_trend <= -0.2:
            score -= 15; reasons.append(f"Revenue is down {abs(revenue_trend) * 100:.0f}% vs. the prior period.")

    if roi is not None and spend > 0 and roi < 1:
        score -= 15; reasons.append("Ad spend on this product exceeds the revenue it produced.")

    score = max(0, min(100, score))

    # A strong revenue crash is checked before "no ad spend"/"inefficient":
    # an organic-only product losing 80% of its revenue is one of the most
    # actionable signals available, and shouldn't be hidden behind "no ad
    # spend to evaluate" just because there's nothing to say about its ROI.
    if revenue_trend is not None and revenue_trend <= -0.2:
        tag = "declining"
    elif roi is None:
        tag = "no-ad-spend"
    elif roi < 1 and (revenue_trend is None or revenue_trend <= 0):
        tag = "inefficient"
    elif avg_spend > 0 and spend < avg_spend * 0.5 and avg_roi > 0 and roi >= avg_roi * 1.2 and (revenue_trend or 0) > 0.2:
        tag = "emerging"
    elif avg_roi > 0 and roi >= avg_roi * 1.2 and (revenue_trend is None or revenue_trend >= 0):
        tag = "winner"
    elif avg_revenue > 0 and revenue >= avg_revenue * 1.2 and avg_roi > 0 and roi < avg_roi:
        tag = "high-revenue-low-efficiency"
    elif avg_spend > 0 and spend < avg_spend * 0.5 and avg_roi > 0 and roi >= avg_roi:
        tag = "low-spend-high-efficiency"
    else:
        tag = "steady"

    return score, tag, reasons
