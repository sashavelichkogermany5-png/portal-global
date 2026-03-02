const fs = require('fs');
const path = require('path');

const loadEnv = () => {
    const envPath = path.join(__dirname, '..', '.env');
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

const API_BASE_URL = String(process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TEST_USER_EMAIL = String(process.env.TEST_USER_EMAIL || 'demo@local').trim();
const TEST_USER_PASSWORD = String(process.env.TEST_USER_PASSWORD || 'demo12345');
const DEFAULT_CURRENCY = String(process.env.DEFAULT_CURRENCY || 'EUR').trim().toUpperCase();

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

const unwrapData = (payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    return payload.data !== undefined ? payload.data : payload;
};

const apiRequest = async (endpoint, { method = 'GET', headers = {}, body } = {}) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method,
        headers,
        body
    });
    const text = await response.text();
    let json = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch (error) {
            json = null;
        }
    }
    return {
        ok: response.ok,
        status: response.status,
        json,
        text
    };
};

const login = async () => {
    const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
    });
    if (!res.ok) return null;
    const payload = unwrapData(res.json);
    return payload?.token || res.json?.token || null;
};

const register = async () => {
    const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
    });
    if (!res.ok) return null;
    const payload = unwrapData(res.json);
    return payload?.token || res.json?.token || null;
};

const runTest = async () => {
    let token = await login();
    if (!token) {
        token = await register();
    }
    if (!token) {
        throw new Error('Unable to login or register test user');
    }

    const tenantsRes = await apiRequest('/api/tenants', {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!tenantsRes.ok) {
        throw new Error(`Failed to load tenants: ${tenantsRes.status}`);
    }
    const tenantPayload = unwrapData(tenantsRes.json) || {};
    const memberships = Array.isArray(tenantPayload.memberships) ? tenantPayload.memberships : [];
    const tenantId = tenantPayload.activeTenantId || memberships[0]?.tenantId;
    if (!tenantId) {
        throw new Error('No tenant membership found for test user');
    }

    const amountRaw = Number(process.env.TEST_PAYMENT_AMOUNT || 100);
    const amountValue = Number.isFinite(amountRaw) ? amountRaw : 100;
    const currencyValue = String(process.env.TEST_PAYMENT_CURRENCY || DEFAULT_CURRENCY).trim().toUpperCase();
    const tagList = normalizeTags(process.env.TEST_PAYMENT_TAGS || 'test,payment_received');
    const sourceValue = String(process.env.TEST_PAYMENT_SOURCE || 'test-script').trim();

    const eventRes = await apiRequest('/api/events/financial', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Tenant-Id': String(tenantId)
        },
        body: JSON.stringify({
            type: 'payment_received',
            amount: amountValue,
            currency: currencyValue,
            tags: tagList,
            source: sourceValue
        })
    });

    if (!eventRes.ok) {
        const message = eventRes.json?.message || eventRes.text || 'Unknown error';
        throw new Error(`Failed to create financial event: ${message}`);
    }

    const eventPayload = unwrapData(eventRes.json);
    console.log(`[test-financial-event] tenant=${tenantId}`);
    console.log(`[test-financial-event] event=${eventPayload?.id || 'unknown'} emailQueued=${eventPayload?.emailQueued}`);
};

runTest().catch((error) => {
    console.error('[test-financial-event] failed:', error.message || error);
    process.exit(1);
});
