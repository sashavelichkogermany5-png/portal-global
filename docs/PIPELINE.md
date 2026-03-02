# Agent Pipeline (Portal Global)

## Current surfaces (code-truth)
- Legacy Agent Console UI is in `backend/pages/app.html` served by backend `/app`.
- `web-next/app/app/page.tsx` is an Autopilot ops panel and does not call `/api/agent/*`.
- File upload in `web-next` uses `/api/upload` (Next.js route) from the orders page.

## End-to-end map
1) UI (backend /app) -> `POST /api/agent/events` -> `agent_events` (SQLite)
2) `POST /api/agent/dispatch` -> `agent_messages` + `agent_actions` (SQLite)
3) UI -> `GET /api/agent/messages` + `GET /api/agent/actions` (poll)
4) Optional action execution -> `POST /api/agent/actions/execute` -> action status update + system message
5) Revenue event -> `POST /api/events/financial` -> `financial_events` + optional `email_outbox`
6) Email reporting -> `scripts/daily-report.js` -> `email_outbox` -> `scripts/worker.js`
7) Autopilot tick -> `POST /api/autopilot/tick` or scheduler -> autopilot engine -> `agent_messages` + `agent_actions` + `data/autopilot/*.json`

## Happy path (agent console)
1. User opens backend `/app`. JS posts `POST /api/agent/events` with `event_type` and `context`.
2. API inserts `agent_events` and returns `eventId` + `correlationId` (`evt-<id>`).
3. UI calls `POST /api/agent/dispatch` with `eventId`.
4. Dispatch normalizes the event, routes to UICoach/Leads/Revenue, writes `agent_messages` and draft `agent_actions`.
5. UI fetches `GET /api/agent/messages?correlationId=...` and `GET /api/agent/actions?correlationId=...` to render progress.
6. If user executes a draft, `POST /api/agent/actions/execute` updates action status to `done` or `failed` and logs a system message.
7. If a payment is recorded via `POST /api/events/financial`, a `financial_events` row is written and an email is queued if `OWNER_EMAIL` is set.

## Upload workflow (web-next)
- Endpoint: `POST /api/upload` (Next.js route).
- Accepts multipart `file` via `formData()`.
- Auth: NextAuth session or backend session cookie/Bearer (validated via `/api/auth/me`).
- Stores under `web-next/public/uploads` via `web-next/app/lib/upload.ts` and returns `{ id, url, name, size, type }`.
- No code path attaches upload IDs to agent events or actions.

## Autopilot workflow
- Manual tick: `POST /api/autopilot/tick` (admin or service token fallback).
- Scheduler: `AUTOPILOT_ENABLED=true` starts `setInterval` in `server.js`.
- Engine writes `agent_messages`, draft `agent_actions`, and JSON files under `data/autopilot/`.

## UI progress
- Agent Console (backend `/app`) does explicit fetches: event -> dispatch -> messages/actions. No SSE/WebSocket.
- Autopilot UI (web-next `/app`) calls `/api/autopilot/status` and `enable/tick` on button actions.

## Errors and failure points
- Auth: `/api/agent/*` and `/api/events/financial` require session cookie or Bearer token.
- Tenant: `requireTenant` returns 403/404 when no membership or bad `X-Tenant-Id`.
- Upload: `/api/upload` requires NextAuth session; smoke run returned 500.
- Dispatch: `event_type` missing -> 400; no matched agent -> RouterAgent warns "No agents matched".
- Autopilot: `enable`/`tick` require admin or service token; service token auth logs to `agent_messages` with `correlationId` `svc-<ts>`.
- Email: `OWNER_EMAIL` missing -> no queue; worker fails if SMTP/SendGrid config missing; daily-report exits if `OWNER_EMAIL` missing.

## Not found in repository (searched)
- No runId/threadId model for agent runs; correlationId is the thread key. Searched `server.js`, `backend/pages/app.html`, and `web-next` for `runId`, `threadId`, `conversationId`.
- No attachment of uploaded file IDs to agent events/actions. Searched for `fileId`, `fileIds`, `attachments` in `server.js`, `web-next`, and `backend/pages/app.html`.

## Verification (local run)
Commands executed:
- `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\run-dev.ps1` (started in background)
- `npm run health`
- `pwsh -NoProfile -ExecutionPolicy Bypass -File ops\smoke-agent-e2e.ps1`

Health result:
- `http://localhost:3000/api/health` -> ok=true (2026-02-24T15:46:19.119Z)

Smoke requests and results (from `logs/smoke-agent-e2e.json`):
- `POST http://localhost:3001/api/upload` -> 500 (upload failed)
- `POST http://localhost:3000/api/agent/events` -> eventId 43, correlationId evt-43
- `POST http://localhost:3000/api/agent/dispatch` -> correlationId evt-43, messages/actions returned
- `GET http://localhost:3000/api/agent/messages?correlationId=evt-43` -> 3 messages
- `GET http://localhost:3000/api/agent/actions?correlationId=evt-43` -> 1 draft action
- `POST http://localhost:3000/api/events/financial` -> id 6, emailQueued true, emailId 6

Outcome:
- Agent conversation path: PASS (event -> dispatch -> messages/actions).
- Upload: FAIL (500 from /api/upload).
- Revenue event: PASS (financial_events + email_outbox queued).

## Source of truth
- `server.js`
- `backend/autopilot/engine.js`
- `backend/autopilot/routes.js`
- `backend/autopilot/storage.js`
- `backend/pages/app.html`
- `web-next/app/api/upload/route.ts`
- `web-next/app/lib/upload.ts`
- `web-next/app/app/page.tsx`
- `web-next/app/(portal)/orders/page.tsx`
- `docs/AUTOPILOT.md`
- `TESTING.md`
- `scripts/worker.js`
- `scripts/daily-report.js`
- `scripts/test-financial-event.js`
- `.env.example`
- `ops/smoke-agent-e2e.ps1`
- `logs/smoke-agent-e2e.json`
