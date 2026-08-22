# Database Schema — Adlytix

Living document. Updated as each phase adds tables. Source of truth is always
`backend/models.py` + `backend/*/models.py` and the Alembic migrations under
`backend/alembic/versions/`; this file explains intent and grain, not exact DDL.

System of record: **Supabase Postgres** (`public` schema), as of the Phase 1 migration
(2026-08-18). Schema is managed exclusively by Alembic — `alembic upgrade head` before
the app starts (see `backend/Dockerfile`). `Base.metadata.create_all()` is no longer
used for schema evolution.

## Tables

### `clients` — the tenant
| column | type | notes |
|---|---|---|
| id | uuid (str) PK | |
| name | varchar(200), unique | |
| subscription_expires_at | timestamptz, nullable | null = never expires |
| created_at | timestamptz | |

Every tenant-owned row elsewhere traces back to `clients.id`, directly or via a
FK chain (e.g. `integrations.client_id`). There is no `client_memberships` table —
deliberately not built ahead of need (see `ARCHITECTURE_AUDIT.md` §4); introduce it
only when a user must belong to more than one client.

### `users`
| column | type | notes |
|---|---|---|
| id | uuid (str) PK | |
| client_id | uuid (str) FK → clients.id, nullable, `ON DELETE CASCADE` | null only for platform `ADMIN` |
| email | varchar(320), unique | |
| password_hash | varchar(255) | bcrypt, SHA-256-prehashed (see `security.py`) |
| role | admin \| owner \| analyst \| viewer | `admin` is platform-level, not tenant-scoped |
| status | active \| invited \| suspended | |
| token_version | int | bump to revoke every session for this user |
| must_change_password | bool | |
| last_login_at | timestamptz, nullable | |
| created_at | timestamptz | |

### `integrations` — one row per connected (or attempted) external account
Grain: **one row per (client, provider, external account)**.
| column | type | notes |
|---|---|---|
| id | uuid (str) PK | |
| client_id | FK → clients.id, `ON DELETE CASCADE`, indexed | |
| provider | shopify \| meta \| google \| tiktok | stored as varchar, not native enum — new providers need no migration |
| status | pending \| connected \| error \| disconnected | |
| display_name | varchar(200), nullable | e.g. shop name / business name |
| external_account_id | varchar(255), nullable | shop domain, business/ad-account id, ... |
| credentials_encrypted | text, nullable | Fernet ciphertext — see `integrations/crypto.py`; never plaintext |
| config | jsonb | non-secret provider settings; never tokens |
| last_sync_at | timestamptz, nullable | |
| last_error | text, nullable | |
| created_at / updated_at | timestamptz | |

Unique constraint: `(client_id, provider, external_account_id)` — the idempotency key
once a provider's OAuth callback fills in `external_account_id`. Multiple `pending`
rows with a null `external_account_id` are not prevented by this constraint (Postgres
treats each `NULL` as distinct); the service layer (`integrations/service.py`) is
responsible for not creating a redundant pending row when one already exists for that
provider — check before calling `create_pending`.

Disconnecting (Section 54 of the architecture brief) sets `status = disconnected` and
clears `credentials_encrypted`, but never deletes the row — reconnecting reuses it
(Section 55), and any historical sync data a later phase's tables hold against
`integration_id` survives a disconnect.

### `audit_logs` — append-only action log
Grain: **one row per notable action.**
| column | type | notes |
|---|---|---|
| id | uuid (str) PK | |
| client_id | FK → clients.id, `ON DELETE SET NULL`, nullable | null for platform-level actions |
| user_id | FK → users.id, `ON DELETE SET NULL`, nullable | null for system-initiated actions |
| action | varchar(100) | e.g. `integration_connected`, `integration_disconnected` |
| resource_type / resource_id | varchar, nullable | what the action was about |
| metadata_json | jsonb | structured detail — **never tokens, passwords, or full OAuth payloads** |
| created_at | timestamptz | |

Retention: not yet enforced by code. Per the brief's Section 38, define an explicit
retention policy before volume makes it a real cost — flagged for Phase 8/9, not done here.

