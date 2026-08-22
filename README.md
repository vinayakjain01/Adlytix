# Adlytix

Product-level ROAS analytics for D2C brands. Upload Meta Ads, Shopify and
Google Ads exports; get one merged, cleaned, per-product table with KPIs, a 4C
scale/protect/decide/cut quadrant view, discount-cohort comparison, and
Gemini-generated recommendations.

**If you are a new Claude session picking this up cold, read this whole file
before touching code.** It tells you what must never change, what already
works, what's half-built, and where the landmines are.

---

## 1. What this actually is — read this first

This is a **migration**, not a green-field app. It started as **ROASify**, an
existing working tool with battle-tested backend math. The task was: rebuild
the UI from a new design ("Adlytix"), add authentication + analytics +
currency display + AI insights, and **preserve every number ROASify produced,
to the decimal**.

### The one rule that overrides everything else

> **`backend/analytics.py` and `backend/data_cleaner.py` hold ROASify's
> original ROAS/ROI/quadrant math and CSV-cleaning logic. Treat both as
> off-limits by default** — if you're about to change either, stop and get
> explicit sign-off first, quoting this section. If a bug looks like it lives
> in the math, it is almost certainly a **display** bug in the frontend, not
> a backend one — see §8.
>
> **The literal truth, checked against full git history, not just the current
> diff:** `analytics.py` has genuinely never been touched since the migration
> began — zero diff against the last pre-migration commit (`a90f4bd`,
> 2026-06-05). `data_cleaner.py` is a different story: it was substantially
> rewritten in a single commit dated **2026-07-21, "Currency change added"**
> (`94d8ec9`), sitting 46 days after every other pre-migration commit. That
> diff includes, at minimum:
> - the intended fix — `_to_numeric_robust` now strips currency symbols/codes
>   (`$`, `₹`, `CAD`, `CA$`, …) before parsing a number, where before, a cell
>   like `"$1,234.56"` failed `float()`, was silently caught, and became `0`
>   — quietly zeroing real spend/revenue on any non-plain-INR export;
> - `_read_file` gained an encoding fallback (`utf-8-sig` → `latin-1`) and
>   `on_bad_lines='skip'` on `pd.read_csv`;
> - duplicate-column-name deduplication (a repeated header would otherwise
>   make `df[col]` return a DataFrame instead of a Series and crash later);
> - Meta's `_split_pid_title` now explicitly drops `"total"`/`"grand total"`
>   rows, and row-filtering order (empty Product ID, empty Month) was
>   restructured across `clean_meta`/`clean_shopify`;
> - a large amount of pure reformatting (docstrings removed, whitespace
>   collapsed) with no behavioural effect.
>
> **I do not have a verified account of why all of this landed in one commit,
> or full certainty about what was explicitly reviewed at the time** — my
> working context for this file was compacted before this session, and what
> survived the compaction was an inaccurate one-line claim ("zero-line diff")
> that this diff disproves. What I can state as fact: it's committed, it's
> been live since July 21, and it is **not** the "untouched" state this
> project's own rule calls for. The currency-symbol fix looks like real,
> defensible groundwork for the (separately, explicitly approved) currency
> feature; the encoding/dedup/row-filtering changes read as legitimate
> robustness fixes too, but I can't independently confirm they were reviewed
> against this rule at the time, only that they exist.
>
> **What I did about it:** corrected this document, and nothing else. I have
> not reverted, re-tested, or re-verified this file's output against a golden
> baseline as part of writing this README — that would be a substantial,
> separate task, not a side-effect of documentation. **If you are picking
> this project up, treat "is `data_cleaner.py`'s current behaviour actually
> correct and fully intended" as an open question the user should weigh in
> on, not a settled fact** — until it's been re-verified against real
> ROASify output specifically for this file's history, the same way the rest
> of the migration was.
>
> To check either file's real state yourself, diff against the pre-migration
> boundary, not `HEAD`: `git diff a90f4bd -- backend/analytics.py` (expect
> empty) and `git diff a90f4bd -- backend/data_cleaner.py` (will show the
> above). `git diff --stat HEAD` only proves "no uncommitted changes right
> now" — it says nothing about history, and is why this went unnoticed
> across several previous phases of work.

