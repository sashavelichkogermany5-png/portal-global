'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const envPath = path.join(root, '.env');
const backupPath = path.join(root, 'ops', 'ga', 'backup', 'stats-cache-env.json');

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

const revert = () => {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const previous = backup.previous || {};

  const { bom, lines } = readEnv();

  Object.keys(previous).forEach((key) => {
    const prev = previous[key];
    let firstIndex = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].startsWith(`${key}=`)) {
        firstIndex = i;
        break;
      }
    }

    if (prev.present) {
      if (firstIndex === -1) {
        lines.push(`${key}=${prev.value}`);
      } else {
        lines[firstIndex] = `${key}=${prev.value}`;
      }
    } else {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startsWith(`${key}=`)) {
          lines.splice(i, 1);
        }
      }
    }
  });

  writeEnv(bom, lines);
  console.log('[ga] Reverted stats cache values from backup');
};

revert();
