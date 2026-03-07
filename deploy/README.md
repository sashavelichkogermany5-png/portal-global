# Portal Global - One Domain Runbook (Caddy)

Goal: serve the full portal from a single public domain with HTTPS while keeping internal ports private.

## Inputs
- Domain: `portal.tld`
- Upstream app: `127.0.0.1:3000`

## Option A - Caddy on host (recommended)

1) DNS
- Create an A record: `portal.tld -> YOUR_SERVER_IP`

2) Install Caddy (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

3) Start Portal app on localhost only
```bash
cd /opt/portal-global
npm ci
export NODE_ENV=production
export PORT=3000
export HOST=127.0.0.1
export TRUST_PROXY=1
npm run start:prod
```

4) Configure Caddy
```bash
sudo cp /opt/portal-global/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl edit caddy
```
Add this systemd override (so Caddy knows your domain/upstream):
```
[Service]
Environment=PORTAL_DOMAIN=portal.tld
Environment=PORTAL_UPSTREAM=127.0.0.1:3000
```
Then reload Caddy:
```bash
sudo systemctl daemon-reload
sudo systemctl restart caddy
```

5) Firewall
- Allow only 80/443 inbound (do not open 3000/3001/3100).
- Keep app ports bound to localhost or internal Docker network only.

## Option B - Docker Compose (Caddy + app)

```bash
cd /opt/portal-global/deploy
docker compose up -d
```

The compose file exposes only 80/443 for Caddy and keeps the app internal.

## Verify
```bash
curl -I https://portal.tld/
curl -I https://portal.tld/login
curl -I https://portal.tld/docs
curl -I https://portal.tld/pricing
curl -I https://portal.tld/api/health
curl -I https://portal.tld/health
```

## Rollback
Host install:
```bash
sudo systemctl stop caddy
sudo cp /etc/caddy/Caddyfile.bak /etc/caddy/Caddyfile
sudo systemctl start caddy
```

Docker:
```bash
cd /opt/portal-global/deploy
docker compose down
```

## Checklist
- HTTPS active (valid certificate, no browser warnings)
- Rate limiting active for `/api/*` and `/api/auth/me`
- Cookies set with `Secure` (use `NODE_ENV=production`)
- `TRUST_PROXY=1` so app honors `X-Forwarded-Proto`
- Logs enabled and rotated (Caddy + app)
- Backups for `database/portal.db` and `uploads/`

## Notes
- `rate_limit` requires Caddy v2.7+ (or a custom build with the rate_limit module). If unavailable, remove the `rate_limit` blocks and rely on the app’s built-in rate limiting.
- Subdomain routing is possible later (e.g., `docs.portal.tld`) but this setup stays path-based as requested.

## Windows dev quick checks
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ops/scan-ports.ps1
```
