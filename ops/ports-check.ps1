# ports-check.ps1
# Checks that only PORT 3000 is listening for Node.js processes
# Exit 0 = OK (only 3000)
# Exit 1 = FAIL (other ports found)

param(
    [int]$ExpectedPort = 3000
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PORT CHECK: Only :$ExpectedPort should be open" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$nodeProcs = Get-Process -Name node -ErrorAction SilentlyContinue
if (-not $nodeProcs) {
    Write-Host "[OK] No Node.js processes running" -ForegroundColor Green
    exit 0
}

$foundPorts = @{}
$portRegex = ":(\d+)\s+"

foreach ($proc in $nodeProcs) {
    $netstat = netstat -ano | findstr "LISTENING" | findstr "$($proc.Id)"
    
    foreach ($line in $netstat) {
        if ($line -match $portRegex) {
            $port = [int]$matches[1]
            if ($port -ne $ExpectedPort) {
                $foundPorts[$port] = $proc.Id
            }
        }
    }
}

if ($foundPorts.Count -eq 0) {
    Write-Host "[OK] Only :$ExpectedPort is listening" -ForegroundColor Green
    Write-Host ""
    Write-Host "Node processes found: $($nodeProcs.Count)" -ForegroundColor Gray
    exit 0
} else {
    Write-Host "[FAIL] Unexpected ports found!" -ForegroundColor Red
    Write-Host ""
    foreach ($port in $foundPorts.Keys) {
        $pid = $foundPorts[$port]
        Write-Host "  Port :$port -> PID $pid" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Expected: :$ExpectedPort only" -ForegroundColor Yellow
    Write-Host "Run: pwsh -File ops/kill-ports.ps1" -ForegroundColor Yellow
    exit 1
}
