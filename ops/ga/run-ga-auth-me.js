'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = process.cwd();
const baseUrl = 'http://127.0.0.1';
const port = 3105;
const requestCount = 20;
const warmupCount = 3;
const generations = 2;
const populationSize = 5;
const resultPath = path.join(root, 'ops', 'ga', 'results-auth-me.json');

const genes = {
  AUTH_ME_TTL_MS: [0, 15000, 60000, 120000],
  AUTH_CACHE_TTL_MS: [0, 30000, 60000, 120000],
  AUTH_CACHE_MAX_SIZE: [50, 100, 200, 500]
};

const parseEnvFile = () => {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, 'utf8');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const env = {};
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, '');
    env[key] = value;
  });
  return env;
};

const toNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const candidateKey = (candidate) =>
  `${candidate.AUTH_ME_TTL_MS}|${candidate.AUTH_CACHE_TTL_MS}|${candidate.AUTH_CACHE_MAX_SIZE}`;

const randomCandidate = () => ({
  AUTH_ME_TTL_MS: pick(genes.AUTH_ME_TTL_MS),
  AUTH_CACHE_TTL_MS: pick(genes.AUTH_CACHE_TTL_MS),
  AUTH_CACHE_MAX_SIZE: pick(genes.AUTH_CACHE_MAX_SIZE)
});

const crossover = (a, b) => ({
  AUTH_ME_TTL_MS: Math.random() > 0.5 ? a.AUTH_ME_TTL_MS : b.AUTH_ME_TTL_MS,
  AUTH_CACHE_TTL_MS: Math.random() > 0.5 ? a.AUTH_CACHE_TTL_MS : b.AUTH_CACHE_TTL_MS,
  AUTH_CACHE_MAX_SIZE: Math.random() > 0.5 ? a.AUTH_CACHE_MAX_SIZE : b.AUTH_CACHE_MAX_SIZE
});

const mutate = (candidate) => {
  const mutated = { ...candidate };
  const keys = Object.keys(genes);
  const key = pick(keys);
  mutated[key] = pick(genes[key]);
  return mutated;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForHealth = async (url, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (error) {
      // ignore until ready
    }
    await sleep(200);
  }
  return false;
};

const extractCookie = (res) => {
  let cookies = [];
  if (typeof res.headers.getSetCookie === 'function') {
    cookies = res.headers.getSetCookie();
  }
  if (!cookies.length) {
    const single = res.headers.get('set-cookie');
    if (single) cookies = [single];
  }
  const pairs = cookies.map((value) => value.split(';')[0]).filter(Boolean);
  return pairs.join('; ');
};

const ensureUser = async (base) => {
  const email = 'ga-test@example.com';
  const password = 'ga-test-1234';

  const login = async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) return null;
    const cookie = extractCookie(res);
    if (!cookie) return null;
    return cookie;
  };

  const cookie = await login();
  if (cookie) return cookie;

  const registerRes = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!registerRes.ok) {
    // user may already exist; ignore
  }

  const retryCookie = await login();
  if (!retryCookie) {
    throw new Error('Failed to authenticate test user');
  }
  return retryCookie;
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
};

const benchCandidate = async (candidate, baseEnv) => {
  const env = {
    ...process.env,
    ...baseEnv,
    PORT: String(port),
    HOST: '127.0.0.1',
    RATE_LIMIT_MAX: '10000',
    AUTH_ME_RATE_LIMIT_MAX: '10000',
    AUTH_CACHE_TTL_MS: String(candidate.AUTH_CACHE_TTL_MS),
    AUTH_ME_TTL_MS: String(candidate.AUTH_ME_TTL_MS),
    AUTH_CACHE_MAX_SIZE: String(candidate.AUTH_CACHE_MAX_SIZE)
  };

  const child = spawn('node', ['server.js'], {
    cwd: root,
    env,
    stdio: 'ignore'
  });

  const healthOk = await waitForHealth(`${baseUrl}:${port}/api/health`, 20000);
  if (!healthOk) {
    child.kill();
    throw new Error('Server did not become healthy');
  }

  const cookie = await ensureUser(`${baseUrl}:${port}`);
  const timings = [];

  for (let i = 0; i < warmupCount; i += 1) {
    const res = await fetch(`${baseUrl}:${port}/api/auth/me`, {
      headers: { Cookie: cookie }
    });
    await res.text();
  }

  for (let i = 0; i < requestCount; i += 1) {
    const start = process.hrtime.bigint();
    const res = await fetch(`${baseUrl}:${port}/api/auth/me`, {
      headers: { Cookie: cookie }
    });
    await res.text();
    const end = process.hrtime.bigint();
    timings.push(Number(end - start) / 1e6);
  }

  child.kill();

  return {
    candidate,
    medianMs: percentile(timings, 50),
    p95Ms: percentile(timings, 95),
    meanMs: timings.reduce((sum, value) => sum + value, 0) / timings.length
  };
};

const run = async () => {
  const envFile = parseEnvFile();
  const baseline = {
    AUTH_ME_TTL_MS: toNumber(envFile.AUTH_ME_TTL_MS, 120000),
    AUTH_CACHE_TTL_MS: toNumber(envFile.AUTH_CACHE_TTL_MS, 120000),
    AUTH_CACHE_MAX_SIZE: toNumber(envFile.AUTH_CACHE_MAX_SIZE, 100)
  };

  const baseEnv = {
    NODE_ENV: envFile.NODE_ENV || 'development',
    COMMUNITY_MODE: envFile.COMMUNITY_MODE || '1'
  };

  const results = [];
  let population = [baseline];

  while (population.length < populationSize) {
    population.push(randomCandidate());
  }

  const seen = new Set();
  const uniquePopulation = [];
  population.forEach((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    uniquePopulation.push(candidate);
  });
  population = uniquePopulation;

  for (let gen = 0; gen < generations; gen += 1) {
    const genResults = [];
    for (const candidate of population) {
      const result = await benchCandidate(candidate, baseEnv);
      genResults.push(result);
      results.push({ generation: gen, ...result });
    }

    genResults.sort((a, b) => a.medianMs - b.medianMs);
    const elites = genResults.slice(0, 2).map((r) => r.candidate);
    const nextPopulation = [...elites];

    while (nextPopulation.length < populationSize) {
      const child = mutate(crossover(pick(elites), pick(elites)));
      nextPopulation.push(child);
    }

    const nextSeen = new Set();
    population = nextPopulation.filter((candidate) => {
      const key = candidateKey(candidate);
      if (nextSeen.has(key)) return false;
      nextSeen.add(key);
      return true;
    });
  }

  const best = results.slice().sort((a, b) => a.medianMs - b.medianMs)[0];
  const output = {
    baseline,
    best,
    results
  };

  fs.writeFileSync(resultPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[ga] Results saved to ${resultPath}`);
  console.log('[ga] Best candidate:', best);
};

run().catch((error) => {
  console.error('[ga] Failed', error);
  process.exit(1);
});
