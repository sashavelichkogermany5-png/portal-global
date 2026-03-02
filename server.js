const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Server } = require('socket.io');
const { createDbHelpers, nowUnix } = require('./backend/lib/db');
const { createAuditLogger } = require('./backend/lib/audit');
const {
    buildKey,
    createSalt,
    hashSecret,
    parseKey,
    verifySecret,
    timingSafeEqualString
} = require('./backend/lib/keys');
const {
    normalizeTenantRole,
    hasMinimumRole,
    isAdminRole,
    isOwnerRole,
    isMemberRole
} = require('./backend/lib/rbac');
const {
    PLAN_DEFINITIONS,
    getPeriodKey,
    resolveMetricLimitKey,
    upsertUsageCounter,
    getUsageCount,
    getUsageSnapshot,
    buildUpgradePayload
} = require('./backend/lib/plan');
const { createAgentRouter } = require('./backend/agent/routes');
const { runCrewEngine } = require('./backend/lib/crewaiClient');
const { createAutopilotStorage } = require('./backend/autopilot/storage');
const { createAutopilotEngine } = require('./backend/autopilot/engine');
const { createAutopilotRouter } = require('./backend/autopilot/routes');
const { createIntakeRouter } = require('./backend/intake/routes');
const intakeStorage = require('./backend/intake/storage');
const localRunnerStorage = require('./backend/local-runner/storage');
const { computePricing, pricingConfig } = require('./backend/local-runner/pricing');
const { createLocalRunnerEngine } = require('./backend/local-runner/engine');
const { createLocalRunnerRouter } = require('./backend/local-runner/routes');
const metricsStorage = require('./backend/metrics/storage');
const { communityGuard, errorHandler, requestLogger } = require('./backend/middleware/community');

const loadEnv = () => {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [key, ...rest] = trimmed.split('=');
        if (!key) return;
        const value = rest.join('=').trim();
        if (process.env[key] === undefined) {
            process.env[key] = value.replace(/^"|"$/g, '');
        }
    });
};

loadEnv();

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', process.env.TRUST_PROXY || 1);

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'portal_session';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);
const SESSION_TTL_SAFE_DAYS = Number.isFinite(SESSION_TTL_DAYS) && SESSION_TTL_DAYS > 0
    ? SESSION_TTL_DAYS
    : 7;
const SESSION_TTL_MS = SESSION_TTL_SAFE_DAYS * 24 * 60 * 60 * 1000;
const COOKIE_SAMESITE = isProd ? 'none' : 'lax';
const DEFAULT_CURRENCY = String(process.env.DEFAULT_CURRENCY || 'EUR').trim().toUpperCase();
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim();

const COMMUNITY_MODE = process.env.COMMUNITY_MODE === '1' || process.env.COMMUNITY_MODE === 'true';
const AUTOPILOT_ENABLED = process.env.AUTOPILOT_ENABLED === '1' || process.env.AUTOPILOT_ENABLED === 'true';
const EXTERNAL_LLM_ENABLED = process.env.EXTERNAL_LLM_ENABLED === '1' || process.env.EXTERNAL_LLM_ENABLED === 'true';
const POLLING_INTERVAL_MS = Number(process.env.POLLING_INTERVAL_MS || 5000);
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== '0' && process.env.RATE_LIMIT_ENABLED !== 'false';
const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS || 120000);
const AUTH_ME_TTL_MS = Number(process.env.AUTH_ME_TTL_MS || 120000);
const AUTH_CACHE_MAX_SIZE = Number(process.env.AUTH_CACHE_MAX_SIZE || 100);

const SOCKET_MAX_CONNECTIONS_PER_IP = Number(process.env.SOCKET_MAX_CONNECTIONS_PER_IP || 5);
const SOCKET_PING_TIMEOUT = Number(process.env.SOCKET_PING_TIMEOUT || 20000);
const SOCKET_PING_INTERVAL = Number(process.env.SOCKET_PING_INTERVAL || 25000);
const DEMO_ORIGIN = process.env.DEMO_ORIGIN || '*';
const AI_CALL_TIMEOUT_MS = Number(process.env.AI_CALL_TIMEOUT_MS || 30000);
const BODY_SIZE_LIMIT = process.env.BODY_SIZE_LIMIT || '512kb';
const FEEDBACK_RATE_LIMIT_MAX = Number(process.env.FEEDBACK_RATE_LIMIT_MAX || 5);

const DB_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(__dirname, 'database', 'portal.db');
if (DB_PATH !== ':memory:') {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
const db = new sqlite3.Database(DB_PATH);
const { dbRun, dbGet, dbAll } = createDbHelpers(db);

const authCache = new Map();
const authCacheInFlight = new Map();

const getAuthCache = (userId) => {
    if (!userId) return null;
    const entry = authCache.get(userId);
    if (entry && Date.now() - entry.timestamp < AUTH_CACHE_TTL_MS) {
        return entry.data;
    }
    authCache.delete(userId);
    return null;
};

const setAuthCache = (userId, data) => {
    if (!userId) return;
    if (authCache.size >= AUTH_CACHE_MAX_SIZE) {
        const oldestKey = authCache.keys().next().value;
        authCache.delete(oldestKey);
    }
    authCache.set(userId, { data, timestamp: Date.now() });
};

const getAuthInFlight = (userId) => {
    return authCacheInFlight.get(userId);
};

const setAuthInFlight = (userId, promise) => {
    authCacheInFlight.set(userId, promise);
    promise.finally(() => authCacheInFlight.delete(userId));
};

const AGENT_BUNDLE_DIR = path.join(__dirname, 'ops', 'agent');
const AGENT_BUNDLE_FILES = ['agent.js', 'install-agent.ps1', 'uninstall-agent.ps1'];

let userHasNameColumn = false;

const hasColumn = async (table, column) => {
    try {
        const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
        if (!tables.length) return false;
        const columns = await dbAll(`PRAGMA table_info(${table})`);
        return columns.some((col) => col.name === column);
    } catch (e) {
        return false;
    }
};

const loadUserColumnFlags = async () => {
    const columns = await dbAll('PRAGMA table_info(users)');
    userHasNameColumn = columns.some((col) => col.name === 'name');
};

const normalizeServices = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
        } catch (error) {
            return value.split(',').map((item) => item.trim()).filter(Boolean);
        }
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
};

const safeJsonStringify = (value, fallback = '{}') => {
    try {
        return JSON.stringify(value ?? {});
    } catch (error) {
        return fallback;
    }
};

const safeJsonParse = (value, fallback = null) => {
    if (!value || typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
};

const { logAudit } = createAuditLogger({
    dbRun,
    nowUnix,
    safeJsonStringify
});

const normalizeTags = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return Array.from(new Set(parsed.map((item) => String(item).trim()).filter(Boolean)));
            }
        } catch (error) {
            return Array.from(new Set(trimmed.split(',').map((item) => item.trim()).filter(Boolean)));
        }
        return Array.from(new Set(trimmed.split(',').map((item) => item.trim()).filter(Boolean)));
    }
    return [];
};

const parseTagsValue = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return normalizeTags(value);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return normalizeTags(parsed);
        } catch (error) {
            return normalizeTags(value);
        }
        return normalizeTags(value);
    }
    return [];
};

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const DEMO_TAGS = ['demo', 'autofill'];
const DEMO_TAGS_JSON = JSON.stringify(DEMO_TAGS);
const DEMO_TAGS_LABEL = DEMO_TAGS.join(',');

const resolveAdminTenantSlug = () => {
    const raw = String(process.env.BOOTSTRAP_TENANT_SLUG || process.env.ADMIN_TENANT_SLUG || 'default').trim();
    return raw || 'default';
};

const resolveBootstrapAdminEmail = () => normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@local');

const resolveBootstrapAdminPassword = () => {
    const raw = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '').trim();
    if (raw) return raw;
    return isProd ? '' : 'admin12345';
};

const resolveAutofillMode = () => {
    const mode = String(process.env.ADMIN_AUTOFILL_MODE || 'minimal').trim().toLowerCase();
    return mode === 'full' ? 'full' : 'minimal';
};

const toSafeString = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const parseLeadStatus = (value, fallback) => {
    if (value === null || value === undefined || String(value).trim() === '') {
        return fallback;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!LEAD_STATUSES.includes(normalized)) return null;
    return normalized;
};

const buildLeadPayload = (payload = {}) => {
    const name = toSafeString(payload.name);
    const company = toSafeString(payload.company);
    const email = normalizeEmail(payload.email);
    const phone = toSafeString(payload.phone);
    const contactRaw = toSafeString(payload.contact);
    const contact = contactRaw || email || phone;
    return {
        name,
        company,
        email,
        phone,
        contact,
        source: toSafeString(payload.source),
        notes: toSafeString(payload.notes)
    };
};

const hasLeadContact = (lead) => Boolean(lead.name || lead.company || lead.contact || lead.email || lead.phone);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const toNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const toBoolean = (value, fallback = false) => {
    if (value === undefined || value === null) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const normalizeCurrency = (value, fallback) => {
    const raw = String(value || fallback || '').trim().toUpperCase();
    if (!raw) return null;
    if (!/^[A-Z]{3}$/.test(raw)) return null;
    return raw;
};

const parseTenantId = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
};

const getRequestPath = (req) => {
    const raw = req.originalUrl || req.url || '';
    return raw.split('?')[0];
};

const getHeaderValue = (value) => (Array.isArray(value) ? value[0] : value);

const getBaseUrl = (req) => {
    const forwarded = getHeaderValue(req.headers['x-forwarded-proto']);
    const protocol = forwarded ? String(forwarded).split(',')[0] : req.protocol;
    return `${protocol}://${req.get('host')}`;
};

const getServiceTokenFromReq = (req) => {
    if (Object.prototype.hasOwnProperty.call(req.headers, 'x-service-token')) {
        const rawToken = getHeaderValue(req.headers['x-service-token']);
        return {
            token: String(rawToken || '').trim(),
            attempted: true,
            source: 'x-service-token'
        };
    }

    const authHeader = getHeaderValue(req.headers.authorization || req.headers.Authorization);
    if (typeof authHeader === 'string') {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match) {
            return {
                token: String(match[1] || '').trim(),
                attempted: true,
                source: 'authorization'
            };
        }
    }

    return { token: '', attempted: false, source: null };
};

const getPortalKeyFromReq = (req) => {
    if (Object.prototype.hasOwnProperty.call(req.headers, 'x-portal-key')) {
        const rawToken = getHeaderValue(req.headers['x-portal-key']);
        return {
            token: String(rawToken || '').trim(),
            attempted: true,
            source: 'x-portal-key'
        };
    }

    const authHeader = getHeaderValue(req.headers.authorization || req.headers.Authorization);
    if (typeof authHeader === 'string') {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match) {
            const candidate = String(match[1] || '').trim();
            if (parseKey(candidate)) {
                return {
                    token: candidate,
                    attempted: true,
                    source: 'authorization'
                };
            }
        }
    }

    return { token: '', attempted: false, source: null };
};

const resolveTenantId = (req) => {
    const headerTenantId = parseTenantId(getHeaderValue(req.headers['x-tenant-id']));
    if (headerTenantId) return headerTenantId;
    const bodyTenantId = parseTenantId(req.body?.tenantId || req.body?.tenant_id);
    return bodyTenantId;
};

const sendOk = (res, data) => res.json({ ok: true, data });
const sendError = (res, statusCode, error, message) => res.status(statusCode).json({ ok: false, error, message });

const isSuperadmin = (user) => Boolean(user?.isSuperadmin || user?.is_superadmin || user?.role === 'superadmin');

const getEnvList = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const SUPERADMIN_EMAILS = getEnvList(process.env.SUPERADMIN_EMAILS || '');

const isSuperadminEmail = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    return SUPERADMIN_EMAILS.includes(normalized);
};

const parsePagination = (query = {}) => {
    const pageRaw = Number(query.page || query.pageIndex || 1);
    const limitRaw = Number(query.limit || query.pageSize || DEFAULT_PAGE_SIZE);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(MAX_PAGE_SIZE, Math.floor(limitRaw))
        : DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;
    return { page, limit, offset };
};

const toSqlTimestamp = (date) => {
    if (!(date instanceof Date)) return null;
    return date.toISOString().replace('T', ' ').slice(0, 19);
};

const parseLimits = (value) => {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
        return {};
    }
    return {};
};

const parseCookies = (cookieHeader = '') => {
    if (!cookieHeader) return {};
    return cookieHeader.split(';').reduce((acc, pair) => {
        const [key, ...rest] = pair.trim().split('=');
        if (!key) return acc;
        acc[key] = decodeURIComponent(rest.join('=') || '');
        return acc;
    }, {});
};

const isLocalRequest = (req) => {
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1'
        || ip === '::1'
        || ip === '::ffff:127.0.0.1'
        || ip.endsWith('127.0.0.1');
};

const getSessionToken = (req) => {
    const cookies = parseCookies(req.headers.cookie || '');
    if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    const headerToken = req.headers['x-access-token'] || req.headers['x-auth-token'];
    if (headerToken) return String(headerToken).trim();
    return null;
};

const setSessionCookie = (res, token) => {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: COOKIE_SAMESITE,
        secure: isProd,
        maxAge: SESSION_TTL_MS,
        path: '/'
    });
};

const clearSessionCookie = (res) => {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        sameSite: COOKIE_SAMESITE,
        secure: isProd,
        path: '/'
    });
};

const createSession = async (userId) => {
    const token = crypto.randomBytes(32).toString('hex');
    await dbRun(
        `INSERT INTO sessions (user_id, token, expires_at)
         VALUES (?, ?, datetime('now', ?))`,
        [userId, token, `+${SESSION_TTL_SAFE_DAYS} days`]
    );
    return token;
};

const getSessionUser = async (token) => {
    if (!token) return null;
    return dbGet(
        `SELECT s.token, s.expires_at, u.id, u.email, u.role, u.is_superadmin, u.active_tenant_id, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > datetime('now')`,
        [token]
    );
};

