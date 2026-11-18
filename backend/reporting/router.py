# ╔══════════════════════════════════════════════════════════════════════╗
# ║  reporting/router.py  —  /api/v1/analytics                           ║
# ╚══════════════════════════════════════════════════════════════════════╝

import math
from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from analytics import run_overall_view, run_product_analysis
from auth import require_client_scope
from currency import DEFAULT_BASE, RateUnavailable, normalise_sources
from db import get_db
from models import User
from reporting import campaign_ad_analytics, merge_adapter, opportunity_center, product_intelligence, service

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _safe(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _df_to_records(df: pd.DataFrame) -> list:
    return [{k: _safe(v) for k, v in row.items()} for row in df.to_dict(orient="records")]


@router.get("/overview")
def unified_overview(
    since: date | None = None,
    until: date | None = None,
    user: User = Depends(require_client_scope),
    db: Session = Depends(get_db),
) -> dict:
    """
    Date-level Shopify revenue vs. Meta spend for the caller's tenant.
    Defaults to the last 30 days. See reporting/service.py for why this is
    date-level rather than product-level.
    """
    if since and until and since > until:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`since` must not be after `until`."
        )
    return service.get_unified_overview(db, user.client_id, since=since, until=until)


@router.get("/sources")
def analytics_sources(
    user: User = Depends(require_client_scope), db: Session = Depends(get_db)
) -> dict:
    """What currency each connected source's synced data is actually in — lets the
    frontend pre-fill Integration mode's currency step instead of guessing."""
    return merge_adapter.source_currencies(db, user.client_id)


