# ╔══════════════════════════════════════════════════════════════════════╗
# ║  reporting/campaign_ad_analytics.py  —  Campaign Audit, Ad Audit,     ║
# ║  Product × Ad Matrix                                                 ║
# ║                                                                      ║
# ║  Reads only what's already synced (meta_insights_daily,               ║
# ║  meta_product_insights_daily, meta_campaigns/ad_sets/ads,             ║
# ║  shopify_products) — never calls Meta or Shopify's own APIs, so       ║
# ║  changing the date range here is a Postgres query, not a re-fetch.    ║
# ║                                                                      ║
# ║  Two distinct "revenue" concepts are used and never blended:          ║
# ║   - Meta-attributed conversion value (from action_values) — Meta's    ║
# ║     own claimed purchase value per ad/campaign/product. Real data     ║
# ║     Meta reports, not something we compute or estimate.               ║
# ║   - Shopify revenue (from merge_adapter) — only ever shown at the     ║
# ║     product level, never split per campaign/ad, because Shopify has   ║
# ║     no concept of which ad drove a given order. Attributing it that   ║
# ║     way would be exactly the fabricated allocation this app's         ║
# ║     architecture brief explicitly forbids.                            ║
# ╚══════════════════════════════════════════════════════════════════════╝

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from meta.models import MetaAd, MetaAdSet, MetaCampaign, MetaInsightDaily, MetaProductInsightDaily
from shopify.models import ShopifyProduct

# Meta reports overlapping purchase-like action types (e.g. "purchase" is
# web-only, "omni_purchase" also covers app/offline). Summing more than one
# would double-count the same conversion — take the single most complete
# type available instead.
_PURCHASE_ACTION_PRIORITY = ("omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase")


def _pick_purchase_metric(items: list | None) -> float:
    by_type: dict[str, str] = {}
    for item in items or []:
        action_type = item.get("action_type")
        if action_type and action_type not in by_type:
            by_type[action_type] = item.get("value")
    for candidate in _PURCHASE_ACTION_PRIORITY:
        if candidate in by_type:
            try:
                return float(by_type[candidate])
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def previous_period(since: date, until: date) -> tuple[date, date]:
    """Same-length window immediately preceding `since` — for trend comparisons."""
    span_days = (until - since).days + 1
    prev_until = since - timedelta(days=1)
    prev_since = prev_until - timedelta(days=span_days - 1)
    return prev_since, prev_until


def _rate(numer: float, denom: float) -> float | None:
    return (numer / denom) if denom else None


class _Bucket:
    """Accumulates raw MetaInsightDaily rows into one entity's totals."""

    __slots__ = ("spend", "impressions", "clicks", "reach", "purchases", "purchase_value")

    def __init__(self) -> None:
        self.spend = 0.0
        self.impressions = 0
        self.clicks = 0
        self.reach = 0
        self.purchases = 0.0
        self.purchase_value = 0.0

    def add(self, row) -> None:
        self.spend += float(row.spend or 0)
        self.impressions += int(row.impressions or 0)
        self.clicks += int(row.clicks or 0)
        self.reach += int(row.reach or 0)
        self.purchases += _pick_purchase_metric(row.actions)
        self.purchase_value += _pick_purchase_metric(row.action_values)

    def metrics(self) -> dict:
        return {
            "spend": round(self.spend, 2),
            "impressions": self.impressions,
            "clicks": self.clicks,
            "reach": self.reach,
            "conversions": round(self.purchases, 2),
            "conversionValue": round(self.purchase_value, 2),
            "ctr": _rate(self.clicks, self.impressions),
            "cpc": _rate(self.spend, self.clicks),
            "cpm": _rate(self.spend, self.impressions) * 1000 if self.impressions else None,
            "frequency": _rate(self.impressions, self.reach),
            "platformRoas": _rate(self.purchase_value, self.spend),
        }


def _fetch_insight_rows(db: Session, client_id: str, since: date, until: date):
    return db.execute(
        select(
            MetaInsightDaily.meta_campaign_id, MetaInsightDaily.meta_ad_set_id, MetaInsightDaily.meta_ad_id,
            MetaInsightDaily.spend, MetaInsightDaily.impressions, MetaInsightDaily.clicks,
            MetaInsightDaily.reach, MetaInsightDaily.actions, MetaInsightDaily.action_values,
        ).where(
            MetaInsightDaily.client_id == client_id,
            MetaInsightDaily.date >= since, MetaInsightDaily.date <= until,
        )
    ).all()


