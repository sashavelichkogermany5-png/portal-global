'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const envPath = path.join(root, '.env');
const backupDir = path.join(root, 'ops', 'ga', 'backup');
const backupPath = path.join(backupDir, 'auth-me-env.json');

const newValues = {
  AUTH_ME_TTL_MS: '60000',
  AUTH_CACHE_TTL_MS: '30000',
  AUTH_CACHE_MAX_SIZE: '500'
};

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
  console.log('[ga] Applied auth/me GA values to .env');
  console.log(`[ga] Backup stored at ${backupPath}`);
};

apply();
