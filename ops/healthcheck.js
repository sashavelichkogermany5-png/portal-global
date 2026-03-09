const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const REQUEST_TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 5000);
const START_TIMEOUT_MS = Number(process.env.HEALTHCHECK_START_TIMEOUT_MS || 30000);
const AUTOSTART_ENABLED = process.env.HEALTHCHECK_AUTOSTART !== '0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveHealthUrl = () => {
  const override = process.env.HEALTHCHECK_URL;
  if (override) return override;
  const port = process.env.BACKEND_PORT || process.env.PORT || '3000';
  return `http://localhost:${port}/api/health`;
};

const requestHealth = (targetUrl) => new Promise((resolve, reject) => {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;
  const request = client.request(url, { method: 'GET', timeout: REQUEST_TIMEOUT_MS }, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk.toString();
    });
    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve(body || '{"ok":true}');
        return;
      }
      const error = new Error(body || `Healthcheck failed (${res.statusCode || 1})`);
      error.statusCode = res.statusCode || 1;
      reject(error);
    });
  });

  request.on('timeout', () => {
    request.destroy(new Error('Healthcheck timeout'));
  });

  request.on('error', (error) => {
    reject(error);
  });

  request.end();
});

const shouldAutostart = (error) => {
  const code = error && typeof error === 'object' ? error.code : null;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ETIMEDOUT';
};

const startServerForHealthcheck = async (targetUrl) => {
  const url = new URL(targetUrl);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const projectRoot = path.resolve(__dirname, '..');
  const env = {
    ...process.env,
    PORT: port,
    BACKEND_PORT: port,
    WEB_PORT: process.env.WEB_PORT || '3001',
    NODE_ENV: process.env.NODE_ENV || 'test'
  };

  let stderr = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(stderr.trim() || `Server exited before healthcheck completed (code ${child.exitCode})`);
    }
    try {
      const body = await requestHealth(targetUrl);
      return { body, child };
    } catch (error) {
      if (!shouldAutostart(error)) {
        throw error;
      }
      await sleep(500);
    }
  }

  child.kill();
  throw new Error(stderr.trim() || 'Healthcheck autostart timeout');
};

const main = async () => {
  const healthUrl = resolveHealthUrl();

  try {
    const body = await requestHealth(healthUrl);
    process.stdout.write(body);
    return;
  } catch (error) {
    if (!AUTOSTART_ENABLED || !shouldAutostart(error)) {
      process.stderr.write(error.message || 'Healthcheck failed');
      process.exitCode = 1;
      return;
    }

    let child = null;
    try {
      const result = await startServerForHealthcheck(healthUrl);
      child = result.child;
      process.stdout.write(result.body);
    } catch (startError) {
      process.stderr.write(startError.message || 'Healthcheck failed');
      process.exitCode = 1;
    } finally {
      if (child) {
        child.kill();
      }
    }
  }
};

main();
