# Database Audit — Supabase Project `tmqucrmdqyrzccglvmgc`

Date: 2026-08-18
Method: read-only inspection via `information_schema`, `pg_extension`, `pg_policies` —
no writes, no DDL executed. Credentials used only from a local, git-ignored environment
variable for this session; never logged or committed.

## 1. Project state: effectively empty

The `public` schema — where all application tables would live — **contains zero
tables**. Everything present is Supabase's own managed infrastructure:

| Schema | Purpose | Contains app data? |
|---|---|---|
| `auth` | Supabase Auth (users, sessions, MFA, SSO, OAuth clients) | No — unused; Adlytix has its own JWT auth in `backend/` |
| `storage` | Supabase Storage (buckets/objects) | No — empty, unused |
| `realtime` | Supabase Realtime (logical replication subscriptions) | No — unused |
| `vault` | Supabase Vault (encrypted secrets) | No rows, but usable — see Section 4 |
| `extensions`, `pg_catalog`, `information_schema` | System | N/A |
| `public` | **Application schema** | **Empty — 0 tables** |

Extensions installed: `pgcrypto` 1.3, `uuid-ossp` 1.1, `pg_stat_statements` 1.11,
`supabase_vault` 0.3.1, `plpgsql` (default).

No RLS policies exist anywhere (`pg_policies` returned zero rows) — expected, since
there are no application tables yet to protect.

**Conclusion: there is nothing to preserve, migrate, or accidentally destroy in this
project's `public` schema.** The brief's repeated caution against assuming an empty
database and against dropping existing data does not apply here — this genuinely is a
blank project. This should still be re-verified immediately before Phase 1's first
migration runs, in case something else writes to it between now and then.

## 2. Supabase Auth is present but must stay unused

