# Multi-tenant model (plan)

## Minimal approach
- Every business/workspace is a tenant: `tenantId`
- Every record that belongs to a tenant has `tenantId`
- Middleware extracts tenantId from token/session and attaches to req.ctx

## Separation you described
- Admin/team tenant data: separate tenant(s) or separate tables
- Client tenant data: isolated by tenantId
- Admin can "impersonate/help" via explicit permission + audit log
