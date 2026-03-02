# =====================================================================================
# PORTAL GLOBAL - "LV NOTEBOOK PACK" ONE-SHOT (for OpenCode)
# Creates/updates: docs\LV-PACK.generated.md
# Optional sync to Google Drive if rclone is installed + remote configured (no bypasses/extra accounts).
#
# RUN:
#   cd C:\Users\user\portal-global
#   pwsh -NoProfile -ExecutionPolicy Bypass -File ops\lv-pack.ps1
# =====================================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"


# --- defaults (Scheduled Task / no profile safe) ---
if (-not $env:LV_RCLONE_REMOTE) { $env:LV_RCLONE_REMOTE = "gdrive" }  # default
if (-not $env:LV_RCLONE_DIR)    { $env:LV_RCLONE_DIR    = "PORTAL-LV" } # default

function Find-RepoRoot {
  param([string]$Start = (Get-Location).Path)
  $p = Resolve-Path $Start
  while ($true) {
    if ((Test-Path (Join-Path $p "package.json")) -and (Test-Path (Join-Path $p "server.js"))) { return $p }
    $parent = Split-Path $p -Parent
    if ($parent -eq $p -or [string]::IsNullOrWhiteSpace($parent)) { break }
    $p = $parent
  }
# --- robust repo root (works even when launched from System32 / Scheduled Task) ---
$RepoRoot = $null

# 1) explicit override
if ($env:LV_REPO_ROOT -and (Test-Path (Join-Path $env:LV_REPO_ROOT "package.json")) -and (Test-Path (Join-Path $env:LV_REPO_ROOT "server.js"))) {
  $RepoRoot = $env:LV_REPO_ROOT
}

# 2) derive from script location: <repo>\ops\lv-pack.ps1 -> <repo>
if (-not $RepoRoot -and $PSScriptRoot) {
  $candidate = Resolve-Path (Join-Path $PSScriptRoot "..") -ErrorAction SilentlyContinue
  if ($candidate -and (Test-Path (Join-Path $candidate.Path "package.json")) -and (Test-Path (Join-Path $candidate.Path "server.js"))) {
    $RepoRoot = $candidate.Path
  }
}

# 3) final fallback: walk upwards from current dir
if (-not $RepoRoot) {
  $d = (Get-Location).Path
  while ($d -and $d -ne [IO.Path]::GetPathRoot($d)) {
    if ((Test-Path (Join-Path $d "package.json")) -and (Test-Path (Join-Path $d "server.js"))) { $RepoRoot = $d; break }
    $d = Split-Path -Parent $d
  }
}

if (-not $RepoRoot) { throw "Repo root not found. Set LV_REPO_ROOT or run inside portal-global." }
# --- end repo root ---
}

function Read-TextSafe {
  param([string]$Path, [int]$MaxChars = 40000)
  if (!(Test-Path $Path)) { return $null }
  $txt = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
  if ($txt.Length -gt $MaxChars) { return $txt.Substring(0, $MaxChars) + "`n...[TRUNCATED]..." }
  return $txt
}

