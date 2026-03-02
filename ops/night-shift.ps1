param(
  [switch]$Once,
  [switch]$ResetWork,
  [switch]$CleanLogs,
  [switch]$Fresh,
  [switch]$Remote,
  [string]$BackendBaseUrl = "",
  [string]$WebBaseUrl = "",
  [int]$DelaySec = 10,
  [int]$ReadinessRetries = 30,
  [int]$ReadinessDelaySec = 2
)

$ErrorActionPreference = "Stop"

function Write-Shift {
  param([string]$Message)
  Write-Host "[night-shift] $Message"
}

function Test-RepoRoot {
  param([string]$Path)
  if (-not $Path) { return $false }
  $serverPath = Join-Path $Path "server.js"
  $webPath = Join-Path $Path "web-next"
  return ((Test-Path $serverPath) -and (Test-Path $webPath))
}

function Find-RepoRoot {
  param([string[]]$StartPaths)
  foreach ($start in $StartPaths) {
    if (-not $start) { continue }
    $resolved = Resolve-Path $start -ErrorAction SilentlyContinue
    if (-not $resolved) { continue }
    $cursor = $resolved.Path
    while ($true) {
      if (Test-RepoRoot -Path $cursor) { return $cursor }
      $parent = Split-Path $cursor -Parent
      if (-not $parent -or $parent -eq $cursor) { break }
      $cursor = $parent
    }
  }
  return $null
}

function Import-EnvFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $false }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($trimmed.StartsWith("#")) { continue }
    $pair = $trimmed -split "=", 2
    if ($pair.Length -ne 2) { continue }
    $key = $pair[0].Trim()
    $value = $pair[1].Trim()
    if ($key) {
      $existing = [System.Environment]::GetEnvironmentVariable($key, "Process")
      if (-not $existing) {
        [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
      }
    }
  }
  return $true
}

function Test-ProcessAlive {
  param([int]$ProcessId)
  if (-not $ProcessId) { return $false }
  try {
    $null = Get-Process -Id $ProcessId -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Acquire-Lock {
  param([string]$Path, [string]$Cwd)
  $lockDir = Split-Path $Path -Parent
  if (-not (Test-Path $lockDir)) {
    New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
  }
  if (Test-Path $Path) {
    $lockData = $null
    try {
      $lockData = (Get-Content -Raw $Path | ConvertFrom-Json)
    } catch {
      $lockData = $null
    }
    $lockPid = $lockData?.pid
    if ($lockPid -and (Test-ProcessAlive -ProcessId $lockPid)) {
      Write-Shift "Already running (pid=$lockPid)"
      return [ordered]@{ ok = $false; exitCode = 2; pid = $lockPid }
    }
    Remove-Item -Force -ErrorAction SilentlyContinue $Path
  }
  $payload = [ordered]@{
    pid = $PID
    startedAt = (Get-Date).ToString("o")
    cwd = $Cwd
  } | ConvertTo-Json -Compress
  $payload | Out-File -Encoding ascii $Path
  return [ordered]@{ ok = $true; path = $Path }
}

function Release-Lock {
  param([string]$Path)
  if (Test-Path $Path) {
    Remove-Item -Force -ErrorAction SilentlyContinue $Path
  }
}

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

function Stop-Ports {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    foreach ($procId in (Get-ListenerPids -Port $port)) {
      try {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      } catch {
        Write-Shift "Failed to stop PID $procId on port $port"
      }
    }
  }
}

function Start-Dev {
  param([string]$Root)
  $runDev = Join-Path $Root "ops" "run-dev.ps1"
  if (-not (Test-Path $runDev)) {
    throw "ops/run-dev.ps1 not found at $runDev"
  }
  Write-Shift "Start dev: $runDev"
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runDev)
  return Start-Process -FilePath "pwsh" -ArgumentList $args -WorkingDirectory $Root -PassThru -WindowStyle Hidden
}