const getPlanForUser = async (userId) => {
    const row = await dbGet(
        `SELECT s.plan_code, s.status, s.current_period_end, p.name, p.price_month, p.limits_json
         FROM subscriptions s
         LEFT JOIN plans p ON p.code = s.plan_code
         WHERE s.user_id = ? AND s.status = 'active'
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [userId]
    );
    if (row) {
        return {
            code: row.plan_code,
            name: row.name || row.plan_code,
            priceMonth: row.price_month,
            limits: parseLimits(row.limits_json),
            status: row.status,
            currentPeriodEnd: row.current_period_end
        };
    }
    const fallback = await dbGet('SELECT code, name, price_month, limits_json FROM plans WHERE code = ?', ['free']);
    if (!fallback) {
        return {
            code: 'free',
            name: 'Free',
            priceMonth: 0,
            limits: {
                maxProjects: 3,
                maxClients: 10,
                maxProviders: 10,
                maxOrders: 30,
                maxLeads: 100
            },
            status: 'active',
            currentPeriodEnd: null
        };
    }
    return {
        code: fallback.code,
        name: fallback.name,
        priceMonth: fallback.price_month,
        limits: parseLimits(fallback.limits_json),
        status: 'active',
        currentPeriodEnd: null
    };
};

const requireBusinessPlan = async (req, res) => {
    const plan = req.plan || (req.user?.id ? await getPlanForUser(req.user.id) : null);
    if (!plan || String(plan.code || '').toLowerCase() !== 'business') {
        sendError(res, 403, 'Forbidden', 'Business plan required');
        return null;
    }
    req.plan = plan;
    return plan;
};

const getPlanByCode = async (planCode) => {
    const normalized = String(planCode || '').trim().toLowerCase() || 'free';
    const row = await dbGet(
        'SELECT code, name, price_month, limits_json FROM plans WHERE code = ? LIMIT 1',
        [normalized]
    );
    if (row) {
        return {
            code: row.code,
            name: row.name || row.code,
            priceMonth: row.price_month,
            limits: parseLimits(row.limits_json),
            status: 'active',
            currentPeriodEnd: null
        };
    }
    return {
        code: 'free',
        name: 'Free',
        priceMonth: 0,
        limits: {},
        status: 'active',
        currentPeriodEnd: null
    };
};

const getPlanForTenant = async (tenantId, fallbackUserId) => {
    if (tenantId) {
        const tenantRow = await dbGet(
            'SELECT plan_code, owner_user_id FROM tenants WHERE id = ? LIMIT 1',
            [tenantId]
        );
        if (tenantRow?.plan_code) {
            return getPlanByCode(tenantRow.plan_code);
        }
        if (tenantRow?.owner_user_id) {
            return getPlanForUser(tenantRow.owner_user_id);
        }
    }
    if (fallbackUserId) {
        return getPlanForUser(fallbackUserId);
    }
    return getPlanByCode('free');
};

const getLimitValue = (plan, key) => {
    const rawLimit = plan?.limits?.[key];
    if (rawLimit === null || rawLimit === undefined) return null;
    const numericLimit = Number(rawLimit);
    if (!Number.isFinite(numericLimit) || numericLimit <= 0) return null;
    return numericLimit;
};

const getUsageForTenant = async (tenantId) => {
    if (!tenantId) {
        return {
            projects: 0,
            clients: 0,
            providers: 0,
            orders: 0,
            leads: 0
        };
    }

    const [projects, clients, providers, orders, leads] = await Promise.all([
        dbGet('SELECT COUNT(*) as count FROM projects WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId]),
        dbGet('SELECT COUNT(*) as count FROM clients WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId]),
        dbGet('SELECT COUNT(*) as count FROM providers WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId]),
        dbGet('SELECT COUNT(*) as count FROM orders WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId]),
        dbGet('SELECT COUNT(*) as count FROM leads WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId])
    ]);

    return {
        projects: projects?.count || 0,
        clients: clients?.count || 0,
        providers: providers?.count || 0,
        orders: orders?.count || 0,
        leads: leads?.count || 0
    };
};

const getOnboardingStatus = async (userId, tenantId) => {
    const effectiveTenantId = parseTenantId(tenantId);
    const [usage, aiProjectCount, userRow] = await Promise.all([
        getUsageForTenant(effectiveTenantId),
        effectiveTenantId
            ? dbGet("SELECT COUNT(*) as count FROM ai_requests WHERE user_id = ? AND tenant_id = ? AND type = ?", [userId, effectiveTenantId, 'ai-project'])
            : Promise.resolve({ count: 0 }),
        dbGet('SELECT onboarding_completed FROM users WHERE id = ?', [userId])
    ]);

    const steps = {
        projects: usage.projects > 0,
        leads: usage.leads > 0,
        clients: usage.clients > 0,
        providers: usage.providers > 0,
        orders: usage.orders > 0,
        aiProject: (aiProjectCount?.count || 0) > 0
    };
    const totalSteps = 6;
    const completedSteps = Object.values(steps).filter(Boolean).length;
    const completed = userRow?.onboarding_completed === 1;

    return {
        completed,
        steps,
        counts: usage,
        completedSteps,
        totalSteps
    };
};

const checkLimitOrReject = async (req, res, { key, table }) => {
    const limitValue = getLimitValue(req.plan, key);
    if (!limitValue) return true;

    const row = await dbGet(`SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = ? AND deleted_at IS NULL`, [req.tenantId]);
    const current = row?.count || 0;
    if (current >= limitValue) {
        rejectUpgrade(res, {
            planCode: req.plan?.code || 'free',
            metric: key,
            limit: limitValue,
            used: current
        });
        return false;
    }

    return true;
};

const rejectUpgrade = (res, { planCode, metric, limit, used }) => {
    const payload = buildUpgradePayload({
        planCode: planCode || 'free',
        metric,
        limit,
        used
    });
    return res.status(403).json({
        ok: false,
        error: 'Upgrade required',
        message: 'Upgrade required',
        plan_code: payload.plan,
        metric: payload.metric,
        limit: payload.limit,
        used: payload.used,
        upgrade_hint: payload.upgrade_hint
    });
};

const consumeUsage = async ({ tenantId, plan, metric, cost = 1 }) => {
    if (!tenantId || !metric) return { ok: true, used: 0, limit: null };
    const limitKey = resolveMetricLimitKey(metric);
    const limitValue = limitKey ? getLimitValue(plan, limitKey) : null;
    const period = getPeriodKey();
    const used = await getUsageCount({ dbGet, workspaceId: tenantId, period, metric });
    if (limitValue && used + cost > limitValue) {
        return { ok: false, used, limit: limitValue };
    }
    await upsertUsageCounter({
        dbRun,
        workspaceId: tenantId,
        period,
        metric,
        cost,
        updatedAt: nowUnix()
    });
    return { ok: true, used: used + cost, limit: limitValue };
};

const requirePlan = (metric, cost = 1) => async (req, res, next) => {
    try {
        const planCode = req.plan?.code || 'free';
        const result = await consumeUsage({ tenantId: req.tenantId, plan: req.plan, metric, cost });
        if (!result.ok) {
            return rejectUpgrade(res, { planCode, metric, limit: result.limit, used: result.used });
        }
        req.usage = {
            ...(req.usage || {}),
            [metric]: {
                used: result.used,
                limit: result.limit,
                period: getPeriodKey()
            }
        };
        return next();
    } catch (error) {
        console.error('Plan enforcement error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to enforce plan limits');
    }
};

const requireProjectSlots = async (req, res) => {
    const limitValue = getLimitValue(req.plan, 'maxProjects');
    if (!limitValue) return true;
    const row = await dbGet(
        'SELECT COUNT(*) as count FROM projects WHERE tenant_id = ? AND deleted_at IS NULL',
        [req.tenantId]
    );
    const current = row?.count || 0;
    if (current >= limitValue) {
        rejectUpgrade(res, {
            planCode: req.plan?.code || 'free',
            metric: 'active_projects',
            limit: limitValue,
            used: current
        });
        return false;
    }
    return true;
};

const requireWorkspaceSlots = async (req, res) => {
    const limitValue = getLimitValue(req.plan, 'maxWorkspaces');
    if (!limitValue) return true;
    const row = await dbGet(
        'SELECT COUNT(*) as count FROM tenants WHERE owner_user_id = ?',
        [req.user.id]
    );
    const current = row?.count || 0;
    if (current >= limitValue) {
        rejectUpgrade(res, {
            planCode: req.plan?.code || 'free',
            metric: 'workspaces',
            limit: limitValue,
            used: current
        });
        return false;
    }
    return true;
};

const requireBusinessPlanMiddleware = (req, res, next) => {
    if (req.plan?.code !== 'business') {
        return rejectUpgrade(res, {
            planCode: req.plan?.code || 'free',
            metric: 'business_feature',
            limit: null,
            used: null
        });
    }
    return next();
};

const queueEmail = async ({ to, subject, body, bodyHtml, bodyText, html, text, tenantId }) => {
    const toValue = String(to || '').trim();
    const subjectValue = String(subject || '').trim();
    const bodyValue = body === null || body === undefined ? null : String(body);
    const htmlValue = bodyHtml !== undefined && bodyHtml !== null
        ? String(bodyHtml)
        : (html === null || html === undefined ? null : String(html));
    const textValue = bodyText !== undefined && bodyText !== null
        ? String(bodyText)
        : (text === null || text === undefined
            ? (bodyValue ? String(bodyValue) : null)
            : String(text));
    if (!toValue || !subjectValue) return null;
    if (!((bodyValue || '').trim() || (htmlValue || '').trim() || (textValue || '').trim())) return null;
    const result = await dbRun(
        `INSERT INTO email_outbox (tenant_id, [to], subject, body, body_html, html, text, status, attempts, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, datetime('now'))`,
        [tenantId || null, toValue, subjectValue, bodyValue, htmlValue, htmlValue, textValue]
    );
    return result.id;
};

const toCsv = (rows, columns) => {
    const escapeValue = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes('"') || str.includes(',') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };
    const header = columns.join(',');
    const lines = rows.map((row) => columns.map((col) => escapeValue(row[col])).join(','));
    return [header, ...lines].join('\n');
};

const getMembershipsForUser = async (userId) => {
    if (!userId) return [];
    const rows = await dbAll(
        `SELECT tm.tenant_id, tm.role, tm.status, t.name
         FROM tenant_memberships tm
         JOIN tenants t ON t.id = tm.tenant_id
         WHERE tm.user_id = ? AND tm.status = 'active'
         ORDER BY t.name ASC`,
        [userId]
    );
    return rows.map((row) => ({
        tenantId: row.tenant_id,
        tenantName: row.name,
        role: normalizeTenantRole(row.role),
        status: row.status
    }));
};

const loadAuthContext = async (req) => {
    const token = getSessionToken(req);
    if (!token) return null;
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return null;
    const superadminFlag = Boolean(sessionUser.is_superadmin) || isSuperadminEmail(sessionUser.email);
    if (superadminFlag && !sessionUser.is_superadmin) {
        await dbRun('UPDATE users SET is_superadmin = 1 WHERE id = ?', [sessionUser.id]);
    }
    const memberships = await getMembershipsForUser(sessionUser.id);
    const headerTenantId = parseTenantId(req.headers['x-tenant-id']);
    const storedTenantId = parseTenantId(sessionUser.active_tenant_id);
    let activeTenantId = headerTenantId || storedTenantId || memberships[0]?.tenantId || null;
    let activeMembership = memberships.find((membership) => membership.tenantId === activeTenantId) || null;

    if (!activeMembership && superadminFlag && headerTenantId) {
        const tenantRow = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [headerTenantId]);
        if (tenantRow?.id) {
            activeTenantId = tenantRow.id;
            activeMembership = {
                tenantId: tenantRow.id,
                tenantName: tenantRow.name,
                role: 'admin',
                status: 'active'
            };
        }
    }

    if (activeTenantId && activeTenantId !== storedTenantId && activeMembership) {
        await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [activeTenantId, sessionUser.id]);
    }

    const activeRole = activeMembership?.role
        || (superadminFlag ? 'superadmin' : normalizeTenantRole(sessionUser.role || 'user'));

    const plan = await getPlanForTenant(activeTenantId, sessionUser.id);

    return {
        user: {
            id: sessionUser.id,
            email: sessionUser.email,
            role: activeRole,
            isSuperadmin: superadminFlag,
            is_superadmin: superadminFlag,
            createdAt: sessionUser.created_at
        },
        plan,
        token,
        memberships,
        activeTenantId,
        activeMembership
    };
};

const loadApiKeyContext = async (req) => {
    const { token, attempted } = getPortalKeyFromReq(req);
    if (!attempted || !token) return null;
    const parsed = parseKey(token);
    if (!parsed || parsed.type !== 'api') return null;

    const keyRow = await dbGet(
        `SELECT id, workspace_id, key_type, key_hash, key_salt, created_by_user_id, name, revoked_at
         FROM api_keys
         WHERE id = ? AND key_type = 'api' AND revoked_at IS NULL
         LIMIT 1`,
        [parsed.id]
    );
    if (!keyRow?.id) return null;
    if (!verifySecret({ secret: parsed.secret, salt: keyRow.key_salt, expectedHash: keyRow.key_hash })) {
        return null;
    }

    const userRow = await dbGet(
        'SELECT id, email, role, is_superadmin, created_at, active_tenant_id FROM users WHERE id = ? LIMIT 1',
        [keyRow.created_by_user_id]
    );
    if (!userRow?.id) return null;
    const tenantRow = await dbGet('SELECT id, name FROM tenants WHERE id = ? LIMIT 1', [keyRow.workspace_id]);
    if (!tenantRow?.id) return null;

    const membership = await dbGet(
        `SELECT role, status FROM tenant_memberships
         WHERE tenant_id = ? AND user_id = ? AND status = 'active'
         LIMIT 1`,
        [tenantRow.id, userRow.id]
    );
    const membershipRole = normalizeTenantRole(membership?.role || userRow.role || 'member');
    const plan = await getPlanForTenant(tenantRow.id, userRow.id);
    const now = nowUnix();
    await dbRun('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, keyRow.id]);

    return {
        user: {
            id: userRow.id,
            email: userRow.email,
            role: membershipRole,
            isSuperadmin: Boolean(userRow.is_superadmin),
            is_superadmin: Boolean(userRow.is_superadmin),
            createdAt: userRow.created_at
        },
        plan,
        token: null,
        memberships: [{
            tenantId: tenantRow.id,
            tenantName: tenantRow.name,
            role: membershipRole,
            status: membership?.status || 'active'
        }],
        activeTenantId: tenantRow.id,
        activeMembership: {
            tenantId: tenantRow.id,
            tenantName: tenantRow.name,
            role: membershipRole,
            status: membership?.status || 'active'
        },
        apiKey: keyRow,
        actorType: 'api_key'
    };
};

const authorizeServiceKey = async (req) => {
    const { token, attempted } = getPortalKeyFromReq(req);
    if (!attempted || !token) return null;
    const parsed = parseKey(token);
    if (!parsed || parsed.type !== 'srv') return null;
    const keyRow = await dbGet(
        `SELECT id, workspace_id, key_hash, key_salt, created_by_user_id, name, revoked_at
         FROM api_keys
         WHERE id = ? AND key_type = 'service' AND revoked_at IS NULL
         LIMIT 1`,
        [parsed.id]
    );
    if (!keyRow?.id) return null;
    if (!verifySecret({ secret: parsed.secret, salt: keyRow.key_salt, expectedHash: keyRow.key_hash })) {
        return null;
    }
    const tenantRow = await dbGet('SELECT id, name, owner_user_id FROM tenants WHERE id = ? LIMIT 1', [keyRow.workspace_id]);
    if (!tenantRow?.id) return null;
    return {
        keyId: keyRow.id,
        keyName: keyRow.name,
        workspaceId: tenantRow.id,
        workspaceName: tenantRow.name,
        createdByUserId: keyRow.created_by_user_id,
        ownerUserId: tenantRow.owner_user_id
    };
};

const authorizeAgentToken = async (req) => {
    const rawToken = getHeaderValue(req.headers['x-portal-agent']) || null;
    const bearer = getHeaderValue(req.headers.authorization || req.headers.Authorization);
    const token = String(rawToken || '').trim() || (typeof bearer === 'string' ? bearer.replace(/^Bearer\s+/i, '').trim() : '');
    if (!token) return null;
    const parsed = parseKey(token);
    if (!parsed || parsed.type !== 'agent') return null;
    const row = await dbGet(
        `SELECT id, workspace_id, token_hash, token_salt, machine_json, revoked_at
         FROM agent_tokens
         WHERE id = ? AND revoked_at IS NULL
         LIMIT 1`,
        [parsed.id]
    );
    if (!row?.id) return null;
    if (!verifySecret({ secret: parsed.secret, salt: row.token_salt, expectedHash: row.token_hash })) {
        return null;
    }
    const tenantRow = await dbGet('SELECT id, name, owner_user_id, created_by FROM tenants WHERE id = ? LIMIT 1', [row.workspace_id]);
    if (!tenantRow?.id) return null;
    return {
        agentId: row.id,
        workspaceId: tenantRow.id,
        workspaceName: tenantRow.name,
        ownerUserId: tenantRow.owner_user_id || tenantRow.created_by || null,
        machineJson: row.machine_json || null
    };
};

const createAgentToken = async ({ workspaceId, name, machine, createdByUserId }) => {
    const token = buildKey('agent');
    const salt = createSalt();
    const hash = hashSecret(token.secret, salt);
    const createdAt = nowUnix();
    await dbRun(
        `INSERT INTO agent_tokens (id, workspace_id, name, token_hash, token_salt, created_at, machine_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
        ,
        [
            token.id,
            String(workspaceId),
            String(name || 'Local Agent'),
            hash,
            salt,
            createdAt,
            machine ? safeJsonStringify(machine, '{}') : null
        ]
    );
    await logAudit({
        tenantId: workspaceId,
        userId: createdByUserId,
        actorType: 'api_key',
        actorUserId: createdByUserId,
        action: 'create',
        entity: 'agent_token',
        entityId: token.id,
        meta: { name }
    });
    return {
        id: token.id,
        token: token.token
    };
};

const createWorkspaceKey = async ({ workspaceId, name, keyType, createdByUserId }) => {
    const normalizedType = keyType === 'service' ? 'service' : 'api';
    const key = buildKey(normalizedType === 'service' ? 'service' : 'api');
    const salt = createSalt();
    const hash = hashSecret(key.secret, salt);
    const createdAt = nowUnix();
    await dbRun(
        `INSERT INTO api_keys (id, workspace_id, name, key_type, key_hash, key_salt, key_preview, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ,
        [
            key.id,
            String(workspaceId),
            String(name || `${normalizedType} key`).trim(),
            normalizedType,
            hash,
            salt,
            key.preview,
            createdByUserId || null,
            createdAt
        ]
    );
    await logAudit({
        tenantId: workspaceId,
        userId: createdByUserId,
        actorType: 'user',
        actorUserId: createdByUserId,
        action: 'create',
        entity: 'api_key',
        entityId: key.id,
        meta: { keyType: normalizedType, name }
    });
    return {
        id: key.id,
        token: key.token,
        preview: key.preview,
        keyType: normalizedType
    };
};

const ensureBusinessWorkspace = async (tenantId, res) => {
    const plan = await getPlanForTenant(tenantId, null);
    if (plan?.code !== 'business') {
        if (res) {
            rejectUpgrade(res, {
                planCode: plan?.code || 'free',
                metric: 'business_feature',
                limit: null,
                used: null
            });
        }
        return null;
    }
    return plan;
};

const requireAuthApi = async (req, res, next) => {
    try {
        const auth = await loadAuthContext(req);
        if (!auth) {
            return sendError(res, 401, 'Unauthorized', 'Sign in required');
        }
        req.user = auth.user;
        req.plan = auth.plan;
        req.sessionToken = auth.token;
        req.memberships = auth.memberships || [];
        req.activeTenantId = auth.activeTenantId || null;
        req.activeMembership = auth.activeMembership || null;
        req.actorType = 'user';
        return next();
    } catch (error) {
        return sendError(res, 500, 'Server Error', 'Failed to authenticate');
    }
};

const requireAuthApiOrKey = async (req, res, next) => {
    try {
        const auth = await loadAuthContext(req);
        if (auth) {
            attachAuthContext(req, auth);
            req.actorType = 'user';
            return next();
        }
        const keyAuth = await loadApiKeyContext(req);
        if (!keyAuth) {
            return sendError(res, 401, 'Unauthorized', 'Sign in required');
        }
        attachAuthContext(req, keyAuth);
        req.actorType = keyAuth.actorType || 'api_key';
        req.apiKey = keyAuth.apiKey || null;
        return next();
    } catch (error) {
        return sendError(res, 500, 'Server Error', 'Failed to authenticate');
    }
};

const attachAuthContext = (req, auth) => {
    req.user = auth.user;
    req.plan = auth.plan;
    req.sessionToken = auth.token;
    req.memberships = auth.memberships || [];
    req.activeTenantId = auth.activeTenantId || null;
    req.activeMembership = auth.activeMembership || null;
};

const requireAutopilotFallbackAuth = async (req, res, next) => {
    try {
        const auth = await loadAuthContext(req);
        if (auth) {
            attachAuthContext(req, auth);
            return next();
        }

        const { token, attempted } = getServiceTokenFromReq(req);
        if (!attempted) {
            return sendError(res, 401, 'Unauthorized', 'Sign in required');
        }

        const correlationId = `svc-${Date.now()}`;
        const endpoint = `${req.method} ${getRequestPath(req)}`;
        const requestedTenantId = parseTenantId(req.body?.tenantId || req.body?.tenant_id);
        const resolvedTenantId = resolveTenantId(req);
        const payloadTenantId = requestedTenantId || resolvedTenantId || null;
        const tenantRow = resolvedTenantId
            ? await dbGet('SELECT id, name FROM tenants WHERE id = ?', [resolvedTenantId])
            : null;

        const logAttempt = async ({ ok, reason }) => {
            if (!tenantRow?.id) return;
            const payload = { endpoint, ok, tenantId: payloadTenantId };
            if (!ok && reason) {
                payload.reason = reason;
            }
            const message = `Service token access ok=${ok} ${endpoint}`;
            try {
                await recordConversationMessage({
                    tenantId: tenantRow.id,
                    correlationId,
                    senderAgent: 'ServiceToken',
                    targetAgent: 'Autopilot',
                    role: 'agent',
                    severity: ok ? 'info' : 'warn',
                    message,
                    payload
                });
            } catch (error) {
                console.error('Service token audit error:', error);
            }
        };

        const expectedToken = String(process.env.AUTOPILOT_SERVICE_TOKEN || '').trim();
        if (!timingSafeEqualString(expectedToken, token)) {
            await logAttempt({ ok: false, reason: token ? 'invalid_token' : 'missing_token' });
            return sendError(res, 401, 'Unauthorized', 'Invalid service token');
        }

        if (!resolvedTenantId) {
            await logAttempt({ ok: false, reason: 'tenant_required' });
            return sendError(res, 401, 'Unauthorized', 'Tenant required');
        }

        if (!tenantRow) {
            await logAttempt({ ok: false, reason: 'tenant_not_found' });
            return sendError(res, 401, 'Unauthorized', 'Tenant not found');
        }

        const operatorId = await resolveAutopilotOperatorId(tenantRow.id);
        if (!operatorId) {
            await logAttempt({ ok: false, reason: 'tenant_operator_not_found' });
            return sendError(res, 401, 'Unauthorized', 'Tenant operator not found');
        }

        await logAttempt({ ok: true });
        req.user = {
            id: operatorId,
            email: 'service-token',
            role: 'admin',
            isSuperadmin: false,
            is_superadmin: false,
            createdAt: null
        };
        req.plan = await getPlanForTenant(tenantRow.id, operatorId);
        req.sessionToken = null;
        req.memberships = [{
            tenantId: tenantRow.id,
            tenantName: tenantRow.name,
            role: 'admin',
            status: 'active'
        }];
        req.activeTenantId = tenantRow.id;
        req.activeMembership = req.memberships[0];
        return next();
    } catch (error) {
        console.error('Autopilot service-token auth error:', error);
        return sendError(res, 500, 'Server Error', 'Failed to authenticate');
    }
};

const requireSuperadminApi = (req, res, next) => {
    if (!isSuperadmin(req.user)) {
        return sendError(res, 403, 'Forbidden', 'Admin access required');
    }
    return next();
};

const requireTenant = async (req, res, next) => {
    try {
        const memberships = Array.isArray(req.memberships) && req.memberships.length
            ? req.memberships
            : await getMembershipsForUser(req.user?.id);
        if (!memberships.length && !isSuperadmin(req.user)) {
            return sendError(res, 403, 'Forbidden', 'Tenant membership required');
        }

        const headerTenantId = parseTenantId(req.headers['x-tenant-id']);
        let activeTenantId = headerTenantId || req.activeTenantId || memberships[0]?.tenantId || null;
        let activeMembership = memberships.find((membership) => membership.tenantId === activeTenantId) || null;

        if (!activeMembership && isSuperadmin(req.user) && headerTenantId) {
            const tenantRow = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [headerTenantId]);
            if (tenantRow?.id) {
                activeTenantId = tenantRow.id;
                activeMembership = {
                    tenantId: tenantRow.id,
                    tenantName: tenantRow.name,
                    role: 'admin',
                    status: 'active'
                };
            }
        }

        if (!activeMembership && memberships.length) {
            activeTenantId = memberships[0].tenantId;
            activeMembership = memberships[0];
        }

        if (!activeMembership) {
            if (headerTenantId) {
                return sendError(res, 404, 'Not Found', 'Tenant not found');
            }
            return sendError(res, 403, 'Forbidden', 'Active tenant required');
        }

        if (activeTenantId && activeTenantId !== req.activeTenantId && activeMembership) {
            await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [activeTenantId, req.user.id]);
        }

        req.memberships = memberships;
        req.activeTenantId = activeTenantId;
        req.activeMembership = activeMembership;
        req.tenantId = activeTenantId;
        req.tenant = activeMembership
            ? { id: activeMembership.tenantId, name: activeMembership.tenantName }
            : null;
        req.tenantRole = normalizeTenantRole(activeMembership?.role || 'user');
        return next();
    } catch (error) {
        return sendError(res, 500, 'Server Error', 'Failed to resolve tenant');
    }
};

const requireRole = (role) => (req, res, next) => {
    if (isSuperadmin(req.user)) {
        return next();
    }
    const membershipRole = normalizeTenantRole(req.tenantRole || req.activeMembership?.role || 'member');
    if (!membershipRole) {
        return sendError(res, 403, 'Forbidden', 'Tenant role required');
    }
    if (!hasMinimumRole(membershipRole, role)) {
        const message = role === 'owner'
            ? 'Owner access required'
            : role === 'admin'
                ? 'Admin access required'
                : 'Member access required';
        return sendError(res, 403, 'Forbidden', message);
    }
    return next();
};

const resolveAdminTenantId = (req, res) => {
    const queryTenantId = parseTenantId(req.query?.tenantId || req.query?.tenant_id);
    if (!isSuperadmin(req.user)) {
        if (queryTenantId && queryTenantId !== req.tenantId) {
            sendError(res, 403, 'Forbidden', 'Cross-tenant access denied');
            return null;
        }
        if (!req.tenantId) {
            sendError(res, 403, 'Forbidden', 'Active tenant required');
            return null;
        }
        return req.tenantId;
    }
    const resolved = queryTenantId || req.tenantId;
    if (!resolved) {
        sendError(res, 403, 'Forbidden', 'Active tenant required');
        return null;
    }
    return resolved;
};

const requireAuthPage = async (req, res, next) => {
    try {
        const auth = await loadAuthContext(req);
        if (!auth) {
            const returnUrl = encodeURIComponent(req.originalUrl || '/app');
            return res.redirect(`/login?returnUrl=${returnUrl}`);
        }
        req.user = auth.user;
        req.plan = auth.plan;
        req.sessionToken = auth.token;
        req.memberships = auth.memberships || [];
        req.activeTenantId = auth.activeTenantId || null;
        req.activeMembership = auth.activeMembership || null;
        return next();
    } catch (error) {
        const returnUrl = encodeURIComponent(req.originalUrl || '/app');
        return res.redirect(`/login?returnUrl=${returnUrl}`);
    }
};

const requireSuperadminPage = async (req, res, next) => {
    try {
        const auth = await loadAuthContext(req);
        if (!auth) {
            const returnUrl = encodeURIComponent(req.originalUrl || '/admin');
            return res.redirect(`/login?returnUrl=${returnUrl}`);
        }
        if (!isSuperadmin(auth.user)) {
            return res.redirect('/app');
        }
        req.user = auth.user;
        req.plan = auth.plan;
        req.sessionToken = auth.token;
        req.memberships = auth.memberships || [];
        req.activeTenantId = auth.activeTenantId || null;
        req.activeMembership = auth.activeMembership || null;
        return next();
    } catch (error) {
        const returnUrl = encodeURIComponent(req.originalUrl || '/admin');
        return res.redirect(`/login?returnUrl=${returnUrl}`);
    }
};

const ensureColumn = async (table, column, definition) => {
    try {
        const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
        if (!tables.length) return;
        const exists = await hasColumn(table, column);
        if (!exists) {
            await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    } catch (e) {
    }
};

const insertUser = async (email, passwordHash) => {
    const normalizedEmail = normalizeEmail(email);
    if (userHasNameColumn) {
        return dbRun(
            'INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, datetime(\'now\'))',
            [normalizedEmail, normalizedEmail, passwordHash]
        );
    }
    return dbRun(
        'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, datetime(\'now\'))',
        [normalizedEmail, passwordHash]
    );
};

const hasAnyAdmin = async () => {
    const adminUser = await dbGet(
        "SELECT id FROM users WHERE role = 'admin' OR is_superadmin = 1 LIMIT 1"
    );
    if (adminUser?.id) return true;
    const adminMembership = await dbGet(
        "SELECT id FROM tenant_memberships WHERE role IN ('owner', 'admin') AND status = 'active' LIMIT 1"
    );
    return Boolean(adminMembership?.id);
};

const ensureDefaultUser = async () => {
    const existing = await dbGet('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    if (existing?.id) return existing.id;
    const bootstrap = await ensureBootstrapAdmin();
    if (bootstrap?.userId) return bootstrap.userId;
    if (isProd) {
        console.error('[bootstrap] Missing admin credentials; default user not created.');
        return null;
    }
    const passwordHash = await bcrypt.hash('demo12345', 10);
    const result = await insertUser('demo@local', passwordHash);
    return result.id;
};

const createTenant = async ({ name, createdBy, ownerUserId, planCode }) => {
    const safeName = String(name || '').trim() || 'New Workspace';
    const createdAtUnix = nowUnix();
    const result = await dbRun(
        'INSERT INTO tenants (name, created_by, owner_user_id, plan_code, created_at_unix) VALUES (?, ?, ?, ?, ?)',
        [safeName, createdBy || null, ownerUserId || createdBy || null, planCode || null, createdAtUnix]
    );
    return result.id;
};

const ensureTenantMembership = async (tenantId, userId, role = 'member') => {
    if (!tenantId || !userId) return null;
    const normalizedRole = normalizeTenantRole(role);
    await dbRun(
        `INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, status, created_at)
         VALUES (?, ?, ?, 'active', datetime('now'))`,
        [tenantId, userId, normalizedRole]
    );
    return tenantId;
};

const resolveAdminTenantIdFromEnv = async () => {
    const explicit = parseTenantId(process.env.ADMIN_TENANT_ID);
    if (explicit) return explicit;
    const slug = resolveAdminTenantSlug();
    const row = await dbGet('SELECT id FROM tenants WHERE name = ? ORDER BY id ASC LIMIT 1', [slug]);
    return row?.id || null;
};

const resolveAnyAdminUserId = async () => {
    const adminUser = await dbGet(
        "SELECT id FROM users WHERE role = 'admin' OR is_superadmin = 1 ORDER BY id ASC LIMIT 1"
    );
    if (adminUser?.id) return adminUser.id;
    const adminMembership = await dbGet(
        "SELECT user_id FROM tenant_memberships WHERE role IN ('owner', 'admin') AND status = 'active' ORDER BY id ASC LIMIT 1"
    );
    return adminMembership?.user_id || null;
};

const ensureAdminTenant = async (userId) => {
    const slug = resolveAdminTenantSlug();
    let tenantId = await resolveAdminTenantIdFromEnv();
    if (!tenantId) {
        const plan = userId ? await getPlanForUser(userId) : null;
        tenantId = await createTenant({
            name: slug,
            createdBy: userId || null,
            ownerUserId: userId || null,
            planCode: plan?.code || 'free'
        });
    }
    if (userId) {
        await ensureTenantMembership(tenantId, userId, 'owner');
    }
    return tenantId;
};

const ensureBootstrapAdmin = async () => {
    const existing = await dbGet('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    if (existing?.id) return { userId: existing.id, created: false };
    const email = resolveBootstrapAdminEmail();
    const password = resolveBootstrapAdminPassword();
    if (!email || !password) {
        console.error('[bootstrap] BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_PASSWORD missing.');
        return null;
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = await insertUser(email, passwordHash);
    await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [result.id]);
    const tenantId = await ensureAdminTenant(result.id);
    await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [tenantId, result.id]);
    console.log(`[bootstrap] created admin ${email}`);
    return { userId: result.id, tenantId, created: true };
};

const resolveAdminOperatorId = async (tenantId) => {
    if (!tenantId) return null;
    const adminMembership = await dbGet(
        "SELECT user_id FROM tenant_memberships WHERE tenant_id = ? AND role IN ('owner', 'admin') AND status = 'active' ORDER BY id ASC LIMIT 1",
        [tenantId]
    );
    if (adminMembership?.user_id) return adminMembership.user_id;
    const fallback = await dbGet(
        'SELECT user_id FROM tenant_memberships WHERE tenant_id = ? AND status = ? ORDER BY id ASC LIMIT 1',
        [tenantId, 'active']
    );
    return fallback?.user_id || null;
};

const getDemoPayloadJson = (extra = {}) => safeJsonStringify({ demo: true, tags: DEMO_TAGS, ...extra }, '{}');

const getUploadDirs = () => ([
    path.join(__dirname, 'web-next', 'public', 'uploads'),
    path.join(__dirname, 'backend', 'uploads')
]);

const createDemoUploads = async (count) => {
    if (!count || count <= 0) return [];
    const dirs = getUploadDirs();
    const created = [];
    for (const dir of dirs) {
        try {
            await fs.promises.mkdir(dir, { recursive: true });
        } catch (error) {
            continue;
        }
    }
    for (let i = 0; i < count; i += 1) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `demo-autofill-${stamp}-${i + 1}.txt`;
        const content = `demo upload ${stamp}`;
        const targetDir = dirs[i % dirs.length];
        try {
            await fs.promises.writeFile(path.join(targetDir, filename), content, 'utf8');
            created.push(path.join(targetDir, filename));
        } catch (error) {
            continue;
        }
    }
    return created;
};

const clearDemoUploads = async () => {
    const dirs = getUploadDirs();
    let removed = 0;
    for (const dir of dirs) {
        try {
            const entries = await fs.promises.readdir(dir);
            for (const entry of entries) {
                if (!entry.startsWith('demo-autofill-')) continue;
                try {
                    await fs.promises.unlink(path.join(dir, entry));
                    removed += 1;
                } catch (error) {
                    continue;
                }
            }
        } catch (error) {
            continue;
        }
    }
    return removed;
};

const hasAdminDemoData = async (tenantId) => {
    if (!tenantId) return false;
    const demoLike = '%"demo":true%';
    const tagLike = '%autofill%';
    const [events, messages, actions, audits, financial] = await Promise.all([
        dbGet(
            'SELECT COUNT(*) as count FROM agent_events WHERE tenant_id = ? AND (payload_json LIKE ? OR context_json LIKE ?)',
            [tenantId, demoLike, demoLike]
        ),
        dbGet(
            'SELECT COUNT(*) as count FROM agent_messages WHERE tenant_id = ? AND payload_json LIKE ?',
            [tenantId, demoLike]
        ),
        dbGet(
            'SELECT COUNT(*) as count FROM agent_actions WHERE tenant_id = ? AND (payload_json LIKE ? OR request_json LIKE ? OR result_json LIKE ?)',
            [tenantId, demoLike, demoLike, demoLike]
        ),
        dbGet(
            'SELECT COUNT(*) as count FROM audit_logs WHERE tenant_id = ? AND meta_json LIKE ?',
            [tenantId, demoLike]
        ),
        dbGet(
            'SELECT COUNT(*) as count FROM financial_events WHERE tenant_id = ? AND (tags_json LIKE ? OR tags LIKE ?)',
            [tenantId, tagLike, tagLike]
        )
    ]);
    const total = (events?.count || 0)
        + (messages?.count || 0)
        + (actions?.count || 0)
        + (audits?.count || 0)
        + (financial?.count || 0);
    return total > 0;
};

const populateAdminDemoData = async ({ tenantId, userId, mode, counts = {} }) => {
    const normalizedMode = mode === 'full' ? 'full' : 'minimal';
    const defaults = normalizedMode === 'full'
        ? { events: 12, messages: 12, actions: 6, uploads: 3 }
        : { events: 3, messages: 4, actions: 2, uploads: 1 };
    const target = {
        events: Number.isFinite(counts.events) ? Math.max(0, counts.events) : defaults.events,
        messages: Number.isFinite(counts.messages) ? Math.max(0, counts.messages) : defaults.messages,
        actions: Number.isFinite(counts.actions) ? Math.max(0, counts.actions) : defaults.actions,
        uploads: defaults.uploads
    };
    const correlationIds = [];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (let i = 0; i < target.events; i += 1) {
        const correlationId = `demo-${stamp}-${i + 1}`;
        correlationIds.push(correlationId);
        await dbRun(
            `INSERT INTO agent_events (tenant_id, user_id, event_type, source, payload_json, correlation_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
            [tenantId, userId, 'payment_received', 'demo', getDemoPayloadJson({ correlationId, index: i + 1 }), correlationId]
        );
        await dbRun(
            `INSERT INTO financial_events (tenant_id, user_id, type, amount, currency, tags_json, tags, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [tenantId, userId, 'payment_received', 19.99 + i, DEFAULT_CURRENCY, DEMO_TAGS_JSON, DEMO_TAGS_LABEL, 'demo']
        );
        await dbRun(
            `INSERT INTO audit_logs (tenant_id, user_id, action, entity, entity_id, meta_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tenantId, userId, 'create', 'demo_event', i + 1, getDemoPayloadJson({ kind: 'event', index: i + 1 })]
        );
    }

    for (let i = 0; i < target.messages; i += 1) {
        const correlationId = correlationIds[i % Math.max(correlationIds.length, 1)] || `demo-${stamp}-msg-${i + 1}`;
        await dbRun(
            `INSERT INTO agent_messages (tenant_id, correlation_id, sender_agent, target_agent, role, severity, message, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [tenantId, correlationId, 'DemoAgent', 'Admin', 'agent', 'info', `Demo message ${i + 1}`, getDemoPayloadJson({ correlationId, index: i + 1 })]
        );
    }

    for (let i = 0; i < target.actions; i += 1) {
        const correlationId = correlationIds[i % Math.max(correlationIds.length, 1)] || `demo-${stamp}-action-${i + 1}`;
        await dbRun(
            `INSERT INTO agent_actions (tenant_id, user_id, agent_key, action_type, mode, status, payload_json, request_json, result_json, updated_at, correlation_id, actor_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
            [
                tenantId,
                userId,
                'DemoAgent',
                'create_ticket',
                'suggest',
                'draft',
                getDemoPayloadJson({ correlationId, index: i + 1 }),
                getDemoPayloadJson({ subject: 'Demo follow-up', message: 'Demo action created.' }),
                null,
                correlationId,
                'DemoAgent'
            ]
        );
    }

    const uploads = await createDemoUploads(target.uploads);
    await logAudit({
        userId,
        tenantId,
        entity: 'demo',
        action: 'populate',
        entityId: tenantId,
        meta: { demo: true, tags: DEMO_TAGS, mode: normalizedMode }
    });
    return {
        mode: normalizedMode,
        events: target.events,
        messages: target.messages,
        actions: target.actions,
        uploads: uploads.length
    };
};

const clearAdminDemoData = async (tenantId) => {
    const demoLike = '%"demo":true%';
    const tagLike = '%autofill%';
    const [events, messages, actions, audits, financial] = await Promise.all([
        dbRun(
            'DELETE FROM agent_events WHERE tenant_id = ? AND (payload_json LIKE ? OR context_json LIKE ?)',
            [tenantId, demoLike, demoLike]
        ),
        dbRun(
            'DELETE FROM agent_messages WHERE tenant_id = ? AND payload_json LIKE ?',
            [tenantId, demoLike]
        ),
        dbRun(
            'DELETE FROM agent_actions WHERE tenant_id = ? AND (payload_json LIKE ? OR request_json LIKE ? OR result_json LIKE ?)',
            [tenantId, demoLike, demoLike, demoLike]
        ),
        dbRun(
            'DELETE FROM audit_logs WHERE tenant_id = ? AND meta_json LIKE ?',
            [tenantId, demoLike]
        ),
        dbRun(
            'DELETE FROM financial_events WHERE tenant_id = ? AND (tags_json LIKE ? OR tags LIKE ?)',
            [tenantId, tagLike, tagLike]
        )
    ]);
    const uploadCount = await clearDemoUploads();
    return {
        events: events.changes || 0,
        messages: messages.changes || 0,
        actions: actions.changes || 0,
        audits: audits.changes || 0,
        financial: financial.changes || 0,
        uploads: uploadCount
    };
};

const ensureAdminAutofill = async () => {
    if (!isTruthy(process.env.ADMIN_AUTOFILL_ENABLED)) return false;
    let tenantId = await resolveAdminTenantIdFromEnv();
    if (!tenantId) {
        const adminUserId = await resolveAnyAdminUserId();
        tenantId = await ensureAdminTenant(adminUserId);
    }
    if (!tenantId) return false;
    const hasDemo = await hasAdminDemoData(tenantId);
    if (hasDemo) return false;
    const userId = await resolveAdminOperatorId(tenantId);
    if (!userId) return false;
    await populateAdminDemoData({ tenantId, userId, mode: resolveAutofillMode() });
    console.log('[bootstrap] admin demo data populated');
    return true;
};

const ensureTenantForUser = async (user, role = 'owner') => {
    if (!user?.id) return null;
    const tenantName = `${user.email || 'Tenant'} Workspace`;
    const plan = await getPlanForUser(user.id);
    const tenantId = await createTenant({
        name: tenantName,
        createdBy: user.id,
        ownerUserId: user.id,
        planCode: plan?.code || 'free'
    });
    await ensureTenantMembership(tenantId, user.id, role);
    await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [tenantId, user.id]);
    return tenantId;
};

const seedTenantsFromWorkspaces = async () => {
    const workspaces = await dbAll('SELECT id, name, created_at FROM workspaces');
    for (const workspace of workspaces) {
        await dbRun(
            'INSERT OR IGNORE INTO tenants (id, name, created_at, created_at_unix) VALUES (?, ?, ?, ?)',
            [
                workspace.id,
                workspace.name || `Workspace ${workspace.id}`,
                workspace.created_at || null,
                nowUnix()
            ]
        );
    }

    const workspaceMembers = await dbAll('SELECT workspace_id, user_id, role, created_at FROM workspace_members');
    for (const member of workspaceMembers) {
        await dbRun(
            `INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, status, created_at)
             VALUES (?, ?, ?, 'active', ?)`,
            [member.workspace_id, member.user_id, normalizeTenantRole(member.role), member.created_at || null]
        );
    }
};

const ensureTenants = async () => {
    await seedTenantsFromWorkspaces();
    const users = await dbAll('SELECT id, email, role, active_tenant_id, workspace_id FROM users');
    for (const user of users) {
        const defaultRole = normalizeTenantRole(user.role || 'user');
        const membershipRows = await dbAll(
            'SELECT tenant_id FROM tenant_memberships WHERE user_id = ? ORDER BY id ASC',
            [user.id]
        );
        const membershipIds = membershipRows.map((row) => row.tenant_id).filter(Boolean);
        let activeTenantId = parseTenantId(user.active_tenant_id);

        if (activeTenantId && !membershipIds.includes(activeTenantId)) {
            await ensureTenantMembership(activeTenantId, user.id, defaultRole);
            membershipIds.push(activeTenantId);
        }

        if (!activeTenantId) {
            if (membershipIds.length) {
                activeTenantId = membershipIds[0];
            } else if (parseTenantId(user.workspace_id)) {
                activeTenantId = parseTenantId(user.workspace_id);
                await ensureTenantMembership(activeTenantId, user.id, defaultRole);
            }
        }

        if (!activeTenantId) {
            activeTenantId = await ensureTenantForUser(user, defaultRole);
        }

        if (activeTenantId) {
            await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [activeTenantId, user.id]);
        }
    }
};

const ensureTenantOwners = async () => {
    const tenants = await dbAll('SELECT id, owner_user_id, created_by FROM tenants');
    for (const tenant of tenants) {
        let ownerUserId = tenant.owner_user_id || tenant.created_by || null;
        if (!ownerUserId) {
            const ownerCandidate = await dbGet(
                `SELECT user_id
                 FROM tenant_memberships
                 WHERE tenant_id = ? AND status = 'active'
                 ORDER BY CASE
                    WHEN role = 'owner' THEN 0
                    WHEN role = 'admin' THEN 1
                    ELSE 2
                 END, id ASC
                 LIMIT 1`,
                [tenant.id]
            );
            ownerUserId = ownerCandidate?.user_id || null;
        }
        if (ownerUserId) {
            await dbRun('UPDATE tenants SET owner_user_id = ? WHERE id = ?', [ownerUserId, tenant.id]);
            const membership = await dbGet(
                `SELECT id, role FROM tenant_memberships
                 WHERE tenant_id = ? AND user_id = ? AND status = 'active'
                 LIMIT 1`,
                [tenant.id, ownerUserId]
            );
            if (membership?.id && normalizeTenantRole(membership.role) !== 'owner') {
                await dbRun('UPDATE tenant_memberships SET role = ? WHERE id = ?', ['owner', membership.id]);
            }
            if (!membership?.id) {
                await ensureTenantMembership(tenant.id, ownerUserId, 'owner');
            }
        }
    }
};

const ensureTenantPlans = async () => {
    const tenants = await dbAll('SELECT id, plan_code, owner_user_id FROM tenants');
    for (const tenant of tenants) {
        if (tenant.plan_code) continue;
        const ownerUserId = tenant.owner_user_id || null;
        const plan = ownerUserId ? await getPlanForUser(ownerUserId) : await getPlanByCode('free');
        await dbRun('UPDATE tenants SET plan_code = ? WHERE id = ?', [plan.code || 'free', tenant.id]);
    }
};

const syncSuperadmins = async () => {
    if (!SUPERADMIN_EMAILS.length) return;
    const placeholders = SUPERADMIN_EMAILS.map(() => '?').join(',');
    await dbRun(
        `UPDATE users SET is_superadmin = 1 WHERE lower(email) IN (${placeholders})`,
        SUPERADMIN_EMAILS
    );
};

const migrateTenantIds = async () => {
    const users = await dbAll('SELECT id, active_tenant_id FROM users');
    const userTenantMap = users
        .map((user) => ({
            userId: user.id,
            tenantId: parseTenantId(user.active_tenant_id)
        }))
        .filter((entry) => entry.tenantId);

    const tenantTables = [
        { table: 'clients', userColumn: 'owner_id' },
        { table: 'projects', userColumn: 'owner_id' },
        { table: 'providers', userColumn: 'owner_id' },
        { table: 'orders', userColumn: 'owner_id' },
        { table: 'leads', userColumn: 'owner_id' },
        { table: 'couriers', userColumn: 'owner_id' },
        { table: 'order_assignments', userColumn: 'owner_id' },
        { table: 'inventory_items', userColumn: 'owner_id' },
        { table: 'inventory_movements', userColumn: 'owner_id' },
        { table: 'errands', userColumn: 'owner_id' },
        { table: 'ai_requests', userColumn: 'user_id' },
        { table: 'audit_log', userColumn: 'user_id' },
        { table: 'feedback', userColumn: 'user_id' }
    ];

    for (const entry of userTenantMap) {
        for (const table of tenantTables) {
            await dbRun(
                `UPDATE ${table.table} SET tenant_id = ? WHERE tenant_id IS NULL AND ${table.userColumn} = ?`,
                [entry.tenantId, entry.userId]
            );
        }
    }
};

const resolveLeadOwnerId = async (payload = {}) => {
    const ownerIdRaw = process.env.LEADS_WEBHOOK_OWNER_ID || payload.ownerId || payload.owner_id;
    const ownerId = Number(ownerIdRaw);
    if (Number.isFinite(ownerId) && ownerId > 0) {
        const ownerRow = await dbGet('SELECT id FROM users WHERE id = ?', [ownerId]);
        if (ownerRow?.id) return ownerRow.id;
    }
    const ownerEmail = normalizeEmail(payload.ownerEmail || payload.owner_email || process.env.LEADS_WEBHOOK_OWNER_EMAIL);
    if (ownerEmail) {
        const ownerRow = await dbGet('SELECT id FROM users WHERE email = ?', [ownerEmail]);
        if (ownerRow?.id) return ownerRow.id;
    }
    const fallback = await dbGet('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    return fallback?.id || null;
};

const resolveLeadTenantId = async (ownerId, payload = {}) => {
    if (!ownerId) return null;
    const requestedTenantId = parseTenantId(payload.tenantId || payload.tenant_id);
    if (requestedTenantId) {
        const membership = await dbGet(
            'SELECT tenant_id FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? AND status = ? LIMIT 1',
            [requestedTenantId, ownerId, 'active']
        );
        if (membership?.tenant_id) return membership.tenant_id;
    }

    const ownerRow = await dbGet('SELECT active_tenant_id FROM users WHERE id = ?', [ownerId]);
    const activeTenantId = parseTenantId(ownerRow?.active_tenant_id);
    if (activeTenantId) return activeTenantId;

    const fallbackMembership = await dbGet(
        'SELECT tenant_id FROM tenant_memberships WHERE user_id = ? AND status = ? ORDER BY id ASC LIMIT 1',
        [ownerId, 'active']
    );
    return fallbackMembership?.tenant_id || null;
};

const normalizeActionMode = (value, fallback = 'suggest') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['suggest', 'draft', 'execute'].includes(normalized)) return normalized;
    return fallback;
};

const getTenantRole = (req) => normalizeTenantRole(req.tenantRole || req.activeMembership?.role || 'member');

const isTenantAdmin = (req) => {
    if (isSuperadmin(req.user)) return true;
    const role = getTenantRole(req);
    return isAdminRole(role);
};

const recordAgentEvent = async ({ tenantId, userId, eventType, source, payload }) => {
    const result = await dbRun(
        `INSERT INTO agent_events (tenant_id, user_id, event_type, source, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
        [tenantId, userId, String(eventType), String(source || 'ui'), safeJsonStringify(payload)]
    );
    return result.id;
};

const recordAgentAction = async ({ tenantId, userId, agentKey, actionType, mode, status, payload, result }) => {
    const resultRow = await dbRun(
        `INSERT INTO agent_actions (tenant_id, user_id, agent_key, action_type, mode, status, payload_json, result_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
            tenantId,
            userId,
            String(agentKey || 'system'),
            String(actionType),
            String(mode || 'suggest'),
            String(status || 'pending'),
            safeJsonStringify(payload),
            result ? safeJsonStringify(result) : null
        ]
    );
    return resultRow.id;
};

const updateAgentAction = async (actionId, { status, result }) => {
    await dbRun(
        `UPDATE agent_actions
         SET status = ?, result_json = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [String(status || 'pending'), result ? safeJsonStringify(result) : null, actionId]
    );
};

const recordAgentSuggestion = async ({ tenantId, userId, eventId, title, message, actions, mode }) => {
    const safeTitle = toSafeString(title) || 'Suggestion';
    const safeMessage = toSafeString(message) || '';
    const actionPayload = actions && actions.length ? safeJsonStringify(actions) : null;
    const suggestionMode = normalizeActionMode(mode || 'suggest');
    const result = await dbRun(
        `INSERT INTO agent_suggestions (tenant_id, user_id, event_id, title, message, actions_json, mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [tenantId, userId, eventId || null, safeTitle, safeMessage, actionPayload, suggestionMode]
    );
    return result.id;
};

const resolveSupportAssigneeId = async (tenantId) => {
    if (!tenantId) return null;
    const row = await dbGet(
        `SELECT tm.user_id
         FROM tenant_memberships tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.tenant_id = ? AND tm.status = 'active'
         ORDER BY CASE
            WHEN tm.role = 'owner' THEN 0
            WHEN tm.role = 'admin' THEN 1
            ELSE 2
         END, u.email ASC
         LIMIT 1`,
        [tenantId]
    );
    return row?.user_id || null;
};

const checkTenantLimit = async ({ tenantId, plan, key, table }) => {
    const limitValue = getLimitValue(plan, key);
    if (!limitValue) return { ok: true };
    const row = await dbGet(`SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId]);
    const current = row?.count || 0;
    if (current >= limitValue) {
        return {
            ok: false,
            error: 'Upgrade required',
            message: 'Upgrade required',
            limit: limitValue,
            current
        };
    }
    return { ok: true };
};

const executeCreateOrder = async ({ tenantId, userId, plan }, payload = {}) => {
    const title = toSafeString(payload.title);
    if (!title) {
        return { ok: false, error: 'Invalid input', message: 'Order title is required' };
    }
    const limitCheck = await consumeUsage({ tenantId, plan, metric: 'orders', cost: 1 });
    if (!limitCheck.ok) {
        return {
            ok: false,
            error: 'Upgrade required',
            message: 'Upgrade required',
            limit: limitCheck.limit,
            used: limitCheck.used
        };
    }
    const result = await dbRun(
        `INSERT INTO orders (tenant_id, owner_id, title, description, status, priority, order_type, address_from, address_to, scheduled_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
            tenantId,
            userId,
            title,
            toSafeString(payload.description) || null,
            toSafeString(payload.status) || 'new',
            toSafeString(payload.priority) || 'normal',
            toSafeString(payload.orderType) || 'delivery',
            toSafeString(payload.addressFrom) || null,
            toSafeString(payload.addressTo) || null,
            toSafeString(payload.scheduledAt) || null
        ]
    );
    const row = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [result.id, tenantId]);
    await logAudit({ userId, tenantId, entity: 'orders', action: 'create', entityId: result.id });
    return { ok: true, data: row };
};

