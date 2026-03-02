$ErrorActionPreference = "Stop"

# Robust ROOT detection (works in file mode)
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LOGS = Join-Path $ROOT "logs"
New-Item -ItemType Directory -Force -Path $LOGS | Out-Null

function Start-WTWindow {
  param(
    [string]$Title,
    [string]$Cmd,
    [string]$Cwd = $ROOT
  )
  $escaped = $Cmd.Replace('"','\"')

  if (Get-Command wt -ErrorAction SilentlyContinue) {
    wt -w 0 new-tab --title $Title --startingDirectory $Cwd pwsh -NoProfile -ExecutionPolicy Bypass -Command $escaped | Out-Null
  } else {
    Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-Command", $Cmd) -WorkingDirectory $Cwd | Out-Null
  }
}

$devScript = @"
`$ErrorActionPreference='Continue'
cd '$ROOT'
`$log = Join-Path '$LOGS' ('dev-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
'=== DEV WATCHDOG START ' + (Get-Date) + ' ===' | Tee-Object -FilePath `$log -Append

while (`$true) {
  try {
    '--- starting: npm run dev ' + (Get-Date) | Tee-Object -FilePath `$log -Append
    cmd /c "npm run dev" 2>&1 | Tee-Object -FilePath `$log -Append
    '!!! dev exited, restarting in 5s: ' + (Get-Date) | Tee-Object -FilePath `$log -Append
    Start-Sleep -Seconds 5
  } catch {
    '!!! watchdog error: ' + `$_ | Tee-Object -FilePath `$log -Append
    Start-Sleep -Seconds 5
  }
}
"@

$healthScript = @"
`$ErrorActionPreference='Continue'
cd '$ROOT'
`$log = Join-Path '$LOGS' ('health-' + (Get-Date -Format 'yyyyMMdd') + '.log')
'=== HEALTH LOOP START ' + (Get-Date) + ' ===' | Tee-Object -FilePath `$log -Append

while (`$true) {
  try {
    '--- health: ' + (Get-Date) | Tee-Object -FilePath `$log -Append
    cmd /c "npm run health" 2>&1 | Tee-Object -FilePath `$log -Append
  } catch {
    '!!! health error: ' + `$_ | Tee-Object -FilePath `$log -Append
  }
  Start-Sleep -Seconds 30
}
"@

$openCodeScript = @"
`$ErrorActionPreference='Continue'
cd '$ROOT'
`$log = Join-Path '$LOGS' ('opencode-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
'=== OPCODE RUN START ' + (Get-Date) + ' ===' | Tee-Object -FilePath `$log -Append

while (`$true) {
  try {
    '--- starting: opencode . ' + (Get-Date) | Tee-Object -FilePath `$log -Append
    cmd /c "opencode ." 2>&1 | Tee-Object -FilePath `$log -Append
    '!!! opencode exited, restarting in 10s: ' + (Get-Date) | Tee-Object -FilePath `$log -Append
    Start-Sleep -Seconds 10
  } catch {
    '!!! opencode runner error: ' + `$_ | Tee-Object -FilePath `$log -Append
    Start-Sleep -Seconds 10
  }
}
"@

Start-WTWindow -Title "PORTAL DEV (watchdog)" -Cmd $devScript
Start-WTWindow -Title "PORTAL HEALTH (loop)" -Cmd $healthScript
Start-WTWindow -Title "OpenCode (auto-restart)" -Cmd $openCodeScript

Write-Host "Mission Control started." -ForegroundColor Green
Write-Host ("Logs folder: " + $LOGS) -ForegroundColor Cyan
