# Integration Architecture — Adlytix

## Layers

```
Next.js (static export)
   ↓  cookie-authenticated fetch, never calls Shopify/Meta/Google directly
FastAPI  —  /api/v1/integrations, and per-provider routers added in Phase 3/4
   ↓
IntegrationService (backend/integrations/service.py)
   —  tenant-scoped lifecycle: create_pending, mark_connected, mark_error, disconnect
   ↓
Provider contract (backend/integrations/providers/base.py)
   —  OAuthProvider → AdsProvider / CommerceProvider (ABCs)
   ↓
Concrete providers — ShopifyProvider, MetaProvider — added in Phase 3/4,
implementing the contract above. Not implemented yet: no Shopify Partner app
or Meta developer app credentials exist yet (confirmed with the user).
```

The contract exists precisely so that nothing above the "Concrete providers" line ever
branches on provider name. Adding Google Ads or TikTok Ads later means writing one new
class against `AdsProvider`, not touching the service layer, the router, or analytics.

## What exists today (Phase 1-2, backend only)

- `integrations` table (see `DATABASE_SCHEMA.md`) — one row per connected/attempted
  external account.
- `integrations/crypto.py` — Fernet envelope encryption for credentials, keyed by
  `ENCRYPTION_KEY`. The only place in the codebase that encrypts or decrypts a token.
  Refuses to run with no key when `ENVIRONMENT=production`.
- `integrations/service.py` — tenant-scoped lifecycle functions, each writing an
  `audit_logs` row (`integration_connect_started`, `integration_connected`,
  `integration_error`, `integration_disconnected`).
- `integrations/providers/base.py` — the `OAuthProvider` / `AdsProvider` /
  `CommerceProvider` contract Phase 3/4 implement against. Deliberately not wired to any
  route — there is no concrete provider yet, and a "Connect Shopify" endpoint with
  nothing real behind it would be worse than not having one.
- `GET /api/v1/integrations` — lists every known provider for the caller's tenant:
  real rows as `pending`/`connected`/`error`/`disconnected`, and providers with no row
  yet as `available`. Tenant-scoped via `require_client_scope` (see `MULTI_TENANCY.md`).
- `POST /api/v1/integrations/{id}/disconnect` — tenant-scoped disconnect; retains the
  row and any historical data, per Section 54 of the architecture brief.

## Phase 3 (Shopify) — OAuth and data sync both done

Implemented (2026-08-19), against real Shopify Partner app credentials:
- `ShopifyProvider(CommerceProvider)` (`integrations/providers/shopify.py`) —
  authorization URL, code→token exchange, callback HMAC verification (hex,
  distinct from the webhook signature below), webhook HMAC verification (base64),
  shop-domain validation (rejects anything not `*.myshopify.com`, closing an
  open-redirect risk in the authorize step), best-effort token revocation on disconnect.
- `GET /api/v1/shopify/connect?shop=...` — tenant-scoped (`require_client_scope`),
  redirects the browser to Shopify.
- `GET /api/v1/shopify/callback` — public (Shopify's redirect lands here from a
  different origin); verifies the callback HMAC, then the signed `state` token
  (`integrations/oauth_state.py`) for tenant identity and CSRF protection, then
  exchanges the code and calls `service.mark_connected`. Reconnecting the same shop
  reuses its existing `integrations` row (`service.find_existing`) rather than
  duplicating it.
- Verified locally: authorization URL construction, state sign/verify (including
  tamper and cross-provider rejection), and both HMAC checks (callback + webhook) —
  see the verification run in this session. **Not yet verified**: an actual browser
  consent round-trip against a real Shopify dev store — that needs a human in a
  browser and hasn't been done.

