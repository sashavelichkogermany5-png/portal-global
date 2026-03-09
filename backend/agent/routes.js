const express = require('express');

const createAgentRouter = ({
    dbAll,
    dbRun,
    sendOk,
    sendError,
    nowUnix,
    logAudit,
    authorizeServiceKey,
    authorizeAgentToken,
    createAgentToken,
    ensureBusinessWorkspace
}) => {
    const router = express.Router();

    router.post('/register', async (req, res) => {
        try {
            const keyContext = await authorizeServiceKey(req);
            if (!keyContext) {
                return sendError(res, 401, 'Unauthorized', 'Invalid service key');
            }
            const workspaceId = keyContext.workspaceId;
            const plan = await ensureBusinessWorkspace(workspaceId, res);
            if (!plan) return;

            const payload = req.body || {};
            const name = String(payload.name || payload.agentName || payload.hostname || 'Local Agent').trim();
            const machineJson = payload.machine || payload.machineInfo || {};
            const agentToken = await createAgentToken({
                workspaceId,
                name,
                machine: machineJson,
                createdByUserId: keyContext.createdByUserId
            });

            await logAudit({
                tenantId: workspaceId,
                userId: keyContext.createdByUserId,
                actorType: 'api_key',
                actorUserId: keyContext.createdByUserId,
                action: 'register',
                entity: 'agent',
                entityId: agentToken.id,
                meta: {
                    name,
                    keyId: keyContext.keyId,
                    machine: machineJson
                }
            });

            return sendOk(res, {
                agentToken: agentToken.token,
                agentId: agentToken.id,
                workspaceId,
                workspaceName: keyContext.workspaceName || null
            });
        } catch (error) {
            console.error('Agent register error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to register agent');
        }
    });

    router.post('/heartbeat', async (req, res) => {
        try {
            const agentContext = await authorizeAgentToken(req);
            if (!agentContext) {
                return sendError(res, 401, 'Unauthorized', 'Invalid agent token');
            }
            const now = nowUnix();
            await dbRun(
                'UPDATE agent_tokens SET last_seen_at = ?, machine_json = COALESCE(machine_json, ?) WHERE id = ?',
                [now, agentContext.machineJson || null, agentContext.agentId]
            );
            return sendOk(res, { ok: true, lastSeenAt: now });
        } catch (error) {
            console.error('Agent heartbeat error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to update heartbeat');
        }
    });

    router.get('/jobs', async (req, res) => {
        try {
            const agentContext = await authorizeAgentToken(req);
            if (!agentContext) {
                return sendError(res, 401, 'Unauthorized', 'Invalid agent token');
            }
            const plan = await ensureBusinessWorkspace(agentContext.workspaceId, res);
            if (!plan) return;

            const now = nowUnix();
            await dbRun('UPDATE agent_tokens SET last_seen_at = ? WHERE id = ?', [now, agentContext.agentId]);

            const rows = await dbAll(
                `SELECT id, name, enabled, trigger, config_json, last_run_at, updated_at
                 FROM automations
                 WHERE workspace_id = ? AND enabled = 1
                 ORDER BY created_at DESC`,
                [String(agentContext.workspaceId)]
            );

            const jobs = rows
                .map((row) => {
                    let config = null;
                    try {
                        config = row.config_json ? JSON.parse(row.config_json) : null;
                    } catch (error) {
                        config = null;
                    }
                    const intervalSec = Number(config?.interval_sec || config?.intervalSec || 60);
                    const lastRun = Number(row.last_run_at || 0);
                    const due = !lastRun || now - lastRun >= Math.max(intervalSec, 30);
                    return {
                        id: row.id,
                        name: row.name,
                        trigger: row.trigger || 'interval',
                        config: config || {},
                        due
                    };
                })
                .filter((job) => job.due)
                .map((job) => ({
                    jobId: `${job.id}:${now}`,
                    automationId: job.id,
                    name: job.name,
                    trigger: job.trigger,
                    config: job.config
                }));

            return sendOk(res, { jobs });
        } catch (error) {
            console.error('Agent jobs error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to load jobs');
        }
    });

    router.post('/job-result', async (req, res) => {
        try {
            const agentContext = await authorizeAgentToken(req);
            if (!agentContext) {
                return sendError(res, 401, 'Unauthorized', 'Invalid agent token');
            }
            const plan = await ensureBusinessWorkspace(agentContext.workspaceId, res);
            if (!plan) return;

            const payload = req.body || {};
            const automationId = String(payload.automationId || payload.automation_id || '').trim();
            if (!automationId) {
                return sendError(res, 400, 'Invalid input', 'automationId is required');
            }
            const status = String(payload.status || 'ok').trim();
            const output = payload.output || payload.result || null;
            const now = nowUnix();

            await dbRun(
                'UPDATE automations SET last_run_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
                [now, now, automationId, String(agentContext.workspaceId)]
            );
            await dbRun('UPDATE agent_tokens SET last_seen_at = ? WHERE id = ?', [now, agentContext.agentId]);

            await logAudit({
                tenantId: agentContext.workspaceId,
                userId: agentContext.ownerUserId,
                actorType: 'agent',
                actorUserId: agentContext.ownerUserId,
                action: 'run',
                entity: 'automation',
                entityId: automationId,
                meta: {
                    status,
                    output,
                    agentId: agentContext.agentId
                }
            });

            return sendOk(res, { automationId, status });
        } catch (error) {
            console.error('Agent job result error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to record job result');
        }
    });

    router.get('/status', async (req, res) => {
        try {
            const agentContext = await authorizeAgentToken(req);
            if (!agentContext) {
                return sendError(res, 401, 'Unauthorized', 'Invalid agent token');
            }
            const plan = await ensureBusinessWorkspace(agentContext.workspaceId, res);
            if (!plan) return;
            const rows = await dbAll(
                `SELECT id, name, last_seen_at, created_at, revoked_at, machine_json
                 FROM agent_tokens
                 WHERE workspace_id = ? AND revoked_at IS NULL
                 ORDER BY created_at DESC`,
                [String(agentContext.workspaceId)]
            );
            const agents = rows.map((row) => ({
                id: row.id,
                name: row.name,
                lastSeenAt: row.last_seen_at,
                createdAt: row.created_at,
                machine: row.machine_json ? JSON.parse(row.machine_json) : null
            }));
            return sendOk(res, { agents });
        } catch (error) {
            console.error('Agent status error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to load agent status');
        }
    });

    return router;
};

module.exports = { createAgentRouter };
