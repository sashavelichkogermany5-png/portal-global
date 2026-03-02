Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = "C:\Users\user\portal-global"
$logDir = Join-Path $repo "ops\tmp"
$log = Join-Path $logDir "lv-pack-upload.log"
$lock = Join-Path $logDir "lv-pack.lock"

if (!(Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Get-Stamp {
  return (Get-Date -Format "dd.MM.yyyy  H:mm:ss,ff")
}

function Write-Log {
  param([string]$Message)
  Add-Content -LiteralPath $log -Value $Message
}

if (Test-Path $lock) {
  Write-Log ("=== {0} SKIP (lock exists) ===" -f (Get-Stamp))
  exit 0
}

Set-Content -LiteralPath $lock -Value "lock"

$rc = 0
$rc2 = 0

Write-Log ("=== {0} START ===" -f (Get-Stamp))

try {
  $env:PATH = (Join-Path $repo "ops\bin") + ";" + $env:PATH
  $env:RCLONE_CONFIG = "C:\Users\user\AppData\Roaming\rclone\rclone.conf"
  $rcloneExe = Join-Path $repo "ops\bin\rclone.exe"
  $txtPath = Join-Path $repo "docs\LV-PACK.generated.txt"

  Push-Location $repo
  try {
    $cmd = 'pwsh -NoProfile -ExecutionPolicy Bypass -File "ops\lv-pack.ps1"'
    $cmdLine = '{0} >> "{1}" 2>&1' -f $cmd, $log
    cmd /c $cmdLine
    $rc = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if (Test-Path $rcloneExe) {
    $rcloneCmd = '"{0}" copyto "{1}" "gdrive:PORTAL-LV/sources/LV-PACK.generated.txt" --transfers 1 --tpslimit 2 --tpslimit-burst 2 --retries 10 --low-level-retries 20' -f $rcloneExe, $txtPath
    $rcloneCmdLine = '{0} >> "{1}" 2>&1' -f $rcloneCmd, $log
    cmd /c $rcloneCmdLine
    $rc2 = $LASTEXITCODE
  } else {
    $rc2 = 9009
    Write-Log ("rclone.exe not found at {0}" -f $rcloneExe)
  }
} catch {
  $rc2 = 1
  Write-Log ("ERROR: {0}" -f $_.Exception.Message)
} finally {
  Write-Log ("=== {0} END rc={1} rc2={2} ===" -f (Get-Stamp), $rc, $rc2)
  Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}

exit $rc2