const executeCreateLead = async ({ tenantId, userId, plan }, payload = {}) => {
    const lead = buildLeadPayload(payload);
    const status = parseLeadStatus(payload.status, 'new');
    if (!hasLeadContact({ ...lead, status })) {
        return { ok: false, error: 'Invalid input', message: 'Lead name or contact is required' };
    }
    const limitCheck = await consumeUsage({ tenantId, plan, metric: 'leads', cost: 1 });
    if (!limitCheck.ok) {
        return {
            ok: false,
            error: 'Upgrade required',
            message: 'Upgrade required',
            limit: limitCheck.limit,
            used: limitCheck.used
        };
    }
    const tagList = normalizeTags(payload.tags || payload.tag || payload.labels);
    const result = await dbRun(
        `INSERT INTO leads (tenant_id, created_by, owner_id, name, contact, company, email, phone, source, status, tags_json, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
            tenantId,
            userId,
            userId,
            lead.name || null,
            lead.contact || null,
            lead.company || null,
            lead.email || null,
            lead.phone || null,
            lead.source || null,
            status || 'new',
            tagList.length ? JSON.stringify(tagList) : null,
            lead.notes || null
        ]
    );
    const row = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [result.id, tenantId]);
    await logAudit({ userId, tenantId, entity: 'leads', action: 'create', entityId: result.id });
    return { ok: true, data: row };
};

const executeCreateSupportTicket = async ({ tenantId, userId }, payload = {}) => {
    const subject = toSafeString(payload.subject) || `Support request from ${toSafeString(payload.email || payload.requesterEmail || '') || 'user'}`;
    const description = toSafeString(payload.message || payload.description);
    if (!description) {
        return { ok: false, error: 'Invalid input', message: 'Support message is required' };
    }
    const priority = toSafeString(payload.priority) || 'normal';
    const assigneeId = await resolveSupportAssigneeId(tenantId);
    const result = await dbRun(
        `INSERT INTO support_tickets (tenant_id, requester_user_id, assigned_user_id, subject, description, status, priority, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, datetime('now'))`,
        [tenantId, userId, assigneeId, subject, description, priority]
    );
    const row = await dbGet('SELECT * FROM support_tickets WHERE id = ? AND tenant_id = ?', [result.id, tenantId]);
    await logAudit({ userId, tenantId, entity: 'support_tickets', action: 'create', entityId: result.id });
    return { ok: true, data: row };
};

const ACTION_DEFINITIONS = {
    create_order: {
        allowedRoles: ['owner', 'admin', 'member'],
        execute: executeCreateOrder
    },
    create_lead: {
        allowedRoles: ['owner', 'admin', 'member'],
        execute: executeCreateLead
    },
    create_support_ticket: {
        allowedRoles: ['owner', 'admin', 'member'],
        execute: executeCreateSupportTicket
    }
};

const runActionEngine = async (actions, context) => {
    const results = [];
    for (const action of actions) {
        const actionType = action.type;
        const definition = ACTION_DEFINITIONS[actionType];
        const mode = normalizeActionMode(action.mode || context.actionMode);
        if (!definition) {
            const actionId = await recordAgentAction({
                tenantId: context.tenantId,
                userId: context.user.id,
                agentKey: action.agentKey,
                actionType,
                mode,
                status: 'blocked',
                payload: action.payload,
                result: { ok: false, error: 'Unknown action' }
            });
            results.push({ id: actionId, type: actionType, mode, status: 'blocked', error: 'Unknown action' });
            continue;
        }

        const normalizedRole = normalizeTenantRole(context.tenantRole || 'user');
        if (!isSuperadmin(context.user) && definition.allowedRoles && !definition.allowedRoles.includes(normalizedRole)) {
            const actionId = await recordAgentAction({
                tenantId: context.tenantId,
                userId: context.user.id,
                agentKey: action.agentKey,
                actionType,
                mode,
                status: 'blocked',
                payload: action.payload,
                result: { ok: false, error: 'Forbidden', message: 'Insufficient role' }
            });
            results.push({ id: actionId, type: actionType, mode, status: 'blocked', error: 'Insufficient role' });
            continue;
        }

        if (mode !== 'execute') {
            const actionId = await recordAgentAction({
                tenantId: context.tenantId,
                userId: context.user.id,
                agentKey: action.agentKey,
                actionType,
                mode,
                status: mode === 'draft' ? 'draft' : 'suggested',
                payload: action.payload
            });
            results.push({ id: actionId, type: actionType, mode, status: mode === 'draft' ? 'draft' : 'suggested' });
            continue;
        }

        const actionId = await recordAgentAction({
            tenantId: context.tenantId,
            userId: context.user.id,
            agentKey: action.agentKey,
            actionType,
            mode,
            status: 'executing',
            payload: action.payload
        });
        const execution = await definition.execute({
            tenantId: context.tenantId,
            userId: context.user.id,
            plan: context.plan
        }, action.payload);
        if (!execution.ok) {
            await updateAgentAction(actionId, { status: 'failed', result: execution });
            results.push({ id: actionId, type: actionType, mode, status: 'failed', error: execution.message || execution.error });
            continue;
        }
        await updateAgentAction(actionId, { status: 'executed', result: execution });
        results.push({ id: actionId, type: actionType, mode, status: 'executed', result: execution.data });
    }
    return results;
};

const executeExistingAction = async (actionRow, context) => {
    const definition = ACTION_DEFINITIONS[actionRow.action_type];
    if (!definition) {
        return { ok: false, error: 'Unknown action' };
    }
    const normalizedRole = normalizeTenantRole(context.tenantRole || 'user');
    if (!isSuperadmin(context.user) && definition.allowedRoles && !definition.allowedRoles.includes(normalizedRole)) {
        return { ok: false, error: 'Forbidden', message: 'Insufficient role' };
    }
    const payload = safeJsonParse(actionRow.payload_json, {});
    const execution = await definition.execute({
        tenantId: context.tenantId,
        userId: context.user.id,
        plan: context.plan
    }, payload || {});
    if (!execution.ok) return execution;
    return { ok: true, data: execution.data };
};

const buildUiCoachTips = (page) => {
    const tips = {
        '/app': [
            {
                title: 'Start with projects',
                message: 'Create a project to organize workstreams and milestones.',
                anchor: '#projects'
            },
            {
                title: 'Capture leads',
                message: 'Log leads to track new inbound opportunities early.',
                anchor: '#leads'
            },
            {
                title: 'Ship orders faster',
                message: 'Use orders to assign delivery tasks and priorities.',
                anchor: '#orders'
            }
        ]
    };
    return tips[page] || [];
};

const buildFormHelperHints = (payload = {}) => {
    const entity = String(payload.entity || '').toLowerCase();
    const missing = Array.isArray(payload.missingFields) ? payload.missingFields : [];
    if (!entity && !missing.length) return [];
    const examples = {
        orders: {
            title: 'Priority onboarding',
            description: 'Client needs accelerated onboarding and setup.'
        },
        leads: {
            name: 'Northwind Logistics',
            email: 'ops@northwind.example'
        }
    };
    const example = examples[entity] || null;
    return missing.map((field) => ({
        field,
        example: example ? example[field] : null
    }));
};

const normalizeConversationEventType = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
        return { raw: '', normalized: '', canonical: '' };
    }
    const normalized = raw.toLowerCase().replace(/[\s.-]+/g, '_');
    const canonical = normalized.replace(/^ui_/, '');
    return { raw, normalized, canonical };
};

const buildCorrelationId = (eventId) => `evt-${eventId}`;

const createConversationEvent = async ({ tenantId, userId, eventType, context, source }) => {
    const contextJson = safeJsonStringify(context);
    const result = await dbRun(
        `INSERT INTO agent_events (tenant_id, user_id, event_type, source, payload_json, context_json, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            tenantId,
            userId,
            String(eventType),
            String(source || 'agent-console'),
            contextJson,
            contextJson,
            null
        ]
    );
    const correlationId = buildCorrelationId(result.id);
    await dbRun('UPDATE agent_events SET correlation_id = ? WHERE id = ?', [correlationId, result.id]);
    return { eventId: result.id, correlationId };
};

const getConversationEvent = async ({ eventId, tenantId }) => {
    const row = await dbGet(
        'SELECT id, event_type, context_json, payload_json, correlation_id FROM agent_events WHERE id = ? AND tenant_id = ? LIMIT 1',
        [eventId, tenantId]
    );
    if (!row) return null;
    const correlationId = row.correlation_id || buildCorrelationId(row.id);
    if (!row.correlation_id) {
        await dbRun('UPDATE agent_events SET correlation_id = ? WHERE id = ?', [correlationId, row.id]);
    }
    const context = safeJsonParse(row.context_json, null) || safeJsonParse(row.payload_json, {}) || {};
    return { eventId: row.id, eventType: row.event_type, context, correlationId };
};

const recordConversationMessage = async ({
    tenantId,
    correlationId,
    senderAgent,
    targetAgent,
    role,
    severity,
    message,
    payload
}) => {
    await dbRun(
        `INSERT INTO agent_messages (tenant_id, correlation_id, sender_agent, target_agent, role, severity, message, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            tenantId,
            correlationId,
            String(senderAgent || 'agent'),
            targetAgent ? String(targetAgent) : null,
            String(role || 'agent'),
            String(severity || 'info'),
            String(message || ''),
            payload ? safeJsonStringify(payload) : null
        ]
    );
};

const recordConversationAction = async ({
    tenantId,
    userId,
    correlationId,
    actorAgent,
    actionType,
    status,
    request
}) => {
    const requestJson = safeJsonStringify(request);
    const result = await dbRun(
        `INSERT INTO agent_actions (tenant_id, user_id, agent_key, action_type, mode, status, payload_json, request_json, result_json, updated_at, correlation_id, actor_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), ?, ?)`,
        [
            tenantId,
            userId,
            String(actorAgent || 'agent'),
            String(actionType),
            'draft',
            String(status || 'draft'),
            requestJson,
            requestJson,
            correlationId,
            String(actorAgent || 'agent')
        ]
    );
    return result.id;
};

const autopilotStorage = createAutopilotStorage({
    defaultEnabled: toBoolean(process.env.AUTOPILOT_ENABLED, false)
});

const autopilotEngine = createAutopilotEngine({
    storage: autopilotStorage,
    recordMessage: recordConversationMessage,
    recordAction: recordConversationAction,
    logAudit
});

const formatConversationMessageRow = (row) => ({
    id: row.id,
    correlationId: row.correlation_id,
    sender: row.sender_agent,
    target: row.target_agent,
    role: row.role,
    severity: row.severity,
    message: row.message,
    payload: safeJsonParse(row.payload_json, null),
    createdAt: row.created_at
});

const formatConversationActionRow = (row) => ({
    id: row.id,
    correlationId: row.correlation_id,
    actor: row.actor_agent || row.agent_key,
    type: row.action_type,
    status: row.status,
    request: safeJsonParse(row.request_json, null) || safeJsonParse(row.payload_json, {}) || {},
    result: safeJsonParse(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

const loadConversationMessages = async (tenantId, correlationId, limit = 100) => {
    const rows = await dbAll(
        `SELECT id, correlation_id, sender_agent, target_agent, role, severity, message, payload_json, created_at
         FROM agent_messages
         WHERE tenant_id = ? AND correlation_id = ?
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
        [tenantId, correlationId, limit]
    );
    return rows.map(formatConversationMessageRow);
};

const loadConversationActions = async (tenantId, correlationId, user, tenantRole) => {
    const params = [tenantId, correlationId];
    let sql = `SELECT id, correlation_id, actor_agent, agent_key, action_type, status, request_json, payload_json, result_json, created_at, updated_at, user_id
               FROM agent_actions
               WHERE tenant_id = ? AND correlation_id = ?`;
    const normalizedRole = normalizeTenantRole(tenantRole || user?.role || 'user');
    if (!user || (!isSuperadmin(user) && normalizedRole !== 'admin')) {
        sql += ' AND user_id = ?';
        params.push(user?.id || 0);
    }
    sql += ' ORDER BY created_at ASC, id ASC';
    const rows = await dbAll(sql, params);
    return rows.map(formatConversationActionRow);
};

const resolveConversationLeadId = (context = {}) => parseTenantId(context.leadId || context.lead_id || context.id);

const executeLeadStatusUpdate = async ({ tenantId, userId }, request = {}) => {
    const leadId = resolveConversationLeadId(request);
    const status = parseLeadStatus(request.status, null);
    if (!leadId || !status) {
        return { ok: false, error: 'Invalid input', message: 'Lead id and status are required' };
    }
    const existing = await dbGet(
        'SELECT id FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
        [leadId, tenantId]
    );
    if (!existing) {
        return { ok: false, error: 'Not Found', message: 'Lead not found' };
    }
    await dbRun(
        `UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
        [status, leadId, tenantId]
    );
    const updated = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [leadId, tenantId]);
    await logAudit({ userId, tenantId, entity: 'leads', action: 'update', entityId: leadId, meta: { status } });
    return { ok: true, data: updated };
};

const executeTagLead = async ({ tenantId, userId }, request = {}) => {
    const leadId = resolveConversationLeadId(request);
    const nextTags = normalizeTags(request.tags || request.tag || request.labels);
    if (!leadId || !nextTags.length) {
        return { ok: false, error: 'Invalid input', message: 'Lead id and tags are required' };
    }
    const row = await dbGet(
        'SELECT tags_json FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
        [leadId, tenantId]
    );
    if (!row) {
        return { ok: false, error: 'Not Found', message: 'Lead not found' };
    }
    const existingTags = normalizeTags(row.tags_json);
    const mergedTags = normalizeTags([...existingTags, ...nextTags]);
    await dbRun(
        `UPDATE leads SET tags_json = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
        [mergedTags.length ? JSON.stringify(mergedTags) : null, leadId, tenantId]
    );
    await logAudit({ userId, tenantId, entity: 'leads', action: 'update', entityId: leadId, meta: { tags: mergedTags } });
    return { ok: true, data: { id: leadId, tags: mergedTags } };
};

const AUTOPILOT_ALLOWED_WRITE_DIRS = [
    path.join(__dirname, 'data', 'autopilot'),
    path.join(__dirname, 'docs'),
    path.join(__dirname, 'backend', 'pages'),
    path.join(__dirname, 'web-next')
];

const isAutopilotPathAllowed = (targetPath) => {
    const resolved = path.resolve(targetPath);
    return AUTOPILOT_ALLOWED_WRITE_DIRS.some((root) => resolved.startsWith(path.resolve(root) + path.sep));
};

const executeSafeWriteFile = async ({ tenantId, userId }, request = {}) => {
    const targetPath = request.path || request.filePath || request.targetPath;
    if (!targetPath) {
        return { ok: false, error: 'Invalid input', message: 'Path is required' };
    }
    const resolvedPath = path.resolve(__dirname, targetPath);
    if (!isAutopilotPathAllowed(resolvedPath)) {
        return { ok: false, error: 'Forbidden', message: 'Path is not allowed' };
    }
    const content = request.content === undefined || request.content === null
        ? ''
        : String(request.content);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, content, 'utf8');
    await logAudit({ userId, tenantId, entity: 'autopilot_file', action: 'write', entityId: tenantId, meta: { path: resolvedPath } });
    return { ok: true, data: { path: resolvedPath } };
};

const executeSafeCreateOffer = async ({ tenantId, userId }, request = {}) => {
    const offers = await autopilotStorage.listOffers(tenantId);
    const nowIso = new Date().toISOString();
    const offer = {
        id: request.id || crypto.randomUUID(),
        tenantId,
        title: toSafeString(request.title),
        promise: toSafeString(request.promise),
        price: toNumber(request.price, 0),
        audience: toSafeString(request.audience),
        deliveryType: toSafeString(request.deliveryType),
        status: toSafeString(request.status) || 'draft',
        createdAt: nowIso,
        updatedAt: nowIso
    };
    offers.push(offer);
    await autopilotStorage.saveOffers(tenantId, offers);
    await logAudit({ userId, tenantId, entity: 'autopilot_offer', action: 'create', entityId: offer.id });
    return { ok: true, data: offer };
};

const executeSafeUpdateOffer = async ({ tenantId, userId }, request = {}) => {
    const offers = await autopilotStorage.listOffers(tenantId);
    const offer = offers.find((item) => item.id === request.id);
    if (!offer) {
        return { ok: false, error: 'Not Found', message: 'Offer not found' };
    }
    offer.title = toSafeString(request.title || offer.title);
    offer.promise = toSafeString(request.promise || offer.promise);
    offer.price = request.price !== undefined ? toNumber(request.price, offer.price) : offer.price;
    offer.audience = toSafeString(request.audience || offer.audience);
    offer.deliveryType = toSafeString(request.deliveryType || offer.deliveryType);
    offer.status = toSafeString(request.status || offer.status || 'draft');
    offer.updatedAt = new Date().toISOString();
    await autopilotStorage.saveOffers(tenantId, offers);
    await logAudit({ userId, tenantId, entity: 'autopilot_offer', action: 'update', entityId: offer.id });
    return { ok: true, data: offer };
};

const executeSafeGenerateLanding = async ({ tenantId, userId }, request = {}) => {
    const offerId = request.offerId || request.offer_id;
    if (!offerId) {
        return { ok: false, error: 'Invalid input', message: 'offerId is required' };
    }
    const html = request.html ? String(request.html) : '';
    if (!html) {
        return { ok: false, error: 'Invalid input', message: 'HTML is required' };
    }
    const landings = await autopilotStorage.listLandings(tenantId);
    const nowIso = new Date().toISOString();
    let landing = landings.find((item) => item.offerId === offerId);
    if (!landing) {
        landing = {
            id: crypto.randomUUID(),
            tenantId,
            offerId,
            slug: toSafeString(request.slug) || `offer-${offerId}`,
            html,
            status: 'active',
            createdAt: nowIso,
            updatedAt: nowIso
        };
        landings.push(landing);
    } else {
        landing.slug = toSafeString(request.slug || landing.slug);
        landing.html = html;
        landing.status = toSafeString(request.status || landing.status || 'active');
        landing.updatedAt = nowIso;
    }
    await autopilotStorage.saveLandings(tenantId, landings);
    await logAudit({ userId, tenantId, entity: 'autopilot_landing', action: 'update', entityId: landing.id });
    return { ok: true, data: landing };
};

const executeSafeCaptureLead = async ({ tenantId, userId }, request = {}) => {
    const email = normalizeEmail(request.email || '');
    if (!email || !email.includes('@')) {
        return { ok: false, error: 'Invalid input', message: 'Email is required' };
    }
    const lead = {
        id: crypto.randomUUID(),
        tenantId,
        email,
        name: toSafeString(request.name),
        source: toSafeString(request.source) || 'manual',
        status: toSafeString(request.status) || 'new',
        tags: normalizeTags(request.tags),
        createdAt: new Date().toISOString()
    };
    const leads = await autopilotStorage.listLeads(tenantId);
    leads.unshift(lead);
    await autopilotStorage.saveLeads(tenantId, leads);
    await logAudit({ userId, tenantId, entity: 'autopilot_lead', action: 'create', entityId: lead.id });
    return { ok: true, data: lead };
};

const executeSafeLog = async ({ tenantId, userId }, request = {}) => {
    const message = toSafeString(request.message || request.note || 'autopilot');
    await logAudit({ userId, tenantId, entity: 'autopilot_log', action: 'write', entityId: tenantId, meta: { message } });
    return { ok: true, data: { message } };
};

const executeSafeDraft = async ({ tenantId, userId }, request = {}) => {
    await logAudit({ userId, tenantId, entity: 'autopilot_draft', action: 'queue', entityId: tenantId, meta: request });
    return { ok: true, data: { queued: true } };
};

const CONVERSATION_ACTIONS = {
    lead_status_update: {
        role: 'admin',
        execute: executeLeadStatusUpdate
    },
    tag_lead: {
        role: 'user',
        execute: executeTagLead
    },
    create_ticket: {
        role: 'user',
        execute: executeCreateSupportTicket
    },
    safe_write_file: {
        role: 'admin',
        execute: executeSafeWriteFile
    },
    safe_log: {
        role: 'user',
        execute: executeSafeLog
    },
    safe_create_offer: {
        role: 'admin',
        execute: executeSafeCreateOffer
    },
    safe_update_offer: {
        role: 'admin',
        execute: executeSafeUpdateOffer
    },
    safe_generate_landing: {
        role: 'admin',
        execute: executeSafeGenerateLanding
    },
    safe_capture_lead: {
        role: 'user',
        execute: executeSafeCaptureLead
    },
    safe_enqueue_approval: {
        role: 'user',
        execute: executeSafeDraft
    },
    safe_send_email_draft: {
        role: 'user',
        execute: executeSafeDraft
    },
    safe_post_draft: {
        role: 'user',
        execute: executeSafeDraft
    },
    safe_payment_setup_draft: {
        role: 'admin',
        execute: executeSafeDraft
    }
};

const executeConversationAction = async (actionRow, req) => {
    const definition = CONVERSATION_ACTIONS[actionRow.action_type];
    if (!definition) {
        return { ok: false, error: 'Invalid action', message: 'Unsupported action type' };
    }
    if (definition.role === 'admin' && !isTenantAdmin(req)) {
        return { ok: false, error: 'Forbidden', message: 'Admin access required' };
    }
    const request = safeJsonParse(actionRow.request_json, null) || safeJsonParse(actionRow.payload_json, {}) || {};
    return definition.execute({ tenantId: req.tenantId, userId: req.user.id, plan: req.plan }, request);
};

const runConversationDispatch = async ({ eventType, context, correlationId }, meta) => {
    const normalized = normalizeConversationEventType(eventType);
    const canonicalType = normalized.canonical || normalized.normalized;
    const normalizedContext = {
        ...(context || {}),
        event_type: canonicalType,
        event_type_raw: normalized.raw
    };

    await recordConversationMessage({
        tenantId: meta.tenantId,
        correlationId,
        senderAgent: 'EventNormalizerAgent',
        targetAgent: 'RouterAgent',
        role: 'agent',
        severity: 'info',
        message: `Normalized event "${canonicalType || normalized.raw}".`,
        payload: {
            rawType: normalized.raw,
            normalizedType: canonicalType,
            contextKeys: Object.keys(normalizedContext || {})
        }
    });

    const targets = [];
    if (['page_view', 'app_open'].includes(canonicalType)) {
        targets.push('UICoachAgent');
    }
    if (['lead_created', 'lead_stuck'].includes(canonicalType)) {
        targets.push('LeadsAgent');
    }
    if (canonicalType === 'payment_received') {
        targets.push('RevenueAgent');
    }

    if (!targets.length) {
        await recordConversationMessage({
            tenantId: meta.tenantId,
            correlationId,
            senderAgent: 'RouterAgent',
            targetAgent: 'AgentConsole',
            role: 'agent',
            severity: 'warn',
            message: `No agents matched event "${canonicalType || normalized.raw}".`,
            payload: { eventType: canonicalType || normalized.raw }
        });
        return;
    }

    for (const target of targets) {
        await recordConversationMessage({
            tenantId: meta.tenantId,
            correlationId,
            senderAgent: 'RouterAgent',
            targetAgent: target,
            role: 'agent',
            severity: 'info',
            message: `Routing event "${canonicalType}" to ${target}.`,
            payload: { eventType: canonicalType }
        });
    }

    if (targets.includes('UICoachAgent')) {
        const page = toSafeString(normalizedContext.page || normalizedContext.path || normalizedContext.route || '/app') || '/app';
        const tips = buildUiCoachTips(page);
        const message = tips.length
            ? `Onboarding tips: ${tips.map((tip) => tip.title).join('; ')}`
            : 'Explore Projects, Leads, and Orders to get started.';
        await recordConversationMessage({
            tenantId: meta.tenantId,
            correlationId,
            senderAgent: 'UICoachAgent',
            targetAgent: 'User',
            role: 'agent',
            severity: 'info',
            message,
            payload: { page, tips }
        });
    }

    if (targets.includes('LeadsAgent')) {
        const leadId = resolveConversationLeadId(normalizedContext);
        const tagLabel = canonicalType === 'lead_stuck' ? 'stalled' : 'follow-up';
        const actionRequests = [];
        if (leadId) {
            actionRequests.push({
                type: 'tag_lead',
                request: { leadId, tags: [tagLabel] }
            });
            actionRequests.push({
                type: 'lead_status_update',
                request: { leadId, status: 'contacted' }
            });
        }
        const message = leadId
            ? `Lead signal received. Drafted actions: ${actionRequests.map((action) => action.type).join(', ')}.`
            : 'Lead signal received. Provide leadId to draft actions.';
        await recordConversationMessage({
            tenantId: meta.tenantId,
            correlationId,
            senderAgent: 'LeadsAgent',
            targetAgent: 'User',
            role: 'agent',
            severity: 'info',
            message,
            payload: { leadId, eventType: canonicalType }
        });
        for (const action of actionRequests) {
            await recordConversationAction({
                tenantId: meta.tenantId,
                userId: meta.userId,
                correlationId,
                actorAgent: 'LeadsAgent',
                actionType: action.type,
                status: 'draft',
                request: action.request
            });
        }
    }

    if (targets.includes('RevenueAgent')) {
        const amountValue = Number(normalizedContext.amount);
        const currencyValue = normalizeCurrency(normalizedContext.currency, DEFAULT_CURRENCY) || DEFAULT_CURRENCY;
        const amountLabel = Number.isFinite(amountValue) ? `${currencyValue} ${amountValue.toFixed(2)}` : null;
        const leadId = resolveConversationLeadId(normalizedContext);
        let followUpAction = null;
        if (leadId) {
            followUpAction = {
                type: 'tag_lead',
                request: { leadId, tags: ['payment-received'] }
            };
        } else {
            followUpAction = {
                type: 'create_ticket',
                request: {
                    subject: 'Payment follow-up',
                    message: `Payment received${amountLabel ? `: ${amountLabel}` : ''}. Follow up with the customer.`
                }
            };
        }
        const message = `Revenue recorded${amountLabel ? ` (${amountLabel})` : ''}. Drafted action: ${followUpAction.type}.`;
        await recordConversationMessage({
            tenantId: meta.tenantId,
            correlationId,
            senderAgent: 'RevenueAgent',
            targetAgent: 'User',
            role: 'agent',
            severity: 'info',
            message,
            payload: { amount: amountValue, currency: currencyValue, leadId }
        });
        await recordConversationAction({
            tenantId: meta.tenantId,
            userId: meta.userId,
            correlationId,
            actorAgent: 'RevenueAgent',
            actionType: followUpAction.type,
            status: 'draft',
            request: followUpAction.request
        });
    }
};

const runAgentOrchestrator = async (event, context) => {
    const responses = [];
    const actions = [];
    const payload = event.payload || {};
    const rawType = String(event.type || '').toLowerCase();
    const normalizedType = rawType.replace(/[\s-]/g, '_');
    const page = toSafeString(payload.page || payload.path || payload.route);
    const actionMode = normalizeActionMode(payload.actionMode || event.actionMode || 'suggest');

    if (rawType === 'user.login'
        || normalizedType === 'first_login'
        || normalizedType === 'first_dashboard_view'
        || ((rawType === 'ui.page_view' || normalizedType === 'page_view') && page === '/app')) {
        const userRow = await dbGet('SELECT welcome_seen_at FROM users WHERE id = ?', [context.user.id]);
        if (!userRow?.welcome_seen_at) {
            await dbRun('UPDATE users SET welcome_seen_at = datetime(\'now\') WHERE id = ?', [context.user.id]);
            responses.push({
                agent: 'welcome',
                message: `Welcome to Agent OS. Your active tenant is ${context.tenant?.name || 'active'}.`,
                nextSteps: ['Open the onboarding checklist', 'Capture your first lead', 'Create a delivery order']
            });
        }
    }

    if (rawType === 'ui.page_view' || normalizedType === 'page_view') {
        const tips = buildUiCoachTips(page || payload.page);
        if (tips.length) {
            responses.push({ agent: 'ui-coach', tips });
        }
    }

    if (rawType === 'ui.form_submit' || rawType === 'ui.form_error' || normalizedType === 'form_error') {
        const hints = buildFormHelperHints(payload);
        if (hints.length) {
            responses.push({ agent: 'form-helper', hints });
        }
    }

    const entity = String(payload.entity || '').toLowerCase();
    const isCreateForm = payload.action !== 'update';
    if (rawType === 'intake.order' || normalizedType === 'intake_order' || (rawType === 'ui.form_submit' && entity === 'orders' && isCreateForm)) {
        const values = payload.values || payload.data || {};
        const title = toSafeString(values.title);
        if (!title) {
            responses.push({ agent: 'intake', errors: ['Order title is required'], missingFields: ['title'] });
        } else {
            actions.push({
                agentKey: 'intake',
                type: 'create_order',
                mode: actionMode === 'execute' ? 'execute' : 'draft',
                payload: values
            });
        }
    }

    if (rawType === 'intake.lead' || normalizedType === 'intake_lead' || (rawType === 'ui.form_submit' && entity === 'leads' && isCreateForm)) {
        const values = payload.values || payload.data || {};
        const lead = buildLeadPayload(values);
        if (!hasLeadContact(lead)) {
            responses.push({ agent: 'intake', errors: ['Lead name or contact is required'], missingFields: ['name', 'contact'] });
        } else {
            actions.push({
                agentKey: 'intake',
                type: 'create_lead',
                mode: actionMode === 'execute' ? 'execute' : 'draft',
                payload: values
            });
        }
    }

    if (normalizedType === 'lead_created' || rawType === 'lead.created') {
        const leadId = parseTenantId(payload.leadId || payload.id);
        responses.push({
            agent: 'intake',
            message: 'Lead captured. Suggested next steps: add tags and set status.',
            suggestions: ['Add tags for routing', 'Move to contacted', 'Set follow-up reminder']
        });
        if (leadId) {
            actions.push({
                agentKey: 'intake',
                type: 'update_lead_status',
                mode: 'draft',
                payload: { leadId, status: 'contacted' }
            });
            actions.push({
                agentKey: 'intake',
                type: 'add_lead_tags',
                mode: 'draft',
                payload: { leadId, tags: ['follow-up'] }
            });
        }
    }

    if (rawType === 'ui.page_view' || normalizedType === 'page_view' || normalizedType === 'lead_stuck_check') {
        const staleLeads = await dbAll(
            `SELECT id, name, company, email, status, updated_at
             FROM leads
             WHERE tenant_id = ? AND deleted_at IS NULL AND status = 'new'
               AND updated_at < datetime('now', '-7 days')
             ORDER BY updated_at ASC
             LIMIT 3`,
            [context.tenantId]
        );
        if (staleLeads.length) {
            const leadLabels = staleLeads.map((lead) => lead.name || lead.company || lead.email || `Lead #${lead.id}`);
            responses.push({
                agent: 'exception',
                message: 'Some leads are stuck in new for 7+ days.',
                suggestions: leadLabels
            });
        }
    }

    if (normalizedType === 'system_exception' || normalizedType === 'system_missing_data') {
        responses.push({
            agent: 'exception',
            message: payload.message || 'Detected missing or blocked data.',
            suggestions: payload.suggestions || ['Verify required fields', 'Check tenant permissions', 'Retry the action']
        });
    }

    if (rawType === 'support.requested' || normalizedType === 'need_help' || normalizedType === 'support_requested') {
        actions.push({
            agentKey: 'support-triage',
            type: 'create_support_ticket',
            mode: actionMode === 'execute' ? 'execute' : 'draft',
            payload
        });
    }

    const actionResults = actions.length
        ? await runActionEngine(actions, context)
        : [];
    return { responses, actions: actionResults };
};

