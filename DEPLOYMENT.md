# Running and deploying Adlytix

Two pieces: a **FastAPI backend** (Python) and a **Next.js frontend** exported as
static files. The backend needs Postgres. Nothing else.

Uploaded spreadsheets and analysis results are **never stored** — they live in the
browser for the length of a session. The database holds accounts and clients only.

---

## 1. Files you need to create

Both are git-ignored. Nothing else is required.

| File | Purpose |
|---|---|
| `backend/.env` | Backend secrets. Loaded automatically at startup. |
| `.env.local` | Frontend build values (project root). |

`.env.example` documents every key. Copy the relevant half into each file.

> **Why two files, and why `backend/.env` rather than the root?**
> Next.js also reads a root `.env`. Keeping backend secrets out of a file the
> frontend build touches means a mistyped variable name can never end up inlined
> into the shipped JavaScript bundle.

---

## 2. Run it locally

```bash
# 1. Postgres (Docker). Host port 5433, so it won't clash with a local install.
docker compose up -d db

# 2. Backend
cd backend
python -m venv venv
venv/Scripts/activate          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000

# 3. Frontend, in a second terminal
npm install
npm run dev
```

Open <http://localhost:3000> and sign in with the `ADMIN_EMAIL` /
`ADMIN_PASSWORD` from `backend/.env`.

**Checks:** `npm run build` (must pass — type errors fail the build),
`npx tsc --noEmit`, `npm run lint`.

> **Run `npm run clean` when switching between `build` and `dev`.**
> `npm run build` leaves `.next` holding a finished static export. Starting
> `npm run dev` on top of that can serve **404s for routes that exist**, because
> the dev server finds export artefacts where it expects dev ones. `npm run clean`
> removes `.next` and `out`; the next `dev` or `build` rebuilds from scratch.
>
> There is no `start` script: `next start` cannot serve an `output: 'export'`
> build. Production is static files served by App Platform.

### The first administrator

On startup the backend creates the `ADMIN_EMAIL` account **only if no
administrator exists yet**. It is skipped otherwise, so redeploying never resets
your password.

Two things that trip people up:

- The check counts **any** admin row, including a suspended one. If seeding seems
  to do nothing, an admin already exists.
- The email must be a **real domain**. `.local`, `.test` and `.example` are
  rejected at sign-in, so seeding refuses them rather than creating an account
  that could never log in.

There is no signup page anywhere, by design. After the first admin, create every
account from **Users & access** in the sidebar (visible to administrators only).

---

## 3. Where each key comes from

### Required

| Key | Where to get it |
|---|---|
| `DATABASE_URL` | Local: already correct for `docker-compose.yml`. Production: injected by App Platform from the managed database. |
| `JWT_SECRET` | Generate one — see below. Signs session cookies. **Production must differ from local.** Rotating it logs everyone out. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | You choose. Password must be **12+ characters** or seeding is refused. |
| `NEXT_PUBLIC_API_URL` | Local: `http://localhost:8000`. Production: your app's own URL, since the API is served under `/api` on the same domain. |
| `CORS_ORIGINS` | The browser origin allowed to call the API. Must be explicit — the session is a credentialed cookie and browsers reject those against a wildcard. |

Generate a secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Optional — each feature is off until you add its key

**`GOOGLE_API_KEY`** — AI insights (Gemini).
<https://aistudio.google.com/apikey> → *Create API key*. Free tier is enough to
start. Backend-only; never expose it as `NEXT_PUBLIC_*`.
Leave empty and `/api/ai-insights` returns 503 with "not configured" — it never
invents advice. Override the model with `GEMINI_MODEL` if needed.

> When an operator clicks *Generate*, per-quadrant totals plus up to 8 product
> IDs, titles and figures per quadrant are sent to Google. That is inherent to
> the feature, but you should know it happens.

**`NEXT_PUBLIC_POSTHOG_KEY`** — product analytics.
<https://posthog.com> → your project → *Settings → Project → Project API Key*
(starts `phc_`). Use the `eu.*` host pair for an EU project. Not a secret: it is
write-only and visible in the bundle by design.
Leave empty and the SDK is never even downloaded.

**`NEXT_PUBLIC_POSTHOG_SESSION_REPLAY`** — leave `false` unless you have decided
otherwise. Replay records the screen, which here means your clients' spend and
revenue tables. Session *tracking* (counts, duration, entry/exit screens) works
without it.

Exchange rates need **no key** — `open.er-api.com` is free and keyless.

---

## 4. Deploy to DigitalOcean App Platform

`.do/app.yaml` already describes the whole thing: API service, managed Postgres,
and the static frontend.

```bash
git push origin main          # or your branch
doctl apps create --spec .do/app.yaml
# updating later:
doctl apps update <APP_ID> --spec .do/app.yaml
```

Or: **Apps → Create App → GitHub repo →** App Platform detects `.do/app.yaml`.

### Then set the secrets in the dashboard

Under **Settings → api → Environment Variables**, marked *Encrypted*:

- `JWT_SECRET` — a **new** value, not your local one
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- `GOOGLE_API_KEY` — only if you want AI insights

`DATABASE_URL`, `CORS_ORIGINS` and `ENVIRONMENT` are wired automatically by the
spec.

### If you want PostHog in production

Set `NEXT_PUBLIC_POSTHOG_KEY` on the **frontend** service, then **rebuild**. A
static export inlines `NEXT_PUBLIC_*` at build time, so a restart alone will not
pick it up.

### Before you call it production

- **`databases.production: false`** in `.do/app.yaml` is a dev database. Switch it
  to `true` and size it up for real data.
- **`name: roasify`** at the top of the spec is the App Platform app name. Renaming
  it creates a *new* app, so change it only if you have not deployed yet.
- **Add Alembic before your first schema change.** The app uses
  `Base.metadata.create_all()`, which creates missing tables but will **not**
  alter existing ones. A model change after go-live will not reach the database.
- Point a real domain at the app so the session cookie gets a stable host.

---

## 5. Things worth knowing

**Ad blockers** block `us.i.posthog.com` directly, typically losing 10–30% of
events. The fix is a reverse proxy; `NEXT_PUBLIC_POSTHOG_HOST` exists so that
becomes a config change rather than a code change.

**Password resets are manual.** There is no email provider wired up, so an
administrator sets passwords from Users & access. Doing so signs that account out
of every device, which is the point.

**Suspension and expiry are immediate.** Every request re-reads the account from
the database, so suspending someone or letting a subscription lapse takes effect
on their very next request — nothing needs to be revoked and nothing runs on a
schedule.

**CSV exports are still named `roasify_*`** and carry `ROASify` header rows. That
is deliberate: the regression suite pins those strings as proof the exports are
byte-identical to the original tool. Renaming them is a one-line change plus a
baseline update, whenever you want it.