**Data sync — built and verified 2026-08-19**: `shopify_stores`/`products`/
`variants`/`orders`/`order_items` tables (`shopify/models.py`), idempotent upsert
logic (`shopify/sync.py`, `INSERT ... ON CONFLICT DO UPDATE`), and
`POST /api/v1/shopify/sync` to queue a `products_sync` + `orders_sync` pair — a "Sync
now" button on the Shopify card in `/integrations` calls it. Verified against the real
Supabase schema with mocked Shopify network calls (no live store connected yet): store
metadata upsert, product+variant upsert, **re-running doesn't duplicate** (idempotency
confirmed), order+line-item upsert, and line-item → internal product/variant id
resolution all correct; test rows cleaned up afterward. Also verified the full
`sync/worker.py` dispatch path end-to-end: claim → decrypt stored credentials → run
handler → mark completed → `integrations.last_sync_at` updated.

Still not done: an actual sync against a real, live-connected Shopify store (needs the
pending browser OAuth test below) and delete-detection (a product Shopify's list
endpoint stops returning isn't marked `deleted_at` yet — that needs the
`products/delete` webhook topic, which has no handler; only `app/uninstalled` does).

## Phase 4 (Meta) — OAuth, account selection, and data sync all done

Implemented (2026-08-19), against real Meta app credentials. Shape differs from
Shopify because Meta authenticates the user before any specific ad account is chosen:
- `MetaProvider(AdsProvider)` (`integrations/providers/meta.py`) — authorization URL,
  code→token exchange **plus** the immediate short-lived→long-lived (~60 day) token
  exchange (the short-lived token expires in about an hour, too soon to finish account
  selection), ad-account discovery (`list_accounts`), best-effort revocation.
- `GET /api/v1/meta/connect` → `GET /api/v1/meta/callback` — same state-token pattern
  as Shopify. On success the integration is `connected` but with no
  `external_account_id` yet.
- `GET /api/v1/meta/accounts` — lists ad accounts reachable with the stored token.
- `POST /api/v1/meta/accounts/select` — finalizes which ad account this integration
  represents. Handles reconnecting a previously-disconnected account by transferring
  the new credentials onto the existing row instead of creating a second one for the
  same `(client_id, provider, external_account_id)` — that pair is unique, so this
  matters for correctness, not just tidiness.
**Data sync — built and verified 2026-08-19**: `meta_ad_accounts`/`campaigns`/`ad_sets`/
`ads`/`insights_daily` tables (`meta/models.py`), idempotent upsert logic (`meta/sync.py`),
`POST /api/v1/meta/sync` (queues `campaigns_sync` + `insights_sync`), and a "Sync now"
button on the Meta card. Verified against the real Supabase schema with mocked Graph API
calls: ad-account upsert, the full campaign → ad set → ad hierarchy upsert,
**idempotency** (re-running doesn't duplicate), and insight rows correctly resolving
their campaign/ad-set/ad foreign keys — all confirmed, test rows cleaned up afterward.

Still not done: a sync against a real, live-connected Meta account (needs the same
pending browser OAuth test as Shopify) and any handling of Meta's async/batch Insights
API for very large accounts — `fetch_insights` uses the synchronous Insights endpoint,
fine for typical account sizes but not what Meta recommends for huge ones.

## Phase 6 (Unified analytics) — date-level, built 2026-08-19

`backend/reporting/service.py::get_unified_overview` joins `shopify_orders` and
`meta_insights_daily` by date via SQL aggregation (Section 24 of the brief), exposed as
`GET /api/v1/analytics/overview` and rendered as a "Performance — last 30 days" card on
`/integrations` (shown only once at least one side has synced data — an all-zero card
before anything syncs would look like real data). Verified with real inserted rows:
correct daily revenue/spend/ROAS, cancelled orders excluded from revenue, ROAS returned
as `null` rather than a divide-by-zero when a day has no spend, correct running totals.

**Deliberately date-level, not product-level** — see `DATABASE_SCHEMA.md`'s `reporting`
section for the full reasoning: the CSV-upload analytics engine's product-level merge
only works because that export is a Meta Catalog Sales report; live Marketing API data
doesn't carry that same product attribution without a Catalog integration this project
doesn't have. Also not yet handling multi-currency (revenue/spend are summed as raw
numbers; the frontend deliberately shows them without a currency symbol rather than
imply a conversion that was never performed) — matters once a tenant can connect more
than one store/account, which the schema allows but nothing in the product enforces a
single-account assumption around yet (the sync trigger endpoints pick the first Shopify/
Meta integration found for a tenant, not "all of them").

