'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const baselineRoot = path.join(root, 'docs', 'ga-test', 'baseline');

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

const questions = [
  {
    id: 'Q1',
    label: 'Dev run + UI URLs/ports',
    groups: [
      { name: 'run-dev', patterns: [/run-dev\.ps1/i, /npm run dev/i] },
      { name: 'ports', patterns: [/3000.*3001/i, /BACKEND_PORT/i, /WEB_PORT/i] },
      { name: 'register', patterns: [/register\/login\/app/i, /\/register/i] },
      { name: 'login', patterns: [/register\/login\/app/i, /\/login/i] },
      { name: 'app', patterns: [/register\/login\/app/i, /\/app/i] }
    ]
  },
  {
    id: 'Q2',
    label: 'Prod env + start backend/web',
    groups: [
      { name: 'node-env', patterns: [/NODE_ENV=production/i] },
      { name: 'start-prod', patterns: [/start:prod/i] },
      { name: 'web-next', patterns: [/web-next/i] },
      { name: 'port-3001', patterns: [/3001/] }
    ]
  },
  {
    id: 'Q3',
    label: 'Agent + financial routes + worker commands',
    groups: [
      { name: 'agent-events', patterns: [/\/api\/agent\/events/i] },
      { name: 'financial', patterns: [/\/api\/events\/financial/i] },
      { name: 'worker', patterns: [/\bworker\b/i] },
      { name: 'daily-report', patterns: [/daily-report/i] }
    ]
  },
  {
    id: 'Q4',
    label: 'Community mode rules + port map',
    groups: [
      { name: 'community', patterns: [/community mode/i] },
      { name: 'allowed', patterns: [/allowed public paths/i] },
      { name: 'port-map', patterns: [/port map/i, /SINGLE ENTRY POINT/i] },
      { name: 'port-3000', patterns: [/\b3000\b/] }
    ]
  },
  {
    id: 'Q5',
    label: 'Architecture + tenant rule + status/next action',
    groups: [
      { name: 'tenant', patterns: [/tenantId/] },
      { name: 'auth-session', patterns: [/auth\/session/i] },
      { name: 'mission', patterns: [/mission status/i] },
      { name: 'next-action', patterns: [/next action/i] }
    ]
  }
];

const readLines = (base, relPath) => {
  const fullPath = path.join(base, relPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return raw.replace(/\r\n/g, '\n').split('\n');
};

const buildLineMap = (base) => {
  const map = {};
  files.forEach((relPath) => {
    const lines = readLines(base, relPath);
    const fileMap = {};
    questions.forEach((q) => {
      q.groups.forEach((group) => {
        let lineIndex = Infinity;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (group.patterns.some((pattern) => pattern.test(line))) {
            lineIndex = i + 1;
            break;
          }
        }
        fileMap[group.name] = lineIndex;
      });
    });
    map[relPath] = fileMap;
  });
  return map;
};

const subsets = (arr) => {
  const result = [];
  const n = arr.length;
  for (let mask = 1; mask < (1 << n); mask += 1) {
    const subset = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) subset.push(arr[i]);
    }
    result.push(subset);
  }
  return result;
};

const evaluateQuestion = (lineMap, question) => {
  const fileList = Object.keys(lineMap);
  let best = null;
  const allSubsets = subsets(fileList);

  allSubsets.forEach((subset) => {
    const assignment = {};
    let coversAll = true;

    question.groups.forEach((group) => {
      let bestFile = null;
      let bestLine = Infinity;
      subset.forEach((file) => {
        const line = lineMap[file][group.name];
        if (line < bestLine) {
          bestLine = line;
          bestFile = file;
        }
      });
      if (!Number.isFinite(bestLine) || bestLine === Infinity) {
        coversAll = false;
        return;
      }
      assignment[group.name] = { file: bestFile, line: bestLine };
    });

    if (!coversAll) return;

    const fileDepths = {};
    Object.values(assignment).forEach((entry) => {
      const current = fileDepths[entry.file] || 0;
      if (entry.line > current) {
        fileDepths[entry.file] = entry.line;
      }
    });

    const usedFiles = Object.keys(fileDepths);
    const fileCount = usedFiles.length;
    const totalLines = usedFiles.reduce((sum, file) => sum + fileDepths[file], 0);

    if (!best || fileCount < best.fileCount || (fileCount === best.fileCount && totalLines < best.totalLines)) {
      best = {
        fileCount,
        totalLines,
        fileDepths
      };
    }
  });

  return best;
};

const summarize = (label, results) => {
  console.log(`\n${label}`);
  results.forEach((row) => {
    const files = Object.entries(row.fileDepths)
      .map(([file, depth]) => `${file}:${depth}`)
      .join(', ');
    console.log(`${row.id} ${row.label} -> files=${row.fileCount}, lines=${row.totalLines}; ${files}`);
  });
};

const run = () => {
  const baselineMap = buildLineMap(baselineRoot);
  const currentMap = buildLineMap(root);

  const baselineResults = questions.map((q) => {
    const result = evaluateQuestion(baselineMap, q);
    return { id: q.id, label: q.label, ...result };
  });

  const currentResults = questions.map((q) => {
    const result = evaluateQuestion(currentMap, q);
    return { id: q.id, label: q.label, ...result };
  });

  summarize('Baseline', baselineResults);
  summarize('Current (B + D applied)', currentResults);

  console.log('\nDelta');
  questions.forEach((q, idx) => {
    const base = baselineResults[idx];
    const curr = currentResults[idx];
    const fileDelta = base.fileCount - curr.fileCount;
    const lineDelta = base.totalLines - curr.totalLines;
    const filePct = base.fileCount ? (fileDelta / base.fileCount) * 100 : 0;
    const linePct = base.totalLines ? (lineDelta / base.totalLines) * 100 : 0;
    console.log(`${q.id} ${q.label} -> files ${base.fileCount} -> ${curr.fileCount} (${filePct.toFixed(1)}%), lines ${base.totalLines} -> ${curr.totalLines} (${linePct.toFixed(1)}%)`);
  });
};

run();