const buildSuggestionsFromResponses = (responses = []) => {
    const suggestions = [];
    responses.forEach((response) => {
        if (!response || !response.agent) return;
        if (response.agent === 'welcome') {
            const steps = Array.isArray(response.nextSteps) ? response.nextSteps : [];
            const message = [response.message, steps.length ? `Next steps: ${steps.join(', ')}` : '']
                .filter(Boolean)
                .join('\n');
            suggestions.push({
                title: 'Welcome to Portal Global',
                message,
                mode: 'suggest',
                actions: []
            });
            return;
        }

        if (response.agent === 'ui-coach' && Array.isArray(response.tips)) {
            response.tips.forEach((tip) => {
                suggestions.push({
                    title: tip.title || 'Next step',
                    message: tip.message || '',
                    mode: 'suggest',
                    actions: tip.anchor
                        ? [{ type: 'navigate', label: 'Open section', href: tip.anchor, mode: 'suggest' }]
                        : []
                });
            });
            return;
        }

        if (response.agent === 'form-helper' && Array.isArray(response.hints)) {
            const hintLines = response.hints.map((hint) => hint.example
                ? `${hint.field}: ${hint.example}`
                : hint.field);
            suggestions.push({
                title: 'Fix form fields',
                message: hintLines.length ? hintLines.join('\n') : 'Check the missing fields.',
                mode: 'draft',
                actions: []
            });
            return;
        }

        if (response.agent === 'intake') {
            const errors = Array.isArray(response.errors) ? response.errors : [];
            const missing = Array.isArray(response.missingFields) ? response.missingFields : [];
            const message = [
                errors.length ? `Issues: ${errors.join(', ')}` : '',
                missing.length ? `Missing: ${missing.join(', ')}` : '',
                response.message || ''
            ].filter(Boolean).join('\n');
            suggestions.push({
                title: 'Intake guidance',
                message: message || 'Review the lead or order details.',
                mode: 'suggest',
                actions: []
            });
            return;
        }

        if (response.agent === 'exception') {
            const suggestionList = Array.isArray(response.suggestions) ? response.suggestions : [];
            const message = [response.message, suggestionList.length ? `Suggestions: ${suggestionList.join(', ')}` : '']
                .filter(Boolean)
                .join('\n');
            suggestions.push({
                title: 'Exception detected',
                message,
                mode: 'suggest',
                actions: []
            });
        }
    });
    return suggestions;
};

const buildSuggestionsFromActions = (actions = []) => {
    const titleMap = {
        create_order: 'Create order',
        create_lead: 'Create lead',
        create_support_ticket: 'Create support ticket',
        update_lead_status: 'Update lead status',
        add_lead_tags: 'Add lead tags'
    };
    return actions
        .filter((action) => ['draft', 'suggested'].includes(action.status))
        .map((action) => ({
            title: titleMap[action.type] || 'Suggested action',
            message: action.status === 'draft'
                ? 'Draft action ready to apply.'
                : 'Suggested action ready to execute.',
            mode: action.mode || 'suggest',
            actions: [
                {
                    actionId: action.id,
                    type: action.type,
                    mode: action.mode || 'suggest',
                    label: action.mode === 'draft' ? 'Apply draft' : 'Execute'
                }
            ]
        }));
};

const handleAgentEvent = async (req, res, { defaultType } = {}) => {
    try {
        const { type, eventType, payload, source, actionMode, mode, confirm } = req.body || {};
        const normalizedType = String(type || eventType || defaultType || '').trim();
        if (!normalizedType) {
            return sendError(res, 400, 'Invalid input', 'Event type is required');
        }
        const requestedMode = normalizeActionMode(actionMode || mode || 'suggest');
        if (requestedMode === 'execute' && !confirm) {
            return sendError(res, 400, 'Confirmation required', 'Execute mode requires confirmation');
        }
        const eventPayload = payload && typeof payload === 'object'
            ? payload
            : (payload ? { value: payload } : {});
        const eventSource = source ? String(source).trim() : 'ui';
        const event = {
            type: normalizedType,
            payload: eventPayload,
            source: eventSource,
            actionMode: requestedMode
        };
        if (event.type === 'ui.page_view' && !event.payload?.page) {
            event.payload.page = '/app';
        }
        const eventId = await recordAgentEvent({
            tenantId: req.tenantId,
            userId: req.user.id,
            eventType: event.type,
            source: event.source,
            payload: event.payload
        });
        const result = await runAgentOrchestrator(event, {
            user: req.user,
            tenantId: req.tenantId,
            tenant: req.tenant || null,
            tenantRole: req.tenantRole || null,
            plan: req.plan
        });
        const suggestionPayloads = [
            ...buildSuggestionsFromResponses(result.responses || []),
            ...buildSuggestionsFromActions(result.actions || [])
        ];
        const storedSuggestions = [];
        for (const suggestion of suggestionPayloads) {
            const suggestionId = await recordAgentSuggestion({
                tenantId: req.tenantId,
                userId: req.user.id,
                eventId,
                title: suggestion.title,
                message: suggestion.message,
                actions: suggestion.actions || [],
                mode: suggestion.mode || 'suggest'
            });
            storedSuggestions.push({ id: suggestionId, ...suggestion });
        }
        return sendOk(res, {
            event: {
                type: event.type,
                source: event.source
            },
            responses: result.responses || [],
            actions: result.actions || [],
            suggestions: storedSuggestions
        });
    } catch (error) {
        console.error('Agent event error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to process agent event');
    }
};

const ensurePlans = async () => {
    for (const plan of PLAN_DEFINITIONS) {
        await dbRun(
            'INSERT OR IGNORE INTO plans (code, name, price_month, limits_json) VALUES (?, ?, ?, ?)',
            [plan.code, plan.name, plan.priceMonth, JSON.stringify(plan.limits)]
        );
        await dbRun(
            'UPDATE plans SET name = ?, price_month = ?, limits_json = ? WHERE code = ?',
            [plan.name, plan.priceMonth, JSON.stringify(plan.limits), plan.code]
        );
    }
};

const ensureSubscriptions = async () => {
    const users = await dbAll('SELECT id FROM users');
    for (const user of users) {
        const existing = await dbGet(
            'SELECT id FROM subscriptions WHERE user_id = ? AND status = ? LIMIT 1',
            [user.id, 'active']
        );
        if (!existing) {
            await dbRun(
                `INSERT INTO subscriptions (user_id, plan_code, status, current_period_end)
                 VALUES (?, 'free', 'active', datetime('now', '+30 days'))`,
                [user.id]
            );
        }
    }
};

const ensureWorkspaceForUser = async (user) => {
    if (!user?.id) return null;
    if (user.workspace_id) {
        const existingMembership = await dbGet(
            'SELECT id FROM workspace_members WHERE user_id = ? AND workspace_id = ? LIMIT 1',
            [user.id, user.workspace_id]
        );
        if (!existingMembership) {
            await dbRun(
                'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
                [user.workspace_id, user.id, 'owner']
            );
        }
        return user.workspace_id;
    }

    const workspaceName = `${user.email} Workspace`;
    const workspaceResult = await dbRun(
        'INSERT INTO workspaces (name) VALUES (?)',
        [workspaceName]
    );
    await dbRun('UPDATE users SET workspace_id = ? WHERE id = ?', [workspaceResult.id, user.id]);
    await dbRun(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
        [workspaceResult.id, user.id, 'owner']
    );
    return workspaceResult.id;
};

const ensureWorkspaces = async () => {
    const users = await dbAll('SELECT id, email, workspace_id FROM users');
    for (const user of users) {
        await ensureWorkspaceForUser(user);
    }
};

const migrateOwnerIds = async (defaultOwnerId) => {
    const tables = ['clients', 'projects', 'providers', 'orders', 'leads'];
    for (const table of tables) {
        const hasUserId = await hasColumn(table, 'user_id');
        if (hasUserId) {
            await dbRun(
                `UPDATE ${table}
                 SET owner_id = COALESCE(owner_id, user_id, ?)
                 WHERE owner_id IS NULL`,
                [defaultOwnerId]
            );
        } else {
            await dbRun(
                `UPDATE ${table}
                 SET owner_id = COALESCE(owner_id, ?)
                 WHERE owner_id IS NULL`,
                [defaultOwnerId]
            );
        }
    }
};

