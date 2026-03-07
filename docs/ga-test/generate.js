'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const baseDir = path.join(root, 'docs', 'ga-test');
const variants = ['baseline', 'variant-a', 'variant-b', 'variant-c', 'variant-d', 'variant-e'];

const files = [
  {
    path: 'README.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Repo overview, quick start, and feature summary.',
      openItems: 'n/a'
    },
    summary: [
      'Quick start: npm install, npm run dev, open /orders.',
      'Lists agent conversation endpoints and workflows.',
      'Documents revenue tracking tables and email worker config.',
      'Describes file upload UI/UX and supported file types.'
    ],
    decision: {
      problem: 'Provide a single entry overview for the repo.',
      options: 'n/a',
      decision: 'Maintain a README with quick start and key systems.',
      why: 'Fast onboarding.',
      risks: 'May drift from source of truth.'
    },
    anchors: {
      topics: ['quickstart', 'agent', 'revenue', 'email', 'uploads'],
      people: [],
      decisionType: 'reference',
      status: 'active'
    },
    moc: {
      mainTopic: 'Portal Global overview',
      relatedTopics: ['dev runbook', 'deploy', 'routes', 'testing', 'project state'],
      parent: 'none'
    }
  },
  {
    path: 'DEV-RUN.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Windows dev runbook and scripts.',
      openItems: 'n/a'
    },
    summary: [
      'Windows dev loop via ops/autopilot-loop.ps1 and ops/run-dev.ps1.',
      'Ports default 3000/3001 with auto fallback to 3100/3101.',
      'Health check via npm run health or /api/health.',
      'UI URLs for register/login/app; legacy backend login noted.',
      'Notes on lockfiles and admin bootstrap token.'
    ],
    decision: {
      problem: 'Ensure repeatable dev start on Windows.',
      options: 'run-dev.ps1 or autopilot-loop.ps1.',
      decision: 'Use ops scripts for start and health.',
      why: 'Automation and retries.',
      risks: 'Port conflicts or missing deps.'
    },
    anchors: {
      topics: ['dev', 'windows', 'scripts', 'ports', 'health', 'bootstrap'],
      people: [],
      decisionType: 'runbook',
      status: 'active'
    },
    moc: {
      mainTopic: 'Dev run (Windows)',
      relatedTopics: ['ports', 'health check', 'ui urls', 'admin bootstrap'],
      parent: 'docs/PROJECT-STATE.md'
    }
  },
  {
    path: 'docs/DEPLOY.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Production deployment steps and env vars.',
      openItems: 'n/a'
    },
    summary: [
      'Production env vars for backend and web (NODE_ENV, PORT, DATABASE_PATH).',
      'Start backend: npm install, set NODE_ENV=production, npm run start:prod.',
      'Start web: web-next build and start on 3001.',
      'Health check via npm run health.',
      'Notes on CORS and cookie settings.'
    ],
    decision: {
      problem: 'Document production deployment steps.',
      options: 'Start backend and web separately.',
      decision: 'Set env vars and run start:prod plus web-next build/start.',
      why: 'Consistent production setup.',
      risks: 'Missing env vars or CORS misconfig.'
    },
    anchors: {
      topics: ['deploy', 'production', 'env', 'web-next', 'health'],
      people: [],
      decisionType: 'runbook',
      status: 'active'
    },
    moc: {
      mainTopic: 'Deployment',
      relatedTopics: ['production runbook', 'env vars', 'health check', 'cors'],
      parent: 'docs/PROJECT-STATE.md'
    }
  },
  {
    path: 'docs/PRODUCTION-RUNBOOK.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Production runbook and safety checklist.',
      openItems: 'n/a'
    },
    summary: [
      'Port map: only 3000 should be open.',
      'Quick start commands for kill ports, ports check, smoke, start server.',
      'Community mode rules: allowed public paths and blocked actions.',
      'Production checklist and required env vars.',
      'Health endpoint /api/health sample response.'
    ],
    decision: {
      problem: 'Standardize production ops and safety checks.',
      options: 'Runbook commands and checklist.',
      decision: 'Single entry port 3000 with community mode guards.',
      why: 'Simpler ops and predictable surface.',
      risks: 'Misconfiguration or skipped checks.'
    },
    anchors: {
      topics: ['production', 'ports', 'community', 'checklist', 'health'],
      people: [],
      decisionType: 'runbook',
      status: 'active'
    },
    moc: {
      mainTopic: 'Production runbook',
      relatedTopics: ['deploy', 'community mode', 'health', 'ports'],
      parent: 'docs/PROJECT-STATE.md'
    }
  },
  {
    path: 'docs/ROUTES.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'API route catalog with code refs.',
      openItems: 'n/a'
    },
    summary: [
      'Catalogs upload, agent, autopilot, and revenue endpoints.',
      'Lists request/response, auth, and code locations.',
      'Includes worker/report commands (daily-report, worker, test event).',
      'Notes supporting routes like /api/health.'
    ],
    decision: {
      problem: 'Provide API route reference.',
      options: 'Keep route list in docs.',
      decision: 'Maintain ROUTES.md catalog with code refs.',
      why: 'Faster lookup.',
      risks: 'Drift from server.js.'
    },
    anchors: {
      topics: ['api', 'routes', 'agent', 'autopilot', 'revenue', 'upload'],
      people: [],
      decisionType: 'reference',
      status: 'active'
    },
    moc: {
      mainTopic: 'API routes',
      relatedTopics: ['agent', 'autopilot', 'revenue', 'upload'],
      parent: 'docs/ARCHITECTURE.md'
    }
  },
  {
    path: 'docs/SECURITY.md',
    a: {
      status: 'policy',
      project: 'Portal Global',
      date: '2026-03-02',
      context: 'Security policy and known issues.',
      openItems: 'Monitor sqlite3 advisories.'
    },
    summary: [
      'Security policy and vuln reporting guidance.',
      'Known issue: sqlite3 pulls tar advisory during install only.',
      'Mitigation: monitor sqlite3 releases.',
      'Audits run periodically; last reviewed 2026-03-02.'
    ],
    decision: {
      problem: 'Define vuln reporting and known issues.',
      options: 'Private reporting and monitor deps.',
      decision: 'Use private reporting plus sqlite3 advisory monitoring.',
      why: 'Responsible disclosure.',
      risks: 'Dependency alerts.'
    },
    anchors: {
      topics: ['security', 'vuln', 'audits', 'sqlite3'],
      people: [],
      decisionType: 'policy',
      status: 'active'
    },
    moc: {
      mainTopic: 'Security policy',
      relatedTopics: ['audits', 'dependencies'],
      parent: 'none'
    }
  },
  {
    path: 'docs/PROJECT-STATE.md',
    a: {
      status: 'active',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Current state summary and next actions.',
      openItems: 'Missing CURRENT-STATE doc; reconcile rate limit env naming.'
    },
    summary: [
      'Project summary: monorepo with Express backend and web-next UI.',
      'Canonical state: PROJECT-STATE + AGENTS; CURRENT-STATE missing.',
      'Mission status with last pass and next action.',
      'Pointers to dev, architecture, autopilot, and risks.'
    ],
    decision: {
      problem: 'Capture current state while generator is missing.',
      options: 'Treat PROJECT-STATE and AGENTS as canonical.',
      decision: 'Use PROJECT-STATE + AGENTS as canonical for now.',
      why: 'No CURRENT-STATE generated doc.',
      risks: 'Drift over time.'
    },
    anchors: {
      topics: ['project-state', 'mission', 'dev', 'architecture', 'autopilot'],
      people: [],
      decisionType: 'status',
      status: 'active'
    },
    moc: {
      mainTopic: 'Project state',
      relatedTopics: ['dev run', 'architecture', 'testing', 'deploy'],
      parent: 'none'
    }
  },
  {
    path: 'docs/ARCHITECTURE.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Runtime, auth, roles, and tenant rule.',
      openItems: 'n/a'
    },
    summary: [
      'Runtime: backend server.js, web-next, ports 3000/3001.',
      'Auth: session token in SQLite; cookie name; bearer accepted.',
      'Roles overview (admin/team, client tenant users, staff).',
      'Key rule: tenantId comes from auth/session only.'
    ],
    decision: {
      problem: 'Document high-level architecture and tenant rule.',
      options: 'Short summary doc.',
      decision: 'Keep concise architecture note with key rule.',
      why: 'Enforce tenant scoping.',
      risks: 'Oversimplified view.'
    },
    anchors: {
      topics: ['architecture', 'auth', 'roles', 'tenant'],
      people: [],
      decisionType: 'reference',
      status: 'active'
    },
    moc: {
      mainTopic: 'Architecture',
      relatedTopics: ['auth', 'tenancy', 'runtime'],
      parent: 'docs/PROJECT-STATE.md'
    }
  },
  {
    path: 'TESTING.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Smoke testing steps and examples.',
      openItems: 'SMTP_HOST required for email worker.'
    },
    summary: [
      'Smoke testing steps for health, login, agent events, and actions.',
      'Includes lead create/list/update examples.',
      'Revenue/email pipeline test commands and notes.',
      'Results include SMTP failure example.'
    ],
    decision: {
      problem: 'Provide smoke testing steps.',
      options: 'Manual CLI checklist.',
      decision: 'Document manual commands for health, auth, and agent flows.',
      why: 'Reproducible checks.',
      risks: 'Env dependencies (SMTP, ports).' 
    },
    anchors: {
      topics: ['testing', 'smoke', 'auth', 'agent', 'email'],
      people: [],
      decisionType: 'runbook',
      status: 'active'
    },
    moc: {
      mainTopic: 'Testing',
      relatedTopics: ['health', 'dev run', 'routes'],
      parent: 'docs/PROJECT-STATE.md'
    }
  },
  {
    path: 'docs/LOCALHOST-INVENTORY.md',
    a: {
      status: 'reference',
      project: 'Portal Global',
      date: 'n/a',
      context: 'Localhost port map and gateway notes.',
      openItems: 'Future: web-next static under port 3000; gateway proposal.'
    },
    summary: [
      'Port map after cleanup; only 3000 running.',
      'Architecture diagram for single entry point.',
      'Community mode config and runbook for localhost.',
      'Gateway design proposal for unified 3000.',
      'Protection rules and rate limiting.'
    ],
    decision: {
      problem: 'Document localhost port usage and target layout.',
      options: 'Single entry vs multiple ports.',
      decision: 'Single entry on port 3000; keep others down.',
      why: 'Simpler dev/prod parity.',
      risks: 'Drift with dev scripts.'
    },
    anchors: {
      topics: ['localhost', 'ports', 'community', 'gateway', 'protection'],
      people: [],
      decisionType: 'runbook',
      status: 'active'
    },
    moc: {
      mainTopic: 'Localhost inventory',
      relatedTopics: ['production runbook', 'dev run', 'deploy'],
      parent: 'docs/PROJECT-STATE.md'
    }
  }
];