def _fetch_product_insight_rows(db: Session, client_id: str, since: date, until: date):
    return db.execute(
        select(
            MetaProductInsightDaily.meta_campaign_id, MetaProductInsightDaily.meta_ad_id,
            MetaProductInsightDaily.shopify_product_id, MetaProductInsightDaily.meta_product_name,
            MetaProductInsightDaily.spend, MetaProductInsightDaily.action_values,
            ShopifyProduct.title,
        )
        .outerjoin(ShopifyProduct, MetaProductInsightDaily.shopify_product_id == ShopifyProduct.id)
        .where(
            MetaProductInsightDaily.client_id == client_id,
            MetaProductInsightDaily.date >= since, MetaProductInsightDaily.date <= until,
        )
    ).all()


def _name_lookups(db: Session, client_id: str) -> tuple[dict, dict, dict]:
    campaigns = {c.meta_campaign_id: c.name for c in db.query(MetaCampaign).filter_by(client_id=client_id)}
    ad_sets = {a.meta_ad_set_id: a.name for a in db.query(MetaAdSet).filter_by(client_id=client_id)}
    ads = {a.meta_ad_id: a.name for a in db.query(MetaAd).filter_by(client_id=client_id)}
    return campaigns, ad_sets, ads


def _has_product_level_conversions(rows) -> bool:
    """
    Meta's product-breakdown Insights edge (level=ad&breakdowns=product_id)
    doesn't always report purchase actions/values at that granularity, even
    when the same ad has real purchases at the account/ad level — confirmed
    empirically (2026-08-23) against a live catalog-sales account: 0 of
    2,149 product-level rows carried any purchase-type action, only
    engagement actions (likes, clicks, video views). A cell with no purchase
    data in that case means "Meta doesn't expose this here", not "zero
    sales" — those must render as unavailable, never as a fabricated 0.
    """
    return any(_pick_purchase_metric(row.action_values) > 0 for row in rows)


def _product_mix(rows, key_field: str, key_value: str, conversions_available: bool) -> list[dict]:
    """Products attributed to one campaign or ad, sorted by spend descending."""
    by_product: dict[str, dict] = {}
    for row in rows:
        if getattr(row, key_field) != key_value:
            continue
        pid = row.shopify_product_id or f"unmatched:{row.meta_product_name}"
        entry = by_product.setdefault(pid, {
            "productId": row.shopify_product_id,
            "title": row.title or row.meta_product_name or "Unmatched product",
            "spend": 0.0, "conversionValue": 0.0,
        })
        entry["spend"] += float(row.spend or 0)
        entry["conversionValue"] += _pick_purchase_metric(row.action_values)

    mix = sorted(by_product.values(), key=lambda e: e["spend"], reverse=True)
    for entry in mix:
        entry["spend"] = round(entry["spend"], 2)
        if conversions_available:
            entry["conversionValue"] = round(entry["conversionValue"], 2)
            entry["platformRoas"] = _rate(entry["conversionValue"], entry["spend"])
        else:
            entry["conversionValue"] = None
            entry["platformRoas"] = None
    return mix


def _primary_driver_note(mix: list[dict]) -> str | None:
    """Deterministic concentration check — never an AI guess."""
    if not mix or mix[0]["conversionValue"] is None:
        return None
    total_value = sum(p["conversionValue"] for p in mix)
    if total_value <= 0:
        return None
    top = mix[0]
    share = top["conversionValue"] / total_value
    if share >= 0.5:
        return f"{share:.0%} of this entity's Meta-attributed conversion value comes from \"{top['title']}\"."
    return None