const initDb = async () => {
    await dbRun('PRAGMA foreign_keys = ON');

    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_superadmin INTEGER NOT NULL DEFAULT 0,
            active_tenant_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS workspaces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
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
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS tenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS tenant_memberships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(tenant_id, user_id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS tenant_admin_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            requested_at TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_at TEXT,
            reviewed_by INTEGER,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (reviewed_by) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS tenant_invites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            token TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            accepted_at TEXT,
            created_by INTEGER,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            price_month REAL NOT NULL DEFAULT 0,
            limits_json TEXT NOT NULL DEFAULT '{}'
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            plan_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            current_period_end TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (plan_code) REFERENCES plans(code)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER,
            name TEXT NOT NULL,
            mrr REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            created_by INTEGER,
            owner_id INTEGER,
            name TEXT,
            company TEXT,
            email TEXT,
            phone TEXT,
            source TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            tags_json TEXT,
            notes TEXT,
            deleted_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER,
            name TEXT NOT NULL,
            services TEXT NOT NULL DEFAULT '[]',
            payout_rate REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER,
            name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'general',
            status TEXT NOT NULL DEFAULT 'Planning',
            progress INTEGER NOT NULL DEFAULT 0,
            due TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            order_type TEXT DEFAULT 'delivery',
            status TEXT NOT NULL DEFAULT 'new',
            priority TEXT NOT NULL DEFAULT 'normal',
            address_from TEXT,
            address_to TEXT,
            scheduled_at TEXT,
            delivered_at TEXT,
            deleted_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS couriers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'offline',
            vehicle_type TEXT NOT NULL DEFAULT 'car',
            rating REAL NOT NULL DEFAULT 5,
            deleted_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS order_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL,
            order_id INTEGER NOT NULL,
            courier_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'assigned',
            assigned_at TEXT,
            accepted_at TEXT,
            completed_at TEXT
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sku TEXT,
            location TEXT,
            quantity INTEGER NOT NULL DEFAULT 0,
            reserved INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            updated_at TEXT,
            deleted_at TEXT
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS inventory_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            qty INTEGER NOT NULL,
            ref_order_id INTEGER,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS errands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            details TEXT,
            address TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            courier_id INTEGER,
            scheduled_at TEXT,
            done_at TEXT,
            deleted_at TEXT
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS ai_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            entity TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            entity TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            meta_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            key_type TEXT NOT NULL,
            key_hash TEXT NOT NULL,
            key_salt TEXT NOT NULL,
            key_preview TEXT,
            created_by_user_id INTEGER,
            last_used_at INTEGER,
            created_at INTEGER NOT NULL,
            revoked_at INTEGER
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS agent_tokens (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            token_salt TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            revoked_at INTEGER,
            last_seen_at INTEGER,
            machine_json TEXT
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS automations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            trigger TEXT NOT NULL DEFAULT 'interval',
            config_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER,
            last_run_at INTEGER
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS usage_counters (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            period TEXT NOT NULL,
            metric TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            UNIQUE(workspace_id, period, metric)
        )
    `);
    await ensureColumn('users', 'email', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn('users', 'password_hash', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn('users', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
    await ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
    await ensureColumn('users', 'is_superadmin', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('users', 'onboarding_completed', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('users', 'workspace_id', 'INTEGER');
    await ensureColumn('users', 'active_tenant_id', 'INTEGER');
    await ensureColumn('users', 'welcome_seen_at', 'TEXT');
    await ensureColumn('clients', 'owner_id', 'INTEGER');
    await ensureColumn('clients', 'tenant_id', 'INTEGER');
    await ensureColumn('leads', 'owner_id', 'INTEGER');
    await ensureColumn('leads', 'tenant_id', 'INTEGER');
    await ensureColumn('projects', 'owner_id', 'INTEGER');
    await ensureColumn('projects', 'tenant_id', 'INTEGER');
    await ensureColumn('providers', 'owner_id', 'INTEGER');
    await ensureColumn('providers', 'tenant_id', 'INTEGER');
    await ensureColumn('orders', 'owner_id', 'INTEGER');
    await ensureColumn('orders', 'tenant_id', 'INTEGER');
    await ensureColumn('order_assignments', 'tenant_id', 'INTEGER');
    await ensureColumn('ai_requests', 'user_id', 'INTEGER');
    await ensureColumn('ai_requests', 'tenant_id', 'INTEGER');
    await ensureColumn('audit_log', 'tenant_id', 'INTEGER');
    await ensureColumn('tenants', 'plan_code', 'TEXT');
    await ensureColumn('tenants', 'owner_user_id', 'INTEGER');
    await ensureColumn('tenants', 'created_at_unix', 'INTEGER');
    await ensureColumn('audit_logs', 'actor_type', 'TEXT');
    await ensureColumn('audit_logs', 'actor_user_id', 'INTEGER');
    await ensureColumn('audit_logs', 'ip', 'TEXT');
    await ensureColumn('audit_logs', 'ua', 'TEXT');
    await ensureColumn('audit_logs', 'created_at_unix', 'INTEGER');
    
    await ensureColumn('subscriptions', 'stripe_customer_id', 'TEXT');
    await ensureColumn('subscriptions', 'stripe_subscription_id', 'TEXT');
    await ensureColumn('projects', 'notes', 'TEXT');
    await ensureColumn('clients', 'notes', 'TEXT');
    await ensureColumn('leads', 'name', 'TEXT');
    await ensureColumn('leads', 'company', 'TEXT');
    await ensureColumn('leads', 'email', 'TEXT');
    await ensureColumn('leads', 'phone', 'TEXT');
    await ensureColumn('leads', 'source', 'TEXT');
    await ensureColumn('leads', 'status', "TEXT NOT NULL DEFAULT 'new'");
    await ensureColumn('leads', 'tags_json', 'TEXT');
    await ensureColumn('leads', 'created_by', 'INTEGER');
    await ensureColumn('leads', 'contact', 'TEXT');
    await ensureColumn('leads', 'notes', 'TEXT');
    await ensureColumn('projects', 'deleted_at', 'TEXT');
    await ensureColumn('clients', 'deleted_at', 'TEXT');
    await ensureColumn('leads', 'deleted_at', 'TEXT');
    await ensureColumn('providers', 'deleted_at', 'TEXT');
    await ensureColumn('orders', 'deleted_at', 'TEXT');
    await ensureColumn('leads', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
    await ensureColumn('leads', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
    await ensureColumn('orders', 'order_type', "TEXT DEFAULT 'delivery'");
    await ensureColumn('orders', 'address_from', 'TEXT');
    await ensureColumn('orders', 'address_to', 'TEXT');
    await ensureColumn('orders', 'scheduled_at', 'TEXT');
    await ensureColumn('orders', 'delivered_at', 'TEXT');
    await ensureColumn('couriers', 'status', "TEXT NOT NULL DEFAULT 'offline'");
    await ensureColumn('couriers', 'vehicle_type', "TEXT NOT NULL DEFAULT 'car'");
    await ensureColumn('couriers', 'rating', 'REAL NOT NULL DEFAULT 5');
    await ensureColumn('couriers', 'deleted_at', 'TEXT');
    await ensureColumn('couriers', 'tenant_id', 'INTEGER');
    await ensureColumn('inventory_items', 'sku', 'TEXT');
    await ensureColumn('inventory_items', 'location', 'TEXT');
    await ensureColumn('inventory_items', 'quantity', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('inventory_items', 'reserved', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('inventory_items', 'notes', 'TEXT');
    await ensureColumn('inventory_items', 'updated_at', 'TEXT');
    await ensureColumn('inventory_items', 'deleted_at', 'TEXT');
    await ensureColumn('inventory_items', 'tenant_id', 'INTEGER');
    await ensureColumn('inventory_movements', 'tenant_id', 'INTEGER');
    await ensureColumn('errands', 'details', 'TEXT');
    await ensureColumn('errands', 'address', 'TEXT');
    await ensureColumn('errands', 'status', "TEXT NOT NULL DEFAULT 'new'");
    await ensureColumn('errands', 'courier_id', 'INTEGER');
    await ensureColumn('errands', 'scheduled_at', 'TEXT');
    await ensureColumn('errands', 'done_at', 'TEXT');
    await ensureColumn('errands', 'deleted_at', 'TEXT');
    await ensureColumn('errands', 'tenant_id', 'INTEGER');
    await ensureColumn('workspaces', 'name', 'TEXT');
    await ensureColumn('workspace_members', 'role', "TEXT NOT NULL DEFAULT 'member'");
    
    await dbRun(`
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            tenant_id INTEGER,
            message TEXT NOT NULL,
            page TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await ensureColumn('feedback', 'tenant_id', 'INTEGER');
    
    await dbRun(`
        CREATE TABLE IF NOT EXISTS kb_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            author_user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            content TEXT NOT NULL,
            tags_json TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT,
            published_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (author_user_id) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS agent_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            source TEXT NOT NULL,
            payload_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS agent_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            agent_key TEXT NOT NULL,
            action_type TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'suggest',
            status TEXT NOT NULL DEFAULT 'pending',
            payload_json TEXT,
            result_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    
    await ensureColumn('agent_events', 'context_json', 'TEXT');
    await ensureColumn('agent_events', 'correlation_id', 'TEXT');
    await ensureColumn('agent_actions', 'correlation_id', 'TEXT');
    await ensureColumn('agent_actions', 'actor_agent', 'TEXT');
    await ensureColumn('agent_actions', 'request_json', 'TEXT');
    
    await dbRun(`
        CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            correlation_id TEXT NOT NULL,
            sender_agent TEXT NOT NULL,
            target_agent TEXT,
            role TEXT NOT NULL DEFAULT 'agent',
            severity TEXT NOT NULL DEFAULT 'info',
            message TEXT NOT NULL,
            payload_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS agent_heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            agent_id TEXT NOT NULL,
            hostname TEXT,
            last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
            first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
            meta_json TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS agent_suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            event_id INTEGER,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            actions_json TEXT,
            mode TEXT NOT NULL DEFAULT 'suggest',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (event_id) REFERENCES agent_events(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            created_by INTEGER NOT NULL,
            assigned_to INTEGER,
            subject TEXT NOT NULL,
            body TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (assigned_to) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS support_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            requester_user_id INTEGER NOT NULL,
            assigned_user_id INTEGER,
            subject TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            priority TEXT NOT NULL DEFAULT 'normal',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (requester_user_id) REFERENCES users(id),
            FOREIGN KEY (assigned_user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS financial_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            tags_json TEXT,
            tags TEXT,
            source TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await dbRun(`
        CREATE TABLE IF NOT EXISTS email_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER,
            [to] TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT,
            body_html TEXT,
            html TEXT,
            text TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            last_attempt_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            sent_at TEXT
        )
    `);

    await ensureColumn('financial_events', 'tenant_id', 'INTEGER');
    await ensureColumn('financial_events', 'user_id', 'INTEGER');
    await ensureColumn('financial_events', 'type', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn('financial_events', 'amount', 'REAL NOT NULL DEFAULT 0');
    await ensureColumn('financial_events', 'currency', `TEXT NOT NULL DEFAULT '${DEFAULT_CURRENCY}'`);
    await ensureColumn('financial_events', 'tags_json', 'TEXT');
    await ensureColumn('financial_events', 'tags', 'TEXT');
    await ensureColumn('financial_events', 'source', 'TEXT');
    await ensureColumn('financial_events', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

    await ensureColumn('email_outbox', 'tenant_id', 'INTEGER');
    await ensureColumn('email_outbox', 'body', 'TEXT');
    await ensureColumn('email_outbox', 'body_html', 'TEXT');
    await ensureColumn('email_outbox', 'html', 'TEXT');
    await ensureColumn('email_outbox', 'text', 'TEXT');
    await ensureColumn('email_outbox', 'status', "TEXT NOT NULL DEFAULT 'pending'");
    await ensureColumn('email_outbox', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('email_outbox', 'last_error', 'TEXT');
    await ensureColumn('email_outbox', 'last_attempt_at', 'TEXT');
    await ensureColumn('email_outbox', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
    await ensureColumn('email_outbox', 'sent_at', 'TEXT');

    await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_code ON plans(code)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(name)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tenant_memberships_role ON tenant_memberships(tenant_id, role)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tenant_admin_requests_tenant ON tenant_admin_requests(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tenant_admin_requests_user ON tenant_admin_requests(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tenant_invites_email ON tenant_invites(email)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_leads_owner_status ON leads(owner_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON leads(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_providers_owner ON providers(owner_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_providers_tenant ON providers(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_owner_status ON orders(owner_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_owner_type ON orders(owner_id, order_type)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_orders_tenant_type ON orders(tenant_id, order_type)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_couriers_owner_status ON couriers(owner_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_couriers_tenant_status ON couriers(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_inventory_owner_sku ON inventory_items(owner_id, sku)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_inventory_tenant_sku ON inventory_items(tenant_id, sku)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_errands_owner_status ON errands(owner_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_errands_tenant_status ON errands(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_order_assign_owner_order ON order_assignments(owner_id, order_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_order_assign_tenant_order ON order_assignments(tenant_id, order_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_financial_events_tenant_created ON financial_events(tenant_id, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_financial_events_type ON financial_events(type)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_financial_events_user ON financial_events(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_suggestions_tenant_created ON agent_suggestions(tenant_id, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_suggestions_user_created ON agent_suggestions(user_id, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_workspaces_id ON workspaces(id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_feedback_tenant ON feedback(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant ON kb_articles(tenant_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_kb_articles_status ON kb_articles(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_events_tenant_created ON agent_events(tenant_id, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_actions_tenant_status ON agent_actions(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_actions_user ON agent_actions(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_events_corr ON agent_events(tenant_id, correlation_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_actions_corr ON agent_actions(tenant_id, correlation_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_messages_corr ON agent_messages(tenant_id, correlation_id, created_at)');
    await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_heartbeats_tenant_agent ON agent_heartbeats(tenant_id, agent_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_tenant_seen ON agent_heartbeats(tenant_id, last_seen_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_suggestions_tenant_created ON agent_suggestions(tenant_id, created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_suggestions_user ON agent_suggestions(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status ON support_tickets(tenant_id, status)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee ON support_tickets(assigned_user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_agent_tokens_workspace ON agent_tokens(workspace_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_automations_workspace ON automations(workspace_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_usage_counters_workspace ON usage_counters(workspace_id, period)');

    await loadUserColumnFlags();
    await ensurePlans();
    const defaultOwnerId = await ensureDefaultUser();
    await migrateOwnerIds(defaultOwnerId);
    await ensureSubscriptions();
    await ensureTenants();
    await ensureTenantOwners();
    await ensureTenantPlans();
    await syncSuperadmins();
    await dbRun("UPDATE tenant_memberships SET role = 'member' WHERE role = 'user'");
    await dbRun("UPDATE tenant_invites SET role = 'member' WHERE role = 'user'");
    await migrateTenantIds();
    await dbRun('UPDATE leads SET created_by = COALESCE(created_by, owner_id) WHERE created_by IS NULL');
    await dbRun("UPDATE users SET role = 'user' WHERE role IS NULL OR role = ''");
    await dbRun('UPDATE users SET onboarding_completed = 0 WHERE onboarding_completed IS NULL');
    await ensureAdminAutofill();
};

// ========== SECURITY MIDDLEWARE ==========
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));

// Security middleware
app.use((req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent content type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    next();
});

// Force HTTPS in production
if (isProd && process.env.FORCE_HTTPS !== 'false') {
    app.use((req, res, next) => {
        const xfProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
        const isHttps = xfProto === 'https' || req.protocol === 'https';
        
        if (!isHttps) {
            const host = req.headers['x-forwarded-host'] || req.headers.host || req.hostname;
            return res.redirect(301, `https://${host}${req.url}`);
        }
        next();
    });
}

if (!isProd) {
    app.use(morgan('dev'));
}

app.use(compression());

// CORS configuration
const parseAllowedOrigins = (value) => value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || '');
const devAllowedOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'];
const isLocalOrigin = (origin) => (
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    || /^http:\/\/\[::1\](:\d+)?$/.test(origin)
);
const activeAllowedOrigins = isProd
    ? allowedOrigins
    : (allowedOrigins.length > 0 ? allowedOrigins : devAllowedOrigins);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }

        if (!isProd && isLocalOrigin(origin)) {
            return callback(null, true);
        }

        if (activeAllowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Access-Token',
        'X-Auth-Token',
        'X-Webhook-Token',
        'X-Tenant-Id',
        'X-Portal-Key',
        'X-Portal-Agent'
    ]
};

if (!isProd || allowedOrigins.length > 0) {
    app.use(cors(corsOptions));
}

// Rate limiting for API
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 100);
const AUTH_ME_RATE_LIMIT_MAX = Number(process.env.AUTH_ME_RATE_LIMIT_MAX || 30);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);

const createRateLimiter = (max, windowMs, message) => rateLimit({
    windowMs: Number.isFinite(windowMs) ? windowMs : 15 * 60 * 1000,
    max: Number.isFinite(max) ? max : 100,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || 
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
               req.headers['x-real-ip'] || 
               'unknown';
    }
});

const apiLimiter = createRateLimiter(
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    'Too many requests from this IP, please try again later.'
);

const authMeLimiter = createRateLimiter(
    AUTH_ME_RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    'Too many authentication requests, please try again later.'
);

const loginLimiter = createRateLimiter(
    LOGIN_RATE_LIMIT_MAX,
    5 * 60 * 1000,
    'Too many login attempts, please try again later.'
);

const feedbackLimiter = createRateLimiter(
    FEEDBACK_RATE_LIMIT_MAX,
    60 * 1000,
    'Too many feedback submissions, please try again later.'
);

if (RATE_LIMIT_ENABLED) {
    app.use('/api', apiLimiter);
}

// Body parsing middleware with size limits
app.use(express.json({ limit: BODY_SIZE_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));

// Request logging
app.use(requestLogger);

// ========== API ROUTES ==========
const publicApiRoutes = express.Router();

// Community mode guard for API
publicApiRoutes.use(communityGuard);

publicApiRoutes.get('/feature-flags', (req, res) => {
    return sendOk(res, {
        communityMode: COMMUNITY_MODE,
        autopilotEnabled: AUTOPILOT_ENABLED,
        externalLlmEnabled: EXTERNAL_LLM_ENABLED,
        pollingIntervalMs: POLLING_INTERVAL_MS,
        rateLimitEnabled: RATE_LIMIT_ENABLED
    });
});

publicApiRoutes.post('/feedback', feedbackLimiter, async (req, res) => {
    const requestId = req.requestId || Math.random().toString(36).substring(2, 15);
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.id || null;
    
    console.log(JSON.stringify({
        type: 'FEEDBACK_START',
        requestId,
        ip: clientIp,
        userId,
        method: req.method,
        path: req.path
    }));
    
    try {
        const { message, page, email, website } = req.body || {};
        
        if (website) {
            console.log(JSON.stringify({ type: 'FEEDBACK_HONEYPOT', requestId, ip: clientIp }));
            return sendOk(res, { id: null, message: 'Feedback submitted successfully' });
        }
        
        if (!message || String(message).trim().length < 3) {
            return sendError(res, 400, 'Invalid input', 'Feedback message is required (min 3 chars)');
        }
        
        const trimmedMessage = String(message).trim();
        if (trimmedMessage.length > 2000) {
            return sendError(res, 400, 'Invalid input', 'Feedback message is too long (max 2000 characters)');
        }
        
        const pageValue = page ? String(page).trim() : null;
        const emailValue = email ? String(email).trim() : null;
        
        let tenantId = null;
        if (req.user?.id) {
            tenantId = req.tenantId;
        }
        
        try {
            const result = await dbRun(
                'INSERT INTO feedback (user_id, tenant_id, message, page) VALUES (?, ?, ?, ?)',
                [userId, tenantId, trimmedMessage, pageValue]
            );
            
            console.log(JSON.stringify({
                type: 'FEEDBACK_SUCCESS',
                requestId,
                userId,
                feedbackId: result.id,
                messageLength: trimmedMessage.length
            }));
            
            return res.status(201).json({
                ok: true,
                data: { id: result.id, message: 'Feedback submitted successfully' }
            });
        } catch (dbError) {
            console.error(JSON.stringify({
                type: 'FEEDBACK_DB_ERROR',
                requestId,
                error: dbError.message,
                code: dbError.code
            }));
            
            const feedbackDir = path.join(__dirname, 'data');
            if (!fs.existsSync(feedbackDir)) {
                fs.mkdirSync(feedbackDir, { recursive: true });
            }
            
            const fallbackPath = path.join(feedbackDir, 'feedback.ndjson');
            
            if (fs.existsSync(fallbackPath)) {
                const stats = fs.statSync(fallbackPath);
                const MAX_FALLBACK_SIZE = 10 * 1024 * 1024;
                if (stats.size > MAX_FALLBACK_SIZE) {
                    const timestamp = Date.now();
                    const rotatedPath = path.join(feedbackDir, `feedback.ndjson.${timestamp}`);
                    fs.renameSync(fallbackPath, rotatedPath);
                    console.log(JSON.stringify({
                        type: 'FEEDBACK_ROTATED',
                        oldPath: fallbackPath,
                        newPath: rotatedPath,
                        size: stats.size
                    }));
                }
            }
            
            const fallbackEntry = {
                ts: new Date().toISOString(),
                requestId,
                ip: clientIp,
                userId,
                tenantId,
                message: trimmedMessage,
                page: pageValue,
                email: emailValue,
                error: dbError.message
            };
            
            fs.appendFileSync(fallbackPath, JSON.stringify(fallbackEntry) + '\n');
            
            console.log(JSON.stringify({
                type: 'FEEDBACK_FALLBACK',
                requestId,
                savedTo: fallbackPath
            }));
            
            return res.status(202).json({
                ok: true,
                data: { id: null, message: 'Feedback queued for processing' },
                warning: 'Stored offline due to database issue'
            });
        }
    } catch (error) {
        console.error(JSON.stringify({
            type: 'FEEDBACK_ERROR',
            requestId,
            error: error.message,
            stack: process.env.HIDE_STACKTRACES !== '1' ? error.stack : undefined
        }));
        return sendError(res, 500, 'Internal server error', 'Failed to submit feedback');
    }
});

publicApiRoutes.get('/users/me', authMeLimiter, async (req, res, next) => {
    if (!req.user) {
        if (COMMUNITY_MODE) {
            return sendOk(res, {
                user: null,
                userId: null,
                email: null,
                isSuperadmin: false,
                role: null,
                userRole: null,
                plan: null,
                memberships: [],
                activeTenantId: null,
                tenantRole: null,
                communityMode: true,
                autopilotEnabled: AUTOPILOT_ENABLED,
                isGuest: true
            });
        }
        return sendError(res, 401, 'Unauthorized', 'Not authenticated');
    }
    
    const userId = req.user.id;
    const cached = getAuthCache(userId);
    if (cached) {
        return sendOk(res, { ...cached, isGuest: false });
    }
    
    const tenantRole = req.activeMembership?.role || null;
    const userRole = req.user?.role || tenantRole || null;
    const email = req.user?.email || null;
    const isSuperadmin = Boolean(req.user?.isSuperadmin || req.user?.is_superadmin);
    const responseData = {
        user: {
            ...(req.user || {}),
            role: userRole
        },
        userId,
        email,
        isSuperadmin,
        role: userRole,
        userRole,
        plan: req.plan,
        memberships: req.memberships || [],
        activeTenantId: req.activeTenantId || null,
        tenantRole,
        communityMode: COMMUNITY_MODE,
        autopilotEnabled: AUTOPILOT_ENABLED,
        isGuest: false
    };
    
    setAuthCache(userId, responseData);
    return sendOk(res, responseData);
});

const apiRoutes = express.Router();
const ownerApiRoutes = express.Router();
apiRoutes.use(requireTenant);

const autopilotRouter = createAutopilotRouter({
    engine: autopilotEngine,
    storage: autopilotStorage,
    sendOk,
    sendError,
    logAudit,
    normalizeEmail,
    requireRole,
    requirePlan
});
apiRoutes.use('/autopilot', autopilotRouter);

const agentRouter = createAgentRouter({
    dbAll,
    dbGet,
    dbRun,
    sendOk,
    sendError,
    nowUnix,
    logAudit,
    authorizeServiceKey,
    authorizeAgentToken,
    createAgentToken,
    ensureBusinessWorkspace
});
publicApiRoutes.use('/agent', agentRouter);

// Auth: register
publicApiRoutes.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !password) {
            return sendError(res, 400, 'Invalid input', 'Email and password are required');
        }
        if (String(password).length < 8) {
            return sendError(res, 400, 'Invalid password', 'Password must be at least 8 characters');
        }

        const existing = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing) {
            return sendError(res, 409, 'Already exists', 'Email already registered');
        }

        const bootstrapAdmin = !(await hasAnyAdmin());
        const shouldAdminRole = bootstrapAdmin || isSuperadminEmail(normalizedEmail);
        const passwordHash = await bcrypt.hash(String(password), 10);
        const result = await insertUser(normalizedEmail, passwordHash);
        if (shouldAdminRole) {
            await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [result.id]);
        }
        if (isSuperadminEmail(normalizedEmail)) {
            await dbRun('UPDATE users SET is_superadmin = 1 WHERE id = ?', [result.id]);
        }

        await dbRun(
            `INSERT INTO subscriptions (user_id, plan_code, status, current_period_end)
             VALUES (?, 'free', 'active', datetime('now', '+30 days'))`,
            [result.id]
        );

        const user = await dbGet('SELECT id, email, active_tenant_id, is_superadmin, created_at FROM users WHERE id = ?', [result.id]);
        const invite = await dbGet(
            `SELECT id, tenant_id, role
             FROM tenant_invites
             WHERE lower(email) = ? AND status = 'pending'
             ORDER BY created_at ASC
             LIMIT 1`,
            [normalizedEmail]
        );
        let activeTenantId = null;
        if (invite?.tenant_id) {
            const inviteRole = normalizeTenantRole(invite.role || 'member');
            const membershipRole = shouldAdminRole ? 'owner' : inviteRole;
            await ensureTenantMembership(invite.tenant_id, result.id, membershipRole);
            activeTenantId = invite.tenant_id;
            await dbRun(
                'UPDATE tenant_invites SET status = ?, accepted_at = datetime(\'now\') WHERE id = ?',
                ['accepted', invite.id]
            );
        } else {
            activeTenantId = await ensureTenantForUser(
                { id: user.id, email: user.email },
                shouldAdminRole ? 'owner' : 'member'
            );
        }
        if (activeTenantId && activeTenantId !== user.active_tenant_id) {
            await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [activeTenantId, user.id]);
        }
        const memberships = await getMembershipsForUser(result.id);
        const plan = await getPlanForUser(result.id);
        const token = await createSession(result.id);
        setSessionCookie(res, token);
        const activeMembership = memberships.find((membership) => membership.tenantId === activeTenantId) || null;
        const activeRole = activeMembership?.role || (isSuperadminEmail(normalizedEmail) ? 'superadmin' : 'user');
        const payload = {
            token,
            accessToken: token,
            user: {
                id: user.id,
                email: user.email,
                role: activeRole,
                is_superadmin: Boolean(user.is_superadmin || isSuperadminEmail(normalizedEmail)),
                isSuperadmin: Boolean(user.is_superadmin || isSuperadminEmail(normalizedEmail)),
                createdAt: user.created_at
            },
            plan,
            memberships,
            activeTenantId: activeTenantId || user.active_tenant_id || memberships[0]?.tenantId || null
        };
        return res.json({ ok: true, ...payload, data: payload });
    } catch (error) {
        console.error('Register error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to register user');
    }
});

// Auth: login
publicApiRoutes.post('/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !password) {
            return sendError(res, 400, 'Invalid input', 'Email and password are required');
        }

        const user = await dbGet(
            'SELECT id, email, role, is_superadmin, password_hash, active_tenant_id, created_at FROM users WHERE email = ?',
            [normalizedEmail]
        );
        if (!user) {
            return sendError(res, 401, 'Unauthorized', 'Invalid credentials');
        }

        const match = await bcrypt.compare(String(password), user.password_hash);
        if (!match) {
            return sendError(res, 401, 'Unauthorized', 'Invalid credentials');
        }

        const shouldBeSuperadmin = isSuperadminEmail(normalizedEmail);
        if (shouldBeSuperadmin && !user.is_superadmin) {
            await dbRun('UPDATE users SET is_superadmin = 1 WHERE id = ?', [user.id]);
            user.is_superadmin = 1;
        }

        const memberships = await getMembershipsForUser(user.id);
        let activeTenantId = parseTenantId(user.active_tenant_id) || memberships[0]?.tenantId || null;
        if (activeTenantId && activeTenantId !== user.active_tenant_id) {
            await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [activeTenantId, user.id]);
        }
        const activeMembership = memberships.find((membership) => membership.tenantId === activeTenantId) || null;
        const superadminFlag = Boolean(user.is_superadmin) || shouldBeSuperadmin;
        const activeRole = activeMembership?.role || (superadminFlag ? 'superadmin' : 'user');
        const token = await createSession(user.id);
        const plan = await getPlanForUser(user.id);
        setSessionCookie(res, token);
        const payload = {
            token,
            accessToken: token,
            user: {
                id: user.id,
                email: user.email,
                role: activeRole,
                is_superadmin: superadminFlag,
                isSuperadmin: superadminFlag,
                createdAt: user.created_at
            },
            plan,
            memberships,
            activeTenantId
        };
        return res.json({ ok: true, ...payload, data: payload });
    } catch (error) {
        console.error('Login error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to login');
    }
});

// Auth: logout
publicApiRoutes.post('/auth/logout', async (req, res) => {
    try {
        const token = getSessionToken(req);
        if (token) {
            await dbRun('DELETE FROM sessions WHERE token = ?', [token]);
        }
        clearSessionCookie(res);
        return sendOk(res, { signedOut: true });
    } catch (error) {
        console.error('Logout error:', error);
        clearSessionCookie(res);
        return sendOk(res, { signedOut: true });
    }
});

// Auth: me
publicApiRoutes.get('/auth/me', authMeLimiter, async (req, res, next) => {
    const userId = req.user?.id || null;
    
    if (userId) {
        const cached = getAuthCache(userId);
        if (cached) {
            return sendOk(res, cached);
        }
        
        let inFlight = getAuthInFlight(userId);
        if (!inFlight) {
            inFlight = Promise.resolve();
            setAuthInFlight(userId, inFlight);
        }
        
        try {
            await inFlight;
        } catch (e) {}
        
        const cachedAfter = getAuthCache(userId);
        if (cachedAfter) {
            return sendOk(res, cachedAfter);
        }
    }
    
    const tenantRole = req.activeMembership?.role || null;
    const userRole = req.user?.role || tenantRole || null;
    const email = req.user?.email || null;
    const isSuperadmin = Boolean(req.user?.isSuperadmin || req.user?.is_superadmin);
    const responseData = {
        user: {
            ...(req.user || {}),
            role: userRole
        },
        userId,
        email,
        isSuperadmin,
        role: userRole,
        userRole,
        plan: req.plan,
        memberships: req.memberships || [],
        activeTenantId: req.activeTenantId || null,
        tenantRole,
        communityMode: COMMUNITY_MODE,
        autopilotEnabled: AUTOPILOT_ENABLED
    };
    
    if (userId) {
        setAuthCache(userId, responseData);
    }
    
    return sendOk(res, responseData);
});

// Health check (lightweight)
publicApiRoutes.get('/health', async (req, res) => {
    try {
        const start = Date.now();
        await dbGet('SELECT 1 as ok');
        const dbTime = Date.now() - start;
        
        return sendOk(res, {
            ts: new Date().toISOString(),
            uptime: process.uptime(),
            env: process.env.NODE_ENV || 'development',
            mode: {
                community: COMMUNITY_MODE,
                autopilot: AUTOPILOT_ENABLED,
                rateLimit: RATE_LIMIT_ENABLED
            },
            db: { ok: true, latencyMs: dbTime }
        });
    } catch (error) {
        return sendError(res, 500, 'Database Error', 'Failed to access the database');
    }
});

publicApiRoutes.post('/leads/webhook', async (req, res) => {
    let webhookTenantId = null;
    let webhookOwnerId = null;
    try {
        const expectedToken = process.env.LEADS_WEBHOOK_TOKEN;
        if (!expectedToken) {
            return sendError(res, 403, 'Forbidden', 'Webhook token not configured');
        }
        const providedToken = req.headers['x-webhook-token'] || req.query?.token || req.body?.token;
        if (!providedToken || String(providedToken).trim() !== String(expectedToken).trim()) {
            return sendError(res, 403, 'Forbidden', 'Invalid webhook token');
        }
        const ownerId = await resolveLeadOwnerId(req.body || {});
        if (!ownerId) {
            return sendError(res, 404, 'Not Found', 'Lead owner not found');
        }
        webhookOwnerId = ownerId;
        const tenantId = await resolveLeadTenantId(ownerId, req.body || {});
        if (!tenantId) {
            return sendError(res, 404, 'Not Found', 'Lead tenant not found');
        }
        const plan = await getPlanForTenant(tenantId, ownerId);
        const usageCheck = await consumeUsage({ tenantId, plan, metric: 'leads', cost: 1 });
        if (!usageCheck.ok) {
            return rejectUpgrade(res, {
                planCode: plan?.code || 'free',
                metric: 'leads',
                limit: usageCheck.limit,
                used: usageCheck.used
            });
        }
        webhookTenantId = tenantId;
        const payload = buildLeadPayload(req.body || {});
        const status = parseLeadStatus(req.body?.status, 'new');
        if (!status) {
            return sendError(res, 400, 'Invalid status', `Status must be one of: ${LEAD_STATUSES.join(', ')}`);
        }
        const tagList = normalizeTags(req.body?.tags || req.body?.tag || req.body?.labels);
        const lead = {
            ...payload,
            source: payload.source || 'webhook',
            status
        };
        if (!hasLeadContact(lead)) {
            return sendError(res, 400, 'Invalid input', 'Lead name or contact is required');
        }
        const result = await dbRun(
            `INSERT INTO leads (name, contact, company, email, phone, source, status, tags_json, notes, owner_id, tenant_id, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
                lead.name || null,
                lead.contact || null,
                lead.company || null,
                lead.email || null,
                lead.phone || null,
                lead.source,
                lead.status,
                tagList.length ? JSON.stringify(tagList) : null,
                lead.notes || null,
                ownerId,
                tenantId,
                ownerId
            ]
        );
        const row = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ?', [result.id, tenantId]);
        await logAudit({ userId: ownerId, tenantId, entity: 'leads', action: 'create', entityId: result.id });
        await logAudit({
            userId: ownerId,
            tenantId,
            entity: 'webhook',
            action: 'inbound',
            entityId: result.id,
            meta: { type: 'leads', status: 'ok' }
        });
        return sendOk(res, {
            ...row,
            tags: normalizeTags(row?.tags_json)
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Webhook error';
        if (webhookTenantId && webhookOwnerId) {
            await logAudit({
                userId: webhookOwnerId,
                tenantId: webhookTenantId,
                entity: 'webhook',
                action: 'error',
                entityId: webhookTenantId,
                meta: { type: 'leads', error: message }
            });
        }
        console.error('Lead webhook error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create lead');
    }
});

// AI Project Generation
apiRoutes.post('/ai-project', requireRole('member'), requirePlan('ai_calls', 1), async (req, res) => {
    try {
        const { idea } = req.body || {};
        
        // Validation
        if (!idea || idea.trim().length < 3) {
            return sendError(res, 400, 'Invalid idea', 'Idea must be at least 3 characters long');
        }
        
        const projectName = String(idea)
            .split(/\s+/)
            .slice(0, 3)
            .join(' ') + ' Platform';
        
        const adjectives = ['Modern', 'Scalable', 'Enterprise', 'Cloud', 'AI-Powered'];
        const techStacks = ['MERN', 'Jamstack', 'Microservices', 'Serverless'];
        const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const randomTech = techStacks[Math.floor(Math.random() * techStacks.length)];
        
        await dbRun('INSERT INTO ai_requests (type, user_id, tenant_id) VALUES (?, ?, ?)', [
            'ai-project',
            req.user.id,
            req.tenantId
        ]);

        return sendOk(res, {
            projectName: `${randomAdjective} ${projectName}`,
            timeline: `${Math.floor(Math.random() * 3) + 2}-${Math.floor(Math.random() * 4) + 4} months`,
            teamSize: `${Math.floor(Math.random() * 5) + 3}-${Math.floor(Math.random() * 5) + 6}`,
            budget: `$${(Math.floor(Math.random() * 100) + 50)},000 - $${(Math.floor(Math.random() * 100) + 75)},000`,
            techStack: randomTech,
            risk: ['Low', 'Medium', 'High'][Math.floor(Math.random() * 3)],
            recommendations: [
                'Start with MVP and user testing',
                'Use agile development with 2-week sprints',
                'Implement CI/CD pipeline from day one',
                'Focus on core user flows first',
                'Plan for scalability from architecture phase'
            ]
        });
    } catch (error) {
        console.error('AI project error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to generate project');
    }
});

// Chat API
apiRoutes.post('/chat', requireRole('member'), requirePlan('ai_calls', 1), async (req, res) => {
    try {
        const { message, context } = req.body || {};
        
        // Validation
        if (!message || message.trim().length === 0) {
            return sendError(res, 400, 'Invalid message', 'Message cannot be empty');
        }
        
        // Simulate AI processing delay
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const responses = [
            `I understand you're asking about "${message}". In our portal, you can:`,
            `Thanks for your query about "${message}". Here's what I can help with:`,
            `Regarding "${message}", our portal supports the following actions:`
        ];
        
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        
        await dbRun('INSERT INTO ai_requests (type, user_id, tenant_id) VALUES (?, ?, ?)', [
            'chat',
            req.user.id,
            req.tenantId
        ]);

        return sendOk(res, {
            reply: `${randomResponse}\n1. Project planning and estimation\n2. Team allocation and resource management\n3. Client communication and reporting\n4. Technical implementation guidance\n5. Compliance and documentation support`,
            suggestions: [
                'Generate project timeline',
                'Estimate budget requirements',
                'Assign team members',
                'Create compliance checklist',
                'Set up client reporting'
            ],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Chat error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to process chat request');
    }
});

// Agent conversation events
apiRoutes.post('/agent/events', async (req, res) => {
    try {
        const { event_type: eventTypeRaw, eventType, context, source } = req.body || {};
        const eventTypeValue = String(eventTypeRaw || eventType || '').trim();
        if (!eventTypeValue) {
            return sendError(res, 400, 'Invalid input', 'event_type is required');
        }
        const contextValue = context && typeof context === 'object' ? context : {};
        const event = await createConversationEvent({
            tenantId: req.tenantId,
            userId: req.user.id,
            eventType: eventTypeValue,
            context: contextValue,
            source: source || 'agent-console'
        });
        return sendOk(res, { eventId: event.eventId, correlationId: event.correlationId });
    } catch (error) {
        console.error('Agent event create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create agent event');
    }
});

apiRoutes.post('/agent/dispatch', async (req, res) => {
    try {
        const { eventId, event_id: eventIdRaw, event_type: eventTypeRaw, eventType, context } = req.body || {};
        const parsedEventId = parseTenantId(eventId || eventIdRaw);
        let eventPayload = null;
        const engine = String(process.env.AGENTS_ENGINE || 'local').trim().toLowerCase();

        if (parsedEventId) {
            eventPayload = await getConversationEvent({ eventId: parsedEventId, tenantId: req.tenantId });
            if (!eventPayload) {
                return sendError(res, 404, 'Not Found', 'Event not found');
            }
        } else {
            const eventTypeValue = String(eventTypeRaw || eventType || '').trim();
            if (!eventTypeValue) {
                return sendError(res, 400, 'Invalid input', 'event_type or eventId is required');
            }
            const contextValue = context && typeof context === 'object' ? context : {};
            eventPayload = await createConversationEvent({
                tenantId: req.tenantId,
                userId: req.user.id,
                eventType: eventTypeValue,
                context: contextValue,
                source: 'agent-console'
            });
            eventPayload = {
                eventId: eventPayload.eventId,
                eventType: eventTypeValue,
                context: contextValue,
                correlationId: eventPayload.correlationId
            };
        }

        if (engine === 'crewai') {
            const crewOutput = await runCrewEngine({
                tenantId: String(req.tenantId),
                correlationId: eventPayload.correlationId,
                type: eventPayload.eventType,
                payload: eventPayload.context || {},
                meta: {
                    userId: req.user.id,
                    tenantRole: req.tenantRole || null,
                    tenantName: req.tenant?.name || null
                }
            });
            const crewCorrelationId = toSafeString(crewOutput?.correlationId) || eventPayload.correlationId;
            if (crewCorrelationId && eventPayload.eventId && crewCorrelationId !== eventPayload.correlationId) {
                await dbRun('UPDATE agent_events SET correlation_id = ? WHERE id = ?', [crewCorrelationId, eventPayload.eventId]);
            }

            const messages = Array.isArray(crewOutput?.messages) ? crewOutput.messages : [];
            for (const message of messages) {
                const payload = {
                    type: message.type || 'note',
                    data: message.data || {},
                    crewMessageId: message.id || null,
                    createdAt: message.createdAt || null
                };
                await recordConversationMessage({
                    tenantId: req.tenantId,
                    correlationId: crewCorrelationId,
                    senderAgent: message.agent || 'CrewAgent',
                    targetAgent: message.data?.target || null,
                    role: message.role || 'agent',
                    severity: message.data?.severity || 'info',
                    message: message.content || '',
                    payload
                });
            }

            const drafts = Array.isArray(crewOutput?.drafts) ? crewOutput.drafts : [];
            for (const draft of drafts) {
                await recordConversationMessage({
                    tenantId: req.tenantId,
                    correlationId: crewCorrelationId,
                    senderAgent: 'DraftActions',
                    targetAgent: 'User',
                    role: 'agent',
                    severity: 'info',
                    message: `Draft action: ${draft.title || draft.type || 'draft'}`,
                    payload: { type: 'draft_action', draft }
                });
            }

            const storedMessages = await loadConversationMessages(req.tenantId, crewCorrelationId, 150);
            const storedActions = await loadConversationActions(req.tenantId, crewCorrelationId, req.user, req.tenantRole);
            return res.json({
                ok: true,
                engine: 'crewai',
                tenantId: req.tenantId,
                correlationId: crewCorrelationId,
                data: {
                    eventId: eventPayload.eventId,
                    correlationId: crewCorrelationId,
                    messages: storedMessages,
                    actions: storedActions
                }
            });
        }

        await runConversationDispatch({
            eventType: eventPayload.eventType,
            context: eventPayload.context,
            correlationId: eventPayload.correlationId
        }, {
            tenantId: req.tenantId,
            userId: req.user.id,
            tenantRole: req.tenantRole,
            tenant: req.tenant,
            user: req.user
        });

        const messages = await loadConversationMessages(req.tenantId, eventPayload.correlationId, 150);
        const actions = await loadConversationActions(req.tenantId, eventPayload.correlationId, req.user, req.tenantRole);
        return sendOk(res, {
            eventId: eventPayload.eventId,
            correlationId: eventPayload.correlationId,
            messages,
            actions
        });
    } catch (error) {
        console.error('Agent dispatch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to dispatch agent event');
    }
});

apiRoutes.get('/agent/messages', async (req, res) => {
    try {
        const correlationId = toSafeString(req.query.correlationId || req.query.correlation_id);
        if (!correlationId) {
            return sendError(res, 400, 'Invalid input', 'correlationId is required');
        }
        const limitRaw = Number(req.query.limit || 100);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 100;
        const messages = await loadConversationMessages(req.tenantId, correlationId, limit);
        return sendOk(res, messages);
    } catch (error) {
        console.error('Agent messages fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load agent messages');
    }
});

apiRoutes.post('/agent/heartbeat', async (req, res) => {
    try {
        const plan = await requireBusinessPlan(req, res);
        if (!plan) return;

        const agentIdRaw = req.body?.agentId
            || req.body?.agent_id
            || req.headers['x-agent-id']
            || req.body?.hostname
            || req.headers['x-agent-name'];
        const agentId = toSafeString(agentIdRaw).slice(0, 120);
        if (!agentId) {
            return sendError(res, 400, 'Invalid input', 'agentId is required');
        }
        const hostname = toSafeString(req.body?.hostname || req.headers['x-agent-host'] || '').slice(0, 120) || null;
        const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : null;
        const metaJson = meta ? safeJsonStringify(meta, null) : null;

        const existing = await dbGet(
            'SELECT id FROM agent_heartbeats WHERE tenant_id = ? AND agent_id = ? LIMIT 1',
            [req.tenantId, agentId]
        );
        if (existing?.id) {
            await dbRun(
                "UPDATE agent_heartbeats SET last_seen_at = datetime('now'), hostname = ?, meta_json = ? WHERE id = ?",
                [hostname, metaJson, existing.id]
            );
        } else {
            await dbRun(
                "INSERT INTO agent_heartbeats (tenant_id, agent_id, hostname, last_seen_at, first_seen_at, meta_json) VALUES (?, ?, ?, datetime('now'), datetime('now'), ?)",
                [req.tenantId, agentId, hostname, metaJson]
            );
        }
        return sendOk(res, { agentId, ok: true });
    } catch (error) {
        console.error('Agent heartbeat error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to record heartbeat');
    }
});

apiRoutes.get('/agent/status', async (req, res) => {
    try {
        const plan = await requireBusinessPlan(req, res);
        if (!plan) return;
        const [totalRow, onlineRow, lastRow] = await Promise.all([
            dbGet('SELECT COUNT(*) as count FROM agent_heartbeats WHERE tenant_id = ?', [req.tenantId]),
            dbGet(
                "SELECT COUNT(*) as count FROM agent_heartbeats WHERE tenant_id = ? AND last_seen_at >= datetime('now', '-2 minutes')",
                [req.tenantId]
            ),
            dbGet('SELECT MAX(last_seen_at) as last_seen_at FROM agent_heartbeats WHERE tenant_id = ?', [req.tenantId])
        ]);
        return sendOk(res, {
            total_count: totalRow?.count || 0,
            online_count: onlineRow?.count || 0,
            last_seen_at: lastRow?.last_seen_at || null
        });
    } catch (error) {
        console.error('Agent status error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load agent status');
    }
});

apiRoutes.get('/agent/download', async (req, res) => {
    try {
        const plan = await requireBusinessPlan(req, res);
        if (!plan) return;
        const file = toSafeString(req.query.file);
        if (!file) {
            return sendOk(res, { files: AGENT_BUNDLE_FILES, baseUrl: getBaseUrl(req) });
        }
        if (!AGENT_BUNDLE_FILES.includes(file)) {
            return sendError(res, 404, 'Not Found', 'File not found');
        }
        const target = path.join(AGENT_BUNDLE_DIR, file);
        if (!fs.existsSync(target)) {
            return sendError(res, 404, 'Not Found', 'File not found');
        }
        res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
        return res.sendFile(target);
    } catch (error) {
        console.error('Agent download error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to download agent bundle');
    }
});

apiRoutes.post('/agent/install-command', requireRole('admin'), async (req, res) => {
    try {
        const plan = await requireBusinessPlan(req, res);
        if (!plan) return;
        if (!req.tenantId) {
            return sendError(res, 400, 'Invalid input', 'Active tenant required');
        }
        const baseUrl = getBaseUrl(req);
        const tenantId = req.tenantId;
        const commandBody = [
            "$ErrorActionPreference='Stop';",
            `$baseUrl='${baseUrl}';`,
            `$tenantId='${tenantId}';`,
            "$appDir=Join-Path $env:APPDATA 'portal-global';",
            'New-Item -ItemType Directory -Force -Path $appDir | Out-Null;',
            "$serviceKey = Read-Host 'Enter Service Key';",
            "$headers = @{ 'X-Service-Token' = $serviceKey; 'X-Tenant-Id' = $tenantId };",
            "$files = @('install-agent.ps1','agent.js','uninstall-agent.ps1');",
            "foreach ($file in $files) { $target = Join-Path $appDir $file; $uri = $baseUrl + '/api/agent/download?file=' + $file; Invoke-WebRequest -Uri $uri -Headers $headers -OutFile $target; }",
            "& (Join-Path $appDir 'install-agent.ps1') -BaseUrl $baseUrl -TenantId $tenantId -ServiceKey $serviceKey;"
        ].join(' ');
        const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${commandBody}"`;
        return sendOk(res, { command });
    } catch (error) {
        console.error('Install command error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to generate install command');
    }
});

apiRoutes.post('/agent/actions/execute', async (req, res) => {
    try {
        const { actionId, id, correlationId } = req.body || {};
        const parsedActionId = parseTenantId(actionId || id);
        if (!parsedActionId) {
            return sendError(res, 400, 'Invalid input', 'actionId is required');
        }
        const actionRow = await dbGet(
            'SELECT * FROM agent_actions WHERE id = ? AND tenant_id = ? LIMIT 1',
            [parsedActionId, req.tenantId]
        );
        if (!actionRow) {
            return sendError(res, 404, 'Not Found', 'Action not found');
        }
        if (actionRow.status === 'done') {
            return sendOk(res, {
                id: parsedActionId,
                status: actionRow.status,
                result: safeJsonParse(actionRow.result_json, null)
            });
        }

        const execution = await executeConversationAction(actionRow, req);
        const messageCorrelationId = actionRow.correlation_id || toSafeString(correlationId);
        if (!execution.ok) {
            await updateAgentAction(parsedActionId, { status: 'failed', result: execution });
            if (messageCorrelationId) {
                await recordConversationMessage({
                    tenantId: req.tenantId,
                    correlationId: messageCorrelationId,
                    senderAgent: 'ActionExecutor',
                    targetAgent: actionRow.actor_agent || actionRow.agent_key || 'Agent',
                    role: 'system',
                    severity: 'error',
                    message: `Action ${actionRow.action_type} failed: ${execution.message || execution.error || 'Unknown error'}`,
                    payload: { actionId: parsedActionId, status: 'failed' }
                });
            }
            return sendError(res, 400, execution.error || 'Invalid action', execution.message || 'Failed to execute action');
        }

        await updateAgentAction(parsedActionId, { status: 'done', result: execution });
        if (messageCorrelationId) {
            await recordConversationMessage({
                tenantId: req.tenantId,
                correlationId: messageCorrelationId,
                senderAgent: 'ActionExecutor',
                targetAgent: actionRow.actor_agent || actionRow.agent_key || 'Agent',
                role: 'system',
                severity: 'info',
                message: `Action ${actionRow.action_type} completed successfully.`,
                payload: { actionId: parsedActionId, status: 'done' }
            });
        }
        return sendOk(res, { id: parsedActionId, status: 'done', result: execution.data || execution });
    } catch (error) {
        console.error('Agent action execute error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to execute agent action');
    }
});

// Agent OS suggestions (legacy)
apiRoutes.post('/agent/suggest', async (req, res) => {
    return handleAgentEvent(req, res, { defaultType: 'ui.page_view' });
});

// System Statistics
apiRoutes.get('/stats', async (req, res) => {
    try {
        const [projectCount, orderCount, activeOrders, leadCount, clientCount, providerCount, aiCount, revenueRow, payoutRow] = await Promise.all([
            dbGet('SELECT COUNT(*) as count FROM projects WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId]),
            dbGet('SELECT COUNT(*) as count FROM orders WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId]),
            dbGet("SELECT COUNT(*) as count FROM orders WHERE tenant_id = ? AND deleted_at IS NULL AND LOWER(status) NOT IN ('completed', 'closed')", [req.tenantId]),
            dbGet('SELECT COUNT(*) as count FROM leads WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId]),
            dbGet('SELECT COUNT(*) as count FROM clients WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId]),
            dbGet('SELECT COUNT(*) as count FROM providers WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId]),
            dbGet('SELECT COUNT(*) as count FROM ai_requests WHERE tenant_id = ?', [req.tenantId]),
            dbGet('SELECT COALESCE(SUM(mrr), 0) as total FROM clients WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId]),
            dbGet('SELECT COALESCE(AVG(payout_rate), 0) as avgRate FROM providers WHERE tenant_id = ? AND deleted_at IS NULL', [req.tenantId])
        ]);

        const totalMRR = toNumber(revenueRow?.total, 0);
        const avgPayout = Number(toNumber(payoutRow?.avgRate, 0).toFixed(1));
        const netRevenue = Number((totalMRR - (avgPayout / 100) * 5000).toFixed(2));

        return sendOk(res, {
            totalProjects: projectCount?.count || 0,
            totalOrders: orderCount?.count || 0,
            activeOrders: activeOrders?.count || 0,
            totalLeads: leadCount?.count || 0,
            clients: clientCount?.count || 0,
            providers: providerCount?.count || 0,
            aiRequests: aiCount?.count || 0,
            totalMRR,
            avgProviderPayout: avgPayout,
            netRevenue,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        });
    } catch (error) {
        console.error('Stats error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load stats');
    }
});

apiRoutes.get('/usage', async (req, res) => {
    try {
        const now = new Date();
        const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
        const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
        const [aiRow, exportRow, autopilotRow, importRow] = await Promise.all([
            dbGet(
                "SELECT COUNT(*) as count FROM ai_requests WHERE tenant_id = ? AND created_at >= datetime('now', 'start of month')",
                [req.tenantId]
            ),
            dbGet(
                "SELECT COUNT(*) as count FROM audit_logs WHERE tenant_id = ? AND entity = 'export' AND created_at >= datetime('now', 'start of month')",
                [req.tenantId]
            ),
            dbGet(
                "SELECT COUNT(*) as count FROM audit_logs WHERE tenant_id = ? AND entity = 'autopilot' AND action = 'cycle' AND created_at >= datetime('now', 'start of month')",
                [req.tenantId]
            ),
            dbGet(
                "SELECT COUNT(*) as count FROM audit_logs WHERE tenant_id = ? AND entity = 'import' AND created_at >= datetime('now', 'start of month')",
                [req.tenantId]
            )
        ]);
        return sendOk(res, {
            period: {
                start: periodStart.toISOString(),
                end: periodEnd.toISOString(),
                label: 'current_month'
            },
            ai_calls: aiRow?.count || 0,
            exports: exportRow?.count || 0,
            autopilot_cycles: autopilotRow?.count || 0,
            imports: importRow?.count || 0
        });
    } catch (error) {
        console.error('Usage snapshot error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load usage');
    }
});

apiRoutes.get('/webhooks/health', async (req, res) => {
    try {
        const [lastInbound, failures] = await Promise.all([
            dbGet(
                "SELECT created_at FROM audit_logs WHERE tenant_id = ? AND entity = 'webhook' AND action = 'inbound' ORDER BY created_at DESC LIMIT 1",
                [req.tenantId]
            ),
            dbGet(
                "SELECT COUNT(*) as count FROM audit_logs WHERE tenant_id = ? AND entity = 'webhook' AND action = 'error' AND created_at >= datetime('now', '-1 day')",
                [req.tenantId]
            )
        ]);
        const failuresCount = failures?.count || 0;
        const lastInboundAt = lastInbound?.created_at || null;
        const status = failuresCount > 0 || !lastInboundAt ? 'warn' : 'ok';
        return sendOk(res, {
            last_inbound_at: lastInboundAt,
            failures_last_24h: failuresCount,
            status
        });
    } catch (error) {
        console.error('Webhook health error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load webhook health');
    }
});

// Financial events
apiRoutes.post('/events/financial', async (req, res) => {
    try {
        const { type, amount, currency, tags, source, tenantId, tenant_id: tenantIdRaw, userId, user_id: userIdRaw } = req.body || {};
        const normalizedType = String(type || '').trim().toLowerCase();
        if (!normalizedType) {
            return sendError(res, 400, 'Invalid input', 'Event type is required');
        }

        const amountValue = Number(amount);
        if (!Number.isFinite(amountValue)) {
            return sendError(res, 400, 'Invalid input', 'Amount must be a valid number');
        }

        const currencyValue = normalizeCurrency(currency, DEFAULT_CURRENCY);
        if (!currencyValue) {
            return sendError(res, 400, 'Invalid input', 'Currency must be a 3-letter code');
        }

        const tagList = normalizeTags(tags);
        const sourceValue = source ? String(source).trim() : null;

        const requestedTenantId = parseTenantId(tenantId || tenantIdRaw);
        const requestedUserId = parseTenantId(userId || userIdRaw);
        let targetTenantId = req.tenantId;
        let targetTenantName = req.tenant?.name || null;
        let targetUserId = req.user.id;
        let targetUserEmail = req.user.email;

        if (requestedTenantId) {
            if (isSuperadmin(req.user)) {
                const tenantRow = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [requestedTenantId]);
                if (!tenantRow?.id) {
                    return sendError(res, 404, 'Not Found', 'Tenant not found');
                }
                targetTenantId = tenantRow.id;
                targetTenantName = tenantRow.name || null;
            } else if (requestedTenantId !== req.tenantId) {
                return sendError(res, 403, 'Forbidden', 'Tenant mismatch');
            }
        }

        if (!targetTenantId) {
            return sendError(res, 403, 'Forbidden', 'Tenant required');
        }

        if (requestedUserId) {
            if (isSuperadmin(req.user)) {
                const userRow = await dbGet('SELECT id, email FROM users WHERE id = ?', [requestedUserId]);
                if (!userRow?.id) {
                    return sendError(res, 404, 'Not Found', 'User not found');
                }
                targetUserId = userRow.id;
                targetUserEmail = userRow.email || targetUserEmail;
            } else if (requestedUserId !== req.user.id) {
                return sendError(res, 403, 'Forbidden', 'User mismatch');
            }
        }

        const tagsJson = tagList.length ? JSON.stringify(tagList) : null;
        const result = await dbRun(
            `INSERT INTO financial_events (tenant_id, user_id, type, amount, currency, tags_json, tags, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [targetTenantId, targetUserId, normalizedType, amountValue, currencyValue, tagsJson, tagsJson, sourceValue]
        );

        let emailQueued = false;
        let emailId = null;
        if (normalizedType === 'payment_received' && OWNER_EMAIL) {
            const amountLabel = `${currencyValue} ${amountValue.toFixed(2)}`;
            const tenantLabel = targetTenantName
                ? `${targetTenantName} (#${targetTenantId})`
                : `Tenant #${targetTenantId}`;
            const userLabel = targetUserEmail
                ? `${targetUserEmail} (#${targetUserId})`
                : `User #${targetUserId}`;
            const tagLabel = tagList.length ? tagList.join(', ') : 'n/a';
            const subject = `Payment received - ${amountLabel}`;
            const text = [
                'Payment received',
                `Tenant: ${tenantLabel}`,
                `User: ${userLabel}`,
                `Amount: ${amountLabel}`,
                `Tags: ${tagLabel}`,
                `Source: ${sourceValue || 'n/a'}`
            ].join('\n');
            const html = `<!doctype html>
<html>
  <body>
    <h2>Payment received</h2>
    <p><strong>Tenant:</strong> ${tenantLabel}</p>
    <p><strong>User:</strong> ${userLabel}</p>
    <p><strong>Amount:</strong> ${amountLabel}</p>
    <p><strong>Tags:</strong> ${tagLabel}</p>
    <p><strong>Source:</strong> ${sourceValue || 'n/a'}</p>
  </body>
</html>`;
            emailId = await queueEmail({ to: OWNER_EMAIL, subject, body: text, html, text, tenantId: targetTenantId });
            emailQueued = Boolean(emailId);
        }

        await logAudit({
            userId: req.user.id,
            tenantId: targetTenantId,
            entity: 'financial_event',
            action: 'create',
            entityId: result.id
        });

        return sendOk(res, {
            id: result.id,
            tenantId: targetTenantId,
            userId: targetUserId,
            type: normalizedType,
            amount: amountValue,
            currency: currencyValue,
            tags: tagList,
            source: sourceValue,
            emailQueued,
            emailId
        });
    } catch (error) {
        console.error('Financial event create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to record financial event');
    }
});

// Subscription details
apiRoutes.get('/subscription/me', async (req, res) => {
    try {
        const plan = await getPlanForTenant(req.tenantId, req.user.id);
        const usage = await getUsageForTenant(req.tenantId);
        const period = getPeriodKey();
        const usageMonthly = await getUsageSnapshot({ dbAll, workspaceId: req.tenantId, period });
        const history = await dbAll(
            `SELECT plan_code, status, current_period_end, created_at
             FROM subscriptions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT 5`,
            [req.user.id]
        );

        return sendOk(res, {
            email: req.user.email,
            role: req.user.role || 'user',
            activeTenantId: req.tenantId,
            plan_code: plan.code,
            plan_name: plan.name,
            price_month: plan.priceMonth,
            limits: plan.limits,
            usage,
            usageMonthly,
            period,
            history
        });
    } catch (error) {
        console.error('Subscription details error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load subscription details');
    }
});

// Subscription upgrade
apiRoutes.post('/subscription/upgrade', requireRole('owner'), async (req, res) => {
    try {
        const { plan_code: planCode } = req.body || {};
        const normalizedPlan = String(planCode || '').trim().toLowerCase();
        const allowedPlans = ['pro', 'business'];
        if (!allowedPlans.includes(normalizedPlan)) {
            return sendError(res, 400, 'Invalid plan', 'Plan code must be pro or business');
        }

        const planRow = await dbGet('SELECT code FROM plans WHERE code = ?', [normalizedPlan]);
        if (!planRow) {
            return sendError(res, 404, 'Not Found', 'Plan not found');
        }

        await dbRun('UPDATE subscriptions SET status = ? WHERE user_id = ? AND status = ?', ['inactive', req.user.id, 'active']);
        const insertResult = await dbRun(
            `INSERT INTO subscriptions (user_id, plan_code, status, current_period_end)
             VALUES (?, ?, 'active', datetime('now', '+30 days'))`,
            [req.user.id, normalizedPlan]
        );

        await dbRun('UPDATE tenants SET plan_code = ? WHERE owner_user_id = ?', [normalizedPlan, req.user.id]);

        const plan = await getPlanForTenant(req.tenantId, req.user.id);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'subscription',
            action: 'update',
            entityId: insertResult.id,
            meta: { plan: normalizedPlan }
        });
        return sendOk(res, { plan });
    } catch (error) {
        console.error('Subscription upgrade error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to upgrade subscription');
    }
});

// Subscription downgrade
apiRoutes.post('/subscription/downgrade', requireRole('owner'), async (req, res) => {
    try {
        const { plan_code: planCode } = req.body || {};
        const normalizedPlan = String(planCode || '').trim().toLowerCase();
        if (normalizedPlan !== 'free') {
            return sendError(res, 400, 'Invalid plan', 'Plan code must be free');
        }

        const planRow = await dbGet('SELECT code FROM plans WHERE code = ?', ['free']);
        if (!planRow) {
            return sendError(res, 404, 'Not Found', 'Plan not found');
        }

        await dbRun('UPDATE subscriptions SET status = ? WHERE user_id = ? AND status = ?', ['inactive', req.user.id, 'active']);
        const insertResult = await dbRun(
            `INSERT INTO subscriptions (user_id, plan_code, status, current_period_end)
             VALUES (?, 'free', 'active', datetime('now', '+30 days'))`,
            [req.user.id]
        );

        await dbRun('UPDATE tenants SET plan_code = ? WHERE owner_user_id = ?', ['free', req.user.id]);

        const plan = await getPlanForTenant(req.tenantId, req.user.id);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'subscription',
            action: 'update',
            entityId: insertResult.id,
            meta: { plan: 'free' }
        });
        return sendOk(res, { plan });
    } catch (error) {
        console.error('Subscription downgrade error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to downgrade subscription');
    }
});

// User onboarding
apiRoutes.get('/user/onboarding', async (req, res) => {
    try {
        const status = await getOnboardingStatus(req.user.id, req.tenantId);
        return sendOk(res, status);
    } catch (error) {
        console.error('Onboarding status error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load onboarding status');
    }
});

apiRoutes.post('/user/onboarding', async (req, res) => {
    try {
        const { completed } = req.body || {};
        if (!completed) {
            return sendError(res, 400, 'Invalid input', 'Completion flag required');
        }
        await dbRun('UPDATE users SET onboarding_completed = 1 WHERE id = ?', [req.user.id]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'onboarding', action: 'update', entityId: req.user.id });
        return sendOk(res, { completed: true });
    } catch (error) {
        console.error('Onboarding update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update onboarding');
    }
});

// Demo data seed
apiRoutes.post('/demo/seed', async (req, res) => {
    try {
        const usage = await getUsageForTenant(req.tenantId);
        if (usage.projects || usage.clients || usage.providers || usage.orders) {
            return sendOk(res, { message: 'Demo data already exists' });
        }

        const projectSeeds = [
            { name: 'Vendor onboarding', category: 'operations', status: 'Planning', progress: 20, notes: 'Initial onboarding workflow.' },
            { name: 'Compliance automation', category: 'risk', status: 'In Progress', progress: 45, notes: 'Audit-ready checklist.' },
            { name: 'Customer rollout', category: 'growth', status: 'Review', progress: 70, notes: 'Launch preparation.' }
        ];
        for (const seed of projectSeeds) {
            await dbRun(
                `INSERT INTO projects (name, category, status, progress, notes, owner_id, tenant_id, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [seed.name, seed.category, seed.status, seed.progress, seed.notes, req.user.id, req.tenantId]
            );
        }

        const clientSeeds = [
            { name: 'Northwind', mrr: 4200, status: 'active', notes: 'Enterprise account' },
            { name: 'Fabrikam', mrr: 1800, status: 'active', notes: 'Pilot program' },
            { name: 'Contoso', mrr: 950, status: 'paused', notes: 'Awaiting renewal' }
        ];
        for (const seed of clientSeeds) {
            await dbRun(
                `INSERT INTO clients (name, mrr, status, notes, owner_id, tenant_id, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                [seed.name, seed.mrr, seed.status, seed.notes, req.user.id, req.tenantId]
            );
        }

        const leadSeeds = [
            { name: 'Alex Morgan', company: 'Silverline Health', email: 'alex@silverline.io', phone: '+1 415 555 1840', source: 'web', status: 'new', notes: 'Requested pricing and SLA details.' },
            { name: 'Priya Shah', company: 'Greenleaf Logistics', email: 'priya@greenleaf.io', phone: '+44 20 7946 0911', source: 'referral', status: 'contacted', notes: 'Follow up scheduled for Tuesday.' },
            { name: 'Marco Rossi', company: 'Nimbus Retail', email: 'marco@nimbusretail.eu', phone: '+39 02 555 0190', source: 'event', status: 'qualified', notes: 'Needs CRM + automation workflow.' }
        ];
        for (const seed of leadSeeds) {
            await dbRun(
                `INSERT INTO leads (name, contact, company, email, phone, source, status, notes, owner_id, tenant_id, created_by, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [
                    seed.name,
                    seed.email || seed.phone || null,
                    seed.company,
                    seed.email,
                    seed.phone,
                    seed.source,
                    seed.status,
                    seed.notes,
                    req.user.id,
                    req.tenantId,
                    req.user.id
                ]
            );
        }

        const providerSeeds = [
            { name: 'Atlas Partners', services: ['design', 'delivery'], payoutRate: 12 },
            { name: 'Nimbus Studio', services: ['compliance', 'ops'], payoutRate: 18 }
        ];
        for (const seed of providerSeeds) {
            await dbRun(
                `INSERT INTO providers (name, services, payout_rate, owner_id, tenant_id, updated_at)
                 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
                [seed.name, JSON.stringify(seed.services), seed.payoutRate, req.user.id, req.tenantId]
            );
        }

        const orderSeeds = [
            { title: 'Priority onboarding', description: 'Fast-track onboarding setup', status: 'Pending', priority: 'High' },
            { title: 'Compliance review', description: 'Quarterly compliance check', status: 'In Progress', priority: 'Medium' },
            { title: 'Reporting automation', description: 'Automate weekly reports', status: 'Pending', priority: 'Medium' },
            { title: 'Vendor refresh', description: 'Update vendor data', status: 'Pending', priority: 'Low' }
        ];
        for (const seed of orderSeeds) {
            await dbRun(
                `INSERT INTO orders (title, description, status, priority, owner_id, tenant_id, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                [seed.title, seed.description, seed.status, seed.priority, req.user.id, req.tenantId]
            );
        }

        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'demo', action: 'create', entityId: req.user.id });
        return sendOk(res, { message: 'Demo data created' });
    } catch (error) {
        console.error('Demo seed error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to seed demo data');
    }
});

// Workspace
apiRoutes.get('/workspace/me', async (req, res) => {
    try {
        const tenant = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [req.tenantId]);
        if (!tenant) {
            return sendError(res, 404, 'Not Found', 'Tenant not found');
        }
        const roleRow = await dbGet(
            `SELECT role
             FROM tenant_memberships
             WHERE tenant_id = ? AND user_id = ? AND status = ?
             ORDER BY id ASC
             LIMIT 1`,
            [req.tenantId, req.user.id, 'active']
        );
        return sendOk(res, {
            id: tenant.id,
            name: tenant.name,
            role: normalizeTenantRole(req.activeMembership?.role || roleRow?.role || 'user')
        });
    } catch (error) {
        console.error('Workspace fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load tenant');
    }
});

apiRoutes.get('/workspace/members', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const userFields = userHasNameColumn
            ? 'u.id, u.email, u.name, u.created_at'
            : 'u.id, u.email, u.created_at';
        const rows = await dbAll(
            `SELECT ${userFields}, tm.role
             FROM tenant_memberships tm
             JOIN users u ON u.id = tm.user_id
             WHERE tm.tenant_id = ? AND tm.status = 'active'
             ORDER BY CASE
                WHEN tm.role = 'owner' THEN 0
                WHEN tm.role = 'admin' THEN 1
                ELSE 2
             END, u.email ASC`,
            [req.tenantId]
        );
        const members = rows.map((row) => ({
            id: row.id,
            email: row.email,
            name: row.name || null,
            role: normalizeTenantRole(row.role),
            createdAt: row.created_at
        }));
        return sendOk(res, members);
    } catch (error) {
        console.error('Workspace members error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load workspace members');
    }
});

// Feedback
apiRoutes.post('/feedback', async (req, res) => {
    try {
        const { message, page } = req.body || {};
        if (!message || String(message).trim().length < 5) {
            return sendError(res, 400, 'Invalid input', 'Feedback message is required');
        }
        const trimmedMessage = String(message).trim();
        const pageValue = page ? String(page).trim() : null;
        const result = await dbRun(
            'INSERT INTO feedback (user_id, tenant_id, message, page) VALUES (?, ?, ?, ?)',
            [req.user.id, req.tenantId, trimmedMessage, pageValue]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'feedback', action: 'create', entityId: result.id });
        return sendOk(res, { id: result.id });
    } catch (error) {
        console.error('Feedback submit error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to submit feedback');
    }
});

apiRoutes.get('/feedback/me', async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT id, message, page, created_at
             FROM feedback
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC
             LIMIT 20`,
            [req.user.id, req.tenantId]
        );
        return sendOk(res, rows);
    } catch (error) {
        console.error('Feedback fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load feedback');
    }
});

apiRoutes.get('/feedback', async (req, res) => {
    try {
        const isAdmin = req.user?.role === 'admin' || req.user?.isSuperadmin || req.user?.is_superadmin;
        if (!isAdmin) {
            return sendError(res, 403, 'Forbidden', 'Admin access required');
        }
        const rows = await dbAll(
            `SELECT f.id, f.message, f.page, f.created_at, u.email as user_email, t.name as tenant_name
             FROM feedback f
             LEFT JOIN users u ON f.user_id = u.id
             LEFT JOIN tenants t ON f.tenant_id = t.id
             ORDER BY f.created_at DESC
             LIMIT 100`
        );
        return sendOk(res, rows);
    } catch (error) {
        console.error('Feedback list error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load feedback');
    }
});

// Agent OS events
apiRoutes.post('/events', (req, res) => handleAgentEvent(req, res));

apiRoutes.get('/approvals', async (req, res) => {
    try {
        const statusRaw = toSafeString(req.query.status).toLowerCase();
        const listLimit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
        const statusList = statusRaw
            ? (statusRaw === 'pending' ? ['draft', 'pending'] : [statusRaw])
            : ['draft', 'pending'];

        const baseParams = [req.tenantId];
        let baseSql = "FROM agent_actions WHERE tenant_id = ? AND action_type LIKE 'safe_%'";
        if (!isTenantAdmin(req)) {
            baseSql += ' AND user_id = ?';
            baseParams.push(req.user.id);
        }
        if (statusList.length) {
            baseSql += ` AND status IN (${statusList.map(() => '?').join(',')})`;
            baseParams.push(...statusList);
        }

        const [countRow, rows] = await Promise.all([
            dbGet(`SELECT COUNT(*) as count ${baseSql}`, baseParams),
            dbAll(
                `SELECT id, action_type, payload_json, created_at ${baseSql} ORDER BY id DESC LIMIT ?`,
                [...baseParams, listLimit]
            )
        ]);

        const items = rows.map((row) => {
            const payload = safeJsonParse(row.payload_json, {});
            const entityValue = payload?.entity
                || payload?.title
                || payload?.name
                || payload?.id
                || payload?.target
                || payload?.path
                || null;
            return {
                id: row.id,
                type: row.action_type,
                entity: entityValue ? String(entityValue) : null,
                created_at: row.created_at
            };
        });

        return sendOk(res, {
            pending_count: countRow?.count || 0,
            items
        });
    } catch (error) {
        console.error('Approvals fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load approvals');
    }
});

apiRoutes.get('/agent/actions', async (req, res) => {
    try {
        const correlationId = toSafeString(req.query.correlationId || req.query.correlation_id);
        if (correlationId) {
            const actions = await loadConversationActions(req.tenantId, correlationId, req.user, req.tenantRole);
            return sendOk(res, actions);
        }
        const status = toSafeString(req.query.status).toLowerCase();
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
        const params = [req.tenantId];
        let sql = `SELECT id, agent_key, action_type, mode, status, payload_json, result_json, created_at, updated_at, user_id
                   FROM agent_actions
                   WHERE tenant_id = ?`;
        if (!isTenantAdmin(req)) {
            sql += ' AND user_id = ?';
            params.push(req.user.id);
        }
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        sql += ' ORDER BY id DESC LIMIT ?';
        params.push(limit);
        const rows = await dbAll(sql, params);
        const data = rows.map((row) => ({
            id: row.id,
            agent: row.agent_key,
            type: row.action_type,
            mode: row.mode,
            status: row.status,
            payload: safeJsonParse(row.payload_json, {}),
            result: safeJsonParse(row.result_json, null),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            userId: row.user_id
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Agent actions fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load agent actions');
    }
});

apiRoutes.post('/agent/actions/:id/execute', async (req, res) => {
    try {
        const actionId = Number(req.params.id);
        if (!Number.isFinite(actionId) || actionId <= 0) {
            return sendError(res, 400, 'Invalid id', 'Action id is required');
        }
        const actionRow = await dbGet(
            'SELECT * FROM agent_actions WHERE id = ? AND tenant_id = ? LIMIT 1',
            [actionId, req.tenantId]
        );
        if (!actionRow) {
            return sendError(res, 404, 'Not Found', 'Action not found');
        }
        if (!isTenantAdmin(req) && actionRow.user_id !== req.user.id) {
            return sendError(res, 403, 'Forbidden', 'Only the owner or admin can execute this action');
        }
        if (actionRow.status === 'executed') {
            return sendOk(res, { id: actionId, status: 'executed' });
        }
        const execution = await executeExistingAction(actionRow, {
            tenantId: req.tenantId,
            tenantRole: req.tenantRole,
            user: req.user,
            plan: req.plan,
            tenant: req.tenant
        });
        if (!execution.ok) {
            await updateAgentAction(actionId, { status: 'failed', result: execution });
            return sendError(res, 400, execution.error || 'Invalid action', execution.message || 'Failed to execute action');
        }
        await updateAgentAction(actionId, { status: 'executed', result: execution });
        return sendOk(res, { id: actionId, status: 'executed', result: execution.data });
    } catch (error) {
        console.error('Agent action execute error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to execute action');
    }
});

// Knowledge base
apiRoutes.get('/kb/articles', async (req, res) => {
    try {
        const query = toSafeString(req.query.q);
        const status = toSafeString(req.query.status).toLowerCase();
        const params = [req.tenantId];
        let sql = `SELECT id, tenant_id, author_user_id, title, summary, content, tags_json, status, created_at, updated_at, published_at
                   FROM kb_articles
                   WHERE tenant_id = ?`;
        if (!isTenantAdmin(req)) {
            sql += " AND status = 'published'";
        } else if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        if (query) {
            const like = `%${query}%`;
            sql += ' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)';
            params.push(like, like, like);
        }
        sql += ' ORDER BY COALESCE(published_at, created_at) DESC';
        const rows = await dbAll(sql, params);
        const data = rows.map((row) => ({
            id: row.id,
            title: row.title,
            summary: row.summary,
            content: row.content,
            tags: normalizeTags(row.tags_json),
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            publishedAt: row.published_at,
            authorUserId: row.author_user_id
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('KB articles fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load knowledge base');
    }
});

apiRoutes.get('/kb/articles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const params = [id, req.tenantId];
        let sql = `SELECT id, tenant_id, author_user_id, title, summary, content, tags_json, status, created_at, updated_at, published_at
                   FROM kb_articles
                   WHERE id = ? AND tenant_id = ?`;
        if (!isTenantAdmin(req)) {
            sql += " AND status = 'published'";
        }
        const row = await dbGet(sql, params);
        if (!row) return sendError(res, 404, 'Not Found', 'Article not found');
        return sendOk(res, {
            id: row.id,
            title: row.title,
            summary: row.summary,
            content: row.content,
            tags: normalizeTags(row.tags_json),
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            publishedAt: row.published_at,
            authorUserId: row.author_user_id
        });
    } catch (error) {
        console.error('KB article fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load article');
    }
});

apiRoutes.post('/kb/articles', requireRole('admin'), async (req, res) => {
    try {
        const { title, summary, content, tags, status } = req.body || {};
        const safeTitle = toSafeString(title);
        const safeContent = toSafeString(content);
        if (!safeTitle || !safeContent) {
            return sendError(res, 400, 'Invalid input', 'Title and content are required');
        }
        const nextStatus = ['draft', 'published'].includes(String(status || '').toLowerCase())
            ? String(status).toLowerCase()
            : 'draft';
        const tagList = normalizeTags(tags);
        const publishedAt = nextStatus === 'published' ? "datetime('now')" : null;
        const result = await dbRun(
            `INSERT INTO kb_articles (tenant_id, author_user_id, title, summary, content, tags_json, status, created_at, updated_at, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ${publishedAt || 'NULL'})`,
            [
                req.tenantId,
                req.user.id,
                safeTitle,
                safeSummary || null,
                safeContent,
                tagList.length ? JSON.stringify(tagList) : null,
                nextStatus
            ]
        );
        const row = await dbGet('SELECT * FROM kb_articles WHERE id = ? AND tenant_id = ?', [result.id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'kb_articles', action: 'create', entityId: result.id });
        return sendOk(res, row);
    } catch (error) {
        console.error('KB article create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create article');
    }
});

apiRoutes.put('/kb/articles/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM kb_articles WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Article not found');
        const { title, summary, content, tags, status } = req.body || {};
        const nextStatus = ['draft', 'published'].includes(String(status || '').toLowerCase())
            ? String(status).toLowerCase()
            : existing.status;
        const tagList = tags !== undefined ? normalizeTags(tags) : normalizeTags(existing.tags_json);
        const publishedAt = nextStatus === 'published' && !existing.published_at ? "datetime('now')" : existing.published_at;
        await dbRun(
            `UPDATE kb_articles
             SET title = ?, summary = ?, content = ?, tags_json = ?, status = ?, updated_at = datetime('now'), published_at = ${publishedAt ? "COALESCE(published_at, datetime('now'))" : 'published_at'}
             WHERE id = ? AND tenant_id = ?`,
            [
                title !== undefined ? toSafeString(title) : existing.title,
                summary !== undefined ? (toSafeString(summary) || null) : existing.summary,
                content !== undefined ? toSafeString(content) : existing.content,
                tagList.length ? JSON.stringify(tagList) : null,
                nextStatus,
                id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM kb_articles WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'kb_articles', action: 'update', entityId: id });
        return sendOk(res, row);
    } catch (error) {
        console.error('KB article update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update article');
    }
});

apiRoutes.delete('/kb/articles/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT id FROM kb_articles WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Article not found');
        await dbRun('DELETE FROM kb_articles WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'kb_articles', action: 'delete', entityId: id });
        return sendOk(res, { id: Number(id) });
    } catch (error) {
        console.error('KB article delete error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to delete article');
    }
});

// Support tickets
apiRoutes.get('/support/tickets', async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
        const params = [req.tenantId];
        let sql = `SELECT id, requester_user_id, assigned_user_id, subject, description, status, priority, created_at, updated_at
                   FROM support_tickets
                   WHERE tenant_id = ?`;
        if (!isTenantAdmin(req)) {
            sql += ' AND requester_user_id = ?';
            params.push(req.user.id);
        }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const rows = await dbAll(sql, params);
        return sendOk(res, rows);
    } catch (error) {
        console.error('Support tickets fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load support tickets');
    }
});

apiRoutes.post('/workspace/rename', async (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name || String(name).trim().length < 3) {
            return sendError(res, 400, 'Invalid name', 'Workspace name is required');
        }
        if (!isSuperadmin(req.user) && !isTenantAdmin(req)) {
            return sendError(res, 403, 'Forbidden', 'Admin access required');
        }
        await dbRun('UPDATE tenants SET name = ? WHERE id = ?', [String(name).trim(), req.tenantId]);
        const tenant = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'tenant', action: 'update', entityId: req.tenantId });
        return sendOk(res, tenant);
    } catch (error) {
        console.error('Workspace rename error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to rename tenant');
    }
});

apiRoutes.post('/workspace/invite', requireRole('admin'), async (req, res) => {
    try {
        const { email, role } = req.body || {};
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            return sendError(res, 400, 'Invalid input', 'Valid email is required');
        }
        const requestedRole = role === 'admin' ? 'admin' : 'user';

        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existingUser?.id) {
            const membership = await dbGet(
                `SELECT id, role
                 FROM tenant_memberships
                 WHERE tenant_id = ? AND user_id = ? AND status = 'active'
                 LIMIT 1`,
                [req.tenantId, existingUser.id]
            );
            if (membership?.id) {
                if (requestedRole === 'admin' && normalizeTenantRole(membership.role) !== 'admin') {
                    await dbRun('UPDATE tenant_memberships SET role = ? WHERE id = ?', [requestedRole, membership.id]);
                }
                await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'tenant_member', action: 'update', entityId: existingUser.id });
                return sendOk(res, { message: 'Member updated', userId: existingUser.id });
            }
            await ensureTenantMembership(req.tenantId, existingUser.id, requestedRole);
            await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'tenant_member', action: 'create', entityId: existingUser.id });
            return sendOk(res, { message: 'Member added', userId: existingUser.id });
        }

        const inviteToken = crypto.randomBytes(16).toString('hex');
        await dbRun(
            `INSERT INTO tenant_invites (tenant_id, email, role, token, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [req.tenantId, normalizedEmail, requestedRole, inviteToken, req.user.id]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'tenant_invite', action: 'create', entityId: req.tenantId });
        return sendOk(res, { message: 'Invite created', inviteToken });
    } catch (error) {
        console.error('Workspace invite error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to send invite');
    }
});

// Tenants
apiRoutes.get('/tenants', async (req, res) => {
    try {
        const memberships = await getMembershipsForUser(req.user.id);
        const activeTenantId = req.activeTenantId || memberships[0]?.tenantId || null;
        return sendOk(res, { memberships, activeTenantId });
    } catch (error) {
        console.error('Tenants fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load tenants');
    }
});

apiRoutes.post('/tenants', requireRole('owner'), async (req, res) => {
    try {
        if (req.plan?.code !== 'business') {
            return rejectUpgrade(res, {
                planCode: req.plan?.code || 'free',
                metric: 'workspaces',
                limit: getLimitValue(req.plan, 'maxWorkspaces'),
                used: null
            });
        }
        const canCreate = await requireWorkspaceSlots(req, res);
        if (!canCreate) return;
        const rawName = String(req.body?.name || '').trim();
        const name = rawName || `${req.user.email} Workspace`;
        if (name.length < 3) {
            return sendError(res, 400, 'Invalid input', 'Tenant name is required');
        }
        const resultId = await createTenant({
            name,
            createdBy: req.user.id,
            ownerUserId: req.user.id,
            planCode: req.plan?.code || 'business'
        });
        await ensureTenantMembership(resultId, req.user.id, 'owner');
        await logAudit({
            userId: req.user.id,
            tenantId: resultId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'tenant',
            action: 'create',
            entityId: resultId
        });
        return sendOk(res, { id: resultId, name });
    } catch (error) {
        console.error('Tenant create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create tenant');
    }
});

const handleTenantSwitch = async (req, res) => {
    try {
        const tenantId = parseTenantId(req.body?.tenantId || req.body?.tenant_id);
        if (!tenantId) {
            return sendError(res, 400, 'Invalid input', 'Tenant id is required');
        }
        const membership = await dbGet(
            `SELECT tenant_id
             FROM tenant_memberships
             WHERE tenant_id = ? AND user_id = ? AND status = 'active'
             LIMIT 1`,
            [tenantId, req.user.id]
        );
        if (!membership?.tenant_id && !isSuperadmin(req.user)) {
            return sendError(res, 403, 'Forbidden', 'Tenant access required');
        }
        if (!membership?.tenant_id && isSuperadmin(req.user)) {
            const tenantRow = await dbGet('SELECT id FROM tenants WHERE id = ?', [tenantId]);
            if (!tenantRow?.id) {
                return sendError(res, 404, 'Not Found', 'Tenant not found');
            }
        }
        await dbRun('UPDATE users SET active_tenant_id = ? WHERE id = ?', [tenantId, req.user.id]);
        return sendOk(res, { activeTenantId: tenantId });
    } catch (error) {
        console.error('Tenant switch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to set active tenant');
    }
};

apiRoutes.post('/tenants/active', handleTenantSwitch);
apiRoutes.post('/tenants/switch', handleTenantSwitch);

apiRoutes.get('/tenants/members', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const userFields = userHasNameColumn
            ? 'u.id, u.email, u.name, u.created_at'
            : 'u.id, u.email, u.created_at';
        const rows = await dbAll(
            `SELECT ${userFields}, tm.role
             FROM tenant_memberships tm
             JOIN users u ON u.id = tm.user_id
             WHERE tm.tenant_id = ? AND tm.status = 'active'
             ORDER BY CASE
                WHEN tm.role = 'owner' THEN 0
                WHEN tm.role = 'admin' THEN 1
                ELSE 2
             END, u.email ASC`,
            [req.tenantId]
        );
        const members = rows.map((row) => ({
            id: row.id,
            email: row.email,
            name: row.name || null,
            role: normalizeTenantRole(row.role),
            createdAt: row.created_at
        }));
        return sendOk(res, members);
    } catch (error) {
        console.error('Tenant members error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load tenant members');
    }
});

apiRoutes.post('/tenants/rename', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name || String(name).trim().length < 3) {
            return sendError(res, 400, 'Invalid name', 'Tenant name is required');
        }
        await dbRun('UPDATE tenants SET name = ? WHERE id = ?', [String(name).trim(), req.tenantId]);
        const tenant = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [req.tenantId]);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'tenant',
            action: 'update',
            entityId: req.tenantId
        });
        return sendOk(res, tenant);
    } catch (error) {
        console.error('Tenant rename error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to rename tenant');
    }
});

apiRoutes.post('/tenants/invite', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const { email, role } = req.body || {};
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            return sendError(res, 400, 'Invalid input', 'Valid email is required');
        }
        const requestedRole = ['admin', 'viewer', 'member'].includes(String(role || '').toLowerCase())
            ? normalizeTenantRole(role)
            : 'member';

        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existingUser?.id) {
            const membership = await dbGet(
                `SELECT id, role
                 FROM tenant_memberships
                 WHERE tenant_id = ? AND user_id = ? AND status = 'active'
                 LIMIT 1`,
                [req.tenantId, existingUser.id]
            );
            if (membership?.id) {
                if (normalizeTenantRole(membership.role) !== requestedRole) {
                    await dbRun('UPDATE tenant_memberships SET role = ? WHERE id = ?', [requestedRole, membership.id]);
                }
                await logAudit({
                    userId: req.user.id,
                    tenantId: req.tenantId,
                    actorType: req.actorType,
                    actorUserId: req.user.id,
                    entity: 'tenant_member',
                    action: 'update',
                    entityId: existingUser.id,
                    meta: { role: requestedRole }
                });
                return sendOk(res, { message: 'Member updated', userId: existingUser.id });
            }
            await ensureTenantMembership(req.tenantId, existingUser.id, requestedRole);
            await logAudit({
                userId: req.user.id,
                tenantId: req.tenantId,
                actorType: req.actorType,
                actorUserId: req.user.id,
                entity: 'tenant_member',
                action: 'create',
                entityId: existingUser.id,
                meta: { role: requestedRole }
            });
            return sendOk(res, { message: 'Member added', userId: existingUser.id });
        }

        const inviteToken = crypto.randomBytes(16).toString('hex');
        await dbRun(
            `INSERT INTO tenant_invites (tenant_id, email, role, token, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [req.tenantId, normalizedEmail, requestedRole, inviteToken, req.user.id]
        );
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'tenant_invite',
            action: 'create',
            entityId: req.tenantId,
            meta: { role: requestedRole }
        });
        return sendOk(res, { message: 'Invite created', inviteToken });
    } catch (error) {
        console.error('Tenant invite error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to send invite');
    }
});

// Workspaces (alias for tenants)
apiRoutes.get('/workspaces', async (req, res) => {
    try {
        const memberships = await getMembershipsForUser(req.user.id);
        const activeTenantId = req.activeTenantId || memberships[0]?.tenantId || null;
        return sendOk(res, {
            workspaces: memberships,
            memberships,
            activeWorkspaceId: activeTenantId,
            activeTenantId
        });
    } catch (error) {
        console.error('Workspaces fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load workspaces');
    }
});

apiRoutes.post('/workspaces', requireRole('owner'), async (req, res) => {
    try {
        if (req.plan?.code !== 'business') {
            return rejectUpgrade(res, {
                planCode: req.plan?.code || 'free',
                metric: 'workspaces',
                limit: getLimitValue(req.plan, 'maxWorkspaces'),
                used: null
            });
        }
        const canCreate = await requireWorkspaceSlots(req, res);
        if (!canCreate) return;
        const rawName = String(req.body?.name || '').trim();
        const name = rawName || `${req.user.email} Workspace`;
        if (name.length < 3) {
            return sendError(res, 400, 'Invalid input', 'Workspace name is required');
        }
        const resultId = await createTenant({
            name,
            createdBy: req.user.id,
            ownerUserId: req.user.id,
            planCode: req.plan?.code || 'business'
        });
        await ensureTenantMembership(resultId, req.user.id, 'owner');
        await logAudit({
            userId: req.user.id,
            tenantId: resultId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'workspace',
            action: 'create',
            entityId: resultId
        });
        return sendOk(res, { id: resultId, name });
    } catch (error) {
        console.error('Workspace create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create workspace');
    }
});

apiRoutes.post('/workspaces/active', handleTenantSwitch);
apiRoutes.post('/workspaces/switch', handleTenantSwitch);

apiRoutes.post('/workspaces/rename', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name || String(name).trim().length < 3) {
            return sendError(res, 400, 'Invalid name', 'Workspace name is required');
        }
        await dbRun('UPDATE tenants SET name = ? WHERE id = ?', [String(name).trim(), req.tenantId]);
        const tenant = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [req.tenantId]);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'workspace',
            action: 'update',
            entityId: req.tenantId
        });
        return sendOk(res, tenant);
    } catch (error) {
        console.error('Workspace rename error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to rename workspace');
    }
});

apiRoutes.get('/workspace/members', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const userFields = userHasNameColumn
            ? 'u.id, u.email, u.name, u.created_at'
            : 'u.id, u.email, u.created_at';
        const rows = await dbAll(
            `SELECT ${userFields}, tm.role
             FROM tenant_memberships tm
             JOIN users u ON u.id = tm.user_id
             WHERE tm.tenant_id = ? AND tm.status = 'active'
             ORDER BY CASE
                WHEN tm.role = 'owner' THEN 0
                WHEN tm.role = 'admin' THEN 1
                ELSE 2
             END, u.email ASC`,
            [req.tenantId]
        );
        const members = rows.map((row) => ({
            id: row.id,
            email: row.email,
            name: row.name || null,
            role: normalizeTenantRole(row.role),
            createdAt: row.created_at
        }));
        return sendOk(res, members);
    } catch (error) {
        console.error('Workspace members error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load workspace members');
    }
});

apiRoutes.post('/workspace/invite', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const { email, role } = req.body || {};
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            return sendError(res, 400, 'Invalid input', 'Valid email is required');
        }
        const requestedRole = ['admin', 'viewer', 'member'].includes(String(role || '').toLowerCase())
            ? normalizeTenantRole(role)
            : 'member';

        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existingUser?.id) {
            const membership = await dbGet(
                `SELECT id, role
                 FROM tenant_memberships
                 WHERE tenant_id = ? AND user_id = ? AND status = 'active'
                 LIMIT 1`,
                [req.tenantId, existingUser.id]
            );
            if (membership?.id) {
                if (normalizeTenantRole(membership.role) !== requestedRole) {
                    await dbRun('UPDATE tenant_memberships SET role = ? WHERE id = ?', [requestedRole, membership.id]);
                }
                await logAudit({
                    userId: req.user.id,
                    tenantId: req.tenantId,
                    actorType: req.actorType,
                    actorUserId: req.user.id,
                    entity: 'tenant_member',
                    action: 'update',
                    entityId: existingUser.id,
                    meta: { role: requestedRole }
                });
                return sendOk(res, { message: 'Member updated', userId: existingUser.id });
            }
            await ensureTenantMembership(req.tenantId, existingUser.id, requestedRole);
            await logAudit({
                userId: req.user.id,
                tenantId: req.tenantId,
                actorType: req.actorType,
                actorUserId: req.user.id,
                entity: 'tenant_member',
                action: 'create',
                entityId: existingUser.id,
                meta: { role: requestedRole }
            });
            return sendOk(res, { message: 'Member added', userId: existingUser.id });
        }

        const inviteToken = crypto.randomBytes(16).toString('hex');
        await dbRun(
            `INSERT INTO tenant_invites (tenant_id, email, role, token, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [req.tenantId, normalizedEmail, requestedRole, inviteToken, req.user.id]
        );
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'tenant_invite',
            action: 'create',
            entityId: req.tenantId,
            meta: { role: requestedRole }
        });
        return sendOk(res, { message: 'Invite created', inviteToken });
    } catch (error) {
        console.error('Workspace invite error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to send invite');
    }
});

apiRoutes.post('/workspace/members/role', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const memberId = Number(req.body?.userId || req.body?.memberId);
        if (!Number.isFinite(memberId)) {
            return sendError(res, 400, 'Invalid input', 'Valid member id required');
        }
        const nextRole = normalizeTenantRole(req.body?.role || 'member');
        if (!['admin', 'member', 'viewer'].includes(nextRole)) {
            return sendError(res, 400, 'Invalid input', 'Role must be admin, member, or viewer');
        }
        const membership = await dbGet(
            `SELECT id, role
             FROM tenant_memberships
             WHERE tenant_id = ? AND user_id = ? AND status = 'active'
             LIMIT 1`,
            [req.tenantId, memberId]
        );
        if (!membership?.id) {
            return sendError(res, 404, 'Not Found', 'Member not found');
        }
        if (normalizeTenantRole(membership.role) === 'owner') {
            return sendError(res, 400, 'Invalid input', 'Owner role cannot be changed');
        }
        await dbRun('UPDATE tenant_memberships SET role = ? WHERE id = ?', [nextRole, membership.id]);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'tenant_member',
            action: 'role_update',
            entityId: memberId,
            meta: { role: nextRole }
        });
        return sendOk(res, { userId: memberId, role: nextRole });
    } catch (error) {
        console.error('Workspace member role error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update role');
    }
});

apiRoutes.post('/workspace/members/remove', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const memberId = Number(req.body?.userId || req.body?.memberId);
        if (!Number.isFinite(memberId)) {
            return sendError(res, 400, 'Invalid input', 'Valid member id required');
        }
        if (memberId === req.user.id) {
            return sendError(res, 400, 'Invalid input', 'Owner cannot remove themselves');
        }
        const membership = await dbGet(
            `SELECT id, role
             FROM tenant_memberships
             WHERE tenant_id = ? AND user_id = ? AND status = 'active'
             LIMIT 1`,
            [req.tenantId, memberId]
        );
        if (!membership?.id) {
            return sendError(res, 404, 'Not Found', 'Member not found');
        }
        if (normalizeTenantRole(membership.role) === 'owner') {
            return sendError(res, 400, 'Invalid input', 'Owner cannot be removed');
        }
        await dbRun('UPDATE tenant_memberships SET status = ? WHERE id = ?', ['inactive', membership.id]);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'tenant_member',
            action: 'remove',
            entityId: memberId
        });
        return sendOk(res, { userId: memberId, removed: true });
    } catch (error) {
        console.error('Workspace member remove error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to remove member');
    }
});

// API keys / Service keys
apiRoutes.get('/keys', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT id, name, key_type, key_preview, last_used_at, created_at, revoked_at
             FROM api_keys
             WHERE workspace_id = ?
             ORDER BY created_at DESC`,
            [String(req.tenantId)]
        );
        const keys = rows.map((row) => ({
            id: row.id,
            name: row.name,
            type: row.key_type,
            preview: row.key_preview,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            revokedAt: row.revoked_at
        }));
        return sendOk(res, keys);
    } catch (error) {
        console.error('Keys fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load keys');
    }
});

apiRoutes.post('/keys', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const { name, type } = req.body || {};
        const keyType = String(type || 'api').toLowerCase() === 'service' ? 'service' : 'api';
        const key = await createWorkspaceKey({
            workspaceId: req.tenantId,
            name: name || `${keyType} key`,
            keyType,
            createdByUserId: req.user.id
        });
        return sendOk(res, {
            id: key.id,
            name: name || `${keyType} key`,
            type: key.keyType,
            preview: key.preview,
            token: key.token
        });
    } catch (error) {
        console.error('Key create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create key');
    }
});

apiRoutes.post('/keys/revoke', requireRole('owner'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const keyId = String(req.body?.id || req.body?.keyId || '').trim();
        if (!keyId) {
            return sendError(res, 400, 'Invalid input', 'Key id is required');
        }
        const row = await dbGet(
            'SELECT id FROM api_keys WHERE id = ? AND workspace_id = ? LIMIT 1',
            [keyId, String(req.tenantId)]
        );
        if (!row?.id) {
            return sendError(res, 404, 'Not Found', 'Key not found');
        }
        await dbRun('UPDATE api_keys SET revoked_at = ? WHERE id = ?', [nowUnix(), keyId]);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'api_key',
            action: 'revoke',
            entityId: keyId
        });
        return sendOk(res, { id: keyId, revoked: true });
    } catch (error) {
        console.error('Key revoke error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to revoke key');
    }
});