const joinList = (items) => (items && items.length ? items.join(', ') : 'none');

const blockA = (meta) => [
  `Status: ${meta.status}`,
  `Project: ${meta.project}`,
  `Date: ${meta.date}`,
  `Context: ${meta.context}`,
  `Open items: ${meta.openItems}`,
  ''
].join('\n');

const blockB = (meta) => {
  const lines = meta.summary.slice(0, 5).map((line) => `- ${line}`);
  return ['# Short summary', ...lines, ''].join('\n');
};

const blockC = (meta) => [
  `Problem: ${meta.problem}`,
  `Options: ${meta.options}`,
  `Decision: ${meta.decision}`,
  `Why: ${meta.why}`,
  `Risks: ${meta.risks}`,
  ''
].join('\n');

const blockE = (meta) => [
  `Main topic: ${meta.mainTopic}`,
  `Related topics: ${joinList(meta.relatedTopics)}`,
  `Parent MOC: ${meta.parent}`,
  ''
].join('\n');

const blockD = (meta) => [
  `Topics: ${joinList(meta.topics)}`,
  `People: ${joinList(meta.people)}`,
  `Decision type: ${meta.decisionType}`,
  `Status: ${meta.status}`
].join('\n');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const normalizeContent = (content) => {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: '\uFEFF', body: content.slice(1) };
  }
  return { bom: '', body: content };
};

const writeVariant = (variant, file, content) => {
  const outPath = path.join(baseDir, variant, file.path);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, content, 'utf8');
};

ensureDir(baseDir);
variants.forEach((variant) => ensureDir(path.join(baseDir, variant)));

files.forEach((file) => {
  const srcPath = path.join(root, file.path);
  const raw = fs.readFileSync(srcPath, 'utf8');
  const { bom, body } = normalizeContent(raw);

  writeVariant('baseline', file, bom + body);
  writeVariant('variant-a', file, bom + blockA(file.a) + body);
  writeVariant('variant-b', file, bom + blockB(file) + body);
  writeVariant('variant-c', file, bom + blockC(file.decision) + body);
  writeVariant('variant-e', file, bom + blockE(file.moc) + body);

  const appended = body.replace(/\s*$/, '');
  const dBlock = blockD(file.anchors);
  writeVariant('variant-d', file, `${bom}${appended}\n\n${dBlock}\n`);
});

console.log('[ga-test] Generated variants in docs/ga-test');