Two deliberate exceptions where backend logic *was* extended, both reviewed
and approved as scope additions (not touching the two protected files):
- **Currency normalisation** (`backend/currency.py`) — converts source
  currencies to a common base *before* `analytics.py` sums anything. Off by
  default (all-INR), so behaviour is unchanged unless a client actually
  reports in mixed currencies.
- **Discount tagging** in `main.py` — adds a `Discounted` boolean per product
  by cross-referencing an optional uploaded list. Does not touch any spend/
  revenue calculation.

---

## 2. Architecture

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  Next.js 16 (App Router)│  HTTP  │  FastAPI (Python 3.11)   │
│  output: 'export'       │◄──────►│  backend/main.py         │
│  static HTML+JS only    │ cookie │  Postgres (accounts only)│
│  no server, no API routes│ session│                          │
└─────────────────────────┘        └──────────────────────────┘
        ▲                                      ▲
        │ NEXT_PUBLIC_API_URL                  │ DATABASE_URL
        │ (same-origin in prod;                │ (SQLAlchemy + psycopg)
        │  localhost:8000 in dev)               │
```

- **Frontend is a static export.** No Next.js API routes, no middleware, no
  server-side session handling. Everything server-side lives in FastAPI.
- **The database stores accounts only** (users, clients, sessions via JWT).
  **Uploaded files and merge results are never persisted.** A merge is
  request → response; nothing is written to disk or DB. This means: no
  "history of past merges" feature exists or is planned without a deliberate
  decision to add storage (see §9, AI insights history).
- **Session = httpOnly JWT cookie**, `token_version` column for instant
  revocation (suspend a user → their very next request gets 403, no polling,
  no background job).
- **CORS + cookies is the #1 cross-origin failure mode.** If frontend and API
  are on different domains, the cookie needs `SameSite=None; Secure` — the
  production default is `SameSite=Lax` (same-origin only). See §7.

---

## 3. Directory map

```
app/                      Next.js App Router pages (one folder = one route)
  overview/                Dashboard: KPIs, spend/revenue chart, 4C mix, AI teaser
  sources/                 Upload Meta/Shopify/Google/discount-list CSVs, run merge
  product-analysis/        Full product table: filter, sort, search, column picker, CSV export
  quadrant-view/           4C scatter + cards + Champions hero + threshold sliders
  discount-analysis/       Discounted vs non-discounted cohort comparison
  insights/                AI insights screen (Gemini recommendations)
  settings/                Currency display picker, session info, analytics info
  users/                   Admin-only: create/suspend/edit accounts, manage clients
  login/                   Sign-in (no signup page exists anywhere — see §6)

components/               One folder per screen area, plus:
  layout/                   AppShell, sidebar, header, currency picker
  ui/                       Shared primitives (modal.tsx, form-field.tsx, stat-card.tsx, sonner.tsx)
                             — everything else from the original shadcn scaffold was deleted, unused
  analytics/                PostHog provider + global ErrorBoundary
  admin/                    User/client CRUD dialogs and tables
  insights/                 AI advice cards, analysis-progress checklist

lib/                       Business logic and API clients (no React in most of these)
  context.tsx                Global app state: merged data, month selection, currency — the
                              single source of truth every screen reads from
  auth-context.tsx            Session state (separate from app state; mounted outside it)
  insights-context.tsx         Shared AI-analysis state (so Overview + sidebar badge + /insights
                                screen all show the SAME result, not three separate runs)
  quadrants.ts                4C classification — MEAN thresholds (not median), Meta-spend only
  product-metrics.ts           Filtering, sorting, KPI aggregation for the product table
  currency.ts / formatters.ts  Display-currency conversion (NOT backend normalisation — see §8)
  admin.ts                     Admin API client (users, clients)
  insights.ts                  AI insights API client + brief-building from displayed data
  csv-export.ts                Export row-builders — headers still say "ROASify" (see §9)
  analytics/                   PostHog event contract (events.ts) + client wrapper (client.ts)