function Stop-Dev {
  param([ref]$DevProc, [int[]]$Ports)
  if ($DevProc.Value) {
    try {
      if (-not $DevProc.Value.HasExited) {
        Stop-Process -Id $DevProc.Value.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Shift "Failed to stop dev process $($DevProc.Value.Id)"
    }
    $DevProc.Value = $null
  }
  Stop-Ports -Ports $Ports
}

function Invoke-HttpCheck {
  param([string]$Url)
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
    return [ordered]@{ ok = $true; status = $resp.StatusCode; url = $Url }
  } catch {
    $status = $null
    if ($_.Exception -and $_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
    }
    return [ordered]@{ ok = $false; status = $status; url = $Url; error = $_.Exception.Message }
  }
}

function Wait-For-Backend {
  param([int[]]$Ports, [int]$Retries, [int]$DelaySec)
  $last = $null
  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    foreach ($port in $Ports) {
      $url = "http://localhost:$port/api/health"
      $resp = Invoke-HttpCheck -Url $url
      $last = $resp
      if ($resp.ok -and $resp.status -ge 200 -and $resp.status -lt 300) {
        $resp.port = $port
        $resp.attempt = $attempt
        return $resp
      }
    }
    Start-Sleep -Seconds $DelaySec
  }
  if ($last) { $last.attempt = $Retries }
  return $last
}

function Wait-For-Web {
  param([int[]]$Ports, [int]$Retries, [int]$DelaySec)
  $last = $null
  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    foreach ($port in $Ports) {
      $healthUrl = "http://localhost:$port/api/health"
      $health = Invoke-HttpCheck -Url $healthUrl
      $last = $health
      if ($health.ok -and $health.status -ge 200 -and $health.status -lt 300) {
        $health.port = $port
        $health.endpoint = "/api/health"
        $health.attempt = $attempt
        return $health
      }
      $registerUrl = "http://localhost:$port/register"
      $register = Invoke-HttpCheck -Url $registerUrl
      $last = $register
      if ($register.ok -and $register.status -ge 200 -and $register.status -lt 400) {
        $register.port = $port
        $register.endpoint = "/register"
        $register.attempt = $attempt
        return $register
      }
    }
    Start-Sleep -Seconds $DelaySec
  }
  if ($last) { $last.attempt = $Retries }
  return $last
}

function Invoke-Smoke {
  param(
    [string]$Root,
    [string]$BackendBaseUrl = "",
    [string]$WebBaseUrl = ""
  )
  $smokePath = Join-Path $Root "ops" "smoke-agent-e2e.ps1"
  Write-Shift "Smoke: $smokePath"
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $smokePath)
  if ($BackendBaseUrl) { $args += @("-BackendBaseUrl", $BackendBaseUrl) }
  if ($WebBaseUrl) { $args += @("-WebBaseUrl", $WebBaseUrl) }
  $null = & pwsh @args
  $exitCode = $LASTEXITCODE
  return [ordered]@{ ok = ($exitCode -eq 0); exitCode = $exitCode; path = $smokePath }
}

function Invoke-SmokeWithRepair {
  param(
    [string]$Root,
    [ref]$DevProc,
    [int[]]$Ports,
    [int[]]$WebPorts,
    [int]$Retries,
    [int]$DelaySec,
    [string]$BackendBaseUrl = "",
    [string]$WebBaseUrl = ""
  )
  $first = Invoke-Smoke -Root $Root -BackendBaseUrl $BackendBaseUrl -WebBaseUrl $WebBaseUrl
  if ($first.ok) {
    $first["attempts"] = 1
    return $first
  }
  Write-Shift "Smoke failed (exit $($first.exitCode)); auto-repair restart dev"
  Stop-Dev -DevProc $DevProc -Ports ($Ports + $WebPorts)
  $DevProc.Value = Start-Dev -Root $Root
  $backendReady = Wait-For-Backend -Ports $Ports -Retries $Retries -DelaySec $DelaySec
  $webReady = Wait-For-Web -Ports $WebPorts -Retries $Retries -DelaySec $DelaySec
  if (-not $backendReady.ok -or -not $webReady.ok) {
    return [ordered]@{ ok = $false; exitCode = 50; attempts = 2; error = "restart readiness failed"; backend = $backendReady; web = $webReady }
  }
  $second = Invoke-Smoke -Root $Root -BackendBaseUrl $BackendBaseUrl -WebBaseUrl $WebBaseUrl
  $second["attempts"] = 2
  return $second
}

