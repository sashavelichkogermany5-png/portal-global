# Agent OS MVP

## Event tracking
- Send events to `POST /api/events` with JSON `{ type, source, payload, actionMode? }`.
- `actionMode` supports `suggest`, `draft`, or `execute`.
- Always include `X-Tenant-Id` (use `activeTenantId` from `/api/auth/me`).

## Current event types
- `user.login`: emitted after sign-in.
- `user.register`: emitted after account creation.
- `ui.page_view`: page load or route change.
- `ui.form_submit`: form submitted (payload includes `entity`, `action`, `fields`).
- `ui.form_error`: form error (payload includes `entity`, `error`).
- `intake.order`: order intake request (payload values required).
- `intake.lead`: lead intake request (payload values required).
- `system.exception`: blocked or missing data detected.
- `support.requested`: support request from UI.

## Add a new agent
1. Define a new handler in `server.js` inside `runAgentOrchestrator`.
2. If the agent needs actions, add an action type to `ACTION_DEFINITIONS`.
3. Emit the event from the frontend and include `X-Tenant-Id`.
4. Update this file with the new event type and payload shape.
