const createAuditLogger = ({ dbRun, nowUnix, safeJsonStringify }) => {
    const logAudit = async ({
        tenantId,
        workspaceId,
        userId,
        actorType,
        actorUserId,
        action,
        entity,
        entityId,
        meta,
        ip,
        ua
    }) => {
        if (!entity || !action || !entityId) return;
        const resolvedUserId = actorUserId || userId;
        const resolvedWorkspaceId = workspaceId || tenantId || null;
        if (!resolvedUserId) return;
        const metaJson = meta ? safeJsonStringify(meta, '{}') : null;
        const createdAtUnix = nowUnix();

        await dbRun(
            `INSERT INTO audit_logs
                (tenant_id, workspace_id, user_id, actor_type, actor_user_id, action, entity, entity_id, meta_json, ip, ua, created_at, created_at_unix)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
            ,
            [
                tenantId || null,
                resolvedWorkspaceId,
                resolvedUserId,
                actorType || 'user',
                actorUserId || resolvedUserId,
                String(action),
                String(entity),
                String(entityId),
                metaJson,
                ip || null,
                ua || null,
                createdAtUnix
            ]
        );
    };

    return { logAudit };
};

module.exports = {
    createAuditLogger
};
