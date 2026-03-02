param(
  [string]$BaseUrl,
  [string]$TenantId,
  [string]$ServiceKey,
  [string]$AppDir = "$env:APPDATA\portal-global"
)

$ErrorActionPreference = "Stop"

if (-not $BaseUrl) {
  Write-Error "BaseUrl is required."
  exit 1
}

if (-not $TenantId) {
  Write-Error "TenantId is required."
  exit 1
}

if (-not $ServiceKey) {
  $ServiceKey = Read-Host "Enter Service Key"
}

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

$headers = @{ "X-Service-Token" = $ServiceKey; "X-Tenant-Id" = "$TenantId" }
$files = @("agent.js", "uninstall-agent.ps1")

foreach ($file in $files) {
  $target = Join-Path $AppDir $file
  if (-not (Test-Path $target)) {
    Invoke-WebRequest -Uri "$BaseUrl/api/agent/download?file=$file" -Headers $headers -OutFile $target
  }
}

$config = @{
  baseUrl = $BaseUrl
  tenantId = $TenantId
  serviceKey = $ServiceKey
  agentId = [guid]::NewGuid().ToString()
  installedAt = (Get-Date).ToString("o")
}

$configPath = Join-Path $AppDir "agent-config.json"
$config | ConvertTo-Json -Depth 4 | Set-Content -Path $configPath -Encoding UTF8

$agentPath = Join-Path $AppDir "agent.js"
if (-not (Test-Path $agentPath)) {
  Write-Error "agent.js not found at $agentPath"
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js is required. Install Node 18+ and re-run."
  exit 1
}

$process = Start-Process -FilePath $node.Source -ArgumentList "`"$agentPath`"" -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru
$pidPath = Join-Path $AppDir "agent.pid"
$process.Id | Set-Content -Path $pidPath -Encoding ASCII

Write-Host "Agent installed and running."
Write-Host "Config: $configPath"
Write-Host "PID: $($process.Id)"