// Automations
apiRoutes.get('/automations', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT id, name, enabled, trigger, config_json, created_at, updated_at, last_run_at
             FROM automations
             WHERE workspace_id = ?
             ORDER BY created_at DESC`,
            [String(req.tenantId)]
        );
        const items = rows.map((row) => ({
            id: row.id,
            name: row.name,
            enabled: Boolean(row.enabled),
            trigger: row.trigger,
            config: safeJsonParse(row.config_json, {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastRunAt: row.last_run_at
        }));
        return sendOk(res, items);
    } catch (error) {
        console.error('Automations fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load automations');
    }
});

apiRoutes.post('/automations', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const payload = req.body || {};
        const id = String(payload.id || '').trim();
        const name = String(payload.name || '').trim();
        if (!name || name.length < 2) {
            return sendError(res, 400, 'Invalid input', 'Automation name is required');
        }
        const now = nowUnix();
        const configJson = payload.config ? safeJsonStringify(payload.config, '{}') : safeJsonStringify(payload, '{}');
        if (id) {
            await dbRun(
                `UPDATE automations SET name = ?, enabled = ?, trigger = ?, config_json = ?, updated_at = ?
                 WHERE id = ? AND workspace_id = ?`,
                [
                    name,
                    payload.enabled === undefined ? 1 : (payload.enabled ? 1 : 0),
                    String(payload.trigger || 'interval'),
                    configJson,
                    now,
                    id,
                    String(req.tenantId)
                ]
            );
            await logAudit({
                userId: req.user.id,
                tenantId: req.tenantId,
                actorType: req.actorType,
                actorUserId: req.user.id,
                entity: 'automation',
                action: 'update',
                entityId: id
            });
            const row = await dbGet('SELECT * FROM automations WHERE id = ? AND workspace_id = ?', [id, String(req.tenantId)]);
            return sendOk(res, row);
        }

        const newId = crypto.randomUUID();
        await dbRun(
            `INSERT INTO automations (id, workspace_id, name, enabled, trigger, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                newId,
                String(req.tenantId),
                name,
                payload.enabled === undefined ? 1 : (payload.enabled ? 1 : 0),
                String(payload.trigger || 'interval'),
                configJson,
                now,
                now
            ]
        );
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'automation',
            action: 'create',
            entityId: newId
        });
        const row = await dbGet('SELECT * FROM automations WHERE id = ? AND workspace_id = ?', [newId, String(req.tenantId)]);
        return sendOk(res, row);
    } catch (error) {
        console.error('Automation save error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to save automation');
    }
});

