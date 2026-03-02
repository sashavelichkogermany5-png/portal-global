const crypto = require('crypto');

const resolveFieldValue = (payload, field) => {
    if (!field) return undefined;
    const parts = String(field).split('.');
    let current = payload;
    for (const part of parts) {
        if (current && Object.prototype.hasOwnProperty.call(current, part)) {
            current = current[part];
        } else {
            return undefined;
        }
    }
    return current;
};

const evaluateCondition = (payload, condition = {}) => {
    if (!condition || !condition.field || !condition.operator) return true;
    const value = resolveFieldValue(payload, condition.field);
    const target = condition.value;
    const operator = String(condition.operator || '').toLowerCase();
    if (operator === 'contains') {
        return String(value || '').includes(String(target || ''));
    }
    const numericValue = Number(value);
    const numericTarget = Number(target);
    if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
        if (!Number.isFinite(numericValue) || !Number.isFinite(numericTarget)) return false;
    }
    switch (operator) {
        case 'eq':
            return String(value) === String(target);
        case 'neq':
            return String(value) !== String(target);
        case 'gt':
            return numericValue > numericTarget;
        case 'gte':
            return numericValue >= numericTarget;
        case 'lt':
            return numericValue < numericTarget;
        case 'lte':
            return numericValue <= numericTarget;
        default:
            return false;
    }
};

const createRulesEngine = ({
    dbAll,
    dbGet,
    dbRun,
    safeJsonParse,
    safeJsonStringify,
    logAudit
}) => {
    const runRules = async ({ workspaceId, event, payload, actor }) => {
        if (!workspaceId || !event) return [];
        const rows = await dbAll(
            `SELECT id, name, trigger, config_json
             FROM automations
             WHERE workspace_id = ? AND enabled = 1 AND trigger = ?
             ORDER BY id ASC`,
            [workspaceId, event]
        );
        const actionsTaken = [];
        for (const row of rows) {
            const config = safeJsonParse(row.config_json, {}) || {};
            const condition = config.condition || {};
            if (!evaluateCondition(payload, condition)) continue;
            const action = config.action || {};
            const actionType = String(action.type || '').trim().toLowerCase();
            if (!actionType) continue;

            if (actionType === 'require_approval') {
                const entity = payload?.entity?.type || payload?.entityType || null;
                const entityId = payload?.entity?.id || payload?.entityId || null;
                const result = await dbRun(
                    `INSERT INTO approvals
                     (workspace_id, type, status, entity, entity_id, payload_json, created_at)
                     VALUES (?, ?, 'pending', ?, ?, ?, datetime('now'))`,
                    [
                        workspaceId,
                        String(action.approvalType || 'rule'),
                        entity,
                        entityId,
                        safeJsonStringify({ event, payload, rule: row.name })
                    ]
                );
                await logAudit({
                    tenantId: workspaceId,
                    workspaceId,
                    actorType: actor?.actorType || 'user',
                    actorUserId: actor?.userId || null,
                    action: 'create',
                    entity: 'approval',
                    entityId: result.id,
                    meta: { rule: row.name, event }
                });
                actionsTaken.push({ id: row.id, action: 'require_approval', approvalId: result.id });
                continue;
            }

            if (actionType === 'tag') {
                const tag = String(action.tag || '').trim();
                const entityId = payload?.entity?.id || payload?.entityId || null;
                if (tag && payload?.entity?.type === 'lead' && entityId) {
                    const leadRow = await dbGet(
                        'SELECT tags_json FROM leads WHERE id = ? AND tenant_id = ? LIMIT 1',
                        [entityId, workspaceId]
                    );
                    const existingTags = safeJsonParse(leadRow?.tags_json, []) || [];
                    const nextTags = Array.from(new Set([...(existingTags || []), tag]));
                    await dbRun(
                        'UPDATE leads SET tags_json = ?, updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?',
                        [safeJsonStringify(nextTags, '[]'), entityId, workspaceId]
                    );
                    await logAudit({
                        tenantId: workspaceId,
                        workspaceId,
                        actorType: actor?.actorType || 'user',
                        actorUserId: actor?.userId || null,
                        action: 'tag',
                        entity: 'lead',
                        entityId,
                        meta: { tag }
                    });
                    actionsTaken.push({ id: row.id, action: 'tag', tag });
                }
                continue;
            }

            if (actionType === 'enqueue_job') {
                const job = action.job && typeof action.job === 'object'
                    ? action.job
                    : { type: 'httpPing', url: action.url };
                const actorUserId = actor?.userId || actor?.ownerUserId || null;
                if (!actorUserId) continue;
                const result = await dbRun(
                    `INSERT INTO agent_actions
                     (tenant_id, user_id, agent_key, action_type, mode, status, payload_json, updated_at)
                     VALUES (?, ?, ?, 'local_job', 'execute', 'pending', ?, datetime('now'))`,
                    [workspaceId, actorUserId, 'LocalAgent', safeJsonStringify(job)]
                );
                await logAudit({
                    tenantId: workspaceId,
                    workspaceId,
                    actorType: actor?.actorType || 'user',
                    actorUserId,
                    action: 'enqueue_job',
                    entity: 'agent_job',
                    entityId: result.id,
                    meta: { jobType: job.type }
                });
                actionsTaken.push({ id: row.id, action: 'enqueue_job', jobId: result.id });
            }
        }
        return actionsTaken;
    };

    return { runRules };
};

