# Deployment

**Status:** the app is **not deployed yet**. The cloud workspace it was built in had no hosting credentials, and its network policy blocked hosting APIs (for example `api.render.com`). Everything needed for a one-click deploy is in the repository; the steps below need your hosting account.

## Option A — Render Blueprint (recommended, no local computer needed)

1. Sign in at <https://dashboard.render.com> with GitHub.
2. **New → Blueprint**, then choose `amerzaher2022-spec/deliverye-goo`. Render reads `render.yaml` and creates:
   - `erbil-delivery-world`: Node web service (`npm ci --include=dev && npm run build`, then `npm start`, health check `/api/health`)
   - `erbil-delivery-db`: PostgreSQL
3. When asked, enter **ADMIN_EMAIL** and **ADMIN_PASSWORD** (12+ characters). They are stored as Render secrets, never in Git.
4. Wait for the first deploy. On startup the service runs the migrations, creates the admin account and seeds the fictional demo businesses.
5. Open `https://<your-service>.onrender.com/` (game) and `/admin` (dashboard).

Free-tier caveats (Render's current terms apply):
- Free web services sleep after a period without traffic. The first request after that takes about a minute.
- Free PostgreSQL databases expire after a limited period. Use a paid instance (or any external PostgreSQL via `DATABASE_URL`) for anything longer than a short demo.
- Data, including uploaded logos, lives in PostgreSQL, so it survives redeploys and restarts.

## Option A2 — free, without the 30-day database limit (Render + Neon)

Render's free PostgreSQL is deleted after its trial period, so for a free deployment that keeps its data, use Render only for the web service and keep the database on Neon's free plan.

1. Sign in at <https://neon.com> (no card needed) and create a project in a region near Frankfurt (for example AWS eu-central-1).
2. Copy the connection string from **Connect**. It looks like `postgresql://user:password@ep-....eu-central-1.aws.neon.tech/neondb?sslmode=require`. Keep it secret.
3. In Render: **New → Blueprint**, choose `amerzaher2022-spec/deliverye-goo`, and set **Blueprint Path** to `render.neon.yaml`.
4. Enter **DATABASE_URL** (the Neon string), **ADMIN_EMAIL** and **ADMIN_PASSWORD** (12+ characters).
5. Wait for the first deploy, then open `https://<your-service>.onrender.com/` and `/admin`.

Free-plan limits (check the providers' current terms): the web service sleeps after about 15 minutes without traffic and takes about a minute to wake. Neon's free plan has a small monthly storage and compute allowance, which is plenty for a demo. The Neon database also sleeps when idle and wakes on the next query.

## After updating an existing deployment to the real Erbil map

A database seeded before the real map holds demo businesses at the old, schematic positions. Open the dashboard, and use **Reset demo data** (available while `DEMO_MODE=true`) once, so the demo businesses are placed on the real streets.

## Option B — any Docker host

```bash
docker build -t erbil-delivery-world .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='a-long-password' \
  -e DEMO_MODE=true erbil-delivery-world
```

Put it behind HTTPS; the session cookies are `Secure` when `NODE_ENV=production`.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string (`?sslmode=require` enables TLS) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first start | Creates the first admin if it does not exist (never resets an existing password) |
| `DEMO_MODE` | no (default off) | Enables the "reset demo data" action. Keep it off for any deployment with real data |
| `SEED_ON_EMPTY` | no (default on) | Seeds the fictional dataset when the database is empty |
| `MAX_UPLOAD_BYTES` | no (2 MB) | Upload size limit |
| `TRUST_PROXY` | no (on in production) | Read the client IP from `X-Forwarded-For` (login rate limiting) |

## Map tiles and search

The dashboard map loads tiles from `tile.openstreetmap.org` and searches with Nominatim from the administrator's browser. Both are fine for a low-traffic demo under the OpenStreetMap usage policies, with attribution shown. For production traffic, switch to a commercial tile and geocoding provider.

## Native apps

The game is an installable PWA (manifest, icons, service worker). Android and iOS native builds were **not** produced: no Android SDK or Xcode was available. To package it, wrap the built `dist/web` with Capacitor (`npx cap add android` / `ios`). The iOS build needs a Mac with Xcode and an Apple developer account for signing.
