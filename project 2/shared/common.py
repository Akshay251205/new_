from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from typing import Generator, Iterable


CHUNK_SIZE_BYTES = 1024 * 1024  # 1MB (kept small for easy demos)
HTTP_TIMEOUT_S = 6.0


def sha256_hex(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def file_chunks(path: str, chunk_size: int = CHUNK_SIZE_BYTES) -> Generator[bytes, None, None]:
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk_size)
            if not b:
                return
            yield b


def iter_bytes_chunks(data: bytes, chunk_size: int = CHUNK_SIZE_BYTES) -> Generator[bytes, None, None]:
    for i in range(0, len(data), chunk_size):
        yield data[i : i + chunk_size]


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class NodeInfo:
    node_id: str
    base_url: str


def pick_replica_nodes(alive_nodes: list[NodeInfo], replication: int) -> list[NodeInfo]:
    # Simple deterministic pick for predictability in demos.
    # (Later you can implement consistent hashing / better balancing.)
    if len(alive_nodes) < replication:
        raise ValueError("Not enough alive nodes to satisfy replication")
    return alive_nodes[:replication]