### `sync_jobs` — one independently retryable unit of background work
Grain: **one row per (integration, sync_type, attempt-series)**.
| column | type | notes |
|---|---|---|
| id | uuid (str) PK | |
| client_id | FK → clients.id, `ON DELETE CASCADE`, indexed | |
| integration_id | FK → integrations.id, `ON DELETE CASCADE`, indexed | |
| provider | varchar(20) | denormalized from the integration, for query convenience |
| sync_type | varchar(50) | e.g. `products_sync`, `orders_sync` — defined by whichever phase creates the job, not by this table |
| status | pending \| running \| completed \| failed \| cancelled | |
| cursor | text, nullable | resumable pagination checkpoint |
| records_fetched/created/updated/failed | int, default 0 | |
| attempt / max_attempts | int | retry count vs. cap |
| next_attempt_at | timestamptz, nullable | NULL = claimable now; set on retry for backoff |
| error | text, nullable | |
| started_at / completed_at | timestamptz, nullable | |
| created_at / updated_at | timestamptz | |

Claimed with `SELECT ... FOR UPDATE SKIP LOCKED` (`sync/service.py::claim_next_job`) —
this is what makes a plain Postgres table safe for multiple worker processes polling
concurrently, without Redis/Celery. Failure retries with exponential backoff
(`sync/service.py::_backoff`, ~30s/60s/120s/... capped at 1h, with jitter) up to
`max_attempts`, then terminally fails — never retries forever.

### `webhook_events` — inbound provider webhooks
Grain: **one row per (provider, external event id)** — the unique constraint IS the
idempotency guarantee (Section 14: a redelivered webhook must be safely ignored).
| column | type | notes |
|---|---|---|
| id | uuid (str) PK | |
| integration_id | FK → integrations.id, `ON DELETE SET NULL`, nullable | null if the shop/account wasn't recognised at receipt time |
| client_id | FK → clients.id, `ON DELETE SET NULL`, nullable | |
| provider | varchar(20) | |
| topic | varchar(100) | e.g. `products/update`, `app/uninstalled` |
| external_event_id | varchar(255), nullable | provider's delivery id; NULL rows aren't deduplicated (each NULL is distinct under the unique constraint) |
| payload | jsonb | raw parsed body |
| status | received \| processing \| processed \| failed | |
| retry_count | int, default 0 | |
| error | text, nullable | |
| received_at / processed_at | timestamptz | |
| created_at / updated_at | timestamptz | |

Unique constraint: `(provider, external_event_id)`, enforced atomically via
`INSERT ... ON CONFLICT DO NOTHING` (`sync/service.py::record_webhook_event`) — race-safe
under concurrent redelivery, not a check-then-insert. The worker
(`sync/worker.py`) only claims topics it has a registered handler for; unhandled
topics stay `received` indefinitely rather than being falsely marked `processed`. Today
that's exactly one handler: `app/uninstalled` → disconnects the integration.

### Shopify data (`backend/shopify/models.py`) — built 2026-08-19
Grain: **one row per (client, shopify object id)** throughout — Shopify ids are not
globally unique across tenants, so `client_id` is always part of the uniqueness key
(Section 11 of the brief). All writes go through `INSERT ... ON CONFLICT DO UPDATE`
(`shopify/sync.py`) against these constraints, verified idempotent this session (a
re-run upserts, never duplicates).

- `shopify_stores` — 1:1 with `integrations` (`UNIQUE(integration_id)`, also
  `UNIQUE(shop_domain)`). Shop-level metadata (currency, timezone, plan) refreshed on
  every `products_sync` run.
- `shopify_products` — `UNIQUE(client_id, shopify_product_id)`. `deleted_at` exists for
  future soft-delete (Section 52) but nothing sets it yet — Shopify's product list
  endpoint never returns deleted products, so detecting a deletion needs the
  `products/delete` webhook topic, which has no handler yet (only `app/uninstalled`
  does — see `sync/worker.py`).
- `shopify_variants` — `UNIQUE(client_id, shopify_variant_id)`, FK to `shopify_products`.
- `shopify_orders` — `UNIQUE(client_id, shopify_order_id)`. `shopify_created_at` is
  Shopify's own order timestamp, distinct from `created_at` (when this row was first
  synced) — analytics/date-range queries must use the former.
