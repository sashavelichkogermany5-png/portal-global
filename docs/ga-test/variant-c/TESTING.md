Problem: Provide smoke testing steps.
Options: Manual CLI checklist.
Decision: Document manual commands for health, auth, and agent flows.
Why: Reproducible checks.
Risks: Env dependencies (SMTP, ports).
# Testing (Smoke)

Prereqs:
- Start the server: `npm run dev` or `ops/run-dev.ps1`

## Health
```powershell
curl.exe http://localhost:3000/api/health
```

## Login (demo user)
```powershell
curl.exe -X POST "http://localhost:3000/api/auth/login" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"demo@local\",\"password\":\"demo12345\"}" `
  -c .cookies.txt
```

## Agent conversation (deterministic)
Get the active tenant id (use `activeTenantId`):
```powershell
curl.exe "http://localhost:3000/api/auth/me" -b .cookies.txt
```

Create an agent event (payment_received triggers RevenueAgent):
```powershell
curl.exe -X POST "http://localhost:3000/api/agent/events" `
  -H "Content-Type: application/json" `
  -H "X-Tenant-Id: <tenantId>" `
  -d "{\"event_type\":\"payment_received\",\"context\":{\"amount\":149.99,\"currency\":\"EUR\"}}" `
  -b .cookies.txt
```

Dispatch the event (use `eventId` from the response):
```powershell
curl.exe -X POST "http://localhost:3000/api/agent/dispatch" `
  -H "Content-Type: application/json" `
  -H "X-Tenant-Id: <tenantId>" `
  -d "{\"eventId\":<eventId>}" `
  -b .cookies.txt
```

Fetch messages and actions (use `correlationId` from the dispatch response):
```powershell
curl.exe "http://localhost:3000/api/agent/messages?correlationId=<correlationId>" `
  -H "X-Tenant-Id: <tenantId>" `
  -b .cookies.txt

curl.exe "http://localhost:3000/api/agent/actions?correlationId=<correlationId>" `
  -H "X-Tenant-Id: <tenantId>" `
  -b .cookies.txt
```

Execute a safe action (use `actionId` from the actions list):
```powershell
curl.exe -X POST "http://localhost:3000/api/agent/actions/execute" `
  -H "Content-Type: application/json" `
  -H "X-Tenant-Id: <tenantId>" `
  -d "{\"actionId\":<actionId>}" `
  -b .cookies.txt
```

## Create lead
```powershell
curl.exe -X POST "http://localhost:3000/api/leads" `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"Test Lead\",\"email\":\"test@example.com\",\"status\":\"new\"}" `
  -b .cookies.txt
```

## List leads
```powershell
curl.exe "http://localhost:3000/api/leads" -b .cookies.txt
```

## Update lead status
Replace `<id>` with the lead id from the create response.
```powershell
curl.exe -X PUT "http://localhost:3000/api/leads/<id>" `
  -H "Content-Type: application/json" `
  -d "{\"status\":\"contacted\"}" `
  -b .cookies.txt
```

## Revenue/email pipeline (2026-02-22)
```powershell
npm install
pwsh -NoProfile -ExecutionPolicy Bypass -File ops/run-dev.ps1
npm run test:financial-event
OWNER_EMAIL=test@example.com npm run daily-report
EMAIL_FROM=test@example.com SMTP_HOST=localhost SMTP_PORT=25 EMAIL_POLL_INTERVAL_MS=5000 npm run worker
node -e "const sqlite3=require('sqlite3');const path=require('path');const db=new sqlite3.Database(path.join(__dirname,'database','portal.db'));db.all('SELECT id, [to] as recipient, subject, status, attempts, last_error FROM email_outbox ORDER BY id DESC LIMIT 5',(err,rows)=>{if(err){console.error(err);process.exit(1);}console.log(rows);db.close();});"
```

Results:
- `npm run test:financial-event` succeeded (created event #2). Email was not queued because `OWNER_EMAIL` was not set on the running API process.
- `npm run daily-report` queued an outbox email (id #2).
- `npm run worker` failed to send due to `SMTP_HOST=localhost` connection refused; outbox status moved to `failed` after retries.
