const crypto = require('crypto');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const maskToken = (token) => {
  if (!token) return '';
  const raw = String(token);
  if (raw.length <= 8) return `${raw.slice(0, 2)}****${raw.slice(-2)}`;
  return `${raw.slice(0, 6)}****${raw.slice(-4)}`;
};

const generateToken = (prefix) => {
  const random = crypto.randomBytes(24).toString('hex');
  return `${prefix}_${random}`;
};

const createApiKeyResolver = ({ dbGet, dbRun }) => {
  const resolveApiKey = async (token) => {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = await dbGet(
      'SELECT id, workspace_id, name, key_hash, revoked_at FROM api_keys WHERE key_hash = ? LIMIT 1',
      [tokenHash]
    );
    if (!row || row.revoked_at) return null;
    await dbRun('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?', [row.id]);
    return row;
  };

  return { resolveApiKey };
};

const createKeysRouter = ({
  dbRun,
  dbAll,
  sendOk,
  sendError,
  requireWorkspaceRole,
  requireBusinessPlan,
  logAudit
}) => {
  const router = require('express').Router();
  const requireAdmin = requireWorkspaceRole('admin');

  const createKey = async ({ workspaceId, name, table, prefix, actor }) => {
    const token = generateToken(prefix);
    const tokenHash = hashToken(token);
    const result = await dbRun(
      `INSERT INTO ${table} (workspace_id, name, key_hash, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [workspaceId, name, tokenHash]
    );
    await logAudit({
      userId: actor.userId,
      workspaceId,
      actorType: actor.actorType || 'user',
      action: 'create',
      entity: table,
      entityId: result.id
    });
    return { id: result.id, token };
  };

  const listKeys = async ({ workspaceId, table }) => {
    const rows = await dbAll(
      `SELECT id, name, key_hash, last_used_at, created_at, revoked_at
       FROM ${table}
       WHERE workspace_id = ?
       ORDER BY created_at DESC`,
      [workspaceId]
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      masked: maskToken(row.key_hash),
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at
    }));
  };

  const revokeKey = async ({ workspaceId, table, id, actor }) => {
    await dbRun(
      `UPDATE ${table} SET revoked_at = datetime('now') WHERE id = ? AND workspace_id = ?`,
      [id, workspaceId]
    );
    await logAudit({
      userId: actor.userId,
      workspaceId,
      actorType: actor.actorType || 'user',
      action: 'revoke',
      entity: table,
      entityId: id
    });
  };

  router.post('/api', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const name = String(req.body?.name || 'API Key').trim();
      const result = await createKey({
        workspaceId: req.tenantId,
        name,
        table: 'api_keys',
        prefix: 'pg_api',
        actor: { userId: req.user.id, actorType: 'user' }
      });
      return sendOk(res, { id: result.id, key: result.token });
    } catch (error) {
      console.error('API key create error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to create API key');
    }
  });

  router.get('/api', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const rows = await listKeys({ workspaceId: req.tenantId, table: 'api_keys' });
      return sendOk(res, rows);
    } catch (error) {
      console.error('API key list error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to list API keys');
    }
  });

  router.post('/api/revoke', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.body?.id);
      if (!id) return sendError(res, 400, 'Invalid input', 'Key id required');
      await revokeKey({ workspaceId: req.tenantId, table: 'api_keys', id, actor: { userId: req.user.id } });
      return sendOk(res, { id });
    } catch (error) {
      console.error('API key revoke error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to revoke API key');
    }
  });

  router.post('/service', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const name = String(req.body?.name || 'Service Key').trim();
      const result = await createKey({
        workspaceId: req.tenantId,
        name,
        table: 'service_keys',
        prefix: 'pg_svc',
        actor: { userId: req.user.id, actorType: 'user' }
      });
      return sendOk(res, { id: result.id, key: result.token });
    } catch (error) {
      console.error('Service key create error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to create service key');
    }
  });

  router.get('/service', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const rows = await listKeys({ workspaceId: req.tenantId, table: 'service_keys' });
      return sendOk(res, rows);
    } catch (error) {
      console.error('Service key list error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to list service keys');
    }
  });

  router.post('/service/revoke', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.body?.id);
      if (!id) return sendError(res, 400, 'Invalid input', 'Key id required');
      await revokeKey({ workspaceId: req.tenantId, table: 'service_keys', id, actor: { userId: req.user.id } });
      return sendOk(res, { id });
    } catch (error) {
      console.error('Service key revoke error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to revoke service key');
    }
  });

  return router;
};

module.exports = {
  createKeysRouter,
  createApiKeyResolver,
  hashToken,
  maskToken
};
