const PLAN_DEFINITIONS = [
  {
    code: 'free',
    name: 'Free',
    priceMonth: 0,
    limits: {
      active_projects: 3,
      leads: 50,
      orders: 50,
      ai_calls: 20,
      exports: 5,
      server_autopilot: 20,
      maxWorkspaces: 1
    }
  },
  {
    code: 'pro',
    name: 'Pro',
    priceMonth: 49,
    limits: {
      active_projects: null,
      leads: 500,
      orders: 500,
      ai_calls: 300,
      exports: 50,
      server_autopilot: 300,
      maxWorkspaces: 1
    }
  },
  {
    code: 'business',
    name: 'Business',
    priceMonth: 149,
    limits: {
      active_projects: null,
      leads: null,
      orders: null,
      ai_calls: null,
      exports: null,
      server_autopilot: null,
      maxWorkspaces: 10,
      flags: {
        audit_exports: true,
        local_agent: true,
        api_keys: true
      }
    }
  }
];

const normalizePlanCode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['free', 'pro', 'business'].includes(normalized)) return normalized;
  return 'free';
};

const resolveUpgradeTarget = (planCode) => {
  const normalized = normalizePlanCode(planCode);
  if (normalized === 'free') return 'pro';
  if (normalized === 'pro') return 'business';
  return null;
};

const getPeriodKey = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const toLimitValue = (limit) => {
  if (limit === null || limit === undefined) return null;
  const numeric = Number(limit);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
};

const createPlanHelpers = ({ dbGet, dbAll, dbRun }) => {
  const getPlanLimit = (plan, metric) => {
    const rawLimit = plan?.limits?.[metric];
    return toLimitValue(rawLimit);
  };

  const getUsageCounters = async ({ workspaceId, period = getPeriodKey() }) => {
    if (!workspaceId) return {};
    const rows = await dbAll(
      'SELECT metric, count FROM usage_counters WHERE workspace_id = ? AND period = ?',
      [workspaceId, period]
    );
    return rows.reduce((acc, row) => {
      acc[row.metric] = row.count;
      return acc;
    }, {});
  };

  const incrementUsage = async ({ workspaceId, metric, cost = 1, period = getPeriodKey() }) => {
    if (!workspaceId || !metric) return 0;
    const delta = Number.isFinite(cost) ? Math.max(1, Math.floor(cost)) : 1;
    await dbRun(
      `INSERT INTO usage_counters (workspace_id, period, metric, count, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(workspace_id, period, metric)
       DO UPDATE SET count = count + ?, updated_at = datetime('now')`,
      [workspaceId, period, metric, delta, delta]
    );
    const row = await dbGet(
      'SELECT count FROM usage_counters WHERE workspace_id = ? AND period = ? AND metric = ?',
      [workspaceId, period, metric]
    );
    return row?.count || 0;
  };

  const requirePlanMetric = async (req, res, { metric, cost = 1 }) => {
    const plan = req.plan || {};
    const planCode = normalizePlanCode(plan.code || 'free');
    const workspaceId = req.tenantId || req.workspaceId;
    const limit = getPlanLimit(plan, metric);
    if (!limit) {
      await incrementUsage({ workspaceId, metric, cost });
      return true;
    }
    const counters = await getUsageCounters({ workspaceId });
    const used = counters[metric] || 0;
    if (used + cost > limit) {
      res.status(403).json({
        error: 'Limit reached',
        code: 'LIMIT_REACHED',
        plan: planCode,
        metric,
        used,
        limit,
        upgrade: resolveUpgradeTarget(planCode)
      });
      return false;
    }
    await incrementUsage({ workspaceId, metric, cost });
    return true;
  };

  const requireProjectSlots = async (req, res) => {
    const plan = req.plan || {};
    const planCode = normalizePlanCode(plan.code || 'free');
    const limit = getPlanLimit(plan, 'active_projects');
    if (!limit) return true;
    const row = await dbGet(
      'SELECT COUNT(*) as count FROM projects WHERE tenant_id = ? AND deleted_at IS NULL',
      [req.tenantId]
    );
    const used = row?.count || 0;
    if (used >= limit) {
      res.status(403).json({
        error: 'Limit reached',
        code: 'LIMIT_REACHED',
        plan: planCode,
        metric: 'active_projects',
        used,
        limit,
        upgrade: resolveUpgradeTarget(planCode)
      });
      return false;
    }
    return true;
  };

  return {
    getPlanLimit,
    getUsageCounters,
    incrementUsage,
    requirePlanMetric,
    requireProjectSlots,
    getPeriodKey
  };
};

module.exports = {
  PLAN_DEFINITIONS,
  normalizePlanCode,
  resolveUpgradeTarget,
  createPlanHelpers
};