apiRoutes.post('/automations/:id/toggle', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const enabled = Boolean(req.body?.enabled);
        const now = nowUnix();
        await dbRun(
            'UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
            [enabled ? 1 : 0, now, id, String(req.tenantId)]
        );
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'automation',
            action: enabled ? 'enable' : 'disable',
            entityId: id
        });
        const row = await dbGet('SELECT * FROM automations WHERE id = ? AND workspace_id = ?', [id, String(req.tenantId)]);
        return sendOk(res, row);
    } catch (error) {
        console.error('Automation toggle error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to toggle automation');
    }
});

// Local agent status
apiRoutes.get('/agents', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT id, name, last_seen_at, created_at, revoked_at, machine_json
             FROM agent_tokens
             WHERE workspace_id = ? AND revoked_at IS NULL
             ORDER BY created_at DESC`,
            [String(req.tenantId)]
        );
        const agents = rows.map((row) => ({
            id: row.id,
            name: row.name,
            lastSeenAt: row.last_seen_at,
            createdAt: row.created_at,
            machine: safeJsonParse(row.machine_json, null)
        }));
        return sendOk(res, agents);
    } catch (error) {
        console.error('Agents status error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load agent status');
    }
});

apiRoutes.post('/tenants/request-admin', async (req, res) => {
    try {
        if (isAdminRole(req.tenantRole)) {
            return sendOk(res, { requested: false, message: 'Already an admin' });
        }
        const existing = await dbGet(
            `SELECT id
             FROM tenant_admin_requests
             WHERE tenant_id = ? AND user_id = ? AND status = 'pending'
             LIMIT 1`,
            [req.tenantId, req.user.id]
        );
        if (existing?.id) {
            return sendOk(res, { requested: true, message: 'Admin request already pending', requestId: existing.id });
        }
        const result = await dbRun(
            `INSERT INTO tenant_admin_requests (tenant_id, user_id, status, requested_at)
             VALUES (?, ?, 'pending', datetime('now'))`,
            [req.tenantId, req.user.id]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'admin_request', action: 'create', entityId: result.id });
        return sendOk(res, { requested: true, requestId: result.id });
    } catch (error) {
        console.error('Admin request error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to request admin');
    }
});

apiRoutes.post('/tenants/approve-admin', async (req, res) => {
    try {
        if (!isSuperadmin(req.user) && !isTenantAdmin(req)) {
            return sendError(res, 403, 'Forbidden', 'Admin access required');
        }
        const { userId, requestId } = req.body || {};
        let targetUserId = Number(userId);
        if (!targetUserId && requestId) {
            const requestRow = await dbGet(
                `SELECT id, tenant_id, user_id, status
                 FROM tenant_admin_requests
                 WHERE id = ?
                 LIMIT 1`,
                [requestId]
            );
            if (!requestRow) {
                return sendError(res, 404, 'Not Found', 'Admin request not found');
            }
            if (requestRow.tenant_id !== req.tenantId) {
                return sendError(res, 403, 'Forbidden', 'Request not in active tenant');
            }
            if (requestRow.status !== 'pending') {
                return sendError(res, 409, 'Invalid request', 'Admin request already processed');
            }
            targetUserId = requestRow.user_id;
        }

        if (!Number.isFinite(targetUserId)) {
            return sendError(res, 400, 'Invalid input', 'Target user id required');
        }
        if (!isSuperadmin(req.user) && targetUserId === req.user.id) {
            return sendError(res, 403, 'Forbidden', 'Cannot approve your own request');
        }

        const membership = await dbGet(
            `SELECT id, role
             FROM tenant_memberships
             WHERE tenant_id = ? AND user_id = ? AND status = 'active'
             LIMIT 1`,
            [req.tenantId, targetUserId]
        );
        if (!membership?.id) {
            return sendError(res, 404, 'Not Found', 'Tenant member not found');
        }
        if (normalizeTenantRole(membership.role) === 'admin') {
            return sendOk(res, { approved: true, userId: targetUserId });
        }

        await dbRun('UPDATE tenant_memberships SET role = ? WHERE id = ?', ['admin', membership.id]);
        await dbRun(
            `UPDATE tenant_admin_requests
             SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ?
             WHERE tenant_id = ? AND user_id = ? AND status = 'pending'`,
            [req.user.id, req.tenantId, targetUserId]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'tenant_member', action: 'update', entityId: targetUserId });
        return sendOk(res, { approved: true, userId: targetUserId });
    } catch (error) {
        console.error('Admin approval error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to approve admin');
    }
});

apiRoutes.post('/tenants/reject-admin', async (req, res) => {
    try {
        if (!isSuperadmin(req.user) && !isTenantAdmin(req)) {
            return sendError(res, 403, 'Forbidden', 'Admin access required');
        }
        const { userId, requestId } = req.body || {};
        let targetUserId = Number(userId);
        if (!targetUserId && requestId) {
            const requestRow = await dbGet(
                `SELECT id, tenant_id, user_id, status
                 FROM tenant_admin_requests
                 WHERE id = ?
                 LIMIT 1`,
                [requestId]
            );
            if (!requestRow) {
                return sendError(res, 404, 'Not Found', 'Admin request not found');
            }
            if (requestRow.tenant_id !== req.tenantId) {
                return sendError(res, 403, 'Forbidden', 'Request not in active tenant');
            }
            if (requestRow.status !== 'pending') {
                return sendError(res, 409, 'Invalid request', 'Admin request already processed');
            }
            targetUserId = requestRow.user_id;
        }

        if (!Number.isFinite(targetUserId)) {
            return sendError(res, 400, 'Invalid input', 'Target user id required');
        }
        if (!isSuperadmin(req.user) && targetUserId === req.user.id) {
            return sendError(res, 403, 'Forbidden', 'Cannot reject your own request');
        }

        await dbRun(
            `UPDATE tenant_admin_requests
             SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = ?
             WHERE tenant_id = ? AND user_id = ? AND status = 'pending'`,
            [req.user.id, req.tenantId, targetUserId]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'admin_request', action: 'reject', entityId: requestId || targetUserId });
        return sendOk(res, { rejected: true, userId: targetUserId });
    } catch (error) {
        console.error('Admin reject error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to reject admin');
    }
});

apiRoutes.get('/admin/requests', requireRole('admin'), async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT r.id, r.user_id, u.email, r.status, r.requested_at
             FROM tenant_admin_requests r
             JOIN users u ON u.id = r.user_id
             WHERE r.tenant_id = ? AND r.status = 'pending'
             ORDER BY r.requested_at DESC`,
            [req.tenantId]
        );
        const data = rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            email: row.email,
            status: row.status,
            requestedAt: row.requested_at
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Admin requests fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load admin requests');
    }
});

apiRoutes.post('/admin/request', async (req, res) => {
    return apiRoutes.handle({ ...req, url: '/tenants/request-admin', method: 'POST' }, res);
});

apiRoutes.post('/admin/approve', async (req, res) => {
    return apiRoutes.handle({ ...req, url: '/tenants/approve-admin', method: 'POST' }, res);
});

apiRoutes.post('/admin/reject', async (req, res) => {
    return apiRoutes.handle({ ...req, url: '/tenants/reject-admin', method: 'POST' }, res);
});

// Admin overview
apiRoutes.get('/admin/overview', requireRole('admin'), async (req, res) => {
    try {
        const tenantId = resolveAdminTenantId(req, res);
        if (!tenantId) {
            return;
        }

        const [userCount, tenantCount, eventCount, actionCount, messageCount] = await Promise.all([
            dbGet(
                'SELECT COUNT(DISTINCT user_id) as count FROM tenant_memberships WHERE tenant_id = ? AND status = ?',
                [tenantId, 'active']
            ),
            dbGet('SELECT COUNT(*) as count FROM tenants WHERE id = ?', [tenantId]),
            dbGet('SELECT COUNT(*) as count FROM agent_events WHERE tenant_id = ?', [tenantId]),
            dbGet('SELECT COUNT(*) as count FROM agent_actions WHERE tenant_id = ?', [tenantId]),
            dbGet('SELECT COUNT(*) as count FROM agent_messages WHERE tenant_id = ?', [tenantId])
        ]);

        const countFiles = async (dir) => {
            try {
                const entries = await fs.promises.readdir(dir);
                return entries.filter((entry) => entry && entry !== '.' && entry !== '..').length;
            } catch (error) {
                return 0;
            }
        };

        const uploadDirs = [
            path.join(__dirname, 'web-next', 'public', 'uploads'),
            path.join(__dirname, 'backend', 'uploads')
        ];
        const uploadCounts = await Promise.all(uploadDirs.map((dir) => countFiles(dir)));
        const uploadTotal = uploadCounts.reduce((sum, count) => sum + count, 0);

        return sendOk(res, {
            users: userCount?.count || 0,
            tenants: tenantCount?.count || 0,
            events: eventCount?.count || 0,
            actions: actionCount?.count || 0,
            messages: messageCount?.count || 0,
            uploads: uploadTotal
        });
    } catch (error) {
        console.error('Admin overview error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load admin overview');
    }
});

// Admin users list
apiRoutes.get('/admin/users', requireRole('admin'), async (req, res) => {
    try {
        const tenantId = resolveAdminTenantId(req, res);
        if (!tenantId) {
            return;
        }

        const rows = await dbAll(
            `SELECT u.id, u.email, u.created_at, tm.role, tm.tenant_id
             FROM users u
             JOIN tenant_memberships tm ON tm.user_id = u.id
             WHERE tm.tenant_id = ? AND tm.status = 'active'
             ORDER BY u.created_at DESC`,
            [tenantId]
        );
        const data = rows.map((row) => ({
            id: row.id,
            email: row.email,
            role: normalizeTenantRole(row.role || 'user'),
            tenantId: row.tenant_id,
            createdAt: row.created_at
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Admin users error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load admin users');
    }
});

// Admin role update
apiRoutes.patch('/admin/users/:id/role', requireRole('admin'), async (req, res) => {
    try {
        const tenantId = resolveAdminTenantId(req, res);
        if (!tenantId) {
            return;
        }

        const targetUserId = Number(req.params.id);
        if (!Number.isFinite(targetUserId)) {
            return sendError(res, 400, 'Invalid input', 'Invalid user id');
        }

        const nextRole = normalizeTenantRole(req.body?.role || req.body?.tenantRole || req.body?.tenant_role || '');
        const allowedRoles = isSuperadmin(req.user)
            ? ['owner', 'admin', 'member', 'viewer']
            : ['admin', 'member', 'viewer'];
        if (!nextRole || !allowedRoles.includes(nextRole)) {
            return sendError(res, 400, 'Invalid input', 'Invalid role');
        }

        const membership = await dbGet(
            'SELECT id, role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? AND status = ? LIMIT 1',
            [tenantId, targetUserId, 'active']
        );
        if (!membership) {
            return sendError(res, 404, 'Not Found', 'User not found in tenant');
        }

        const currentRole = normalizeTenantRole(membership.role || 'member');
        if (currentRole !== nextRole) {
            await dbRun('UPDATE tenant_memberships SET role = ? WHERE id = ?', [nextRole, membership.id]);
            await logAudit({
                userId: req.user.id,
                tenantId,
                actorType: req.actorType,
                actorUserId: req.user.id,
                entity: 'tenant_member',
                action: 'role_update',
                entityId: targetUserId,
                meta: { from: currentRole, to: nextRole }
            });
        }

        return sendOk(res, { userId: targetUserId, tenantId, role: nextRole });
    } catch (error) {
        console.error('Admin role update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update role');
    }
});

// Admin audit feed
apiRoutes.get('/admin/audit', requireRole('admin'), async (req, res) => {
    try {
        const tenantId = resolveAdminTenantId(req, res);
        if (!tenantId) {
            return;
        }

        const limitRaw = Number(req.query.limit || 25);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 25;

        const [auditRows, messageRows] = await Promise.all([
            dbAll(
                `SELECT id, entity, action, entity_id, meta_json, created_at
                 FROM audit_logs
                 WHERE tenant_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [tenantId, limit]
            ),
            dbAll(
                `SELECT id, sender_agent, target_agent, role, severity, message, payload_json, created_at
                 FROM agent_messages
                 WHERE tenant_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [tenantId, limit]
            )
        ]);

        const entries = [
            ...auditRows.map((row) => ({
                type: 'audit',
                id: row.id,
                entity: row.entity,
                action: row.action,
                entityId: row.entity_id,
                meta: safeJsonParse(row.meta_json, null),
                createdAt: row.created_at
            })),
            ...messageRows.map((row) => ({
                type: 'message',
                id: row.id,
                sender: row.sender_agent,
                target: row.target_agent,
                role: row.role,
                severity: row.severity,
                message: row.message,
                payload: safeJsonParse(row.payload_json, null),
                createdAt: row.created_at
            }))
        ]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        return sendOk(res, entries);
    } catch (error) {
        console.error('Admin audit error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load admin audit');
    }
});

// Audit log (Business)
apiRoutes.get('/audit', requireRole('admin'), requireBusinessPlanMiddleware, async (req, res) => {
    try {
        const { page, limit, offset } = parsePagination(req.query || {});
        const filters = [];
        const params = [req.tenantId];

        const action = String(req.query?.action || '').trim();
        const entity = String(req.query?.entity || '').trim();
        const actorType = String(req.query?.actor_type || req.query?.actorType || '').trim();
        const fromRaw = req.query?.from || req.query?.from_ts || null;
        const toRaw = req.query?.to || req.query?.to_ts || null;

        const parseTs = (value) => {
            if (!value) return null;
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return Math.floor(numeric);
            const parsed = Date.parse(String(value));
            if (Number.isNaN(parsed)) return null;
            return Math.floor(parsed / 1000);
        };

        const fromTs = parseTs(fromRaw);
        const toTs = parseTs(toRaw);

        if (action) {
            filters.push('action = ?');
            params.push(action);
        }
        if (entity) {
            filters.push('entity = ?');
            params.push(entity);
        }
        if (actorType) {
            filters.push('actor_type = ?');
            params.push(actorType);
        }
        if (fromTs) {
            filters.push('(created_at_unix IS NULL OR created_at_unix >= ?)');
            params.push(fromTs);
        }
        if (toTs) {
            filters.push('(created_at_unix IS NULL OR created_at_unix <= ?)');
            params.push(toTs);
        }

        const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
        const [rows, countRow] = await Promise.all([
            dbAll(
                `SELECT id, actor_type, actor_user_id, action, entity, entity_id, meta_json, ip, ua, created_at, created_at_unix
                 FROM audit_logs
                 WHERE tenant_id = ?${where}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            ),
            dbGet(
                `SELECT COUNT(*) as count FROM audit_logs WHERE tenant_id = ?${where}`,
                params
            )
        ]);

        const items = rows.map((row) => ({
            id: row.id,
            actorType: row.actor_type || 'user',
            actorUserId: row.actor_user_id,
            action: row.action,
            entity: row.entity,
            entityId: row.entity_id,
            meta: safeJsonParse(row.meta_json, null),
            ip: row.ip,
            ua: row.ua,
            createdAt: row.created_at,
            createdAtUnix: row.created_at_unix
        }));

        const total = countRow?.count || 0;
        return sendOk(res, {
            items,
            page,
            limit,
            total,
            totalPages: limit ? Math.ceil(total / limit) : 1
        });
    } catch (error) {
        console.error('Audit log error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load audit log');
    }
});

apiRoutes.get('/audit/export', requireRole('admin'), requireBusinessPlanMiddleware, requirePlan('exports', 1), async (req, res) => {
    try {
        const filters = [];
        const params = [req.tenantId];
        const action = String(req.query?.action || '').trim();
        const entity = String(req.query?.entity || '').trim();
        const actorType = String(req.query?.actor_type || req.query?.actorType || '').trim();
        if (action) {
            filters.push('action = ?');
            params.push(action);
        }
        if (entity) {
            filters.push('entity = ?');
            params.push(entity);
        }
        if (actorType) {
            filters.push('actor_type = ?');
            params.push(actorType);
        }
        const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
        const rows = await dbAll(
            `SELECT actor_type, actor_user_id, action, entity, entity_id, meta_json, ip, ua, created_at
             FROM audit_logs
             WHERE tenant_id = ?${where}
             ORDER BY created_at DESC`,
            params
        );
        const csv = toCsv(rows, ['actor_type', 'actor_user_id', 'action', 'entity', 'entity_id', 'meta_json', 'ip', 'ua', 'created_at']);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            actorType: req.actorType,
            actorUserId: req.user.id,
            entity: 'audit',
            action: 'export',
            entityId: req.tenantId,
            meta: { format: 'csv', count: rows.length }
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
        return res.send(csv);
    } catch (error) {
        console.error('Audit export error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to export audit log');
    }
});

apiRoutes.post('/admin/demo/populate', requireRole('admin'), async (req, res) => {
    try {
        const tenantId = await resolveAdminTenantIdFromEnv();
        if (!tenantId) {
            return sendError(res, 404, 'Not Found', 'Admin tenant not configured');
        }
        if (!isSuperadmin(req.user)) {
            const membership = await dbGet(
                "SELECT role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
                [tenantId, req.user.id]
            );
            if (!membership || normalizeTenantRole(membership.role) !== 'admin') {
                return sendError(res, 403, 'Forbidden', 'Admin tenant access required');
            }
        }

        const mode = req.body?.mode === 'full' ? 'full' : 'minimal';
        const counts = req.body?.counts || {};
        const result = await populateAdminDemoData({ tenantId, userId: req.user.id, mode, counts });
        return sendOk(res, result);
    } catch (error) {
        console.error('Admin demo populate error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to populate demo data');
    }
});

apiRoutes.post('/admin/demo/clear', requireRole('admin'), async (req, res) => {
    try {
        const tenantId = await resolveAdminTenantIdFromEnv();
        if (!tenantId) {
            return sendError(res, 404, 'Not Found', 'Admin tenant not configured');
        }
        if (!isSuperadmin(req.user)) {
            const membership = await dbGet(
                "SELECT role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
                [tenantId, req.user.id]
            );
            if (!membership || normalizeTenantRole(membership.role) !== 'admin') {
                return sendError(res, 403, 'Forbidden', 'Admin tenant access required');
            }
        }

        const result = await clearAdminDemoData(tenantId);
        await logAudit({
            userId: req.user.id,
            tenantId,
            entity: 'demo',
            action: 'clear',
            entityId: tenantId,
            meta: { demo: true, tags: DEMO_TAGS }
        });
        return sendOk(res, result);
    } catch (error) {
        console.error('Admin demo clear error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to clear demo data');
    }
});

// Audit log
apiRoutes.get('/audit/recent', async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT entity, action, entity_id, meta_json, created_at
             FROM audit_logs
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC
             LIMIT 20`,
            [req.user.id, req.tenantId]
        );
        const data = rows.map((row) => ({
            entity: row.entity,
            action: row.action,
            entity_id: row.entity_id,
            meta: safeJsonParse(row.meta_json, null),
            created_at: row.created_at
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Audit log fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load audit log');
    }
});

// Admin stats
apiRoutes.get('/admin/stats', requireSuperadminApi, async (req, res) => {
    try {
        const [userCount, subscriptionCount, projectCount, clientCount, providerCount, orderCount, leadCount] = await Promise.all([
            dbGet('SELECT COUNT(*) as count FROM users'),
            dbGet('SELECT COUNT(*) as count FROM subscriptions'),
            dbGet('SELECT COUNT(*) as count FROM projects'),
            dbGet('SELECT COUNT(*) as count FROM clients'),
            dbGet('SELECT COUNT(*) as count FROM providers'),
            dbGet('SELECT COUNT(*) as count FROM orders'),
            dbGet('SELECT COUNT(*) as count FROM leads')
        ]);

        const planDistribution = await dbAll(
            `SELECT plan_code, COUNT(*) as count
             FROM subscriptions
             WHERE status = 'active'
             GROUP BY plan_code`
        );

        return sendOk(res, {
            totalUsers: userCount?.count || 0,
            totalSubscriptions: subscriptionCount?.count || 0,
            totalProjects: projectCount?.count || 0,
            totalClients: clientCount?.count || 0,
            totalProviders: providerCount?.count || 0,
            totalOrders: orderCount?.count || 0,
            totalLeads: leadCount?.count || 0,
            planDistribution
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load admin stats');
    }
});

apiRoutes.get('/admin/tenants', requireSuperadminApi, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT t.id, t.name, t.created_at,
                    COUNT(tm.id) as member_count
             FROM tenants t
             LEFT JOIN tenant_memberships tm
               ON tm.tenant_id = t.id AND tm.status = 'active'
             GROUP BY t.id
             ORDER BY t.id DESC`
        );
        return sendOk(res, rows);
    } catch (error) {
        console.error('Admin tenants error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load tenants');
    }
});

// Owner endpoints (superadmin, no tenant context required)
ownerApiRoutes.get('/tenants', async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT t.id, t.name, t.created_at,
                    COUNT(tm.id) as member_count
             FROM tenants t
             LEFT JOIN tenant_memberships tm
               ON tm.tenant_id = t.id AND tm.status = 'active'
             GROUP BY t.id
             ORDER BY t.id DESC`
        );
        return sendOk(res, rows);
    } catch (error) {
        console.error('Owner tenants error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load tenants');
    }
});

ownerApiRoutes.get('/revenue/summary', async (req, res) => {
    try {
        const daysRaw = Number(req.query.days || 30);
        const windowDays = Number.isFinite(daysRaw) && daysRaw > 0
            ? Math.min(Math.floor(daysRaw), 365)
            : 30;
        const since = `-${windowDays} days`;

        const totalsRows = await dbAll(
            `SELECT date(created_at) as day, currency, SUM(amount) as total
             FROM financial_events
             WHERE created_at >= datetime('now', ?)
             GROUP BY day, currency
             ORDER BY day DESC`,
            [since]
        );
        const totalsByDay = totalsRows.map((row) => ({
            day: row.day,
            currency: row.currency,
            total: Number(row.total || 0)
        }));

        const totalByCurrency = totalsRows.reduce((acc, row) => {
            const currency = row.currency || DEFAULT_CURRENCY;
            acc[currency] = (acc[currency] || 0) + Number(row.total || 0);
            return acc;
        }, {});

        const tagRows = await dbAll(
            `SELECT tags_json, tags
             FROM financial_events
             WHERE created_at >= datetime('now', ?)`,
            [since]
        );
        const tagCounts = new Map();
        tagRows.forEach((row) => {
            const tags = normalizeTags(row.tags_json || row.tags || '');
            tags.forEach((tag) => {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            });
        });
        const topTags = Array.from(tagCounts.entries())
            .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count }));

        return sendOk(res, {
            days: windowDays,
            totalsByDay,
            totalsByCurrency: totalByCurrency,
            topTags
        });
    } catch (error) {
        console.error('Owner revenue summary error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load revenue summary');
    }
});

// Admin bootstrap (dev-only, local)
apiRoutes.get('/admin/bootstrap/status', async (req, res) => {
    const token = process.env.ADMIN_BOOTSTRAP_CODE || process.env.ADMIN_BOOTSTRAP_TOKEN;
    const hasAdmin = await hasAnyAdmin();
    const enabled = process.env.NODE_ENV !== 'production'
        && isLocalRequest(req)
        && (!hasAdmin || Boolean(token));
    return sendOk(res, { enabled, hasAdmin, requiresToken: Boolean(token) });
});

apiRoutes.post('/admin/bootstrap', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'production') {
            return sendError(res, 403, 'Forbidden', 'Bootstrap disabled');
        }
        if (!isLocalRequest(req)) {
            return sendError(res, 403, 'Forbidden', 'Local requests only');
        }
        const expected = process.env.ADMIN_BOOTSTRAP_CODE || process.env.ADMIN_BOOTSTRAP_TOKEN;
        const hasAdmin = await hasAnyAdmin();
        const provided = req.body?.token || req.headers['x-admin-bootstrap-token'];

        if (hasAdmin) {
            if (!expected) {
                return sendError(res, 403, 'Forbidden', 'Bootstrap code missing');
            }
            if (!provided || String(provided).trim() !== String(expected).trim()) {
                return sendError(res, 403, 'Forbidden', 'Invalid bootstrap code');
            }
        } else if (expected) {
            if (!provided || String(provided).trim() !== String(expected).trim()) {
                return sendError(res, 403, 'Forbidden', 'Invalid bootstrap code');
            }
        }

        await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [req.user.id]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'admin', action: 'update', entityId: req.user.id });
        return sendOk(res, { role: 'admin' });
    } catch (error) {
        console.error('Admin bootstrap error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to bootstrap admin');
    }
});

// Billing: create checkout session (placeholder)
apiRoutes.post('/billing/create-checkout-session', async (req, res) => {
    try {
        // TODO: Integrate Stripe checkout session creation.
        return sendOk(res, {
            sessionId: 'demo_checkout_session',
            url: '/pricing'
        });
    } catch (error) {
        console.error('Billing session error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create checkout session');
    }
});

