param()

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logsDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$portsScanPath = Join-Path $logsDir "ports-scan.json"
$portsJsonPath = Join-Path $logsDir "ports.json"

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  try {
    $raw = Get-Content -Raw $Path
    if (-not $raw) { return $null }
    return $raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-ListeningEntries {
  $entries = @()
  $lines = netstat -ano | Select-String "LISTENING"
  foreach ($line in $lines) {
    $parts = ($line -split "\s+") | Where-Object { $_ -ne "" }
    if ($parts.Length -lt 5) { continue }
    $local = $parts[1]
    if ($local -notmatch ":(\d+)$") { continue }
    $port = [int]$Matches[1]
    $pidRaw = $parts[-1]
    if ($pidRaw -notmatch "^\d+$") { continue }
    $processId = [int]$pidRaw
    $entries += [pscustomobject]@{ port = $port; pid = $processId }
  }
  return $entries
}

function Get-ProcessInfo {
  param([int]$ProcessId)
  $name = $null
  $commandLine = $null
  try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
    $name = $proc.ProcessName
  } catch {
  }
  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    if ($cim) {
      if (-not $name) { $name = $cim.Name }
      $commandLine = $cim.CommandLine
    }
  } catch {
    try {
      $wmi = Get-WmiObject Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
      if ($wmi) {
        if (-not $name) { $name = $wmi.Name }
        $commandLine = $wmi.CommandLine
      }
    } catch {
    }
  }
  return @{ name = $name; commandLine = $commandLine }
}

function Test-Health {
  param([int]$Port)
  $url = "http://localhost:$Port/api/health"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
    return @{ ok = ($resp.StatusCode -eq 200); status = $resp.StatusCode; url = $url }
  } catch {
    return @{ ok = $false; status = $null; url = $url; error = $_.Exception.Message }
  }
}

function Test-Web {
  param([int]$Port)
  $url = "http://localhost:$Port/"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
    $ok = $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400
    return @{ ok = $ok; status = $resp.StatusCode; url = $url }
  } catch {
    return @{ ok = $false; status = $null; url = $url; error = $_.Exception.Message }
  }
}

function Resolve-PortalPorts {
  $portsJson = Read-JsonFile -Path $portsJsonPath
  $backendPort = $null
  $webPort = $null
  $source = "scan"

  if ($portsJson) {
    $backendPort = $portsJson.backendPort
    $webPort = $portsJson.webPort
    $source = "ports.json"
  }

  $healthChecks = @()
  $backendCandidates = @()
  if ($backendPort) { $backendCandidates += [int]$backendPort }
  if (-not $backendCandidates.Count) { $backendCandidates += 3000, 3100 }

  $confirmedBackend = $null
  foreach ($candidate in $backendCandidates) {
    $check = Test-Health -Port $candidate
    $healthChecks += [ordered]@{ port = $candidate; ok = $check.ok; status = $check.status; url = $check.url; error = $check.error }
    if ($check.ok -and -not $confirmedBackend) {
      $confirmedBackend = $candidate
    }
  }
  if (-not $confirmedBackend -and $backendCandidates.Count -eq 1) {
    foreach ($fallback in 3000, 3100) {
      if ($backendCandidates -contains $fallback) { continue }
      $check = Test-Health -Port $fallback
      $healthChecks += [ordered]@{ port = $fallback; ok = $check.ok; status = $check.status; url = $check.url; error = $check.error }
      if ($check.ok -and -not $confirmedBackend) {
        $confirmedBackend = $fallback
      }
    }
    if ($confirmedBackend) { $source = "fallback" }
  }
  if ($confirmedBackend) { $backendPort = $confirmedBackend }

  $webCandidates = @()
  if ($webPort) { $webCandidates += [int]$webPort }
  if (-not $webCandidates.Count) { $webCandidates += 3001, 3101 }

  $confirmedWeb = $null
  foreach ($candidate in $webCandidates) {
    $check = Test-Web -Port $candidate
    if ($check.ok -and -not $confirmedWeb) {
      $confirmedWeb = $candidate
    }
  }
  if (-not $confirmedWeb -and $webCandidates.Count -eq 1) {
    foreach ($fallback in 3001, 3101) {
      if ($webCandidates -contains $fallback) { continue }
      $check = Test-Web -Port $fallback
      if ($check.ok -and -not $confirmedWeb) {
        $confirmedWeb = $fallback
      }
    }
    if ($confirmedWeb) { $source = "fallback" }
  }
  if ($confirmedWeb) { $webPort = $confirmedWeb }

  $uiUrl = if ($webPort) { "http://localhost:$webPort/" } else { $null }
  $apiHealthUrl = if ($backendPort) { "http://localhost:$backendPort/api/health" } else { $null }

  return @{
    backendPort = $backendPort
    webPort = $webPort
    uiUrl = $uiUrl
    apiHealthUrl = $apiHealthUrl
    healthConfirmedPort = $confirmedBackend
    healthChecks = $healthChecks
    source = $source
  }
}

$rawEntries = Get-ListeningEntries
$unique = @{}
foreach ($entry in $rawEntries) {
  $key = "{0}:{1}" -f $entry.port, $entry.pid
  if (-not $unique.ContainsKey($key)) {
    $unique[$key] = $entry
  }
}

$processCache = @{}
$listening = foreach ($entry in $unique.Values) {
  $processId = $entry.pid
  if (-not $processCache.ContainsKey($processId)) {
    $processCache[$processId] = Get-ProcessInfo -ProcessId $processId
  }
  $info = $processCache[$processId]
  [ordered]@{
    port = $entry.port
    pid = $processId
    processName = $info.name
    commandLine = $info.commandLine
  }
}

$listeningSorted = $listening | Sort-Object -Property port, pid
$portal = Resolve-PortalPorts

$payload = [ordered]@{
  ts = (Get-Date).ToString("o")
  listening = $listeningSorted
  portal = [ordered]@{
    backendPort = $portal.backendPort
    webPort = $portal.webPort
    uiUrl = $portal.uiUrl
    apiHealthUrl = $portal.apiHealthUrl
    healthConfirmedPort = $portal.healthConfirmedPort
    healthChecks = $portal.healthChecks
    source = $portal.source
  }
}

$payload | ConvertTo-Json -Depth 6 | Out-File -FilePath $portsScanPath -Encoding ascii

Write-Host "[ports] Listening ports: $($listeningSorted.Count)"
foreach ($entry in $listeningSorted) {
  $cmd = if ($entry.commandLine) { $entry.commandLine } else { "" }
  Write-Host ("- port={0} pid={1} name={2} cmd={3}" -f $entry.port, $entry.pid, $entry.processName, $cmd)
}

Write-Host ""
Write-Host "PORTAL Global ports"
Write-Host ("backendPort: {0}" -f ($portal.backendPort ?? "-"))
Write-Host ("webPort: {0}" -f ($portal.webPort ?? "-"))
Write-Host ("UI: {0}" -f ($portal.uiUrl ?? "-"))
Write-Host ("API health: {0}" -f ($portal.apiHealthUrl ?? "-"))
Write-Host ("health confirmed port: {0}" -f ($portal.healthConfirmedPort ?? "-"))
