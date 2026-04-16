from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from shared.common import HTTP_TIMEOUT_S, ensure_dir, sha256_hex


NODE_ID = os.environ.get("DFS_NODE_ID", "node-1")
PORT = int(os.environ.get("DFS_NODE_PORT", "9101"))
BASE_URL = os.environ.get("DFS_NODE_BASE_URL", f"http://127.0.0.1:{PORT}")
COORDINATOR_URL = os.environ.get("DFS_COORDINATOR_URL", "http://127.0.0.1:9000")
DATA_DIR = os.environ.get("DFS_NODE_DATA_DIR", str((Path(__file__).resolve().parent / ".." / "data" / NODE_ID).resolve()))

HEARTBEAT_EVERY_S = float(os.environ.get("DFS_HEARTBEAT_EVERY_S", "3.0"))

app = FastAPI(title=f"Basic DFS Storage Node ({NODE_ID})")


def chunk_path(chunk_id: str) -> str:
    return str((Path(DATA_DIR) / f"{chunk_id}.bin").resolve())


@app.on_event("startup")
def _startup() -> None:
    ensure_dir(DATA_DIR)
    start_heartbeat_loop()


@app.post("/store")
async def store(chunk_id: str = Form(...), sha256: str = Form(...), chunk: UploadFile = File(...)):
    b = await chunk.read()
    actual = sha256_hex(b)
    if actual != sha256:
        raise HTTPException(status_code=400, detail="Checksum mismatch on upload")
    p = chunk_path(chunk_id)
    with open(p, "wb") as f:
        f.write(b)
    return {"ok": True, "bytes": len(b)}


@app.get("/fetch/{chunk_id}")
def fetch(chunk_id: str):
    p = chunk_path(chunk_id)
    if not os.path.exists(p):
        raise HTTPException(status_code=404, detail="Chunk not found")
    with open(p, "rb") as f:
        data = f.read()
    return Response(content=data, media_type="application/octet-stream")


@app.delete("/delete/{chunk_id}")
def delete(chunk_id: str):
    p = chunk_path(chunk_id)
    try:
        if os.path.exists(p):
            os.remove(p)
    except Exception:
        pass
    return {"ok": True}


def send_heartbeat() -> None:
    try:
        requests.post(
            f"{COORDINATOR_URL.rstrip('/')}/api/heartbeat",
            data={"node_id": NODE_ID, "base_url": BASE_URL.rstrip("/")},
            timeout=HTTP_TIMEOUT_S,
        )
    except Exception:
        return


def heartbeat_loop(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        send_heartbeat()
        stop_event.wait(HEARTBEAT_EVERY_S)


_hb_stop = threading.Event()


def start_heartbeat_loop() -> None:
    t = threading.Thread(target=heartbeat_loop, args=(_hb_stop,), daemon=True)
    t.start()

