const PLAN_DEFINITIONS = [
    {
        code: 'free',
        name: 'Free',
        priceMonth: 0,
        limits: {
            maxProjects: 3,
            maxClients: null,
            maxProviders: null,
            maxOrders: null,
            maxLeads: null,
            maxOrdersPerMonth: 50,
            maxLeadsPerMonth: 50,
            maxAiCallsPerMonth: 20,
            maxExportsPerMonth: 5,
            maxAutopilotPerMonth: 20,
            maxWorkspaces: 1
        }
    },
    {
        code: 'pro',
        name: 'Pro',
        priceMonth: 49,
        limits: {
            maxProjects: null,
            maxClients: null,
            maxProviders: null,
            maxOrders: null,
            maxLeads: null,
            maxOrdersPerMonth: 500,
            maxLeadsPerMonth: 500,
            maxAiCallsPerMonth: 300,
            maxExportsPerMonth: 50,
            maxAutopilotPerMonth: 300,
            maxWorkspaces: 1
        }
    },
    {
        code: 'business',
        name: 'Business',
        priceMonth: 149,
        limits: {
            maxProjects: null,
            maxClients: null,
            maxProviders: null,
            maxOrders: null,
            maxLeads: null,
            maxOrdersPerMonth: null,
            maxLeadsPerMonth: null,
            maxAiCallsPerMonth: null,
            maxExportsPerMonth: null,
            maxAutopilotPerMonth: null,
            maxWorkspaces: 10,
            flags: {
                audit_exports: true,
                workspace_governance: true,
                api_keys: true,
                local_agent: true
            }
        }
    }
];

const METRIC_LIMIT_KEYS = {
    leads: 'maxLeadsPerMonth',
    orders: 'maxOrdersPerMonth',
    ai_calls: 'maxAiCallsPerMonth',
    exports: 'maxExportsPerMonth',
    autopilot: 'maxAutopilotPerMonth',
    server_autopilot: 'maxAutopilotPerMonth',
    workspaces: 'maxWorkspaces'
};

const getPeriodKey = (date = new Date()) => {
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    return `${year}-${month}`;
};

const resolveMetricLimitKey = (metric) => METRIC_LIMIT_KEYS[metric] || null;

const upsertUsageCounter = async ({ dbRun, workspaceId, period, metric, cost, updatedAt }) => {
    const safeWorkspaceId = workspaceId ? String(workspaceId) : null;
    await dbRun(
        `INSERT INTO usage_counters (workspace_id, period, metric, count, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, period, metric)
         DO UPDATE SET count = count + excluded.count, updated_at = excluded.updated_at`,
        [
            safeWorkspaceId,
            period,
            metric,
            cost,
            updatedAt
        ]
    );
};

const getUsageCount = async ({ dbGet, workspaceId, period, metric }) => {
    const row = await dbGet(
        'SELECT count FROM usage_counters WHERE workspace_id = ? AND period = ? AND metric = ? LIMIT 1',
        [workspaceId ? String(workspaceId) : null, period, metric]
    );
    return row?.count || 0;
};

const getUsageSnapshot = async ({ dbAll, workspaceId, period }) => {
    const rows = await dbAll(
        'SELECT metric, count FROM usage_counters WHERE workspace_id = ? AND period = ?',
        [workspaceId ? String(workspaceId) : null, period]
    );
    return rows.reduce((acc, row) => {
        acc[row.metric] = row.count || 0;
        return acc;
    }, {});
};

const resolveUpgradeTarget = (planCode) => {
    const normalized = String(planCode || '').trim().toLowerCase();
    if (normalized === 'free') return 'pro';
    if (normalized === 'pro') return 'business';
    return null;
};

const buildUpgradePayload = ({ planCode, metric, limit, used }) => ({
    plan: planCode,
    metric,
    limit,
    used,
    upgrade: resolveUpgradeTarget(planCode)
});

module.exports = {
    PLAN_DEFINITIONS,
    METRIC_LIMIT_KEYS,
    getPeriodKey,
    resolveMetricLimitKey,
    upsertUsageCounter,
    getUsageCount,
    getUsageSnapshot,
    buildUpgradePayload,
    resolveUpgradeTarget
};
