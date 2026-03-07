const { timingSafeEqualString } = require('../lib/keys');

const COMMUNITY_MODE = process.env.COMMUNITY_MODE === '1' || process.env.COMMUNITY_MODE === 'true';
const AUTOPILOT_ENABLED = process.env.AUTOPILOT_ENABLED === '1' || process.env.AUTOPILOT_ENABLED === 'true';
const HIDE_STACKTRACES = process.env.HIDE_STACKTRACES !== '0' && process.env.HIDE_STACKTRACES !== 'false';

const getHeaderValue = (value) => (Array.isArray(value) ? value[0] : value);

const getAdminToken = (req) => {
    const headerToken = String(getHeaderValue(req.headers['x-admin-token']) || '').trim();
    if (headerToken) return headerToken;

    const queryToken = String(getHeaderValue(req.query?.token) || '').trim();
    if (queryToken) return queryToken;

    const authHeader = getHeaderValue(req.headers.authorization || req.headers.Authorization);
    if (typeof authHeader === 'string') {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match) {
            return String(match[1] || '').trim();
        }
    }

    return '';
};

const isAdminTokenValid = (token) => {
    const expected = String(process.env.DEV_ADMIN_TOKEN || '').trim();
    if (!expected) return false;
    const candidate = String(token || '').trim();
    if (!candidate) return false;
    return timingSafeEqualString(expected, candidate);
};

const ALLOWED_PUBLIC_PATHS = [
    '/api/health',
    '/api/health/local',
    '/api/feature-flags',
    '/api/auth/login',
    '/api/auth/register',
    '/api/feedback'
];

const ALLOWED_PUBLIC_PREFIXES = [
    '/api/auth/'
];

const isPublicPath = (path) => {
    if (ALLOWED_PUBLIC_PATHS.includes(path)) return true;
    if (ALLOWED_PUBLIC_PATHS.includes('/api' + path)) return true;
    for (const prefix of ALLOWED_PUBLIC_PREFIXES) {
        if (path.startsWith(prefix)) return true;
        if (('/api' + path).startsWith(prefix)) return true;
    }
    return false;
};

const isWriteMethod = (method) => {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
};

const isAutopilotPath = (path) => {
    return path.startsWith('/api/autopilot') || 
           path.startsWith('/api/agent/dispatch') ||
           path.includes('/autopilot/');
};

const communityGuard = (req, res, next) => {
    if (!COMMUNITY_MODE) {
        return next();
    }

    const path = req.path || req.originalUrl || '';
    const method = req.method;

    if (isAutopilotPath(path) && !AUTOPILOT_ENABLED) {
        return res.status(503).json({
            error: 'Service Unavailable',
            message: 'Autopilot is disabled. Set AUTOPILOT_ENABLED=1 to enable.'
        });
    }

    const adminToken = getAdminToken(req);
    if (isAdminTokenValid(adminToken)) {
        req.isDevAdminToken = true;
        return next();
    }

    if (isPublicPath(path)) {
        return next();
    }

    const hasAuth = req.user && req.user.id;
    const userRole = req.user?.role || req.tenantRole || null;
    const isAdmin = userRole === 'admin' || userRole === 'superadmin' || req.user?.isSuperadmin;

    if (!hasAuth) {
        if (path.startsWith('/api/')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required'
            });
        }
        return next();
    }

    if (isWriteMethod(method) && !isAdmin) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Write operations require admin role in community mode'
        });
    }

    next();
};

const errorHandler = (err, req, res, next) => {
    console.error('[ERROR]', err.message, {
        path: req.path,
        method: req.method,
        ip: req.ip,
        requestId: req.requestId
    });

    const statusCode = err.statusCode || err.status || 500;
    const response = {
        error: err.name || 'Error',
        message: err.message || 'Internal server error'
    };

    if (HIDE_STACKTRACES) {
        delete response.stack;
    } else {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

const requestLogger = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || 
                     req.headers['x-correlation-id'] || 
                     Math.random().toString(36).substring(2, 15);
    
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = {
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration,
            ip: req.ip,
            userId: req.user?.id || null
        };

        if (res.statusCode === 429) {
            console.warn('[RATE LIMIT]', JSON.stringify(log));
        } else {
            console.log(JSON.stringify(log));
        }
    });

    next();
};

module.exports = {
    communityGuard,
    errorHandler,
    requestLogger,
    getAdminToken,
    isAdminTokenValid,
    isCommunityMode: () => COMMUNITY_MODE,
    isAutopilotEnabled: () => AUTOPILOT_ENABLED
};