- `shopify_order_items` — `UNIQUE(client_id, shopify_line_item_id)`, FK to
  `shopify_orders` (`CASCADE`) and nullably to `shopify_products`/`shopify_variants`
  (`SET NULL` — a line item must never disappear just because its product lookup
  failed or the product was removed).

Sync is triggered by `POST /api/v1/shopify/sync` (creates `products_sync` +
`orders_sync` `sync_jobs` rows) and executed by `sync/worker.py` via
`shopify/sync.py::run_products_sync`/`run_orders_sync`. `orders_sync` reuses
`sync_jobs.cursor` as an incremental-sync checkpoint (an ISO timestamp passed to
Shopify's `updated_at_min`), not a pagination cursor — Shopify's own Link-header
pagination is handled per-page inside the provider client.

### Meta data (`backend/meta/models.py`) — built 2026-08-19
Same idempotent-upsert shape as Shopify's. No `meta_businesses` table — the OAuth flow
goes straight from login to ad-account selection with no separate business step, so
there's nothing to normalize there. No `meta_catalogs` either — nothing syncs a Meta
Commerce catalog (would only be needed for product-level ad attribution; see the
`reporting` note below for why that matters).

- `meta_ad_accounts` — 1:1 with `integrations` (`UNIQUE(integration_id)`,
  `UNIQUE(meta_account_id)`), mirrors `shopify_stores`.
- `meta_campaigns` — `UNIQUE(client_id, meta_campaign_id)`.
- `meta_ad_sets` — `UNIQUE(client_id, meta_ad_set_id)`, FK to `meta_campaigns`.
- `meta_ads` — `UNIQUE(client_id, meta_ad_id)`, FK to `meta_ad_sets`.
- `meta_insights_daily` — grain **(client, ad, date)**, exactly matching Section 23 of
  the brief ("tenant + ad_account + date + campaign + ad_set + ad"). Stores both the
  raw Meta id strings (`meta_campaign_id`/`meta_ad_set_id`/`meta_ad_id`, always present)
  and resolved FK columns (nullable — `insights_sync` can run before `campaigns_sync`
  has populated the hierarchy, resolved opportunistically).

Triggered by `POST /api/v1/meta/sync` (`campaigns_sync` + `insights_sync` jobs).
`campaigns_sync` cascades campaign → ad set → ad in one job rather than three — see the
comment in `meta/sync.py` for why that's not "one sync-everything job" in the sense
Section 19 warns against. `insights_sync` defaults to a 30-day lookback on first run,
then uses `sync_jobs.cursor` for incremental runs, same pattern as Shopify's
`orders_sync`.

### `reporting` (`backend/reporting/service.py`) — unified analytics, built 2026-08-19
Not a table — a query service (`get_unified_overview`) joining `shopify_orders` and
`meta_insights_daily` by date. **Grain: one row per (client, date)**, deliberately not
per-product. The CSV-upload engine (`analytics.py`) merges Meta spend and Shopify
revenue by Product ID, but that only works because that CSV export is a Meta *Catalog
Sales* report — spend already attributed per product. Live Marketing API data
(`meta_insights_daily`) is campaign/ad/day level, not product level, unless the
advertiser runs Dynamic Product Ads with a `product_id` breakdown, which nothing here
assumes. Product-level unified ROAS from synced data would need a Meta Catalog
integration (`meta_catalogs`, not built) plus `product_mappings` (see below) — date-level
is what today's data honestly supports. Exposed via `GET /api/v1/analytics/overview`.

## Not built (deliberately, not just "not yet")

- **`product_mappings`** — its purpose (Section 22) is connecting Shopify products to
  Meta *catalog* products. Without `meta_catalogs` there is nothing on the Meta side to
  map to, so this table has no real target today. Build it alongside a Meta Catalog
  integration if/when product-level Meta attribution becomes a real requirement — not
  speculatively.
- **`meta_catalogs`** — Section 15 of the brief is explicit: build catalog tables only
  if the product actually needs them. Nothing here does yet.
- **`fact_product_daily`** — a pre-aggregated fact table only pays for itself once
  `reporting`'s live-join queries genuinely can't keep up; not indicated at current
  (zero) production data volume. `reporting/service.py`'s SQL aggregation is the right
  starting point per Section 24 ("use SQL for large database aggregations").