`auth.users` and the rest of the `auth` schema exist (Supabase provisions them by
default) but are empty and irrelevant to this project. Per the brief's Section 3
("The existing FastAPI authentication system should not be unnecessarily replaced by
Supabase Auth") and the working `backend/auth.py`/`security.py` system already audited
in `ARCHITECTURE_AUDIT.md`, **Supabase Auth will not be used**. `users`/`clients` stay
as application-owned tables in `public`, managed by SQLAlchemy models + Alembic, exactly
as they are today — just pointed at this Postgres instance instead of Render/DO's.

## 3. Connection details (recorded structurally, not the secret itself)

- **Update, 2026-08-19**: switched from the direct connection to Supabase's
  **session-mode pooler** (`aws-1-ap-northeast-2.pooler.supabase.com:5432`, username
  `postgres.<project-ref>`). Not a preference — the direct host (`db.<ref>.supabase.co`)
  turned out to be IPv6-only, and the development machine has no reliable outbound IPv6
  route (confirmed at the socket level: `connect()` returned "network unreachable", not
  a DNS failure). This had worked earlier in the same session and then stopped, so the
  underlying cause is a flaky/absent IPv6 path on that network, not anything
  Supabase-side. The pooler is IPv4-reachable and sidesteps the whole class of problem.
  Session mode (not transaction-mode, port 6543) because the backend holds a
  long-lived SQLAlchemy pool (`pool_pre_ping`/`pool_recycle=1800`) — transaction-mode
  pooling resets session state between transactions in ways that don't suit a
  persistent pool. `sync/worker.py` (Phase 7) uses the same `DATABASE_URL`, so this
  covers it too — no separate pooled endpoint needed for workers as originally
  flagged below; one connection string for everything turned out simpler and correct.
  If direct IPv4/IPv6 connectivity is ever confirmed stable in a given deployment
  environment, reverting to the direct host is a one-line `DATABASE_URL` change, not
  a schema change.
- `SUPABASE_SECRET_KEY`/`SUPABASE_PUBLISHABLE_KEY` (the new-style Supabase API keys, not
  the legacy `service_role`/`anon` JWTs) are usable if the PostgREST/Storage/Realtime
  layer is ever wanted, but **nothing in the current or planned architecture calls
  Supabase's REST API** — the app talks to Postgres directly via SQLAlchemy. These keys
  can stay unused; only `DATABASE_URL` (built from the connection string) is actually
  needed by the backend.

## 4. Encryption-at-rest option worth considering

`supabase_vault` (`pgcrypto`-backed) is already installed. The brief requires OAuth
tokens (Shopify, Meta) to be encrypted at rest and never stored plaintext (Sections 12,
16). Two viable options, to decide in Phase 2:
- **App-level envelope encryption**: encrypt with a key from `ENCRYPTION_KEY` (new env
  var) inside the FastAPI service before writing `access_token_encrypted` etc. Portable
  across any Postgres, no Supabase lock-in.
- **`supabase_vault`**: store secrets via `vault.create_secret`, reference by id. Simpler
  key management (Supabase manages the encryption key), but ties credential storage to
  staying on Supabase specifically.

Recommendation: app-level envelope encryption with a `cryptography`/`nacl` library and an
`ENCRYPTION_KEY` env var — keeps the same portability the brief asks for elsewhere
(Section 3: "do not introduce vendor lock-in beyond Postgres itself" is implied
throughout, e.g. Sections 3–4 insisting Supabase services are used "only where they
provide genuine value"). Final call deferred to Phase 2 sign-off.

## 5. The actual live production database is on Render — and holds real data

`backend/.env` (local, git-ignored, not printed here) turns out to be configured with
what are evidently live production values — `ENVIRONMENT=production`, a real admin
email, a real Gemini key, and a `DATABASE_URL` pointing at a Render-managed Postgres
instance (`*.singapore-postgres.render.com`), matching `render.yaml`'s `adlytix-db`.
Read-only inspection of that database (row counts only, no PII pulled) confirms it is
live, not a placeholder:

| Table | Rows |
|---|---|
| `clients` | 1 (created 2026-07-30) |
| `users` | 2 (1 `ADMIN`, 1 `ANALYST`) |

This resolves the "which of three databases is authoritative" question from
`ARCHITECTURE_AUDIT.md`: **Render is production today.** The DigitalOcean App Platform
spec (`.do/app.yaml`, `production: false`) is not currently the live target. Moving the
system of record to this Supabase project means migrating this one real client and two
real users across — trivial in volume, but it is a real cutover (repoint `DATABASE_URL`,
verify login still works, verify the seeded-admin logic in `init_auth()` doesn't try to
re-seed) and not the "nothing to lose" blank-slate situation Section 1–4 describe for the
Supabase project's own current emptiness. Both facts are true at once: Supabase starts
empty, and there is a small amount of real production data elsewhere that would move
into it.

## 6. What this means for Phase 1

Because `public` is empty, Phase 1 is a **clean build**, not a migration of existing
data:
1. Point `DATABASE_URL` at this Supabase instance (locally first, then decide on
   production cutover — see the open question in the completion report about
   Render/DO's existing managed Postgres instances).
2. Introduce Alembic, with migration `0001` being the *baseline* — i.e., the existing
   `clients`/`users` tables as they're defined in `backend/models.py` today, generated
   against this empty database rather than hand-written from scratch, so the migration
   history matches the real schema exactly.
3. Every subsequent migration in the brief's list (`integrations`, `shopify_*`,
   `meta_*`, `product_mappings`, `sync_jobs`, `webhook_events`, `audit_logs`) is additive
   on top of that baseline — no ALTER-in-place risk on this project.

No data backfill, no downtime plan, and no reversibility concerns are needed for this
project specifically — those concerns *would* apply if Render's or DO's existing managed
Postgres (which may hold real `clients`/`users` rows today) is the one being retired in
favor of this Supabase instance. That migration path (if chosen) needs its own explicit
plan before Phase 1 starts, not folded into it silently.
