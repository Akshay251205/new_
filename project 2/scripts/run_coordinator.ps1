$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
  Write-Host "Virtualenv not found. Run: python -m venv .venv" -ForegroundColor Yellow
}

$env:PYTHONPATH = (Get-Location).Path
$env:DFS_REPLICATION = $env:DFS_REPLICATION ?? "2"

.\.venv\Scripts\python.exe -m uvicorn coordinator.app:app --host 127.0.0.1 --port 9000

