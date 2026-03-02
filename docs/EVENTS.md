# Events and Audit

## Event stores
- `agent_events`: raw events created by `/api/agent/events` and `/api/events` (SQLite).
- `agent_messages`: agent-to-agent/user messages keyed by `correlation_id` (SQLite).
- `agent_actions`: draft/execution actions created by agents (SQLite).
- `financial_events`: revenue events created by `/api/events/financial` (SQLite).
- `email_outbox`: queued email jobs (SQLite).
- `audit_logs`: audit trail for writes (SQLite).

## Event map (by store)
| Event name | Store | Emitted by | When | Required fields |
| --- | --- | --- | --- | --- |
| `page_view` | `agent_events.event_type` | Agent Console UI | UI posts `/api/agent/events` on page load | `tenant_id`, `user_id`, `event_type`, `source`, `payload_json`, `context_json`, `correlation_id` |
| `payment_received` | `agent_events.event_type` | UI or API client | UI posts `/api/agent/events` with payment context | `tenant_id`, `user_id`, `event_type`, `source`, `payload_json`, `context_json`, `correlation_id` |
| `EventNormalizerAgent` | `agent_messages.sender_agent` | `runConversationDispatch` | Event normalization step | `tenant_id`, `correlation_id`, `sender_agent`, `role`, `message` |
| `RouterAgent` | `agent_messages.sender_agent` | `runConversationDispatch` | Routing step | `tenant_id`, `correlation_id`, `sender_agent`, `role`, `message` |
| `RevenueAgent` | `agent_messages.sender_agent` | `runConversationDispatch` | Handles `payment_received` | `tenant_id`, `correlation_id`, `sender_agent`, `role`, `message` |
| `create_ticket` | `agent_actions.action_type` | `RevenueAgent` | Drafts a support ticket action | `tenant_id`, `user_id`, `action_type`, `status`, `request_json` |
| `payment_received` | `financial_events.type` | `/api/events/financial` | Revenue event recorded | `tenant_id`, `user_id`, `type`, `amount`, `currency` |
| `email_outbox.pending` | `email_outbox.status` | `queueEmail` or `scripts/daily-report.js` | Email queued for worker | `to`, `subject`, `status` |

## Examples (from `logs/smoke-agent-e2e.json`)

Agent event creation response:
```json
{
  "ok": true,
  "data": {
    "eventId": 43,
    "correlationId": "evt-43"
  }
}
```

`agent_messages` record (EventNormalizerAgent):
```json
{
  "id": 202,
  "correlationId": "evt-43",
  "sender": "EventNormalizerAgent",
  "target": "RouterAgent",
  "role": "agent",
  "severity": "info",
  "message": "Normalized event \"payment_received\".",
  "payload": {
    "rawType": "payment_received",
    "normalizedType": "payment_received",
    "contextKeys": [
      "amount",
      "title",
      "page",
      "currency",
      "event_type",
      "event_type_raw"
    ]
  },
  "createdAt": "2026-02-24 15:41:30"
}
```

`agent_messages` record (RouterAgent):
```json
{
  "id": 203,
  "correlationId": "evt-43",
  "sender": "RouterAgent",
  "target": "RevenueAgent",
  "role": "agent",
  "severity": "info",
  "message": "Routing event \"payment_received\" to RevenueAgent.",
  "payload": {
    "eventType": "payment_received"
  },
  "createdAt": "2026-02-24 15:41:30"
}
```

`agent_messages` record (RevenueAgent):
```json
{
  "id": 204,
  "correlationId": "evt-43",
  "sender": "RevenueAgent",
  "target": "User",
  "role": "agent",
  "severity": "info",
  "message": "Revenue recorded (EUR 19.99). Drafted action: create_ticket.",
  "payload": {
    "amount": 19.99,
    "currency": "EUR",
    "leadId": null
  },
  "createdAt": "2026-02-24 15:41:30"
}
```

`agent_actions` record (draft action):
```json
{
  "id": 29,
  "correlationId": "evt-43",
  "actor": "RevenueAgent",
  "type": "create_ticket",
  "status": "draft",
  "request": {
    "subject": "Payment follow-up",
    "message": "Payment received: EUR 19.99. Follow up with the customer."
  },
  "result": null,
  "createdAt": "2026-02-24 15:41:30",
  "updatedAt": "2026-02-24 15:41:30"
}
```

`financial_events` response:
```json
{
  "ok": true,
  "data": {
    "id": 6,
    "tenantId": 1,
    "userId": 1,
    "type": "payment_received",
    "amount": 12.34,
    "currency": "EUR",
    "tags": [
      "smoke",
      "payment_received"
    ],
    "source": "smoke-agent-e2e",
    "emailQueued": true,
    "emailId": 6
  }
}
```

## Recommended taxonomy (not enforced)
- For `agent_events.event_type`, use canonical forms that `runConversationDispatch` matches: `page_view`, `app_open`, `lead_created`, `lead_stuck`, `payment_received`.
- For Agent OS (`/api/events`), keep `ui.page_view`, `ui.form_submit`, `ui.form_error`, `intake.order`, `intake.lead`, `support.requested`, `system.exception` to match `runAgentOrchestrator` conditions.

## Source of truth
- `server.js`
- `backend/autopilot/engine.js`
- `backend/pages/app.html`
- `docs/AGENT-CONSOLE.md`
- `docs/agent-os.md`
- `scripts/worker.js`
- `scripts/daily-report.js`
- `logs/smoke-agent-e2e.json`
