const crypto = require('crypto');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const createShareRouter = ({
  dbAll,
  dbGet,
  dbRun,
  sendOk,
  sendError,
  requireWorkspaceRole,
  requireBusinessPlan,
  logAudit
}) => {
  const router = require('express').Router();
  const requireAdmin = requireWorkspaceRole('admin');

  router.get('/', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const rows = await dbAll(
        `SELECT id, type, entity_id, expires_at, created_at, revoked_at
         FROM share_links
         WHERE workspace_id = ?
         ORDER BY id DESC`,
        [req.tenantId]
      );
      const data = rows.map((row) => ({
        id: row.id,
        type: row.type,
        entityId: row.entity_id,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        revokedAt: row.revoked_at
      }));
      return sendOk(res, data);
    } catch (error) {
      console.error('Share links list error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load share links');
    }
  });

  router.post('/create', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const type = String(req.body?.type || '').trim().toLowerCase();
      const entityId = req.body?.entity_id || req.body?.entityId || null;
      const expiresDays = Number(req.body?.expires_days || req.body?.expiresDays || 7);
      if (!['report', 'dashboard', 'projects'].includes(type)) {
        return sendError(res, 400, 'Invalid input', 'Invalid share type');
      }
      const token = `sh_${crypto.randomBytes(24).toString('hex')}`;
      const tokenHash = hashToken(token);
      const expiresAt = Number.isFinite(expiresDays) && expiresDays > 0
        ? Date.now() + expiresDays * 24 * 60 * 60 * 1000
        : null;
      const result = await dbRun(
        `INSERT INTO share_links (workspace_id, type, entity_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [req.tenantId, type, entityId, tokenHash, expiresAt]
      );
      await logAudit({
        workspaceId: req.tenantId,
        actorType: 'user',
        actorUserId: req.user.id,
        action: 'create',
        entity: 'share_link',
        entityId: result.id,
        meta: { type }
      });
      return sendOk(res, { id: result.id, token, url: `/s/${token}` });
    } catch (error) {
      console.error('Share link create error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to create share link');
    }
  });

  router.post('/revoke', requireBusinessPlan, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.body?.id);
      if (!id) return sendError(res, 400, 'Invalid input', 'Id required');
      await dbRun(
        `UPDATE share_links SET revoked_at = datetime('now') WHERE id = ? AND workspace_id = ?`,
        [id, req.tenantId]
      );
      await logAudit({
        workspaceId: req.tenantId,
        actorType: 'user',
        actorUserId: req.user.id,
        action: 'revoke',
        entity: 'share_link',
        entityId: id
      });
      return sendOk(res, { id });
    } catch (error) {
      console.error('Share link revoke error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to revoke share link');
    }
  });

  return router;
};

const createShareHandler = ({ dbGet, dbAll }) => async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(404).send('Not found');
    const tokenHash = hashToken(token);
    const row = await dbGet(
      `SELECT workspace_id, type, entity_id, expires_at, revoked_at
       FROM share_links
       WHERE token_hash = ?`,
      [tokenHash]
    );
    if (!row || row.revoked_at) return res.status(404).send('Not found');
    if (row.expires_at && Number(row.expires_at) < Date.now()) {
      return res.status(410).send('Link expired');
    }

    const stats = await dbGet(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE tenant_id = ? AND deleted_at IS NULL) as projects,
         (SELECT COUNT(*) FROM leads WHERE tenant_id = ? AND deleted_at IS NULL) as leads,
         (SELECT COUNT(*) FROM orders WHERE tenant_id = ? AND deleted_at IS NULL) as orders`,
      [row.workspace_id, row.workspace_id, row.workspace_id]
    );
    const projects = await dbAll(
      `SELECT id, name, status, progress, due
       FROM projects
       WHERE tenant_id = ? AND deleted_at IS NULL
       ORDER BY id DESC
       LIMIT 50`,
      [row.workspace_id]
    );

    const titleMap = {
      dashboard: 'Shared Dashboard',
      report: 'Shared Report',
      projects: 'Shared Projects'
    };
    const title = titleMap[row.type] || 'Shared View';
    const projectRows = row.type === 'projects'
      ? projects.map((item) => `<tr><td>${item.name}</td><td>${item.status}</td><td>${item.progress}%</td><td>${item.due || '-'}</td></tr>`).join('')
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: "Space Grotesk", Arial, sans-serif; background: #0b1112; color: #f3f7f5; margin: 0; padding: 32px; }
    .card { background: #121c1f; border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 20px; margin-bottom: 16px; }
    h1 { margin-bottom: 8px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .stat { background: #0f171a; border-radius: 12px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>Read-only snapshot generated by PORTAL Global.</p>
  </div>
  <div class="card">
    <div class="stats">
      <div class="stat"><strong>Projects</strong><div>${stats?.projects || 0}</div></div>
      <div class="stat"><strong>Leads</strong><div>${stats?.leads || 0}</div></div>
      <div class="stat"><strong>Orders</strong><div>${stats?.orders || 0}</div></div>
    </div>
  </div>
  ${row.type === 'projects' ? `<div class="card"><h2>Projects</h2><table><thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead><tbody>${projectRows}</tbody></table></div>` : ''}
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (error) {
    console.error('Share view error:', error);
    return res.status(500).send('Failed to render share view');
  }
};

module.exports = {
  createShareRouter,
  createShareHandler
};