function Tree-Dirs {
  param([string]$Root, [int]$Depth = 4)
  $exclude = @("node_modules",".git",".next","dist","build","out",".turbo",".cache",".venv")
  $lines = New-Object System.Collections.Generic.List[string]
  $rootItem = Get-Item -LiteralPath $Root
  $lines.Add($rootItem.Name + "\")
  function Recurse([string]$Path,[int]$Level) {
    if ($Level -gt $Depth) { return }
    $dirs = Get-ChildItem -LiteralPath $Path -Directory -ErrorAction SilentlyContinue |
      Where-Object { $exclude -notcontains $_.Name } |
      Sort-Object Name
    foreach ($d in $dirs) {
      $indent = ("  " * $Level)
      $lines.Add("$indent$d\")
      Recurse $d.FullName ($Level + 1)
    }
  }
  Recurse $Root 1
  return ($lines -join "`n")
}

function Extract-RoutesApprox {
  param([string]$FilePath)
  $txt = Read-TextSafe -Path $FilePath -MaxChars 120000
  if ($null -eq $txt) { return $null }
  $lines = $txt -split "`r?`n"
  $hits = New-Object System.Collections.Generic.List[string]
  foreach ($l in $lines) {
    # crude but useful: app.get('/x'), app.post("/x"), router.get('/x'), etc.
    if ($l -match '\b(app|router)\.(get|post|put|patch|delete)\s*\(\s*["' + "'" + '](\/[^"' + "'" + ']+)["' + "'" + ']') {
      $method = $Matches[2].ToUpperInvariant()
      $path = $Matches[3]
      $clean = ($l.Trim() -replace '\s+',' ')
      $hits.Add(("{0} {1}    {2}" -f $method,$path,$clean))
    }
  }
  if ($hits.Count -eq 0) { return "No obvious route patterns found in $FilePath (or file is too different)." }
  return ($hits | Select-Object -Unique)
}

function Get-NodeListeners {
  # Best effort: Windows only. Shows ports currently listened by node.exe (if any).
  try {
    $nodePids = (Get-Process node -ErrorAction SilentlyContinue).Id
    if (!$nodePids) { return "node.exe not running (no listeners to report)." }
    $conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $nodePids -contains $_.OwningProcess } |
      Sort-Object LocalPort
    if (!$conns) { return "node.exe running, but no LISTEN connections found." }
    $rows = $conns | ForEach-Object {
      "{0,6}  {1,-15}  pid:{2}" -f $_.LocalPort,$_.LocalAddress,$_.OwningProcess
    }
    return ($rows -join "`n")
  } catch {
    return "Listeners check unavailable: $($_.Exception.Message)"
  }
}

function Make-LVPack {
  param([string]$RepoRoot)

  $docsDir = Join-Path $RepoRoot "docs"
  if (!(Test-Path $docsDir)) { New-Item -ItemType Directory -Path $docsDir | Out-Null }

  $outPath = Join-Path $docsDir "LV-PACK.generated.md"
  $now = Get-Date

  $readme = Read-TextSafe (Join-Path $RepoRoot "README.md") 60000
  $projState = Read-TextSafe (Join-Path $docsDir "PROJECT-STATE.md") 80000
  $curState = Read-TextSafe (Join-Path $docsDir "CURRENT-STATE.generated.md") 120000
  $envEx = Read-TextSafe (Join-Path $RepoRoot ".env.example") 60000
  $pkg = Read-TextSafe (Join-Path $RepoRoot "package.json") 60000

  $serverJs = Join-Path $RepoRoot "server.js"
  $autoRoutes = Join-Path $RepoRoot "backend\autopilot\routes.js"
  $routesServer = Extract-RoutesApprox $serverJs
  $routesAuto = Extract-RoutesApprox $autoRoutes

  $tree = Tree-Dirs -Root $RepoRoot -Depth 4
  $listeners = Get-NodeListeners

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# PORTAL GLOBAL - LV PACK (generated)")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("- Generated: **$($now.ToString('yyyy-MM-dd HH:mm:ss'))**")
  [void]$sb.AppendLine("- Repo root: $RepoRoot")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("## What this file is")
  [void]$sb.AppendLine("This is the single **canonical pack** to drop into NotebookLM (Notebook: **LV**) so it can answer *strictly based on sources*.")
  [void]$sb.AppendLine("If something is missing, add it to docs/ and regenerate this pack.")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("## Quick commands")
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine("cd $RepoRoot")
  [void]$sb.AppendLine("pwsh -NoProfile -ExecutionPolicy Bypass -File ops\\lv-pack.ps1")
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## Repo directory tree (dirs only, depth 4)")
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine($tree)
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## Live node listeners (best effort)")
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine($listeners)
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## package.json (truncated)")
  if ($pkg) {
    [void]$sb.AppendLine('```json')
    [void]$sb.AppendLine($pkg)
    [void]$sb.AppendLine('```')
  } else {
    [void]$sb.AppendLine("_Missing package.json_")
  }
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## .env.example (truncated)")
  if ($envEx) {
    [void]$sb.AppendLine('```')
    [void]$sb.AppendLine($envEx)
    [void]$sb.AppendLine('```')
  } else {
    [void]$sb.AppendLine("_No .env.example found (TODO: add one)._ ")
  }
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## README (truncated)")
  if ($readme) {
    [void]$sb.AppendLine('```md')
    [void]$sb.AppendLine($readme)
    [void]$sb.AppendLine('```')
  } else {
    [void]$sb.AppendLine("_No README.md found (TODO: add minimal README)._ ")
  }
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## docs/PROJECT-STATE.md (truncated)")
  if ($projState) {
    [void]$sb.AppendLine('```md')
    [void]$sb.AppendLine($projState)
    [void]$sb.AppendLine('```')
  } else {
    [void]$sb.AppendLine("_Missing docs/PROJECT-STATE.md_")
  }
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## docs/CURRENT-STATE.generated.md (truncated)")
  if ($curState) {
    [void]$sb.AppendLine('```md')
    [void]$sb.AppendLine($curState)
    [void]$sb.AppendLine('```')
  } else {
    [void]$sb.AppendLine("_Missing docs/CURRENT-STATE.generated.md (TODO: generate it)._ ")
  }
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## Approx extracted routes: server.js")
  [void]$sb.AppendLine('```')
  if ($routesServer -is [string]) { [void]$sb.AppendLine($routesServer) } else { [void]$sb.AppendLine(($routesServer -join "`n")) }
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## Approx extracted routes: backend/autopilot/routes.js")
  [void]$sb.AppendLine('```')
  if ($routesAuto -is [string]) { [void]$sb.AppendLine($routesAuto) } else { [void]$sb.AppendLine(($routesAuto -join "`n")) }
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine("")

  [void]$sb.AppendLine("## Known issues (TODO list for NotebookLM + OpenCode)")
  [void]$sb.AppendLine("- [ ] Too Many Requests on `/api/auth/me` (request storm / rate limit) - document root cause + fix.")
  [void]$sb.AppendLine("- [ ] Tenant Unknown / session missing / role guest / auth cookie+b bearer - document expected auth flow.")
  [void]$sb.AppendLine("- [ ] Health Offline/Not Found / Ports detected - document what health means per service.")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("## Community mode (safe defaults)")
  [void]$sb.AppendLine("- Default **read-only** for anonymous users (no writes, no autopilot).")
  [void]$sb.AppendLine("- Rate limit: per-IP, protect `/api/auth/*` and any expensive endpoints.")
  [void]$sb.AppendLine("- Require auth + role for admin panels and autopilot actions.")
  [void]$sb.AppendLine("- Add basic observability: request IDs + audit log for auth + errors.")
  [void]$sb.AppendLine("")

  $content = $sb.ToString()
  Set-Content -LiteralPath $outPath -Value $content -Encoding UTF8
  return $outPath
}

function Try-RcloneSync {
  param([string]$RepoRoot, [string]$FilePath)

  $rclone = Get-Command rclone -ErrorAction SilentlyContinue
  if (!$rclone) {
    Write-Host "[sync] rclone not found. Skipping Google Drive sync." -ForegroundColor Yellow
    Write-Host "[sync] If you want sync: install rclone and configure a Drive remote, then set LV_RCLONE_REMOTE and LV_RCLONE_DIR." -ForegroundColor Yellow
    return
  }

  $remote = $env:LV_RCLONE_REMOTE
  $dir = $env:LV_RCLONE_DIR
  if ([string]::IsNullOrWhiteSpace($remote) -or [string]::IsNullOrWhiteSpace($dir)) {
    Write-Host "[sync] rclone found, but LV_RCLONE_REMOTE or LV_RCLONE_DIR is not set. Skipping." -ForegroundColor Yellow
    Write-Host "       Example (PowerShell):" -ForegroundColor Yellow
    Write-Host '       $env:LV_RCLONE_REMOTE="gdrive"' -ForegroundColor Yellow
    Write-Host '       $env:LV_RCLONE_DIR="PORTAL-LV"' -ForegroundColor Yellow
    return
  }

  $target = "$remote`:$dir/sources"
  Write-Host "[sync] Uploading pack to $target ..." -ForegroundColor Cyan
  $dest = "$target/" + (Split-Path -Leaf $FilePath)
  & rclone copyto --checksum --transfers 1 --tpslimit 2 --tpslimit-burst 2 --retries 10 --low-level-retries 20 --check-first --drive-import-formats txt --drive-allow-import-name-change $FilePath $dest | Out-Host
  $dest = "$target/" + (Split-Path -Leaf $FilePath)
  $dest = "$target/" + (Split-Path -Leaf $FilePath)
  & rclone copyto --checksum --transfers 1 --tpslimit 2 --tpslimit-burst 2 --retries 10 --low-level-retries 20 --check-first --drive-import-formats txt --drive-allow-import-name-change $FilePath $dest | Out-Host
  Write-Host "[sync] Done. In NotebookLM LV add/refresh this file from Drive: $dir/$(Split-Path $FilePath -Leaf)" -ForegroundColor Green
}

# ---------------- MAIN ----------------
$RepoRoot = Find-RepoRoot
$opsDir = Join-Path $RepoRoot "ops"
if (!(Test-Path $opsDir)) { New-Item -ItemType Directory -Path $opsDir | Out-Null }

# If script is run not from ops\lv-pack.ps1 but pasted, still works:
$out = Make-LVPack -RepoRoot $RepoRoot
Write-Host "[ok] Generated: $out" -ForegroundColor Green

# Optional sync (legal) via rclone if you have it configured.
# No limit bypass / no extra accounts automation.
Try-RcloneSync -RepoRoot $RepoRoot -FilePath $out

Write-Host ""
Write-Host "Next step (NotebookLM):" -ForegroundColor Cyan
Write-Host "  1) Open NotebookLM -> Notebook 'LV'" -ForegroundColor Cyan
Write-Host "  2) Add/Refresh source: docs/LV-PACK.generated.md (preferably from Google Drive)" -ForegroundColor Cyan
Write-Host "  3) Ask: 'Generate CURRENT STATE and a hotfix plan based on sources'" -ForegroundColor Cyan






# --- LV-PACK.generated.txt autogen (NotebookLM) ---
try {
  $DocsDir2 = Join-Path $RepoRoot "docs"
  $Md2  = Join-Path $DocsDir2 "LV-PACK.generated.md"
  $Txt2 = Join-Path $DocsDir2 "LV-PACK.generated.txt"
  if (Test-Path $Md2) {
    Copy-Item -LiteralPath $Md2 -Destination $Txt2 -Force
    Write-Host "[ok] Generated: $Txt2" -ForegroundColor Green
  }
} catch {
  Write-Host "[warn] TXT autogen failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
# --- end txt autogen ---