@router.get("/products")
def product_analysis(
    since: date | None = None,
    until: date | None = None,
    base_currency: str = DEFAULT_BASE,
    meta_currency: str = "",
    shopify_currency: str = "",
    spend_pct_thresh: float = 100,
    rev_pct_thresh: float = 100,
    user: User = Depends(require_client_scope),
    db: Session = Depends(get_db),
) -> dict:
    """
    Integration-mode equivalent of POST /api/analyse: same response shape,
    same merge/quadrant engine (analytics.run_overall_view /
    run_product_analysis, called unmodified), but built from synced
    Shopify + Meta data instead of an upload. Defaults to the last 30 days.

    `unattributedMetaSpend` is real Meta spend for the period that isn't
    attributable to any specific product (see merge_adapter's module
    docstring) — never folded into any product row, always shown separately.
    """
    if since and until and since > until:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`since` must not be after `until`."
        )
    since_d, until_d = merge_adapter.default_range(since, until)

    shopify_df = merge_adapter.build_shopify_dataframe(db, user.client_id, since_d, until_d)
    meta_df, unattributed_spend = merge_adapter.build_meta_dataframe(db, user.client_id, since_d, until_d)

    if shopify_df.empty:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No synced Shopify orders in this date range yet.",
        )

    # Same currency-normalisation step /api/analyse uses — reused exactly,
    # not a second currency system (Section 3 of this phase's brief).
    try:
        converted, currency_audit = normalise_sources(
            {"meta": meta_df, "shopify": shopify_df, "google": None},
            {"meta": meta_currency, "shopify": shopify_currency, "google": ""},
            base_currency,
        )
        meta_df, shopify_df = converted["meta"], converted["shopify"]
    except RateUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Currency conversion is required but unavailable: {exc}",
        )

    try:
        merged_df, has_month = run_overall_view(meta_df, shopify_df, None)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Merge error: {exc}")

    try:
        product_result = run_product_analysis(
            meta_df, shopify_df, spend_pct_thresh=spend_pct_thresh, rev_pct_thresh=rev_pct_thresh,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Product analysis error: {exc}")

    kpis = {
        "totalProducts": int(merged_df["Product ID"].nunique()),
        "totalMetaSpend": float(merged_df["Meta Spend"].sum()) if "Meta Spend" in merged_df.columns else 0,
        "totalSpend": float(merged_df["Total Spend"].sum()) if "Total Spend" in merged_df.columns else 0,
        "totalRevenue": float(merged_df["Shopify Revenue"].sum()) if "Shopify Revenue" in merged_df.columns else 0,
    }
    kpis["overallRoi"] = kpis["totalRevenue"] / kpis["totalSpend"] if kpis["totalSpend"] else 0

    return {
        "ok": True,
        "since": since_d.isoformat(),
        "until": until_d.isoformat(),
        "hasMonth": has_month,
        "hasGoogle": False,
        "currency": currency_audit,
        "products": _df_to_records(merged_df),
        "kpis": kpis,
        "quadrants": {
            "q1": _df_to_records(product_result["q1"]),
            "q2": _df_to_records(product_result["q2"]),
            "q3": _df_to_records(product_result["q3"]),
            "q4": _df_to_records(product_result["q4"]),
            "spCut": _safe(product_result["sp_cut"]),
            "rvCut": _safe(product_result["rv_cut"]),
        },
        "unattributedMetaSpend": round(unattributed_spend, 2),
        "warnings": (
            [f"₹{unattributed_spend:,.0f} of Meta spend in this range isn't attributable to a specific "
             "product (not a catalog-ads impression) and is excluded from every product's figures above."]
            if unattributed_spend > 0 else []
        ),
        "summary": {
            "products": product_result["all"].to_dict(orient="records") if not product_result["all"].empty else [],
            "total_spend": kpis["totalSpend"],
            "total_rev": kpis["totalRevenue"],
            "roi": kpis["overallRoi"],
            "meta_spend": kpis["totalMetaSpend"],
        },
    }


@router.get("/product-intelligence")
def product_intelligence_view(
    since: date | None = None, until: date | None = None,
    user: User = Depends(require_client_scope), db: Session = Depends(get_db),
) -> dict:
    """
    Integration-mode-only upgrade to Product Analysis (Section 16): trend,
    campaign/ad counts, best performers, and an explainable Product
    Opportunity Score. Data Source Upload's Product Analysis has no
    campaign/ad entities to count, so it doesn't call this — see
    product_intelligence.py's module docstring.
    """
    if since and until and since > until:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`since` must not be after `until`.")
    since_d, until_d = merge_adapter.default_range(since, until)
    result = product_intelligence.build_product_intelligence(db, user.client_id, since_d, until_d)
    return {"since": since_d.isoformat(), "until": until_d.isoformat(), **result}


@router.get("/opportunity-center")
def opportunity_center_view(
    since: date | None = None, until: date | None = None,
    user: User = Depends(require_client_scope), db: Session = Depends(get_db),
) -> dict:
    """
    Every opportunity here is a real signal already computed by Product
    Intelligence / Campaign & Ad Audit — see opportunity_center.py's module
    docstring for which categories are covered and why the ones without
    real backing data are omitted rather than shown empty.
    """
    if since and until and since > until:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`since` must not be after `until`.")
    since_d, until_d = merge_adapter.default_range(since, until)
    result = opportunity_center.build_opportunity_center(db, user.client_id, since_d, until_d)
    return {"since": since_d.isoformat(), "until": until_d.isoformat(), **result}


@router.get("/campaigns")
def campaign_audit(
    since: date | None = None, until: date | None = None,
    user: User = Depends(require_client_scope), db: Session = Depends(get_db),
) -> dict:
    """
    Per-campaign spend/CTR/CPM/platform-ROAS plus which products actually
    drove that number (real Meta-attributed spend/value per product, never
    Shopify revenue split by campaign — Shopify has no per-campaign
    attribution to split). Defaults to the last 30 days; reads only what's
    already synced.
    """
    if since and until and since > until:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`since` must not be after `until`.")
    since_d, until_d = merge_adapter.default_range(since, until)
    result = campaign_ad_analytics.build_campaign_audit(db, user.client_id, since_d, until_d)
    return {"since": since_d.isoformat(), "until": until_d.isoformat(), **result}


@router.get("/ads")
def ad_audit(
    since: date | None = None, until: date | None = None,
    user: User = Depends(require_client_scope), db: Session = Depends(get_db),
) -> dict:
    """
    Per-ad metrics, trend vs the prior comparable period, product mix, and an
    explainable 0-100 score built only from metrics already computed here —
    see campaign_ad_analytics.build_ad_audit's docstring.
    """
    if since and until and since > until:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`since` must not be after `until`.")
    since_d, until_d = merge_adapter.default_range(since, until)
    result = campaign_ad_analytics.build_ad_audit(db, user.client_id, since_d, until_d)
    return {"since": since_d.isoformat(), "until": until_d.isoformat(), **result}


@router.get("/product-ad-matrix")
def product_ad_matrix(
    since: date | None = None, until: date | None = None,
    user: User = Depends(require_client_scope), db: Session = Depends(get_db),
) -> dict:
    """Which ads are actually selling which products — real per-(product, ad) Meta-attributed spend/value."""
    if since and until and since > until:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="`since` must not be after `until`.")
    since_d, until_d = merge_adapter.default_range(since, until)
    matrix = campaign_ad_analytics.build_product_ad_matrix(db, user.client_id, since_d, until_d)
    return {"since": since_d.isoformat(), "until": until_d.isoformat(), **matrix}
