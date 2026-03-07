# PORTAL GLOBAL — Architecture (current)

## Runtime
- Backend: Node.js server at project root (`server.js`)
- Web UI: `web-next` (dev port 3001)
- Backend port: 3000

## Auth (current)
- Session token stored in SQLite `sessions`
- Cookie: `SESSION_COOKIE_NAME` (default `portal_session`)
- Bearer or `X-Access-Token` also accepted

## Users / Roles (high level)
- Admin/Team (operators): manage platform + help client tenants
- Client tenant users: their own workspace (tenant-scoped)
- Staff: optional role between admin and client

## Key rule
All data must be tenant-scoped:
- tenantId comes from auth/session (not from request body)

Topics: architecture, auth, roles, tenant
People: none
Decision type: reference
Status: active
