param([int]$ScanSeconds = 2, [string]$RepoRoot = "")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-PortalRoot {
  param([string]$RepoRoot = "")
  if ($RepoRoot -and (Test-Path $RepoRoot)) { return (Resolve-Path $RepoRoot).Path }
  if ($PSScriptRoot) {
    $try = Join-Path $PSScriptRoot ".."
    if (Test-Path (Join-Path $try "ops")) { return (Resolve-Path $try).Path }
  }
  $cur = (Resolve-Path (Get-Location)).Path
  while ($true) {
    if (Test-Path (Join-Path $cur "ops")) { return $cur }
    $parent = Split-Path $cur -Parent
    if (-not $parent -or $parent -eq $cur) { break }
    $cur = $parent
  }
  throw "Cannot resolve repo root. cd into portal-global or pass -RepoRoot."
}

$Root = Resolve-PortalRoot -RepoRoot $RepoRoot
$Tmp  = Join-Path $Root "ops\tmp"
$Logs = Join-Path $Root "ops\logs"
$QueueDir = Join-Path $Root "ops\queue"
New-Item -ItemType Directory -Force -Path $Tmp, $Logs, $QueueDir | Out-Null

$SeenFile = Join-Path $Tmp "oc-supervisor-seen.json"
$Seen = @{}
if (Test-Path $SeenFile) {
  try { $Seen = (Get-Content $SeenFile -Raw | ConvertFrom-Json) } catch { $Seen = @{} }
}
function Save-Seen { ($Seen | ConvertTo-Json -Depth 10) | Set-Content -Path $SeenFile -Encoding UTF8 }

function Enqueue-FixTask {
  param([string]$SourceLog, [string]$ErrorLine)
  $id = [Guid]::NewGuid().ToString("n")
  $taskPath = Join-Path $QueueDir ("fix-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-$id.json")
  $task = @{
    id = $id
    created = (Get-Date).ToString("o")
    sourceLog = $SourceLog
    errorLine = $ErrorLine
    status = "queued"
    action = "autofix_or_opencode"
    notes = "Detected error. Will run fixer when all workers finished."
  }
  ($task | ConvertTo-Json -Depth 10) | Set-Content -Path $taskPath -Encoding UTF8
  Write-Host "[QUEUED] $taskPath" -ForegroundColor Yellow
}

function Any-Locks {
  $locks = Get-ChildItem -Path $Tmp -Filter "oc-lock-*.lock" -ErrorAction SilentlyContinue
  return ($locks.Count -gt 0)
}

$ErrorPatterns = @(
  "npm ERR!",
  "ERESOLVE",
  "ELSPROBLEMS",
  "EADDRINUSE",
  "Access is denied",
  "Отказано в доступе",
  "UnhandledPromiseRejection",
  "TypeError:",
  "ReferenceError:",
  "Cannot find path",
  "Не удается найти путь",
  "Process exited with code",
  "Exit code"
)

Write-Host "=== OC SUPERVISOR STARTED ===" -ForegroundColor Cyan
Write-Host "ROOT : $Root"
Write-Host "Logs : $Logs"
Write-Host "Tmp  : $Tmp"
Write-Host "Queue: $QueueDir"
Write-Host ""

while ($true) {
  $logFiles = Get-ChildItem -Path $Logs -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime
  foreach ($lf in $logFiles) {
    $key = $lf.FullName
    if (-not $Seen.ContainsKey($key)) { $Seen[$key] = 0 }

    $lines = Get-Content -Path $lf.FullName -ErrorAction SilentlyContinue
    $start = [int]$Seen[$key]
    if ($start -lt 0) { $start = 0 }
    if ($start -ge $lines.Count) { continue }

    $newLines = $lines[$start..($lines.Count-1)]
    $Seen[$key] = $lines.Count

    foreach ($line in $newLines) {
      foreach ($pat in $ErrorPatterns) {
        if ($line -match [Regex]::Escape($pat)) {
          Enqueue-FixTask -SourceLog $lf.FullName -ErrorLine $line
          break
        }
      }
    }
  }

  Save-Seen
$queue = @(Get-ChildItem -Path $QueueDir -Filter "fix-*.json" -ErrorAction SilentlyContinue)
  if (($queue.Count -gt 0) -and (-not (Any-Locks))) {
    Write-Host "`n[SUPERVISOR] Workers finished. Launching fixer..." -ForegroundColor Green
    $fixer = Join-Path $Root "ops\oc-fixer.ps1"
    Start-Process pwsh -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$fixer,"-RepoRoot",$Root) | Out-Null
  }

  Start-Sleep -Seconds $ScanSeconds
}


