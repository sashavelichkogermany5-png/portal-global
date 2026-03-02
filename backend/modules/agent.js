const crypto = require('crypto');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const extractToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return String(match[1] || '').trim();
  }
  const direct = req.headers['x-agent-token'] || req.headers['x-portal-agent-token'];
  if (direct) return String(direct).trim();
  return null;
};

const extractServiceKey = (req) => {
  const header = req.headers['x-portal-service-key'] || req.headers['x-service-key'];
  if (header) return String(header).trim();
  const auth = req.headers.authorization || req.headers.Authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return String(match[1] || '').trim();
  }
  const bodyKey = req.body?.service_key || req.body?.serviceKey || null;
  return bodyKey ? String(bodyKey).trim() : null;
};

const createAgentRouter = ({
  dbGet,
  dbAll,
  dbRun,
  sendOk,
  sendError,
  safeJsonStringify,
  logAudit
}) => {
  const express = require('express');
  const publicRouter = express.Router();
  const agentRouter = express.Router();

  const resolveAgent = async (token) => {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = await dbGet(
      `SELECT id, workspace_id, name, revoked_at, machine_json
       FROM agent_tokens
       WHERE token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    if (!row || row.revoked_at) return null;
    return row;
  };

  const requireAgent = async (req, res, next) => {
    const token = extractToken(req);
    const agent = await resolveAgent(token);
    if (!agent) return sendError(res, 401, 'Unauthorized', 'Agent token required');
    req.agent = agent;
    req.workspaceId = agent.workspace_id;
    req.tenantId = agent.workspace_id;
    return next();
  };

  const requireAgentOptional = async (req, res, next) => {
    const token = extractToken(req);
    if (!token) return next();
    const agent = await resolveAgent(token);
    if (!agent) return sendError(res, 401, 'Unauthorized', 'Invalid agent token');
    req.agent = agent;
    req.workspaceId = agent.workspace_id;
    req.tenantId = agent.workspace_id;
    return next();
  };

  publicRouter.post('/enroll', async (req, res) => {
    try {
      const serviceKey = extractServiceKey(req);
      if (!serviceKey) return sendError(res, 401, 'Unauthorized', 'Service key required');
      const serviceHash = hashToken(serviceKey);
      const serviceRow = await dbGet(
        `SELECT id, workspace_id, revoked_at
         FROM service_keys
         WHERE key_hash = ? LIMIT 1`,
        [serviceHash]
      );
      if (!serviceRow || serviceRow.revoked_at) {
        return sendError(res, 401, 'Unauthorized', 'Invalid service key');
      }

      const workspace = await dbGet('SELECT plan FROM workspaces WHERE id = ?', [serviceRow.workspace_id]);
      if (!workspace || String(workspace.plan || 'free').toLowerCase() !== 'business') {
        return sendError(res, 403, 'Forbidden', 'Business plan required');
      }

      const machine = req.body?.machine && typeof req.body.machine === 'object' ? req.body.machine : {};
      const name = String(req.body?.name || machine.hostname || 'Local Agent').trim();
      const token = `agt_${crypto.randomBytes(24).toString('hex')}`;
      const tokenHash = hashToken(token);

      const result = await dbRun(
        `INSERT INTO agent_tokens (workspace_id, name, token_hash, machine_json, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [serviceRow.workspace_id, name, tokenHash, safeJsonStringify(machine)]
      );

      await logAudit({
        workspaceId: serviceRow.workspace_id,
        actorType: 'api_key',
        action: 'enroll',
        entity: 'agent',
        entityId: result.id,
        meta: { name }
      });

      return sendOk(res, { token, agentId: result.id, workspaceId: serviceRow.workspace_id });
    } catch (error) {
      console.error('Agent enroll error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to enroll agent');
    }
  });

  agentRouter.post('/heartbeat', requireAgent, async (req, res) => {
    try {
      const machine = req.body?.machine && typeof req.body.machine === 'object' ? req.body.machine : {};
      await dbRun(
        `UPDATE agent_tokens
         SET last_seen_at = datetime('now'), machine_json = ?
         WHERE id = ?`,
        [safeJsonStringify(machine), req.agent.id]
      );
      await logAudit({
        workspaceId: req.workspaceId,
        actorType: 'agent',
        action: 'heartbeat',
        entity: 'agent',
        entityId: req.agent.id,
        meta: { name: req.agent.name }
      });
      return sendOk(res, { ok: true, agentId: req.agent.id });
    } catch (error) {
      console.error('Agent heartbeat error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to record heartbeat');
    }
  });

  agentRouter.get('/jobs', requireAgent, async (req, res) => {
    try {
      const rows = await dbAll(
        `SELECT id, action_type, payload_json, created_at
         FROM agent_actions
         WHERE tenant_id = ? AND status = 'pending' AND action_type = 'local_job'
         ORDER BY id ASC
         LIMIT 20`,
        [req.workspaceId]
      );
      const jobs = rows.map((row) => ({
        id: row.id,
        type: row.action_type,
        payload: row.payload_json ? JSON.parse(row.payload_json) : {},
        createdAt: row.created_at
      }));
      return sendOk(res, jobs);
    } catch (error) {
      console.error('Agent jobs error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load jobs');
    }
  });

  agentRouter.post('/job-result', requireAgent, async (req, res) => {
    try {
      const id = Number(req.body?.id);
      const status = String(req.body?.status || 'complete').trim();
      const resultPayload = req.body?.result || {};
      if (!id) return sendError(res, 400, 'Invalid input', 'Job id required');
      await dbRun(
        `UPDATE agent_actions
         SET status = ?, result_json = ?, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?`,
        [status, safeJsonStringify(resultPayload), id, req.workspaceId]
      );
      await logAudit({
        workspaceId: req.workspaceId,
        actorType: 'agent',
        action: 'job_result',
        entity: 'agent_job',
        entityId: id,
        meta: { status }
      });
      return sendOk(res, { id, status });
    } catch (error) {
      console.error('Agent job result error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to record job result');
    }
  });

  agentRouter.post('/events', requireAgentOptional, async (req, res, next) => {
    if (!req.agent) return next();
    try {
      const payload = req.body || {};
      await dbRun(
        `INSERT INTO agent_events (tenant_id, user_id, event_type, source, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [req.workspaceId, req.agent.id, String(payload.type || 'agent.event'), 'local_agent', safeJsonStringify(payload)]
      );
      await logAudit({
        workspaceId: req.workspaceId,
        actorType: 'agent',
        action: 'event',
        entity: 'agent_event',
        entityId: req.agent.id
      });
      return sendOk(res, { ok: true });
    } catch (error) {
      console.error('Agent event error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to record agent event');
    }
  });

  return { publicRouter, agentRouter, requireAgentOptional };
};

module.exports = {
  createAgentRouter,
  extractToken,
  extractServiceKey,
  hashToken
};
