'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const envPath = path.join(root, '.env');
const resultsPath = path.join(root, 'ops', 'ga', 'results-health.json');
const backupDir = path.join(root, 'ops', 'ga', 'backup');
const backupPath = path.join(backupDir, 'health-cache-env.json');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const readEnv = () => {
  if (!fs.existsSync(envPath)) {
    throw new Error(`Not found: ${envPath}`);
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff ? '\uFEFF' : '';
  const body = bom ? raw.slice(1) : raw;
  const lines = body.split(/\r?\n/);
  return { bom, lines };
};

const writeEnv = (bom, lines) => {
  const content = bom + lines.join('\n');
  fs.writeFileSync(envPath, content, 'utf8');
};

const apply = () => {
  if (!fs.existsSync(resultsPath)) {
    throw new Error(`Results not found: ${resultsPath}`);
  }
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const best = results.best && results.best.candidate;
  if (!best) {
    throw new Error('Best candidate missing in results');
  }

  const newValues = {
    HEALTH_CACHE_TTL_MS: String(best.HEALTH_CACHE_TTL_MS)
  };

  const { bom, lines } = readEnv();
  const previous = {};

  Object.keys(newValues).forEach((key) => {
    let firstIndex = -1;
    lines.forEach((line, idx) => {
      if (line.startsWith(`${key}=`)) {
        if (firstIndex === -1) {
          firstIndex = idx;
        }
      }
    });

    if (firstIndex === -1) {
      previous[key] = { present: false, value: '' };
      lines.push(`${key}=${newValues[key]}`);
    } else {
      const oldValue = lines[firstIndex].slice(key.length + 1);
      previous[key] = { present: true, value: oldValue };
      lines[firstIndex] = `${key}=${newValues[key]}`;

      for (let i = lines.length - 1; i > firstIndex; i -= 1) {
        if (lines[i].startsWith(`${key}=`)) {
          lines.splice(i, 1);
        }
      }
    }
  });

  ensureDir(backupDir);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      previous,
      newValues
    }, null, 2),
    'utf8'
  );

  writeEnv(bom, lines);
  console.log('[ga] Applied health cache values to .env');
  console.log(`[ga] Backup stored at ${backupPath}`);
};

apply();
