Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT = (Get-Location).Path
if (-not (Test-Path (Join-Path $ROOT "package.json"))) {
  throw "Run from repo root (folder containing package.json). Current: $ROOT"
}

function Read-FileRaw([string]$p) { Get-Content -Raw -Encoding UTF8 $p }
function Write-FileRaw([string]$p, [string]$t) { Set-Content -Path $p -Value ($t -replace "`r`n","`n") -Encoding UTF8 }

function Find-ByName([string]$name) {
  $f = Get-ChildItem -Path $ROOT -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ieq $name } | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}
function Find-ByNameOneOf([string[]]$names) {
  foreach ($n in $names) {
    $p = Find-ByName $n
    if ($p) { return $p }
  }
  return $null
}

function Ensure-Import([ref]$txt, [string]$importLine) {
  if ($txt.Value -notmatch [regex]::Escape($importLine)) {
    if ($txt.Value -match "(?s)^(import .*?;\s*)") {
      $txt.Value = [regex]::Replace($txt.Value, "(?s)^(import .*?;\s*)", "`$1$importLine`n", 1)
    } else {
      $txt.Value = "$importLine`n" + $txt.Value
    }
    return $true
  }
  return $false
}

function Ensure-AppUseBlock([ref]$txt, [string]$blockTag, [string]$blockContent) {
  if ($txt.Value -match [regex]::Escape($blockTag)) { return $false }

  $insertion = "`n// $blockTag`n$blockContent`n"

  if ($txt.Value -match "(?s)(.*?)(\n\s*(app\.listen|server\.listen)\b.*)") {
    $txt.Value = $Matches[1] + $insertion + $Matches[2]
    return $true
  }

  $txt.Value += $insertion
  return $true
}

Write-Host "`n=== WIRING PATCH (Mission 1–3) ===" -ForegroundColor Yellow
Write-Host "Root: $ROOT" -ForegroundColor Yellow

# -------- locate files --------
$serverFile = Join-Path $ROOT "server.js"
if (-not (Test-Path $serverFile)) { $serverFile = Find-ByNameOneOf @("server.js","server.ts") }
if (-not $serverFile) { throw "server.js/server.ts not found in repo." }
Write-Host "Server: $serverFile" -ForegroundColor Green

$authFile = Find-ByNameOneOf @("routes\auth.ts","routes\auth.js","auth.ts","auth.js")
if ($authFile -and ($authFile -notmatch "\\routes\\auth\.")) { $authFile = $null }
if ($authFile) { Write-Host "Auth routes: $authFile" -ForegroundColor Green } else { Write-Host "WARN: routes/auth.(ts|js) not found" -ForegroundColor DarkYellow }

$autopilotFile = Find-ByNameOneOf @("routes\autopilot.ts","routes\autopilot.js","autopilot.ts","autopilot.js")
if ($autopilotFile -and ($autopilotFile -notmatch "\\routes\\autopilot\.")) { $autopilotFile = $null }
if ($autopilotFile) { Write-Host "Autopilot routes: $autopilotFile" -ForegroundColor Green } else { Write-Host "WARN: routes/autopilot.(ts|js) not found" -ForegroundColor DarkYellow }

$opsLoop = Find-ByNameOneOf @("ops\autopilot-loop.ps1","autopilot-loop.ps1")
if ($opsLoop) { Write-Host "Smoke: $opsLoop" -ForegroundColor Green } else { Write-Host "WARN: ops/autopilot-loop.ps1 not found" -ForegroundColor DarkYellow }

$apiClientFile = Find-ByNameOneOf @("api-client.ts","api-client.js")
if ($apiClientFile) { Write-Host "api-client: $apiClientFile" -ForegroundColor Green } else { Write-Host "WARN: api-client.(ts|js) not found" -ForegroundColor DarkYellow }

# -------- 1) server.js wiring --------
$txt = Read-FileRaw $serverFile
$ref = [ref]$txt

$didImport = $false
$didImport = (Ensure-Import $ref "import authRoutes from './routes/auth';") -or $didImport
$didImport = (Ensure-Import $ref "import adminRoutes from './routes/admin';") -or $didImport
$didImport = (Ensure-Import $ref "import tenantsRoutes from './routes/tenants';") -or $didImport
$didImport = (Ensure-Import $ref "import { tenantMiddleware } from './middleware/tenant';") -or $didImport

