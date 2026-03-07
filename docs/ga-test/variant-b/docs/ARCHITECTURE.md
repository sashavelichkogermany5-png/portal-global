# Short summary
- Runtime: backend server.js, web-next, ports 3000/3001.
- Auth: session token in SQLite; cookie name; bearer accepted.
- Roles overview (admin/team, client tenant users, staff).
- Key rule: tenantId comes from auth/session only.
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