## Frontend (2026-08-19)

`app/integrations/page.tsx` (nav: **Integrations**, under Workspace) — the Section 30/31
integrations screen, wired to the endpoints above:
- `GET /api/v1/integrations` drives the card grid (Shopify, Meta, plus Google/TikTok
  shown as "coming soon" rather than omitted).
- "Connect" is a plain `<a href>` to `/api/v1/shopify/connect?shop=...` or
  `/api/v1/meta/connect` — deliberately not a `fetch()`, since the whole point is a
  top-level browser navigation to the provider and back.
- Reads `?integration=&status=&message=` off the redirect back from a callback, toasts
  accordingly, and scrubs the query string via `router.replace` so a refresh doesn't
  re-show it.
- Meta's two-step connect (OAuth, then ad-account selection) is handled inline: a
  `connected` integration with no `externalAccountId` yet renders the account picker
  (`GET /api/v1/meta/accounts` → `POST /api/v1/meta/accounts/select`) instead of the
  normal connected state.
- Platform admins (`user.client === null`) see an explanatory empty state instead of the
  grid — integrations are workspace-scoped, matching `require_client_scope` on the backend.

Not yet tested in a real browser against live Shopify/Meta consent screens — that's the
one piece that needs a human, not automation.

## Background jobs (Phase 7) — built (2026-08-19)

**Postgres-backed queue, no Redis**, exactly as scoped: `backend/sync/` — `sync_jobs` and
`webhook_events` tables (see `DATABASE_SCHEMA.md`), a service layer
(`sync/service.py`) with atomic claim (`SELECT ... FOR UPDATE SKIP LOCKED`),
exponential-backoff retry, and race-safe idempotent webhook recording
(`INSERT ... ON CONFLICT DO NOTHING`), and a worker entrypoint (`sync/worker.py`,
`python -m sync.worker`, or `--once` for a single cycle).

**`POST /api/v1/shopify/webhooks`** is live: verifies Shopify's HMAC, resolves the
tenant by shop domain, records the event idempotently, returns immediately. Verified
end-to-end this session — valid delivery, redelivery (deduplicated, confirmed only one
row lands), tampered signature (rejected 401), and a worker cycle correctly processing
the one topic it has a handler for while leaving unhandled topics untouched rather than
falsely marking them done.

**Only one handler exists**: `app/uninstalled` → disconnects the integration
(`sync/worker.py::handle_app_uninstalled`). Every other topic, and every `sync_type`
a `sync_jobs` row might carry, is genuinely queued/retried by the infrastructure above
but has no processor yet — that's the Phase 3/4 continuation, once
`shopify_products`/`shopify_orders`/`meta_*` tables exist to write into. Nothing creates
a `sync_jobs` row yet either (no "Sync Now" trigger exists) — `sync/service.py::create_job`
is ready for that continuation to call.

**Not yet deployed anywhere**: `sync/worker.py` isn't started by `render.yaml`,
`.do/app.yaml`, or `docker-compose.yml` — those only run the API service. Running it
continuously in production needs its own process (a second Render/DO service, or a
scheduled/cron invocation) — a deployment decision for whenever this goes live, not
made here since nothing is being deployed yet.

## Encryption key management

`ENCRYPTION_KEY` (Fernet, 32 url-safe base64 bytes) is required in production. Rotating
it without re-encrypting existing rows makes those integrations undecryptable —
`crypto.decrypt_credentials` raises `EncryptionNotConfigured` in that case, and the
correct response is "ask the tenant to reconnect that integration," never "treat it as
empty."
