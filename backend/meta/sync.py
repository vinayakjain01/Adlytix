# ╔══════════════════════════════════════════════════════════════════════╗
# ║  meta/sync.py  —  campaigns_sync / insights_sync job handlers        ║
# ║                                                                      ║
# ║  Same idempotent-upsert shape as shopify/sync.py. campaigns_sync      ║
# ║  cascades campaign → ad set → ad in one job rather than three         ║
# ║  separately-scheduled ones — the whole hierarchy is small relative    ║
# ║  to orders/insights volume and is always fetched together in          ║
# ║  practice, so splitting it further would add job-scheduling           ║
# ║  overhead without a real independent-retry benefit (Section 19 of      ║
# ║  the brief asks not to bundle *unrelated* work into one job, not      ║
# ║  to fragment naturally-cascading reads into artificial pieces).       ║
# ╚══════════════════════════════════════════════════════════════════════╝

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from integrations.models import Integration
from integrations.providers.meta import MetaProvider
from mapping.models import MatchType, ProductMapping
from meta.models import MetaAd, MetaAdAccount, MetaAdSet, MetaCampaign, MetaInsightDaily, MetaProductInsightDaily
from shopify.models import ShopifyVariant
from sync.models import SyncJob

log = logging.getLogger("adlytix.meta.sync")

DEFAULT_INSIGHTS_LOOKBACK_DAYS = 180  # 6 months — the confirmed Integration-mode sync depth
PRODUCT_INSIGHTS_LOOKBACK_DAYS = 180