def build_campaign_audit(db: Session, client_id: str, since: date, until: date) -> dict:
    insight_rows = _fetch_insight_rows(db, client_id, since, until)
    prev_since, prev_until = previous_period(since, until)
    prev_rows = _fetch_insight_rows(db, client_id, prev_since, prev_until)
    product_rows = _fetch_product_insight_rows(db, client_id, since, until)
    campaign_names, _, _ = _name_lookups(db, client_id)
    conversions_available = _has_product_level_conversions(product_rows)

    buckets: dict[str, _Bucket] = {}
    for row in insight_rows:
        cid = row.meta_campaign_id
        if cid is None:
            continue
        buckets.setdefault(cid, _Bucket()).add(row)

    previous: dict[str, _Bucket] = {}
    for row in prev_rows:
        if row.meta_campaign_id is None:
            continue
        previous.setdefault(row.meta_campaign_id, _Bucket()).add(row)

    product_attributed_spend: dict[str, float] = {}
    for row in product_rows:
        cid = row.meta_campaign_id
        if cid is None:
            continue
        product_attributed_spend[cid] = product_attributed_spend.get(cid, 0.0) + float(row.spend or 0)

    campaigns = []
    for cid, bucket in buckets.items():
        metrics = bucket.metrics()
        prev_metrics = previous[cid].metrics() if cid in previous else None
        attributed = round(product_attributed_spend.get(cid, 0.0), 2)
        mix = _product_mix(product_rows, "meta_campaign_id", cid, conversions_available)
        campaigns.append({
            "campaignId": cid,
            "name": campaign_names.get(cid) or cid,
            **metrics,
            "trend": _trend(metrics, prev_metrics),
            "productAttributedSpend": attributed,
            "unattributedSpend": round(max(metrics["spend"] - attributed, 0.0), 2),
            "productMix": mix,
            "primaryDriver": _primary_driver_note(mix),
        })
    campaigns.sort(key=lambda c: c["spend"], reverse=True)
    return {"campaigns": campaigns, "productLevelConversionsAvailable": conversions_available}


def build_ad_audit(db: Session, client_id: str, since: date, until: date) -> dict:
    insight_rows = _fetch_insight_rows(db, client_id, since, until)
    prev_since, prev_until = previous_period(since, until)
    prev_rows = _fetch_insight_rows(db, client_id, prev_since, prev_until)
    product_rows = _fetch_product_insight_rows(db, client_id, since, until)
    campaign_names, ad_set_names, ad_names = _name_lookups(db, client_id)
    conversions_available = _has_product_level_conversions(product_rows)

    current: dict[str, _Bucket] = {}
    ad_context: dict[str, tuple[str | None, str | None]] = {}
    for row in insight_rows:
        aid = row.meta_ad_id
        if aid is None:
            continue
        current.setdefault(aid, _Bucket()).add(row)
        ad_context[aid] = (row.meta_campaign_id, row.meta_ad_set_id)

    previous: dict[str, _Bucket] = {}
    for row in prev_rows:
        if row.meta_ad_id is None:
            continue
        previous.setdefault(row.meta_ad_id, _Bucket()).add(row)

    # Account-wide (in-view) averages — what "strong CTR" / "low CPC" are measured against.
    n = len(current) or 1
    avg_ctr = sum((b.metrics()["ctr"] or 0) for b in current.values()) / n
    avg_cpc = sum((b.metrics()["cpc"] or 0) for b in current.values()) / n

    ads = []
    for aid, bucket in current.items():
        metrics = bucket.metrics()
        prev_metrics = previous[aid].metrics() if aid in previous else None
        mix = _product_mix(product_rows, "meta_ad_id", aid, conversions_available)
        campaign_id, ad_set_id = ad_context[aid]

        score, reasons = _score_ad(metrics, prev_metrics, avg_ctr, avg_cpc)

        ads.append({
            "adId": aid,
            "name": ad_names.get(aid) or aid,
            "campaignId": campaign_id, "campaignName": campaign_names.get(campaign_id) if campaign_id else None,
            "adSetId": ad_set_id, "adSetName": ad_set_names.get(ad_set_id) if ad_set_id else None,
            **metrics,
            "trend": _trend(metrics, prev_metrics),
            "productMix": mix,
            "score": score,
            "scoreReasons": reasons,
        })
    ads.sort(key=lambda a: a["spend"], reverse=True)
    return {"ads": ads, "productLevelConversionsAvailable": conversions_available}


