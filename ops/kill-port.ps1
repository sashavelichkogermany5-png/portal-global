param([Parameter(Mandatory=$true)][int]$Port)

$ErrorActionPreference = "SilentlyContinue"
Write-Host "Killing LISTENING processes on port $Port ..."

$lines = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"
if (-not $lines) { Write-Host "No LISTENING process found on port $Port"; exit 0 }

$pids = @()
foreach ($l in $lines) {
  $parts = ($l.ToString() -split "\s+") | Where-Object { $_ -ne "" }
  $pid = $parts[-1]
  if ($pid -match "^\d+$") { $pids += [int]$pid }
}
$pids = $pids | Sort-Object -Unique

foreach ($pid in $pids) {
  try {
    $p = Get-Process -Id $pid -ErrorAction Stop
    Write-Host "Stopping PID $pid ($($p.ProcessName))"
    Stop-Process -Id $pid -Force
  } catch {
    Write-Host "Failed to stop PID $pid (try running PowerShell as Admin)."
  }
}
