# ╔══════════════════════════════════════════════════════════════════════╗
# ║  reporting/opportunity_center.py  —  the centralized action layer     ║
# ║                                                                      ║
# ║  Every opportunity here is derived from an already-computed signal   ║
# ║  in product_intelligence.py / campaign_ad_analytics.py — nothing is   ║
# ║  recalculated. This module's only job is to translate those signals   ║
# ║  into one common, drillable shape.                                    ║
# ║                                                                      ║
# ║  Only categories with real backing data are produced: Scale,          ║
# ║  Product Opportunity, Performance Drop, and Creative Fatigue (from     ║
# ║  Ad Audit's own frequency/CTR trend — the only creative-adjacent       ║
# ║  signal actually available; no creative asset data is synced yet).    ║
# ║  Reduce/Pause, Inventory Risk, Attribution Difference and              ║
# ║  Profitability Risk are deliberately omitted rather than shown         ║
# ║  empty — those features don't exist here, and a category with         ║
# ║  "0 found" would wrongly imply they were checked.                      ║
# ╚══════════════════════════════════════════════════════════════════════╝

from datetime import date

from sqlalchemy.orm import Session

from reporting import campaign_ad_analytics, product_intelligence

_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _confidence(spend: float, avg_spend: float) -> str:
    """More spend behind a signal means less noise in the numbers driving it."""
    if avg_spend <= 0:
        return "low"
    if spend >= avg_spend:
        return "high"
    if spend >= avg_spend * 0.3:
        return "medium"
    return "low"


def _opportunity(
    *, category: str, severity: str, entity_type: str, entity_id: str, entity_name: str,
    title: str, metric: str, metric_value: float | None, comparison_metric: float | None,
    reason: str, recommended_action: str, evidence: dict, confidence: str,
) -> dict:
    return {
        "category": category, "severity": severity,
        "entityType": entity_type, "entityId": entity_id, "entityName": entity_name,
        "title": title, "metric": metric, "metricValue": metric_value, "comparisonMetric": comparison_metric,
        "reason": reason, "recommendedAction": recommended_action,
        "evidence": evidence, "confidence": confidence,
    }


