param([string]$RepoRoot = "")

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
$QueueDir = Join-Path $Root "ops\queue"
$Logs = Join-Path $Root "ops\logs"
New-Item -ItemType Directory -Force -Path $Tmp, $QueueDir, $Logs | Out-Null

function Mark-TaskStatus {
  param([string]$Path, [string]$Status, [string]$Note = "")
  $obj = Get-Content $Path -Raw | ConvertFrom-Json
  $obj.status = $Status
  $obj.updated = (Get-Date).ToString("o")
  if ($Note) { $obj.notes = (($obj.notes + "`n" + $Note).Trim()) }
  ($obj | ConvertTo-Json -Depth 10) | Set-Content -Path $Path -Encoding UTF8
}

function Try-AutoFix {
  param([string]$err)

  if ($err -match "EADDRINUSE|address already in use|LISTENING") {
    Write-Host "[AUTO] Port busy -> kill 3000/5173/3001 via ops/kill-port.ps1" -ForegroundColor Yellow
    $kp = Join-Path $Root "ops\kill-port.ps1"
    if (Test-Path $kp) {
      & pwsh -NoProfile -ExecutionPolicy Bypass -File $kp -Port 3000 -ErrorAction SilentlyContinue
      & pwsh -NoProfile -ExecutionPolicy Bypass -File $kp -Port 5173 -ErrorAction SilentlyContinue
      & pwsh -NoProfile -ExecutionPolicy Bypass -File $kp -Port 3001 -ErrorAction SilentlyContinue
      return $true
    }
    return $false
  }

  if ($err -match "Access is denied|Отказано в доступе") {
    Write-Host "[AUTO] Access denied -> needs admin for kill-port." -ForegroundColor Yellow
    return $false
  }

  if ($err -match "npm ERR!|ERESOLVE|ELSPROBLEMS|Cannot find module") {
    Write-Host "[AUTO] npm error -> npm ci/install in frontend/web-next/root" -ForegroundColor Yellow
    $dirs = @((Join-Path $Root "frontend"), (Join-Path $Root "web-next"), $Root) | Where-Object { Test-Path $_ }
    foreach ($d in $dirs) {
      try {
        Push-Location $d
        if (Test-Path (Join-Path $d "package-lock.json")) { npm ci } else { npm install }
      } catch {
        Write-Host "[AUTO] npm failed in $d : $($_.Exception.Message)" -ForegroundColor DarkYellow
      } finally {
        Pop-Location
      }
    }
    return $true
  }

  if ($err -match "Cannot find path|Не удается найти путь") {
    Write-Host "[AUTO] missing path -> ensure ops/tmp + ops/logs exist" -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path (Join-Path $Root "ops\tmp"), (Join-Path $Root "ops\logs") | Out-Null
    return $true
  }

  return $false
}

Write-Host "=== OC FIXER START ===" -ForegroundColor Cyan
Write-Host "ROOT : $Root"
Write-Host "Queue: $QueueDir"
Write-Host ""

$tasks = Get-ChildItem -Path $QueueDir -Filter "fix-*.json" -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $tasks -or $tasks.Count -eq 0) {
  Write-Host "No tasks." -ForegroundColor DarkGray
  exit 0
}

foreach ($t in $tasks) {
  $obj = Get-Content $t.FullName -Raw | ConvertFrom-Json
  $err = [string]$obj.errorLine

  Write-Host "`n--- TASK: $($obj.id) ---" -ForegroundColor Yellow
  Write-Host "Err : $err"

  Mark-TaskStatus -Path $t.FullName -Status "running" -Note "Fixer started."

  $auto = $false
  try { $auto = Try-AutoFix -err $err } catch { $auto = $false }

  if ($auto) {
    Mark-TaskStatus -Path $t.FullName -Status "auto-fixed" -Note "Applied automatic fix attempt."
    Remove-Item -Force $t.FullName
    Write-Host "[DONE] auto-fixed; task removed." -ForegroundColor Green
    continue
  }

  $promptPath = Join-Path $Tmp ("oc-fix-" + $obj.id + ".txt")
  @"
You are OpenCode. Fix the repo based on this error:
$err

Source log:
$($obj.sourceLog)

Rules:
- Minimal patch, do not break existing flows.
- Update ops scripts if needed.
- After patch: list changed files and how to verify.
"@ | Set-Content -Path $promptPath -Encoding UTF8

  Mark-TaskStatus -Path $t.FullName -Status "needs-opencode" -Note "Prepared prompt: $promptPath"
  Write-Host "[NEEDS OPENCODE] Prompt prepared: $promptPath" -ForegroundColor Magenta
}

Write-Host "`n=== OC FIXER END ===" -ForegroundColor Cyan
