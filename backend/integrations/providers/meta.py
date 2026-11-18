# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/providers/meta.py  —  Meta Graph / Marketing API       ║
# ╚══════════════════════════════════════════════════════════════════════╝

import json
import os
import re
from typing import Any, AsyncIterator
from urllib.parse import urlencode

import httpx

from integrations.providers.base import AdsProvider

GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v21.0")
GRAPH_URL = f"https://graph.facebook.com/{GRAPH_VERSION}"

_TOKEN_PATTERN = re.compile(r"access_token=[^&\s]+")


class MetaOAuthError(Exception):
    pass


class MetaRequestError(Exception):
    """
    Raised instead of letting httpx.HTTPStatusError propagate directly.

    Meta passes the access token as a URL query parameter (unlike Shopify,
    which uses a header), so httpx's own exception message embeds it — and a
    generic `log.exception(...)` anywhere upstream (sync/worker.py's job
    error handling, in practice) prints that message, token included,
    straight into logs. Confirmed happening live twice in one session. This
    redacts the token before the exception ever exists, which is robust
    against every future call site rather than relying on every logger to
    remember to sanitize.
    """


def _raise_for_status(resp: httpx.Response) -> None:
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        url = _TOKEN_PATTERN.sub("access_token=***REDACTED***", str(exc.request.url))
        raise MetaRequestError(
            f"{exc.response.status_code} error for {url}: {exc.response.text[:500]}"
        ) from None


