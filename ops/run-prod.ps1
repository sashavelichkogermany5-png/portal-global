$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "[prod] npm install (root) if needed..."
if (-not (Test-Path .\node_modules)) { npm install }

Write-Host "[prod] start (NODE_ENV=production)..."
$env:NODE_ENV = "production"
npm run start:prod
