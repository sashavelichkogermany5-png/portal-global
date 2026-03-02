param(
  [int]$MaxIterations = 10
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$logsDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$devLog = Join-Path $logsDir "dev.log"
$devErrLog = Join-Path $logsDir "dev.err.log"
$healthLog = Join-Path $logsDir "health.log"
$smokeLog = Join-Path $logsDir "smoke.log"
$smokeErrLog = Join-Path $logsDir "smoke.err.log"
$portsPath = Join-Path $logsDir "ports.json"
$lastResultPath = Join-Path $logsDir "last-result.json"
$smokeResultPath = Join-Path $logsDir "smoke-result.json"
$devPidPath = Join-Path $logsDir "dev.pid"

function Write-Loop {
  param([string]$Message)
  Write-Host "[loop] $Message"
}

function Read-EnvExample {
  param([string]$Path)
  $data = @{}
  if (-not (Test-Path $Path)) {
    return $data
  }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($trimmed.StartsWith("#")) { continue }
    $pair = $trimmed -split "=", 2
    if ($pair.Length -ne 2) { continue }
    $key = $pair[0].Trim()
    $value = $pair[1].Trim()
    if ($key) {
      $data[$key] = $value
    }
  }
  return $data
}

function Ensure-ServiceTokenFromExample {
  if ($env:AUTOPILOT_SERVICE_TOKEN) { return $false }
  if (Test-Path (Join-Path $root ".env")) { return $false }
  $examplePath = Join-Path $root ".env.example"
  $example = Read-EnvExample -Path $examplePath
  $token = $example["AUTOPILOT_SERVICE_TOKEN"]
  if ($token) {
    $env:AUTOPILOT_SERVICE_TOKEN = $token
    return $true
  }
  return $false
}

function Get-DevProcess {
  if (-not (Test-Path $devPidPath)) { return $null }
  $raw = Get-Content $devPidPath -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $raw) { return $null }
  if ($raw -notmatch "^\d+$") { return $null }
  $processId = [int]$raw
  return Get-Process -Id $processId -ErrorAction SilentlyContinue
}

function Start-Dev {
  $runDevPath = Join-Path $root "ops" "run-dev.ps1"
  if (-not (Test-Path $runDevPath)) {
    throw "run-dev.ps1 not found at $runDevPath"
  }

  Write-Loop "Starting dev via ops/run-dev.ps1..."
  if (Test-Path $devLog) {
    try { Clear-Content $devLog } catch { }
  }
  if (Test-Path $devErrLog) {
    try { Clear-Content $devErrLog } catch { }
  }
  $proc = Start-Process -FilePath "pwsh" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $runDevPath
  ) -WorkingDirectory $root -RedirectStandardOutput $devLog -RedirectStandardError $devErrLog -PassThru
  $proc.Id | Out-File -FilePath $devPidPath -Encoding ascii
  return $proc
}

