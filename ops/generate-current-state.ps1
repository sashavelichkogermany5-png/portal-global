#requires -Version 5.1
Set-StrictMode -Off
$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) { Write-Host "[state] $msg" -ForegroundColor Cyan }

function Find-RepoRoot([string]$StartDir) {
  $dir = (Resolve-Path -LiteralPath $StartDir).Path
  while ($true) {
    if ((Test-Path -LiteralPath (Join-Path $dir "package.json")) -and
        (Test-Path -LiteralPath (Join-Path $dir "ops")) -and
        (Test-Path -LiteralPath (Join-Path $dir "server.js"))) {
      return $dir
    }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  throw "Repo root not found from: $StartDir"
}

function Ensure-Dir([string]$Dir) {
  if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
}

function Get-DirsTree([string]$Root, [int]$MaxDepth) {
  $exclude = @("node_modules", ".git", ".next", "dist", "build", "out", ".turbo", ".cache")
  $results = New-Object System.Collections.Generic.List[string]

  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue(@{ Path = $Root; Depth = 0 })

  while ($queue.Count -gt 0) {
    $cur = $queue.Dequeue()
    $path = [string]$cur.Path
    $depth = [int]$cur.Depth
    if ($depth -ge $MaxDepth) { continue }

    $children = @()
    try { $children = Get-ChildItem -LiteralPath $path -Directory -ErrorAction SilentlyContinue } catch { $children = @() }

    $children = $children |
      Where-Object { $exclude -notcontains $_.Name } |
      Sort-Object FullName

    foreach ($c in $children) {
      $rel = $c.FullName.Substring($Root.Length).TrimStart("\","/")
      $indent = ("  " * ($depth + 1))
      $results.Add(("{0}- {1}" -f $indent, $rel))
      $queue.Enqueue(@{ Path = $c.FullName; Depth = ($depth + 1) })
    }
  }

  return $results
}

function Get-ExpressRoutesFromFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return @("TODO: file not found: $Path") }
  $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop

  $patterns = @(
    '(?m)^\s*(app|router)\.(get|post|put|delete|patch|all|use)\s*\(\s*([`"\047])([^`"\047]+)\3',
    '(?m)^\s*(app|router)\.(get|post|put|delete|patch|all|use)\s*\(\s*([^,]+)\s*,'
  )

  $hits = New-Object System.Collections.Generic.List[string]
  foreach ($p in $patterns) {
    $ms = [regex]::Matches($raw, $p)
    foreach ($m in $ms) {
      $method = $m.Groups[2].Value.ToUpperInvariant()
      $pathLit = $m.Groups[4].Value
      if ($pathLit) { $hits.Add(("{0} {1}" -f $method, $pathLit)) }
      else { $hits.Add(("{0} <dynamic-path>" -f $method)) }
    }
  }

  $hits = $hits | Where-Object { $_ } | Select-Object -Unique | Sort-Object
  if ($hits.Count -eq 0) { return @("TODO: no routes matched by heuristic parser in: $Path") }
  return $hits
}

$repoRoot = Find-RepoRoot (Get-Location).Path
$docsDir = Join-Path $repoRoot "docs"
Ensure-Dir $docsDir

$outPath = Join-Path $docsDir "CURRENT-STATE.generated.md"
$now = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss K")

$tree = Get-DirsTree $repoRoot 4

$serverJs = Join-Path $repoRoot "server.js"
$autopilotRoutes = Join-Path $repoRoot "backend\autopilot\routes.js"

$serverRoutes = Get-ExpressRoutesFromFile $serverJs
$autopilotRoutesList = Get-ExpressRoutesFromFile $autopilotRoutes

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# CURRENT STATE (generated)")
$lines.Add("")
$lines.Add("> Generated: $now")
$lines.Add("> Do not edit manually. Source of truth: ops/generate-current-state.ps1")
$lines.Add("")

$lines.Add("## Repo overview")
$lines.Add("")
$lines.Add("- Root: `$repoRoot`")
$lines.Add("- Key entrypoints:")
$lines.Add("  - `server.js` (backend)")
$lines.Add("  - `web-next/` (primary UI, if present)")
$lines.Add("  - `backend/pages/` (legacy UI, if present)")
$lines.Add("")

$lines.Add("## Directory tree (dirs only, depth 4)")
$lines.Add("")
$lines.Add("```")
$lines.Add(".")
foreach ($t in $tree) { $lines.Add($t) }
$lines.Add("```")
$lines.Add("")

$lines.Add("## Express routes (heuristic extraction)")
$lines.Add("")
$lines.Add("### server.js")
$lines.Add("")
$lines.Add("```")
foreach ($r in $serverRoutes) { $lines.Add($r) }
$lines.Add("```")
$lines.Add("")

$lines.Add("### backend/autopilot/routes.js")
$lines.Add("")
$lines.Add("```")
foreach ($r in $autopilotRoutesList) { $lines.Add($r) }
$lines.Add("```")
$lines.Add("")

$lines.Add("## TODO / gaps (auto)")
$lines.Add("")
if ($serverRoutes.Count -gt 0 -and ($serverRoutes[0] -like "TODO:*")) { $lines.Add("- " + $serverRoutes[0]) }
if ($autopilotRoutesList.Count -gt 0 -and ($autopilotRoutesList[0] -like "TODO:*")) { $lines.Add("- " + $autopilotRoutesList[0]) }
$lines.Add("- TODO: expand route extraction if modular routers are used beyond server.js/routes.js.")
$lines.Add("- TODO: optionally add DB schema summary (drizzle/sqlite migrations).")
$lines.Add("")

Set-Content -LiteralPath $outPath -Value $lines -Encoding UTF8
Write-Info "Wrote: $outPath"
