'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const baseDir = path.join(root, 'docs', 'ga-test');
const backupDir = path.join(baseDir, 'backup');

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

files.forEach((relPath) => {
  const backupPath = path.join(backupDir, relPath);
  const originalPath = path.join(root, relPath);

  if (!fs.existsSync(backupPath)) {
    console.warn(`[ga-test] Missing backup for ${relPath}`);
    return;
  }

  fs.copyFileSync(backupPath, originalPath);
});

console.log('[ga-test] Restored originals from docs/ga-test/backup');
