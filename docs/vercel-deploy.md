# Deploying Adlytix on Vercel (free plan)

One Vercel project serves both the Next.js frontend and the FastAPI backend
(see `vercel.json`). The database stays on Supabase (free tier).

## How syncing works on Vercel
There is no always-on worker. Instead:
- **On demand:** pressing Sync queues the jobs, then the app calls
  `POST /api/v1/sync/process`, which works through them (up to
  `SYNC_RUN_BUDGET_SECONDS`, default 45s).
- **Daily:** a Vercel cron calls `GET /api/v1/sync/cron` at 02:00 UTC. It queues
  a fresh sync for every connected Meta and Shopify integration and processes
  what fits in the time budget; anything left is picked up by the next run.
- A job whose function was stopped mid-run is retried after 10 minutes.

Limits to know: Vercel's free plan stops a function after a short time, so a
very large first sync may need several presses of Sync. The free Hobby plan is
for non-commercial use (Vercel's terms).

## Steps
1. Push to GitHub, then Vercel → *Add New Project* → import the repo.
   Leave the build settings alone; `vercel.json` defines the services.
2. Add the environment variables below (Project → Settings → Environment Variables).
3. Deploy, open the URL, then fix the two redirect URLs (step 4).
4. In the Meta developer app and the Shopify app, set the OAuth redirect URLs to
   `https://<your-project>.vercel.app/api/v1/meta/callback` and
   `https://<your-project>.vercel.app/api/v1/shopify/callback`.
5. Check `https://<your-project>.vercel.app/health` returns `{"status":"ok"}`.

## Environment variables (names only — copy the values from `backend/.env`)
Required:
`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ENVIRONMENT=production`,
`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_SCOPES`,
`META_APP_ID`, `META_APP_SECRET`, `META_SCOPES`, `GOOGLE_API_KEY`,
`CRON_SECRET` (new: any long random string).

Set to your deployed URL:
`API_BASE_URL=https://<your-project>.vercel.app`,
`FRONTEND_URL=https://<your-project>.vercel.app`,
`CORS_ORIGINS=https://<your-project>.vercel.app`.

Optional: `SESSION_HOURS`, `REMEMBER_DAYS`, `GEMINI_MODEL`,
`SYNC_RUN_BUDGET_SECONDS`.

Do **not** set `NEXT_PUBLIC_API_URL` — in production the app then calls the API
on its own domain. Do not copy `.env.local` (local development only).

Keep `ENCRYPTION_KEY` identical to the local one, or the stored Meta/Shopify
tokens in the database can no longer be decrypted.
