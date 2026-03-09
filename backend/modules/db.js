const ensureBusinessSchema = async ({ dbRun, dbAll, ensureColumn }) => {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      owner_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS service_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      last_seen_at TEXT,
      machine_json TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger TEXT NOT NULL,
      config_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS usage_counters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      metric TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_id, period, metric),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT,
      decided_by_user_id INTEGER,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (decided_by_user_id) REFERENCES users(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      name TEXT NOT NULL,
      secret_hash TEXT,
      target_url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      events_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT,
      token_hash TEXT NOT NULL,
      expires_at INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      filename TEXT,
      stats_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await ensureColumn('workspaces', 'plan', "TEXT NOT NULL DEFAULT 'free'");
  await ensureColumn('workspaces', 'owner_user_id', 'INTEGER');
  await ensureColumn('workspace_members', 'role', "TEXT NOT NULL DEFAULT 'member'");
  await ensureColumn('workspace_members', 'deleted_at', 'TEXT');

  await ensureColumn('audit_logs', 'workspace_id', 'INTEGER');
  await ensureColumn('audit_logs', 'actor_user_id', 'INTEGER');
  await ensureColumn('audit_logs', 'actor_type', "TEXT NOT NULL DEFAULT 'user'");
  await ensureColumn('audit_logs', 'ip', 'TEXT');
  await ensureColumn('audit_logs', 'ua', 'TEXT');

  const workspaceTables = ['projects', 'leads', 'clients', 'providers', 'orders'];
  for (const table of workspaceTables) {
    await ensureColumn(table, 'workspace_id', 'INTEGER');
    await ensureColumn(table, 'deleted_at', 'TEXT');
  }

  await dbRun('CREATE INDEX IF NOT EXISTS idx_usage_counters_workspace_period ON usage_counters(workspace_id, period)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_service_keys_workspace ON service_keys(workspace_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_tokens_workspace ON agent_tokens(workspace_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_automations_workspace ON automations(workspace_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_approvals_workspace ON approvals(workspace_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhooks(workspace_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_share_links_workspace ON share_links(workspace_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_imports_workspace ON imports(workspace_id)');

  const workspacePlanRows = await dbAll('SELECT id, plan FROM workspaces');
  for (const row of workspacePlanRows) {
    if (!row.plan) {
      await dbRun('UPDATE workspaces SET plan = ? WHERE id = ?', ['free', row.id]);
    }
  }

  await dbRun(`
    UPDATE workspaces
    SET owner_user_id = (
      SELECT user_id
      FROM workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.deleted_at IS NULL
        AND wm.role IN ('owner', 'admin')
      ORDER BY wm.id ASC
      LIMIT 1
    )
    WHERE owner_user_id IS NULL
  `);
};

const backfillWorkspaceIds = async ({ dbRun, dbAll, dbGet }) => {
  const tables = [
    { table: 'projects', ownerColumn: 'owner_id' },
    { table: 'clients', ownerColumn: 'owner_id' },
    { table: 'providers', ownerColumn: 'owner_id' },
    { table: 'orders', ownerColumn: 'owner_id' },
    { table: 'leads', ownerColumn: 'owner_id', fallbackColumn: 'created_by' }
  ];

  for (const entry of tables) {
    await dbRun(
      `UPDATE ${entry.table}
       SET workspace_id = COALESCE(workspace_id, tenant_id)
       WHERE workspace_id IS NULL`
    );

    const rows = await dbAll(
      `SELECT id, tenant_id, ${entry.ownerColumn} as owner_id${entry.fallbackColumn ? `, ${entry.fallbackColumn} as fallback_id` : ''}
       FROM ${entry.table}
       WHERE workspace_id IS NULL`
    );

    for (const row of rows) {
      const userId = row.owner_id || row.fallback_id;
      if (!userId) continue;
      const userRow = await dbGet('SELECT active_tenant_id FROM users WHERE id = ?', [userId]);
      const workspaceId = userRow?.active_tenant_id;
      if (!workspaceId) continue;
      await dbRun(
        `UPDATE ${entry.table}
         SET workspace_id = ?
         WHERE id = ? AND workspace_id IS NULL`,
        [workspaceId, row.id]
      );
    }
  }
};

module.exports = {
  ensureBusinessSchema,
  backfillWorkspaceIds
};