// CRUD: Projects
apiRoutes.get('/projects', async (req, res) => {
    try {
        const query = String(req.query.q || '').trim();
        const includeDeleted = ['1', 'true', 'yes'].includes(String(req.query.includeDeleted || req.query.include_deleted || '').toLowerCase());
        const params = [req.tenantId];
        let sql = 'SELECT * FROM projects WHERE tenant_id = ?';
        if (!includeDeleted) {
            sql += ' AND deleted_at IS NULL';
        }
        if (query) {
            sql += ' AND (name LIKE ? OR notes LIKE ?)';
            const like = `%${query}%`;
            params.push(like, like);
        }
        sql += ' ORDER BY id DESC';
        const rows = await dbAll(sql, params);
        const data = rows.map((row) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            status: row.status,
            progress: row.progress,
            due: row.due,
            notes: row.notes || '',
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Projects fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load projects');
    }
});

apiRoutes.get('/projects/export', requireRole('member'), requirePlan('exports', 1), async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT id, name, category, status, progress, due, notes, created_at, updated_at
             FROM projects
             WHERE tenant_id = ? AND deleted_at IS NULL
             ORDER BY id DESC`,
            [req.tenantId]
        );
        const csv = toCsv(rows, ['id', 'name', 'category', 'status', 'progress', 'due', 'notes', 'created_at', 'updated_at']);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            entity: 'export',
            action: 'projects',
            entityId: req.tenantId,
            meta: { format: 'csv', count: rows.length }
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="projects.csv"');
        return res.send(csv);
    } catch (error) {
        console.error('Projects export error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to export projects');
    }
});

apiRoutes.get('/projects/:id/analyze', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const project = await dbGet(
            'SELECT * FROM projects WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
            [id, req.tenantId]
        );
        
        if (!project) {
            return sendError(res, 404, 'Not Found', 'Project not found');
        }

        const prompt = `Analysiere dieses Projekt und gib eine kurze Bewertung (Risiko, Status, Empfehlungen):

Projekt: ${project.name}
Kategorie: ${project.category}
Status: ${project.status}
Fortschritt: ${project.progress}%
Notizen: ${project.notes || 'Keine'}

Antworte kurz und bündig auf Deutsch.`;

        const ollamaRes = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5-coder:7b',
                prompt: prompt,
                stream: false
            })
        });

        const ollamaData = await ollamaRes.json();
        
        if (ollamaData.error) {
            return sendOk(res, {
                project: {
                    id: project.id,
                    name: project.name,
                    status: project.status,
                    progress: project.progress
                },
                analysis: 'AI-Analyse temporär nicht verfügbar (Server-Speicherlimit). Bitte versuchen Sie es später erneut.',
                timestamp: new Date().toISOString()
            });
        }
        
        const analysis = ollamaData.response || 'Analyse nicht verfügbar';

        return sendOk(res, {
            project: {
                id: project.id,
                name: project.name,
                status: project.status,
                progress: project.progress
            },
            analysis: analysis,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Project analyze error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to analyze project');
    }
});

apiRoutes.post('/projects', requireRole('member'), async (req, res) => {
    try {
        const { name, category, status, progress, due, notes } = req.body || {};
        if (!name || String(name).trim().length < 2) {
            return sendError(res, 400, 'Invalid name', 'Project name is required');
        }

        const canCreate = await requireProjectSlots(req, res);
        if (!canCreate) return;

        const safeProgress = Math.min(100, Math.max(0, Math.round(toNumber(progress, 0))));
        const result = await dbRun(
            `INSERT INTO projects (name, category, status, progress, due, notes, owner_id, tenant_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
                String(name).trim(),
                String(category || 'general'),
                String(status || 'Planning'),
                safeProgress,
                due || null,
                notes ? String(notes).trim() : null,
                req.user.id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM projects WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [result.id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'projects', action: 'create', entityId: result.id });
        
        broadcastEvent('projectCreated', row, req.tenantId);
        
        return sendOk(res, row);
    } catch (error) {
        console.error('Projects create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create project');
    }
});

apiRoutes.put('/projects/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, status, progress, due, notes } = req.body || {};
        if (!id) return sendError(res, 400, 'Invalid id', 'Project id is required');

        const existing = await dbGet('SELECT * FROM projects WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Project not found');

        const safeProgress = Math.min(100, Math.max(0, Math.round(toNumber(progress, existing.progress))));
        await dbRun(
            `UPDATE projects SET name = ?, category = ?, status = ?, progress = ?, due = ?, notes = ?, updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`,
            [
                String(name || existing.name).trim(),
                String(category || existing.category),
                String(status || existing.status),
                safeProgress,
                due !== undefined ? due : existing.due,
                notes !== undefined ? String(notes).trim() : existing.notes,
                id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM projects WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'projects', action: 'update', entityId: id });
        
        broadcastEvent('projectUpdated', row, req.tenantId);
        
        return sendOk(res, row);
    } catch (error) {
        console.error('Projects update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update project');
    }
});

apiRoutes.delete('/projects/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM projects WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Project not found');
        await dbRun(
            `UPDATE projects SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'projects', action: 'delete', entityId: id });
        
        broadcastEvent('projectDeleted', { id: Number(id) }, req.tenantId);
        
        return sendOk(res, { id: Number(id) });
    } catch (error) {
        console.error('Projects delete error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to delete project');
    }
});

apiRoutes.post('/projects/:id/restore', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM projects WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Project not found');
        await dbRun(
            `UPDATE projects SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        const row = await dbGet('SELECT * FROM projects WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'projects', action: 'update', entityId: id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Projects restore error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to restore project');
    }
});

// CRUD: Clients
apiRoutes.get('/clients', async (req, res) => {
    try {
        const includeDeleted = ['1', 'true', 'yes'].includes(String(req.query.includeDeleted || req.query.include_deleted || '').toLowerCase());
        let sql = 'SELECT * FROM clients WHERE tenant_id = ?';
        const params = [req.tenantId];
        if (!includeDeleted) {
            sql += ' AND deleted_at IS NULL';
        }
        sql += ' ORDER BY id DESC';
        const rows = await dbAll(sql, params);
        const data = rows.map((row) => ({
            id: row.id,
            name: row.name,
            mrr: row.mrr,
            status: row.status,
            notes: row.notes || '',
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Clients fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load clients');
    }
});

apiRoutes.post('/clients', requireRole('member'), async (req, res) => {
    try {
        const { name, mrr, status, notes } = req.body || {};
        if (!name || String(name).trim().length < 2) {
            return sendError(res, 400, 'Invalid name', 'Client name is required');
        }
        const canCreate = await checkLimitOrReject(req, res, { key: 'maxClients', table: 'clients' });
        if (!canCreate) return;
        const safeMrr = toNumber(mrr, 0);
        const result = await dbRun(
            `INSERT INTO clients (name, mrr, status, notes, owner_id, tenant_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
            [String(name).trim(), safeMrr, String(status || 'active'), notes ? String(notes).trim() : null, req.user.id, req.tenantId]
        );
        const row = await dbGet('SELECT * FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [result.id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'clients', action: 'create', entityId: result.id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Clients create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create client');
    }
});

apiRoutes.put('/clients/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, mrr, status, notes } = req.body || {};
        const existing = await dbGet('SELECT * FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Client not found');

        await dbRun(
            `UPDATE clients SET name = ?, mrr = ?, status = ?, notes = ?, updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`,
            [
                String(name || existing.name).trim(),
                toNumber(mrr, existing.mrr),
                String(status || existing.status),
                notes !== undefined ? String(notes).trim() : existing.notes,
                id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'clients', action: 'update', entityId: id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Clients update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update client');
    }
});

apiRoutes.delete('/clients/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Client not found');
        await dbRun(
            `UPDATE clients SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'clients', action: 'delete', entityId: id });
        return sendOk(res, { id: Number(id) });
    } catch (error) {
        console.error('Clients delete error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to delete client');
    }
});

apiRoutes.post('/clients/:id/restore', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Client not found');
        await dbRun(
            `UPDATE clients SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        const row = await dbGet('SELECT * FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'clients', action: 'update', entityId: id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Clients restore error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to restore client');
    }
});

// CRUD: Leads
apiRoutes.get('/leads', async (req, res) => {
    try {
        const includeDeleted = ['1', 'true', 'yes'].includes(String(req.query.includeDeleted || req.query.include_deleted || '').toLowerCase());
        const query = String(req.query.q || '').trim();
        const statusFilter = String(req.query.status || '').trim().toLowerCase();
        const tagFilters = normalizeTags(req.query.tags || req.query.tag || req.query.labels);
        const { page, limit, offset } = parsePagination(req.query);
        if (statusFilter && !LEAD_STATUSES.includes(statusFilter)) {
            return sendError(res, 400, 'Invalid status', `Status must be one of: ${LEAD_STATUSES.join(', ')}`);
        }
        let sql = 'SELECT * FROM leads WHERE tenant_id = ?';
        let countSql = 'SELECT COUNT(*) as count FROM leads WHERE tenant_id = ?';
        const params = [req.tenantId];
        const countParams = [req.tenantId];
        if (!includeDeleted) {
            sql += ' AND deleted_at IS NULL';
            countSql += ' AND deleted_at IS NULL';
        }
        if (statusFilter) {
            sql += ' AND status = ?';
            countSql += ' AND status = ?';
            params.push(statusFilter);
            countParams.push(statusFilter);
        }
        if (query) {
            sql += ' AND (name LIKE ? OR contact LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR notes LIKE ?)';
            countSql += ' AND (name LIKE ? OR contact LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR notes LIKE ?)';
            const like = `%${query}%`;
            params.push(like, like, like, like, like, like);
            countParams.push(like, like, like, like, like, like);
        }
        if (tagFilters.length) {
            tagFilters.forEach((tag) => {
                const like = `%"${tag}"%`;
                sql += ' AND (tags_json LIKE ? OR tags LIKE ?)';
                countSql += ' AND (tags_json LIKE ? OR tags LIKE ?)';
                params.push(like, like);
                countParams.push(like, like);
            });
        }
        sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [rows, countRow] = await Promise.all([
            dbAll(sql, params),
            dbGet(countSql, countParams)
        ]);
        const total = countRow?.count || 0;
        const data = rows.map((row) => ({
            id: row.id,
            name: row.name,
            contact: row.contact || row.email || row.phone || null,
            company: row.company,
            email: row.email,
            phone: row.phone,
            source: row.source,
            status: row.status,
            tags: normalizeTags(row.tags_json),
            createdBy: row.created_by,
            notes: row.notes || '',
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
        return sendOk(res, {
            items: data,
            page,
            limit,
            total,
            totalPages: limit ? Math.ceil(total / limit) : 1
        });
    } catch (error) {
        console.error('Leads fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load leads');
    }
});

apiRoutes.post('/leads', requireRole('member'), requirePlan('leads', 1), async (req, res) => {
    try {
        const payload = buildLeadPayload(req.body || {});
        const status = parseLeadStatus(req.body?.status, 'new');
        if (!status) {
            return sendError(res, 400, 'Invalid status', `Status must be one of: ${LEAD_STATUSES.join(', ')}`);
        }
        const tagList = normalizeTags(req.body?.tags || req.body?.tag || req.body?.labels);
        const lead = {
            ...payload,
            source: payload.source || 'manual',
            status
        };
        if (!hasLeadContact(lead)) {
            return sendError(res, 400, 'Invalid input', 'Lead name or contact is required');
        }
        const result = await dbRun(
            `INSERT INTO leads (name, contact, company, email, phone, source, status, tags_json, notes, owner_id, tenant_id, created_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
                lead.name || null,
                lead.contact || null,
                lead.company || null,
                lead.email || null,
                lead.phone || null,
                lead.source,
                lead.status,
                tagList.length ? JSON.stringify(tagList) : null,
                lead.notes || null,
                req.user.id,
                req.tenantId,
                req.user.id
            ]
        );
        const row = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [result.id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'leads', action: 'create', entityId: result.id });
        return sendOk(res, {
            ...row,
            tags: normalizeTags(row?.tags_json)
        });
    } catch (error) {
        console.error('Leads create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create lead');
    }
});

apiRoutes.put('/leads/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Lead not found');

        const body = req.body || {};
        const status = parseLeadStatus(body.status, existing.status);
        if (hasOwn(body, 'status') && !status) {
            return sendError(res, 400, 'Invalid status', `Status must be one of: ${LEAD_STATUSES.join(', ')}`);
        }

        const tags = hasOwn(body, 'tags') || hasOwn(body, 'tag') || hasOwn(body, 'labels')
            ? normalizeTags(body.tags || body.tag || body.labels)
            : normalizeTags(existing.tags_json);
        const emailValue = hasOwn(body, 'email') ? normalizeEmail(body.email) : existing.email;
        const phoneValue = hasOwn(body, 'phone') ? toSafeString(body.phone) : existing.phone;
        const contactValue = hasOwn(body, 'contact') ? toSafeString(body.contact) : existing.contact;
        const lead = {
            name: hasOwn(body, 'name') ? toSafeString(body.name) : existing.name,
            company: hasOwn(body, 'company') ? toSafeString(body.company) : existing.company,
            email: emailValue,
            phone: phoneValue,
            contact: contactValue || emailValue || phoneValue,
            source: hasOwn(body, 'source') ? toSafeString(body.source) : existing.source,
            status,
            tags,
            notes: hasOwn(body, 'notes') ? toSafeString(body.notes) : existing.notes
        };
        if (!hasLeadContact(lead)) {
            return sendError(res, 400, 'Invalid input', 'Lead name or contact is required');
        }

        await dbRun(
            `UPDATE leads SET name = ?, contact = ?, company = ?, email = ?, phone = ?, source = ?, status = ?, tags_json = ?, notes = ?, updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`,
            [
                lead.name || null,
                lead.contact || null,
                lead.company || null,
                lead.email || null,
                lead.phone || null,
                lead.source || null,
                lead.status,
                lead.tags?.length ? JSON.stringify(lead.tags) : null,
                lead.notes || null,
                id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'leads', action: 'update', entityId: id });
        return sendOk(res, {
            ...row,
            tags: normalizeTags(row?.tags_json)
        });
    } catch (error) {
        console.error('Leads update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update lead');
    }
});

apiRoutes.get('/leads/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return sendError(res, 400, 'Invalid id', 'Lead id is required');
        const row = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!row) return sendError(res, 404, 'Not Found', 'Lead not found');
        return sendOk(res, {
            ...row,
            tags: normalizeTags(row.tags_json)
        });
    } catch (error) {
        console.error('Lead fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load lead');
    }
});

apiRoutes.patch('/leads/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return sendError(res, 400, 'Invalid id', 'Lead id is required');
        const existing = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Lead not found');

        const body = req.body || {};
        const status = hasOwn(body, 'status') ? parseLeadStatus(body.status, existing.status) : existing.status;
        if (hasOwn(body, 'status') && !status) {
            return sendError(res, 400, 'Invalid status', `Status must be one of: ${LEAD_STATUSES.join(', ')}`);
        }
        const tags = hasOwn(body, 'tags') || hasOwn(body, 'tag') || hasOwn(body, 'labels')
            ? normalizeTags(body.tags || body.tag || body.labels)
            : normalizeTags(existing.tags_json);
        const notes = hasOwn(body, 'notes') ? toSafeString(body.notes) : existing.notes;

        await dbRun(
            `UPDATE leads SET status = ?, tags_json = ?, notes = ?, updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`,
            [
                status,
                tags.length ? JSON.stringify(tags) : null,
                notes || null,
                id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'leads', action: 'update', entityId: id });
        return sendOk(res, {
            ...row,
            tags: normalizeTags(row?.tags_json)
        });
    } catch (error) {
        console.error('Leads patch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update lead');
    }
});

apiRoutes.delete('/leads/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Lead not found');
        await dbRun(
            `UPDATE leads SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'leads', action: 'delete', entityId: id });
        return sendOk(res, { id: Number(id) });
    } catch (error) {
        console.error('Leads delete error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to delete lead');
    }
});

apiRoutes.post('/leads/:id/restore', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Lead not found');
        await dbRun(
            `UPDATE leads SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        const row = await dbGet('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'leads', action: 'update', entityId: id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Leads restore error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to restore lead');
    }
});

// CRUD: Providers
apiRoutes.get('/providers', async (req, res) => {
    try {
        const includeDeleted = ['1', 'true', 'yes'].includes(String(req.query.includeDeleted || req.query.include_deleted || '').toLowerCase());
        let sql = 'SELECT * FROM providers WHERE tenant_id = ?';
        const params = [req.tenantId];
        if (!includeDeleted) {
            sql += ' AND deleted_at IS NULL';
        }
        sql += ' ORDER BY id DESC';
        const rows = await dbAll(sql, params);
        const data = rows.map((row) => ({
            id: row.id,
            name: row.name,
            services: normalizeServices(row.services),
            payoutRate: row.payout_rate,
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Providers fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load providers');
    }
});

apiRoutes.post('/providers', requireRole('member'), async (req, res) => {
    try {
        const { name, services, payoutRate } = req.body || {};
        if (!name || String(name).trim().length < 2) {
            return sendError(res, 400, 'Invalid name', 'Provider name is required');
        }
        const canCreate = await checkLimitOrReject(req, res, { key: 'maxProviders', table: 'providers' });
        if (!canCreate) return;
        const serviceList = normalizeServices(services);
        const safePayout = toNumber(payoutRate, 0);
        const result = await dbRun(
            `INSERT INTO providers (name, services, payout_rate, owner_id, tenant_id, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [String(name).trim(), JSON.stringify(serviceList), safePayout, req.user.id, req.tenantId]
        );
        const row = await dbGet('SELECT * FROM providers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [result.id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'providers', action: 'create', entityId: result.id });
        return sendOk(res, {
            ...row,
            services: normalizeServices(row.services),
            payoutRate: row.payout_rate
        });
    } catch (error) {
        console.error('Providers create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create provider');
    }
});

apiRoutes.put('/providers/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, services, payoutRate } = req.body || {};
        const existing = await dbGet('SELECT * FROM providers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Provider not found');

        const serviceList = services !== undefined ? normalizeServices(services) : normalizeServices(existing.services);
        await dbRun(
            `UPDATE providers SET name = ?, services = ?, payout_rate = ?, updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`,
            [
                String(name || existing.name).trim(),
                JSON.stringify(serviceList),
                toNumber(payoutRate, existing.payout_rate),
                id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM providers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'providers', action: 'update', entityId: id });
        return sendOk(res, {
            ...row,
            services: normalizeServices(row.services),
            payoutRate: row.payout_rate
        });
    } catch (error) {
        console.error('Providers update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update provider');
    }
});

apiRoutes.delete('/providers/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM providers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Provider not found');
        await dbRun(
            `UPDATE providers SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'providers', action: 'delete', entityId: id });
        return sendOk(res, { id: Number(id) });
    } catch (error) {
        console.error('Providers delete error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to delete provider');
    }
});

apiRoutes.post('/providers/:id/restore', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM providers WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Provider not found');
        await dbRun(
            `UPDATE providers SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        const row = await dbGet('SELECT * FROM providers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'providers', action: 'update', entityId: id });
        return sendOk(res, {
            ...row,
            services: normalizeServices(row.services),
            payoutRate: row.payout_rate
        });
    } catch (error) {
        console.error('Providers restore error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to restore provider');
    }
});

// CRUD: Orders
apiRoutes.get('/orders', async (req, res) => {
    try {
        const includeDeleted = ['1', 'true', 'yes'].includes(String(req.query.includeDeleted || req.query.include_deleted || '').toLowerCase());
        let sql = 'SELECT * FROM orders WHERE tenant_id = ?';
        const params = [req.tenantId];
        if (!includeDeleted) {
            sql += ' AND deleted_at IS NULL';
        }
        sql += ' ORDER BY id DESC';
        const rows = await dbAll(sql, params);
        const data = rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
        return sendOk(res, data);
    } catch (error) {
        console.error('Orders fetch error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to load orders');
    }
});

apiRoutes.get('/orders/export', requireRole('member'), requirePlan('exports', 1), async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT id, title, description, status, priority, created_at, updated_at
             FROM orders
             WHERE tenant_id = ? AND deleted_at IS NULL
             ORDER BY id DESC`,
            [req.tenantId]
        );
        const csv = toCsv(rows, ['id', 'title', 'description', 'status', 'priority', 'created_at', 'updated_at']);
        await logAudit({
            userId: req.user.id,
            tenantId: req.tenantId,
            entity: 'export',
            action: 'orders',
            entityId: req.tenantId,
            meta: { format: 'csv', count: rows.length }
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
        return res.send(csv);
    } catch (error) {
        console.error('Orders export error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to export orders');
    }
});

apiRoutes.post('/orders', requireRole('member'), requirePlan('orders', 1), async (req, res) => {
    try {
        const { title, description, status, priority } = req.body || {};
        if (!title || String(title).trim().length < 2) {
            return sendError(res, 400, 'Invalid title', 'Order title is required');
        }
        const result = await dbRun(
            `INSERT INTO orders (title, description, status, priority, owner_id, tenant_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
                String(title).trim(),
                description || null,
                String(status || 'Pending'),
                String(priority || 'Medium'),
                req.user.id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [result.id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'orders', action: 'create', entityId: result.id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Orders create error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to create order');
    }
});

apiRoutes.put('/orders/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, status, priority } = req.body || {};
        const existing = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Order not found');

        await dbRun(
            `UPDATE orders SET title = ?, description = ?, status = ?, priority = ?, updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`,
            [
                String(title || existing.title).trim(),
                description !== undefined ? description : existing.description,
                String(status || existing.status),
                String(priority || existing.priority),
                id,
                req.tenantId
            ]
        );
        const row = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'orders', action: 'update', entityId: id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Orders update error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to update order');
    }
});

apiRoutes.delete('/orders/:id', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Order not found');
        await dbRun(
            `UPDATE orders SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'orders', action: 'delete', entityId: id });
        return sendOk(res, { id: Number(id) });
    } catch (error) {
        console.error('Orders delete error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to delete order');
    }
});

apiRoutes.post('/orders/:id/restore', requireRole('member'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
        if (!existing) return sendError(res, 404, 'Not Found', 'Order not found');
        await dbRun(
            `UPDATE orders SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
            [id, req.tenantId]
        );
        const row = await dbGet('SELECT * FROM orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [id, req.tenantId]);
        await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'orders', action: 'update', entityId: id });
        return sendOk(res, row);
    } catch (error) {
        console.error('Orders restore error:', error);
        return sendError(res, 500, 'Internal server error', 'Failed to restore order');
    }
});

// Mount API routes
if (RATE_LIMIT_ENABLED) {
    app.use('/api', apiLimiter);
}
app.use('/api', publicApiRoutes);
app.post('/api/autopilot/enable', requireAutopilotFallbackAuth, (req, res) => {
    req.url = '/autopilot/enable';
    req.method = 'POST';
    return apiRoutes.handle(req, res);
});
app.post('/api/autopilot/tick', requireAutopilotFallbackAuth, (req, res) => {
    req.url = '/autopilot/tick';
    req.method = 'POST';
    return apiRoutes.handle(req, res);
});
app.use('/api/owner', requireAuthApi, requireSuperadminApi, ownerApiRoutes);
app.use('/api', requireAuthApiOrKey, apiRoutes);

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Diagnostics
app.get('/__status', (req, res) => {
    res.json({
        entryFile: isProd ? path.basename(__filename) : __filename,
        dbFile: isProd ? path.basename(DB_PATH) : DB_PATH,
        nodeEnv: process.env.NODE_ENV || 'development',
        port: PORT,
        mountedRoutes: [
            '/api',
            '/__status'
        ],
        staticSources: [
            '/static -> backend/public',
            '/uploads -> backend/uploads',
            '/legacy -> backend/html'
        ]
    });
});

// ========== STATIC UI (backend) ==========
app.get('/static/sw.js', (req, res) => {
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'backend', 'public', 'sw.js'));
});

app.use('/static', express.static(path.join(__dirname, 'backend', 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'backend', 'uploads')));
app.use('/legacy', express.static(path.join(__dirname, 'backend', 'html')));

app.get('/manifest.webmanifest', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'public', 'manifest.webmanifest'));
});

app.get('/sw.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'public', 'sw.js'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'index.html'));
});

app.get('/app', requireAuthPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'app.html'));
});

app.get('/autopilot/:slug', requireAuthPage, async (req, res) => {
    try {
        const slug = toSafeString(req.params.slug);
        if (!slug) {
            return res.status(404).send('Not found');
        }
        const landings = await autopilotStorage.listLandings(req.tenantId);
        const landing = landings.find((item) => item.slug === slug);
        if (!landing) {
            return res.status(404).send('Not found');
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(landing.html || '');
    } catch (error) {
        console.error('Autopilot landing error:', error);
        return res.status(500).send('Failed to load landing');
    }
});

app.get('/pricing', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'pricing.html'));
});

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'docs.html'));
});

app.get('/help', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'help.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'register.html'));
});

app.get('/account', requireAuthPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'account.html'));
});

app.get('/cabinet', requireAuthPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'cabinet.html'));
});

app.get('/admin', requireSuperadminPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'admin.html'));
});

app.get('/dashboard', requireAuthPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'backend', 'pages', 'app.html'));
});

const portalRoutes = ['projects', 'ai', 'orders', 'clients', 'leads', 'providers', 'compliance'];
portalRoutes.forEach(route => {
    app.get(`/${route}`, requireAuthPage, (req, res) => {
        res.sendFile(path.join(__dirname, 'backend', 'pages', 'app.html'));
    });
});

// ========== ERROR HANDLING ==========
app.use((req, res, next) => {
    res.status(404).json({
        ok: false,
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`,
        availableRoutes: [
            '/api/auth/register',
            '/api/auth/login',
            '/api/auth/logout',
            '/api/auth/me',
            '/api/health',
            '/api/leads/webhook',
            '/api/subscription/me',
            '/api/chat',
            '/api/ai-project',
            '/api/stats',
            '/api/usage',
            '/api/webhooks/health',
            '/api/subscription/upgrade',
            '/api/subscription/downgrade',
            '/api/billing/create-checkout-session',
            '/api/audit/recent',
            '/api/admin/stats',
            '/api/admin/tenants',
            '/api/admin/bootstrap',
            '/api/admin/bootstrap/status',
            '/api/projects/export',
            '/api/orders/export',
            '/api/projects/:id/restore',
            '/api/clients/:id/restore',
            '/api/leads/:id/restore',
            '/api/providers/:id/restore',
            '/api/orders/:id/restore',
            '/api/user/onboarding',
            '/api/demo/seed',
            '/api/tenants',
            '/api/tenants/active',
            '/api/tenants/members',
            '/api/tenants/rename',
            '/api/tenants/invite',
            '/api/tenants/request-admin',
            '/api/tenants/approve-admin',
            '/api/workspace/me',
            '/api/workspace/members',
            '/api/workspace/rename',
            '/api/workspace/invite',
            '/api/feedback',
            '/api/feedback/me',
            '/api/events',
            '/api/agent/events',
            '/api/agent/dispatch',
            '/api/agent/messages',
            '/api/agent/heartbeat',
            '/api/agent/status',
            '/api/agent/install-command',
            '/api/agent/download',
            '/api/agent/actions',
            '/api/agent/actions/execute',
            '/api/agent/actions/:id/execute',
            '/api/approvals',
            '/api/autopilot/enable',
            '/api/autopilot/status',
            '/api/autopilot/tick',
            '/api/autopilot/offers',
            '/api/autopilot/leads',
            '/api/autopilot/leads/capture',
            '/api/autopilot/metrics',
            '/api/kb/articles',
            '/api/kb/articles/:id',
            '/api/support/tickets',
            '/api/projects',
            '/api/clients',
            '/api/leads',
            '/api/providers',
            '/api/orders'
        ]
    });
});

// Use community error handler
app.use(errorHandler);

let server;
let autopilotTimer;
let autopilotInProgress = false;

const broadcastEvent = (event, data, tenantId = null) => {
    if (!global.io) return;
    const payload = { event, data, timestamp: Date.now() };
    if (tenantId) {
        global.io.to(`tenant:${tenantId}`).emit('portal-event', payload);
    } else {
        global.io.emit('portal-event', payload);
    }
    console.log(`[WS] Broadcast: ${event}`, tenantId ? `to tenant:${tenantId}` : 'to all');
};

const resolveAutopilotOperatorId = async (tenantId) => {
    const row = await dbGet(
        `SELECT user_id
         FROM tenant_memberships
         WHERE tenant_id = ? AND status = 'active'
         ORDER BY CASE
            WHEN role = 'owner' THEN 0
            WHEN role = 'admin' THEN 1
            ELSE 2
         END, id ASC
         LIMIT 1`,
        [tenantId]
    );
    return row?.user_id || null;
};

const runAutopilotSchedulerTick = async () => {
    if (autopilotInProgress) return;
    autopilotInProgress = true;
    try {
        const tenants = await dbAll('SELECT id, name FROM tenants ORDER BY id ASC');
        for (const tenant of tenants) {
            const settings = await autopilotStorage.getTenantSettings(tenant.id);
            if (!settings.enabled) continue;
            const userId = await resolveAutopilotOperatorId(tenant.id);
            if (!userId) continue;
            const plan = await getPlanForTenant(tenant.id, userId);
            const usageCheck = await consumeUsage({ tenantId: tenant.id, plan, metric: 'autopilot', cost: 1 });
            if (!usageCheck.ok) continue;
            await autopilotEngine.runCycle({
                tenantId: tenant.id,
                userId,
                tenantName: tenant.name,
                reason: 'scheduled'
            });
        }
    } catch (error) {
        console.error('Autopilot scheduler error:', error);
    } finally {
        autopilotInProgress = false;
    }
};

const startAutopilotScheduler = () => {
    if (!autopilotEngine.shouldRunScheduler()) {
        console.log('Autopilot scheduler disabled. Set AUTOPILOT_ENABLED=true to enable.');
        return;
    }
    if (autopilotTimer) return;
    const intervalMin = Math.max(5, toNumber(process.env.AUTOPILOT_INTERVAL_MIN || 60, 60));
    autopilotTimer = setInterval(runAutopilotSchedulerTick, intervalMin * 60 * 1000);
    setTimeout(runAutopilotSchedulerTick, 5000);
};

initDb()
    .then(() => {
        server = app.listen(

            PORT, HOST, () => {
                console.log(`
══════════════════════════════════════════════════════
PORTAL GLOBAL SERVER
══════════════════════════════════════════════════════
URL:         http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}
Environment: ${process.env.NODE_ENV || 'development'}
PID:         ${process.pid}

── CONFIG (Community Mode) ───────────────────────────
COMMUNITY_MODE:       ${COMMUNITY_MODE ? 'ON' : 'OFF'}
AUTOPILOT_ENABLED:   ${AUTOPILOT_ENABLED ? 'ON' : 'OFF'}
EXTERNAL_LLM_ENABLED: ${EXTERNAL_LLM_ENABLED ? 'ON' : 'OFF'}
RATE_LIMIT_ENABLED:  ${RATE_LIMIT_ENABLED ? 'ON' : 'OFF'}
DEMO_ORIGIN:         ${DEMO_ORIGIN}
TRUST_PROXY:         ${process.env.TRUST_PROXY || 1}
BODY_SIZE_LIMIT:     ${BODY_SIZE_LIMIT}
AUTH_CACHE_TTL_MS:   ${AUTH_CACHE_TTL_MS}
SOCKET_MAX_CONN_IP:  ${SOCKET_MAX_CONNECTIONS_PER_IP}
══════════════════════════════════════════════════════
`);
                startAutopilotScheduler();
            
            const io = new Server(server, {
                cors: {
                    origin: DEMO_ORIGIN,
                    methods: ['GET', 'POST'],
                    credentials: true
                },
                pingTimeout: SOCKET_PING_TIMEOUT,
                pingInterval: SOCKET_PING_INTERVAL,
                maxHttpBufferSize: 1e6,
                transports: ['websocket', 'polling']
            });
            
            const socketIpMap = new Map();
            const MAX_SOCKET_CONNECTIONS = SOCKET_MAX_CONNECTIONS_PER_IP;
            
            const getClientIp = (socket) => {
                return socket.handshake.headers['x-forwarded-for'] || 
                       socket.handshake.headers['x-real-ip'] || 
                       socket.handshake.address ||
                       socket.conn.remoteAddress ||
                       'unknown';
            };
            
            global.io = io;
            
            io.on('connection', (socket) => {
                const clientIp = getClientIp(socket);
                const currentCount = socketIpMap.get(clientIp) || 0;
                
                if (currentCount >= MAX_SOCKET_CONNECTIONS) {
                    console.log(`[WS] Rejecting connection from ${clientIp}: too many connections (${currentCount})`);
                    socket.disconnect(true);
                    return;
                }
                
                socketIpMap.set(clientIp, currentCount + 1);
                console.log(`[WS] Client connected: ${socket.id} from ${clientIp} (total: ${currentCount + 1})`);
                
                socket.on('join', (data) => {
                    if (data?.tenantId) {
                        socket.join(`tenant:${data.tenantId}`);
                        console.log(`[WS] Socket ${socket.id} joined tenant:${data.tenantId}`);
                    }
                });
                
                socket.on('disconnect', () => {
                    const newCount = (socketIpMap.get(clientIp) || 1) - 1;
                    if (newCount <= 0) {
                        socketIpMap.delete(clientIp);
                    } else {
                        socketIpMap.set(clientIp, newCount);
                    }
                    console.log(`[WS] Client disconnected: ${socket.id} from ${clientIp} (remaining: ${newCount})`);
                });
            });
            
            console.log('[WS] Socket.IO server initialized');
        });
    })
    .catch((error) => {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    });

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    if (autopilotTimer) {
        clearInterval(autopilotTimer);
    }
    if (!server) return process.exit(0);
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down...');
    if (autopilotTimer) {
        clearInterval(autopilotTimer);
    }
    if (!server) return process.exit(0);
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = { app, server };


