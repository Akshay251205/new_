from __future__ import annotations

import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import requests
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from shared.common import HTTP_TIMEOUT_S, NodeInfo, ensure_dir, now_ms, pick_replica_nodes, sha256_hex


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = str((BASE_DIR / "metadata.sqlite3").resolve())
DEFAULT_REPLICATION = int(os.environ.get("DFS_REPLICATION", "2"))
NODE_DEAD_AFTER_MS = int(os.environ.get("DFS_NODE_DEAD_AFTER_MS", "15000"))
REPAIR_EVERY_MS = int(os.environ.get("DFS_REPAIR_EVERY_MS", "8000"))

app = FastAPI(title="Basic DFS Coordinator")

templates = Jinja2Templates(directory=str((BASE_DIR / "templates").resolve()))
app.mount("/static", StaticFiles(directory=str((BASE_DIR / "static").resolve())), name="static")


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    ensure_dir(str(BASE_DIR))
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS nodes (
              node_id TEXT PRIMARY KEY,
              base_url TEXT NOT NULL,
              last_heartbeat_ms INTEGER NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS files (
              file_id TEXT PRIMARY KEY,
              filename TEXT NOT NULL,
              content_type TEXT,
              size_bytes INTEGER NOT NULL,
              created_ms INTEGER NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chunks (
              chunk_id TEXT PRIMARY KEY,
              file_id TEXT NOT NULL,
              idx INTEGER NOT NULL,
              size_bytes INTEGER NOT NULL,
              sha256 TEXT NOT NULL,
              FOREIGN KEY(file_id) REFERENCES files(file_id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chunk_replicas (
              chunk_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              PRIMARY KEY(chunk_id, node_id),
              FOREIGN KEY(chunk_id) REFERENCES chunks(chunk_id),
              FOREIGN KEY(node_id) REFERENCES nodes(node_id)
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def upsert_node(node_id: str, base_url: str) -> None:
    conn = db()
    try:
        conn.execute(
            """
            INSERT INTO nodes(node_id, base_url, last_heartbeat_ms)
            VALUES(?, ?, ?)
            ON CONFLICT(node_id) DO UPDATE SET
              base_url=excluded.base_url,
              last_heartbeat_ms=excluded.last_heartbeat_ms
            """,
            (node_id, base_url, now_ms()),
        )
        conn.commit()
    finally:
        conn.close()


def alive_nodes() -> list[NodeInfo]:
    conn = db()
    try:
        rows = conn.execute("SELECT node_id, base_url, last_heartbeat_ms FROM nodes").fetchall()
    finally:
        conn.close()
    t = now_ms()
    out: list[NodeInfo] = []
    for r in rows:
        if t - int(r["last_heartbeat_ms"]) <= NODE_DEAD_AFTER_MS:
            out.append(NodeInfo(node_id=r["node_id"], base_url=r["base_url"]))
    out.sort(key=lambda n: n.node_id)
    return out


def node_status_rows() -> list[dict[str, Any]]:
    conn = db()
    try:
        rows = conn.execute("SELECT node_id, base_url, last_heartbeat_ms FROM nodes ORDER BY node_id").fetchall()
    finally:
        conn.close()
    t = now_ms()
    out: list[dict[str, Any]] = []
    for r in rows:
        age = t - int(r["last_heartbeat_ms"])
        out.append(
            {
                "node_id": r["node_id"],
                "base_url": r["base_url"],
                "last_heartbeat_ms": int(r["last_heartbeat_ms"]),
                "age_ms": age,
                "alive": age <= NODE_DEAD_AFTER_MS,
            }
        )
    return out


@app.on_event("startup")
def _startup() -> None:
    init_db()
    start_repair_loop()


@app.get("/", response_class=HTMLResponse)
def ui_index(request: Request):
    conn = db()
    try:
        files = conn.execute("SELECT file_id, filename, size_bytes, created_ms FROM files ORDER BY created_ms DESC").fetchall()
    finally:
        conn.close()
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "files": files,
            "replication": DEFAULT_REPLICATION,
        },
    )


@app.get("/health", response_class=HTMLResponse)
def ui_health(request: Request):
    return templates.TemplateResponse(
        "health.html",
        {
            "request": request,
            "nodes": node_status_rows(),
            "dead_after_ms": NODE_DEAD_AFTER_MS,
        },
    )


@app.post("/api/heartbeat")
def api_heartbeat(node_id: str = Form(...), base_url: str = Form(...)):
    upsert_node(node_id=node_id, base_url=base_url.rstrip("/"))
    return {"ok": True}


@app.get("/api/nodes")
def api_nodes():
    return {"nodes": node_status_rows()}


@app.get("/api/files")
def api_files():
    conn = db()
    try:
        rows = conn.execute("SELECT file_id, filename, size_bytes, created_ms FROM files ORDER BY created_ms DESC").fetchall()
        return {"files": [dict(r) for r in rows]}
    finally:
        conn.close()


def store_chunk_on_node(node: NodeInfo, chunk_id: str, chunk_bytes: bytes, sha256: str) -> None:
    try:
        r = requests.post(
            f"{node.base_url}/store",
            files={"chunk": ("chunk.bin", chunk_bytes, "application/octet-stream")},
            data={"chunk_id": chunk_id, "sha256": sha256},
            timeout=HTTP_TIMEOUT_S,
        )
        if r.status_code != 200:
            raise RuntimeError(r.text)
    except Exception as e:
        raise RuntimeError(f"failed store on {node.node_id}: {e}") from e


def fetch_chunk_from_node(node: NodeInfo, chunk_id: str) -> bytes:
    r = requests.get(f"{node.base_url}/fetch/{chunk_id}", timeout=HTTP_TIMEOUT_S)
    if r.status_code != 200:
        raise RuntimeError(f"fetch from {node.node_id} failed: {r.status_code}")
    return r.content


@app.post("/upload")
async def ui_upload(file: UploadFile = File(...)):
    nodes = alive_nodes()
    if len(nodes) < DEFAULT_REPLICATION:
        raise HTTPException(status_code=503, detail="Not enough alive storage nodes")

    file_id = str(uuid.uuid4())
    created_ms = now_ms()

    data = await file.read()
    size_bytes = len(data)

    conn = db()
    try:
        conn.execute(
            "INSERT INTO files(file_id, filename, content_type, size_bytes, created_ms) VALUES(?,?,?,?,?)",
            (file_id, file.filename or "uploaded.bin", file.content_type, size_bytes, created_ms),
        )

        # Chunk and replicate.
        idx = 0
        offset = 0
        chunk_size = 1024 * 1024
        while offset < len(data):
            chunk_bytes = data[offset : offset + chunk_size]
            offset += len(chunk_bytes)

            chunk_sha = sha256_hex(chunk_bytes)
            chunk_id = f"{file_id}-{idx:06d}-{chunk_sha[:12]}"

            chosen = pick_replica_nodes(nodes, DEFAULT_REPLICATION)
            for n in chosen:
                store_chunk_on_node(n, chunk_id=chunk_id, chunk_bytes=chunk_bytes, sha256=chunk_sha)
                conn.execute(
                    "INSERT OR IGNORE INTO chunk_replicas(chunk_id, node_id) VALUES(?,?)",
                    (chunk_id, n.node_id),
                )

            conn.execute(
                "INSERT INTO chunks(chunk_id, file_id, idx, size_bytes, sha256) VALUES(?,?,?,?,?)",
                (chunk_id, file_id, idx, len(chunk_bytes), chunk_sha),
            )
            idx += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return RedirectResponse(url="/", status_code=303)


def file_chunks_rows(file_id: str) -> list[sqlite3.Row]:
    conn = db()
    try:
        rows = conn.execute("SELECT chunk_id, idx, size_bytes, sha256 FROM chunks WHERE file_id=? ORDER BY idx", (file_id,)).fetchall()
        return rows
    finally:
        conn.close()


def replica_nodes_for_chunk(chunk_id: str) -> list[NodeInfo]:
    conn = db()
    try:
        rows = conn.execute(
            """
            SELECT n.node_id, n.base_url, n.last_heartbeat_ms
            FROM chunk_replicas cr
            JOIN nodes n ON n.node_id = cr.node_id
            WHERE cr.chunk_id=?
            """,
            (chunk_id,),
        ).fetchall()
    finally:
        conn.close()
    t = now_ms()
    out: list[NodeInfo] = []
    for r in rows:
        if t - int(r["last_heartbeat_ms"]) <= NODE_DEAD_AFTER_MS:
            out.append(NodeInfo(node_id=r["node_id"], base_url=r["base_url"]))
    out.sort(key=lambda n: n.node_id)
    return out


@app.get("/download/{file_id}")
def ui_download(file_id: str):
    conn = db()
    try:
        f = conn.execute("SELECT file_id, filename FROM files WHERE file_id=?", (file_id,)).fetchone()
    finally:
        conn.close()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    chunks = file_chunks_rows(file_id)
    if not chunks:
        raise HTTPException(status_code=404, detail="No chunks found")

    def stream():
        for c in chunks:
            chunk_id = c["chunk_id"]
            expected = c["sha256"]
            replicas = replica_nodes_for_chunk(chunk_id)
            last_err: Exception | None = None
            for n in replicas:
                try:
                    b = fetch_chunk_from_node(n, chunk_id)
                    if sha256_hex(b) != expected:
                        raise RuntimeError("checksum mismatch")
                    yield b
                    last_err = None
                    break
                except Exception as e:
                    last_err = e
                    continue
            if last_err:
                raise HTTPException(status_code=503, detail=f"Missing chunk {chunk_id}")

    return StreamingResponse(
        stream(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{f["filename"]}"'},
    )


@app.post("/delete")
def ui_delete(background: BackgroundTasks, file_id: str = Form(...)):
    # Remove metadata first, then best-effort delete chunks on nodes in background.
    chunks = [r["chunk_id"] for r in file_chunks_rows(file_id)]

    conn = db()
    try:
        conn.execute("DELETE FROM chunk_replicas WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE file_id=?)", (file_id,))
        conn.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
        conn.execute("DELETE FROM files WHERE file_id=?", (file_id,))
        conn.commit()
    finally:
        conn.close()

    background.add_task(best_effort_delete_chunks, chunks)
    return RedirectResponse(url="/", status_code=303)


def best_effort_delete_chunks(chunk_ids: list[str]) -> None:
    # We don't know which nodes still have them; try all known nodes.
    rows = node_status_rows()
    for r in rows:
        base = str(r["base_url"]).rstrip("/")
        for cid in chunk_ids:
            try:
                requests.delete(f"{base}/delete/{cid}", timeout=HTTP_TIMEOUT_S)
            except Exception:
                continue


def desired_replication() -> int:
    return DEFAULT_REPLICATION


def repair_once() -> None:
    alive = alive_nodes()
    if not alive:
        return

    conn = db()
    try:
        chunk_rows = conn.execute("SELECT chunk_id, sha256 FROM chunks").fetchall()
        for cr in chunk_rows:
            chunk_id = cr["chunk_id"]
            expected = cr["sha256"]

            # Current replicas (alive only)
            replicas = replica_nodes_for_chunk(chunk_id)
            if len(replicas) >= desired_replication():
                continue

            # Find a source replica from any known replica (alive preferred; dead nodes likely fail).
            src_bytes: bytes | None = None
            for n in replicas:
                try:
                    b = fetch_chunk_from_node(n, chunk_id)
                    if sha256_hex(b) != expected:
                        continue
                    src_bytes = b
                    break
                except Exception:
                    continue
            if src_bytes is None:
                continue

            existing = {n.node_id for n in replicas}
            candidates = [n for n in alive if n.node_id not in existing]
            if not candidates:
                continue

            target = candidates[0]
            try:
                store_chunk_on_node(target, chunk_id=chunk_id, chunk_bytes=src_bytes, sha256=expected)
                conn.execute(
                    "INSERT OR IGNORE INTO chunk_replicas(chunk_id, node_id) VALUES(?,?)",
                    (chunk_id, target.node_id),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                continue
    finally:
        conn.close()


def repair_loop(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        try:
            repair_once()
        except Exception:
            # Keep loop alive; this is a demo-grade system.
            pass
        stop_event.wait(REPAIR_EVERY_MS / 1000.0)


_repair_stop = threading.Event()


def start_repair_loop() -> None:
    t = threading.Thread(target=repair_loop, args=(_repair_stop,), daemon=True)
    t.start()

