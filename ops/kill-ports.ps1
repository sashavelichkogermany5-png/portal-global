param(
  [int[]]$Ports = @(3001, 3003, 3004)
)

foreach ($port in $Ports) {
  $lines = netstat -ano | findstr ":$port" | findstr "LISTENING"
  if (-not $lines) { 
    Write-Host "Port $port - not in use" -ForegroundColor Gray
    continue 
  }

  $pidList = @()
  foreach ($l in $lines) {
    $parts = ($l -split "\s+") | Where-Object { $_ -ne "" }
    $procId = $parts[-1]
    if ($procId -match "^\d+$") { $pidList += [int]$procId }
  }

  $pidList = $pidList | Select-Object -Unique
  foreach ($procId in $pidList) {
    Write-Host "Killing port $port -> PID $procId" -ForegroundColor Yellow
    try { 
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "  Killed PID $procId" -ForegroundColor Green
    } catch {
      Write-Host "  Failed to kill PID $procId" -ForegroundColor Red
    }
  }
}

Write-Host "`nDone." -ForegroundColor Cyan
