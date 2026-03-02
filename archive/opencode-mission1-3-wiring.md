# OPENCODE Mission 1-3 wiring (archived)

The following lines were appended to `server.js` after `module.exports` and referenced missing modules
(`routes/auth`, `middleware/tenant`, `routes/tenants`, `routes/admin`). They prevented the backend
from starting under Node when treated as ESM/CommonJS mixed code. They were removed to restore
backend startup.

```js
// OPENCODE:MISSION1-3-WIRING
app.use('/api', tenantMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tenants', tenantsRoutes);
```
