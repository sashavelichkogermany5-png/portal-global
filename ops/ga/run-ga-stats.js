'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = process.cwd();
const baseUrl = 'http://127.0.0.1';
const port = 3106;
const requestCount = 40;
const warmupCount = 4;
const generations = 3;
const populationSize = 8;
const resultPath = path.join(root, 'ops', 'ga', 'results-stats.json');

const genes = {
  STATS_CACHE_TTL_MS: [0, 100, 250, 500, 1000, 2000, 5000],
  USAGE_CACHE_TTL_MS: [0, 100, 250, 500, 1000, 2000, 5000]
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
  `${candidate.STATS_CACHE_TTL_MS}|${candidate.USAGE_CACHE_TTL_MS}`;

const randomCandidate = () => ({
  STATS_CACHE_TTL_MS: pick(genes.STATS_CACHE_TTL_MS),
  USAGE_CACHE_TTL_MS: pick(genes.USAGE_CACHE_TTL_MS)
});

const crossover = (a, b) => ({
  STATS_CACHE_TTL_MS: Math.random() > 0.5 ? a.STATS_CACHE_TTL_MS : b.STATS_CACHE_TTL_MS,
  USAGE_CACHE_TTL_MS: Math.random() > 0.5 ? a.USAGE_CACHE_TTL_MS : b.USAGE_CACHE_TTL_MS
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

  await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

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

const normalizeStats = (json) => {
  if (!json || !json.data) return json;
  const data = { ...json.data };
  delete data.uptime;
  delete data.memoryUsage;
  return { ...json, data };
};

const measureEndpoint = async ({
  base,
  cookie,
  path,
  warmup,
  count,
  baselineData,
  normalize
}) => {
  for (let i = 0; i < warmup; i += 1) {
    const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
    await res.text();
  }

  const timings = [];
  let firstPayload = null;
  for (let i = 0; i < count; i += 1) {
    const start = process.hrtime.bigint();
    const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
    const json = await res.json();
    const end = process.hrtime.bigint();
    timings.push(Number(end - start) / 1e6);
    if (i === 0) {
      firstPayload = normalize ? normalize(json) : json;
      if (baselineData) {
        const baselineNormalized = normalize ? normalize(baselineData) : baselineData;
        if (JSON.stringify(firstPayload) !== JSON.stringify(baselineNormalized)) {
          throw new Error('Quality check failed: response mismatch');
        }
      }
    }
  }

  return { timings, firstPayload };
};

const benchCandidate = async (candidate, baseEnv, baselineData) => {
  const env = {
    ...process.env,
    ...baseEnv,
    PORT: String(port),
    HOST: '127.0.0.1',
    RATE_LIMIT_MAX: '10000',
    AUTH_ME_RATE_LIMIT_MAX: '10000',
    STATS_CACHE_TTL_MS: String(candidate.STATS_CACHE_TTL_MS),
    USAGE_CACHE_TTL_MS: String(candidate.USAGE_CACHE_TTL_MS)
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

  const statsResult = await measureEndpoint({
    base: `${baseUrl}:${port}`,
    cookie,
    path: '/api/stats',
    warmup: warmupCount,
    count: requestCount,
    baselineData: baselineData?.stats || null,
    normalize: normalizeStats
  });

  const usageResult = await measureEndpoint({
    base: `${baseUrl}:${port}`,
    cookie,
    path: '/api/usage',
    warmup: warmupCount,
    count: requestCount,
    baselineData: baselineData?.usage || null,
    normalize: null
  });

  child.kill();

  const statsMedian = percentile(statsResult.timings, 50);
  const statsP95 = percentile(statsResult.timings, 95);
  const usageMedian = percentile(usageResult.timings, 50);
  const usageP95 = percentile(usageResult.timings, 95);

  return {
    candidate,
    statsMedian,
    statsP95,
    usageMedian,
    usageP95,
    combinedMedian: (statsMedian + usageMedian) / 2,
    combinedP95: (statsP95 + usageP95) / 2,
    baselineData: {
      stats: statsResult.firstPayload,
      usage: usageResult.firstPayload
    }
  };
};

const run = async () => {
  const envFile = parseEnvFile();
  const baseline = {
    STATS_CACHE_TTL_MS: toNumber(envFile.STATS_CACHE_TTL_MS, 0),
    USAGE_CACHE_TTL_MS: toNumber(envFile.USAGE_CACHE_TTL_MS, 0)
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
  population = population.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let baselineData = null;
  for (let gen = 0; gen < generations; gen += 1) {
    const genResults = [];
    for (const candidate of population) {
      try {
        const result = await benchCandidate(candidate, baseEnv, baselineData);
        if (!baselineData) {
          baselineData = result.baselineData;
        }
        genResults.push(result);
        results.push({ generation: gen, ...result });
      } catch (error) {
        results.push({
          generation: gen,
          candidate,
          statsMedian: Infinity,
          statsP95: Infinity,
          usageMedian: Infinity,
          usageP95: Infinity,
          combinedMedian: Infinity,
          combinedP95: Infinity,
          error: String(error?.message || error)
        });
      }
    }

    genResults.sort((a, b) => a.combinedMedian - b.combinedMedian);
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

  const best = results.slice().sort((a, b) => a.combinedMedian - b.combinedMedian)[0];
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
