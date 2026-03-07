'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupPath = path.join(root, 'ops', 'ga', 'backup', 'status.html');
const targetPath = path.join(root, 'backend', 'pages', 'status.html');

if (!fs.existsSync(backupPath)) {
  throw new Error(`Backup not found: ${backupPath}`);
}

fs.copyFileSync(backupPath, targetPath);
console.log('[ga] Restored backend/pages/status.html from backup');
