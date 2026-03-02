param(
  [string]$Name = "win",
  [string]$Command = "opencode .",
  [string]$RepoRoot = ""
)

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
New-Item -ItemType Directory -Force -Path $Tmp, $Logs | Out-Null

$Lock = Join-Path $Tmp  ("oc-lock-$Name.lock")
$Log  = Join-Path $Logs ("oc-$Name-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

Set-Content -Path $Lock -Value (Get-Date).ToString("o") -Encoding UTF8

$transcribing = $false
try { Start-Transcript -Path $Log -Append | Out-Null; $transcribing = $true } catch { $transcribing = $false }

try {
  Write-Host "=== OC WINDOW: $Name ===" -ForegroundColor Cyan
  Write-Host "ROOT: $Root"
  Write-Host "LOG : $Log"
  Write-Host "LOCK: $Lock"
  Write-Host "CMD : $Command"
  Write-Host ""

  iex $Command
}
catch {
  Write-Host "`n[OC WINDOW ERROR] $($_.Exception.Message)" -ForegroundColor Red
  throw
}
finally {
  if ($transcribing) { try { Stop-Transcript | Out-Null } catch {} }
  Remove-Item -Force -ErrorAction SilentlyContinue $Lock
}
