## Fault-Tolerant Distributed File System (FDDFS)

This is an educational demo of a distributed file system with:
- Data integrity via SHA-256 content addressing
- Fault tolerance via replication (replication factor `R` and quorum reads/writes)
- Simple UX for upload/list/download/delete + node health/replication view

### What you run
- Multiple **Storage Nodes** (same service, different ports / node ids)
- One **Gateway** (splits files into chunks, replicates blobs, maintains distributed `fileIndex`)
- One **Web UI** (React)

### Quick start (local)

1. Install dependencies
   - From repo root:
     - `npm install`

2. Start 3 storage nodes (example ports 5001-5003)
   - Open 3 terminals:
     - Terminal A:
       - `npm run start -w services/storage-node -- --PORT=5001 --NODE_ID=0`
     - Terminal B:
       - `npm run start -w services/storage-node -- --PORT=5002 --NODE_ID=1`
     - Terminal C:
       - `npm run start -w services/storage-node -- --PORT=5003 --NODE_ID=2`

3. Start the gateway
   - New terminal:
     - `npm run start -w services/gateway -- --PORT=7000`

4. Start the web UI
   - New terminal:
     - `npm run start -w services/web -- --PORT=5173`

5. Open the UI
   - `http://localhost:5173`

### Config

See `.env.example` for defaults. You can override via environment variables when starting each service.

### Integrity + Fault tolerance model

- Every uploaded blob (chunks + file manifests) is stored under its SHA-256 hash: `PUT /blobs/:hash`
- A blob is replicated to `R` consecutive nodes on a fixed ring: primary = `hash % nodeCount`
- Writes succeed when at least `W` replicas store the blob
- Reads succeed when at least 1 replica returns the blob (gateway verifies hashes)
- Read repair: if some replicas are missing blobs, gateway re-replicates them after successful reads
- Deletes remove entries from the distributed `fileIndex` (data blobs are not garbage-collected in this demo)

