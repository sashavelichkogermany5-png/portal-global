# Short summary
- Windows dev loop via ops/autopilot-loop.ps1 and ops/run-dev.ps1.
- Ports default 3000/3001 with auto fallback to 3100/3101.
- Health check via npm run health or /api/health.
- UI URLs for register/login/app; legacy backend login noted.
- Notes on lockfiles and admin bootstrap token.
# DEV-RUN

## Zero-hands loop (Windows)
1) From repo root:
   - `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\autopilot-loop.ps1`
2) What it does:
   - Starts dev via `ops/run-dev.ps1`, detects ports, runs smoke, auto-retries until green.
   - Writes logs in `logs/` (dev, health, smoke, ports, last-result).

## Quick start (Windows)
1) From repo root:
   - `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\run-dev.ps1`

## Ports (auto-fallback)
- Default: `BACKEND_PORT=3000`, `WEB_PORT=3001`.
- If either port is busy, `ops/run-dev.ps1` falls back to `3100/3101` and prints the chosen ports.

## Health check
- `npm run health`
- `curl.exe http://localhost:<BACKEND_PORT>/api/health`

## UI
- Primary UI (web-next):
  - Register: `http://localhost:<WEB_PORT>/register`
  - Login: `http://localhost:<WEB_PORT>/login`
  - App: `http://localhost:<WEB_PORT>/app`
- Backend pages are optional (legacy): `http://localhost:<BACKEND_PORT>/login`

## Notes
- `frontend/` is deprecated and not used in dev scripts.
- If web-next dependencies fail, run `npm install` in `web-next` and retry.

## Package manager and lockfiles
- Use `npm` only.
- Keep `package-lock.json` in repo root and `web-next/package-lock.json`.
- Remove other lockfiles (`yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `backend/package-lock.json`).
- If lockfile conflicts appear: delete the extra lockfiles and re-run `npm install` in root and `web-next`.

## Admin bootstrap (dev-only)
- Optional: set `ADMIN_BOOTSTRAP_CODE` (or legacy `ADMIN_BOOTSTRAP_TOKEN`) in `.env` for local admin promotion.
- Endpoint: `POST /api/admin/bootstrap` (local only, non-production).
