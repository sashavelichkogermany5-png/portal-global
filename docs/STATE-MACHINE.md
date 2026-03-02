# Agent State Machine

## Thread identifiers
- `eventId`: primary key in `agent_events`.
- `correlationId`: `evt-<eventId>` used to group `agent_messages` and `agent_actions`.
- Not found in repository: `runId`/`threadId` for agent runs (searched for `runId`, `threadId`, `conversationId` across `server.js`, `backend/pages/app.html`, and `web-next`).

## Agent conversation actions (Agent Console)
Draft actions are created by agents and executed via `/api/agent/actions/execute`.

State diagram:
```text
draft -> done
draft -> failed
```

Transitions and conditions:
- `recordConversationAction` inserts `agent_actions.status = 'draft'`.
- `/api/agent/actions/execute` updates status to `done` or `failed` and emits a system message.
- Terminal: `done`, `failed`.

## Agent OS actions (runAgentOrchestrator)
Actions created by `/api/events` follow a broader status set.

State diagram:
```text
pending -> suggested
pending -> draft
pending -> executing -> executed
pending -> blocked
executing -> failed
```

Transitions and conditions:
- `recordAgentAction` creates `pending` or `suggested`/`draft` depending on action mode.
- Unknown action type -> `blocked`.
- `execute` path: `executing` -> `executed` or `failed`.
- Terminal: `executed`, `failed`, `blocked`.

## Autopilot cycle state
- No persisted run status. `data/autopilot/tenant-<id>.json` stores `lastRunAt` and `lastCorrelationId`.
- Scheduler uses in-memory `autopilotInProgress` to avoid overlapping cycles.

## Email outbox state
State diagram:
```text
pending -> sending -> sent
pending -> sending -> failed
sending -> pending (stuck reset)
```

Transitions and conditions:
- `queueEmail` inserts `status = 'pending'`.
- Worker marks `sending`, then `sent` on success.
- Worker marks `failed` after `EMAIL_MAX_ATTEMPTS`.
- `markStuckEmails` resets `sending` -> `pending` after `EMAIL_STUCK_MINUTES`.

## Retry policy
- Agent conversation: none; dispatch is synchronous.
- Autopilot scheduler: no retries beyond the next interval.
- Email worker: retries up to `EMAIL_MAX_ATTEMPTS`.

## UI mapping
- Agent Console executes only when action status is not terminal and user role allows it.
- Terminal statuses in UI: `done`, `failed`, `executed`, `blocked` (actions), `sent`/`failed` (email outbox).

## Source of truth
- `server.js`
- `backend/autopilot/engine.js`
- `backend/autopilot/routes.js`
- `scripts/worker.js`
