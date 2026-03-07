Main topic: API routes
Related topics: agent, autopilot, revenue, upload
Parent MOC: docs/ARCHITECTURE.md
# API Routes (agent + revenue + upload)

## Upload
| Method | Path | Body | Response | Auth | Notes | Code |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/upload` | Multipart form with `file` | `201 { id, url, name, size, type }` | NextAuth session or backend session cookie/Bearer | Stores in `web-next/public/uploads`. Uses backend `/api/auth/me` as fallback auth. | `web-next/app/api/upload/route.ts`, `web-next/app/lib/upload.ts` |

## Agent conversation
| Method | Path | Body | Response | Auth | Notes | Code |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/agent/events` | `{ event_type, context?, source? }` | `{ ok: true, data: { eventId, correlationId } }` | Session cookie or Bearer; `X-Tenant-Id` optional | Creates `agent_events` row. | `server.js` (`apiRoutes.post('/agent/events')`) |
| POST | `/api/agent/dispatch` | `{ eventId }` or `{ event_type, context? }` | `{ ok: true, data: { eventId, correlationId, messages, actions } }` | Session cookie or Bearer; `X-Tenant-Id` optional | Runs deterministic dispatch or CrewAI if `AGENTS_ENGINE=crewai`. | `server.js` (`apiRoutes.post('/agent/dispatch')`) |
| GET | `/api/agent/messages` | Query: `correlationId`, `limit?` | `{ ok: true, data: [message] }` | Session cookie or Bearer; `X-Tenant-Id` optional | Messages ordered ASC by created_at. | `server.js` (`apiRoutes.get('/agent/messages')`) |
| GET | `/api/agent/actions` | Query: `correlationId` or `status`, `limit?` | `{ ok: true, data: [action] }` | Session cookie or Bearer; `X-Tenant-Id` optional | Without `correlationId`, filters by status and role. | `server.js` (`apiRoutes.get('/agent/actions')`) |
| POST | `/api/agent/actions/execute` | `{ actionId }` | `{ ok: true, data: { id, status, result? } }` | Session cookie or Bearer; `X-Tenant-Id` optional | Writes system message on success/fail. | `server.js` (`apiRoutes.post('/agent/actions/execute')`) |
| POST | `/api/agent/actions/:id/execute` | none | `{ ok: true, data: { id, status, result? } }` | Session cookie or Bearer; `X-Tenant-Id` optional | Legacy action executor; sets status `executed`. | `server.js` (`apiRoutes.post('/agent/actions/:id/execute')`) |

## Agent OS (legacy)
| Method | Path | Body | Response | Auth | Notes | Code |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/events` | `{ type/eventType, payload, source?, actionMode? }` | `{ ok: true, data: { event, responses, actions, suggestions } }` | Session cookie or Bearer; `X-Tenant-Id` optional | Runs `runAgentOrchestrator` and stores `agent_suggestions`. | `server.js` (`apiRoutes.post('/events')`) |
| POST | `/api/agent/suggest` | Same as `/api/events` | Same as `/api/events` | Session cookie or Bearer; `X-Tenant-Id` optional | Alias with default type `ui.page_view`. | `server.js` (`apiRoutes.post('/agent/suggest')`) |

## Autopilot revenue engine
| Method | Path | Body | Response | Auth | Notes | Code |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/autopilot/enable` | `{ enabled: boolean }` | `{ ok: true, data: { tenantId, enabled } }` | Admin session or service token fallback | Fallback via `x-service-token` or `Authorization: Bearer` + `X-Tenant-Id`. | `server.js`, `backend/autopilot/routes.js` |
| GET | `/api/autopilot/status` | none | `{ ok: true, data: { enabled, mode, intervalMin, lastRunAt, lastCorrelationId } }` | Session cookie or Bearer; `X-Tenant-Id` optional | Returns tenant settings and env mode. | `backend/autopilot/routes.js` |
| POST | `/api/autopilot/tick` | `{}` | `{ ok: true, data: { tenantId, correlationId } }` | Admin session or service token fallback | Runs one cycle and records messages/actions. | `server.js`, `backend/autopilot/routes.js` |
| GET | `/api/autopilot/offers` | none | `{ ok: true, data: [offer] }` | Session cookie or Bearer | Enriched with landing info. | `backend/autopilot/routes.js` |
| POST | `/api/autopilot/offers` | Offer payload | `{ ok: true, data: offer }` | Session cookie or Bearer | Create/update offers. | `backend/autopilot/routes.js` |
| GET | `/api/autopilot/leads` | none | `{ ok: true, data: [lead] }` | Session cookie or Bearer | Reads JSON store. | `backend/autopilot/routes.js` |
| POST | `/api/autopilot/leads/capture` | `{ name, email, offerId?, tags? }` | `{ ok: true, data: lead }` | Session cookie or Bearer | Used by autopilot landing form. | `backend/autopilot/routes.js` |
| GET | `/api/autopilot/metrics` | none | `{ ok: true, data: { summary, daily } }` | Session cookie or Bearer | Aggregates metrics JSON. | `backend/autopilot/routes.js` |

## Revenue and email reporting
| Method | Path | Body | Response | Auth | Notes | Code |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/events/financial` | `{ type, amount, currency, tags?, source? }` | `{ ok: true, data: { id, emailQueued, emailId } }` | Session cookie or Bearer; `X-Tenant-Id` optional | Queues email if `OWNER_EMAIL` is set. | `server.js` (`apiRoutes.post('/events/financial')`) |

Commands (no HTTP endpoint):
- `npm run daily-report` -> `scripts/daily-report.js` (queues summary email in `email_outbox`).
- `npm run worker` -> `scripts/worker.js` (sends `email_outbox` via SMTP/SendGrid).
- `npm run test:financial-event` -> `scripts/test-financial-event.js` (creates `payment_received`).

## Supporting routes
- `GET /api/health` -> health probe (used by `npm run health`). See `server.js` (`publicApiRoutes.get('/health')`).

## Source of truth
- `server.js`
- `backend/autopilot/routes.js`
- `backend/autopilot/engine.js`
- `web-next/app/api/upload/route.ts`
- `web-next/app/lib/upload.ts`
- `web-next/next.config.js`
- `scripts/daily-report.js`
- `scripts/worker.js`
