const createAuditLogger = ({ dbRun, safeJsonStringify }) => {
  const logAudit = async ({
    userId,
    workspaceId,
    tenantId,
    actorUserId,
    actorType,
    action,
    entity,
    entityId,
    meta,
    ip,
    ua
  }) => {
    const resolvedWorkspaceId = workspaceId || tenantId || null;
    const resolvedActorUserId = actorUserId || userId || null;
    if (!action || !entity || entityId === undefined || entityId === null) return;
    const metaJson = meta ? safeJsonStringify(meta, '{}') : null;
    await dbRun(
      `INSERT INTO audit_logs
       (tenant_id, workspace_id, user_id, actor_user_id, actor_type, action, entity, entity_id, meta_json, ip, ua, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        resolvedWorkspaceId,
        resolvedWorkspaceId,
        resolvedActorUserId,
        resolvedActorUserId,
        String(actorType || 'user'),
        String(action),
        String(entity),
        String(entityId),
        metaJson,
        ip || null,
        ua || null
      ]
    );
  };

  return { logAudit };
};

module.exports = {
  createAuditLogger
};
