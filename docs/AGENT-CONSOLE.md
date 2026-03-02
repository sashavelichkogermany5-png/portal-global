# Agent Console

The Agent Conversation System is deterministic (rule-based), tenant-scoped, and runs inside the main server.

## Flow
1. `POST /api/agent/events` stores an event and returns `eventId` + `correlationId`.
2. `POST /api/agent/dispatch` runs EventNormalizerAgent, RouterAgent, and downstream agents.
3. `GET /api/agent/messages?correlationId=` returns the message thread.
4. `GET /api/agent/actions?correlationId=` returns action drafts.
5. `POST /api/agent/actions/execute` executes safe actions (RBAC enforced).

## Agents
- EventNormalizerAgent: normalize event type and context.
- RouterAgent: route to UICoachAgent, LeadsAgent, or RevenueAgent.
- UICoachAgent: onboarding tips on `page_view` and `app_open`.
- LeadsAgent: draft tag/status actions for `lead_created` and `lead_stuck`.
- RevenueAgent: acknowledge `payment_received` and draft a follow-up action.

## Safe action types
- `lead_status_update` (admin only)
- `tag_lead` (user allowed)
- `create_ticket` (user allowed)

## UI
- `/app` includes an Agent Console panel.
- Page load sends a `page_view` event and dispatches it.
- Replay re-dispatches the last event.
- Execute buttons appear only when allowed by role.
