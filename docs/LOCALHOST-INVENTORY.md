# Short summary
- Port map after cleanup; only 3000 running.
- Architecture diagram for single entry point.
- Community mode config and runbook for localhost.
- Gateway design proposal for unified 3000.
- Protection rules and rate limiting.
# Localhost Inventory

## Port Map (After Cleanup)

| Port | Service | Handler | Status | Notes |
|------|---------|---------|--------|-------|
| **3000** | Main Express Server | `server.js` | ✅ Running | **SINGLE ENTRY POINT** - API + UI |
| **3001** | Next.js (web-next) | - | ❌ Down | Killed |
| **3002** | - | - | ❌ Down | Available |
| **3003** | Next.js | - | ❌ Down | Killed |
| **3004** | Old server | - | ❌ Down | Killed |
| **3005+** | - | - | ❌ Down | Available |
| **5055** | CrewAI | - | ❌ Down | localhost only |
| **5173** | Vite | - | ❌ Down | Dev only |

## Current Architecture

```
localhost:3000 (SINGLE ENTRY POINT)
├── /          → Landing (static HTML)
├── /login    → Login form
├── /app      → Dashboard (requires auth)
├── /api/*    → REST API (rate limited)
├── /static/* → Static files
└── /uploads→ User uploads
```

---

## Community Mode Runbook

### Quick Start (Development)
```bash
# Kill zombie ports
pwsh ops/kill-ports.ps1

# Start unified server
cd portal-global
PORT=3000 npm start
```

### Production Build (Future)
```bash
# Build Next.js to static (requires output: "export")
cd web-next
npm run build

# Copy to backend/public/app
# Serve via Express on :3000
```

---

## Community Mode Config (.env)

```bash
# Core
COMMUNITY_MODE=1
NODE_ENV=production

# Security
AUTOPILOT_ENABLED=0
EXTERNAL_LLM_ENABLED=0
RATE_LIMIT_ENABLED=1
TRUST_PROXY=1
FORCE_HTTPS=1

# Limits
RATE_LIMIT_MAX=100
AUTH_ME_RATE_LIMIT_MAX=30
LOGIN_RATE_LIMIT_MAX=10
FEEDBACK_RATE_LIMIT_MAX=5
BODY_SIZE_LIMIT=512kb
SOCKET_MAX_CONNECTIONS_PER_IP=5

# CORS
DEMO_ORIGIN=https://your-domain.onrender.com
```

---

## Current Status

✅ **Port 3000 is the SINGLE entry point**

- Landing: http://localhost:3000/
- Login: http://localhost:3000/login
- App: http://localhost:3000/app (requires auth)
- API: http://localhost:3000/api/*

All routes work correctly with:
- Rate limiting (IP-based)
- Auth caching (120s TTL)
- Community mode (guests can view, can't modify)
- Autopilot disabled by default

```
┌─────────────────────────────────────────────────────────────┐
│                     localhost:3000                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Landing   │  │  /api/*      │  │   Static       │  │
│  │   Pages     │  │  REST API    │  │   Files         │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│                                                              │
│  Features:                                                  │
│  • Rate limit (100/15min)                                   │
│  • Auth cache (120s)                                        │
│  • Community mode                                            │
│  • Socket.IO (5 conn/IP max)                               │
└─────────────────────────────────────────────────────────────┘
           ↑                                     ↑
           │ (no proxy)                         │
           ↓                                     ↓
┌─────────────────┐              ┌─────────────────┐
│  localhost:3001 │              │  localhost:3003 │
│   Next.js UI    │              │  Next.js clone  │
│   /app          │              │   (duplicate)   │
│   /login        │              │                 │
└─────────────────┘              └─────────────────┘
```

---

## Gateway Design Proposal

### Single Entry Point (:3000)

```
┌──────────────────────────────────────────────────────────────┐
│                    localhost:3000                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   EXPRESS GATEWAY                       │  │
│  │                                                          │  │
│  │  Path Routing:                                          │  │
│  │  ─────────────────────────────────────────────────────  │  │
│  │  /        → Static HTML (landing)                       │  │
│  │  /login   → Static HTML (login form)                    │  │
│  │  /register→ Static HTML (register form)                  │  │
│  │  /docs    → Static HTML (docs)                          │  │
│  │  /pricing → Static HTML (pricing)                       │  │
│  │  /app*   → SPA (Next.js static or redirect)            │  │
│  │                                                          │  │
│  │  API Routing:                                           │  │
│  │  ─────────────────────────────────────────────────────  │  │
│  │  /api/health      → Direct (no auth)                   │  │
│  │  /api/auth/*      → Auth handlers                       │  │
│  │  /api/feedback    → Public (rate limited)              │  │
│  │  /api/*           → API routes (rate limited)          │  │
│  │                                                          │  │
│  │  Static:                                                │  │
│  │  ─────────────────────────────────────────────────────  │  │
│  │  /static/*        → express.static                     │  │
│  │  /uploads/*      → express.static                      │  │
│  │  /_next/*        → Next.js build (future)             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### What Should Be Unified Under :3000

| Current | Proposed | Action |
|---------|----------|--------|
| Landing pages on :3000 | Keep on :3000 | ✅ Already unified |
| API on :3000 | Keep on :3000 | ✅ Already unified |
| Static files on :3000 | Keep on :3000 | ✅ Already unified |
| Next.js on :3001/3003 | Serve from :3000 | Build Next.js → `/static` or proxy |

### What Should Stay Separate

| Service | Port | Reason |
|---------|------|--------|
| **CrewAI** | 5055 | Heavy compute, isolated |
| **Legacy backend** | - | Deprecated |
| **Vite dev** | 5173 | Only for development |

---

## Protection Rules (for production)

### Rate Limiting
```env
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=900000
AUTH_ME_RATE_LIMIT_MAX=30
LOGIN_RATE_LIMIT_MAX=10
FEEDBACK_RATE_LIMIT_MAX=5
```

### IP Protection
- Trust proxy enabled (`TRUST_PROXY=1`)
- Socket max 5 connections per IP

### Community Mode
```env
COMMUNITY_MODE=1
AUTOPILOT_ENABLED=0
```

---

## Next Steps (for future)

1. **Build Next.js to static files** → Serve from :3000 `/static` or `/app`
2. **Remove ports 3001, 3003** → Consolidate to :3000
3. **Add Caddy/nginx gateway** → Handle SSL termination
4. **Disable Socket.IO in community mode** → If not needed

---

## Commands to Start

```bash
# Single unified server (recommended)
cd portal-global
PORT=3000 npm start

# Or legacy dev mode (2 processes)
cd portal-global
npm run dev  # starts both backend + web
```

Topics: localhost, ports, community, gateway, protection
People: none
Decision type: runbook
Status: active
