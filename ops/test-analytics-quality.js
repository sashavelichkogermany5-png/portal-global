const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.join(__dirname, '..');
const tmpDir = path.join(__dirname, 'tmp');
const logPath = path.join(tmpDir, 'analytics-quality.ndjson');
const token = 'dev-123';
const port = 3099;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const writeSyntheticLog = () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const lines = [];
    const now = Date.now();
    const makeTs = (offsetMs) => new Date(now - offsetMs).toISOString();

    const baseEntry = (overrides) => JSON.stringify({
        ts: makeTs(1000),
        path: '/api/health',
        method: 'GET',
        status: 200,
        ip: '1.2.3.4',
        ua: 'PortalTest/1.0',
        ...overrides
    });

    for (let i = 0; i < 60; i += 1) {
        lines.push(baseEntry({
            ts: makeTs(2000 + i * 50),
            path: '/api/auth/me',
            method: 'GET',
            ip: '1.2.3.4',
            ua: 'Mozilla/5.0 (PortalTest)'
        }));
    }

    lines.push(baseEntry({
        ts: makeTs(4000),
        path: '/api/projects/123',
        method: 'GET',
        ip: '1.2.3.4'
    }));
    lines.push(baseEntry({
        ts: makeTs(4500),
        path: '/api/projects/124',
        method: 'GET',
        ip: '::ffff:1.2.3.4'
    }));
    lines.push(baseEntry({
        ts: makeTs(5000),
        path: '/api/projects/123/tasks/987',
        method: 'GET',
        ip: '::1'
    }));

    for (let i = 0; i < 10; i += 1) {
        lines.push(baseEntry({
            ts: makeTs(6000 + i * 200),
            path: '/api/health',
            method: 'OPTIONS',
            ip: '2.2.2.2',
            ua: ''
        }));
    }

    lines.push(baseEntry({
        ts: makeTs(7000),
        path: '/api/admin/ping',
        method: 'HEAD',
        ip: '2.2.2.2',
        ua: ''
    }));

    lines.push('{"bad":');
    lines.push('{"path":"/api/projects/123"}');

    const longLine = '{"ts":"' + makeTs(8000) + '","path":"/api/projects/999","method":"GET","ip":"1.2.3.4","ua":"'
        + 'a'.repeat(70000) + '"}';
    lines.push(longLine);

    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
};

const waitForServer = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (response.ok) return;
        } catch (error) {
            // ignore
        }
        await sleep(500);
    }
    throw new Error('Server did not start in time');
};

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const run = async () => {
    let serverProcess;
    let stdout = '';
    let stderr = '';
    try {
        writeSyntheticLog();

        const env = {
            ...process.env,
            PORT: String(port),
            DEV_ADMIN_TOKEN: token,
            ANALYTICS_LOG_PATH: logPath,
            ANALYTICS_DEDUP_WINDOW_MS: '5000',
            ANALYTICS_IGNORE_OPTIONS: '1',
            ANALYTICS_IGNORE_NOISE_PATHS: '1',
            ANALYTICS_EXCLUDE_PRIVATE_IPS: '0'
        };

        serverProcess = spawn('node', ['server.js'], {
            cwd: rootDir,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        serverProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        serverProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        await waitForServer();

        const pingResponse = await fetch(
            `http://127.0.0.1:${port}/api/admin/ping`,
            { headers: { 'X-Admin-Token': token } }
        );
        const pingBody = await pingResponse.json().catch(() => ({}));
        assert(pingResponse.ok && pingBody.ok, 'Admin ping failed');

        const response = await fetch(
            `http://127.0.0.1:${port}/api/admin/analytics/summary?days=1&debug=1`,
            { headers: { 'X-Admin-Token': token } }
        );
        const body = await response.json().catch(() => ({}));

        assert(response.ok, 'Summary request failed');
        assert(body.ok, 'Summary response not ok');

        const data = body.data || {};
        const summary = data.summary || {};
        const quality = summary.quality || {};

        assert(Array.isArray(data.topPaths), 'topPaths missing');
        assert(Array.isArray(data.latest), 'latest missing');
        assert(Array.isArray(data.histogram), 'histogram missing');
        assert(typeof data.totals === 'object', 'totals missing');
        assert(Number.isFinite(data.uniqueIpsApprox), 'uniqueIpsApprox missing');

        const hasNormalized = data.topPaths.some((item) => item.path === '/api/projects/:id');
        assert(hasNormalized, 'Normalized path /api/projects/:id not found');

        assert(quality.deduped > 0, 'Expected deduped > 0');
        assert(quality.droppedLines > 0, 'Expected droppedLines > 0');
        assert(quality.noiseCount > 0, 'Expected noiseCount > 0');

        const uniqueIps = summary.uniqueIps ?? data.uniqueIpsApprox;
        assert(uniqueIps === 2, `Expected uniqueIps=2, got ${uniqueIps}`);

        assert(summary.debug, 'Debug payload missing');

        console.log('PASS: analytics quality checks');
    } catch (error) {
        console.error('FAIL:', error.message);
        if (stdout) {
            console.error('--- server stdout ---');
            console.error(stdout.trim());
        }
        if (stderr) {
            console.error('--- server stderr ---');
            console.error(stderr.trim());
        }
        process.exitCode = 1;
    } finally {
        if (serverProcess) {
            serverProcess.kill();
        }
    }
};

run();