const createApprovalsRouter = ({
    dbAll,
    dbRun,
    safeJsonParse,
    sendOk,
    sendError,
    requireRole,
    requireBusinessPlan,
    logAudit
}) => {
    const router = require('express').Router();

    router.get('/', requireBusinessPlan, requireRole('viewer'), async (req, res) => {
        try {
            const status = String(req.query.status || 'pending').trim().toLowerCase();
            const rows = await dbAll(
                `SELECT id, type, status, entity, entity_id, payload_json, created_at, decided_at, decided_by_user_id
                 FROM approvals
                 WHERE workspace_id = ? AND status = ?
                 ORDER BY created_at DESC
                 LIMIT 100`,
                [req.tenantId, status]
            );
            const data = rows.map((row) => ({
                id: row.id,
                type: row.type,
                status: row.status,
                entity: row.entity,
                entityId: row.entity_id,
                payload: safeJsonParse(row.payload_json, null),
                createdAt: row.created_at,
                decidedAt: row.decided_at,
                decidedByUserId: row.decided_by_user_id
            }));
            return sendOk(res, data);
        } catch (error) {
            console.error('Approvals list error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to load approvals');
        }
    });

    router.post('/decide', requireBusinessPlan, requireRole('admin'), async (req, res) => {
        try {
            const id = Number(req.body?.id);
            const decision = String(req.body?.decision || '').trim().toLowerCase();
            const note = String(req.body?.note || '').trim();
            if (!id || !['approve', 'reject'].includes(decision)) {
                return sendError(res, 400, 'Invalid input', 'Approval id and decision are required');
            }
            await dbRun(
                `UPDATE approvals
                 SET status = ?, decided_at = datetime('now'), decided_by_user_id = ?
                 WHERE id = ? AND workspace_id = ?`,
                [decision, req.user.id, id, req.tenantId]
            );
            await logAudit({
                tenantId: req.tenantId,
                workspaceId: req.tenantId,
                actorType: 'user',
                actorUserId: req.user.id,
                action: decision,
                entity: 'approval',
                entityId: id,
                meta: note ? { note } : null
            });
            return sendOk(res, { id, decision });
        } catch (error) {
            console.error('Approvals decide error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to update approval');
        }
    });

    return router;
};

const createAutomationsRouter = ({
    dbAll,
    dbRun,
    safeJsonParse,
    safeJsonStringify,
    sendOk,
    sendError,
    requireRole,
    requireBusinessPlan,
    logAudit
}) => {
    const router = require('express').Router();

    router.get('/', requireBusinessPlan, requireRole('admin'), async (req, res) => {
        try {
            const rows = await dbAll(
                `SELECT id, name, enabled, trigger, config_json, created_at, updated_at
                 FROM automations
                 WHERE workspace_id = ?
                 ORDER BY created_at DESC`,
                [req.tenantId]
            );
            const data = rows.map((row) => ({
                id: row.id,
                name: row.name,
                enabled: Boolean(row.enabled),
                trigger: row.trigger,
                config: safeJsonParse(row.config_json, {}),
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }));
            return sendOk(res, data);
        } catch (error) {
            console.error('Automations list error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to load automations');
        }
    });

    router.post('/', requireBusinessPlan, requireRole('admin'), async (req, res) => {
        try {
            const name = String(req.body?.name || 'Rule').trim();
            const trigger = String(req.body?.trigger || req.body?.event || '').trim();
            if (!trigger) return sendError(res, 400, 'Invalid input', 'Trigger is required');
            const config = req.body?.config && typeof req.body.config === 'object'
                ? req.body.config
                : { event: trigger, condition: req.body?.condition || {}, action: req.body?.action || {} };
            const id = crypto.randomUUID();
            await dbRun(
                `INSERT INTO automations (id, workspace_id, name, enabled, trigger, config_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, req.tenantId, name, 1, trigger, safeJsonStringify(config), Date.now(), Date.now()]
            );
            await logAudit({
                tenantId: req.tenantId,
                workspaceId: req.tenantId,
                actorType: 'user',
                actorUserId: req.user.id,
                action: 'create',
                entity: 'automation',
                entityId: id
            });
            return sendOk(res, { id });
        } catch (error) {
            console.error('Automations create error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to create automation');
        }
    });

    router.post('/:id/toggle', requireBusinessPlan, requireRole('admin'), async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const enabled = req.body?.enabled === undefined ? null : req.body.enabled;
            if (!id || enabled === null) {
                return sendError(res, 400, 'Invalid input', 'Id and enabled required');
            }
            await dbRun(
                `UPDATE automations
                 SET enabled = ?, updated_at = ?
                 WHERE id = ? AND workspace_id = ?`,
                [enabled ? 1 : 0, Date.now(), id, req.tenantId]
            );
            await logAudit({
                tenantId: req.tenantId,
                workspaceId: req.tenantId,
                actorType: 'user',
                actorUserId: req.user.id,
                action: enabled ? 'enable' : 'disable',
                entity: 'automation',
                entityId: id
            });
            return sendOk(res, { id, enabled: Boolean(enabled) });
        } catch (error) {
            console.error('Automations toggle error:', error);
            return sendError(res, 500, 'Internal server error', 'Failed to update automation');
        }
    });

    return router;
};

module.exports = {
    createRulesEngine,
    createApprovalsRouter,
    createAutomationsRouter
};
