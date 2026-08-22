# ╔══════════════════════════════════════════════════════════════════════╗
# ║  integrations/providers/base.py  —  Provider contract                ║
# ║                                                                      ║
# ║  Every external ads/commerce platform implements this interface, so  ║
# ║  the sync/analytics layers built in later phases never branch on      ║
# ║  provider name — they call the interface and let the concrete class   ║
# ║  (ShopifyProvider, MetaProvider, later GoogleAdsProvider, ...)         ║
# ║  handle the platform-specific detail (architecture brief, Section 17).║
# ║                                                                      ║
# ║  No concrete provider is implemented yet — Shopify and Meta app       ║
# ║  credentials have not been provisioned (Phase 3/4, pending). This     ║
# ║  file defines the contract those phases implement against; it is     ║
# ║  intentionally not wired to any route yet, so there is nothing here   ║
# ║  that pretends to work without real credentials behind it.           ║
# ╚══════════════════════════════════════════════════════════════════════╝

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator


class OAuthProvider(ABC):
    """Contract for providers authenticated via OAuth (Shopify, Meta, Google Ads, ...)."""

    #: Value stored in integrations.provider — must match integrations.models.Provider.
    name: str

    @abstractmethod
    def get_authorization_url(self, *, state: str, redirect_uri: str, **kwargs: Any) -> str:
        """
        Builds the URL the browser is redirected to begin the OAuth flow.
        `**kwargs` covers provider-specific requirements the shared router
        can't know about — e.g. Shopify needs the target `shop` domain,
        which Meta has no equivalent for.
        """

    @abstractmethod
    async def exchange_code_for_token(self, *, code: str, redirect_uri: str, **kwargs: Any) -> dict:
        """
        Exchanges an OAuth callback's authorization code for credentials.
        Returns a plain dict suitable for integrations.crypto.encrypt_credentials
        — e.g. {"access_token": ..., "refresh_token": ..., "expires_at": ...}.
        Never logs or returns the raw tokens to the caller's caller; the
        integration service is the only consumer.
        """

    @abstractmethod
    async def revoke(self, credentials: dict) -> None:
        """Best-effort revocation on disconnect. Must not raise on an already-revoked token."""


class AdsProvider(OAuthProvider):
    """Contract for advertising platforms (Meta, later Google Ads / TikTok Ads)."""

    @abstractmethod
    async def list_accounts(self, credentials: dict) -> list[dict]:
        """Ad accounts (or businesses) reachable with these credentials."""

    @abstractmethod
    async def list_campaigns(self, credentials: dict, account_id: str) -> AsyncIterator[dict]:
        """Yields campaigns for one account, handling pagination internally."""

    @abstractmethod
    async def list_ad_sets(self, credentials: dict, campaign_id: str) -> AsyncIterator[dict]:
        ...

    @abstractmethod
    async def list_ads(self, credentials: dict, ad_set_id: str) -> AsyncIterator[dict]:
        ...

    @abstractmethod
    async def fetch_insights(
        self, credentials: dict, account_id: str, *, since: Any, until: Any
    ) -> AsyncIterator[dict]:
        """Daily performance rows for the given account and date range."""


class CommerceProvider(OAuthProvider):
    """Contract for commerce platforms (Shopify, later WooCommerce)."""

    @abstractmethod
    async def list_products(self, credentials: dict, store_id: str) -> AsyncIterator[dict]:
        ...

    @abstractmethod
    async def list_orders(self, credentials: dict, store_id: str, *, since: Any = None) -> AsyncIterator[dict]:
        ...

    @abstractmethod
    def verify_webhook(self, *, headers: dict, body: bytes) -> bool:
        """Verifies a webhook's authenticity (e.g. Shopify's HMAC header) before it is trusted."""