def _num(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _upsert_ad_account(db: Session, *, integration: Integration, data: dict) -> None:
    stmt = pg_insert(MetaAdAccount).values(
        integration_id=integration.id,
        client_id=integration.client_id,
        meta_account_id=integration.external_account_id,
        name=data.get("name"),
        currency=data.get("currency"),
        account_status=_int(data.get("account_status")),
        business_name=data.get("business_name"),
        raw_data=data,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["integration_id"],
        set_={
            "name": stmt.excluded.name,
            "currency": stmt.excluded.currency,
            "account_status": stmt.excluded.account_status,
            "business_name": stmt.excluded.business_name,
            "raw_data": stmt.excluded.raw_data,
        },
    )
    db.execute(stmt)


def _upsert_campaign(db: Session, *, integration: Integration, data: dict) -> str:
    stmt = pg_insert(MetaCampaign).values(
        integration_id=integration.id,
        client_id=integration.client_id,
        meta_campaign_id=str(data["id"]),
        name=data.get("name"),
        objective=data.get("objective"),
        status=data.get("status"),
        raw_data=data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_meta_campaigns_client_campaign",
        set_={
            "name": stmt.excluded.name,
            "objective": stmt.excluded.objective,
            "status": stmt.excluded.status,
            "raw_data": stmt.excluded.raw_data,
        },
    ).returning(MetaCampaign.id)
    return db.execute(stmt).scalar_one()


def _upsert_ad_set(db: Session, *, client_id: str, campaign_id: str, data: dict) -> str:
    stmt = pg_insert(MetaAdSet).values(
        campaign_id=campaign_id,
        client_id=client_id,
        meta_ad_set_id=str(data["id"]),
        name=data.get("name"),
        status=data.get("status"),
        daily_budget=_num(data.get("daily_budget")),
        lifetime_budget=_num(data.get("lifetime_budget")),
        raw_data=data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_meta_ad_sets_client_ad_set",
        set_={
            "campaign_id": stmt.excluded.campaign_id,
            "name": stmt.excluded.name,
            "status": stmt.excluded.status,
            "daily_budget": stmt.excluded.daily_budget,
            "lifetime_budget": stmt.excluded.lifetime_budget,
            "raw_data": stmt.excluded.raw_data,
        },
    ).returning(MetaAdSet.id)
    return db.execute(stmt).scalar_one()


def _upsert_ad(db: Session, *, client_id: str, ad_set_id: str, data: dict) -> str:
    stmt = pg_insert(MetaAd).values(
        ad_set_id=ad_set_id,
        client_id=client_id,
        meta_ad_id=str(data["id"]),
        name=data.get("name"),
        status=data.get("status"),
        raw_data=data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_meta_ads_client_ad",
        set_={
            "ad_set_id": stmt.excluded.ad_set_id,
            "name": stmt.excluded.name,
            "status": stmt.excluded.status,
            "raw_data": stmt.excluded.raw_data,
        },
    ).returning(MetaAd.id)
    return db.execute(stmt).scalar_one()


async def run_campaigns_sync(db: Session, job: SyncJob, integration: Integration, credentials: dict) -> dict:
    provider = MetaProvider()
    account_id = integration.external_account_id

    account_data = await provider.get_account(credentials, account_id)
    _upsert_ad_account(db, integration=integration, data=account_data)

    fetched = 0
    async for campaign in provider.list_campaigns(credentials, account_id):
        campaign_pk = _upsert_campaign(db, integration=integration, data=campaign)
        fetched += 1

        async for ad_set in provider.list_ad_sets(credentials, campaign["id"]):
            ad_set_pk = _upsert_ad_set(
                db, client_id=integration.client_id, campaign_id=campaign_pk, data=ad_set
            )
            fetched += 1

            async for ad in provider.list_ads(credentials, ad_set["id"]):
                _upsert_ad(db, client_id=integration.client_id, ad_set_id=ad_set_pk, data=ad)
                fetched += 1

        if fetched % 50 == 0:
            db.flush()

    db.flush()
    return {"records_fetched": fetched, "records_created": 0, "records_updated": 0, "records_failed": 0}


def _resolve(cache: dict[str, str | None], model, client_id: str, id_column, external_id: str | None, db: Session) -> str | None:
    if external_id is None:
        return None
    if external_id not in cache:
        cache[external_id] = db.execute(
            select(model.id).where(model.client_id == client_id, id_column == external_id)
        ).scalar_one_or_none()
    return cache[external_id]


def _upsert_insight(
    db: Session, *, integration: Integration, data: dict,
    campaign_lookup: dict, ad_set_lookup: dict, ad_lookup: dict,
) -> None:
    meta_campaign_id = str(data["campaign_id"]) if data.get("campaign_id") else None
    meta_ad_set_id = str(data["adset_id"]) if data.get("adset_id") else None
    meta_ad_id = str(data["ad_id"])

    campaign_pk = _resolve(campaign_lookup, MetaCampaign, integration.client_id, MetaCampaign.meta_campaign_id, meta_campaign_id, db)
    ad_set_pk = _resolve(ad_set_lookup, MetaAdSet, integration.client_id, MetaAdSet.meta_ad_set_id, meta_ad_set_id, db)
    ad_pk = _resolve(ad_lookup, MetaAd, integration.client_id, MetaAd.meta_ad_id, meta_ad_id, db)

    insight_date = data.get("date_start")

    stmt = pg_insert(MetaInsightDaily).values(
        integration_id=integration.id,
        client_id=integration.client_id,
        campaign_id=campaign_pk,
        ad_set_id=ad_set_pk,
        ad_id=ad_pk,
        meta_campaign_id=meta_campaign_id,
        meta_ad_set_id=meta_ad_set_id,
        meta_ad_id=meta_ad_id,
        date=insight_date,
        spend=_num(data.get("spend")),
        impressions=_int(data.get("impressions")),
        clicks=_int(data.get("clicks")),
        actions=data.get("actions") or [],
        raw_data=data,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_meta_insights_client_ad_date",
        set_={
            "campaign_id": stmt.excluded.campaign_id,
            "ad_set_id": stmt.excluded.ad_set_id,
            "meta_campaign_id": stmt.excluded.meta_campaign_id,
            "meta_ad_set_id": stmt.excluded.meta_ad_set_id,
            "spend": stmt.excluded.spend,
            "impressions": stmt.excluded.impressions,
            "clicks": stmt.excluded.clicks,
            "actions": stmt.excluded.actions,
            "raw_data": stmt.excluded.raw_data,
        },
    )
    db.execute(stmt)


def _parse_cursor_date(cursor: str | None) -> date | None:
    if not cursor:
        return None
    try:
        return date.fromisoformat(cursor)
    except ValueError:
        return None


async def run_insights_sync(db: Session, job: SyncJob, integration: Integration, credentials: dict) -> dict:
    provider = MetaProvider()
    account_id = integration.external_account_id

    until = datetime.now(timezone.utc).date()
    since = _parse_cursor_date(job.cursor) or (until - timedelta(days=DEFAULT_INSIGHTS_LOOKBACK_DAYS))

    campaign_lookup: dict[str, str | None] = {}
    ad_set_lookup: dict[str, str | None] = {}
    ad_lookup: dict[str, str | None] = {}
    fetched = 0
    async for row in provider.fetch_insights(credentials, account_id, since=since.isoformat(), until=until.isoformat()):
        _upsert_insight(
            db, integration=integration, data=row,
            campaign_lookup=campaign_lookup, ad_set_lookup=ad_set_lookup, ad_lookup=ad_lookup,
        )
        fetched += 1
        if fetched % 100 == 0:
            db.commit()  # see the comment on the equivalent line in shopify/sync.py

    job.cursor = until.isoformat()
    db.flush()
    return {"records_fetched": fetched, "records_created": 0, "records_updated": 0, "records_failed": 0}


def _parse_product_id_breakdown(raw: str) -> tuple[str, str | None]:
    """
    Meta's `breakdowns=product_id` value is the string "{id}, {name}"
    concatenated (confirmed live, 2026-08-22) — not a plain id. Some ids seen
    are purely numeric (Meta's internal catalog product id); others are
    already alphanumeric strings that look like the catalog's own
    retailer_id — both are handled the same way downstream.
    """
    if "," in raw:
        pid, _, name = raw.partition(",")
        return pid.strip(), (name.strip() or None)
    return raw.strip(), None


def _find_variant_by_sku(db: Session, client_id: str, sku: str | None) -> ShopifyVariant | None:
    if not sku:
        return None
    return db.execute(
        select(ShopifyVariant).where(ShopifyVariant.client_id == client_id, ShopifyVariant.sku == sku)
    ).scalar_one_or_none()


def _find_variant_by_id(db: Session, client_id: str, variant_id: str | None) -> ShopifyVariant | None:
    if not variant_id:
        return None
    return db.execute(
        select(ShopifyVariant).where(
            ShopifyVariant.client_id == client_id, ShopifyVariant.shopify_variant_id == variant_id
        )
    ).scalar_one_or_none()


async def _resolve_product_mappings(
    db: Session, *, client_id: str, provider: MetaProvider, credentials: dict,
    seen: dict[str, str | None],
) -> dict[str, ProductMapping]:
    """
    Ensures a ProductMapping row exists for every meta_product_id in `seen`
    and returns {meta_product_id: ProductMapping}. Matching order:
      1. Already matched in a previous sync — reused as-is. A previously
         UNMATCHED row is retried every sync instead of cached forever,
         since a later Shopify sync (or a new tier below) can resolve it.
      2. The breakdown id IS a Shopify variant id — confirmed live
         (2026-08-22) that this account's Shopify-synced Meta catalog uses
         the Shopify variant id as its own catalog product id for ~86% of
         products (2,092/2,149 insight rows), with zero extra Meta
         permissions required.
      3. The breakdown id matches a Shopify variant SKU directly.
      4. The catalog's real `retailer_id` (needs `catalog_management`,
         which Meta's Catalog API returns "application not approved" for
         on this app as of 2026-08-22 — it needs formal App Review; kept
         here for when/if that's granted) matches a SKU.
      5. Otherwise: recorded as UNMATCHED. This is a normal, expected
         outcome — not every catalog product will have a matching Shopify
         id/SKU, and that spend must surface as genuinely unattributed,
         never be guessed at (Section 11 of this phase's brief).
    """
    existing_rows = db.execute(
        select(ProductMapping).where(
            ProductMapping.client_id == client_id, ProductMapping.meta_product_id.in_(list(seen))
        )
    ).scalars().all()
    existing_by_pid = {m.meta_product_id: m for m in existing_rows}

    resolved: dict[str, ProductMapping] = {
        pid: m for pid, m in existing_by_pid.items() if m.match_type != MatchType.UNMATCHED
    }
    unresolved_ids = [pid for pid in seen if pid not in resolved]
    if not unresolved_ids:
        return resolved

    variant_id_matches: dict[str, ShopifyVariant] = {}
    sku_matches: dict[str, ShopifyVariant] = {}
    still_unresolved: list[str] = []
    for pid in unresolved_ids:
        variant = _find_variant_by_id(db, client_id, pid)
        if variant is not None:
            variant_id_matches[pid] = variant
            continue
        variant = _find_variant_by_sku(db, client_id, pid)
        if variant is not None:
            sku_matches[pid] = variant
        else:
            still_unresolved.append(pid)

    catalog_info: dict[str, dict] = {}
    if still_unresolved:
        try:
            catalog_info = await provider.resolve_catalog_products(credentials, still_unresolved)
        except Exception as exc:
            log.warning(
                "Could not resolve Meta catalog products (missing catalog_management "
                "permission? integration may need reconnecting): %s", exc,
            )

    for pid in unresolved_ids:
        name = seen.get(pid)
        existing = existing_by_pid.get(pid)  # an UNMATCHED row to update in place, if any
        retailer_id: str | None = None

        if pid in variant_id_matches:
            variant = variant_id_matches[pid]
            match_type, shopify_variant_id, shopify_product_id = (
                MatchType.VARIANT_ID, variant.id, variant.product_id,
            )
        elif pid in sku_matches:
            variant = sku_matches[pid]
            retailer_id = pid
            match_type, shopify_variant_id, shopify_product_id = (
                MatchType.SKU, variant.id, variant.product_id,
            )
        else:
            info = catalog_info.get(pid)
            retailer_id = info.get("retailer_id") if info else None
            variant = _find_variant_by_sku(db, client_id, retailer_id)
            name = name or (info.get("name") if info else None)
            if variant is not None:
                match_type, shopify_variant_id, shopify_product_id = (
                    MatchType.RETAILER_ID, variant.id, variant.product_id,
                )
            else:
                match_type, shopify_variant_id, shopify_product_id = MatchType.UNMATCHED, None, None

        if existing is not None:
            existing.meta_product_name = name or existing.meta_product_name
            existing.meta_retailer_id = retailer_id
            existing.shopify_variant_id = shopify_variant_id
            existing.shopify_product_id = shopify_product_id
            existing.match_type = match_type
            existing.confidence = 1.0 if match_type != MatchType.UNMATCHED else None
            mapping = existing
        else:
            mapping = ProductMapping(
                client_id=client_id, meta_product_id=pid, meta_product_name=name,
                meta_retailer_id=retailer_id, shopify_variant_id=shopify_variant_id,
                shopify_product_id=shopify_product_id, match_type=match_type,
                confidence=1.0 if match_type != MatchType.UNMATCHED else None,
            )
            db.add(mapping)
        resolved[pid] = mapping

    db.flush()  # assigns PKs before insight rows below reference them
    return resolved


def _upsert_product_insight(
    db: Session, *, integration: Integration, row: dict, meta_product_id: str,
    meta_product_name: str | None, mapping: ProductMapping | None,
) -> None:
    stmt = pg_insert(MetaProductInsightDaily).values(
        integration_id=integration.id,
        client_id=integration.client_id,
        meta_campaign_id=row.get("campaign_id"),
        meta_ad_set_id=row.get("adset_id"),
        meta_ad_id=str(row["ad_id"]),
        meta_product_id=meta_product_id,
        meta_product_name=meta_product_name or (mapping.meta_product_name if mapping else None),
        shopify_product_id=mapping.shopify_product_id if mapping else None,
        shopify_variant_id=mapping.shopify_variant_id if mapping else None,
        date=row.get("date_start"),
        spend=_num(row.get("spend")),
        impressions=_int(row.get("impressions")),
        clicks=_int(row.get("clicks")),
        reach=_int(row.get("reach")),
        actions=row.get("actions") or [],
        action_values=row.get("action_values") or [],
        raw_data=row,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_meta_product_insights_client_ad_product_date",
        set_={
            "meta_campaign_id": stmt.excluded.meta_campaign_id,
            "meta_ad_set_id": stmt.excluded.meta_ad_set_id,
            "meta_product_name": stmt.excluded.meta_product_name,
            "shopify_product_id": stmt.excluded.shopify_product_id,
            "shopify_variant_id": stmt.excluded.shopify_variant_id,
            "spend": stmt.excluded.spend,
            "impressions": stmt.excluded.impressions,
            "clicks": stmt.excluded.clicks,
            "reach": stmt.excluded.reach,
            "actions": stmt.excluded.actions,
            "action_values": stmt.excluded.action_values,
            "raw_data": stmt.excluded.raw_data,
        },
    )
    db.execute(stmt)


async def run_product_insights_sync(db: Session, job: SyncJob, integration: Integration, credentials: dict) -> dict:
    """
    Real per-product Meta ad spend attribution (see fetch_product_insights).
    Buffers the fetch (a 6-month window is at most a few thousand rows at
    this account's volume) so product-mapping resolution can run once as a
    batch afterward, rather than resolving — and potentially making a Graph
    API call for — the same product id repeatedly mid-stream.
    """
    provider = MetaProvider()
    account_id = integration.external_account_id

    until = datetime.now(timezone.utc).date()
    since = _parse_cursor_date(job.cursor) or (until - timedelta(days=PRODUCT_INSIGHTS_LOOKBACK_DAYS))

    rows: list[dict] = []
    async for row in provider.fetch_product_insights(
        credentials, account_id, since=since.isoformat(), until=until.isoformat()
    ):
        rows.append(row)

    seen: dict[str, str | None] = {}
    parsed: list[tuple[str, str | None, dict]] = []
    for row in rows:
        raw_pid = row.get("product_id")
        if not raw_pid:
            continue
        pid, name = _parse_product_id_breakdown(raw_pid)
        seen.setdefault(pid, name)
        parsed.append((pid, name, row))

    mappings = await _resolve_product_mappings(
        db, client_id=integration.client_id, provider=provider, credentials=credentials, seen=seen,
    )
    db.commit()  # persist mappings as their own unit before the (larger) insight upsert loop

    fetched = 0
    for pid, name, row in parsed:
        _upsert_product_insight(
            db, integration=integration, row=row, meta_product_id=pid,
            meta_product_name=name, mapping=mappings.get(pid),
        )
        fetched += 1
        if fetched % 50 == 0:
            db.commit()

    job.cursor = until.isoformat()
    db.flush()
    matched = sum(1 for m in mappings.values() if m.match_type != MatchType.UNMATCHED)
    log.info(
        "product_insights_sync: %d rows, %d/%d distinct products matched to Shopify",
        fetched, matched, len(mappings),
    )
    return {"records_fetched": fetched, "records_created": 0, "records_updated": 0, "records_failed": 0}
