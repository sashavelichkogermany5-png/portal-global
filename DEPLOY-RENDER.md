# Deploy on Render

## Services
- **Web Service** start command: `npm start`
- **Background Worker** command: `npm run worker`
- **Cron Job** command: `npm run daily-report`
  - Suggested schedule (Europe/Berlin): `0 7 * * *`

## Required Environment Variables
- `NODE_ENV=production`
- `OWNER_EMAIL=you@company.com`
- `DATABASE_PATH=/var/data/portal.db` (mount a Render persistent disk)
- `DEFAULT_CURRENCY=EUR` (optional)

Email provider (choose one):
- **SendGrid**: `SENDGRID_API_KEY`, `EMAIL_FROM` (or `SENDGRID_FROM`)
- **SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` (or `SMTP_FROM`)

Worker tuning (optional):
- `EMAIL_MAX_ATTEMPTS=5`
- `EMAIL_BATCH_SIZE=10`
- `EMAIL_POLL_INTERVAL_MS=10000`
- `EMAIL_STUCK_MINUTES=15`

## Verification
1. `npm run test:financial-event` (posts a `payment_received` event through the API and queues an email)
2. `npm run worker` (processes the email outbox)
3. `npm run daily-report` (queues the daily revenue report)

> Note: This server uses SQLite by default. On Render, attach a persistent disk and set `DATABASE_PATH`. If you plan to migrate to Render Postgres, update the database layer accordingly.
