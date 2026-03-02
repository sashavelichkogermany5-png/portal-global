const crypto = require('crypto');

const hashSecret = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const timingSafeEqual = (left, right) => {
  if (!left || !right) return false;
  const leftBuf = Buffer.from(String(left));
  const rightBuf = Buffer.from(String(right));
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
};

const parseEvents = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((event) => String(event).trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((event) => String(event).trim()).filter(Boolean);
    } catch (error) {
      return value.split(',').map((event) => event.trim()).filter(Boolean);
    }
  }
  return [];
};

const createWebhookDispatcher = ({ dbAll, safeJsonParse, logAudit }) => {
  const sendWebhook = async (url, payload) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.ok;
  };

  const dispatchOutbound = async ({ workspaceId, event, payload }) => {
    if (!workspaceId || !event) return [];
    const rows = await dbAll(
      `SELECT id, name, target_url, events_json
       FROM webhooks
       WHERE workspace_id = ? AND direction = 'out' AND enabled = 1`,
      [workspaceId]
    );
    const results = [];
    for (const row of rows) {
      const events = parseEvents(row.events_json || '[]');
      if (events.length && !events.includes(event)) continue;
      let ok = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          ok = await sendWebhook(row.target_url, { event, data: payload, attempt });
          if (ok) break;
        } catch (error) {
          ok = false;
        }
      }
      await logAudit({
        workspaceId,
        actorType: 'api_key',
        action: ok ? 'deliver' : 'deliver_failed',
        entity: 'webhook',
        entityId: row.id,
        meta: { event, targetUrl: row.target_url }
      });
      results.push({ id: row.id, ok });
    }
    return results;
  };

  return { dispatchOutbound };
};

const createWebhooksRouter = ({
  dbAll,
  dbGet,
  dbRun,
  safeJsonParse,
  safeJsonStringify,
  sendOk,
  sendError,
  requireWorkspaceRole,
  requireBusinessPlan,
  logAudit,
  emitEvent
}) => {
  const express = require('express');
  const router = express.Router();
  const publicRouter = express.Router();
  const requireAdmin = requireWorkspaceRole('admin');

  router.get('/', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const rows = await dbAll(
        `SELECT id, direction, name, target_url, enabled, events_json, created_at, updated_at
         FROM webhooks
         WHERE workspace_id = ?
         ORDER BY id DESC`,
        [req.tenantId]
      );
      const data = rows.map((row) => ({
        id: row.id,
        direction: row.direction,
        name: row.name,
        targetUrl: row.target_url,
        enabled: Boolean(row.enabled),
        events: parseEvents(row.events_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        endpoint: row.direction === 'in' ? `/api/webhooks/in/${row.id}` : null
      }));
      return sendOk(res, data);
    } catch (error) {
      console.error('Webhooks list error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load webhooks');
    }
  });

  router.post('/', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const direction = String(req.body?.direction || 'out').trim().toLowerCase();
      const name = String(req.body?.name || 'Webhook').trim();
      const targetUrl = req.body?.target_url || req.body?.targetUrl || null;
      const events = parseEvents(req.body?.events || req.body?.events_json || []);
      if (!['in', 'out'].includes(direction)) {
        return sendError(res, 400, 'Invalid input', 'Direction must be in or out');
      }
      if (direction === 'out' && !targetUrl) {
        return sendError(res, 400, 'Invalid input', 'Target URL required');
      }
      const secret = direction === 'in' ? `whk_${crypto.randomBytes(18).toString('hex')}` : null;
      const secretHash = secret ? hashSecret(secret) : null;
      const result = await dbRun(
        `INSERT INTO webhooks (workspace_id, direction, name, secret_hash, target_url, enabled, events_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [req.tenantId, direction, name, secretHash, targetUrl, 1, safeJsonStringify(events)]
      );
      await logAudit({
        workspaceId: req.tenantId,
        actorType: 'user',
        actorUserId: req.user.id,
        action: 'create',
        entity: 'webhook',
        entityId: result.id,
        meta: { direction }
      });
      return sendOk(res, {
        id: result.id,
        secret,
        endpoint: direction === 'in' ? `/api/webhooks/in/${result.id}` : null
      });
    } catch (error) {
      console.error('Webhooks create error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to create webhook');
    }
  });

  router.post('/:id/toggle', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const enabled = req.body?.enabled === undefined ? null : req.body.enabled;
      if (!id || enabled === null) {
        return sendError(res, 400, 'Invalid input', 'Id and enabled required');
      }
      await dbRun(
        `UPDATE webhooks SET enabled = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`,
        [enabled ? 1 : 0, id, req.tenantId]
      );
      await logAudit({
        workspaceId: req.tenantId,
        actorType: 'user',
        actorUserId: req.user.id,
        action: enabled ? 'enable' : 'disable',
        entity: 'webhook',
        entityId: id
      });
      return sendOk(res, { id, enabled: Boolean(enabled) });
    } catch (error) {
      console.error('Webhooks toggle error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to update webhook');
    }
  });

  publicRouter.post('/in/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const secretHeader = req.headers['x-portal-secret'] || req.headers['x-portal-secret'.toLowerCase()];
      const providedSecret = secretHeader ? String(secretHeader).trim() : '';
      if (!id || !providedSecret) {
        return sendError(res, 401, 'Unauthorized', 'Secret required');
      }
      const row = await dbGet(
        `SELECT id, workspace_id, secret_hash, enabled
         FROM webhooks
         WHERE id = ? AND direction = 'in'`,
        [id]
      );
      if (!row || !row.enabled) return sendError(res, 404, 'Not Found', 'Webhook not found');
      if (!timingSafeEqual(row.secret_hash, hashSecret(providedSecret))) {
        return sendError(res, 401, 'Unauthorized', 'Invalid secret');
      }
      await logAudit({
        workspaceId: row.workspace_id,
        actorType: 'api_key',
        action: 'trigger',
        entity: 'webhook',
        entityId: row.id
      });
      if (typeof emitEvent === 'function') {
        await emitEvent({
          workspaceId: row.workspace_id,
          event: 'webhook.in',
          payload: { entity: { type: 'webhook', id }, data: req.body || {} },
          actor: { actorType: 'api_key' }
        });
      }
      return sendOk(res, { ok: true });
    } catch (error) {
      console.error('Webhook inbound error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to process webhook');
    }
  });

  return { router, publicRouter };
};

module.exports = {
  createWebhooksRouter,
  createWebhookDispatcher,
  hashSecret,
  timingSafeEqual
};
