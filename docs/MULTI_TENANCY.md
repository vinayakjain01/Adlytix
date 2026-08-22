# Multi-Tenancy — Adlytix

Model: **shared database, logical multi-tenancy** (architecture brief, Section 7).
`clients` is the tenant. One Postgres database, one `public` schema, every tenant-owned
row carries `client_id`. No database-per-tenant, no schema-per-tenant.

## The rule

> Tenant A must never be able to read, update, or delete Tenant B's data, including
> integration credentials — enforced server-side, never by frontend filtering alone.

## How it's enforced today

1. **Tenant is derived from the session, never from the request.**
   `current_user()` (`backend/auth.py`) resolves the signed-in user — and their
   `client_id` — from the httpOnly session cookie, re-read from the database on every
   request. No endpoint accepts a `client_id` query/body parameter and trusts it.

2. **`require_client_scope` gates every tenant-owned resource.**
   Added in Phase 1 (`backend/auth.py`). Rejects platform admins (who have no
   `client_id`) with 403, and hands the resolved `User` — with its `client_id` — to the
   endpoint. Every router added from the integrations phase onward depends on this
   instead of re-implementing tenant resolution:
   ```python
   def list_integrations(user: User = Depends(require_client_scope), ...):
       service.list_for_client(db, user.client_id)   # user.client_id, never a request param
   ```

3. **Service-layer functions take `client_id` as an explicit argument, and scope
   lookups by it in the query itself — not after fetching by id.**
   See `integrations/service.py::get_for_client`: the `WHERE` clause filters on both
   `id` and `client_id` together, so a not-found row and a belongs-to-another-tenant row
   return the identical 404. Tenant A can't learn tenant B's integration exists at all,
   let alone read it. Every future tenant-scoped lookup (Shopify stores, Meta accounts,
   products, orders) should follow this exact shape.

4. **Foreign keys cascade tenant-scoped, not globally.**
   `integrations.client_id` and `audit_logs.client_id` both reference `clients.id`.
   Deleting a client cascades to its integrations (`ON DELETE CASCADE`); audit log rows
   are preserved with `client_id` set to `NULL` instead (`ON DELETE SET NULL`) — an
   audit trail should outlive the tenant it was about.

## What is not yet in place

- **Row-Level Security (RLS).** No policies exist (confirmed empty in
  `DATABASE_AUDIT.md` §1) because the app connects with a single role that already
  enforces tenant scoping at the query layer above. RLS would be defense-in-depth
  against a bug in that query layer, not a replacement for it (brief Section 27: "defense
  in depth"). Revisit once there is a second connection role that might bypass
  application code (e.g. an analytics/BI tool connecting directly) — not needed while
  every access path goes through FastAPI.
- **Automated tenant-isolation tests** ("Tenant A cannot access Tenant B", brief Section
  45) — no test suite exists yet for the backend at all (`ARCHITECTURE_AUDIT.md` §9).
  This is required before Phase 3/4 ship real cross-tenant data (Shopify orders, Meta
  spend) — flagged for the phase that introduces the test suite.

## Checklist for every new tenant-owned table/endpoint

- [ ] Table has a `client_id` column with a FK to `clients.id` and an index on it.
- [ ] Every query filters by `client_id` in the `WHERE` clause, not after fetching.
- [ ] The endpoint depends on `require_client_scope` (or an equivalent that resolves
      `client_id` from the session) — never accepts `client_id` from the client.
- [ ] A not-found-vs-other-tenant's-row response is identical (404, not 403-then-404).
