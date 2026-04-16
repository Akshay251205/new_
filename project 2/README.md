## Distributed File System (Basic) — Fault Tolerant (Replication)

This is a **very basic university-level distributed file system** you can run locally on one PC.

- **Coordinator**: stores metadata (SQLite), serves the **web UI**, handles uploads/downloads, tracks node health, and re-replicates data on failures.
- **Storage Nodes**: store file chunks on disk and send heartbeats to the coordinator.
- **Fault tolerance**: replication (default \(N=2\)), checksum verification, background repair (re-replication).

### Requirements
- Python 3.10+

### Setup

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### Run (recommended)

Open **3 terminals** in this folder.

Terminal 1 (Coordinator):

```powershell
.\scripts\run_coordinator.ps1
```

Terminal 2 (Node A):

```powershell
.\scripts\run_node.ps1 -NodeId node-a -Port 9101 -DataDir .\data\node-a
```

Terminal 3 (Node B):

```powershell
.\scripts\run_node.ps1 -NodeId node-b -Port 9102 -DataDir .\data\node-b
```

Then open the UI:
- `http://127.0.0.1:9000/`

### Demo: fault tolerance (basic)
- Upload a file in the UI.
- Stop one node terminal (Ctrl+C).
- Wait ~15–30 seconds.
- Upload another file or download an existing one (the coordinator will avoid dead nodes).
- Restart the node; the coordinator will gradually rebalance/repair replicas.

### Project structure
- `coordinator/app.py`: coordinator + UI + metadata + repair loop
- `node/app.py`: storage node service
- `shared/common.py`: shared helpers (chunking, hashing, http timeouts)
- `coordinator/templates/`: basic UI pages
- `coordinator/static/`: basic CSS
- `scripts/`: PowerShell run scripts

### Notes / limitations (intentionally basic)
- Not production secure (no auth/TLS).
- Single coordinator (no Raft/consensus); acceptable for a basic class project.
- Best effort repair; designed for demos and reports, not real workloads.

