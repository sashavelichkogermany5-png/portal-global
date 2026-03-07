const crypto = require('crypto');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeIp = (valueOrXff) => {
    if (!valueOrXff) return '';
    let raw = String(valueOrXff).split(',')[0].trim();
    if (!raw) return '';

    raw = raw.replace(/^"+|"+$/g, '').trim();
    raw = raw.replace(/^for=/i, '').trim();

    if (raw.startsWith('[')) {
        const end = raw.indexOf(']');
        if (end !== -1) {
            raw = raw.slice(1, end);
        }
    } else if (raw.includes('.') && raw.includes(':')) {
        const parts = raw.split(':');
        if (parts.length === 2 && /^\d+$/.test(parts[1])) {
            raw = parts[0];
        }
    }

    raw = raw.split('%')[0];

    const lower = raw.toLowerCase();
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return '127.0.0.1';
    if (lower.startsWith('::ffff:')) {
        const mapped = raw.slice(7);
        return mapped || raw;
    }

    return raw;
};

const normalizeIpFromReq = (req) => {
    if (!req) return '';
    const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'];
    const direct = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
    return normalizeIp(forwarded || direct);
};

const isPrivateIp = (ip) => {
    if (!ip) return false;
    const normalized = normalizeIp(ip);
    if (!normalized) return false;

    if (normalized.includes(':')) {
        const lower = normalized.toLowerCase();
        if (lower === '::1') return true;
        if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
        if (lower.startsWith('fe80')) return true;
        return false;
    }

    const parts = normalized.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return false;
    const [p1, p2] = parts;

    if (p1 === 10) return true;
    if (p1 === 127) return true;
    if (p1 === 169 && p2 === 254) return true;
    if (p1 === 192 && p2 === 168) return true;
    if (p1 === 172 && p2 >= 16 && p2 <= 31) return true;

    return false;
};

const normalizeSegment = (segment) => {
    const clean = String(segment || '').trim();
    if (!clean) return clean;
    if (UUID_REGEX.test(clean)) return ':id';
    if (/^\d{3,}$/.test(clean)) return ':id';
    if (/^[0-9a-f]{12,}$/i.test(clean)) return ':id';
    if (clean.length >= 16 && /^[a-zA-Z0-9_-]+$/.test(clean) && /\d/.test(clean)) return ':id';
    return clean;
};

const normalizePath = (pathOrUrl) => {
    if (!pathOrUrl) return 'unknown';
    let raw = String(pathOrUrl).trim();
    if (!raw) return 'unknown';

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
            const url = new URL(raw);
            raw = url.pathname || '/';
        } catch (error) {
            // ignore
        }
    }

    raw = raw.split('?')[0].split('#')[0];
    if (!raw.startsWith('/')) raw = `/${raw}`;
    if (raw.length > 1 && raw.endsWith('/')) raw = raw.slice(0, -1);
    if (raw === '/') return '/';

    const segments = raw.split('/');
    const normalized = segments.map((segment, index) => (index === 0 ? '' : normalizeSegment(segment)));
    const result = normalized.join('/');
    return result || '/';
};

const hashUA = (ua) => {
    const value = String(ua || '').trim();
    if (!value) return '';
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
};

const redactKey = (value) => {
    const input = String(value || '').trim();
    if (!input) return '';
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
};

const safeParseNdjsonLine = (line, maxBytes = 65536) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    if (maxBytes && Buffer.byteLength(trimmed, 'utf8') > maxBytes) {
        return { ok: false, reason: 'line_too_long' };
    }
    try {
        return { ok: true, obj: JSON.parse(trimmed) };
    } catch (error) {
        return { ok: false, reason: 'invalid_json' };
    }
};

const classifyNoise = ({ method, pathN, ua, noisePaths = [] }) => {
    const methodValue = String(method || '').toUpperCase();
    const isMethodNoise = methodValue === 'OPTIONS' || methodValue === 'HEAD';
    const uaValue = String(ua || '').trim();
    const isEmptyUa = !uaValue;
    const pathValue = String(pathN || '');
    const isNoisePath = noisePaths.some((pattern) => {
        if (!pattern) return false;
        if (pattern.endsWith('*')) return pathValue.startsWith(pattern.slice(0, -1));
        return pathValue === pattern;
    });

    return {
        isMethodNoise,
        isNoisePath,
        isEmptyUa,
        isNoise: isMethodNoise || isNoisePath || isEmptyUa
    };
};

const makeDedupCache = ({ windowMs = 5000, maxKeys = 50000 } = {}) => {
    const cache = new Map();
    const order = [];
    const stats = { size: 0, evicted: 0 };

    const seen = (key, ts) => {
        if (!key || !Number.isFinite(ts)) return false;
        const lastSeen = cache.get(key);
        if (Number.isFinite(lastSeen) && lastSeen - ts <= windowMs) {
            return true;
        }
        if (!cache.has(key)) {
            order.push(key);
        }
        cache.set(key, ts);

        while (cache.size > maxKeys && order.length) {
            const candidate = order.shift();
            if (cache.has(candidate)) {
                cache.delete(candidate);
                stats.evicted += 1;
            }
        }

        stats.size = cache.size;
        return false;
    };

    return { seen, stats };
};

module.exports = {
    normalizeIpFromReq,
    normalizeIp,
    isPrivateIp,
    normalizePath,
    hashUA,
    makeDedupCache,
    classifyNoise,
    safeParseNdjsonLine,
    redactKey
};