def _trend(current: dict, previous: dict | None) -> dict | None:
    if previous is None:
        return None

    def pct_change(key: str) -> float | None:
        cur, prev = current.get(key), previous.get(key)
        if cur is None or prev is None or prev == 0:
            return None
        return round((cur - prev) / prev * 100, 1)

    return {k: pct_change(k) for k in ("platformRoas", "cpm", "ctr", "frequency", "spend")}


def _score_ad(
    metrics: dict, prev_metrics: dict | None, avg_ctr: float, avg_cpc: float,
) -> tuple[int, list[str]]:
    """
    Deterministic, explainable 0-100 score — every point is tied to a real,
    already-computed metric, never an invented one (Section 14 of the brief:
    "do not invent metrics", "the score should be explainable").
    """
    score = 50
    reasons: list[str] = []

    ctr = metrics.get("ctr")
    if ctr is not None and avg_ctr > 0:
        if ctr >= avg_ctr * 1.1:
            score += 15; reasons.append("CTR is above the account average for this period.")
        elif ctr <= avg_ctr * 0.9:
            score -= 15; reasons.append("CTR is below the account average for this period.")

    cpc = metrics.get("cpc")
    if cpc is not None and avg_cpc > 0:
        if cpc <= avg_cpc * 0.9:
            score += 10; reasons.append("CPC is lower than the account average.")
        elif cpc >= avg_cpc * 1.1:
            score -= 10; reasons.append("CPC is higher than the account average.")

    if metrics.get("platformRoas") is not None:
        if metrics["platformRoas"] >= 2:
            score += 10; reasons.append("Platform-reported ROAS is strong.")
        elif metrics["platformRoas"] < 1:
            score -= 10; reasons.append("Platform-reported ROAS is under 1x.")

    trend = _trend(metrics, prev_metrics) if prev_metrics else None
    if trend:
        if trend.get("platformRoas") is not None:
            if trend["platformRoas"] <= -15:
                score -= 15; reasons.append(f"ROAS declined {abs(trend['platformRoas'])}% vs the prior period.")
            elif trend["platformRoas"] >= 15:
                score += 10; reasons.append(f"ROAS improved {trend['platformRoas']}% vs the prior period.")
        if trend.get("cpm") is not None and trend["cpm"] >= 15:
            score -= 10; reasons.append(f"CPM rose {trend['cpm']}% vs the prior period.")
        if trend.get("frequency") is not None and trend["frequency"] >= 20:
            score -= 10; reasons.append(f"Frequency rose {trend['frequency']}% vs the prior period — possible fatigue.")

    return max(0, min(100, score)), reasons


def build_product_ad_matrix(db: Session, client_id: str, since: date, until: date) -> dict:
    """
    Rows = products, columns = ads. Each cell's spend/conversionValue/platformRoas
    is real Meta-reported data (see module docstring) — never Shopify revenue,
    which has no per-ad concept.
    """
    product_rows = _fetch_product_insight_rows(db, client_id, since, until)
    _, _, ad_names = _name_lookups(db, client_id)
    conversions_available = _has_product_level_conversions(product_rows)

    products: dict[str, str] = {}
    ads: dict[str, str] = {}
    cells: dict[tuple[str, str], dict] = {}

    for row in product_rows:
        pid = row.shopify_product_id or f"unmatched:{row.meta_product_name}"
        aid = row.meta_ad_id
        products.setdefault(pid, row.title or row.meta_product_name or "Unmatched product")
        ads.setdefault(aid, ad_names.get(aid) or aid)
        cell = cells.setdefault((pid, aid), {"spend": 0.0, "conversionValue": 0.0})
        cell["spend"] += float(row.spend or 0)
        cell["conversionValue"] += _pick_purchase_metric(row.action_values)

    for cell in cells.values():
        cell["spend"] = round(cell["spend"], 2)
        if conversions_available:
            cell["conversionValue"] = round(cell["conversionValue"], 2)
            cell["platformRoas"] = _rate(cell["conversionValue"], cell["spend"])
        else:
            cell["conversionValue"] = None
            cell["platformRoas"] = None

    return {
        "products": [{"id": pid, "title": title} for pid, title in products.items()],
        "ads": [{"id": aid, "name": name} for aid, name in ads.items()],
        "cells": [
            {"productId": pid, "adId": aid, **cell}
            for (pid, aid), cell in cells.items()
        ],
        "productLevelConversionsAvailable": conversions_available,
    }
