-- tenants
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- memberships
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('owner','admin','member')),
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tenant_id)
);

-- isolate existing tables
ALTER TABLE autopilot_state ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);

-- system tenant
INSERT INTO tenants (id, name, slug)
VALUES (1, 'System', 'system')
ON CONFLICT (id) DO NOTHING;

-- existing users -> system tenant
INSERT INTO memberships (user_id, tenant_id, role)
SELECT id, 1, 'member' FROM users
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- backfill tenant_id
UPDATE autopilot_state SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE audit_logs SET tenant_id = 1 WHERE tenant_id IS NULL;

-- enforce not null
ALTER TABLE autopilot_state ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN tenant_id SET NOT NULL;

-- superadmin flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT FALSE;
UPDATE users SET is_superadmin = TRUE WHERE id = 1;
