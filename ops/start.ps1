$ErrorActionPreference = "Stop"

param(
  [switch]$StartWebNext
)

$ROOT = Split-Path -Parent $PSScriptRoot
$LOG_DIR = Join-Path $ROOT "logs"
$LOG_FILE = Join-Path $LOG_DIR "startup.log"

if (-not (Test-Path $LOG_DIR)) {
  New-Item -ItemType Directory -Path $LOG_DIR | Out-Null
}

function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$timestamp] $Message"
  Write-Host $line
  Add-Content -Path $LOG_FILE -Value $line
}

Write-Log "=== Startup begin ==="

function Get-ListenerPids {
  param([int]$Port)
  $pids = @()
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
      $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    }
  } else {
    $lines = netstat -ano | Select-String ":$Port\s+LISTENING"
    foreach ($line in $lines) {
      $parts = ($line -split "\s+") | Where-Object { $_ -ne "" }
      $procId = $parts[-1]
      if ($procId -match "^\d+$") {
        $pids += [int]$procId
      }
    }
    $pids = $pids | Select-Object -Unique
  }
  return $pids
}

function Stop-PortListeners {
  param([int]$Port)
  $pids = Get-ListenerPids -Port $Port
  if (-not $pids -or $pids.Count -eq 0) {
    Write-Log "Port $Port: no listeners."
    return
  }
  foreach ($procId in $pids) {
    if (-not $procId) { continue }
    try {
      $proc = Get-Process -Id $procId -ErrorAction Stop
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Log "Port $Port: stopped PID $procId ($($proc.ProcessName))."
    } catch {
      Write-Log "Port $Port: failed to stop PID $procId. $_"
      Write-Log "Port $Port: if access denied, re-run PowerShell as Administrator."
    }
  }
}

Stop-PortListeners -Port 3000
Stop-PortListeners -Port 3001
Stop-PortListeners -Port 5055

Start-Sleep -Seconds 1

$env:AGENTS_ENGINE = "crewai"
if (-not $env:CREWAI_URL) { $env:CREWAI_URL = "http://localhost:5055" }
if (-not $env:CREWAI_API_KEY) { $env:CREWAI_API_KEY = "dev" }

Write-Log "Env: AGENTS_ENGINE=$($env:AGENTS_ENGINE) CREWAI_URL=$($env:CREWAI_URL)"

$crewaiLog = Join-Path $LOG_DIR "crewai.log"
$portalLog = Join-Path $LOG_DIR "portal.log"
$webLog = Join-Path $LOG_DIR "web-next.log"

$crewProcess = Start-Process -FilePath "pwsh" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ROOT "ops\run-crewai.ps1") -WorkingDirectory $ROOT -PassThru -RedirectStandardOutput $crewaiLog -RedirectStandardError $crewaiLog
Write-Log "Crew Runner started (PID $($crewProcess.Id)). Logs: $crewaiLog"

$npmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) { $npmCmd = "npm.cmd" }

$portalProcess = Start-Process -FilePath $npmCmd -ArgumentList "run", "dev:backend" -WorkingDirectory $ROOT -PassThru -RedirectStandardOutput $portalLog -RedirectStandardError $portalLog
Write-Log "Portal backend started (PID $($portalProcess.Id)). Logs: $portalLog"

$shouldStartWeb = $StartWebNext -or ($env:START_WEB_NEXT -match "^(1|true|yes)$")
if ($shouldStartWeb) {
  if (Test-Path (Join-Path $ROOT "web-next")) {
    $webProcess = Start-Process -FilePath $npmCmd -ArgumentList "run", "dev:web" -WorkingDirectory $ROOT -PassThru -RedirectStandardOutput $webLog -RedirectStandardError $webLog
    Write-Log "Web-next started (PID $($webProcess.Id)). Logs: $webLog"
  } else {
    Write-Log "Web-next folder not found. Skipping web-next."
  }
} else {
  Write-Log "Web-next not requested. Skipping web-next."
}

function Wait-ForHealth {
  param(
    [string]$Url,
    [string]$Name,
    [int]$TimeoutSec = 60
  )
  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
        Write-Log "$Name healthy: $Url"
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  Write-Log "$Name not healthy after ${TimeoutSec}s: $Url"
  return $false
}

$crewHealthy = Wait-ForHealth -Url "http://localhost:5055/health" -Name "Crew Runner"
$portalHealthy = Wait-ForHealth -Url "http://localhost:3000/api/health" -Name "Portal API"

Write-Log "=== Startup summary ==="
Write-Log "Portal: http://localhost:3000/app (health: $($portalHealthy))"
Write-Log "Crew Runner: http://localhost:5055/health (health: $($crewHealthy))"
if ($shouldStartWeb) {
  Write-Log "Web-next: http://localhost:3001 (requested: $shouldStartWeb)"
}
Write-Log "Logs: $LOG_FILE"
