# Autopilot Revenue Engine

Autopilot runs a deterministic revenue pipeline and writes every step to `agent_messages`.
It is safe by default: no irreversible actions run without explicit approval.

## Feature flags
```
AUTOPILOT_ENABLED=false
AUTOPILOT_INTERVAL_MIN=60
AUTOPILOT_MODE=local
AUTOPILOT_SERVICE_TOKEN=change-me-long-random-string
PAYMENT_MODE=mock
STRIPE_SECRET_KEY=
PAYPAL_CLIENT_ID=
PAYPAL_SECRET=
```

## Endpoints
- `POST /api/autopilot/enable`
- `GET /api/autopilot/status`
- `POST /api/autopilot/tick`
- `GET /api/autopilot/offers`
- `POST /api/autopilot/offers`
- `GET /api/autopilot/leads`
- `POST /api/autopilot/leads/capture`
- `GET /api/autopilot/metrics`

## Service-token fallback (no session)
Service-token auth is a fallback only for `POST /api/autopilot/enable` and `POST /api/autopilot/tick` when no valid session exists.
- Primary header: `x-service-token`
- Alternate header: `Authorization: Bearer <token>` (only for these two endpoints)
- Tenant: `x-tenant-id` header or body `tenantId`
Service-token attempts are recorded in `agent_messages` with correlation id `svc-<ts>`.

Set `AUTOPILOT_SERVICE_TOKEN`:
```bash
export AUTOPILOT_SERVICE_TOKEN="change-me-long-random-string"
```
```powershell
$env:AUTOPILOT_SERVICE_TOKEN = "change-me-long-random-string"
```

## Smoke tests (PowerShell)
Login first:
```powershell
curl.exe -X POST "http://localhost:3000/api/auth/login" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"demo@local\",\"password\":\"demo12345\"}" `
  -c .cookies.txt
```

Enable autopilot:
```powershell
curl.exe -X POST "http://localhost:3000/api/autopilot/enable" `
  -H "Content-Type: application/json" `
  -d "{\"enabled\":true}" `
  -b .cookies.txt
```

Run one cycle:
```powershell
curl.exe -X POST "http://localhost:3000/api/autopilot/tick" `
  -H "Content-Type: application/json" `
  -d "{}" `
  -b .cookies.txt
```

Service-token access (no session):
```powershell
curl.exe -X POST "http://localhost:3000/api/autopilot/enable" `
  -H "Content-Type: application/json" `
  -H "x-service-token: <AUTOPILOT_SERVICE_TOKEN>" `
  -H "x-tenant-id: 1" `
  -d "{\"enabled\":true}"

curl.exe -X POST "http://localhost:3000/api/autopilot/tick" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <AUTOPILOT_SERVICE_TOKEN>" `
  -H "x-tenant-id: 1" `
  -d "{}"
```

Fetch offers, leads, metrics:
```powershell
curl.exe "http://localhost:3000/api/autopilot/offers" -b .cookies.txt
curl.exe "http://localhost:3000/api/autopilot/leads" -b .cookies.txt
curl.exe "http://localhost:3000/api/autopilot/metrics" -b .cookies.txt
```
