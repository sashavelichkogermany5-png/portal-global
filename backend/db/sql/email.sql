CREATE TABLE IF NOT EXISTS financial_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  tenant_id INTEGER,
  user_id INTEGER,
  source TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_financial_events_tenant_created
  ON financial_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_financial_events_user
  ON financial_events(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_type
  ON financial_events(type);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT,
  text TEXT,
  from_email TEXT,
  kind TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status
  ON email_outbox(status, created_at);
