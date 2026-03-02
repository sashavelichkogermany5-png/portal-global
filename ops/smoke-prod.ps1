# smoke-prod.ps1
# Smoke test for production readiness
# Exit 0 = PASS, Exit 1 = FAIL

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Continue"
$failCount = 0
$passCount = 0

function Test-Url {
    param(
        [string]$Path,
        [string]$ExpectedStatus,
        [string]$Description
    )
    
    $url = "$BaseUrl$Path"
    $status = 0
    
    try {
        $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
        $status = [int]$response.StatusCode
    } catch {
        $status = 0
    }
    
    if ($status -eq $ExpectedStatus) {
        Write-Host "[PASS] $Description" -ForegroundColor Green
        Write-Host "       $url -> $status" -ForegroundColor Gray
        return $true
    } else {
        Write-Host "[FAIL] $Description" -ForegroundColor Red
        Write-Host "       $url -> Expected $ExpectedStatus, got $status" -ForegroundColor Red
        return $false
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SMOKE TEST: Production Readiness" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check port only
Write-Host "--- Port Check ---" -ForegroundColor Yellow
& pwsh -File ops/ports-check.ps1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Port check failed" -ForegroundColor Red
    exit 1
}
$passCount++
Write-Host ""

# HTTP endpoint tests
Write-Host "--- HTTP Endpoints ---" -ForegroundColor Yellow

if (Test-Url "/" "200" "Landing page") { $passCount } else { $failCount++ }
if (Test-Url "/login" "200" "Login page") { $passCount } else { $failCount++ }
if (Test-Url "/app" "302" "App redirects (not authed)") { $passCount } else { $failCount++ }
if (Test-Url "/api/health" "200" "Health endpoint") { $passCount } else { $failCount++ }
if (Test-Url "/api/anything" "401" "Protected API returns 401") { $passCount } else { $failCount++ }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed: $passCount" -ForegroundColor Green
Write-Host "Failed: $failCount" -ForegroundColor Red
Write-Host ""

if ($failCount -eq 0) {
    Write-Host "SMOKE TEST: PASS" -ForegroundColor Green
    exit 0
} else {
    Write-Host "SMOKE TEST: FAIL" -ForegroundColor Red
    exit 1
}