$block = @"
app.use('/api', tenantMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tenants', tenantsRoutes);
"@

$didUse = Ensure-AppUseBlock $ref "OPENCODE:MISSION1-3-WIRING" $block

if ($didImport -or $didUse) {
  Write-FileRaw $serverFile $ref.Value
  Write-Host "Patched server.js wiring" -ForegroundColor Cyan
} else {
  Write-Host "OK: server.js already wired" -ForegroundColor DarkGreen
}

# -------- 2) auth register --------
if ($authFile) {
  $a = Read-FileRaw $authFile
  if ($a -notmatch "router\.post\(\s*['""]\/register['""]") {

    if ($a -notmatch "import\s+bcrypt\s+from\s+['""]bcrypt['""]") {
      $a = "import bcrypt from 'bcrypt';`n" + $a
    }
    if ($a -notmatch "import\s+\{\s*eq\s*\}\s+from\s+['""]drizzle-orm['""]") {
      $a = "import { eq } from 'drizzle-orm';`n" + $a
    }

    $register = @"
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) return res.status(409).json({ error: 'User already exists' });

  const totalUsers = await db.$count(users);
  const role = totalUsers === 0 ? 'ADMIN' : 'USER';
  const isSuperadmin = totalUsers === 0;

  const hashedPassword = await bcrypt.hash(password, 10);
  const [newUser] = await db.insert(users).values({
    email,
    password: hashedPassword,
    role,
    isSuperadmin,
    disabled: false,
  }).returning({ id: users.id, email: users.email, role: users.role, isSuperadmin: users.isSuperadmin });

  res.status(201).json({ message: 'User created', user: newUser });
});
"@

    if ($a -match "(?s)export\s+default\s+router\s*;\s*$") {
      $a = [regex]::Replace($a, "(?s)export\s+default\s+router\s*;\s*$", "$register`nexport default router;")
      Write-FileRaw $authFile $a
      Write-Host "Patched: POST /api/auth/register added" -ForegroundColor Cyan
    } else {
      Write-Host "WARN: can't auto-insert register; add it manually in auth routes" -ForegroundColor DarkYellow
    }
  } else {
    Write-Host "OK: /register already exists" -ForegroundColor DarkGreen
  }
}

# -------- 3) autopilot requireAdmin + tenant guard --------
if ($autopilotFile) {
  $p = Read-FileRaw $autopilotFile
  $pr = [ref]$p

  Ensure-Import $pr "import { requireAdmin } from '../middleware/rbac';" | Out-Null

  if ($pr.Value -match "router\.post\(\s*['""]\/enable['""]" -and $pr.Value -notmatch "router\.post\(\s*['""]\/enable['""]\s*,\s*requireAdmin") {
    $pr.Value = [regex]::Replace($pr.Value, "router\.post\(\s*(['""]\/enable['""])\s*,", "router.post($1, requireAdmin,", 1)
  }
  if ($pr.Value -match "router\.post\(\s*['""]\/tick['""]" -and $pr.Value -notmatch "router\.post\(\s*['""]\/tick['""]\s*,\s*requireAdmin") {
    $pr.Value = [regex]::Replace($pr.Value, "router\.post\(\s*(['""]\/tick['""])\s*,", "router.post($1, requireAdmin,", 1)
  }

  if ($pr.Value -match "router\.get\(\s*['""]\/status['""]" -and $pr.Value -notmatch "Tenant not specified") {
    $pr.Value = [regex]::Replace(
      $pr.Value,
      "router\.get\(\s*['""]\/status['""]\s*,\s*async\s*\(\s*req\s*,\s*res\s*\)\s*=>\s*\{",
      "router.get('/status', async (req, res) => {`n  // tenant required`n  // @ts-ignore`n  if (!req.tenant) return res.status(400).json({ error: 'Tenant not specified' });",
      1
    )
  }

  Write-FileRaw $autopilotFile $pr.Value
  Write-Host "Patched autopilot routes" -ForegroundColor Cyan
}

# -------- 4) api-client: X-Tenant-Id interceptor --------
if ($apiClientFile) {
  $c = Read-FileRaw $apiClientFile
  if ($c -notmatch "X-Tenant-Id") {
    $c += @"

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('currentTenant');
    if (stored) {
      const t = JSON.parse(stored);
      if (t?.id) {
        config.headers = config.headers || {};
        // @ts-ignore
        config.headers['X-Tenant-Id'] = String(t.id);
      }
    }
  }
  return config;
});
"@
    Write-FileRaw $apiClientFile $c
    Write-Host "Patched api-client: X-Tenant-Id header" -ForegroundColor Cyan
  } else {
    Write-Host "OK: api-client already has X-Tenant-Id" -ForegroundColor DarkGreen
  }
}

# -------- 5) ops smoke tests append --------
if ($opsLoop) {
  $loop = Read-FileRaw $opsLoop
  if ($loop -notmatch "Testing Registration & Admin") {
    $loop += @"

# ===== Testing Registration & Admin =====
Write-Host "`n=== Testing Registration & Admin ===" -ForegroundColor Cyan

`$rand = Get-Random -Maximum 10000
`$testEmail = "test`$rand@example.com"
`$testPass = "password123"

`$reg = Invoke-RestMethod -Uri "`${baseUrl}/api/auth/register" -Method Post `
  -Body (@{email=`$testEmail; password=`$testPass} | ConvertTo-Json) `
  -ContentType "application/json" -ErrorAction Stop

`$login = Invoke-RestMethod -Uri "`${baseUrl}/api/auth/login" -Method Post `
  -Body (@{email=`$testEmail; password=`$testPass} | ConvertTo-Json) `
  -ContentType "application/json" -ErrorAction Stop

`$token = `$login.token
`$headers = @{ Authorization = "Bearer `$token" }

`$me = Invoke-RestMethod -Uri "`${baseUrl}/api/auth/me" -Headers `$headers
if (-not `$me.role) { throw "/me does not return role" }

Write-Host "Registration & Admin tests passed" -ForegroundColor Green
"@
    Write-FileRaw $opsLoop $loop
    Write-Host "Patched ops/autopilot-loop.ps1 tests" -ForegroundColor Cyan
  } else {
    Write-Host "OK: smoke already has tests" -ForegroundColor DarkGreen
  }
}

Write-Host "`n=== DONE ===" -ForegroundColor Green
Write-Host "Next: apply migration + npm run dev + pwsh -File ops/autopilot-loop.ps1" -ForegroundColor Yellow
