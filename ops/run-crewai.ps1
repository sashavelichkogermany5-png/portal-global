$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $PSScriptRoot
$SVC = Join-Path $ROOT "services\crew-runner"

Write-Host "Starting Crew Runner in $SVC"

if (-not (Test-Path $SVC)) { throw "Missing folder: $SVC" }

Push-Location $SVC
try {
  if (-not (Test-Path ".venv")) { python -m venv .venv }
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt

  if (-not $env:CREWAI_API_KEY) { $env:CREWAI_API_KEY = "dev" }

  .\.venv\Scripts\python.exe -m uvicorn app:app --host 0.0.0.0 --port 5055
} finally {
  Pop-Location
}
