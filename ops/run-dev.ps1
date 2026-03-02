$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

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

$preferredBackendPort = 3000
$preferredWebPort = 3001
$fallbackBackendPort = 3100
$fallbackWebPort = 3101

$backendPids = Get-ListenerPids -Port $preferredBackendPort
$webPids = Get-ListenerPids -Port $preferredWebPort
$useFallback = ($backendPids.Count -gt 0) -or ($webPids.Count -gt 0)

if ($useFallback) {
  if ($backendPids.Count -gt 0) {
    Write-Warning "Port $preferredBackendPort is in use by PID(s): $($backendPids -join ', ')"
  }
  if ($webPids.Count -gt 0) {
    Write-Warning "Port $preferredWebPort is in use by PID(s): $($webPids -join ', ')"
  }
  $backendPort = $fallbackBackendPort
  $webPort = $fallbackWebPort
  Write-Warning "Falling back to ports $backendPort/$webPort."
} else {
  $backendPort = $preferredBackendPort
  $webPort = $preferredWebPort
  Write-Host "[dev] Ports available. Using $backendPort/$webPort."
}

$env:BACKEND_PORT = $backendPort
$env:WEB_PORT = $webPort
$env:PORT = $backendPort
$env:NEXT_PUBLIC_BACKEND_PORT = $backendPort
if (-not $env:NEXT_PUBLIC_API_BASE_URL) {
  $env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:$backendPort"
}
if (-not $env:ALLOWED_ORIGINS) {
  $env:ALLOWED_ORIGINS = "http://localhost:3000,http://localhost:3001,http://localhost:3100,http://localhost:3101"
}

Write-Host "[dev] API: http://localhost:$backendPort/api/health"
Write-Host "[dev] WEB: http://localhost:$webPort/"

Write-Host "[dev] npm install (root) if needed..."
if (-not (Test-Path .\node_modules)) { npm install }

if (Test-Path .\web-next\package.json) {
  Write-Host "[dev] npm install (web-next) if needed..."
  if (-not (Test-Path .\web-next\node_modules)) {
    Push-Location .\web-next
    try {
      npm install
    } finally {
      Pop-Location
    }
  }
} else {
  Write-Host "[dev] web-next not found; skipping install."
}

Write-Host "[dev] start backend + web-next..."
$nodemonCmd = Join-Path $root "node_modules\.bin\nodemon.cmd"
if (-not (Test-Path $nodemonCmd)) {
  throw "nodemon not found at $nodemonCmd"
}
$backendProc = Start-Process -FilePath $nodemonCmd -ArgumentList @("server.js") -WorkingDirectory $root -NoNewWindow -PassThru

$nextCmd = Join-Path $root "web-next\node_modules\.bin\next.cmd"
if (-not (Test-Path $nextCmd)) {
  throw "next not found at $nextCmd"
}
$webProc = Start-Process -FilePath $nextCmd -ArgumentList @("dev", "--port", "$webPort") -WorkingDirectory (Join-Path $root "web-next") -NoNewWindow -PassThru
Write-Host "[dev] backend PID: $($backendProc.Id)"
Write-Host "[dev] web PID: $($webProc.Id)"
Wait-Process -Id $backendProc.Id, $webProc.Id