def build_opportunity_center(db: Session, client_id: str, since: date, until: date) -> dict:
    product_result = product_intelligence.build_product_intelligence(db, client_id, since, until)
    ad_result = campaign_ad_analytics.build_ad_audit(db, client_id, since, until)
    avg = product_result["accountAverages"]

    opportunities: list[dict] = []

    # ── Scale: winners (proven) and emerging (smaller, earlier signal) ──
    for p in product_result["products"]:
        if p["opportunityTag"] not in ("winner", "emerging"):
            continue
        severity = "medium" if p["opportunityTag"] == "winner" else "low"
        opportunities.append(_opportunity(
            category="scale", severity=severity,
            entity_type="product", entity_id=p["productId"], entity_name=p["title"],
            title=f'Scale opportunity — {p["title"]}',
            metric="roi", metric_value=p["roi"], comparison_metric=avg["roi"],
            reason="; ".join(p["opportunityReasons"]) or "Efficient and growing relative to the account.",
            recommended_action=f'Consider increasing budget or testing more creatives for "{p["title"]}".',
            confidence=_confidence(p["metaSpend"], avg["spend"]),
            evidence={
                "revenue": p["revenue"], "metaSpend": p["metaSpend"], "roi": p["roi"],
                "revenueTrendPct": p["revenueTrendPct"], "campaignCount": p["campaignCount"], "adCount": p["adCount"],
            },
        ))

    # ── Product Opportunity: revenue/efficiency mismatches ───────────────
    for p in product_result["products"]:
        if p["opportunityTag"] == "high-revenue-low-efficiency":
            opportunities.append(_opportunity(
                category="product-opportunity", severity="medium",
                entity_type="product", entity_id=p["productId"], entity_name=p["title"],
                title=f'Efficiency opportunity — {p["title"]}',
                metric="roi", metric_value=p["roi"], comparison_metric=avg["roi"],
                reason="High revenue contributor but below-average efficiency — real optimisation headroom.",
                recommended_action=f'Audit targeting/creative on "{p["title"]}" — its revenue size makes efficiency gains here worth more than elsewhere.',
                confidence=_confidence(p["metaSpend"], avg["spend"]),
                evidence={"revenue": p["revenue"], "metaSpend": p["metaSpend"], "roi": p["roi"]},
            ))
        elif p["opportunityTag"] == "low-spend-high-efficiency":
            opportunities.append(_opportunity(
                category="product-opportunity", severity="low",
                entity_type="product", entity_id=p["productId"], entity_name=p["title"],
                title=f'Under-invested — {p["title"]}',
                metric="roi", metric_value=p["roi"], comparison_metric=avg["roi"],
                reason="Above-average efficiency on below-average spend — currently under-tested.",
                recommended_action=f'Consider testing a modest budget increase on "{p["title"]}" to see if efficiency holds at scale.',
                confidence=_confidence(p["metaSpend"], avg["spend"]),
                evidence={"revenue": p["revenue"], "metaSpend": p["metaSpend"], "roi": p["roi"]},
            ))

    # ── Performance Drop: declining products ─────────────────────────────
    for p in product_result["products"]:
        if p["opportunityTag"] != "declining":
            continue
        opportunities.append(_opportunity(
            category="performance-drop", severity="medium",
            entity_type="product", entity_id=p["productId"], entity_name=p["title"],
            title=f'Performance drop — {p["title"]}',
            metric="revenueTrendPct", metric_value=p["revenueTrendPct"], comparison_metric=0.0,
            reason="; ".join(p["opportunityReasons"]) or "Revenue is down materially vs. the prior period.",
            recommended_action=f'Review recent changes to "{p["title"]}"\'s ads/pricing/inventory — performance has declined vs. the prior period.',
            confidence=_confidence(p["metaSpend"], avg["spend"]),
            evidence={"revenue": p["revenue"], "revenueTrendPct": p["revenueTrendPct"], "spendTrendPct": p["spendTrendPct"]},
        ))

    # ── Creative Fatigue: from Ad Audit's own frequency/CTR trend ────────
    # No creative asset data is synced yet (no image/text/headline fields —
    # confirmed absent from meta_ads), so this uses the only fatigue-
    # adjacent signal that's real: an ad's own frequency and CTR trend
    # vs. its prior period, already computed in build_ad_audit.
    ad_spends = [a["spend"] for a in ad_result["ads"] if a["spend"] > 0]
    avg_ad_spend = sum(ad_spends) / len(ad_spends) if ad_spends else 0.0
    for a in ad_result["ads"]:
        trend = a.get("trend")
        if not trend:
            continue
        freq_rising = trend.get("frequency") is not None and trend["frequency"] >= 15
        ctr_declining = trend.get("ctr") is not None and trend["ctr"] <= -15
        if not freq_rising and not ctr_declining:
            continue
        # Both signals together is a real, corroborated fatigue pattern;
        # either alone is still worth surfacing, just with less certainty.
        severity = "high" if (freq_rising and ctr_declining) else "medium"
        parts = []
        if freq_rising:
            parts.append(f'frequency rose {trend["frequency"]:.0f}%')
        if ctr_declining:
            parts.append(f'CTR fell {abs(trend["ctr"]):.0f}%')
        reason = " and ".join(parts) + " vs. the prior period."
        opportunities.append(_opportunity(
            category="creative-fatigue", severity=severity,
            entity_type="ad", entity_id=a["adId"], entity_name=a["name"],
            title=f'Creative fatigue — {a["name"]}',
            metric="ctrTrendPct" if ctr_declining else "frequencyTrendPct",
            metric_value=trend.get("ctr") if ctr_declining else trend.get("frequency"),
            comparison_metric=-15.0 if ctr_declining else 15.0,
            reason=reason.capitalize(),
            recommended_action=f'Test a new creative variation for "{a["name"]}" while keeping its current targeting/product focus.',
            confidence=_confidence(a["spend"], avg_ad_spend),
            evidence={"spend": a["spend"], "frequency": a["frequency"], "frequencyTrendPct": trend.get("frequency"), "ctrTrendPct": trend.get("ctr")},
        ))

    opportunities.sort(key=lambda o: (_SEVERITY_RANK.get(o["severity"], 3), -(o["evidence"].get("spend") or 0)))

    counts: dict[str, int] = {}
    for o in opportunities:
        counts[o["category"]] = counts.get(o["category"], 0) + 1

    return {
        "opportunities": opportunities,
        "counts": counts,
    }
