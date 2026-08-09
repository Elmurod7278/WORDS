# Essential Backend

Self-hosted Node.js + PostgreSQL backend for the Essential English Words Telegram Mini App. Identifies users via Telegram WebApp `initData`, records usage events, and exposes a password-protected admin stats panel.

## Deploy

1. Copy `.env.example` to `.env` and fill in real values:
   - `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather).
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — credentials for the `/admin` panel and `/api/admin/*`.
   - `CORS_ORIGIN` — the exact HTTPS origin your Mini App frontend is served from. Defaults to `*` if unset, which is fine for local testing but should be locked down in production.
2. Start everything: `docker compose up -d --build`. This builds the app image, starts Postgres, runs pending migrations automatically on every container start, then starts the server on port 3000.
3. Confirm it's healthy: `curl http://localhost:3000/health` should return `{"status":"ok"}`.

## HTTPS is required

Telegram Mini Apps only load over HTTPS, and browsers block a Mini App's HTTPS page from calling an HTTP-only API (mixed content). This backend serves plain HTTP on port 3000 — put a TLS-terminating reverse proxy (nginx, Caddy, etc.) in front of it in any real deployment, forwarding to `localhost:3000`. The app already calls `app.set('trust proxy', 1)`, so it correctly reads the real client IP (for rate limiting) from a single reverse-proxy hop.

## After deploying

- Update `API_BASE_URL` at the top of the frontend's `tracking.js` (repo root, not this directory) to your backend's real HTTPS URL, and redeploy the frontend.
- Visit `https://your-domain/admin` and log in with `ADMIN_USERNAME`/`ADMIN_PASSWORD` to confirm the stats panel loads.

## Local development

```bash
cp .env.example .env
docker compose up -d postgres
docker compose exec postgres psql -U essential -d essential -c "CREATE DATABASE essential_test;"
npm install
npm run migrate -- up
DATABASE_URL=postgres://essential:essential@localhost:5432/essential_test npm run migrate -- up
npm test
npm run dev
```
