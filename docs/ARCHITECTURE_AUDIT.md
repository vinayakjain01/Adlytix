# Architecture Audit — Adlytix

Date: 2026-08-18
Scope: Phase 0 audit only. No feature code changed as part of this document.

## 1. What Adlytix actually is today

Adlytix is a **stateless CSV/Excel analytics tool with a thin persistent auth layer**, not
an integration platform. This is a deliberate, documented design choice (see
`backend/models.py` header comment), not an oversight:

```
Browser
  → uploads Meta export (.csv/.xlsx)
  → uploads Shopify export (.csv/.xlsx)
  → uploads Google export (.csv/.xlsx, optional)
  → uploads a discount list (optional)
  ↓
POST /api/analyse (multipart, one request, synchronous)
  ↓
pandas cleaning (data_cleaner.py) → pandas analysis (analytics.py)
  ↓
JSON response (products, KPIs, quadrants, discount data)
  ↓
Rendered in the browser — nothing is written to a database
```

"Meta", "Shopify" and "Google" in the current codebase mean **export file formats**
(column-name heuristics in `clean_meta`/`clean_shopify`/`clean_google`), not live API
connections. There is no OAuth, no webhook, no background sync, and no stored
product/order/campaign data anywhere in the system. Every `/api/analyse` call is
independent; results live only in the browser for that session.

This is the single biggest gap against the target architecture in the brief: Phases 3–7
of that brief (Shopify OAuth, Meta OAuth, sync workers, webhooks, queues) are **net-new
subsystems**, not extensions of something that partially exists.

## 2. Stack (confirmed from source)

**Frontend** — `package.json`, `app/`, `lib/`, `components/`
- Next.js 16 (App Router), React 19, TypeScript 5.7, Tailwind 4
- Static export (`output: 'out'`, deployed as a static site on both Render and DO App
  Platform) — i.e. **no Next.js server runtime in production today**. This matters: any
  new frontend code that needs secrets or server-side logic (OAuth redirects, etc.)
  cannot live in Next.js API routes under the current deployment model and must go
  through FastAPI, or the static-export decision has to be revisited.
- Talks to the backend only through `lib/api.ts` / `lib/http.ts`, credentialed cookie
  session, no tokens in JS-reachable storage.

**Backend** — `backend/`
- FastAPI 0.111, SQLAlchemy 2.0 (Core+ORM), `psycopg[binary]` 3, bcrypt, PyJWT,
  `python-dotenv`, `google-genai` (Gemini, for the AI-insights feature), pandas/numpy/openpyxl.
- One router for auth (`auth.py`), one for AI insights (`insights.py`), everything else
  lives directly in `main.py`.
- No Alembic, no Redis, no task queue, no Celery/RQ/arq, no worker process.

**Deployment** — two parallel, seemingly redundant specs both live in the repo:
- `render.yaml`: Render blueprint — Docker API service + Render-managed Postgres
  (`adlytix-db`, `basic-256mb`, region `singapore`) + static frontend.
- `.do/app.yaml`: DigitalOcean App Platform spec — Docker API service + DO-managed
  Postgres (dev tier, `production: false`) + static frontend.
- **Neither currently points at Supabase.** The Supabase project provided in this
  session is a third, so-far-unused Postgres instance. Bringing it in as "the" database
  means either migrating off whichever of Render/DO is the live one, or clarifying which
  of the three is actually authoritative right now. This needs an explicit decision
  before Phase 1 (see Open Questions in the completion report).

## 3. Database model (SQLAlchemy, `backend/models.py`)

Two tables only:

```
clients                          users
├─ id (uuid str, PK)             ├─ id (uuid str, PK)
├─ name (unique)                 ├─ client_id (FK → clients.id, nullable = platform admin)
├─ subscription_expires_at       ├─ email (unique)
└─ created_at                    ├─ password_hash (bcrypt, SHA-256-prehashed)
                                  ├─ name
                                  ├─ role (admin | owner | analyst | viewer)
                                  ├─ status (active | invited | suspended)
                                  ├─ token_version (int, session-revocation counter)
                                  ├─ must_change_password
                                  ├─ last_login_at
                                  └─ created_at
```

Good news for the multi-tenancy requirement in the brief: **`Client` already is the
tenant entity**, and the role model (`admin/owner/analyst/viewer`) already matches
section 28 of the brief almost exactly (`admin` here is platform-level, closer to a
super-admin than a per-tenant role — the brief's per-tenant `owner/admin/analyst/viewer`
would need `Role` extended with a tenant-scoped `admin`, distinct from the existing
platform `ADMIN`). This should be **extended, not replaced**.

Schema is created via `Base.metadata.create_all()` in `auth.py::init_auth()`, run on
every app startup. There are no migrations. This is explicitly flagged in the code's own
comment as needing Alembic "before the first schema change reaches production" — which
is exactly what this project is about to do.

## 4. Authentication & authorization

- Login: email+password → bcrypt-verified → httpOnly, `SameSite`-aware session cookie
  carrying a JWT (`sub`, `ver`, `iat`, `exp`, `rem`). No refresh tokens; "remember me"
  just issues a longer-lived cookie.
