param(
  [int[]]$Ports = @()
)

$ErrorActionPreference = "Continue"

$paths = @(
  "/",
  "/app",
  "/docs",
  "/pricing",
  "/login",
  "/api/health",
  "/api/auth/me"
)

function Get-ListeningPorts {
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

  $unique = @{}
  foreach ($entry in $entries) {
    $key = "{0}:{1}" -f $entry.port, $entry.pid
    if (-not $unique.ContainsKey($key)) {
      $unique[$key] = $entry
    }
  }

  $processCache = @{}
  $withProcess = foreach ($entry in $unique.Values) {
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

  return $withProcess | Sort-Object -Property port, pid
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

function Invoke-Probe {
  param(
    [string]$Url,
    [string]$Path
  )
  $result = [ordered]@{
    path = $Path
    url = $Url
    ok = $false
    status = $null
    ms = $null
    error = $null
  }
  $start = Get-Date
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method GET -TimeoutSec 3
    $result.status = $resp.StatusCode
    $result.ok = $true
  } catch {
    $statusCode = $null
    if ($_.Exception -and $_.Exception.Response) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch {
      }
    }
    if ($statusCode) {
      $result.status = $statusCode
      $result.ok = $true
    } else {
      $result.error = $_.Exception.Message
    }
  }
  $result.ms = [int]((Get-Date) - $start).TotalMilliseconds
  return $result
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $HOME ("portal-ports-scan-" + $timestamp + ".json")

$listening = Get-ListeningPorts

$portsToProbe = @()
if ($Ports -and $Ports.Count -gt 0) {
  $portsToProbe = $Ports
} else {
  $portsToProbe = $listening | Select-Object -ExpandProperty port -Unique
}

$portsToProbe = $portsToProbe | Sort-Object -Unique

$probes = @()
foreach ($port in $portsToProbe) {
  $baseUrl = "http://localhost:$port"
  $checks = @()
  foreach ($path in $paths) {
    $checks += Invoke-Probe -Url ($baseUrl + $path) -Path $path
  }
  $probes += [ordered]@{
    port = $port
    baseUrl = $baseUrl
    checks = $checks
  }
}

$payload = [ordered]@{
  ts = (Get-Date).ToString("o")
  computerName = $env:COMPUTERNAME
  user = $env:USERNAME
  listening = $listening
  probes = $probes
  outputPath = $reportPath
}

$payload | ConvertTo-Json -Depth 6 | Out-File -FilePath $reportPath -Encoding ascii

Write-Host "Report written to $reportPath"
