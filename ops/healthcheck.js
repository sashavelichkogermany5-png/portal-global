const http = require('http');
const https = require('https');

const resolveHealthUrl = () => {
  const override = process.env.HEALTHCHECK_URL;
  if (override) return override;
  const port = process.env.BACKEND_PORT || process.env.PORT || '3000';
  return `http://localhost:${port}/api/health`;
};

const url = new URL(resolveHealthUrl());
const client = url.protocol === 'https:' ? https : http;

const request = client.request(url, { method: 'GET', timeout: 5000 }, (res) => {
  let body = '';
  res.on('data', (chunk) => {
    body += chunk.toString();
  });
  res.on('end', () => {
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      process.stdout.write(body || '{"ok":true}');
      process.exit(0);
    } else {
      const code = res.statusCode || 1;
      process.stderr.write(body || `Healthcheck failed (${code})`);
      process.exit(code);
    }
  });
});

request.on('timeout', () => {
  request.destroy(new Error('Healthcheck timeout'));
});

request.on('error', (err) => {
  process.stderr.write(err.message || 'Healthcheck failed');
  process.exit(1);
});

request.end();
