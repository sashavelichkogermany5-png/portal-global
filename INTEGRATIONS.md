# Portal Global Integrations (Leads CRM)

## Lead webhook (recommended for MVP)
Endpoint: `POST /api/leads/webhook`

Headers:
- `Content-Type: application/json`
- `X-Webhook-Token: <LEADS_WEBHOOK_TOKEN>`

Payload example:
```json
{
  "name": "Alex Morgan",
  "company": "Silverline Health",
  "email": "alex@silverline.io",
  "phone": "+1 415 555 1840",
  "source": "web",
  "status": "new",
  "notes": "Requested pricing and SLA details."
}
```

Owner routing:
- `LEADS_WEBHOOK_OWNER_ID` (preferred)
- `LEADS_WEBHOOK_OWNER_EMAIL` (fallback)

Quick test (PowerShell):
```powershell
curl.exe -X POST "http://localhost:3000/api/leads/webhook" `
  -H "Content-Type: application/json" `
  -H "X-Webhook-Token: change-me" `
  -d "{\"name\":\"Test Lead\",\"email\":\"test@example.com\",\"source\":\"web\"}"
```

## n8n 30-minute setup
1) Create a new workflow.
2) Add a Webhook trigger (POST) for inbound leads from forms or ads.
3) Add a Set node to normalize fields (name, company, email, phone, source, status, notes).
4) Add an HTTP Request node:
   - Method: POST
   - URL: `http://localhost:3000/api/leads/webhook`
   - Headers: `X-Webhook-Token: <LEADS_WEBHOOK_TOKEN>`
   - JSON body: mapped lead fields
5) Add optional fan-out nodes:
   - Google Sheets: append row
   - Telegram: send alert
   - Gmail: send internal notification
   - Trello: create a card

## Telegram
- Create a bot with BotFather and copy the token.
- Use n8n Telegram node `sendMessage` with `chatId` and lead summary.

## Google Sheets
- Create a sheet with columns: createdAt, name, company, email, phone, status, source, notes.
- Use n8n Google Sheets node: Append Row.

## Gmail
- Use n8n Gmail node: Send Email to sales inbox.
- Subject: `New lead: {{name}}`.

## Trello
- Create a list named "New Leads".
- Use n8n Trello node: Create Card.
- Card title: `{{name}} - {{company}}`.

## API token alternative (advanced)
If you prefer authenticated API calls instead of the webhook:
1) `POST /api/auth/login` to get `token` in the response.
2) Send `Authorization: Bearer <token>` or `X-Access-Token: <token>` with `/api/leads` requests.