class MetaProvider(AdsProvider):
    name = "meta"

    def __init__(self) -> None:
        self.app_id = os.getenv("META_APP_ID", "").strip()
        self.app_secret = os.getenv("META_APP_SECRET", "").strip()
        self.scopes = os.getenv("META_SCOPES", "ads_read,business_management,catalog_management").strip()
        if not self.app_id or not self.app_secret:
            raise RuntimeError(
                "META_APP_ID / META_APP_SECRET are not configured — Meta "
                "integration is unavailable."
            )

    # ── OAuth ────────────────────────────────────────────────────────
    def get_authorization_url(self, *, state: str, redirect_uri: str, **kwargs: Any) -> str:
        query = urlencode({
            "client_id": self.app_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": self.scopes,
            "response_type": "code",
        })
        return f"https://www.facebook.com/{GRAPH_VERSION}/dialog/oauth?{query}"

    async def exchange_code_for_token(self, *, code: str, redirect_uri: str, **kwargs: Any) -> dict:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{GRAPH_URL}/oauth/access_token",
                params={
                    "client_id": self.app_id,
                    "client_secret": self.app_secret,
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )
            if resp.status_code != 200:
                raise MetaOAuthError(f"Token exchange failed ({resp.status_code}): {resp.text[:300]}")
            short_lived = resp.json()

            # Exchange for a long-lived (~60 day) token immediately — the
            # short-lived one from the step above expires in about an hour,
            # which is not enough time to even finish account selection.
            resp = await client.get(
                f"{GRAPH_URL}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": self.app_id,
                    "client_secret": self.app_secret,
                    "fb_exchange_token": short_lived["access_token"],
                },
            )
            if resp.status_code != 200:
                raise MetaOAuthError(
                    f"Long-lived token exchange failed ({resp.status_code}): {resp.text[:300]}"
                )
            long_lived = resp.json()

        return {
            "access_token": long_lived["access_token"],
            "token_type": long_lived.get("token_type", "bearer"),
            "expires_in": long_lived.get("expires_in"),  # seconds; None = does not expire
        }

    async def revoke(self, credentials: dict) -> None:
        token = credentials.get("access_token")
        if not token:
            return
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.delete(
                    f"{GRAPH_URL}/me/permissions", params={"access_token": token}
                )
        except httpx.HTTPError:
            pass  # best-effort — disconnecting locally must not depend on Meta being reachable

    # ── Account discovery ───────────────────────────────────────────
    async def list_accounts(self, credentials: dict) -> list[dict]:
        token = credentials["access_token"]
        accounts: list[dict] = []
        url = f"{GRAPH_URL}/me/adaccounts"
        params = {
            "access_token": token,
            "fields": "id,name,account_status,currency,business_name",
            "limit": 100,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            while url:
                resp = await client.get(url, params=params)
                _raise_for_status(resp)
                data = resp.json()
                accounts.extend(data.get("data", []))
                url = data.get("paging", {}).get("next")
                # None, not {}: see the identical fix (and the incident it
                # fixed) in integrations/providers/shopify.py::_paginate —
                # httpx's `params=` replaces a URL's existing query string
                # even when passed an empty dict, which would strip the
                # access_token and cursor that Meta's `paging.next` URL
                # already carries.
                params = None
        return accounts

    async def get_account(self, credentials: dict, account_id: str) -> dict:
        token = credentials["access_token"]
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{GRAPH_URL}/{account_id}",
                params={
                    "access_token": token,
                    "fields": "id,name,account_status,currency,business_name",
                },
            )
            _raise_for_status(resp)
            return resp.json()

    # ── Campaign/ad hierarchy + insights (Phase 4 sync worker calls these;
    #    not wired up until sync_jobs / Phase 7 exists) ─────────────────
    async def list_campaigns(self, credentials: dict, account_id: str) -> AsyncIterator[dict]:
        async for row in self._paginate(
            credentials, f"{account_id}/campaigns",
            "id,name,objective,status,created_time,updated_time",
        ):
            yield row

    async def list_ad_sets(self, credentials: dict, campaign_id: str) -> AsyncIterator[dict]:
        async for row in self._paginate(
            credentials, f"{campaign_id}/adsets",
            "id,name,status,daily_budget,lifetime_budget,created_time,updated_time",
        ):
            yield row

    async def list_ads(self, credentials: dict, ad_set_id: str) -> AsyncIterator[dict]:
        async for row in self._paginate(
            credentials, f"{ad_set_id}/ads",
            "id,name,status,created_time,updated_time",
        ):
            yield row

    async def fetch_insights(
        self, credentials: dict, account_id: str, *, since: Any, until: Any
    ) -> AsyncIterator[dict]:
        fields = (
            "campaign_id,adset_id,ad_id,spend,impressions,clicks,reach,"
            "actions,action_values,date_start,date_stop"
        )
        async for row in self._paginate(
            credentials, f"{account_id}/insights", fields,
            extra_params={
                "level": "ad",
                "time_range": f'{{"since":"{since}","until":"{until}"}}',
                "time_increment": 1,
            },
        ):
            yield row

    async def fetch_product_insights(
        self, credentials: dict, account_id: str, *, since: Any, until: Any
    ) -> AsyncIterator[dict]:
        """
        Real per-product ad spend attribution for catalog/Advantage+ Catalog
        Ads campaigns — confirmed working live against a real account
        (2026-08-22): the synchronous edge handles `time_increment=1` plus
        `breakdowns=product_id` fine at this data volume (tens of rows per
        week per active ad), no need for Meta's async Insights Report flow.
        Ads that were never catalog-attributed simply never appear here —
        their spend belongs in the account-level `fetch_insights` totals only.
        """
        fields = (
            "campaign_id,adset_id,ad_id,spend,impressions,clicks,reach,"
            "actions,action_values,date_start,date_stop"
        )
        async for row in self._paginate(
            credentials, f"{account_id}/insights", fields,
            extra_params={
                "level": "ad",
                "breakdowns": "product_id",
                "time_range": f'{{"since":"{since}","until":"{until}"}}',
                "time_increment": 1,
            },
        ):
            yield row

    async def resolve_catalog_products(
        self, credentials: dict, product_ids: list[str]
    ) -> dict[str, dict]:
        """
        Batch-resolves Meta catalog product nodes (id -> {retailer_id, name}).
        Requires the `catalog_management` permission; if the connected
        integration hasn't been re-consented for it yet, every item in the
        batch fails individually and this returns an empty dict rather than
        raising — callers must treat "no retailer_id yet" as a normal,
        temporary state (Section 11 of this phase's brief: an unresolved
        mapping is not an error), not a sync failure.
        """
        if not product_ids:
            return {}
        token = credentials["access_token"]
        results: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=30) as client:
            # Graph API batch requests cap at 50 sub-requests per call.
            for i in range(0, len(product_ids), 50):
                chunk = product_ids[i : i + 50]
                batch = [
                    {"method": "GET", "relative_url": f"{pid}?fields=id,retailer_id,name"}
                    for pid in chunk
                ]
                resp = await client.post(
                    GRAPH_URL,
                    data={"access_token": token, "batch": json.dumps(batch)},
                )
                _raise_for_status(resp)
                for pid, item in zip(chunk, resp.json()):
                    if item.get("code") != 200:
                        continue
                    try:
                        body = json.loads(item["body"])
                    except (KeyError, ValueError):
                        continue
                    if "error" in body:
                        continue
                    results[pid] = {"retailer_id": body.get("retailer_id"), "name": body.get("name")}
        return results

    async def _paginate(
        self, credentials: dict, edge: str, fields: str, extra_params: dict | None = None
    ) -> AsyncIterator[dict]:
        token = credentials["access_token"]
        url = f"{GRAPH_URL}/{edge}"
        params = {"access_token": token, "fields": fields, "limit": 100, **(extra_params or {})}
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await client.get(url, params=params)
                _raise_for_status(resp)
                data = resp.json()
                for row in data.get("data", []):
                    yield row
                url = data.get("paging", {}).get("next")
                params = None  # see the fix note in list_accounts above