backend/
  main.py                    FastAPI app, CORS, /api/analyse (the merge endpoint), /health
  analytics.py                ⚠️ NEVER MODIFY — ROAS/ROI/quadrant/discount math
  data_cleaner.py              ⚠️ NEVER MODIFY — CSV cleaning for Meta/Shopify/Google
  currency.py                  Rate fetching (open.er-api.com) + pre-aggregation normalisation
  auth.py                      Login/session/admin-CRUD routes + first-run admin seeding
  models.py                    SQLAlchemy models: User, Client, Role, UserStatus
  security.py                  Password hashing, JWT create/verify, cookie flags
  insights.py                  Gemini call + response grounding (see §5)
  db.py                        Engine/session; normalises postgres:// → postgresql+psycopg://
  Dockerfile / .dockerignore   Container build (works — verified locally, see §7)

hooks/                     use-money (currency-aware formatter), use-merge, use-settled-value,
                            use-stored-preference (SSR-safe localStorage via useSyncExternalStore)

.do/app.yaml                DigitalOcean App Platform spec (API + Postgres + static site)
render.yaml                 Render Blueprint (API + Postgres + static site) — see §7 history
vercel.json                 Vercel multi-service config — see §7 for why Vercel doesn't really fit
docker-compose.yml           Local Postgres only
DEPLOYMENT.md                Longer deployment walkthrough (this README's §7 is the summary)
```

---

## 4. What exists and works today

All of this has been built, typechecked, linted, and manually verified against
a running stack (login → merge → every screen → sign out) at least once.
There is **no committed automated test suite** — see §10 for why and what to
do about it.

**Core analytics (ROASify's original features, UI rebuilt — the ROI/quadrant
formulas in `analytics.py` are untouched; the cleaning behaviour in
`data_cleaner.py` has changed since the original, see §1):**
- Meta Ads / Shopify / Google Ads upload, automatic cleaning, merge
- Optional discount-list upload → per-product `Discounted` tag
- Overview dashboard: dynamic KPIs, monthly spend/revenue chart, 4C mix, top products
- Product table: search, per-column metric filters, column picker, CSV export
- 4C quadrant: scatter plot, threshold sliders (rescale MEAN cut-offs), Champions
  scale-plan export, per-quadrant CSV export
- Discount cohort comparison (discounted vs non-discounted revenue/ROI/CTR/CPM)
- Month selection drives every screen (derived state, not an effect — see §8)

**New, built this migration:**
- **Authentication** — no public signup ever. Admin creates every account.
  Roles: `admin` (platform, no client) / `owner` / `analyst` / `viewer`
  (client-scoped). Suspending a user or letting a client's subscription lapse
  blocks access on the *next request*, immediately — `current_user` re-reads
  the DB every time, nothing is cached.
- **Users & access screen** (admin-only) — create/edit/suspend accounts,
  reset passwords (forces sign-out everywhere), manage client subscription
  dates. Guards against locking yourself out: can't demote/suspend your own
  account, can't remove the last active admin.
- **Currency display** — a *presentation-layer* picker (INR/USD/AED/EUR/GBP/
  CAD). Stored/computed values never change; only the rendered string does.
  Rates from `open.er-api.com` (free, no key). See §8 for the inversion bug
  history — read it before touching `lib/currency.ts`.
- **PostHog analytics** — lazy-loaded (zero bundle cost with no key set),
  autocapture deliberately OFF (would leak table contents), session replay
  OFF by default. Full event contract in `lib/analytics/events.ts`.
- **AI insights (Gemini)** — per-quadrant scale/protect/decide/cut
  recommendations. **The model never emits a number** — it returns only
  prose + product IDs; every figure shown is read from local data; every
  product ID is verified against the request before being rendered. See §5.
- **Settings screen** — currency grid, session info, sign-out-everywhere,
  a list of the *actual* PostHog events being sent (not aspirational ones).

---

## 5. The AI insights feature — design constraints, don't relax these

`backend/insights.py` calls Gemini (`gemini-2.5-flash` by default,
`GOOGLE_API_KEY` required, `GEMINI_MODEL` to override). Two rules are
load-bearing and were tested against adversarial model output:

1. **The model cannot produce a number.** The JSON response schema sent to
   Gemini has no numeric field anywhere — only strings and string arrays
   (`title`, `headline`, `actions[3]`, `rationale`, `productIds[]`). Every
   spend/revenue/ROI figure the user sees is read from the browser's own
   merged data, keyed by the product IDs Gemini returned. This isn't a
   prompt instruction that could be ignored — it's structurally enforced by
   the schema.
2. **Every product ID is verified server-side** before the response leaves
   the API. An invented ID is silently dropped and counted in
   `droppedProductIds`. This was tested by literally stubbing Gemini to
   return fake IDs and confirming they never reach the client.

Shared state lives in `lib/insights-context.tsx` — Overview's "Ask Adlytix
AI" button, the sidebar badge, and the `/insights` screen all read the *same*
result so clicking Generate once doesn't trigger three billed calls. **There
is no stored history of past analyses** — refreshing the page clears the
result. That was a deliberate call (analyses aren't persisted anywhere,
matching "no merge history" in §2), not an oversight — if you want history,
that's a schema change and a real feature decision, flag it to the user
first.

The progress checklist on `/insights` does **not** animate on a fake timer —
the first two steps genuinely complete client-side (brief built, products
bucketed) before the request goes out; the last two just sit at "in
progress" / "pending" because Gemini's one HTTP call reports no
intermediate progress. Don't add a `setInterval` that ticks the bar for
cosmetic smoothness — that's fabricating progress that didn't happen.

---

## 6. Environment variables

Full reference: `.env.example` in the repo root (documents both files).
**Backend reads from `backend/.env` via `python-dotenv`**, loaded at the very
top of `main.py` before any other import — if you add a new backend module
that reads `os.environ` at import time, it must be imported *after* the
`load_dotenv()` call or it'll silently miss the file.

| Variable | Where | Required? | Notes |
|---|---|---|---|
| `DATABASE_URL` | backend | yes | `postgres://` and `postgresql://` both normalised to `postgresql+psycopg://` |
| `JWT_SECRET` | backend | **yes in prod** | server refuses to boot in `ENVIRONMENT=production` without it; dev auto-generates an ephemeral one (logs everyone out on restart) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | backend | for first boot | seeds the first admin **only if no admin row exists yet** — even a suspended one blocks reseeding; must be a real-looking domain (`.local`/`.test`/`.example` rejected) |
| `ENVIRONMENT` | backend | — | `production` tightens cookie defaults and makes `JWT_SECRET` mandatory |
| `CORS_ORIGINS` | backend | yes | exact origin(s), no wildcard — credentialed cookies forbid it |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | backend | only for cross-domain deploys | see §7 — set `none`/`true` when frontend and API are on different domains |
| `GOOGLE_API_KEY` | backend | no | AI insights return 503 "not configured" without it — never fabricates advice as a fallback |
| `NEXT_PUBLIC_API_URL` | frontend | no | empty/unset = same-origin in production build (safe default); explicit `http://localhost:8000` in dev |
| `NEXT_PUBLIC_POSTHOG_KEY` | frontend | no | unset = SDK never downloaded, zero cost, zero collection |
| `NEXT_PUBLIC_POSTHOG_SESSION_REPLAY` | frontend | no | **leave `false`** — this app displays client revenue/spend on screen; replay would ship that to PostHog |

All `NEXT_PUBLIC_*` vars are inlined at **build time** (static export) — changing
one requires a rebuild, `npm run dev`/`npm run build` restart is not enough
in production, and a Render/Vercel env var change needs a redeploy.

---

## 7. Running it / deploying it

### Local

```bash
docker compose up -d db                     # Postgres on host port 5433
cd backend && python -m venv venv && venv\Scripts\activate   # or source on mac/linux
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000

# second terminal, repo root
npm install
npm run dev
```

**`npm run clean` before switching between `dev` and `build`.** This bit a
real deploy: `.next` from a finished `next build` (a static export) left in
place, then `next dev` on top of it, served **404s on routes that exist**.
`npm run clean` removes `.next` and `out/`; there's no `npm run start`
because `next start` cannot serve an `output: 'export'` build anyway.

### Deployment — three options exist, pick based on this

The backend does a **~188-second merge** on a 28k-product / 5-month upload
(measured, not estimated) and accepts uploads up to ~20 MB in one request.
This rules out classic serverless functions outright — most have a ~10-60s
timeout and a ~4.5MB body cap. **You need a persistent container**, not a
function.

- **DigitalOcean App Platform** (`.do/app.yaml`) — verified end-to-end
  against a real deploy of this spec: Docker API service + managed Postgres +
  static site, health check, CORS/cookie wiring all correct out of the box.
  This is the reference deployment.
- **Render** (`render.yaml`) — also Docker API + managed Postgres + static
  site. **History matters here:** an earlier `render.yaml` in this repo (from
  before the migration) declared *only* a Python-runtime backend with no
  database at all — `DATABASE_URL` unset meant the container silently fell
  back to `localhost`, table creation failed, but `/health` still returned
  200, so Render reported a **successful deploy** while nothing worked. The
  current file fixes this: Docker runtime (not `runtime: python`, which looks
  for `requirements.txt` at the repo root and fails since it's in `backend/`),
  a real managed database, `starter` plan (not `free` — free instances sleep,
  guaranteed to break a 188s merge), and **`COOKIE_SAMESITE=none` +
  `COOKIE_SECURE=true`** because Render gives the frontend and API different
  subdomains — the production cookie default (`Lax`) silently fails
  cross-subdomain login with zero error message anywhere.
- **Vercel** (`vercel.json`) — works for the **frontend only**. If you try to
  put the FastAPI backend on Vercel as a serverless function, the merge will
  time out and large uploads will be rejected before your code even runs.
  The clean split: Next.js static export on Vercel, FastAPI on Render/DO,
  `NEXT_PUBLIC_API_URL` pointing cross-origin, `CORS_ORIGINS` +
  `COOKIE_SAMESITE=none` set accordingly.

Whichever you pick, **verify in this order** after deploying — it isolates
failures fast: `/health` (200 = backend booted + routing works) → sign in
(tests DB + cookie + CORS all at once) → *then* try a real merge.

---

## 8. Bugs found and fixed during this migration — read before touching currency/state code

These are here because each one was subtle, each one was caught by
verification rather than obvious from reading the code, and the same class
of mistake is easy to reintroduce.

- **Currency conversion was inverted twice, in two different files, at two
  different times.** `backend/currency.py`'s rate convention is `rates[X]` =
  *how many base units one X is worth* (e.g. with an INR table, `rates.USD ≈
  95.76`). `lib/currency.ts`'s `displayFactor()` was written backwards
  against this convention — twice, because the second "fix" flipped it the
  wrong way and a hand-written test fixture happened to be inverted
  *consistently* with the bug, so the test suite passed while a ₹20 lakh
  total would have rendered as "$196 million" in the browser. The bug was
  only caught by validating against a fact the code couldn't fake: the
  AED/USD peg is 3.6725, independent of any fixture. **Any future currency
  change must be checked against a real fetched rate table and a real-world
  peg, not a fixture you wrote yourself.**
- **Currency conversion looked "broken"** (picker greyed out entirely) because
  of a chicken-and-egg deadlock: rates were only fetched once the display
  currency differed from the base, but the picker disabled any currency it
  had no rate for — so you could never select a different currency to
  trigger the fetch. Fixed by fetching as soon as a session exists.
- **Money figures went stale after a currency switch** in several `useMemo`
  blocks. `inr()`/`formatMoney()` read the active currency from **module-level
  state**, which React's dependency array can't see — so a memo listing only
  its data inputs kept returning the string formatted in the *previous*
  currency. Fixed with `hooks/use-money.ts`, which wraps the formatter in a
  `useCallback` keyed on `[currency, displayRate]` so it's a real,
  lint-checkable dependency. **If you add a new money-formatting `useMemo`,
  use `useMoney()`, not `inr()` directly, or it will silently go stale.**
- **Month selection used to be a `useEffect` that called `setState`** on every
  new merge (to auto-select all months). Replaced with derived state: the
  selection is tagged with the exact data array it was chosen against, and a
  new merge (a new array reference) invalidates it automatically during
  render — no effect, no bug class of "effect fires one render late."
- **A negative-revenue product crashed the 4C scatter plot** (`Math.pow` of a
  negative number is `NaN`, which React refuses as a CSS `width`). Real data:
  a product with returns exceeding its sales in the period has genuinely
  negative revenue. Fixed by clamping the *plotted position/size* to
  non-negative while leaving the *tooltip figure and quadrant classification*
  on the true (possibly negative) value — don't "fix" this by clamping the
  real number, that would misclassify the product.
- **`Math.max(...bigArray)`** (spread into arguments) overflows the call stack
  above ~100k array elements — this repo's own product counts get there.
  Use `.reduce()` for anything scanning the full product list.

---

## 9. Known gaps / deliberately deferred, ask before doing any of these

- **No committed automated test suite.** Every phase of this migration was
  verified with throwaway scripts (golden-baseline equivalence checks against
  real ROASify output, live-API smoke tests, adversarial-input tests for the
  AI grounding) written to a **session-scoped temp scratchpad**, not the repo
  — they do not survive between Claude sessions and are gone already. This
  README describes *what was proven at the time each check ran*, not a suite
  you can re-run — and per §1, at least one of those checks (the
  "`analytics.py`/`data_cleaner.py` unchanged" assertion, run repeatedly in
  later phases) was itself comparing against the wrong baseline and passed
  while being wrong. Golden-baseline *equivalence* checks (does today's merge
  output match a captured real-ROASify run) are a genuinely different, still
  trustworthy method from "is the file's diff empty" — but nothing here has
  re-run the actual equivalence check against `data_cleaner.py`'s current
  (July-21-onward) behaviour specifically, so its output has not been
  re-proven equivalent to the original since that rewrite. If you want
  regression protection going forward, the right move is asking whether to
  build a proper committed test suite (pytest + a `fixtures/golden_baseline.json`
  committed to the repo, or similar) — don't assume one exists, and don't
  assume `data_cleaner.py`'s current output is still golden-baseline-equivalent
  without checking.
- **CSV export filenames/headers still say "ROASify"** (`lib/csv-export.ts`),
  not "Adlytix". Left deliberately — a rename is a one-line change but
  changes the literal bytes of downloaded files, which is exactly the kind of
  thing that should be a conscious decision, not a drive-by rename.
- **The merge takes ~188 seconds** on a large catalogue. Root cause is known
  (`.apply()`/`.iterrows()` in `analytics.py`/`data_cleaner.py` doing
  per-row Python instead of vectorised pandas) but **has not been touched**
  because those files are protected — see §1. Optimising this would need
  profiling + provably-equivalent vectorisation, verified against a fresh
  golden baseline, and explicit sign-off given the §1 rule.
- **AI insights have no stored history** — see §5. Adding it means a new DB
  table and reversing an earlier "auth-only, no stored analysis" decision.
- **Discount screen uses unweighted CTR/CPM means**; the product table uses
  weighted ones. This mismatch is inherited from the original ROASify
  behaviour and was preserved deliberately rather than "fixed" — unifying it
  would change displayed numbers and needs a decision, not a silent patch.

---

## 10. Before you start making changes

1. `git log --oneline -20` to see what actually landed most recently — the
   summary above is accurate as of the commits it was written against, but
   trust the repo over this file if they disagree.
2. `git status` — check nothing is mid-flight.
3. If touching money, currency, or month-selection code: read §8 fully first.
4. If touching anything in `backend/analytics.py` or `backend/data_cleaner.py`:
   don't. Ask the user explicitly, quoting §1, before proposing it.
5. Run `npx tsc --noEmit` and `npm run lint` before considering frontend work
   done — both are configured strict (see `tsconfig.json` / `eslint.config.mjs`)
   and should report zero problems on a clean tree.
6. Test locally end-to-end (login → merge → every screen) before claiming a
   feature works — there's no automated suite to catch a regression for you
   right now (§9).
