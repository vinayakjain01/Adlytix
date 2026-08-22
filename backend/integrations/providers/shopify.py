# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/providers/shopify.py  —  Shopify Admin API             ║
# ╚══════════════════════════════════════════════════════════════════════╝

import base64
import hashlib
import hmac
import os
import re
from typing import Any, AsyncIterator
from urllib.parse import urlencode

import httpx

from integrations.providers.base import CommerceProvider

API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-01")
_SHOP_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$")


class InvalidShopDomain(Exception):
    pass


class ShopifyOAuthError(Exception):
    pass


def normalise_shop_domain(raw: str) -> str:
    """
    Accepts either "my-store" or "my-store.myshopify.com" and returns the
    full domain, or raises InvalidShopDomain. Rejecting anything else here
    matters: the shop domain becomes part of the OAuth authorize URL we
    redirect the browser to, so an unvalidated value is an open-redirect risk.
    """
    shop = raw.strip().lower()
    if not shop.endswith(".myshopify.com"):
        shop = f"{shop}.myshopify.com"
    if not _SHOP_RE.match(shop):
        raise InvalidShopDomain(f"'{raw}' is not a valid Shopify store domain.")
    return shop


class ShopifyProvider(CommerceProvider):
    name = "shopify"

    def __init__(self) -> None:
        self.api_key = os.getenv("SHOPIFY_API_KEY", "").strip()
        self.api_secret = os.getenv("SHOPIFY_API_SECRET", "").strip()
        self.scopes = os.getenv("SHOPIFY_SCOPES", "read_products,read_orders,read_customers").strip()
        if not self.api_key or not self.api_secret:
            raise RuntimeError(
                "SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not configured — "
                "Shopify integration is unavailable."
            )

    # ── OAuth ────────────────────────────────────────────────────────
    def get_authorization_url(self, *, state: str, redirect_uri: str, shop: str | None = None) -> str:
        if not shop:
            raise ValueError("Shopify's authorization URL requires a shop domain.")
        shop = normalise_shop_domain(shop)
        query = urlencode({
            "client_id": self.api_key,
            "scope": self.scopes,
            "redirect_uri": redirect_uri,
            "state": state,
        })
        return f"https://{shop}/admin/oauth/authorize?{query}"

    def verify_authorize_callback(self, params: dict) -> bool:
        """
        Verifies the `hmac` query parameter Shopify appends to the OAuth
        callback (hex-encoded — distinct from the webhook signature below,
        which is base64). Must pass before the authorization `code` is
        trusted at all.
        """
        supplied = params.get("hmac", "")
        if not supplied:
            return False
        pairs = {k: v for k, v in params.items() if k not in ("hmac", "signature")}
        message = "&".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        digest = hmac.new(self.api_secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(digest, supplied)

    async def exchange_code_for_token(self, *, code: str, redirect_uri: str, shop: str | None = None) -> dict:
        if not shop:
            raise ValueError("Shopify's token exchange requires a shop domain.")
        shop = normalise_shop_domain(shop)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://{shop}/admin/oauth/access_token",
                json={"client_id": self.api_key, "client_secret": self.api_secret, "code": code},
            )
        if resp.status_code != 200:
            raise ShopifyOAuthError(f"Token exchange failed ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        return {"access_token": data["access_token"], "scope": data.get("scope", ""), "shop": shop}

    async def revoke(self, credentials: dict) -> None:
        shop = credentials.get("shop")
        token = credentials.get("access_token")
        if not shop or not token:
            return
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.delete(
                    f"https://{shop}/admin/api/{API_VERSION}/api_permissions/current.json",
                    headers={"X-Shopify-Access-Token": token},
                )
        except httpx.HTTPError:
            # Best-effort: disconnecting locally must succeed even if Shopify
            # is unreachable or the token was already revoked on their side.
            pass

    # ── Webhooks ─────────────────────────────────────────────────────
    def verify_webhook(self, *, headers: dict, body: bytes) -> bool:
        supplied = headers.get("x-shopify-hmac-sha256") or headers.get("X-Shopify-Hmac-Sha256", "")
        if not supplied:
            return False
        digest = hmac.new(self.api_secret.encode(), body, hashlib.sha256).digest()
        expected = base64.b64encode(digest).decode()
        return hmac.compare_digest(expected, supplied)

    async def get_shop(self, credentials: dict, shop: str) -> dict:
        token = credentials["access_token"]
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://{shop}/admin/api/{API_VERSION}/shop.json",
                headers={"X-Shopify-Access-Token": token},
            )
            resp.raise_for_status()
            return resp.json()["shop"]

    # ── Data ────────────────────────────────────────────────────────
    async def list_products(self, credentials: dict, store_id: str) -> AsyncIterator[dict]:
        async for item in self._paginate(credentials, store_id, "products.json", "products"):
            yield item

    async def list_orders(self, credentials: dict, store_id: str, *, since: Any = None) -> AsyncIterator[dict]:
        params = {"status": "any"}
        if since is not None:
            params["updated_at_min"] = since
        async for item in self._paginate(credentials, store_id, "orders.json", "orders", params):
            yield item

    async def _paginate(
        self, credentials: dict, shop: str, path: str, key: str, params: dict | None = None
    ) -> AsyncIterator[dict]:
        token = credentials["access_token"]
        url = f"https://{shop}/admin/api/{API_VERSION}/{path}"
        query: dict | None = dict(params or {})
        query["limit"] = 250
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await client.get(
                    url, params=query, headers={"X-Shopify-Access-Token": token}
                )
                resp.raise_for_status()
                for row in resp.json().get(key, []):
                    yield row
                url = _next_page_url(resp.headers.get("Link"))
                # None, not {}: httpx's `params=` REPLACES a URL's existing
                # query string rather than merging with it, even when the
                # dict is empty — passing {} here silently stripped the
                # page_info/limit that the Link header's next-page URL
                # already carries, causing Shopify to fall back to its
                # default (no filter, limit 50) and every page after the
                # first to loop back over roughly the same recent orders
                # forever. Confirmed live: a real sync ran past 5,000
                # "orders" against a store with ~346 actually reachable
                # before this was caught. `params=None` leaves the URL's
                # own query string untouched.
                query = None


def _next_page_url(link_header: str | None) -> str | None:
    if not link_header:
        return None
    for part in link_header.split(","):
        segment, _, rel = part.partition(";")
        if 'rel="next"' in rel:
            return segment.strip().strip("<>")
    return None
