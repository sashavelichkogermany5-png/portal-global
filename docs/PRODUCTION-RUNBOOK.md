# Short summary
- Port map: only 3000 should be open.
- Quick start commands for kill ports, ports check, smoke, start server.
- Community mode rules: allowed public paths and blocked actions.
- Production checklist and required env vars.
- Health endpoint /api/health sample response.
# PORTAL Global - Production Runbook

## Port Map

| Port | Service | Status | Notes |
|------|---------|--------|-------|
| **3000** | Express Server | ✅ Running | **SINGLE ENTRY POINT** |
| Others | - | ❌ Down | Should remain closed |

---

## Quick Start Commands

```bash
# Kill zombie ports
pwsh ops/kill-ports.ps1

# Check only port 3000 is open
pwsh ops/ports-check.ps1

# Run smoke tests
pwsh ops/smoke-prod.ps1

# Start server
cd portal-global
npm start
```

---

## Community Mode (Default)

When `COMMUNITY_MODE=1`:
- Guests can: view landing, login, access /api/health
- Guests cannot: write to API, access /app
- Autopilot: DISABLED by default
- Rate limiting: ENABLED

### Allowed Public Paths
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/feedback`

### Blocked for Guests
- All write operations (POST/PUT/PATCH/DELETE) without admin role
- `/api/autopilot/*` (always disabled in community mode)

---

## Production Checklist

- [x] Only port 3000 listening
- [x] Rate limiting enabled
- [x] Body size limit (200kb)
- [x] Trust proxy enabled
- [x] HTTPS redirect (production)
- [x] Community mode guards active
- [x] Request logging with requestId
- [x] Smoke tests pass

---

## Environment Variables

See `.env.example` for full configuration.

### Required for Production
```
NODE_ENV=production
COMMUNITY_MODE=1
AUTOPILOT_ENABLED=0
DEMO_ORIGIN=https://your-domain.com
TRUST_PROXY=1
RATE_LIMIT_ENABLED=1
```

---

## Health Endpoint

```
GET /api/health
```

Response:
```json
{
  "ok": true,
  "ts": "2026-02-28T22:00:00.000Z",
  "uptime": 3600,
  "env": "production",
  "mode": {
    "community": true,
    "autopilot": false,
    "rateLimit": true
  },
  "db": {
    "ok": true,
    "latencyMs": 5
  }
}
```

---

## Proxy Configuration

See `docs/proxy-examples/` for:
- Caddyfile
- Nginx config

---

## Future: Next.js Static Build

Not implemented yet. When ready:
1. `cd web-next && npm run build` (with `output: "export"`)
2. Copy `out/` to `backend/public/app/`
3. Express will serve at `/app/*`

---

## Smoke Test Results

```
pwsh ops/smoke-prod.ps1

Expected:
- / -> 200
- /login -> 200
- /app -> 302 (redirect to login)
- /api/health -> 200
- /api/anything -> 401
```

Topics: production, ports, community, checklist, health
People: none
Decision type: runbook
Status: active