- `current_user()` re-reads the user (and client) from the DB on every request — status,
  role and subscription expiry are always live, never trusted from the token. This is a
  solid pattern; keep it as the base for a tenant-resolution dependency (Section 27 of
  the brief: "backend must derive tenant ownership from the authenticated session").
- No self-service signup. Accounts are admin-created only (`/api/auth/users`,
  `/api/auth/clients`, all behind `require_admin`).
- Password policy (12+ chars), timing-safe login (dummy bcrypt check on unknown email),
  last-admin-lockout guard, session revocation via `token_version` bump — all already
  production-grade and should be preserved as-is.
- **Gap**: there is currently no per-tenant role check anywhere (no endpoint is
  tenant-scoped yet, because no tenant-owned data exists yet). The `client_memberships`
  concept from the brief isn't needed yet — every user already belongs to exactly one
  client via `users.client_id`. Introduce `client_memberships` only if/when multi-client
  users become a real requirement; don't build it speculatively.

## 5. Analytics pipeline (`data_cleaner.py`, `analytics.py`, `insights.py`)

- `data_cleaner.py` (372 lines): per-source column-heuristic cleaners
  (`clean_meta`, `clean_shopify`, `clean_google`) that normalize arbitrary export
  spreadsheets into a common shape. This logic is provider-format parsing, not
  provider-API parsing — worth keeping as-is for the file-upload path, but it does not
  generalize to API responses without rewriting.
- `analytics.py` (490 lines): pure pandas transforms — `run_overall_view` (merges
  Meta+Shopify+Google by Product ID/month), `run_product_analysis` (quadrant/ROAS
  analysis), `run_discount_analysis`. All operate on in-memory DataFrames, no DB access.
  This is the logic the brief says to preserve and wrap, not rewrite — correct call,
  because the actual computation (ROAS, quadrant cuts, discount attribution) is
  independent of where the rows come from.
- `insights.py` (441 lines): Gemini-backed AI recommendations over quadrant summaries,
  stateless, no persistence, has its own cache key / grounding-against-known-product-ids
  logic. Unrelated to the sync/integration work but worth knowing it exists before
  building a `recommendations` feature under the new architecture, so it isn't duplicated.

## 6. Security posture observed

- Secrets: `.env` / `backend/.env` correctly gitignored; `.env.example` has no real
  values; `JWT_SECRET` refuses to boot in production if unset; CORS is explicit-origin
  only (rejects `*` with credentials, correctly).
- File uploads: parsed directly with pandas/openpyxl, no explicit size cap, no MIME/type
  allowlist beyond filename-extension sniffing, no macro/formula stripping. Acceptable
  today only because results are never persisted or re-served — this gets materially
  more dangerous once uploaded/synced data is written to Postgres and read back into
  other users' dashboards (Section 43 of the brief). Needs hardening in the same phase
  that introduces persistence.
- No encryption-at-rest utility exists yet anywhere in the codebase — required net-new
  for Shopify/Meta OAuth token storage (Section 12/16).
- No rate limiting, no structured/request-ID logging, no audit log table — all net-new.

## 7. What must be preserved as-is

1. `Client`/`User` schema and the auth flow in `auth.py`/`security.py` — extend, don't replace.
2. The pandas analytics functions in `analytics.py` — reuse via a service layer over
   normalized DB tables, per the brief's own instruction (Section 24).
3. `/api/analyse`'s file-upload path — must keep working for users who never connect an
   integration. Do not force-migrate everyone to Shopify/Meta before both are built.
4. The static-export frontend deployment — or explicitly decide to change it (see below).

## 8. What must change / be added (net-new, not refactors)

- Alembic (schema is currently `create_all`-only).
- `integrations`, `shopify_*`, `meta_*`, `sync_jobs`, `webhook_events`, `product_mappings`,
  `audit_logs` tables — none exist.
- A provider-agnostic integration/adapter layer — doesn't exist; `data_cleaner.py` is
  file-format parsing, not an API client.
- Credential encryption utility — doesn't exist.
- Background job execution (queue + worker) — doesn't exist; everything today runs
  synchronously inside the request/response cycle by design (which is fine for CSV
  parsing, not fine for OAuth syncs).
- A real system-of-record decision for Postgres: Supabase vs. Render vs. DO (currently
  three candidate databases exist in this repo's configuration).

## 9. Technical debt worth flagging (not blocking, but relevant to sequencing)

- Two deployment specs (Render + DO) for the same app, unclear which is actually live in
  production. Adding a third DB (Supabase) without resolving this will make "system of
  record" ambiguous exactly where the brief is strictest (Section 3).
- `main.py` mixes route handling, currency normalization, and response shaping in one
  314-line file with no router — fine at current size, will need splitting once
  `/api/v1/shopify/*`, `/api/v1/meta/*` etc. are added (Section 29 asks for clean API
  namespaces — good opportunity to introduce `/api/v1` prefixing project-wide at the same
  time, rather than mixing versioned and unversioned routes).
- No test suite was found under `backend/` — Section 45 requires unit/integration/security
  tests for all new sync/tenant-isolation logic; this project starts that from zero.
