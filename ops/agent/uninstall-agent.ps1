param(
  [string]$AppDir = "$env:APPDATA\portal-global"
)

$ErrorActionPreference = "Stop"

$pidPath = Join-Path $AppDir "agent.pid"
if (Test-Path $pidPath) {
  $pid = Get-Content $pidPath | Select-Object -First 1
  if ($pid -match "^\d+$") {
    try {
      Stop-Process -Id $pid -Force
    } catch {
      # ignore missing process
    }
  }
  Remove-Item $pidPath -Force
}

$files = @(
  "agent.js",
  "agent-config.json",
  "agent.log"
)

foreach ($file in $files) {
  $target = Join-Path $AppDir $file
  if (Test-Path $target) {
    Remove-Item $target -Force
  }
}

Write-Host "Agent removed from $AppDir"
