$ErrorActionPreference = "Stop"
param(
  [Parameter(Mandatory=$true)][string]$NodeId,
  [Parameter(Mandatory=$true)][int]$Port,
  [Parameter(Mandatory=$true)][string]$DataDir,
  [string]$CoordinatorUrl = "http://127.0.0.1:9000"
)

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
  Write-Host "Virtualenv not found. Run: python -m venv .venv" -ForegroundColor Yellow
}

$env:PYTHONPATH = (Get-Location).Path
$env:DFS_NODE_ID = $NodeId
$env:DFS_NODE_PORT = "$Port"
$env:DFS_NODE_BASE_URL = "http://127.0.0.1:$Port"
$env:DFS_NODE_DATA_DIR = $DataDir
$env:DFS_COORDINATOR_URL = $CoordinatorUrl

.\.venv\Scripts\python.exe -m uvicorn node.app:app --host 127.0.0.1 --port $Port