function Stop-Dev {
  $proc = Get-DevProcess
  if ($proc) {
    Write-Loop "Stopping dev process $($proc.Id)..."
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

function Ensure-Dev {
  $proc = Get-DevProcess
  if ($proc) { return $proc }
  return Start-Dev
}

function Test-PortListening {
  param([int]$Port)
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
  }
  $lines = netstat -ano | Select-String ":$Port\s+LISTENING"
  return $null -ne $lines
}

function Test-Health {
  param([int]$BackendPort)
  $url = "http://localhost:$BackendPort/api/health"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
    return $resp.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-For-Health {
  param(
    [int]$BackendPort,
    [int]$TimeoutSec = 60
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Health -BackendPort $BackendPort) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-PortsFromLog {
  if (-not (Test-Path $devLog)) { return $null }
  $lines = Get-Content $devLog -Tail 200 -ErrorAction SilentlyContinue
  if (-not $lines) { return $null }
  $apiLine = $lines | Select-String "\[dev\] API: http://localhost:(\d+)/api/health" | Select-Object -Last 1
  $webLine = $lines | Select-String "\[dev\] WEB: http://localhost:(\d+)/" | Select-Object -Last 1
  if ($apiLine -and $webLine) {
    $backendPort = [int]$apiLine.Matches[0].Groups[1].Value
    $webPort = [int]$webLine.Matches[0].Groups[1].Value
    return @{ backendPort = $backendPort; webPort = $webPort }
  }
  return $null
}

function Get-PortsFromListening {
  $candidates = @(
    @{ backendPort = 3000; webPort = 3001 },
    @{ backendPort = 3100; webPort = 3101 }
  )
  foreach ($candidate in $candidates) {
    if (Test-PortListening -Port $candidate.backendPort) {
      if (Test-Health -BackendPort $candidate.backendPort) {
        return $candidate
      }
    }
  }
  return $null
}

function Resolve-Ports {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    $ports = Get-PortsFromLog
    if ($ports) { return $ports }
    $ports = Get-PortsFromListening
    if ($ports) { return $ports }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Write-PortsJson {
  param([hashtable]$Ports)
  if (-not $Ports) { return }
  $payload = [ordered]@{
    backendPort = $Ports.backendPort
    webPort = $Ports.webPort
    backendUrl = "http://localhost:$($Ports.backendPort)"
    webUrl = "http://localhost:$($Ports.webPort)"
    ts = (Get-Date).ToString("o")
  }
  $payload | ConvertTo-Json -Depth 3 | Out-File -FilePath $portsPath -Encoding ascii
}

function Write-HealthLog {
  param([int]$BackendPort)
  $url = "http://localhost:$BackendPort/api/health"
  $timestamp = (Get-Date).ToString("o")
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
    $status = $resp.StatusCode
    $ok = $status -eq 200
    $line = "[$timestamp] health ok=$ok status=$status url=$url"
  } catch {
    $line = "[$timestamp] health ok=false error=$($_.Exception.Message) url=$url"
  }
  $line | Out-File -FilePath $healthLog -Encoding ascii
}

function Run-Smoke {
  $smokePath = Join-Path $root "scripts" "smoke.ps1"
  if (-not (Test-Path $smokePath)) {
    throw "smoke.ps1 not found at $smokePath"
  }
  if (Test-Path $smokeLog) {
    Clear-Content $smokeLog
  }
  if (Test-Path $smokeErrLog) {
    Clear-Content $smokeErrLog
  }
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $smokePath,
    "-PortsPath",
    $portsPath,
    "-ResultPath",
    $smokeResultPath
  )
  $proc = Start-Process -FilePath "pwsh" -ArgumentList $args -WorkingDirectory $root -RedirectStandardOutput $smokeLog -RedirectStandardError $smokeErrLog -PassThru -Wait
  if (Test-Path $smokeErrLog) {
    $errContent = Get-Content $smokeErrLog -ErrorAction SilentlyContinue
    if ($errContent) {
      Add-Content -Path $smokeLog -Value $errContent
    }
  }
  return $proc.ExitCode
}

function Read-SmokeResult {
  if (-not (Test-Path $smokeResultPath)) { return $null }
  try {
    return Get-Content -Raw $smokeResultPath | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-LastResult {
  param(
    [bool]$Ok,
    [int]$Iteration,
    [hashtable]$Ports,
    $SmokeResult,
    [string[]]$Actions
  )
  $payload = [ordered]@{
    ok = $Ok
    ts = (Get-Date).ToString("o")
    iteration = $Iteration
    ports = $Ports
    actions = $Actions
    smoke = $SmokeResult
  }
  $payload | ConvertTo-Json -Depth 8 | Out-File -FilePath $lastResultPath -Encoding ascii
}

function Apply-Fix {
  param($SmokeResult)
  $actions = @()
  $restart = $false

  if (-not $SmokeResult) {
    $actions += "smoke result missing"
    return @{ actions = $actions; restart = $true }
  }

  $healthStatus = $SmokeResult.checks.health.status
  if ($healthStatus -eq "FAIL") {
    $actions += "health failed: restart dev"
    $restart = $true
  }

  $loginReason = $SmokeResult.checks.login.reason
  if ($loginReason -eq "auth endpoint missing") {
    if (Ensure-ServiceTokenFromExample) {
      $actions += "set AUTOPILOT_SERVICE_TOKEN from .env.example"
      $restart = $true
    }
  }

  $enableReason = $SmokeResult.checks.autopilotEnable.reason
  if ($enableReason -match "tenant") {
    if (-not $env:SMOKE_TENANT_ID) {
      $env:SMOKE_TENANT_ID = "1"
      $actions += "set SMOKE_TENANT_ID=1"
    }
  }

  $tickReason = $SmokeResult.checks.autopilotTick.reason
  if ($tickReason -match "tenant") {
    if (-not $env:SMOKE_TENANT_ID) {
      $env:SMOKE_TENANT_ID = "1"
      $actions += "set SMOKE_TENANT_ID=1"
    }
  }

  $reasonText = @(
    $SmokeResult.checks.health.reason,
    $SmokeResult.checks.login.reason,
    $SmokeResult.checks.autopilotStatus.reason,
    $SmokeResult.checks.autopilotEnable.reason,
    $SmokeResult.checks.autopilotTick.reason
  ) -join " "
  if ($reasonText -match "CORS") {
    $actions += "CORS issue detected: restart dev"
    $restart = $true
  }
  if ($reasonText -match "client") {
    $actions += "client issue detected: restart dev"
    $restart = $true
  }

  return @{ actions = $actions; restart = $restart }
}

Ensure-ServiceTokenFromExample | Out-Null

$iteration = 0
$allGreen = $false

while ($iteration -lt $MaxIterations -and -not $allGreen) {
  $iteration += 1
  Write-Loop "Iteration $iteration/$MaxIterations"

  Ensure-Dev | Out-Null
  $ports = Resolve-Ports
  if (-not $ports) {
    Write-Loop "Failed to resolve ports. Restarting dev."
    Stop-Dev
    Start-Dev | Out-Null
    $ports = Resolve-Ports
  }

  if ($ports) {
    Write-Loop "Using ports $($ports.backendPort)/$($ports.webPort)"
    Write-PortsJson -Ports $ports
    $healthReady = Wait-For-Health -BackendPort $ports.backendPort -TimeoutSec 60
    Write-HealthLog -BackendPort $ports.backendPort
    if (-not $healthReady) {
      Write-Loop "Health not ready; restarting dev."
      Stop-Dev
      Start-Dev | Out-Null
      if ($iteration -lt $MaxIterations) {
        Write-Loop "Retrying in 3 seconds..."
        Start-Sleep -Seconds 3
        continue
      }
    }
  } else {
    Write-Loop "Ports unresolved; skipping ports.json and health log."
  }

  $exitCode = Run-Smoke
  $smokeResult = Read-SmokeResult
  $ok = $false
  if ($smokeResult) {
    $ok = [bool]$smokeResult.ok -and $exitCode -eq 0
  } else {
    $ok = $exitCode -eq 0
  }

  if ($ok) {
    Write-LastResult -Ok $true -Iteration $iteration -Ports $ports -SmokeResult $smokeResult -Actions @("pass")
    $allGreen = $true
    break
  }

  $fix = Apply-Fix -SmokeResult $smokeResult
  Write-LastResult -Ok $false -Iteration $iteration -Ports $ports -SmokeResult $smokeResult -Actions $fix.actions

  if ($fix.restart) {
    Stop-Dev
    Start-Dev | Out-Null
  }

  if ($iteration -lt $MaxIterations) {
    Write-Loop "Retrying in 3 seconds..."
    Start-Sleep -Seconds 3
  }
}

if ($allGreen) {
  $webPort = if ($ports) { $ports.webPort } else { 3001 }
  $backendPort = if ($ports) { $ports.backendPort } else { 3000 }
  Write-Host "ALL GREEN"
  Write-Host "UI: http://localhost:$webPort/"
  Write-Host "API: http://localhost:$backendPort/api/health"
  exit 0
}

Write-Loop "Failed after $MaxIterations iterations."
exit 1

# ===== Testing Registration & Admin =====
Write-Host "
=== Testing Registration & Admin ===" -ForegroundColor Cyan

$rand = Get-Random -Maximum 10000
$testEmail = "test$rand@example.com"
$testPass = "password123"

$reg = Invoke-RestMethod -Uri "${baseUrl}/api/auth/register" -Method Post 
  -Body (@{email=$testEmail; password=$testPass} | ConvertTo-Json) 
  -ContentType "application/json" -ErrorAction Stop

$login = Invoke-RestMethod -Uri "${baseUrl}/api/auth/login" -Method Post 
  -Body (@{email=$testEmail; password=$testPass} | ConvertTo-Json) 
  -ContentType "application/json" -ErrorAction Stop

$token = $login.token
$headers = @{ Authorization = "Bearer $token" }

$me = Invoke-RestMethod -Uri "${baseUrl}/api/auth/me" -Headers $headers
if (-not $me.role) { throw "/me does not return role" }

Write-Host "Registration & Admin tests passed" -ForegroundColor Green
