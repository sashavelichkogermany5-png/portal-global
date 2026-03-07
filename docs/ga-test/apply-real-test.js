'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const baseDir = path.join(root, 'docs', 'ga-test');
const backupDir = path.join(baseDir, 'backup');
const variantBDir = path.join(baseDir, 'variant-b');
const variantDDir = path.join(baseDir, 'variant-d');

const files = [
  'README.md',
  'DEV-RUN.md',
  'TESTING.md',
  'docs/ARCHITECTURE.md',
  'docs/DEPLOY.md',
  'docs/LOCALHOST-INVENTORY.md',
  'docs/PROJECT-STATE.md',
  'docs/PRODUCTION-RUNBOOK.md',
  'docs/ROUTES.md',
  'docs/SECURITY.md'
];

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const extractAnchors = (content) => {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('Topics:')) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return '';
  const block = lines.slice(idx).join('\n').trim();
  return block;
};

const appendAnchors = (content, anchors) => {
  if (!anchors) return content;
  const trimmed = content.replace(/\s*$/, '');
  return `${trimmed}\n\n${anchors}\n`;
};

files.forEach((relPath) => {
  const originalPath = path.join(root, relPath);
  const backupPath = path.join(backupDir, relPath);
  ensureDir(path.dirname(backupPath));

  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(originalPath, backupPath);
  }

  const variantBPath = path.join(variantBDir, relPath);
  const variantDPath = path.join(variantDDir, relPath);
  const variantBContent = fs.readFileSync(variantBPath, 'utf8');
  const variantDContent = fs.readFileSync(variantDPath, 'utf8');
  const anchors = extractAnchors(variantDContent);
  const merged = appendAnchors(variantBContent, anchors);

  fs.writeFileSync(originalPath, merged, 'utf8');
});

console.log('[ga-test] Applied variant B + D to originals.');
console.log('[ga-test] Backups stored in docs/ga-test/backup');
