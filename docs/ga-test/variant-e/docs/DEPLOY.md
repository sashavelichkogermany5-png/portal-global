Main topic: Deployment
Related topics: production runbook, env vars, health check, cors
Parent MOC: docs/PROJECT-STATE.md
# DEPLOY

## Environment variables

Backend:
- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=3000`
- `DATABASE_PATH` (default `database/portal.db`)
- `ALLOWED_ORIGINS=https://<web-domain>` (comma-separated if multiple)
- `SESSION_COOKIE_NAME` (optional)
- `SESSION_TTL_DAYS` (optional)
- `DEFAULT_CURRENCY` (optional)

Bootstrap admin:
- `BOOTSTRAP_ADMIN_EMAIL=admin@local`
- `BOOTSTRAP_ADMIN_PASSWORD=<strong-password>`
- `BOOTSTRAP_TENANT_SLUG=default`

Admin demo autofill:
- `ADMIN_AUTOFILL_ENABLED=true|false`
- `ADMIN_AUTOFILL_MODE=minimal|full`
- `ADMIN_TENANT_ID` (optional override)
- `ADMIN_TENANT_SLUG` (optional override)

Web:
- `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>`

## Start backend
```powershell
npm install
set NODE_ENV=production
npm run start:prod
```

## Start web (Next.js)
```powershell
cd web-next
npm install
npm run build
npm run start -- --port 3001
```

## Health check
```powershell
npm run health
```

## Notes
- CORS is controlled by `ALLOWED_ORIGINS` and allows credentials.
- In production, cookies are issued as `SameSite=None; Secure` to support cross-domain login.
- Demo data is created only in the admin tenant and is tagged `demo/autofill` for safe removal.