function Read-WorkFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "Work file not found at $Path"
  }
  $raw = Get-Content -Raw $Path
  return ($raw | ConvertFrom-Json)
}

function Save-WorkFile {
  param($Work, [string]$Path)
  Set-WorkProperty -Obj $Work -Name "updatedAt" -Value (Get-Date).ToString("o")
  $Work | ConvertTo-Json -Depth 8 | Out-File -Encoding ascii $Path
}

function Set-WorkProperty {
  param($Obj, [string]$Name, $Value)
  if (-not $Obj) { return }
  if ($Obj.PSObject.Properties.Match($Name).Count -gt 0) {
    $Obj.$Name = $Value
  } else {
    $Obj | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Remove-WorkProperty {
  param($Obj, [string]$Name)
  if (-not $Obj) { return }
  if ($Obj.PSObject.Properties.Match($Name).Count -gt 0) {
    $Obj.PSObject.Properties.Remove($Name)
  }
}

function Reset-WorkItems {
  param([string]$WorkPath)
  $work = Read-WorkFile -Path $WorkPath
  $count = 0
  foreach ($item in $work.items) {
    Set-WorkProperty -Obj $item -Name "status" -Value "pending"
    Remove-WorkProperty -Obj $item -Name "startedAt"
    Remove-WorkProperty -Obj $item -Name "finishedAt"
    Remove-WorkProperty -Obj $item -Name "lastError"
    Remove-WorkProperty -Obj $item -Name "lastLogPath"
    Set-WorkProperty -Obj $item -Name "attempts" -Value 0
    $count += 1
  }
  Save-WorkFile -Work $work -Path $WorkPath
  return $count
}

function Archive-LogFile {
  param([string]$Path, [string]$ArchiveDir)
  if (-not (Test-Path $Path)) { return $null }
  if (-not (Test-Path $ArchiveDir)) {
    New-Item -ItemType Directory -Force -Path $ArchiveDir | Out-Null
  }
  $base = [System.IO.Path]::GetFileNameWithoutExtension($Path)
  $ext = [System.IO.Path]::GetExtension($Path)
  $stamp = (Get-Date).ToString("yyyy-MM-dd_HH-mm-ss")
  $target = Join-Path $ArchiveDir ("{0}.{1}{2}" -f $base, $stamp, $ext)
  $suffix = 1
  while (Test-Path $target) {
    $target = Join-Path $ArchiveDir ("{0}.{1}.{2}{3}" -f $base, $stamp, $suffix, $ext)
    $suffix += 1
  }
  Move-Item -Force -Path $Path -Destination $target
  return $target
}

function Clean-Logs {
  param([string]$LogsDir)
  $archiveDir = Join-Path $LogsDir "archive"
  $archived = @()
  $targets = @(
    (Join-Path $LogsDir "night-shift.json"),
    (Join-Path $LogsDir "smoke-agent-e2e.json")
  )
  foreach ($target in $targets) {
    $archivedPath = Archive-LogFile -Path $target -ArchiveDir $archiveDir
    if ($archivedPath) { $archived += $archivedPath }
  }
  return $archived
}

function Get-NextWorkItem {
  param($Work)
  if (-not $Work -or -not $Work.items) { return $null }
  foreach ($item in $Work.items) {
    if (-not $item.status) { return $item }
    if ($item.status -ne "done") { return $item }
  }
  return $null
}

function Execute-WorkItem {
  param($Item, $Work, [string]$WorkPath)
  Set-WorkProperty -Obj $Item -Name "status" -Value "in_progress"
  Set-WorkProperty -Obj $Item -Name "startedAt" -Value (Get-Date).ToString("o")
  Save-WorkFile -Work $Work -Path $WorkPath

  Write-Shift "Work item: $($Item.itemId) ($($Item.description))"
  $exitCode = 0
  $mode = "instructions"
  if ($Item.command) {
    $mode = "command"
    Write-Shift "Work command: $($Item.command)"
    $null = & pwsh -NoProfile -ExecutionPolicy Bypass -Command $Item.command
    $exitCode = $LASTEXITCODE
  }

  Set-WorkProperty -Obj $Item -Name "finishedAt" -Value (Get-Date).ToString("o")
  Set-WorkProperty -Obj $Item -Name "lastExitCode" -Value $exitCode
  if ($exitCode -eq 0) {
    Set-WorkProperty -Obj $Item -Name "status" -Value "done"
  } else {
    Set-WorkProperty -Obj $Item -Name "status" -Value "failed"
  }
  Save-WorkFile -Work $Work -Path $WorkPath

  return [ordered]@{ ok = ($exitCode -eq 0); exitCode = $exitCode; mode = $mode; itemId = $Item.itemId; mission = $Item.mission }
}

function Update-ProjectState {
  param(
    [string]$Path,
    [string]$Mission,
    [string]$ItemId,
    [string]$Status,
    [int]$ExitCode,
    [string]$LogPath
  )
  if (-not (Test-Path $Path)) { return }
  $startMarker = "<!-- NIGHT-SHIFT-START -->"
  $endMarker = "<!-- NIGHT-SHIFT-END -->"
$block = @"
$startMarker
- Last run: $((Get-Date).ToString("o"))
- Mission: $Mission
- Item: $ItemId
- Status: $Status
- Exit code: $ExitCode
- Log: $LogPath
$endMarker
"@

  $content = Get-Content -Raw $Path
  if ($content -notmatch [regex]::Escape($startMarker)) {
    $content = $content.TrimEnd() + "`r`n`r`n## Night Shift`r`n" + $block + "`r`n"
  } else {
    $pattern = "(?s)" + [regex]::Escape($startMarker) + ".*?" + [regex]::Escape($endMarker)
    $content = [regex]::Replace($content, $pattern, $block)
  }
  $content | Out-File -Encoding ascii $Path
}

function Write-State {
  param($State, [string]$Path)
  $State.lastRun = (Get-Date).ToString("o")
  $State | ConvertTo-Json -Depth 12 | Out-File -Encoding ascii $Path
}

$root = Find-RepoRoot -StartPaths @($PSScriptRoot, (Get-Location).Path)
if (-not $root) {
  Write-Shift "Repository root not found (server.js + web-next)"
  exit 1
}
Set-Location $root

$lockPath = Join-Path $root "ops" "tmp" "night-shift.lock"
$lockAcquired = $false

try {
  $lockInfo = Acquire-Lock -Path $lockPath -Cwd (Get-Location).Path
  if (-not $lockInfo.ok) {
    exit 2
  }
  $lockAcquired = $true

  if ($Fresh) {
    $ResetWork = $true
    $CleanLogs = $true
    $Once = $true
  }
  $mode = if ($Remote) { "REMOTE" } elseif ($Once) { "ONCE" } else { "FULL" }
  Write-Shift ("mode=" + $mode + " fresh=" + $Fresh.ToString().ToLower() + " resetWork=" + $ResetWork.ToString().ToLower() + " cleanLogs=" + $CleanLogs.ToString().ToLower())

$envLoaded = $false
if (Import-EnvFile -Path (Join-Path $root ".env")) {
  $envLoaded = $true
  Write-Shift "Loaded .env"
} elseif (Import-EnvFile -Path (Join-Path $root ".env.example")) {
  $envLoaded = $true
  Write-Shift "Loaded .env.example"
} else {
  Write-Shift "No .env or .env.example found"
}

$logsDir = Join-Path $root "logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}
$logPath = Join-Path $logsDir "night-shift.json"
$workPath = Join-Path $root "ops" "night-shift.work.json"
$projectStatePath = Join-Path $root "docs" "PROJECT-STATE.md"

$archivedLogs = @()
if ($CleanLogs) {
  $archivedLogs = Clean-Logs -LogsDir $logsDir
  if ($archivedLogs.Count -gt 0) {
    Write-Shift ("CleanLogs archived: " + ($archivedLogs -join ", "))
  } else {
    Write-Shift "CleanLogs: no logs to archive"
  }
}

$resetCount = $null
if ($ResetWork) {
  $resetCount = Reset-WorkItems -WorkPath $workPath
  Write-Shift ("ResetWork: " + $resetCount + " items reset")
}

if ($Fresh) {
  $archivedCount = if ($archivedLogs) { $archivedLogs.Count } else { 0 }
  $resetLabel = if ($null -ne $resetCount) { $resetCount } else { 0 }
  Write-Shift ("Fresh: archived=" + $archivedCount + " reset=" + $resetLabel)
  Update-ProjectState -Path $projectStatePath -Mission "n/a" -ItemId "fresh run" -Status "FRESH" -ExitCode 0 -LogPath $logPath
}

$backendPorts = @()
if ($env:BACKEND_PORT) { $backendPorts += [int]$env:BACKEND_PORT }
$backendPorts += 3000
$backendPorts += 3100
$backendPorts = $backendPorts | Select-Object -Unique

$webPorts = @()
if ($env:WEB_PORT) { $webPorts += [int]$env:WEB_PORT }
$webPorts += 3001
$webPorts += 3101
$webPorts = $webPorts | Select-Object -Unique

$state = [ordered]@{
  startedAt = (Get-Date).ToString("o")
  root = $root
  logPath = $logPath
  workPath = $workPath
  runs = @()
  failureStreak = 0
}

$failureStreak = 0
$iteration = 0
$devProc = $null

if ($Remote) {
  $iterStart = Get-Date
  $iter = [ordered]@{
    index = 1
    ts = $iterStart.ToString("o")
    steps = [ordered]@{}
  }
  $smokeRemote = Invoke-Smoke -Root $root -BackendBaseUrl $BackendBaseUrl -WebBaseUrl $WebBaseUrl
  $iter.steps.smoke = $smokeRemote
  $iter.exitCode = $smokeRemote.exitCode
  $iter.status = if ($smokeRemote.ok) { "PASS" } else { "FAIL" }
  $iter.durationMs = [int]((Get-Date) - $iterStart).TotalMilliseconds
  $state.runs += $iter
  $state.failureStreak = if ($smokeRemote.ok) { 0 } else { 1 }
  $state.lastStatus = $iter.status
  $state.lastExitCode = $iter.exitCode
  $state.lastItem = "n/a"
  $state.lastMission = "n/a"
  $state.lastLogPath = $logPath
  Write-State -State $state -Path $logPath
  Write-Shift ("REMOTE " + $iter.status + ": exit=" + $iter.exitCode + " log=" + $logPath)
  Update-ProjectState -Path $projectStatePath -Mission "n/a" -ItemId "remote" -Status $iter.status -ExitCode $iter.exitCode -LogPath $logPath
  Write-Shift "Logs saved: $logPath"
  exit 0
}

while ($true) {
  $iteration += 1
  $iterStart = Get-Date
  $iter = [ordered]@{
    index = $iteration
    ts = $iterStart.ToString("o")
    steps = [ordered]@{}
  }

  $backendReady = Wait-For-Backend -Ports $backendPorts -Retries 5 -DelaySec 2
  $webReady = Wait-For-Web -Ports $webPorts -Retries 5 -DelaySec 2
  $startedDev = $false
  if (-not $backendReady.ok -or -not $webReady.ok) {
    $devProc = Start-Dev -Root $root
    $startedDev = $true
    $backendReady = Wait-For-Backend -Ports $backendPorts -Retries $ReadinessRetries -DelaySec $ReadinessDelaySec
    $webReady = Wait-For-Web -Ports $webPorts -Retries $ReadinessRetries -DelaySec $ReadinessDelaySec
  }

  $iter.steps.readiness = [ordered]@{
    backend = $backendReady
    web = $webReady
    startedDev = $startedDev
    devPid = if ($devProc) { $devProc.Id } else { $null }
  }

  if (-not $backendReady.ok -or -not $webReady.ok) {
    $iter.steps.smokeBefore = [ordered]@{ ok = $false; exitCode = 51; error = "readiness failed" }
    $iter.exitCode = 51
    $iter.status = "FAIL"
    $failureStreak += 1
    $state.failureStreak = $failureStreak
    $state.lastStatus = $iter.status
    $state.lastExitCode = $iter.exitCode
    $state.lastItem = "n/a"
    $state.lastMission = "n/a"
    $state.lastLogPath = $logPath
    $state.runs += $iter
    Write-State -State $state -Path $logPath
    Write-Shift "FAIL: exit=51 item=n/a log=$logPath"
    Update-ProjectState -Path $projectStatePath -Mission "n/a" -ItemId "n/a" -Status "FAIL" -ExitCode 51 -LogPath $logPath
    break
  }

  $smokeBefore = Invoke-SmokeWithRepair -Root $root -DevProc ([ref]$devProc) -Ports $backendPorts -WebPorts $webPorts -Retries $ReadinessRetries -DelaySec $ReadinessDelaySec -BackendBaseUrl $BackendBaseUrl -WebBaseUrl $WebBaseUrl
  $iter.steps.smokeBefore = $smokeBefore
  if (-not $smokeBefore.ok) {
    $iter.exitCode = $smokeBefore.exitCode
    $iter.status = "FAIL"
    $failureStreak += 1
    $state.failureStreak = $failureStreak
    $state.lastStatus = $iter.status
    $state.lastExitCode = $iter.exitCode
    $state.lastItem = "n/a"
    $state.lastMission = "n/a"
    $state.lastLogPath = $logPath
    $state.runs += $iter
    Write-State -State $state -Path $logPath
    Write-Shift "FAIL: exit=$($smokeBefore.exitCode) item=n/a log=$logPath"
    Update-ProjectState -Path $projectStatePath -Mission "n/a" -ItemId "n/a" -Status "FAIL" -ExitCode $smokeBefore.exitCode -LogPath $logPath
    break
  }

  $work = Read-WorkFile -Path $workPath
  $next = Get-NextWorkItem -Work $work
  if (-not $next) {
    $iter.status = "PASS"
    $iter.exitCode = 0
    $state.lastStatus = $iter.status
    $state.lastExitCode = $iter.exitCode
    $state.lastItem = "ALL DONE"
    $state.lastMission = "n/a"
    $state.lastLogPath = $logPath
    $state.runs += $iter
    Write-State -State $state -Path $logPath
    Write-Shift "ALL DONE: exit=0 item=n/a log=$logPath"
    Update-ProjectState -Path $projectStatePath -Mission "n/a" -ItemId "ALL DONE" -Status "PASS" -ExitCode 0 -LogPath $logPath
    break
  }

  $workResult = Execute-WorkItem -Item $next -Work $work -WorkPath $workPath
  $iter.steps.work = $workResult

  $smokeAfter = Invoke-SmokeWithRepair -Root $root -DevProc ([ref]$devProc) -Ports $backendPorts -WebPorts $webPorts -Retries $ReadinessRetries -DelaySec $ReadinessDelaySec -BackendBaseUrl $BackendBaseUrl -WebBaseUrl $WebBaseUrl
  $iter.steps.smokeAfter = $smokeAfter

  $cycleOk = ($smokeAfter.ok -and $workResult.ok)
  $hardFail = -not $smokeAfter.ok
  $iter.exitCode = if ($cycleOk) { 0 } else { if (-not $workResult.ok) { $workResult.exitCode } else { $smokeAfter.exitCode } }
  $iter.status = if ($cycleOk) { "PASS" } else { "FAIL" }
  $iter.durationMs = [int]((Get-Date) - $iterStart).TotalMilliseconds
  $state.runs += $iter

  if ($cycleOk) {
    $failureStreak = 0
  } else {
    $failureStreak += 1
  }
  $state.failureStreak = $failureStreak
  $state.lastStatus = $iter.status
  $state.lastExitCode = $iter.exitCode
  $state.lastItem = $workResult.itemId
  $state.lastMission = $workResult.mission
  $state.lastLogPath = $logPath
  Write-State -State $state -Path $logPath
  Write-Shift "$($iter.status): exit=$($iter.exitCode) item=$($workResult.itemId) log=$logPath"
  Update-ProjectState -Path $projectStatePath -Mission $workResult.mission -ItemId $workResult.itemId -Status $iter.status -ExitCode $iter.exitCode -LogPath $logPath

  if ($failureStreak -ge 2) {
    Write-Shift "Stopping after repeated failures"
    break
  }

  if ($Once) {
    break
  }

  if ($hardFail) {
    break
  }

  Start-Sleep -Seconds $DelaySec
}

Write-Shift "Logs saved: $logPath"
exit 0
} finally {
  if ($lockAcquired) {
    Release-Lock -Path $lockPath
  }
}
