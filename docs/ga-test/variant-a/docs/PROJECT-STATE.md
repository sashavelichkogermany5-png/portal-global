Status: active
Project: Portal Global
Date: n/a
Context: Current state summary and next actions.
Open items: Missing CURRENT-STATE doc; reconcile rate limit env naming.
# PROJECT-STATE

## A) Summary
PORTAL Global is a monorepo with a primary Node.js/Express backend (`server.js`) and SQLite persistence. The primary UI is `web-next` (Next.js) with session-token auth (cookie + optional Bearer). The legacy static UI under `backend/pages` remains available but is not the default. The `frontend/` app is deprecated.

## A0) Canonical inventory / current state
> NOTE (TODO): `docs/CURRENT-STATE.generated.md` is currently missing in the repo.
> - If the project expects it to be generated, document the generator command here (e.g. `npm run state` or `pwsh ...`).
> - Until it exists, treat `docs/PROJECT-STATE.md` + `AGENTS.md` as the canonical overview.

## A0.1) Environment notes (rate limits)
> NOTE: `.env` and `.env.example` currently use different rate limit variable names.
> - Example observed: `.env` has `RATE_LIMIT_MAX`, while `.env.example` uses more specific keys (e.g. per-route/public/auth/health).
> - Action: reconcile naming (pick one scheme) and document which variables are actually read by the server code.

## A1) Mission status
- Mission: 3-10 (multi-tenant RBAC/admin, tenant switcher, admin smoke + tenant scenarios, night-shift automation)
- Last PASS (health + smoke): 2026-02-25T00:12:56.2272519+01:00
- Git commit: none
- Next action: continue Mission 3-10 follow-ups after tenant smoke PASS

## Night Shift
<!-- NIGHT-SHIFT-START -->
- Last run: 2026-02-25T01:33:31.5507430+01:00
- Mission: 3
- Item: m3-tenant-switch-ui
- Status: PASS
- Exit code: 0
- Log: C:\Users\user\portal-global\logs\night-shift.json
<!-- NIGHT-SHIFT-END -->

## B) Repository structure (key paths)
```text
portal-global/
  server.js
  package.json
  .env.example
  .env.production.example
  web-next/           (primary UI)
  backend/pages/      (legacy UI)
  frontend/           (deprecated)
  docs/
  ops/
  scripts/
```

## C) Local dev (Windows PowerShell)
- Zero-hands loop: `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\autopilot-loop.ps1`
- Start dev: `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\run-dev.ps1`
- What runs: `npm run dev` = backend + web-next.
- Ports:
  - Default: `BACKEND_PORT=3000`, `WEB_PORT=3001`.
  - If either is busy, `ops/run-dev.ps1` auto-falls back to `3100/3101` and prints the chosen ports.
- Health: `npm run health` or `curl.exe http://localhost:<BACKEND_PORT>/api/health`.

## D) Architecture (current)
- Backend: `server.js` (Express + SQLite). Tenant-scoped data and session-token auth.
- Auth: session token stored in `sessions`; cookie name `SESSION_COOKIE_NAME` (default `portal_session`). Optional Bearer token is accepted.
- UI (primary): `web-next` uses a unified API client with `credentials: include` and optional Bearer token from login response.
- UI (legacy): `backend/pages/*` remains reachable on backend port.

## E) Autopilot
- Endpoints: `POST /api/autopilot/enable`, `GET /api/autopilot/status`, `POST /api/autopilot/tick`, plus offers/leads/metrics.
- Enable/tick require tenant admin (session) or service-token fallback.
- Fallback auth (no session): only for `enable` + `tick` using service token + tenant headers.
- Docs: `docs/AUTOPILOT.md`.

## F) UI and navigation
- Primary UI (web-next):
  - Register: `http://localhost:<WEB_PORT>/register`
  - Login: `http://localhost:<WEB_PORT>/login`
  - App: `http://localhost:<WEB_PORT>/app`
- Legacy UI (backend pages): `http://localhost:<BACKEND_PORT>/login`
- `frontend/` is deprecated and excluded from dev scripts.

## G) Ops scripts
- `ops/run-dev.ps1`: auto-selects ports, sets env for backend + web-next, installs deps, runs `npm run dev`.
- `ops/autopilot-loop.ps1`: zero-hands loop (start dev, detect ports, run smoke, auto-retry, log results).
- `scripts/smoke.ps1`: health check + auth + autopilot status/enable/tick with fallback.
- `ops/kill-port.ps1`: optional manual cleanup, not required for dev.

## H) Env highlights
- Core: `PORT`, `HOST`, `DATABASE_PATH`, `SESSION_COOKIE_NAME`, `SESSION_TTL_DAYS`, `ALLOWED_ORIGINS`.
- Dev ports: `BACKEND_PORT`, `WEB_PORT` (used by scripts; auto-set by `ops/run-dev.ps1`).
- Admin bootstrap (dev): `ADMIN_BOOTSTRAP_CODE` (legacy: `ADMIN_BOOTSTRAP_TOKEN`).

## I) Checks
```powershell
curl.exe http://localhost:<BACKEND_PORT>/api/health

curl.exe -X POST "http://localhost:<BACKEND_PORT>/api/auth/login" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"demo@local\",\"password\":\"demo12345\"}" `
  -c .cookies.txt

curl.exe "http://localhost:<BACKEND_PORT>/api/autopilot/status" -b .cookies.txt
```

## J) Risks / notes
- Multiple UI surfaces exist; web-next is the single source of truth for new work.
- `frontend/` is deprecated due to mismatched API endpoints and missing imports.



























